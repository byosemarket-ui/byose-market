function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

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
  if (typeof window === "undefined") {
    return "";
  }

  const PRODUCTION_SITE_ORIGIN = "https://byosemarket.com";
  const LEGACY_API_PATTERN = /(?:onrender\.com|localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i;

  const explicit = normalizeBase(window.BYOSE_API_BASE_URL || window.__BYOSE_API_BASE__ || window.AdminConfig?.apiBaseUrl || "");
  if (explicit && !LEGACY_API_PATTERN.test(explicit)) {
    return explicit.replace(/\/api$/i, "");
  }

  const hostname = String(window.location?.hostname || "").trim().toLowerCase();
  const origin = normalizeBase(window.location?.origin || "");
  if (origin && /byosemarket\.com$/i.test(hostname)) {
    return origin;
  }

  return PRODUCTION_SITE_ORIGIN;
}

function buildApiUrl(path) {
  const base = resolveApiOrigin();
  const normalizedPath = `/${String(path || "").replace(/^\/+/, "")}`;
  return `${base}${normalizedPath}`;
}

function getUserToken() {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    if (window.authService && typeof window.authService.getToken === "function") {
      return String(window.authService.getToken() || "").trim();
    }

    return String(window.localStorage.getItem("bm_auth_token") || "").trim();
  } catch (_error) {
    return "";
  }
}

function getAdminToken() {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return String(window.localStorage.getItem("adminToken") || "").trim();
  } catch (_error) {
    return "";
  }
}

async function request(path, options = {}) {
  const token = options.requiresAdmin ? getAdminToken() : options.requiresAuth ? getUserToken() : "";
  const response = await fetch(buildApiUrl(path), {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || "User service request failed.");
  }

  return payload;
}

function normalizeCartItems(cart) {
  return asArray(cart?.items).map((item) => ({
    ...item,
    user_id: normalizeText(cart?.userId || cart?.user || ""),
    product_id: normalizeText(item?.product?._id || item?.productId || item?.product || ""),
    quantity: Math.max(1, Number(item?.quantity || 1) || 1),
    product: item?.product || null
  }));
}

export async function getUsers(limit = 100) {
  const payload = await request(`/api/admin/customers?limit=${encodeURIComponent(String(Math.max(1, Number(limit || 100))))}`, {
    method: "GET",
    requiresAdmin: true
  });

  return asArray(payload?.customers);
}

export async function upsertUser(userPayload) {
  const identifier = normalizeText(userPayload?.id || userPayload?.email || userPayload?.phone);
  if (!identifier) {
    throw new Error("User upsert now requires an existing backend customer identifier.");
  }

  const payload = await request(`/api/admin/customers/${encodeURIComponent(identifier)}`, {
    method: "PUT",
    body: userPayload || {},
    requiresAdmin: true
  });

  return payload?.customer || null;
}

export async function listCartItems(_userId) {
  const payload = await request("/api/cart", {
    method: "GET",
    requiresAuth: true
  });

  return normalizeCartItems(payload?.cart);
}

export async function upsertCartItem(cartItemPayload) {
  const payload = await request("/api/cart/add", {
    method: "POST",
    body: cartItemPayload || {},
    requiresAuth: true
  });

  return payload?.cart || null;
}

export async function recordVisitor(visitorPayload) {
  const payload = await request("/api/activity", {
    method: "POST",
    body: visitorPayload || {}
  });

  return payload?.activity || null;
}

export default {
  getUsers,
  upsertUser,
  listCartItems,
  upsertCartItem,
  recordVisitor
};