export const PRODUCTION_SITE_ORIGIN = "https://byosemarket.com";
export const PRODUCTION_API_BASE_URL = "https://byosemarket.com/api";

/** @deprecated Use PRODUCTION_SITE_ORIGIN */
export const PRODUCTION_API_ORIGIN = PRODUCTION_SITE_ORIGIN;

const STORAGE_KEYS = {
  adminApiBaseUrl: "adminApiBaseUrl",
  adminValidatedApiBaseUrl: "adminValidatedApiBaseUrl"
};

const LEGACY_API_HOST_PATTERN = /(?:onrender\.com|localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i;

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

export function isLegacyApiBase(value) {
  const normalized = normalizeApiBaseUrl(value);
  if (!normalized) {
    return true;
  }

  return LEGACY_API_HOST_PATTERN.test(normalized);
}

export function isProductionApiBase(value) {
  const normalized = normalizeApiBaseUrl(value);
  return Boolean(normalized && /byosemarket\.com/i.test(normalized));
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

export function requiresExternalApiBaseUrl(hostname) {
  return /(^|\.)github\.io$/i.test(String(hostname || "").trim().toLowerCase());
}

export function collectApiBaseCandidates() {
  if (typeof window === "undefined") {
    return [PRODUCTION_API_BASE_URL];
  }

  const candidates = [];
  const seen = new Set();

  const addCandidate = (value) => {
    const normalized = normalizeApiBaseUrl(value);
    if (!normalized || seen.has(normalized) || isLegacyApiBase(normalized)) {
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

  const hostname = String(window.location?.hostname || "").trim().toLowerCase();
  const sameOriginApi = resolveSameOriginApiBaseUrl();

  if (sameOriginApi && /byosemarket\.com$/i.test(hostname)) {
    addCandidate(sameOriginApi);
  }

  addCandidate(PRODUCTION_API_BASE_URL);

  const storedValidated = readStorage(STORAGE_KEYS.adminValidatedApiBaseUrl);
  const storedApi = readStorage(STORAGE_KEYS.adminApiBaseUrl);
  if (isProductionApiBase(storedValidated)) {
    addCandidate(storedValidated);
  }
  if (isProductionApiBase(storedApi)) {
    addCandidate(storedApi);
  }

  if (requiresExternalApiBaseUrl(hostname)) {
    addCandidate(PRODUCTION_API_BASE_URL);
  }

  return candidates.length ? candidates : [PRODUCTION_API_BASE_URL];
}

export function migrateLegacyStoredApiBase() {
  if (typeof window === "undefined") {
    return PRODUCTION_API_BASE_URL;
  }

  const targets = [
    window.BYOSE_API_BASE_URL,
    window.__BYOSE_API_BASE__,
    readStorage(STORAGE_KEYS.adminValidatedApiBaseUrl),
    readStorage(STORAGE_KEYS.adminApiBaseUrl)
  ];

  const needsMigration = targets.some((entry) => isLegacyApiBase(entry));
  if (needsMigration || !isProductionApiBase(activeApiBaseUrl)) {
    window.BYOSE_API_BASE_URL = PRODUCTION_API_BASE_URL;
    return persistResolvedApiBaseUrl(PRODUCTION_API_BASE_URL);
  }

  const resolved = normalizeApiBaseUrl(
    window.BYOSE_API_BASE_URL
    || readStorage(STORAGE_KEYS.adminValidatedApiBaseUrl)
    || PRODUCTION_API_BASE_URL
  );
  activeApiBaseUrl = resolved;
  return resolved;
}

export async function probeUploadHealth(apiBase, options = {}) {
  const normalizedBase = normalizeApiBaseUrl(apiBase);
  if (!normalizedBase) {
    return false;
  }

  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 10000));
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
  migrateLegacyStoredApiBase();

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
        `Product image upload API is unavailable on production. Verify ${PRODUCTION_API_BASE_URL}/uploads/health is reachable. Attempted API bases: ${attempted}`
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
  migrateLegacyStoredApiBase();

  if (activeApiBaseUrl && isProductionApiBase(activeApiBaseUrl)) {
    return activeApiBaseUrl;
  }

  for (const candidate of collectApiBaseCandidates()) {
    return candidate;
  }

  return PRODUCTION_API_BASE_URL;
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

  const normalized = isLegacyApiBase(value)
    ? PRODUCTION_API_BASE_URL
    : normalizeApiBaseUrl(value) || PRODUCTION_API_BASE_URL;

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

  window.BYOSE_API_BASE_URL = normalized;

  return normalized;
}

export default {
  PRODUCTION_SITE_ORIGIN,
  PRODUCTION_API_BASE_URL,
  PRODUCTION_API_ORIGIN,
  buildApiUrl,
  buildUploadUrl,
  collectApiBaseCandidates,
  ensureUploadCapableApiBaseUrl,
  isLegacyApiBase,
  isProductionApiBase,
  migrateLegacyStoredApiBase,
  normalizeApiBaseUrl,
  persistResolvedApiBaseUrl,
  probeUploadHealth,
  requiresExternalApiBaseUrl,
  resolveApiBaseUrl,
  resolveApiOrigin,
  stripApiSuffix
};
