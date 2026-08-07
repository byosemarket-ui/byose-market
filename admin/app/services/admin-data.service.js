import * as api from "../core/api.js";
import { publishRealtime } from "../core/realtime-adapter.js";
import productCatalogService from "../../../services/centralized-products.service.js";
import { publishHeroSlidesBump } from "../../../../services/hero-slides.service.js";

const CACHE_PREFIX = "byose_admin_api_cache_v2";
const DEFAULT_RETRY_COUNT = 2;
const RETRY_DELAY_MS = 450;
const INTELLIGENCE_SCOPE = "intelligence";
const DEFAULT_SYNC_INTERVAL_MS = 25000;
const MAX_SYNC_INTERVAL_MS = 180000;
const TAB_SYNC_DEBOUNCE_MS = 1400;
const IN_MEMORY_CACHE_TTL_MS = 15000;
const MAX_ORDERS_ITEMS = 400;
const MAX_CUSTOMERS_ITEMS = 400;
const MAX_PRODUCTS_ITEMS = 500;
const MAX_ACTIVITY_ITEMS = 200;
const MAX_MESSAGES_ITEMS = 200;
const MAX_CARTS_ITEMS = 300;
const MAX_HERO_SLIDES_ITEMS = 200;
const STOREFRONT_CATALOG_STORAGE_KEY = "byose_market_products_catalog_v1";

export const ADMIN_SYNC_EVENT = "byose:admin-sync-updated";

let lastKnownIntelligence = null;
let syncTimer = null;
let syncStarted = false;
let syncIntervalMs = DEFAULT_SYNC_INTERVAL_MS;
let syncFailureStreak = 0;
let inFlightSyncPromise = null;
let pendingVisibilityRefresh = null;
const scopeMemoryCache = new Map();
const scopeInFlight = new Map();
let removeProductCatalogSync = null;

function ensureProductCatalogSync() {
  if (removeProductCatalogSync || typeof window === "undefined") {
    return;
  }

  removeProductCatalogSync = productCatalogService.subscribeToProducts((products) => {
    const normalized = syncLocalProductCaches(products, { emit: false });
    emitSync("products", normalized);
    publishGlobalProductSync(normalized);
  }, (error) => {
    console.error("[Admin Data] Product catalog sync failed:", error);
  });

  window.addEventListener("beforeunload", () => {
    if (typeof removeProductCatalogSync === "function") {
      removeProductCatalogSync();
      removeProductCatalogSync = null;
    }
  }, { once: true });
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function normalizeStatus(status) {
  const value = normalizeText(status, "Pending").toLowerCase();
  if (value.includes("deliver") || value.includes("complete")) return "Delivered";
  if (value.includes("ship")) return "Shipping";
  if (value.includes("confirm") || value.includes("process") || value.includes("payment")) return "Confirmed";
  if (value.includes("cancel")) return "Cancelled";
  if (value.includes("return")) return "Returned";
  return "Pending";
}

function normalizePriorityValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.floor(value);
    return normalized === 2 ? 2 : normalized === 1 ? 1 : 0;
  }

  const normalizedText = normalizeText(value).toLowerCase();
  if (!normalizedText || normalizedText === "normal") return 0;
  if (normalizedText === "top") return 1;
  if (normalizedText === "featured") return 2;

  const parsed = Number(normalizedText);
  if (Number.isFinite(parsed)) {
    const normalized = Math.floor(parsed);
    return normalized === 2 ? 2 : normalized === 1 ? 1 : 0;
  }

  return 0;
}

function cacheKey(scope) {
  return `${CACHE_PREFIX}:${scope}`;
}

function readCache(scope) {
  try {
    const raw = window.localStorage.getItem(cacheKey(scope));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed;
  } catch (_error) {
    return null;
  }
}

function readJsonStorage(key, fallbackValue) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallbackValue;
    }

    return JSON.parse(raw);
  } catch (_error) {
    return fallbackValue;
  }
}

function readMemoryCache(scope, ttlMs = IN_MEMORY_CACHE_TTL_MS) {
  const entry = scopeMemoryCache.get(scope);
  if (!entry) {
    return null;
  }

  if (Date.now() - Number(entry.cachedAt || 0) > Math.max(500, Number(ttlMs || IN_MEMORY_CACHE_TTL_MS))) {
    scopeMemoryCache.delete(scope);
    return null;
  }

  return entry.payload;
}

function writeMemoryCache(scope, payload) {
  scopeMemoryCache.set(scope, {
    cachedAt: Date.now(),
    payload
  });
}

function getCachedScopePayload(scope, options = {}) {
  const memoryPayload = readMemoryCache(scope, options?.cacheTtlMs);
  if (memoryPayload) {
    return memoryPayload;
  }

  const persisted = readCache(scope);
  if (persisted?.payload) {
    writeMemoryCache(scope, persisted.payload);
    return persisted.payload;
  }

  return null;
}

function capArray(items, maxItems) {
  const safeItems = asArray(items);
  const cap = Math.max(1, Number(maxItems || safeItems.length || 1));
  return safeItems.length <= cap ? safeItems : safeItems.slice(0, cap);
}

function writeCache(scope, payload) {
  try {
    window.localStorage.setItem(cacheKey(scope), JSON.stringify({
      syncedAt: new Date().toISOString(),
      payload
    }));
  } catch (_error) {
    // Ignore cache write failures.
  }
}

function writeJsonStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (_error) {
    // Ignore storage write failures.
  }
}

function emitSync(scope, payload) {
  const event = {
    scope,
    syncedAt: new Date().toISOString(),
    payload
  };

  window.dispatchEvent(new CustomEvent(ADMIN_SYNC_EVENT, {
    detail: {
      ...event
    }
  }));

  publishRealtime(event);
}

function getCurrentProductCache() {
  const adminProducts = asArray(getCachedScopePayload("products") || []).map(normalizeProduct);
  const storefrontProducts = asArray(readJsonStorage(STOREFRONT_CATALOG_STORAGE_KEY, [])).map(normalizeProduct);
  const merged = new Map();

  storefrontProducts.forEach((product) => {
    const key = normalizeText(product?.id || product?.catalogId || product?.sku);
    if (key) {
      merged.set(key, product);
    }
  });

  adminProducts.forEach((product) => {
    const key = normalizeText(product?.id || product?.catalogId || product?.sku);
    if (key) {
      merged.set(key, product);
    }
  });

  return Array.from(merged.values());
}

function syncLocalProductCaches(products, options = {}) {
  const normalized = capArray(asArray(products).map(normalizeProduct), options?.maxItems || MAX_PRODUCTS_ITEMS);
  writeCache("products", normalized);
  writeMemoryCache("products", normalized);
  writeJsonStorage(STOREFRONT_CATALOG_STORAGE_KEY, normalized);

  if (options?.emit !== false) {
    emitSync("products", normalized);
    publishGlobalProductSync(normalized);
  }

  return normalized;
}

