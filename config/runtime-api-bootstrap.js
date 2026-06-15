(function bootstrapRuntimeApi(global) {
  if (!global) {
    return;
  }

  var STATIC_EXTERNAL_HOST_PATTERN = /(^|\.)github\.io$/i;
  var LEGACY_RENDER_API_BASE = "https://byosesemarket4.onrender.com/api";
  var STORAGE_KEYS = ["adminApiBaseUrl", "adminValidatedApiBaseUrl"];
  var protocol = String(global.location && global.location.protocol || "").toLowerCase();
  var hostname = String(global.location && global.location.hostname || "").trim().toLowerCase();
  var origin = String(global.location && global.location.origin || "").replace(/\/+$/, "");

  function normalizeApiBase(value) {
    var normalized = String(value || "").trim().replace(/\/+$/, "");
    if (!normalized) {
      return "";
    }

    return /\/api$/i.test(normalized) ? normalized : normalized + "/api";
  }

  function resolveApiBaseUrl() {
    if (protocol === "file:") {
      return "http://localhost:5000/api";
    }

    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") {
      return "http://" + (hostname || "localhost") + ":5000/api";
    }

    if ((protocol === "http:" || protocol === "https:") && origin && !STATIC_EXTERNAL_HOST_PATTERN.test(hostname)) {
      return origin + "/api";
    }

    return LEGACY_RENDER_API_BASE;
  }

  function migrateStoredApiBase(expectedApiBase) {
    if (!expectedApiBase || typeof global.localStorage === "undefined") {
      return;
    }

    STORAGE_KEYS.forEach(function migrateKey(key) {
      try {
        var stored = normalizeApiBase(global.localStorage.getItem(key));
        if (!stored || /onrender\.com/i.test(stored)) {
          global.localStorage.setItem(key, expectedApiBase);
        }
      } catch (_error) {
        // Ignore storage failures.
      }
    });
  }

  if (!global.BYOSE_API_BASE_URL && !global.__BYOSE_API_BASE__) {
    global.BYOSE_API_BASE_URL = resolveApiBaseUrl();
  }

  migrateStoredApiBase(normalizeApiBase(global.BYOSE_API_BASE_URL || global.__BYOSE_API_BASE__ || resolveApiBaseUrl()));
})(typeof window !== "undefined" ? window : globalThis);
