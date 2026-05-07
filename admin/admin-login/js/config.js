const API_BASE_URL = String(globalThis.BYOSE_API_BASE_URL || globalThis.__BYOSE_API_BASE__ || "https://byosesemarket4.onrender.com").replace(/\/+$/, "");

export default API_BASE_URL;