function isSharedProductApiUnavailable(error) {
  const status = Number(error?.status || error?.cause?.status || 0);
  const message = String(error?.message || error?.cause?.message || "").toLowerCase();

  if (status === 401 || status === 403) {
    return false;
  }

  return status === 404
    || status === 0
    || status === 503
    || /404|network|fetch|request failed|timed out|unable to sync|failed to fetch|backend request failed|operation_timeout/.test(message);
}

function createSharedProductPersistenceError(action, error) {
  const status = Number(error?.status || error?.cause?.status || 0);
  const code = String(error?.code || error?.cause?.code || "").trim();

  if (status === 401 || code === "ADMIN_TOKEN_MISSING" || code === "ADMIN_TOKEN_EXPIRED") {
    const authError = new Error("Admin session expired. Please sign in again and retry saving the product.");
    authError.status = status;
    authError.code = code || "ADMIN_AUTH_REQUIRED";
    authError.cause = error;
    return authError;
  }

  if (status === 403) {
    const deniedError = new Error("You do not have permission to save products in this environment.");
    deniedError.status = status;
    deniedError.code = code || "ADMIN_ACCESS_DENIED";
    deniedError.cause = error;
    return deniedError;
  }

  if (status === 503 || code === "DATABASE_UNAVAILABLE") {
    const dbError = new Error("The database is not ready. Start the backend server and ensure SQLite is configured, then try again.");
    dbError.status = status;
    dbError.code = code || "DATABASE_UNAVAILABLE";
    dbError.cause = error;
    return dbError;
  }

  if (!isSharedProductApiUnavailable(error)) {
    return error;
  }

  const normalized = new Error(`Product ${action} failed because the product API is unavailable. Verify the backend server is running and reachable.`);
  normalized.status = status;
  normalized.code = "PRODUCT_SYNC_UNAVAILABLE";
  normalized.cause = error;
  return normalized;
}

function upsertProductIntoLocalCaches(productData) {
  const normalizedProduct = normalizeProduct(productData);
  const currentProducts = getCurrentProductCache();
  syncLocalProductCaches([...currentProducts.filter((product) => Number(product?.id) !== Number(normalizedProduct.id)), normalizedProduct], { emit: false });
  return normalizedProduct;
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function withRetry(label, action, attempts = DEFAULT_RETRY_COUNT) {
  let lastError = null;

  for (let index = 0; index <= attempts; index += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (index >= attempts) {
        break;
      }

      await wait(RETRY_DELAY_MS * (index + 1));
    }
  }

  const wrapped = new Error(lastError?.message || `Request failed for ${label}`);
  wrapped.cause = lastError;
  wrapped.scope = label;
  throw wrapped;
}

function monthLabel(date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" }).format(date);
}

