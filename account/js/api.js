// ===============================
// 🌐 API SYSTEM (PRO)
// ===============================

// ===============================
// 📦 BASE URL (production VPS)
// ===============================
const PRODUCTION_API_ORIGIN = "https://byosemarket.com";

function normalizeBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function isLocalHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
}

function shouldUseProductionApi(hostname) {
  return /(^|\.)(github\.io|byosemarket\.com)$/i.test(String(hostname || ""));
}

function resolveApiOrigin() {
  const explicit = normalizeBase(window.BYOSE_API_BASE_URL || window.__BYOSE_API_BASE__ || "");
  if (explicit) {
    return explicit;
  }

  const protocol = String(window.location?.protocol || "").toLowerCase();
  const hostname = String(window.location?.hostname || "").trim();

  if (protocol === "file:" || isLocalHost(hostname)) {
    return `http://${hostname || "localhost"}:5000`;
  }

  if (shouldUseProductionApi(hostname)) {
    return PRODUCTION_API_ORIGIN;
  }

  return normalizeBase(window.location?.origin || "");
}

const BASE_URL = resolveApiOrigin();

try {
  if (!window.__BYOSE_API_BASE__) {
    window.__BYOSE_API_BASE__ = BASE_URL;
  }
} catch (error) {}

// ===============================
// 🔁 GENERIC REQUEST
// ===============================
async function request(endpoint, method = "GET", data = null) {

  if (!BASE_URL) {
    return { success: false, message: "Static hosting mode: no API base configured." };
  }

  try {

    const options = {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      }
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(`${BASE_URL}${endpoint}`, options);

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const result = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : null;

    if (!response.ok) {
      throw new Error(result?.message || `Request failed with status ${response.status}`);
    }

    if (result === null) {
      throw new Error("Invalid API response");
    }

    return result;

  } catch (error) {
    console.error("API Error:", error);
    return { success: false, message: error.message };
  }

}

// ===============================
// 📥 GET
// ===============================
function apiGet(endpoint) {
  return request(endpoint, "GET");
}

// ===============================
// 📤 POST
// ===============================
function apiPost(endpoint, data) {
  return request(endpoint, "POST", data);
}

// ===============================
// ✏️ PUT
// ===============================
function apiPut(endpoint, data) {
  return request(endpoint, "PUT", data);
}

// ===============================
// ❌ DELETE
// ===============================
function apiDelete(endpoint) {
  return request(endpoint, "DELETE");
}

try {
  if (!window.__BYOSE_API_BASE__) {
    window.__BYOSE_API_BASE__ = BASE_URL;
  }
} catch (error) {}