(function bootstrapRuntimeApi(global) {
  if (!global || global.BYOSE_API_BASE_URL || global.__BYOSE_API_BASE__) {
    return;
  }

  var STATIC_EXTERNAL_HOST_PATTERN = /(^|\.)github\.io$/i;
  var LEGACY_RENDER_API_BASE = "https://byosesemarket4.onrender.com/api";
  var protocol = String(global.location && global.location.protocol || "").toLowerCase();
  var hostname = String(global.location && global.location.hostname || "").trim().toLowerCase();
  var origin = String(global.location && global.location.origin || "").replace(/\/+$/, "");

  if (protocol === "file:") {
    global.BYOSE_API_BASE_URL = "http://localhost:5000/api";
    return;
  }

  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") {
    global.BYOSE_API_BASE_URL = "http://" + (hostname || "localhost") + ":5000/api";
    return;
  }

  if ((protocol === "http:" || protocol === "https:") && origin && !STATIC_EXTERNAL_HOST_PATTERN.test(hostname)) {
    global.BYOSE_API_BASE_URL = origin + "/api";
    return;
  }

  global.BYOSE_API_BASE_URL = LEGACY_RENDER_API_BASE;
})(typeof window !== "undefined" ? window : globalThis);