function dayLabel(date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function normalizeDate(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeOrder(order) {
  const status = normalizeStatus(order?.status || order?.orderStatus || order?.paymentStatus);
  const total = toNumber(order?.totalAmount ?? order?.totalPrice ?? order?.total ?? order?.amount);
  const items = asArray(order?.items || order?.products).map((item) => {
    const attrs = item?.attributes && typeof item.attributes === "object" ? item.attributes : {};
    return {
      productId: normalizeText(item?.productId || item?.id),
      productName: normalizeText(item?.productName || item?.name || "Product"),
      quantity: toNumber(item?.quantity || item?.qty || 1),
      price: toNumber(item?.price),
      image: normalizeText(item?.image || item?.colorImage || attrs.colorImage),
      color: normalizeText(item?.color || item?.colorName || attrs.Color),
      size: normalizeText(item?.size || item?.sizeLabel || attrs.Size),
      sku: normalizeText(item?.sku || item?.variantSku || attrs.SKU),
      category: normalizeText(item?.category || attrs.Category),
      productUrl: normalizeText(item?.productUrl || item?.productLink || attrs.productUrl || attrs.productLink)
    };
  });

  return {
    id: normalizeText(order?.id || order?.orderId || order?._id),
    orderId: normalizeText(order?.orderId || order?.id || order?._id),
    status,
    total,
    subtotal: toNumber(order?.subtotal),
    deliveryFee: toNumber(order?.deliveryFee ?? order?.shippingFee),
    codFee: toNumber(order?.codFee),
    date: order?.date || order?.createdAt || new Date().toISOString(),
    customerName: normalizeText(order?.customerName || order?.customer?.name || order?.customer || "Guest"),
    customerEmail: normalizeText(order?.customerEmail || order?.userEmail || order?.customer?.email),
    customerPhone: normalizeText(order?.customerPhone || order?.phoneNumber || order?.customer?.phone),
    paymentMethod: normalizeText(order?.paymentMethod || order?.payment?.method),
    paymentMethodLabel: normalizeText(order?.paymentMethodLabel || order?.payment?.methodLabel || (order?.paymentMethod === "cod" ? "Cash on Delivery" : order?.paymentMethod)),
    paymentStatus: normalizeText(order?.paymentStatus || order?.payment?.status || status),
    paymentStatusLabel: normalizeText(order?.paymentStatusLabel || order?.payment?.statusLabel),
    deliveryMethod: normalizeText(order?.deliveryMethod),
    deliveryLabel: normalizeText(order?.deliveryLabel),
    shippingAddress: order?.shippingAddress && typeof order.shippingAddress === "object" ? order.shippingAddress : {},
    fullAddress: order?.fullAddress && typeof order.fullAddress === "object" ? order.fullAddress : {},
    gpsLocation: order?.gpsLocation && typeof order.gpsLocation === "object" ? order.gpsLocation : {},
    itemsCount: items.length,
    items,
    products: items
  };
}

function normalizeCustomer(customer) {
  return {
    id: normalizeText(customer?.id || customer?._id),
    name: normalizeText(customer?.name || "Unnamed"),
    email: normalizeText(customer?.email).toLowerCase(),
    phone: normalizeText(customer?.phone),
    status: normalizeText(customer?.status || "active").toLowerCase(),
    verified: Boolean(customer?.verified),
    joinedAt: customer?.joinedAt || customer?.createdAt || new Date().toISOString(),
    lastLoginAt: customer?.lastLoginAt || "",
    totalOrders: toNumber(customer?.totalOrders),
    totalSpent: toNumber(customer?.totalSpent),
    lastOrderDate: customer?.lastOrderDate || "",
    orders: asArray(customer?.orders)
  };
}

function normalizeHeroSlide(slide) {
  const status = normalizeText(slide?.status || "active").toLowerCase() === "inactive" ? "inactive" : "active";
  return {
    id: normalizeText(slide?.id || slide?.slideId || slide?._id),
    slideId: normalizeText(slide?.slideId || slide?.id || slide?._id),
    title: normalizeText(slide?.title),
    subtitle: normalizeText(slide?.subtitle),
    buttonText: normalizeText(slide?.buttonText),
    buttonLink: normalizeText(slide?.buttonLink),
    imageUrl: normalizeText(slide?.imageUrl),
    imagePath: normalizeText(slide?.imagePath),
    displayOrder: toNumber(slide?.displayOrder),
    status,
    createdAt: slide?.createdAt || new Date().toISOString(),
    updatedAt: slide?.updatedAt || slide?.createdAt || new Date().toISOString(),
    meta: asObject(slide?.meta)
  };
}

function normalizeProduct(product) {
  return {
    ...(product && typeof product === "object" ? product : {}),
    id: normalizeText(product?.id || product?.catalogId || product?._id),
    catalogId: toNumber(product?.catalogId || product?.id),
    name: normalizeText(product?.name || product?.title || "Product"),
    title: normalizeText(product?.title || product?.name || "Product"),
    description: normalizeText(product?.description || product?.shortDescription),
    shortDescription: normalizeText(product?.shortDescription || product?.description),
    longDescription: asArray(product?.longDescription),
    badge: normalizeText(product?.badge),
    category: normalizeText(product?.category || "general").toLowerCase(),
    price: toNumber(product?.price),
    oldPrice: toNumber(product?.oldPrice),
    stock: toNumber(product?.stock),
    gallery: asArray(product?.gallery),
    highlights: asArray(product?.highlights),
    trust: asArray(product?.trust),
    specs: asArray(product?.specs),
    attributes: asArray(product?.attributes),
    variants: asObject(product?.variants),
    visibility: normalizeText(product?.visibility || "both").toLowerCase(),
    sku: normalizeText(product?.sku || product?.catalogId || product?.id),
    productCode: normalizeText(product?.productCode || product?.catalogId || product?.id),
    brand: normalizeText(product?.brand),
    costPrice: toNumber(product?.costPrice),
    taxRate: toNumber(product?.taxRate),
    taxIncluded: Boolean(product?.taxIncluded),
    metaTitle: normalizeText(product?.metaTitle || product?.title),
    metaDescription: normalizeText(product?.metaDescription || product?.shortDescription),
    slug: normalizeText(product?.slug),
    tags: asArray(product?.tags),
    metadata: asObject(product?.metadata),
    summary: normalizeText(product?.summary || product?.description || product?.shortDescription),
    status: normalizeText(product?.status || "draft").toLowerCase(),
    priority: normalizePriorityValue(product?.priority),
    orderIndex: toNumber(product?.orderIndex),
        highlightTag: normalizeText(product?.highlightTag).toLowerCase(),
    mainImage: normalizeText(product?.mainImage || product?.image),
    image: normalizeText(product?.image || product?.mainImage),
    mainImageStoragePath: normalizeText(product?.mainImageStoragePath || product?.imageStoragePath),
    galleryStoragePaths: asArray(product?.galleryStoragePaths).map((entry) => normalizeText(entry)),
    url: normalizeText(product?.url),
    page: normalizeText(product?.page || "product-details1.html"),

    updatedAt: product?.updatedAt || product?.createdAt || new Date().toISOString(),
    createdAt: product?.createdAt || new Date().toISOString()
  };
}

function normalizeActivityEntry(activity) {
  return {
    id: normalizeText(activity?.id || activity?.clientActivityId || activity?._id),
    event: normalizeText(activity?.event || activity?.eventType || "activity"),
    type: normalizeText(activity?.eventType || activity?.type || "activity"),
    level: normalizeText(activity?.level || "info"),
    path: normalizeText(activity?.path),
    city: normalizeText(activity?.city),
    country: normalizeText(activity?.country),
    device: normalizeText(activity?.device),
    detail: asObject(activity?.detail),
    createdAt: activity?.createdAt || activity?.updatedAt || new Date().toISOString(),
    timestamp: activity?.createdAt || activity?.updatedAt || new Date().toISOString()
  };
}

function buildMonthlyRevenueSeries(orders) {
  const map = new Map();
  const now = new Date();

  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    map.set(monthLabel(date), 0);
  }

  orders.forEach((order) => {
    const date = normalizeDate(order.date);
    if (!date) {
      return;
    }

    const key = monthLabel(new Date(date.getFullYear(), date.getMonth(), 1));
    if (!map.has(key)) {
      return;
    }

    map.set(key, toNumber(map.get(key)) + toNumber(order.total));
  });

  return Array.from(map.entries()).map(([label, total]) => ({ label, total }));
}

function buildCustomerGrowthSeries(customers) {
  const map = new Map();
  const now = new Date();

  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    map.set(monthLabel(date), 0);
  }

  customers.forEach((customer) => {
    const date = normalizeDate(customer.joinedAt);
    if (!date) {
      return;
    }

    const key = monthLabel(new Date(date.getFullYear(), date.getMonth(), 1));
    if (!map.has(key)) {
      return;
    }

    map.set(key, toNumber(map.get(key)) + 1);
  });

  let running = 0;
  return Array.from(map.entries()).map(([label, joined]) => {
    running += toNumber(joined);
    return {
      label,
      joined: toNumber(joined),
      cumulative: running
    };
  });
}

function buildVisitorSeries(activityEntries) {
  const map = new Map();
  const now = new Date();

  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - offset);
    map.set(dayLabel(date), 0);
  }

  activityEntries.forEach((entry) => {
    const date = normalizeDate(entry.createdAt || entry.timestamp);
    if (!date) {
      return;
    }

    const key = dayLabel(date);
    if (!map.has(key)) {
      return;
    }

    map.set(key, toNumber(map.get(key)) + 1);
  });

  return Array.from(map.entries()).map(([label, total]) => ({ label, total }));
}

function buildPerformanceMetrics(orders, customers, visitors) {
  const revenue = orders.reduce((sum, order) => sum + toNumber(order.total), 0);
  const orderCount = orders.length;
  const visitorsCount = visitors.length;
  const averageOrderValue = orderCount ? revenue / orderCount : 0;
  const conversionRate = visitorsCount ? (orderCount / visitorsCount) * 100 : 0;

  return {
    revenue,
    orderCount,
    visitorsCount,
    averageOrderValue,
    conversionRate,
    customerCount: customers.length
  };
}

function computeDataFreshness(syncedAt) {
  const synced = new Date(syncedAt || 0).getTime();
  if (!Number.isFinite(synced) || synced <= 0) {
    return {
      staleSeconds: 0,
      staleLabel: "just now"
    };
  }

  const staleSeconds = Math.max(0, Math.floor((Date.now() - synced) / 1000));
  if (staleSeconds < 60) {
    return { staleSeconds, staleLabel: `${staleSeconds}s ago` };
  }

  const minutes = Math.floor(staleSeconds / 60);
  if (minutes < 60) {
    return { staleSeconds, staleLabel: `${minutes}m ago` };
  }

  const hours = Math.floor(minutes / 60);
  return { staleSeconds, staleLabel: `${hours}h ago` };
}

