(function (global) {
	"use strict";

	const PRODUCTION_API_BASE_URL = "https://byosemarket-api.onrender.com/api";

	function normalizeApiBaseUrl(value) {
		return String(value || "").trim().replace(/\/+$/, "");
	}

	function readApiBaseOverride() {
		const metaTag = global.document && typeof global.document.querySelector === "function"
			? global.document.querySelector('meta[name="byose-api-base-url"]')
			: null;
		const metaValue = metaTag ? normalizeApiBaseUrl(metaTag.getAttribute("content") || "") : "";
		const runtimeValue = normalizeApiBaseUrl(global.BYOSE_API_BASE_URL || "");

		return runtimeValue || metaValue;
	}

	function requiresExternalApiBaseUrl(protocol, hostname) {
		return (protocol === "http:" || protocol === "https:")
			&& /(^|\.)(github\.io|byosemarket\.com|www\.byosemarket\.com)$/i.test(hostname);
	}

	function getDefaultApiBaseUrl() {
		return PRODUCTION_API_BASE_URL;
	}

	const protocol = String(global.location?.protocol || "").toLowerCase();
	const hostname = String(global.location?.hostname || "").trim();
	const apiConfigState = {
		apiBaseUrl: "",
		adminApiBaseUrl: "",
		apiBaseConfigured: false,
		requiresExternalApiBaseUrl: false
	};

	function syncApiBaseConfig(overrideValue) {
		const normalizedOverride = normalizeApiBaseUrl(overrideValue);
		const resolvedApiBaseUrl = normalizedOverride || getDefaultApiBaseUrl();

		apiConfigState.apiBaseUrl = resolvedApiBaseUrl;
		apiConfigState.adminApiBaseUrl = resolvedApiBaseUrl ? `${resolvedApiBaseUrl.replace(/\/+$/, "")}/admin` : "";
		apiConfigState.apiBaseConfigured = Boolean(resolvedApiBaseUrl);
		apiConfigState.requiresExternalApiBaseUrl = !normalizedOverride && requiresExternalApiBaseUrl(protocol, hostname);
	}

	syncApiBaseConfig(readApiBaseOverride());

	function getSiteRootPrefix() {
		const path = String(global.location?.pathname || "");
		if (path.includes("/admin/")) {
			return path.includes("/admin/") ? "../" : "";
		}
		return "";
	}

	global.AdminConfig = {
		get apiBaseUrl() {
			return apiConfigState.apiBaseUrl;
		},
		get adminApiBaseUrl() {
			return apiConfigState.adminApiBaseUrl;
		},
		get apiBaseConfigured() {
			return apiConfigState.apiBaseConfigured;
		},
		get requiresExternalApiBaseUrl() {
			return apiConfigState.requiresExternalApiBaseUrl;
		},
		setApiBaseUrl(value) {
			const normalizedValue = normalizeApiBaseUrl(value);
			syncApiBaseConfig(normalizedValue);
			return apiConfigState.apiBaseUrl;
		},
		clearApiBaseUrl() {
			syncApiBaseConfig("");
		},
		productionApiBaseUrl: PRODUCTION_API_BASE_URL,
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
