export const PRODUCTION_API_ORIGIN = "https://byosesemarket4.onrender.com";
export const VPS_API_HOST = "153.75.227.160";

const STORAGE_KEYS = {
  adminApiBaseUrl: "adminApiBaseUrl",
  adminValidatedApiBaseUrl: "adminValidatedApiBaseUrl"
};

function normalizeBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function normalizeApiBaseUrl(value) {
  const normalized = normalizeBase(value);
  if (!normalized) {
    return "";
  }

  return /\/api$/i.test(normalized) ? normalized : `${normalized}/api`;
}

export function stripApiSuffix(value) {
  return normalizeBase(value).replace(/\/api$/i, "");
}

function readStorage(key) {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return String(window.localStorage.getItem(key) || "").trim();
  } catch (_error) {
    return "";
  }
}

function isLocalHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
}

export function requiresExternalApiBaseUrl(hostname) {
  return /(^|\.)github\.io$/i.test(String(hostname || "").trim().toLowerCase());
}

function resolveSameOriginApiBaseUrl() {
  if (typeof window === "undefined") {
    return "";
  }

  const protocol = String(window.location?.protocol || "").toLowerCase();
  const origin = normalizeBase(window.location?.origin || "");
  if ((protocol === "http:" || protocol === "https:") && origin) {
    return `${origin}/api`;
  }

  return "";
}

export function resolveApiBaseUrl() {
  if (typeof window === "undefined") {
    return "";
  }

  const candidates = [
    window.BYOSE_API_BASE_URL,
    window.__BYOSE_API_BASE__,
    window.AdminSecurity?.getApiBaseUrl?.(),
    window.AdminConfig?.apiBaseUrl,
    readStorage(STORAGE_KEYS.adminValidatedApiBaseUrl),
    readStorage(STORAGE_KEYS.adminApiBaseUrl)
  ];

  for (const candidate of candidates) {
    const normalized = normalizeApiBaseUrl(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const protocol = String(window.location?.protocol || "").toLowerCase();
  const hostname = String(window.location?.hostname || "").trim();
  const sameOriginApi = resolveSameOriginApiBaseUrl();

  if (protocol === "file:" || isLocalHost(hostname)) {
    return `http://${hostname || "localhost"}:5000/api`;
  }

  if (sameOriginApi && !/(^|\.)github\.io$/i.test(hostname)) {
    return sameOriginApi;
  }

  if (hostname === VPS_API_HOST) {
    return sameOriginApi || `http://${VPS_API_HOST}:5000/api`;
  }

  if (requiresExternalApiBaseUrl(hostname)) {
    return `${PRODUCTION_API_ORIGIN}/api`;
  }

  return sameOriginApi || `${PRODUCTION_API_ORIGIN}/api`;
}

export function resolveApiOrigin() {
  return stripApiSuffix(resolveApiBaseUrl());
}

export function buildApiUrl(path) {
  const apiBase = resolveApiBaseUrl();
  const normalizedPath = String(path || "").trim();

  if (/^https?:/i.test(normalizedPath)) {
    return normalizedPath;
  }

  const withoutApiPrefix = normalizedPath.replace(/^\/api/, "").replace(/^\/+/, "");
  return `${apiBase}/${withoutApiPrefix}`;
}

export function buildUploadUrl(bucket = "products") {
  const apiBase = resolveApiBaseUrl();
  return `${apiBase}/uploads/${encodeURIComponent(String(bucket))}`;
}

export function persistResolvedApiBaseUrl(value) {
  if (typeof window === "undefined") {
    return "";
  }

  const normalized = normalizeApiBaseUrl(value);
  if (!normalized) {
    return "";
  }

  try {
    window.localStorage.setItem(STORAGE_KEYS.adminApiBaseUrl, normalized);
    window.localStorage.setItem(STORAGE_KEYS.adminValidatedApiBaseUrl, normalized);
  } catch (_error) {
    // Ignore storage failures.
  }

  if (window.AdminConfig && typeof window.AdminConfig.setApiBaseUrl === "function") {
    window.AdminConfig.setApiBaseUrl(normalized);
  }

  return normalized;
}

export default {
  PRODUCTION_API_ORIGIN,
  buildApiUrl,
  buildUploadUrl,
  normalizeApiBaseUrl,
  persistResolvedApiBaseUrl,
  requiresExternalApiBaseUrl,
  resolveApiBaseUrl,
  resolveApiOrigin,
  stripApiSuffix
};