function normalizeMessage(message) {
  return {
    id: normalizeText(message?.id || message?.messageId || message?._id),
    messageId: normalizeText(message?.messageId || message?.id || message?._id),
    status: normalizeText(message?.status || "New"),
    source: normalizeText(message?.source || "contact-form"),
    createdAt: message?.createdAt || message?.updatedAt || new Date().toISOString()
  };
}

function normalizeCart(cart) {
  const items = asArray(cart?.items).map((item) => {
    const quantity = toNumber(item?.quantity);
    const price = toNumber(item?.price);
    return {
      productId: normalizeText(item?.productId || item?.id),
      catalogId: toNumber(item?.catalogId),
      name: normalizeText(item?.name || "Product"),
      quantity,
      price,
      stock: toNumber(item?.stock),
      image: normalizeText(item?.image),
      total: toNumber(item?.total || (quantity * price))
    };
  });

  const itemCount = toNumber(cart?.itemCount || items.reduce((sum, item) => sum + toNumber(item.quantity), 0));
  const estimatedTotal = toNumber(cart?.estimatedTotal || items.reduce((sum, item) => sum + toNumber(item.total), 0));

  return {
    id: normalizeText(cart?.id || cart?._id),
    userId: normalizeText(cart?.userId || cart?.user?.id || cart?.user?._id),
    userName: normalizeText(cart?.userName || cart?.user?.name || "Customer"),
    userEmail: normalizeText(cart?.userEmail || cart?.user?.email),
    userPhone: normalizeText(cart?.userPhone || cart?.user?.phone),
    itemCount,
    estimatedTotal,
    items,
    createdAt: cart?.createdAt || new Date().toISOString(),
    updatedAt: cart?.updatedAt || cart?.createdAt || new Date().toISOString()
  };
}

function deriveMonitoring({ snapshot, orders, customers, products, activity, messages, carts, hasApiData }) {
  const stats = asObject(snapshot?.stats);
  const cartsList = asArray(carts);
  const snapshotSyncedAt = snapshot?.syncedAt || null;
  const freshness = computeDataFreshness(snapshotSyncedAt || new Date().toISOString());

  const pendingOrders = orders.filter((order) => String(order.status || "").toLowerCase().includes("pending")).length;
  const completedOrders = orders.filter((order) => {
    const status = String(order.status || "").toLowerCase();
    return status.includes("deliver") || status.includes("complete");
  }).length;

  const ordersCount = Number(stats.ordersCount || stats.orders || orders.length || 0);
  const productsCount = Number(stats.productsCount || stats.products || products.length || 0);
  const customersCount = Number(stats.customersCount || stats.customers || customers.length || 0);
  const visitsCount = Number(stats.visitsCount || stats.visitors || activity.filter((entry) => String(entry.type || "").toLowerCase().includes("visit")).length || 0);
  const openMessages = messages.filter((message) => String(message.status || "").toLowerCase().includes("new")).length;
  const lowStock = products.filter((product) => Number(product.stock || 0) <= 5).length;
  const outOfStock = products.filter((product) => Number(product.stock || 0) <= 0).length;
  const cartsCount = Number(stats.cartsCount || cartsList.length || 0);
  const activeCarts = Number(stats.cartsWithItems || cartsList.filter((cart) => Number(cart.itemCount || 0) > 0).length || 0);
  const totalCartItems = Number(stats.totalCartItems || cartsList.reduce((sum, cart) => sum + Number(cart.itemCount || 0), 0) || 0);

  const revenue = Number(stats.totalSales || stats.revenue || 0);
  const averageOrderValue = ordersCount ? revenue / ordersCount : 0;
  const conversionRate = visitsCount ? (ordersCount / visitsCount) * 100 : 0;
  const fulfillmentRate = ordersCount ? (completedOrders / ordersCount) * 100 : 0;

  return {
    syncedAt: snapshotSyncedAt || new Date().toISOString(),
    staleSeconds: freshness.staleSeconds,
    staleLabel: freshness.staleLabel,
    source: normalizeText(snapshot?.source || (hasApiData ? "api" : "cache"), "cache"),
    dataQuality: hasApiData ? "live" : "cached",
    kpi: {
      revenue,
      ordersCount,
      pendingOrders,
      completedOrders,
      customersCount,
      productsCount,
      visitsCount,
      openMessages,
      lowStock,
      outOfStock,
      cartsCount,
      activeCarts,
      totalCartItems,
      averageOrderValue,
      conversionRate,
      fulfillmentRate
    }
  };
}

function clearSyncTimer() {
  if (syncTimer) {
    window.clearTimeout(syncTimer);
    syncTimer = null;
  }
}

function nextBackoffInterval(baseMs, streak) {
  const multiplier = Math.min(6, Math.max(1, streak));
  return Math.min(MAX_SYNC_INTERVAL_MS, baseMs * multiplier);
}

async function fetchDashboardSnapshotFromApi() {
  const payload = await withRetry("admin/dashboard", () => api.get("admin/dashboard"));
  const snapshot = payload?.snapshot || payload;
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Invalid dashboard snapshot payload");
  }

  return snapshot;
}

export async function getDashboard(options = {}) {
  const scope = "dashboard";
  const allowCacheFallback = options?.allowCacheFallback === true;
  const preferCache = options?.preferCache === true;
  const cachedPayload = (options?.force || !preferCache) ? null : getCachedScopePayload(scope, options);
  if (cachedPayload) {
    return cachedPayload;
  }

  const inFlight = scopeInFlight.get(scope);
  if (inFlight) {
    return inFlight;
  }

  const promise = (async () => {
  try {
    const snapshot = await fetchDashboardSnapshotFromApi();
    writeMemoryCache(scope, snapshot);
    writeCache(scope, snapshot);
    if (options?.emit !== false) {
      emitSync(scope, snapshot);
    }
    return snapshot;
  } catch (error) {
    const cached = getCachedScopePayload(scope, options);
    if (allowCacheFallback && cached) {
      return cached;
    }

    if (!options?.silent) {
      throw error;
    }

    return {
      stats: {},
      analytics: {},
      activity: [],
      raw: { orders: [], customers: [], products: [], visits: [], carts: [] }
    };
  }
  })().finally(() => {
    scopeInFlight.delete(scope);
  });

  scopeInFlight.set(scope, promise);
  return promise;
}

export async function getOrders(options = {}) {
  const scope = "orders";
  const allowCacheFallback = options?.allowCacheFallback === true;
  const preferCache = options?.preferCache === true;
  const cachedPayload = (options?.force || !preferCache) ? null : getCachedScopePayload(scope, options);
  if (cachedPayload) {
    return capArray(cachedPayload, options?.maxItems || MAX_ORDERS_ITEMS).map(normalizeOrder);
  }

  const inFlight = scopeInFlight.get(scope);
  if (inFlight) {
    return inFlight;
  }

  const promise = (async () => {
    try {
      const payload = await withRetry("admin/orders", () => api.get("admin/orders"));
      const orders = capArray(asArray(payload?.orders || payload?.data || payload).map(normalizeOrder), options?.maxItems || MAX_ORDERS_ITEMS);
      writeMemoryCache(scope, orders);
      writeCache(scope, orders);
      if (options?.emit !== false) {
        emitSync(scope, orders);
      }
      return orders;
    } catch (error) {
      const cached = getCachedScopePayload(scope, options);
      if (allowCacheFallback && cached) {
        return capArray(cached, options?.maxItems || MAX_ORDERS_ITEMS).map(normalizeOrder);
      }

      throw error;
    }
  })().finally(() => {
    scopeInFlight.delete(scope);
  });

  scopeInFlight.set(scope, promise);
  return promise;
}

