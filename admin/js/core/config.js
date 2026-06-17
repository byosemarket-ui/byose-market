(function (global) {
	"use strict";

	const PRODUCTION_API_BASE_URL = "https://byosemarket.com/api";
	const PRODUCTION_SITE_ORIGIN = "https://byosemarket.com";
	const LEGACY_API_PATTERN = /(?:onrender\.com|localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i;
	const ADMIN_API_BASE_URL_STORAGE_KEY = "adminApiBaseUrl";
	const ADMIN_VALIDATED_API_BASE_URL_STORAGE_KEY = "adminValidatedApiBaseUrl";

	function normalizeApiBaseUrl(value) {
		const normalized = String(value || "").trim().replace(/\/+$/, "").replace(/\/admin$/i, "");
		if (!normalized) {
			return "";
		}

		return /\/api$/i.test(normalized) ? normalized : `${normalized}/api`;
	}

	function isLegacyApiBase(value) {
		return LEGACY_API_PATTERN.test(normalizeApiBaseUrl(value));
	}

	function readStoredAdminApiBaseUrl() {
		try {
			return normalizeApiBaseUrl(global.localStorage.getItem(ADMIN_API_BASE_URL_STORAGE_KEY) || "");
		} catch (error) {
			return "";
		}
	}

	function readStoredValidatedAdminApiBaseUrl() {
		try {
			return normalizeApiBaseUrl(global.localStorage.getItem(ADMIN_VALIDATED_API_BASE_URL_STORAGE_KEY) || "");
		} catch (error) {
			return "";
		}
	}

	function readApiBaseOverride() {
		const securityValue = normalizeApiBaseUrl(global.AdminSecurity?.getApiBaseUrl?.() || "");
		const metaTag = global.document && typeof global.document.querySelector === "function"
			? global.document.querySelector('meta[name="byose-api-base-url"]')
			: null;
		const metaValue = metaTag ? normalizeApiBaseUrl(metaTag.getAttribute("content") || "") : "";
		const runtimeValue = normalizeApiBaseUrl(global.BYOSE_API_BASE_URL || global.__BYOSE_API_BASE__ || "");
		const validatedValue = readStoredValidatedAdminApiBaseUrl();
		const storedValue = readStoredAdminApiBaseUrl();

		const candidates = [runtimeValue, securityValue, metaValue, validatedValue, storedValue];
		for (const candidate of candidates) {
			if (candidate && !isLegacyApiBase(candidate)) {
				return candidate;
			}
		}

		return "";
	}

	function requiresExternalApiBaseUrl(protocol, hostname) {
		return (protocol === "http:" || protocol === "https:")
			&& /(^|\.)github\.io$/i.test(String(hostname || ""));
	}

	function getDefaultApiBaseUrl() {
		const protocol = String(global.location?.protocol || "").toLowerCase();
		const hostname = String(global.location?.hostname || "").trim().toLowerCase();
		const origin = String(global.location?.origin || "").trim().replace(/\/+$/, "");

		if ((protocol === "http:" || protocol === "https:") && origin && /byosemarket\.com$/i.test(hostname)) {
			return `${origin}/api`;
		}

		if (requiresExternalApiBaseUrl(protocol, hostname)) {
			return PRODUCTION_API_BASE_URL;
		}

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
		const resolvedApiBaseUrl = (normalizedOverride && !isLegacyApiBase(normalizedOverride))
			? normalizedOverride
			: getDefaultApiBaseUrl();

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
		productionSiteOrigin: PRODUCTION_SITE_ORIGIN,
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
