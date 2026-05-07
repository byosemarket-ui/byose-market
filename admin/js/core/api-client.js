(function (global) {
	"use strict";

	function ensureDiagnostics() {
		if (global.ByoseDiagnostics) {
			return global.ByoseDiagnostics;
		}

		const entries = [];
		const MAX_ENTRIES = 200;

		function push(level, event, detail) {
			const entry = {
				timestamp: new Date().toISOString(),
				level,
				event,
				detail: detail || {}
			};

			entries.push(entry);
			if (entries.length > MAX_ENTRIES) {
				entries.shift();
			}

			if (global.console && typeof global.console[level] === "function") {
				global.console[level](`[ByoseDiagnostics] ${event}`, detail || {});
			}

			return entry;
		}

		global.ByoseDiagnostics = {
			logInfo(event, detail) { return push("info", event, detail); },
			logWarn(event, detail) { return push("warn", event, detail); },
			logError(event, detail) { return push("error", event, detail); },
			logApiFailure(scope, error, detail) {
				return push("warn", "api.failure", {
					scope,
					message: String(error?.message || ""),
					status: Number(error?.status || 0) || undefined,
					...(detail || {})
				});
			},
			logSyncIssue(scope, detail) { return push("warn", "sync.issue", { scope, ...(detail || {}) }); },
			getEntries() { return entries.slice(); }
		};

		return global.ByoseDiagnostics;
	}

	const diagnostics = ensureDiagnostics();

	function getAdminToken() {
		try {
			return String(global.localStorage.getItem("adminToken") || "").trim();
		} catch (error) {
			return "";
		}
	}

	function getBaseUrl() {
		return String(global.AdminConfig?.apiBaseUrl || "").replace(/\/+$/, "");
	}

	async function request(path, options) {
		const baseUrl = getBaseUrl();
		const url = /^https?:/i.test(String(path || "")) || String(path || "").startsWith("/")
			? path
			: `${baseUrl}/${String(path || "").replace(/^\/+/, "")}`;
		const adminToken = getAdminToken();

		const response = await fetch(url, {
			headers: {
				"Content-Type": "application/json",
				"Accept": "application/json",
				...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
				...(options?.headers || {})
			},
			...options
		});

		const contentType = response.headers.get("content-type") || "";
		const payload = contentType.includes("application/json")
			? await response.json().catch(() => null)
			: await response.text().catch(() => null);

		if (!response.ok) {
			if (response.status === 401 || response.status === 403) {
				if (global.AdminSecurity && typeof global.AdminSecurity.handleUnauthorized === "function") {
					global.AdminSecurity.handleUnauthorized();
				}
			}

			const error = new Error((payload && payload.message) || `Request failed with status ${response.status}`);
			error.status = response.status;
			error.payload = payload;
			diagnostics.logApiFailure("admin-api-client", error, { url, method: options?.method || "GET" });
			throw error;
		}

		return payload;
	}

	global.AdminApiClient = {
		getBaseUrl,
		request,
		get(path) {
			return request(path, { method: "GET" });
		},
		post(path, body) {
			return request(path, { method: "POST", body: JSON.stringify(body || {}) });
		},
		put(path, body) {
			return request(path, { method: "PUT", body: JSON.stringify(body || {}) });
		},
		delete(path) {
			return request(path, { method: "DELETE" });
		}
	};
})(window);