export async function getCustomers(options = {}) {
  const scope = "customers";
  const allowCacheFallback = options?.allowCacheFallback === true;
  const preferCache = options?.preferCache === true;
  const cachedPayload = (options?.force || !preferCache) ? null : getCachedScopePayload(scope, options);
  if (cachedPayload) {
    return capArray(cachedPayload, options?.maxItems || MAX_CUSTOMERS_ITEMS).map(normalizeCustomer);
  }

  const inFlight = scopeInFlight.get(scope);
  if (inFlight) {
    return inFlight;
  }

  const promise = (async () => {
    try {
      const query = new URLSearchParams();
      if (options?.query) query.set("q", options.query);
      if (options?.status) query.set("status", options.status);
      const suffix = query.toString() ? `?${query.toString()}` : "";
      const payload = await withRetry("admin/customers", () => api.get(`admin/customers${suffix}`));
      const customers = capArray(asArray(payload?.customers || payload?.data || payload).map(normalizeCustomer), options?.maxItems || MAX_CUSTOMERS_ITEMS);
      writeMemoryCache(scope, customers);
      writeCache(scope, customers);
      if (options?.emit !== false) {
        emitSync(scope, customers);
      }
      return customers;
    } catch (error) {
      const cached = getCachedScopePayload(scope, options);
      if (allowCacheFallback && cached) {
        return capArray(cached, options?.maxItems || MAX_CUSTOMERS_ITEMS).map(normalizeCustomer);
      }

      throw error;
    }
  })().finally(() => {
    scopeInFlight.delete(scope);
  });

  scopeInFlight.set(scope, promise);
  return promise;
}

export async function getProducts(options = {}) {
  const scope = "products";
  const allowCacheFallback = options?.allowCacheFallback === true;
  const preferCache = options?.preferCache === true;
  const cachedPayload = (options?.force || !preferCache) ? null : getCachedScopePayload(scope, options);
  if (cachedPayload) {
    return capArray(cachedPayload, options?.maxItems || MAX_PRODUCTS_ITEMS).map(normalizeProduct);
  }

  const inFlight = scopeInFlight.get(scope);
  if (inFlight) {
    return inFlight;
  }

  const promise = (async () => {
    try {
      ensureProductCatalogSync();
      const products = capArray((await productCatalogService.getProducts()).map(normalizeProduct), options?.maxItems || MAX_PRODUCTS_ITEMS);
      writeMemoryCache(scope, products);
      writeCache(scope, products);
      if (options?.emit !== false) {
        emitSync(scope, products);
        publishGlobalProductSync(products);
      }
      return products;
    } catch (error) {
      const cached = getCachedScopePayload(scope, options);
      if (allowCacheFallback && cached) {
        return capArray(cached, options?.maxItems || MAX_PRODUCTS_ITEMS).map(normalizeProduct);
      }

      throw error;
    }
  })().finally(() => {
    scopeInFlight.delete(scope);
  });

  scopeInFlight.set(scope, promise);
  return promise;
}

export async function getActivityLogs(options = {}) {
  const scope = "activity";
  const allowCacheFallback = options?.allowCacheFallback === true;
  const preferCache = options?.preferCache === true;
  const cachedPayload = (options?.force || !preferCache) ? null : getCachedScopePayload(scope, options);
  if (cachedPayload) {
    return capArray(cachedPayload, options?.maxItems || MAX_ACTIVITY_ITEMS).map(normalizeActivityEntry);
  }

  const inFlight = scopeInFlight.get(scope);
  if (inFlight) {
    return inFlight;
  }

  const promise = (async () => {
    try {
      const payload = await withRetry("admin/activity", () => api.get("admin/activity?limit=120"));
      const activity = capArray(asArray(payload?.activity || payload?.logs || payload?.data || payload).map(normalizeActivityEntry), options?.maxItems || MAX_ACTIVITY_ITEMS);
      writeMemoryCache(scope, activity);
      writeCache(scope, activity);
      if (options?.emit !== false) {
        emitSync(scope, activity);
      }
      return activity;
    } catch (error) {
      const cached = getCachedScopePayload(scope, options);
      if (allowCacheFallback && cached) {
        return capArray(cached, options?.maxItems || MAX_ACTIVITY_ITEMS).map(normalizeActivityEntry);
      }

      throw error;
    }
  })().finally(() => {
    scopeInFlight.delete(scope);
  });

  scopeInFlight.set(scope, promise);
  return promise;
}

export async function getAnalytics(options = {}) {
  const scope = "analytics";
  const allowCacheFallback = options?.allowCacheFallback === true;

  try {
    const [snapshot, orders, customers, activity] = await Promise.all([
      getDashboard({ silent: true }),
      getOrders(),
      getCustomers(),
      getActivityLogs()
    ]);

    const analytics = asObject(snapshot?.analytics);
    const weeklySales = asArray(analytics?.salesSeries);
    const monthlyRevenue = buildMonthlyRevenueSeries(orders);
    const customerGrowth = buildCustomerGrowthSeries(customers);
    const visitorActivity = buildVisitorSeries(activity.filter((entry) => String(entry.type || "").toLowerCase().includes("visit")));
    const performance = buildPerformanceMetrics(orders, customers, activity.filter((entry) => String(entry.type || "").toLowerCase().includes("visit")));

    const syncedAt = snapshot?.syncedAt || new Date().toISOString();
    const monitoring = deriveMonitoring({
      snapshot,
      orders,
      customers,
      products: asArray(snapshot?.raw?.products || []),
      activity,
      carts: asArray(snapshot?.raw?.carts || []),
      messages: [],
      hasApiData: true
    });

    const normalized = {
      weeklySales,
      monthlyRevenue,
      customerGrowth,
      visitorActivity,
      orderStatusBreakdown: asObject(analytics?.orderStatusBreakdown),
      topProducts: asArray(analytics?.topProducts),
      inventory: asObject(analytics?.inventory),
      performance,
      totalRevenue: performance.revenue,
      averageOrderValue: performance.averageOrderValue,
      conversionRate: performance.conversionRate,
      returningCustomers: toNumber(analytics?.activityCounts?.customers),
      syncedAt,
      monitoring
    };

    writeCache(scope, normalized);
    emitSync(scope, normalized);
    return normalized;
  } catch (error) {
    const cached = readCache(scope);
    if (allowCacheFallback && cached?.payload) {
      return asObject(cached.payload);
    }

    throw error;
  }
}

