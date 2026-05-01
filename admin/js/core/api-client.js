(function (global) {
	"use strict";

	async function request(path, options) {
		const baseUrl = String(global.AdminConfig?.apiBaseUrl || "").replace(/\/$/, "");
		const url = /^https?:/i.test(String(path || "")) || String(path || "").startsWith("/")
			? path
			: `${baseUrl}/${String(path || "").replace(/^\/+/, "")}`;

		const response = await fetch(url, {
			headers: {
				"Content-Type": "application/json",
				...(options?.headers || {})
			},
			...options
		});

		const contentType = response.headers.get("content-type") || "";
		const payload = contentType.includes("application/json")
			? await response.json().catch(() => null)
			: await response.text().catch(() => null);

		if (!response.ok) {
			throw new Error((payload && payload.message) || `Request failed with status ${response.status}`);
		}

		return payload;
	}

	global.AdminApiClient = {
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
