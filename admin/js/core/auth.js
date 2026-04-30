(function (global) {
	"use strict";

	const STORAGE_KEY = "byose_admin_session_v1";

	function safeParse(value) {
		try {
			return JSON.parse(value);
		} catch (error) {
			return null;
		}
	}

	function getAdminBasePath() {
		const path = String(global.location?.pathname || "").replace(/\\/g, "/");
		const marker = "/admin/";
		const markerIndex = path.toLowerCase().indexOf(marker);

		if (markerIndex !== -1) {
			return path.slice(0, markerIndex + marker.length);
		}

		return "/admin/";
	}

	function buildAdminUrl(relativePath) {
		const cleanPath = String(relativePath || "").replace(/^\/+/, "");
		return `${getAdminBasePath()}${cleanPath}`;
	}

	function getApiBaseUrl() {
		return String(global.AdminConfig?.apiBaseUrl || "/api").replace(/\/$/, "");
	}

	function getAdminApiBaseUrl() {
		return String(global.AdminConfig?.adminApiBaseUrl || `${getApiBaseUrl()}/admin`).replace(/\/$/, "");
	}

	async function requestAdmin(path, options) {
		let response;
		try {
			response = await global.fetch(`${getAdminApiBaseUrl()}${path}`, {
				method: options?.method || "GET",
				headers: {
					...(options?.body ? { "Content-Type": "application/json" } : {}),
					...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
					...(options?.headers || {})
				},
				body: options?.body ? JSON.stringify(options.body) : undefined
			});
		} catch (error) {
			throw new Error("Unable to reach the admin server. Start the backend and try again.");
		}

		const contentType = response.headers.get("content-type") || "";
		const payload = contentType.includes("application/json")
			? await response.json().catch(() => null)
			: await response.text().catch(() => null);
		if (!response.ok) {
			throw new Error((payload && payload.message) || (typeof payload === "string" && payload) || "Admin request failed.");
		}

		return payload;
	}

	function getSessionRedirectPath() {
		const path = String(global.location?.pathname || "").replace(/\\/g, "/");
		const marker = "/admin/";
		const markerIndex = path.toLowerCase().indexOf(marker);
		const adminPath = markerIndex === -1 ? "dashboard.html" : path.slice(markerIndex + marker.length);
		const suffix = `${global.location?.search || ""}${global.location?.hash || ""}`;
		return `${adminPath || "dashboard.html"}${suffix}`;
	}

	function getLoginUrl() {
		return buildAdminUrl("login.html");
	}

	function getDashboardUrl() {
		return buildAdminUrl("dashboard.html");
	}

	function isLoginPage() {
		return /\/admin\/login\.html$/i.test(String(global.location?.pathname || "").replace(/\\/g, "/"));
	}

	function normalizeSession(value) {
		if (!value || typeof value !== "object") {
			return null;
		}

		const token = String(value.token || "").trim();
		const admin = value.admin && typeof value.admin === "object" ? value.admin : null;
		const email = String(value.email || admin?.email || "").trim().toLowerCase();
		const role = String(value.role || admin?.role || "").trim().toLowerCase();
		if (!token || !admin || role !== "admin" || !email) {
			return null;
		}

		const name = String(value.name || admin?.name || "Admin").trim() || "Admin";

		return {
			token,
			admin: {
				name,
				email,
				role: "admin",
				...(admin || {})
			},
			email,
			name,
			role: "admin",
			loggedInAt: value.loggedInAt || new Date().toISOString()
		};
	}

	function getSession() {
		return normalizeSession(safeParse(global.localStorage.getItem(STORAGE_KEY)));
	}

	function persistSession(payload) {
		const session = normalizeSession(payload);
		if (!session) {
			logout({ redirect: false });
			return null;
		}

		global.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
		return session;
	}

	async function login(credentials) {
		const payload = await requestAdmin("/login", {
			method: "POST",
			body: {
				email: String(credentials?.email || "").trim(),
				password: String(credentials?.password || "")
			}
		});

		const session = persistSession({
			token: payload?.token,
			admin: payload?.admin,
			email: payload?.admin?.email,
			name: payload?.admin?.name,
			role: payload?.admin?.role || "admin",
			loggedInAt: new Date().toISOString()
		});

		if (!session) {
			throw new Error("Invalid admin credentials");
		}

		return session;
	}

	function logout(options) {
		global.localStorage.removeItem(STORAGE_KEY);
		if (options?.redirect !== false && !isLoginPage()) {
			global.location.replace(getLoginUrl());
		}
	}

	function getToken() {
		return String(getSession()?.token || "").trim();
	}

	function isLoggedIn() {
		return Boolean(getSession()?.token);
	}

	function getPostLoginRedirectUrl() {
		const params = new URLSearchParams(global.location?.search || "");
		const redirect = String(params.get("redirect") || "").trim();
		if (!redirect || /^https?:/i.test(redirect)) {
			return getDashboardUrl();
		}

		if (redirect.startsWith("/")) {
			return redirect;
		}

		return buildAdminUrl(redirect);
	}

	function redirectToLogin() {
		const loginUrl = new URL(getLoginUrl(), global.location.origin);
		loginUrl.searchParams.set("redirect", getSessionRedirectPath());
		global.location.replace(loginUrl.toString());
	}

	async function validateSession(options) {
		const session = getSession();
		if (!session || !session.token) {
			logout({ redirect: false });
			return null;
		}

		try {
			const payload = await requestAdmin("/session", {
				method: "GET",
				token: session.token
			});

			return persistSession({
				token: session.token,
				admin: payload?.admin,
				email: payload?.admin?.email,
				name: payload?.admin?.name,
				role: payload?.admin?.role || "admin",
				loggedInAt: session.loggedInAt
			});
		} catch (error) {
			logout({ redirect: false });
			if (options?.silent) {
				return null;
			}
			throw error;
		}
	}

	async function requireAuth() {
		if (isLoginPage()) {
			return getSession();
		}

		if (!isLoggedIn()) {
			redirectToLogin();
			return null;
		}

		const session = await validateSession();
		if (!session) {
			redirectToLogin();
			return null;
		}

		return session;
	}

	global.AdminAuthService = {
		getSession,
		login,
		logout,
		getToken,
		isLoggedIn,
		validateSession,
		requireAuth,
		getLoginUrl,
		getDashboardUrl,
		getPostLoginRedirectUrl,
		redirectToLogin
	};

	if (!isLoginPage()) {
		requireAuth();
	}
})(window);