export async function getInventory(options = {}) {
  const scope = "inventory";
  const allowCacheFallback = options?.allowCacheFallback === true;
  try {
    const [products, analytics] = await Promise.all([getProducts(), getAnalytics()]);

    const entries = products.map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      stock: product.stock,
      category: product.category,
      updatedAt: product.updatedAt
    }));

    const lowStock = entries.filter((entry) => entry.stock <= 5).length;

    const payload = {
      totalSku: entries.length,
      totalStock: entries.reduce((sum, entry) => sum + toNumber(entry.stock), 0),
      lowStock,
      outOfStock: entries.filter((entry) => entry.stock <= 0).length,
      recentlyUpdated: asArray(analytics?.inventory?.recentlyUpdated || []),
      entries
    };

    writeCache(scope, payload);
    emitSync(scope, payload);
    return payload;
  } catch (error) {
    const cached = readCache(scope);
    if (allowCacheFallback && cached?.payload) {
      return asObject(cached.payload);
    }

    throw error;
  }
}

export async function getSettings() {
  const scope = "settings";
  const cached = readCache(scope);
  return asObject(cached?.payload || {});
}

export async function updateSettings(nextSettings) {
  const safeSettings = asObject(nextSettings);
  writeMemoryCache("settings", safeSettings);
  writeCache("settings", safeSettings);
  emitSync("settings", safeSettings);
  return safeSettings;
}

export async function getHeroSlides(options = {}) {
  const scope = "heroslider";
  const force = options?.force === true;
  const emit = options?.emit !== false;
  const allowCacheFallback = options?.allowCacheFallback === true;
  const cachedPayload = getCachedScopePayload(scope);

  if (!force && Array.isArray(cachedPayload)) {
    return capArray(cachedPayload, options?.maxItems || MAX_HERO_SLIDES_ITEMS).map(normalizeHeroSlide);
  }

  try {
    const query = new URLSearchParams();
    query.set("limit", String(Math.min(300, Math.max(1, Number(options?.limit || MAX_HERO_SLIDES_ITEMS) || MAX_HERO_SLIDES_ITEMS))));
    if (options?.status) {
      query.set("status", String(options.status));
    }
    if (options?.search) {
      query.set("search", String(options.search));
    }
    if (options?.sort) {
      query.set("sort", String(options.sort));
    }
    if (options?.page) {
      query.set("page", String(Math.max(1, Number(options.page) || 1)));
    }

    const suffix = query.toString() ? `?${query.toString()}` : "";
    const payload = await withRetry(`admin/hero-slides${suffix}`, () => api.get(`admin/hero-slides${suffix}`));
    const slides = capArray(
      asArray(payload?.slides || payload?.data || payload).map(normalizeHeroSlide),
      options?.maxItems || MAX_HERO_SLIDES_ITEMS
    );

    writeMemoryCache(scope, slides);
    writeCache(scope, slides);
    if (emit) {
      emitSync(scope, slides);
    }

    return slides;
  } catch (error) {
    if (allowCacheFallback && Array.isArray(cachedPayload)) {
      return capArray(cachedPayload, options?.maxItems || MAX_HERO_SLIDES_ITEMS).map(normalizeHeroSlide);
    }
    throw error;
  }
}

export async function createHeroSlide(slideData = {}) {
  const payload = await api.post("admin/hero-slides", asObject(slideData));
  const slide = normalizeHeroSlide(payload?.slide || payload);
  await getHeroSlides({ force: true, emit: true });
  notifyStorefrontHeroUpdate("create");
  return slide;
}

export async function updateHeroSlide(slideId, updates = {}) {
  const id = normalizeText(slideId);
  if (!id) {
    throw new Error("Slide id is required.");
  }

  const payload = await api.put(`admin/hero-slides/${encodeURIComponent(id)}`, asObject(updates));
  const slide = normalizeHeroSlide(payload?.slide || payload);
  await getHeroSlides({ force: true, emit: true });
  notifyStorefrontHeroUpdate("update");
  return slide;
}

export async function moveHeroSlide(slideId, direction = "up") {
  const id = normalizeText(slideId);
  if (!id) {
    throw new Error("Slide id is required.");
  }

  const payload = await api.put(`admin/hero-slides/${encodeURIComponent(id)}/move`, {
    direction: String(direction || "up").toLowerCase() === "down" ? "down" : "up"
  });
  await getHeroSlides({ force: true, emit: true });
  notifyStorefrontHeroUpdate("move");
  return {
    moved: Boolean(payload?.moved),
    slide: normalizeHeroSlide(payload?.slide || {}),
    neighbor: payload?.neighbor ? normalizeHeroSlide(payload.neighbor) : null
  };
}

export async function deleteHeroSlide(slideId) {
  const id = normalizeText(slideId);
  if (!id) {
    throw new Error("Slide id is required.");
  }

  const payload = await api.remove(`admin/hero-slides/${encodeURIComponent(id)}`);
  await getHeroSlides({ force: true, emit: true });
  notifyStorefrontHeroUpdate("delete");
  return payload || { slideId: id };
}

function notifyStorefrontHeroUpdate(action = "update") {
  publishHeroSlidesBump(`admin:${action}`);
}

async function resyncEnterpriseScopes(scopes = []) {
  const normalizedScopes = new Set(asArray(scopes).map((scope) => normalizeText(scope).toLowerCase()));
  const tasks = [];

  if (normalizedScopes.has("orders")) {
    tasks.push(getOrders({ force: true, emit: true }));
  }

  if (normalizedScopes.has("messages")) {
    tasks.push(getMessages({ force: true, emit: true }));
  }

  if (normalizedScopes.has("products")) {
    tasks.push(getProducts({ force: true, emit: true }));
  }

  if (normalizedScopes.has("customers")) {
    tasks.push(getCustomers({ force: true, emit: true }));
  }

  if (normalizedScopes.has("activity")) {
    tasks.push(getActivityLogs({ force: true, emit: true }));
  }

  if (normalizedScopes.has("heroslider") || normalizedScopes.has("hero-slides") || normalizedScopes.has("hero")) {
    tasks.push(getHeroSlides({ force: true, emit: true }));
  }

  if (tasks.length) {
    await Promise.allSettled(tasks);
  }

  await refreshRealtimeIntelligence();
}

export async function updateOrderStatus(orderId, status) {
  const id = normalizeText(orderId);
  const nextStatus = normalizeText(status);
  if (!id || !nextStatus) {
    throw new Error("Order id and status are required.");
  }

  const payload = await api.put(`admin/orders/${encodeURIComponent(id)}/status`, { status: nextStatus });
  await resyncEnterpriseScopes(["orders"]);
  return payload?.order || payload || null;
}

export async function deleteOrder(orderId) {
  const id = normalizeText(orderId);
  if (!id) {
    throw new Error("Order id is required.");
  }

  const payload = await api.remove(`admin/orders/${encodeURIComponent(id)}`);
  await resyncEnterpriseScopes(["orders"]);
  return payload || { id };
}

