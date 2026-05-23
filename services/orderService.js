function asArray(value) {
  return Array.isArray(value) ? value : [];
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

  const explicit = normalizeBase(window.BYOSE_API_BASE_URL || window.__BYOSE_API_BASE__ || window.AdminConfig?.apiBaseUrl || "");
  if (explicit) {
    return explicit;
  }

  const protocol = String(window.location?.protocol || "").toLowerCase();
  const hostname = String(window.location?.hostname || "").trim();

  if (protocol === "file:" || isLocalHost(hostname)) {
    return `http://${hostname || "localhost"}:5000`;
  }

  if (shouldUseProductionApi(hostname)) {
    return "https://byosesemarket4.onrender.com";
  }

  return normalizeBase(window.location?.origin || "");
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
    throw new Error(payload?.message || "Order service request failed.");
  }

  return payload;
}

export async function listOrders(limit = 100) {
  const payload = await request(`/api/admin/orders?limit=${encodeURIComponent(String(Math.max(1, Number(limit || 100))))}`, {
    method: "GET",
    requiresAdmin: true
  });

  return asArray(payload?.orders);
}

export async function createOrder(orderPayload) {
  const payload = await request("/api/orders", {
    method: "POST",
    body: orderPayload || {},
    requiresAuth: false
  });

  return payload?.order || null;
}

export async function updateOrderStatus(orderId, status) {
  const hasAdminToken = Boolean(getAdminToken());
  const path = hasAdminToken
    ? `/api/admin/orders/${encodeURIComponent(String(orderId || ""))}/status`
    : `/api/orders/${encodeURIComponent(String(orderId || ""))}/status`;
  const payload = await request(path, {
    method: "PUT",
    body: { status },
    requiresAdmin: hasAdminToken,
    requiresAuth: !hasAdminToken
  });

  return payload?.order || null;
}

export async function listProductReviews(_productCatalogId) {
  return [];
}

export async function createProductReview(_reviewPayload) {
  throw new Error("Product review persistence has not been migrated to the backend API yet.");
}

export default {
  listOrders,
  createOrder,
  updateOrderStatus,
  listProductReviews,
  createProductReview
};