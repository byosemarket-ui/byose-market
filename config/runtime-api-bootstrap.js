(function bootstrapRuntimeApi(global) {
  if (!global) {
    return;
  }

  var PRODUCTION_API_BASE = "https://byosemarket.com/api";
  var LEGACY_API_PATTERN = /(?:onrender\.com|localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i;
  var STORAGE_KEYS = ["adminApiBaseUrl", "adminValidatedApiBaseUrl"];
  var LEGACY_CATALOG_KEYS = [
    "byose_market_products_catalog_v1",
    "byose_market_products_catalog_v2",
    "byose_market_products_catalog_v3"
  ];

  function normalizeApiBase(value) {
    var normalized = String(value || "").trim().replace(/\/+$/, "").replace(/\/admin$/i, "");
    if (!normalized) {
      return "";
    }

    return /\/api$/i.test(normalized) ? normalized : normalized + "/api";
  }

  function isLegacyApiBase(value) {
    return LEGACY_API_PATTERN.test(normalizeApiBase(value));
  }

  function resolveApiBaseUrl() {
    var protocol = String(global.location && global.location.protocol || "").toLowerCase();
    var hostname = String(global.location && global.location.hostname || "").trim().toLowerCase();
    var origin = String(global.location && global.location.origin || "").replace(/\/+$/, "");

    if ((protocol === "http:" || protocol === "https:") && origin) {
      // Production host and local/dev hosts must stay same-origin so checkout
      // posts orders to the API that owns the catalog/stock being viewed.
      if (/byosemarket\.com$/i.test(hostname)
        || hostname === "localhost"
        || hostname === "127.0.0.1"
        || hostname === "0.0.0.0") {
        return origin + "/api";
      }
    }

    return PRODUCTION_API_BASE;
  }

  function migrateStoredApiBase(expectedApiBase) {
    if (!expectedApiBase || typeof global.localStorage === "undefined") {
      return;
    }

    STORAGE_KEYS.forEach(function migrateKey(key) {
      try {
        var stored = normalizeApiBase(global.localStorage.getItem(key));
        if (!stored || isLegacyApiBase(stored)) {
          global.localStorage.setItem(key, expectedApiBase);
        }
      } catch (_error) {
        // Ignore storage failures.
      }
    });
  }

  var resolvedApiBase = resolveApiBaseUrl();

  if (!global.BYOSE_API_BASE_URL || isLegacyApiBase(global.BYOSE_API_BASE_URL)) {
    global.BYOSE_API_BASE_URL = resolvedApiBase;
  }

  migrateStoredApiBase(normalizeApiBase(global.BYOSE_API_BASE_URL || resolvedApiBase));

  if (typeof global.localStorage !== "undefined") {
    LEGACY_CATALOG_KEYS.forEach(function purgeCatalogKey(key) {
      try {
        global.localStorage.removeItem(key);
      } catch (_error) {
        // Ignore storage failures.
      }
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