export async function updateMessageStatus(messageId, status) {
  const id = normalizeText(messageId);
  const nextStatus = normalizeText(status);
  if (!id || !nextStatus) {
    throw new Error("Message id and status are required.");
  }

  const payload = await api.put(`admin/messages/${encodeURIComponent(id)}`, { status: nextStatus });
  await resyncEnterpriseScopes(["messages"]);
  return payload?.message || payload || null;
}

export async function updateCustomerStatus(customerId, status) {
  const id = normalizeText(customerId);
  const nextStatus = String(status || "").trim().toLowerCase() === "blocked" ? "blocked" : "active";
  if (!id) {
    throw new Error("Customer id is required.");
  }

  const payload = await api.put(`admin/customers/${encodeURIComponent(id)}`, { status: nextStatus });
  await resyncEnterpriseScopes(["customers"]);
  return payload?.customer || payload || null;
}

export async function deleteMessage(messageId) {
  const id = normalizeText(messageId);
  if (!id) {
    throw new Error("Message id is required.");
  }

  const payload = await api.remove(`admin/messages/${encodeURIComponent(id)}`);
  await resyncEnterpriseScopes(["messages"]);
  return payload || { id };
}

export async function bulkUpdateOrderStatus(orderIds = [], status) {
  const ids = asArray(orderIds).map((value) => normalizeText(value)).filter(Boolean);
  if (!ids.length) {
    throw new Error("Select at least one order.");
  }

  const nextStatus = normalizeText(status);
  const results = await Promise.allSettled(ids.map((id) => updateOrderStatus(id, nextStatus)));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    const error = new Error(`Updated ${ids.length - failures.length} of ${ids.length} orders.`);
    error.failures = failures;
    throw error;
  }

  return results.map((result) => result.value);
}

export async function bulkDeleteOrders(orderIds = []) {
  const ids = asArray(orderIds).map((value) => normalizeText(value)).filter(Boolean);
  if (!ids.length) {
    throw new Error("Select at least one order.");
  }

  const results = await Promise.allSettled(ids.map((id) => deleteOrder(id)));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    const error = new Error(`Deleted ${ids.length - failures.length} of ${ids.length} orders.`);
    error.failures = failures;
    throw error;
  }

  return results.map((result) => result.value);
}

export async function bulkUpdateMessageStatus(messageIds = [], status) {
  const ids = asArray(messageIds).map((value) => normalizeText(value)).filter(Boolean);
  if (!ids.length) {
    throw new Error("Select at least one message.");
  }

  const nextStatus = normalizeText(status);
  const results = await Promise.allSettled(ids.map((id) => updateMessageStatus(id, nextStatus)));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    const error = new Error(`Updated ${ids.length - failures.length} of ${ids.length} messages.`);
    error.failures = failures;
    throw error;
  }

  return results.map((result) => result.value);
}

export async function bulkDeleteMessages(messageIds = []) {
  const ids = asArray(messageIds).map((value) => normalizeText(value)).filter(Boolean);
  if (!ids.length) {
    throw new Error("Select at least one message.");
  }

  const results = await Promise.allSettled(ids.map((id) => deleteMessage(id)));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    const error = new Error(`Deleted ${ids.length - failures.length} of ${ids.length} messages.`);
    error.failures = failures;
    throw error;
  }

  return results.map((result) => result.value);
}

export async function getMessages(options = {}) {
  const scope = "messages";
  const allowCacheFallback = options?.allowCacheFallback === true;
  const preferCache = options?.preferCache === true;
  const cachedPayload = (options?.force || !preferCache) ? null : getCachedScopePayload(scope, options);
  if (cachedPayload) {
    return capArray(cachedPayload, options?.maxItems || MAX_MESSAGES_ITEMS).map(normalizeMessage);
  }

  const inFlight = scopeInFlight.get(scope);
  if (inFlight) {
    return inFlight;
  }

  const promise = (async () => {
    try {
      const payload = await withRetry("admin/messages", () => api.get("admin/messages?limit=120"));
      const messages = capArray(asArray(payload?.messages || payload?.data || payload).map(normalizeMessage), options?.maxItems || MAX_MESSAGES_ITEMS);
      writeMemoryCache(scope, messages);
      writeCache(scope, messages);
      if (options?.emit !== false) {
        emitSync(scope, messages);
      }
      return messages;
    } catch (error) {
      const cached = getCachedScopePayload(scope, options);
      if (allowCacheFallback && cached) {
        return capArray(cached, options?.maxItems || MAX_MESSAGES_ITEMS).map(normalizeMessage);
      }

      throw error;
    }
  })().finally(() => {
    scopeInFlight.delete(scope);
  });

  scopeInFlight.set(scope, promise);
  return promise;
}

export async function getCarts(options = {}) {
  const scope = "carts";
  const allowCacheFallback = options?.allowCacheFallback === true;
  const preferCache = options?.preferCache === true;
  const cachedPayload = (options?.force || !preferCache) ? null : getCachedScopePayload(scope, options);
  if (cachedPayload) {
    return capArray(cachedPayload, options?.maxItems || MAX_CARTS_ITEMS).map(normalizeCart);
  }

  const inFlight = scopeInFlight.get(scope);
  if (inFlight) {
    return inFlight;
  }

  const promise = (async () => {
    try {
      const payload = await withRetry("admin/carts", () => api.get("admin/carts?limit=200"));
      const carts = capArray(asArray(payload?.carts || payload?.data || payload).map(normalizeCart), options?.maxItems || MAX_CARTS_ITEMS);
      writeMemoryCache(scope, carts);
      writeCache(scope, carts);
      if (options?.emit !== false) {
        emitSync(scope, carts);
      }
      return carts;
    } catch (error) {
      const cached = getCachedScopePayload(scope, options);
      if (allowCacheFallback && cached) {
        return capArray(cached, options?.maxItems || MAX_CARTS_ITEMS).map(normalizeCart);
      }

      throw error;
    }
  })().finally(() => {
    scopeInFlight.delete(scope);
  });

  scopeInFlight.set(scope, promise);
  return promise;
}

