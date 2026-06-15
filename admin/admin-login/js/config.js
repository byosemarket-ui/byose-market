const ADMIN_API_BASE_URL_STORAGE_KEY = "adminApiBaseUrl";
const ADMIN_VALIDATED_API_BASE_URL_STORAGE_KEY = "adminValidatedApiBaseUrl";
const PRODUCTION_API_ORIGIN = "https://byosesemarket4.onrender.com";

function normalizeBaseUrl(value) {
	return String(value || "").trim().replace(/\/+$/, "");
}

function readStoredAdminApiBaseUrl() {
	try {
		return normalizeBaseUrl(globalThis.localStorage.getItem(ADMIN_API_BASE_URL_STORAGE_KEY) || "");
	} catch (_error) {
		return "";
	}
}

function readStoredValidatedAdminApiBaseUrl() {
	try {
		return normalizeBaseUrl(globalThis.localStorage.getItem(ADMIN_VALIDATED_API_BASE_URL_STORAGE_KEY) || "");
	} catch (_error) {
		return "";
	}
}

function stripApiSuffix(value) {
	return normalizeBaseUrl(value).replace(/\/api$/i, "");
}

function isLocalHost(hostname) {
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
}

function resolveApiOrigin() {
	const override = stripApiSuffix(
		globalThis.BYOSE_API_BASE_URL
		|| globalThis.__BYOSE_API_BASE__
		|| readStoredValidatedAdminApiBaseUrl()
		|| readStoredAdminApiBaseUrl()
		|| ""
	);

	if (override) {
		return override;
	}

	const protocol = String(globalThis.location?.protocol || "").toLowerCase();
	const hostname = String(globalThis.location?.hostname || "").trim();

	if (protocol === "file:" || isLocalHost(hostname)) {
		return `http://${hostname || "localhost"}:5000`;
	}

	return PRODUCTION_API_ORIGIN;
}

const API_BASE_URL = resolveApiOrigin();

export default API_BASE_URL;