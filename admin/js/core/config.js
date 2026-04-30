(function (global) {
	"use strict";

	function readApiBaseOverride() {
		const metaTag = global.document && typeof global.document.querySelector === "function"
			? global.document.querySelector('meta[name="byose-api-base-url"]')
			: null;
		const metaValue = metaTag ? String(metaTag.getAttribute("content") || "").trim() : "";
		const runtimeValue = String(global.BYOSE_API_BASE_URL || "").trim();
		return (runtimeValue || metaValue).replace(/\/+$/, "");
	}

	function getDefaultApiBaseUrl() {
		const protocol = String(global.location?.protocol || "").toLowerCase();
		const hostname = String(global.location?.hostname || "").trim();
		const port = String(global.location?.port || "").trim();

		if (protocol === "file:") {
			return "http://localhost:3000/api";
		}

		if ((protocol === "http:" || protocol === "https:") && hostname && port && port !== "3000") {
			return `${protocol}//${hostname}:3000/api`;
		}

		return "/api";
	}

	const apiBaseUrl = readApiBaseOverride() || getDefaultApiBaseUrl();

	function getSiteRootPrefix() {
		const path = String(global.location?.pathname || "");
		if (path.includes("/admin/")) {
			return path.includes("/admin/") ? "../" : "";
		}
		return "";
	}

	global.AdminConfig = {
		apiBaseUrl,
		adminApiBaseUrl: `${apiBaseUrl.replace(/\/+$/, "")}/admin`,
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
