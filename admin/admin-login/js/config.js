const ADMIN_API_BASE_URL_STORAGE_KEY = "adminApiBaseUrl";
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

function stripApiSuffix(value) {
	return normalizeBaseUrl(value).replace(/\/api$/i, "");
}

const API_BASE_URL = stripApiSuffix(
	globalThis.BYOSE_API_BASE_URL
	|| globalThis.__BYOSE_API_BASE__
	|| readStoredAdminApiBaseUrl()
	|| PRODUCTION_API_ORIGIN
);

export default API_BASE_URL;