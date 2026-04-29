(function (global) {
	"use strict";

	function getSiteRootPrefix() {
		const path = String(global.location?.pathname || "");
		if (path.includes("/admin/")) {
			return path.includes("/admin/") ? "../" : "";
		}
		return "";
	}

	global.AdminConfig = {
		apiBaseUrl: "/api",
		adminApiBaseUrl: "/api/admin",
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