export async function getRealtimeIntelligence(options = {}) {
  const forceApi = Boolean(options?.forceApi);
  const allowCacheFallback = !forceApi;

  const [snapshotResult, ordersResult, customersResult, productsResult, activityResult, messagesResult, cartsResult] = await Promise.allSettled([
    getDashboard({ allowCacheFallback, silent: true, emit: false, force: forceApi }),
    getOrders({ emit: false, force: forceApi }),
    getCustomers({ emit: false, force: forceApi }),
    getProducts({ emit: false, force: forceApi }),
    getActivityLogs({ emit: false, force: forceApi }),
    getMessages({ emit: false, force: forceApi }),
    getCarts({ emit: false, force: forceApi })
  ]);

  const hasApiData = [snapshotResult, ordersResult, customersResult, productsResult, activityResult, messagesResult, cartsResult]
    .some((result) => result.status === "fulfilled");
  const snapshot = snapshotResult.status === "fulfilled"
    ? snapshotResult.value
    : asObject(readCache("dashboard")?.payload || {});

  const orders = ordersResult.status === "fulfilled" ? ordersResult.value : asArray(readCache("orders")?.payload || []).map(normalizeOrder);
  const customers = customersResult.status === "fulfilled" ? customersResult.value : asArray(readCache("customers")?.payload || []).map(normalizeCustomer);
  const products = productsResult.status === "fulfilled" ? productsResult.value : asArray(readCache("products")?.payload || []).map(normalizeProduct);
  const activity = activityResult.status === "fulfilled" ? activityResult.value : asArray(readCache("activity")?.payload || []).map(normalizeActivityEntry);
  const messages = messagesResult.status === "fulfilled" ? messagesResult.value : asArray(readCache("messages")?.payload || []).map(normalizeMessage);
  const carts = cartsResult.status === "fulfilled" ? cartsResult.value : asArray(readCache("carts")?.payload || []).map(normalizeCart);

  const errors = [snapshotResult, ordersResult, customersResult, productsResult, activityResult, messagesResult, cartsResult]
    .filter((result) => result.status === "rejected")
    .map((result) => ({ message: String(result.reason?.message || "Sync request failed") }));

  const monitoring = deriveMonitoring({ snapshot, orders, customers, products, activity, messages, carts, hasApiData });
  const intelligence = {
    syncedAt: monitoring.syncedAt,
    source: monitoring.source,
    dataQuality: monitoring.dataQuality,
    monitoring,
    errors,
    feeds: {
      orders,
      customers,
      products,
      activity,
      messages,
      carts
    }
  };

  writeCache(INTELLIGENCE_SCOPE, intelligence);
  emitSync(INTELLIGENCE_SCOPE, intelligence);
  writeMemoryCache(INTELLIGENCE_SCOPE, intelligence);
  lastKnownIntelligence = intelligence;
  return intelligence;
}

function scheduleNextSync() {
  clearSyncTimer();
  if (!syncStarted) {
    return;
  }

  syncTimer = window.setTimeout(async () => {
    try {
      await refreshRealtimeIntelligence();
    } finally {
      scheduleNextSync();
    }
  }, syncIntervalMs);
}

export async function refreshRealtimeIntelligence() {
  if (inFlightSyncPromise) {
    return inFlightSyncPromise;
  }

  inFlightSyncPromise = (async () => {
    try {
      const intelligence = await getRealtimeIntelligence({ forceApi: false });
      syncFailureStreak = 0;
      syncIntervalMs = DEFAULT_SYNC_INTERVAL_MS;
      return intelligence;
    } catch (error) {
      syncFailureStreak += 1;
      syncIntervalMs = nextBackoffInterval(DEFAULT_SYNC_INTERVAL_MS, syncFailureStreak);
      if (lastKnownIntelligence) {
        return lastKnownIntelligence;
      }
      throw error;
    } finally {
      inFlightSyncPromise = null;
    }
  })();

  return inFlightSyncPromise;
}

function installVisibilitySync() {
  const onVisible = () => {
    if (document.visibilityState !== "visible") {
      return;
    }

    if (pendingVisibilityRefresh) {
      window.clearTimeout(pendingVisibilityRefresh);
    }

    pendingVisibilityRefresh = window.setTimeout(() => {
      void refreshRealtimeIntelligence();
    }, TAB_SYNC_DEBOUNCE_MS);
  };

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);

  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
    if (pendingVisibilityRefresh) {
      window.clearTimeout(pendingVisibilityRefresh);
      pendingVisibilityRefresh = null;
    }
  };
}

let removeVisibilitySync = null;

export function startRealtimeAnalyticsSync(options = {}) {
  if (syncStarted) {
    return () => stopRealtimeAnalyticsSync();
  }

  syncStarted = true;
  syncIntervalMs = Math.max(12000, Number(options?.intervalMs || DEFAULT_SYNC_INTERVAL_MS));
  syncFailureStreak = 0;

  removeVisibilitySync = installVisibilitySync();
  void refreshRealtimeIntelligence();
  scheduleNextSync();

  return () => stopRealtimeAnalyticsSync();
}

export function stopRealtimeAnalyticsSync() {
  syncStarted = false;
  clearSyncTimer();
  if (removeVisibilitySync) {
    removeVisibilitySync();
    removeVisibilitySync = null;
  }
}

/**
 * STEP 3H: Product Mutation Functions
 * 
 * These functions handle admin product operations and ensure
 * storefront receives global synchronization events.
 */

function publishGlobalProductSync(products) {
  if (typeof window !== 'undefined' && window.dispatchEvent) {
    // Publish to storefront rendering layer
    window.dispatchEvent(new CustomEvent('byose:products-synchronized', {
      detail: {
        products: Array.isArray(products) ? products : [],
        syncedAt: new Date().toISOString(),
        source: 'admin'
      }
    }));

    // Also publish the legacy event for backwards compatibility
    window.dispatchEvent(new CustomEvent('byose:products-changed', {
      detail: { products: Array.isArray(products) ? products : [] }
    }));
  }
}

export async function notifyStorefrontProductUpdate() {
  try {
    // Fetch fresh products from backend
    const products = await getProducts({ force: true, emit: false });
    // Publish global sync event
    publishGlobalProductSync(products);
  } catch (error) {
    console.error('[Admin Data] Failed to notify storefront of product update:', error);
  }
}

export async function createProductAndSync(productData, options = {}) {
  try {
    ensureProductCatalogSync();
    const response = await productCatalogService.createProduct(productData, options);
    syncLocalProductCaches(productCatalogService.getCachedProducts(), { emit: true });
    await notifyStorefrontProductUpdate();
    return response;
  } catch (error) {
    console.error('[Admin Data] Product creation failed:', error);
    throw createSharedProductPersistenceError("creation", error);
  }
}

export async function updateProductAndSync(productId, productData, options = {}) {
  try {
    ensureProductCatalogSync();
    const response = await productCatalogService.updateProduct(productId, productData, options);
    syncLocalProductCaches(productCatalogService.getCachedProducts(), { emit: true });
    await notifyStorefrontProductUpdate();
    return response;
  } catch (error) {
    console.error('[Admin Data] Product update failed:', error);
    throw createSharedProductPersistenceError("update", error);
  }
}

export async function deleteProductAndSync(productId, options = {}) {
  try {
    ensureProductCatalogSync();
    const response = await productCatalogService.deleteProduct(productId, options);
    syncLocalProductCaches(response?.products || [], { emit: true });
    await notifyStorefrontProductUpdate();
    return response || { id: productId };
  } catch (error) {
    console.error('[Admin Data] Product deletion failed:', error);
        throw createSharedProductPersistenceError("deletion", error);
  }
}
