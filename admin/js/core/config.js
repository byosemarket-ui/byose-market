(function (global) {
	"use strict";

	const API_BASE_STORAGE_KEY = "byose_api_base_url";

	function normalizeApiBaseUrl(value) {
		return String(value || "").trim().replace(/\/+$/, "");
	}

	function readStoredApiBaseUrl() {
		try {
			return normalizeApiBaseUrl(global.localStorage?.getItem(API_BASE_STORAGE_KEY) || "");
		} catch (error) {
			return "";
		}
	}

	function persistApiBaseUrl(value) {
		const normalizedValue = normalizeApiBaseUrl(value);

		try {
			if (!global.localStorage) {
				return normalizedValue;
			}

			if (normalizedValue) {
				global.localStorage.setItem(API_BASE_STORAGE_KEY, normalizedValue);
			} else {
				global.localStorage.removeItem(API_BASE_STORAGE_KEY);
			}
		} catch (error) {
			return normalizedValue;
		}

		return normalizedValue;
	}

	function readApiBaseOverride() {
		const metaTag = global.document && typeof global.document.querySelector === "function"
			? global.document.querySelector('meta[name="byose-api-base-url"]')
			: null;
		const metaValue = metaTag ? normalizeApiBaseUrl(metaTag.getAttribute("content") || "") : "";
		const runtimeValue = normalizeApiBaseUrl(global.BYOSE_API_BASE_URL || "");
		const storedValue = readStoredApiBaseUrl();
		const overrideValue = runtimeValue || metaValue || storedValue;

		if (overrideValue && overrideValue !== storedValue) {
			persistApiBaseUrl(overrideValue);
		}

		return overrideValue;
	}

	function isLocalHost(hostname) {
		return hostname === "localhost"
			|| hostname === "127.0.0.1"
			|| hostname === "0.0.0.0";
	}

	function requiresExternalApiBaseUrl(protocol, hostname) {
		return (protocol === "http:" || protocol === "https:")
			&& /(^|\.)github\.io$/i.test(hostname);
	}

	function getDefaultApiBaseUrl() {
		const protocol = String(global.location?.protocol || "").toLowerCase();
		const hostname = String(global.location?.hostname || "").trim();
		const port = String(global.location?.port || "").trim();

		if (protocol === "file:") {
			return "http://localhost:3000/api";
		}

		if (isLocalHost(hostname) && port && port !== "3000") {
			return `${protocol}//${hostname}:3000/api`;
		}

		if (isLocalHost(hostname)) {
			return `${protocol}//${hostname}${port ? `:${port}` : ":3000"}/api`;
		}

		if (requiresExternalApiBaseUrl(protocol, hostname)) {
			return "";
		}

		return "/api";
	}

	const apiBaseOverride = readApiBaseOverride();
	const apiBaseUrl = apiBaseOverride || getDefaultApiBaseUrl();
	const protocol = String(global.location?.protocol || "").toLowerCase();
	const hostname = String(global.location?.hostname || "").trim();

	function getSiteRootPrefix() {
		const path = String(global.location?.pathname || "");
		if (path.includes("/admin/")) {
			return path.includes("/admin/") ? "../" : "";
		}
		return "";
	}

	global.AdminConfig = {
		apiBaseUrl,
		adminApiBaseUrl: apiBaseUrl ? `${apiBaseUrl.replace(/\/+$/, "")}/admin` : "",
		apiBaseConfigured: Boolean(apiBaseUrl),
		requiresExternalApiBaseUrl: !apiBaseOverride && requiresExternalApiBaseUrl(protocol, hostname),
		setApiBaseUrl(value) {
			return persistApiBaseUrl(value);
		},
		clearApiBaseUrl() {
			persistApiBaseUrl("");
		},
		siteRootPrefix: getSiteRootPrefix(),
		storageKeys: {
			orders: ["byose_orders", "orders"],
			users: ["bm_users", "byose_market_users"],
			messages: ["byose_market_messages", "byose_messages"],
			categories: "byose_admin_categories_v1",
			media: "byose_admin_media_v1",
			homepage: "byose_admin_homepage_v1",
			settings: "byose_admin_settings_v1"
		}
	};
})(window);
