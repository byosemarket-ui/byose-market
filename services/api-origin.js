export const PRODUCTION_API_ORIGIN = "https://byosesemarket4.onrender.com";
export const VPS_API_HOST = "153.75.227.160";
export const DEFAULT_DEV_API_PORT = 5000;

const STORAGE_KEYS = {
  adminApiBaseUrl: "adminApiBaseUrl",
  adminValidatedApiBaseUrl: "adminValidatedApiBaseUrl"
};

let activeApiBaseUrl = "";
let ensureUploadApiBasePromise = null;

function normalizeBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function normalizeApiBaseUrl(value) {
  const normalized = normalizeBase(value).replace(/\/admin$/i, "");
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

export function isLocalDevHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host) {
    return false;
  }

  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") {
    return true;
  }

  return /^(?:192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[0-1])\.)/.test(host);
}

function isLocalHost(hostname) {
  return isLocalDevHost(hostname);
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

export function buildDevApiBaseUrl(hostname = "localhost") {
  const host = String(hostname || "localhost").trim() || "localhost";
  const normalizedHost = host === "0.0.0.0" ? "localhost" : host;
  return `http://${normalizedHost}:${DEFAULT_DEV_API_PORT}/api`;
}

export function collectApiBaseCandidates() {
  if (typeof window === "undefined") {
    return [];
  }

  const candidates = [];
  const seen = new Set();

  const addCandidate = (value) => {
    const normalized = normalizeApiBaseUrl(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    candidates.push(normalized);
  };

  addCandidate(activeApiBaseUrl);
  addCandidate(window.BYOSE_API_BASE_URL);
  addCandidate(window.__BYOSE_API_BASE__);
  addCandidate(window.AdminSecurity?.getApiBaseUrl?.());
  addCandidate(window.AdminConfig?.apiBaseUrl);
  addCandidate(readStorage(STORAGE_KEYS.adminValidatedApiBaseUrl));
  addCandidate(readStorage(STORAGE_KEYS.adminApiBaseUrl));

  const protocol = String(window.location?.protocol || "").toLowerCase();
  const hostname = String(window.location?.hostname || "").trim();
  const sameOriginApi = resolveSameOriginApiBaseUrl();

  if (protocol === "file:" || isLocalDevHost(hostname)) {
    addCandidate(buildDevApiBaseUrl(hostname));
  }

  if (sameOriginApi && !requiresExternalApiBaseUrl(hostname)) {
    addCandidate(sameOriginApi);
  }

  if (hostname === VPS_API_HOST) {
    addCandidate(sameOriginApi);
    addCandidate(buildDevApiBaseUrl(VPS_API_HOST));
  }

  if (requiresExternalApiBaseUrl(hostname)) {
    addCandidate(`${PRODUCTION_API_ORIGIN}/api`);
  }

  addCandidate(sameOriginApi);
  addCandidate(`${PRODUCTION_API_ORIGIN}/api`);

  return candidates;
}

export async function probeUploadHealth(apiBase, options = {}) {
  const normalizedBase = normalizeApiBaseUrl(apiBase);
  if (!normalizedBase) {
    return false;
  }

  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 8000));
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller
    ? window.setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const response = await fetch(`${normalizedBase}/uploads/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller?.signal
    });

    if (!response.ok) {
      return false;
    }

    const payload = await response.json().catch(() => null);
    return Boolean(payload?.success);
  } catch (_error) {
    return false;
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
}

export async function ensureUploadCapableApiBaseUrl(options = {}) {
  if (!ensureUploadApiBasePromise || options.force) {
    ensureUploadApiBasePromise = (async () => {
      const candidates = collectApiBaseCandidates();
      const failures = [];

      for (const candidate of candidates) {
        const healthy = await probeUploadHealth(candidate, options);
        if (healthy) {
          activeApiBaseUrl = candidate;
          persistResolvedApiBaseUrl(candidate);
          if (typeof window !== "undefined") {
            window.BYOSE_API_BASE_URL = candidate;
          }
          return candidate;
        }

        failures.push(candidate);
      }

      const attempted = failures.slice(0, 4).join(", ") || "none";
      throw new Error(
        `Product image upload API is unavailable. POST /api/uploads/products returned 404 or the backend is offline. Start the API with "npm start" and verify GET /api/uploads/health succeeds. Attempted API bases: ${attempted}`
      );
    })();
  }

  try {
    return await ensureUploadApiBasePromise;
  } catch (error) {
    ensureUploadApiBasePromise = null;
    throw error;
  }
}

export function resolveApiBaseUrl() {
  if (activeApiBaseUrl) {
    return activeApiBaseUrl;
  }

  if (typeof window === "undefined") {
    return "";
  }

  for (const candidate of collectApiBaseCandidates()) {
    return candidate;
  }

  return `${PRODUCTION_API_ORIGIN}/api`;
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

  activeApiBaseUrl = normalized;

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
  collectApiBaseCandidates,
  ensureUploadCapableApiBaseUrl,
  normalizeApiBaseUrl,
  persistResolvedApiBaseUrl,
  probeUploadHealth,
  requiresExternalApiBaseUrl,
  resolveApiBaseUrl,
  resolveApiOrigin,
  stripApiSuffix
};
