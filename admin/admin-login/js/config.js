const ADMIN_API_BASE_URL_STORAGE_KEY = "adminApiBaseUrl";
const ADMIN_VALIDATED_API_BASE_URL_STORAGE_KEY = "adminValidatedApiBaseUrl";
const PRODUCTION_API_ORIGIN = "https://byosemarket.com";
const PRODUCTION_API_BASE_URL = "https://byosemarket.com/api";
const LEGACY_API_PATTERN = /(?:onrender\.com|localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i;

function normalizeBaseUrl(value) {
	return String(value || "").trim().replace(/\/+$/, "");
}

function normalizeApiBaseUrl(value) {
	const normalized = normalizeBaseUrl(value).replace(/\/admin$/i, "");
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
		return normalizeApiBaseUrl(globalThis.localStorage.getItem(ADMIN_API_BASE_URL_STORAGE_KEY) || "");
	} catch (_error) {
		return "";
	}
}

function readStoredValidatedAdminApiBaseUrl() {
	try {
		return normalizeApiBaseUrl(globalThis.localStorage.getItem(ADMIN_VALIDATED_API_BASE_URL_STORAGE_KEY) || "");
	} catch (_error) {
		return "";
	}
}

function resolveApiBaseUrlFromEnvironment() {
	const hostname = String(globalThis.location?.hostname || "").trim().toLowerCase();
	const origin = normalizeBaseUrl(globalThis.location?.origin || "");
	if (origin && /byosemarket\.com$/i.test(hostname)) {
		return `${origin}/api`;
	}

	return PRODUCTION_API_BASE_URL;
}

function migrateLegacyStoredApiBase() {
	const expectedApiBase = resolveApiBaseUrlFromEnvironment();

	[ADMIN_API_BASE_URL_STORAGE_KEY, ADMIN_VALIDATED_API_BASE_URL_STORAGE_KEY].forEach((key) => {
		try {
			const stored = normalizeApiBaseUrl(globalThis.localStorage.getItem(key));
			if (!stored || isLegacyApiBase(stored)) {
				globalThis.localStorage.setItem(key, expectedApiBase);
			}
		} catch (_error) {
			// Ignore storage failures.
		}
	});

	const runtimeOverride = normalizeApiBaseUrl(globalThis.BYOSE_API_BASE_URL || globalThis.__BYOSE_API_BASE__ || "");
	if (!runtimeOverride || isLegacyApiBase(runtimeOverride)) {
		globalThis.BYOSE_API_BASE_URL = expectedApiBase;
	}
}

function resolveApiBaseUrl() {
	const candidates = [
		globalThis.BYOSE_API_BASE_URL,
		globalThis.__BYOSE_API_BASE__,
		readStoredValidatedAdminApiBaseUrl(),
		readStoredAdminApiBaseUrl()
	];

	for (const candidate of candidates) {
		const normalized = normalizeApiBaseUrl(candidate);
		if (normalized && !isLegacyApiBase(normalized)) {
			return normalized;
		}
	}

	return resolveApiBaseUrlFromEnvironment();
}

migrateLegacyStoredApiBase();

const API_BASE_URL = resolveApiBaseUrl();

export default API_BASE_URL;
export { PRODUCTION_API_BASE_URL };
