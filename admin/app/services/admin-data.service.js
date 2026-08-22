import * as api from "../core/api.js";
import { publishRealtime } from "../core/realtime-adapter.js";
import productCatalogService from "../../../services/centralized-products.service.js";
import { publishHeroSlidesBump } from "../../../services/hero-slides.service.js";
import { isProductCardImageUrl } from "../../../services/storefront-asset-url.js";
import { applyCanonicalAddress, resolveOrderAddress, resolveOrderLocation } from "../utils/order-address.js";
import { classifyOrder } from "../utils/order-classification.js";

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
    // Do not re-dispatch byose:products-synchronized here. This callback is
    // itself triggered by that event, and republishing it recurses until
    // "Maximum call stack size exceeded".
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

function pickCanonicalProductImage(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text && !isProductCardImageUrl(text)) {
      return text;
    }
  }
  return "";
}

function canonicalizeProductGallery(gallery = []) {
  return asArray(gallery)
    .map((entry) => normalizeText(entry))
    .filter((entry) => entry && !isProductCardImageUrl(entry));
}

function normalizeStatus(status) {
  const value = normalizeText(status, "Pending").toLowerCase();
  if (value.includes("out for delivery") || value.includes("out_for_delivery")) return "Shipping";
  if (value.includes("deliver")) return "Delivered";
  if (value.includes("complete")) return "Completed";
  if (value.includes("ship")) return "Shipping";
  if (value.includes("cancel")) return "Cancelled";
  if (value.includes("refund")) return "Refunded";
  if (value.includes("return")) return "Returned";
  if (value.includes("pack")) return "Packed";
  if (value.includes("process")) return "Processing";
  if (value.includes("unpaid") || value.includes("awaiting") || value.includes("fail")) return "Pending";
  if (value.includes("confirm") || value === "paid") return "Confirmed";
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
  if (payload == null) {
    scopeMemoryCache.delete(scope);
    return;
  }
  scopeMemoryCache.set(scope, {
    cachedAt: Date.now(),
    payload
  });
}

function clearScopeCache(scope) {
  scopeMemoryCache.delete(scope);
  try {
    window.localStorage.removeItem(cacheKey(scope));
  } catch (_error) {
    // ignore
  }
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
  const storefrontProducts = asArray(productCatalogService.getCachedProducts()).map(normalizeProduct);
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
  const status = normalizeStatus(order?.orderStatus || order?.status || "Pending");
  const total = toNumber(order?.totalAmount ?? order?.totalPrice ?? order?.total ?? order?.amount);
  const payment = asObject(order?.payment);
  const items = asArray(order?.items || order?.products).map((item) => {
    const attrs = item?.attributes && typeof item.attributes === "object" ? item.attributes : {};
    const color = normalizeText(item?.color || item?.colorName || attrs.Color);
    const size = normalizeText(item?.size || item?.sizeLabel || attrs.Size);
    const sku = normalizeText(item?.sku || item?.variantSku || attrs.SKU);
    const quantity = Math.max(1, toNumber(item?.quantity || item?.qty || 1));
    const price = toNumber(item?.price);
    const storedLineTotal = item?.lineTotal != null && item?.lineTotal !== "" ? toNumber(item.lineTotal) : 0;
    return {
      productId: normalizeText(item?.productId || item?.id),
      productName: normalizeText(item?.productName || item?.name || "Product"),
      quantity,
      price,
      lineTotal: storedLineTotal > 0 ? storedLineTotal : price * quantity,
      image: normalizeText(item?.image || item?.colorImage || attrs.colorImage),
      color,
      colorName: color,
      size,
      sizeLabel: size,
      sku,
      variantSku: sku,
      variantKey: normalizeText(item?.variantKey || attrs.variantKey),
      model: normalizeText(item?.model || attrs.Model || attrs.model),
      storage: normalizeText(item?.storage || attrs.Storage || attrs.storage),
      attributeSummary: normalizeText(item?.attributeSummary || [color, size].filter(Boolean).join(" · ")),
      category: normalizeText(item?.category || attrs.Category),
      productUrl: normalizeText(item?.productUrl || item?.productLink || attrs.productUrl || attrs.productLink)
    };
  });

  const statusHistory = asArray(order?.statusHistory).map((entry) => ({
    status: normalizeText(entry?.status || entry?.label),
    label: normalizeText(entry?.label || entry?.status),
    note: normalizeText(entry?.note || entry?.message || entry?.reason),
    reason: normalizeText(entry?.reason || entry?.note || entry?.message),
    actor: normalizeText(entry?.actor || entry?.cancelledBy),
    timestamp: entry?.timestamp || entry?.at || entry?.createdAt || ""
  })).filter((entry) => entry.status || entry.label);

  let shippingAddress;
  let fullAddress;
  let gpsLocation;
  try {
    const resolvedAddress = resolveOrderAddress(order);
    const resolvedLocation = resolveOrderLocation(order);
    const canonical = applyCanonicalAddress(order, resolvedAddress, resolvedLocation);
    shippingAddress = canonical.shippingAddress;
    fullAddress = canonical.fullAddress;
    gpsLocation = canonical.gpsLocation;
  } catch (error) {
    console.error("[Admin Data] Order address normalization failed:", error);
    shippingAddress = asObject(order?.shippingAddress);
    fullAddress = asObject(order?.fullAddress);
    gpsLocation = asObject(order?.gpsLocation);
  }
  const paymentCancellation = asObject(payment.cancellation);
  const returnWorkflowRaw = asObject(payment.returnWorkflow || order?.returnWorkflow);
  const cancelHistory = [...statusHistory].reverse().find((entry) => /cancel/i.test(`${entry.status} ${entry.label}`));
  const paymentStatusValue = normalizeText(order?.paymentStatus || payment.status);
  const paymentStatusLower = paymentStatusValue.toLowerCase();
  const refundRequired = Boolean(paymentCancellation.refundRequired)
    || paymentStatusLower.includes("refund_required")
    || ["required", "pending", "processing"].includes(String(returnWorkflowRaw.refundStatus || "").toLowerCase());

  const returnWorkflow = {
    returnStatus: normalizeText(returnWorkflowRaw.returnStatus || (status.toLowerCase().includes("return") ? status : "")),
    refundStatus: normalizeText(returnWorkflowRaw.refundStatus
      || (paymentStatusLower.includes("refund_required") ? "required"
        : paymentStatusLower === "refunded" ? "completed"
          : "")),
    returnReason: normalizeText(returnWorkflowRaw.returnReason || paymentCancellation.reason || order?.cancellationReason),
    reasonCode: normalizeText(returnWorkflowRaw.reasonCode),
    customerNotes: normalizeText(returnWorkflowRaw.customerNotes),
    adminNotes: normalizeText(returnWorkflowRaw.adminNotes),
    productCondition: normalizeText(returnWorkflowRaw.productCondition),
    returnImages: asArray(returnWorkflowRaw.returnImages).map((image) => normalizeText(image)).filter(Boolean),
    returnRequestedAt: normalizeText(returnWorkflowRaw.returnRequestedAt || paymentCancellation.cancelledAt),
    returnApprovedAt: normalizeText(returnWorkflowRaw.returnApprovedAt),
    returnRejectedAt: normalizeText(returnWorkflowRaw.returnRejectedAt),
    returnReceivedAt: normalizeText(returnWorkflowRaw.returnReceivedAt),
    inspectedAt: normalizeText(returnWorkflowRaw.inspectedAt),
    inspectPassed: returnWorkflowRaw.inspectPassed !== false,
    restockEligible: Boolean(returnWorkflowRaw.restockEligible),
    requiresPhysicalReturn: returnWorkflowRaw.requiresPhysicalReturn !== false
      && !paymentCancellation.cancelledAt
      && normalizeText(returnWorkflowRaw.reasonCode).toLowerCase() !== "delivery_delay"
      && normalizeText(returnWorkflowRaw.reasonCode).toLowerCase() !== "cancel",
    refundApprovedAt: normalizeText(returnWorkflowRaw.refundApprovedAt),
    refundRejectedAt: normalizeText(returnWorkflowRaw.refundRejectedAt),
    refundCompletedAt: normalizeText(returnWorkflowRaw.refundCompletedAt),
    refundDate: normalizeText(returnWorkflowRaw.refundDate || returnWorkflowRaw.refundCompletedAt || returnWorkflowRaw.refundApprovedAt),
    refundAmount: toNumber(returnWorkflowRaw.refundAmount ?? (["completed", "processing"].includes(String(returnWorkflowRaw.refundStatus || "").toLowerCase()) ? (order?.totalAmount ?? order?.total) : 0)),
    refundMethod: normalizeText(returnWorkflowRaw.refundMethod),
    refundProcessingNote: normalizeText(returnWorkflowRaw.refundProcessingNote),
    stockRestored: Boolean(returnWorkflowRaw.stockRestored)
  };
  if (Object.prototype.hasOwnProperty.call(returnWorkflowRaw, "requiresPhysicalReturn")) {
    returnWorkflow.requiresPhysicalReturn = Boolean(returnWorkflowRaw.requiresPhysicalReturn);
  }

  const normalized = {
    id: normalizeText(order?.id || order?.orderId || order?._id),
    orderId: normalizeText(order?.orderId || order?.id || order?._id),
    recordId: Number(order?.recordId) > 0 ? Number(order.recordId) : undefined,
    status,
    orderStatus: status,
    total,
    grandTotal: total,
    subtotal: toNumber(order?.subtotal),
    deliveryFee: toNumber(order?.deliveryFee ?? order?.shippingFee),
    shippingCost: toNumber(order?.deliveryFee ?? order?.shippingFee),
    discount: toNumber(order?.discount ?? order?.discountAmount),
    tax: toNumber(order?.tax ?? order?.taxAmount),
    codFee: toNumber(order?.codFee),
    date: order?.date || order?.createdAt || new Date().toISOString(),
    createdAt: order?.createdAt || order?.date || new Date().toISOString(),
    updatedAt: order?.updatedAt || order?.date || order?.createdAt || "",
    cancelledAt: normalizeText(order?.cancelledAt || paymentCancellation.cancelledAt || cancelHistory?.timestamp),
    cancelledBy: normalizeText(order?.cancelledBy || paymentCancellation.cancelledBy || cancelHistory?.actor || ""),
    cancellationReason: normalizeText(order?.cancellationReason || paymentCancellation.reason || cancelHistory?.reason || cancelHistory?.note || ""),
    refundRequired,
    returnWorkflow,
    returnStatus: returnWorkflow.returnStatus,
    refundStatus: returnWorkflow.refundStatus,
    returnReason: returnWorkflow.returnReason,
    returnRequestedAt: returnWorkflow.returnRequestedAt,
    refundAmount: returnWorkflow.refundAmount,
    refundMethod: returnWorkflow.refundMethod,
    refundDate: returnWorkflow.refundDate,
    customerName: normalizeText(order?.customerName || order?.customer?.name || shippingAddress.fullName || "Guest"),
    customerEmail: normalizeText(order?.customerEmail || order?.userEmail || order?.customer?.email),
    customerPhone: normalizeText(order?.customerPhone || order?.phoneNumber || order?.customer?.phone || shippingAddress.phone),
    customerId: normalizeText(order?.customerId || order?.customer?.id),
    isGuest: Boolean(order?.isGuest || order?.customer?.isGuest),
    paymentMethod: normalizeText(order?.paymentMethod || payment.method),
    paymentMethodLabel: normalizeText(order?.paymentMethodLabel || payment.methodLabel || (order?.paymentMethod === "cod" || payment.method === "cod" ? "Cash on Delivery" : order?.paymentMethod || payment.method)),
    paymentStatus: paymentStatusValue,
    paymentStatusLabel: normalizeText(order?.paymentStatusLabel || payment.statusLabel),
    payerPhone: normalizeText(payment.payerPhone || order?.payerPhone),
    paymentNote: normalizeText(payment.note || order?.paymentNote),
    paymentType: normalizeText(payment.type || order?.paymentType),
    paymentReference: normalizeText(order?.paymentReference || payment.reference || payment.gateway?.transRef || order?.transactionReference || order?.transactionId),
    transactionId: normalizeText(order?.transactionId || order?.transactionReference || payment.transactionId || payment.gateway?.transRef),
    transactionReference: normalizeText(order?.transactionReference || order?.paymentReference || payment.gateway?.transRef),
    currency: normalizeText(order?.currency, "RWF") || "RWF",
    couponCode: normalizeText(order?.couponCode),
    couponDiscount: toNumber(order?.couponDiscount),
    payment: {
      type: normalizeText(payment.type || order?.paymentType),
      method: normalizeText(payment.method || order?.paymentMethod),
      methodLabel: normalizeText(payment.methodLabel || order?.paymentMethodLabel),
      status: normalizeText(payment.status || paymentStatusValue),
      statusLabel: normalizeText(payment.statusLabel || order?.paymentStatusLabel),
      payerPhone: normalizeText(payment.payerPhone || order?.payerPhone),
      note: normalizeText(payment.note || order?.paymentNote),
      reference: normalizeText(payment.reference || order?.paymentReference),
      transactionId: normalizeText(payment.transactionId || order?.transactionId),
      gateway: {
        provider: normalizeText(payment.gateway?.provider),
        mode: normalizeText(payment.gateway?.mode),
        transRef: normalizeText(payment.gateway?.transRef),
        companyRef: normalizeText(payment.gateway?.companyRef),
        lastResult: normalizeText(payment.gateway?.lastResult),
        lastOutcome: normalizeText(payment.gateway?.lastOutcome),
        verifiedAt: payment.gateway?.verifiedAt || "",
        updatedAt: payment.gateway?.updatedAt || "",
        initiatedAt: payment.gateway?.initiatedAt || "",
        serviceType: normalizeText(payment.gateway?.serviceType)
      },
      transaction: {
        state: normalizeText(payment.transaction?.state),
        reference: normalizeText(payment.transaction?.reference),
        provider: normalizeText(payment.transaction?.provider)
      }
    },
    paymentCancellation,
    deliveryMethod: normalizeText(order?.deliveryMethod),
    deliveryLabel: normalizeText(order?.deliveryLabel),
    deliveryEstimate: normalizeText(order?.deliveryEstimate || order?.estimatedDelivery),
    deliveryMethodKey: normalizeText(order?.deliveryMethodKey),
    trackingNumber: normalizeText(order?.trackingNumber || order?.tracking?.number || order?.trackingCode),
    deliveryProvider: normalizeText(order?.deliveryProvider || order?.courier || order?.shippingProvider),
    shippingStatus: status,
    deliveryStatus: status,
    shippingAddress,
    fullAddress,
    gpsLocation: {
      latitude: normalizeText(gpsLocation.latitude || shippingAddress.latitude),
      longitude: normalizeText(gpsLocation.longitude || shippingAddress.longitude),
      googleMapsLink: normalizeText(gpsLocation.googleMapsLink || gpsLocation.mapLink || shippingAddress.mapLink),
      mapLink: normalizeText(gpsLocation.mapLink || gpsLocation.googleMapsLink || shippingAddress.mapLink),
      accuracy: normalizeText(gpsLocation.accuracy || shippingAddress.locationAccuracy),
      capturedAt: normalizeText(gpsLocation.capturedAt || shippingAddress.locationCapturedAt)
    },
    statusHistory,
    itemsCount: items.length,
    items,
    products: items
  };
  normalized.classification = classifyOrder(normalized);
  return normalized;
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
  const canonicalGallery = canonicalizeProductGallery(product?.gallery);
  const canonicalMain = pickCanonicalProductImage(
    product?.originalImage,
    product?.mainImage,
    product?.image,
    ...canonicalGallery.slice(0, 1)
  );
  const displayMain = canonicalMain || normalizeText(product?.originalImage || product?.mainImage || product?.image);

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
    reservedStock: toNumber(product?.inventory?.reservedStock ?? product?.reservedStock),
    availableStock: toNumber(product?.inventory?.availableStock ?? product?.availableStock ?? product?.stock),
    physicalStock: toNumber(product?.inventory?.physicalStock ?? product?.physicalStock)
      || (toNumber(product?.inventory?.availableStock ?? product?.availableStock ?? product?.stock)
        + toNumber(product?.inventory?.reservedStock ?? product?.reservedStock)),
    soldStock: toNumber(product?.inventory?.soldStock ?? product?.soldStock),
    inventory: asObject(product?.inventory),
    gallery: canonicalGallery,
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
    mainImage: displayMain,
    image: displayMain,
    originalImage: canonicalMain || displayMain,
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
    if (!isRevenueEligibleOrder(order)) {
      return;
    }
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

function isRevenueEligibleOrder(order) {
  const status = String(order?.status || order?.orderStatus || "").toLowerCase();
  const payment = String(order?.paymentStatus || order?.paymentStatusLabel || "").toLowerCase();
  if (status.includes("cancel") || status.includes("return") || status.includes("refund")) {
    return false;
  }
  if (payment.includes("refund")) {
    return false;
  }
  return true;
}

function buildPerformanceMetrics(orders, customers, visitors) {
  const revenueOrders = (Array.isArray(orders) ? orders : []).filter(isRevenueEligibleOrder);
  const revenue = revenueOrders.reduce((sum, order) => sum + toNumber(order.total), 0);
  const orderCount = revenueOrders.length;
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
      const payload = await withRetry("admin/orders", () => api.get("admin/orders?limit=500"));
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

export async function searchCustomers(query = "", options = {}) {
  const normalized = String(query || "").trim();
  const params = new URLSearchParams();
  if (normalized) params.set("q", normalized);
  if (options?.status) params.set("status", String(options.status));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const payload = await withRetry("admin/customers/search", () => api.get(`admin/customers${suffix}`));
  return capArray(asArray(payload?.customers || payload?.data || payload).map(normalizeCustomer), options?.maxItems || 25);
}

export async function getCustomerDetail(customerId) {
  const id = String(customerId || "").trim();
  if (!id) return null;
  const payload = await withRetry("admin/customers/detail", () => api.get(`admin/customers/${encodeURIComponent(id)}`));
  const customer = payload?.customer || payload?.data || payload;
  return customer ? normalizeCustomer(customer) : null;
}

export async function sendCustomerNotification(payload = {}) {
  return api.post("admin/customer-notifications", payload);
}

export async function getProductById(productId) {
  const id = String(productId || "").trim();
  if (!id) {
    return null;
  }

  ensureProductCatalogSync();
  const product = await productCatalogService.getProductById(id);
  return product ? normalizeProduct(product) : null;
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
      const sourceProducts = options.force && typeof productCatalogService.forceRefreshProducts === "function"
        ? await productCatalogService.forceRefreshProducts()
        : await productCatalogService.getProducts();
      const products = capArray(asArray(sourceProducts).map(normalizeProduct), options?.maxItems || MAX_PRODUCTS_ITEMS);
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
      getDashboard({ silent: true, emit: false }),
      getOrders({ emit: false }),
      getCustomers({ emit: false }),
      getActivityLogs({ emit: false })
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
    if (options?.emit !== false) {
      emitSync(scope, normalized);
    }
    return normalized;
  } catch (error) {
    const cached = readCache(scope);
    if (allowCacheFallback && cached?.payload) {
      return asObject(cached.payload);
    }

    throw error;
  }
}

function expandInventoryEntries(product) {
  const variants = asObject(product?.variants);
  const metadata = asObject(product?.metadata);
  const colors = asArray(variants.colorVariants).length
    ? asArray(variants.colorVariants)
    : asArray(metadata.colorVariants);
  const base = {
    id: product?.id,
    name: product?.name,
    sku: product?.sku,
    category: product?.category,
    updatedAt: product?.updatedAt
  };

  if (!colors.length) {
    const available = toNumber(product?.availableStock ?? product?.stock);
    const reserved = toNumber(product?.reservedStock);
    const sold = toNumber(product?.soldStock);
    return [{
      ...base,
      variantLabel: "Default",
      stock: available,
      availableStock: available,
      reservedStock: reserved,
      physicalStock: available + reserved,
      soldStock: sold
    }];
  }

  const rows = [];
  colors.forEach((color) => {
    const sizes = asArray(color?.sizes);
    if (!sizes.length) {
      const available = toNumber(color?.stock ?? color?.totalStock);
      const reserved = toNumber(color?.reserved);
      const sold = toNumber(color?.sold);
      rows.push({
        ...base,
        sku: normalizeText(color?.sku || `${base.sku || base.id}`),
        variantLabel: normalizeText(color?.colorName || color?.name || "Color"),
        stock: available,
        availableStock: available,
        reservedStock: reserved,
        physicalStock: available + reserved,
        soldStock: sold
      });
      return;
    }
    sizes.forEach((sizeRow) => {
      const available = toNumber(sizeRow?.stock);
      const reserved = toNumber(sizeRow?.reserved);
      const sold = toNumber(sizeRow?.sold);
      const colorName = normalizeText(color?.colorName || color?.name || "Color");
      const sizeLabel = normalizeText(sizeRow?.size || sizeRow?.label);
      rows.push({
        ...base,
        sku: normalizeText(sizeRow?.sku || `${base.sku || base.id}-${colorName}-${sizeLabel}`),
        variantLabel: sizeLabel ? `${colorName} / ${sizeLabel}` : colorName,
        stock: available,
        availableStock: available,
        reservedStock: reserved,
        physicalStock: available + reserved,
        soldStock: sold
      });
    });
  });
  return rows;
}

export async function getInventory(options = {}) {
  const scope = "inventory";
  const allowCacheFallback = options?.allowCacheFallback === true;
  try {
    const [products, analytics] = await Promise.all([getProducts(), getAnalytics()]);

    const entries = products.flatMap((product) => expandInventoryEntries(product));

    const lowStock = entries.filter((entry) => toNumber(entry.availableStock ?? entry.stock) <= 5).length;

    const payload = {
      totalSku: entries.length,
      totalStock: entries.reduce((sum, entry) => sum + toNumber(entry.availableStock ?? entry.stock), 0),
      totalPhysical: entries.reduce((sum, entry) => sum + toNumber(entry.physicalStock), 0),
      totalReserved: entries.reduce((sum, entry) => sum + toNumber(entry.reservedStock), 0),
      totalSold: entries.reduce((sum, entry) => sum + toNumber(entry.soldStock), 0),
      lowStock,
      outOfStock: entries.filter((entry) => toNumber(entry.availableStock ?? entry.stock) <= 0).length,
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

export async function getSettings(options = {}) {
  const force = options?.force === true;
  const scope = "settings";
  const cached = getCachedScopePayload(scope);
  if (!force && cached && typeof cached === "object" && Object.keys(cached).length) {
    return asObject(cached);
  }

  const payload = await withRetry("admin/settings", () => api.get("admin/settings"));
  const settings = asObject(payload?.settings || payload);
  writeMemoryCache(scope, settings);
  writeCache(scope, settings);
  emitSync(scope, settings);
  return settings;
}

export async function updateSettings(nextSettings) {
  const payload = await api.put("admin/settings", asObject(nextSettings));
  const settings = asObject(payload?.settings || nextSettings);
  writeMemoryCache("settings", settings);
  writeCache("settings", settings);
  emitSync("settings", settings);
  return settings;
}

export async function getAdminBranding(options = {}) {
  const force = options?.force === true;
  const cached = getCachedScopePayload("admin-branding");
  if (!force && cached && typeof cached === "object" && Object.keys(cached).length) {
    return asObject(cached);
  }

  const payload = await withRetry("admin/branding", () => api.get("admin/branding"));
  const branding = asObject(payload?.branding || payload);
  writeMemoryCache("admin-branding", branding);
  writeCache("admin-branding", branding);
  emitSync("admin-branding", branding);
  return branding;
}

export async function updateAdminBranding(nextBranding) {
  const payload = await api.put("admin/branding", asObject(nextBranding));
  const branding = asObject(payload?.branding || nextBranding);
  writeMemoryCache("admin-branding", branding);
  writeCache("admin-branding", branding);
  emitSync("admin-branding", branding);
  try {
    window.dispatchEvent(new CustomEvent("byose:admin-branding-updated", { detail: branding }));
  } catch (_error) {
    // ignore
  }
  return branding;
}

export async function setAdminBrandingAsset(assetKey, assetPath) {
  const payload = await api.post(`admin/branding/assets/${encodeURIComponent(assetKey)}`, {
    path: String(assetPath || "").trim()
  });
  const branding = asObject(payload?.branding);
  if (Object.keys(branding).length) {
    writeMemoryCache("admin-branding", branding);
    writeCache("admin-branding", branding);
    emitSync("admin-branding", branding);
    try {
      window.dispatchEvent(new CustomEvent("byose:admin-branding-updated", { detail: branding }));
    } catch (_error) {
      // ignore
    }
  }
  return branding;
}

export async function removeAdminBrandingAsset(assetKey) {
  const payload = await api.remove(`admin/branding/assets/${encodeURIComponent(assetKey)}`);
  const branding = asObject(payload?.branding);
  if (Object.keys(branding).length) {
    writeMemoryCache("admin-branding", branding);
    writeCache("admin-branding", branding);
    emitSync("admin-branding", branding);
    try {
      window.dispatchEvent(new CustomEvent("byose:admin-branding-updated", { detail: branding }));
    } catch (_error) {
      // ignore
    }
  }
  return branding;
}

export async function getAdminDelivery(options = {}) {
  const force = options?.force === true;
  const cached = getCachedScopePayload("admin-delivery");
  if (!force && cached && typeof cached === "object" && Object.keys(cached).length) {
    return asObject(cached);
  }

  const payload = await withRetry("admin/delivery", () => api.get("admin/delivery"));
  const delivery = asObject(payload?.delivery || payload);
  writeMemoryCache("admin-delivery", delivery);
  writeCache("admin-delivery", delivery);
  emitSync("admin-delivery", delivery);
  return delivery;
}

export async function updateAdminDelivery(nextDelivery) {
  const payload = await api.put("admin/delivery", asObject(nextDelivery));
  const delivery = asObject(payload?.delivery || nextDelivery);
  writeMemoryCache("admin-delivery", delivery);
  writeCache("admin-delivery", delivery);
  emitSync("admin-delivery", delivery);
  return delivery;
}

export async function getAdminPayment(options = {}) {
  const force = options?.force === true;
  const cached = getCachedScopePayload("admin-payment");
  if (!force && cached && typeof cached === "object" && Object.keys(cached).length) {
    return asObject(cached);
  }

  const payload = await withRetry("admin/payment", () => api.get("admin/payment"));
  const payment = asObject(payload?.payment || payload);
  writeMemoryCache("admin-payment", payment);
  writeCache("admin-payment", payment);
  emitSync("admin-payment", payment);
  return payment;
}

export async function updateAdminPayment(nextPayment) {
  try {
    const payload = await api.put("admin/payment", asObject(nextPayment));
    // Never fall back to the request body — that made failed/partial saves look persisted.
    const payment = asObject(payload?.payment);
    if (!Object.keys(payment).length) {
      const error = new Error("Payment settings save returned an empty server response.");
      error.code = "ADMIN_PAYMENT_EMPTY_RESPONSE";
      throw error;
    }
    writeMemoryCache("admin-payment", payment);
    writeCache("admin-payment", payment);
    emitSync("admin-payment", payment);
    return payment;
  } catch (error) {
    if (error && error.payload?.details && !error.details) {
      error.details = error.payload.details;
    }
    throw error;
  }
}

export async function testAdminPaymentConnection(options = {}) {
  try {
    const payload = await api.post("admin/payment/test", {
      providerId: options?.providerId || undefined
    });
    const payment = asObject(payload?.payment);
    if (Object.keys(payment).length) {
      writeMemoryCache("admin-payment", payment);
      writeCache("admin-payment", payment);
      emitSync("admin-payment", payment);
    }
    return {
      test: asObject(payload?.test),
      payment,
      message: String(payload?.message || "")
    };
  } catch (error) {
    if (error && error.payload?.details && !error.details) {
      error.details = error.payload.details;
    }
    throw error;
  }
}

export async function getAdminPaymentActivity(options = {}) {
  const limit = Number(options?.limit || 12);
  const payload = await api.get(`admin/payment/activity?limit=${encodeURIComponent(limit)}`);
  return {
    activity: Array.isArray(payload?.activity) ? payload.activity : [],
    activityStats: asObject(payload?.activityStats)
  };
}

export async function createAdminDeliveryZone(zone) {
  const payload = await api.post("admin/delivery/zones", asObject(zone));
  clearScopeCache("admin-delivery");
  emitSync("admin-delivery", null);
  return asObject(payload?.zone || payload);
}

export async function updateAdminDeliveryZone(zoneId, updates) {
  const payload = await api.put(`admin/delivery/zones/${encodeURIComponent(zoneId)}`, asObject(updates));
  clearScopeCache("admin-delivery");
  emitSync("admin-delivery", null);
  return asObject(payload?.zone || payload);
}

export async function deleteAdminDeliveryZone(zoneId) {
  const payload = await api.remove(`admin/delivery/zones/${encodeURIComponent(zoneId)}`);
  clearScopeCache("admin-delivery");
  emitSync("admin-delivery", null);
  return Boolean(payload?.success);
}

export async function getAdminSeo(options = {}) {
  const force = options?.force === true;
  const cached = getCachedScopePayload("admin-seo");
  if (!force && cached && typeof cached === "object" && Object.keys(cached).length) {
    return asObject(cached);
  }

  const payload = await withRetry("admin/seo", () => api.get("admin/seo"));
  const seo = asObject(payload?.seo || payload);
  writeMemoryCache("admin-seo", seo);
  writeCache("admin-seo", seo);
  emitSync("admin-seo", seo);
  return seo;
}

export async function updateAdminSeo(nextSeo) {
  const payload = await api.put("admin/seo", asObject(nextSeo));
  const seo = asObject(payload?.seo || nextSeo);
  writeMemoryCache("admin-seo", seo);
  writeCache("admin-seo", seo);
  emitSync("admin-seo", seo);
  return seo;
}

export async function getNotificationCenter(options = {}) {
  const force = Boolean(options.force);
  const limit = Number(options.limit) || 8;
  const cacheKey = "admin-notification-center";
  const cached = getCachedScopePayload(cacheKey);
  if (!force && cached && typeof cached === "object") {
    return asObject(cached);
  }

  const payload = await withRetry("admin/notifications/center", () => api.get(`admin/notifications/center?limit=${encodeURIComponent(limit)}`));
  const center = {
    unreadCount: Number(payload?.unreadCount || 0),
    notifications: Array.isArray(payload?.notifications) ? payload.notifications : [],
    total: Number(payload?.total || 0),
    settings: asObject(payload?.settings)
  };
  writeMemoryCache(cacheKey, center);
  return center;
}

export async function getAdminNotifications(options = {}) {
  const params = new URLSearchParams();
  const setIf = (key, value) => {
    if (value == null || value === "") return;
    params.set(key, String(value));
  };

  setIf("status", options.status);
  setIf("priority", options.priority);
  setIf("type", options.type);
  setIf("q", options.q || options.search);
  setIf("orderId", options.orderId);
  setIf("customer", options.customer);
  setIf("date", options.date);
  setIf("dateFrom", options.dateFrom);
  setIf("dateTo", options.dateTo);
  setIf("datePreset", options.datePreset || options.period);
  setIf("sort", options.sort || options.sortBy);
  if (options.includeArchived) params.set("includeArchived", "true");
  if (options.limit != null) params.set("limit", String(options.limit));
  if (options.offset != null) params.set("offset", String(options.offset));

  const suffix = params.toString() ? `?${params.toString()}` : "";
  const payload = await withRetry("admin/notifications", () => api.get(`admin/notifications${suffix}`));
  return {
    notifications: Array.isArray(payload?.notifications) ? payload.notifications : [],
    total: Number(payload?.total || 0),
    unreadCount: Number(payload?.unreadCount || 0),
    limit: Number(payload?.limit || 40),
    offset: Number(payload?.offset || 0),
    sort: String(payload?.sort || options.sort || "newest")
  };
}

export async function getNotificationUnreadCount() {
  const payload = await api.get("admin/notifications/unread-count");
  return Number(payload?.unreadCount || 0);
}

export async function markNotificationRead(id) {
  const payload = await api.put(`admin/notifications/${encodeURIComponent(id)}/read`);
  writeMemoryCache("admin-notification-center", null);
  return asObject(payload?.notification);
}

export async function markNotificationUnread(id) {
  const payload = await api.put(`admin/notifications/${encodeURIComponent(id)}/unread`);
  writeMemoryCache("admin-notification-center", null);
  return asObject(payload?.notification);
}

export async function markAllNotificationsRead() {
  const payload = await api.put("admin/notifications/read-all");
  writeMemoryCache("admin-notification-center", null);
  return { updated: Number(payload?.updated || 0) };
}

export async function archiveNotification(id) {
  const payload = await api.put(`admin/notifications/${encodeURIComponent(id)}/archive`);
  writeMemoryCache("admin-notification-center", null);
  return asObject(payload?.notification);
}

export async function deleteNotification(id) {
  const payload = await api.remove(`admin/notifications/${encodeURIComponent(id)}`);
  writeMemoryCache("admin-notification-center", null);
  return Boolean(payload?.deleted);
}

export async function bulkDeleteNotifications(ids = []) {
  const payload = await api.post("admin/notifications/bulk-delete", { ids: Array.isArray(ids) ? ids : [] });
  writeMemoryCache("admin-notification-center", null);
  return { deleted: Number(payload?.deleted || 0) };
}

export async function bulkArchiveNotifications(ids = []) {
  const payload = await api.post("admin/notifications/bulk-archive", { ids: Array.isArray(ids) ? ids : [] });
  writeMemoryCache("admin-notification-center", null);
  return { updated: Number(payload?.updated || 0) };
}

export async function bulkMarkNotificationsRead(ids = []) {
  const payload = await api.post("admin/notifications/bulk-read", { ids: Array.isArray(ids) ? ids : [] });
  writeMemoryCache("admin-notification-center", null);
  return { updated: Number(payload?.updated || 0) };
}

export async function bulkMarkNotificationsUnread(ids = []) {
  const payload = await api.post("admin/notifications/bulk-unread", { ids: Array.isArray(ids) ? ids : [] });
  writeMemoryCache("admin-notification-center", null);
  return { updated: Number(payload?.updated || 0) };
}

export async function clearOldNotifications(olderThanDays = 90) {
  const payload = await api.post("admin/notifications/clear-old", { olderThanDays: Number(olderThanDays) || 90 });
  writeMemoryCache("admin-notification-center", null);
  return {
    deleted: Number(payload?.deleted || 0),
    olderThanDays: Number(payload?.olderThanDays || olderThanDays || 90),
    cutoff: payload?.cutoff || null
  };
}

export async function getNotificationSettings() {
  const payload = await withRetry("admin/notifications/settings", () => api.get("admin/notifications/settings"));
  return asObject(payload?.settings || payload);
}

export async function updateNotificationSettings(nextSettings) {
  const payload = await api.put("admin/notifications/settings", asObject(nextSettings));
  writeMemoryCache("admin-notification-center", null);
  return asObject(payload?.settings || nextSettings);
}

export async function sendNotificationTestEmail(options = {}) {
  const payload = await api.post("admin/notifications/settings/test-email", asObject(options));
  return {
    success: Boolean(payload?.success !== false),
    recipient: String(payload?.recipient || ""),
    recipients: Array.isArray(payload?.recipients) ? payload.recipients.map((value) => String(value || "").trim()).filter(Boolean) : [],
    provider: String(payload?.provider || ""),
    messageId: payload?.messageId || null,
    connectionStatus: String(payload?.connectionStatus || ""),
    sentAt: payload?.sentAt || null,
    partial: Boolean(payload?.partial),
    message: String(payload?.message || ""),
    results: Array.isArray(payload?.results) ? payload.results : []
  };
}

export async function getNotificationAutomationStatus() {
  const payload = await withRetry("admin/notifications/automation/status", () => api.get("admin/notifications/automation/status"));
  return asObject(payload?.automation || payload);
}

export async function getNotificationMonitoring() {
  const payload = await withRetry("admin/notifications/monitoring", () => api.get("admin/notifications/monitoring"));
  return asObject(payload?.monitoring || payload);
}

export async function getNotificationMonitoringHealth() {
  const payload = await withRetry("admin/notifications/monitoring/health", () => api.get("admin/notifications/monitoring/health"));
  return asObject(payload?.health || payload);
}

export async function getNotificationOpsLogs(options = {}) {
  const params = new URLSearchParams();
  if (options.eventType) params.set("eventType", String(options.eventType));
  if (options.status) params.set("status", String(options.status));
  if (options.channel) params.set("channel", String(options.channel));
  if (options.limit != null) params.set("limit", String(options.limit));
  if (options.offset != null) params.set("offset", String(options.offset));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const payload = await withRetry("admin/notifications/monitoring/logs", () => api.get(`admin/notifications/monitoring/logs${suffix}`));
  return {
    logs: Array.isArray(payload?.logs) ? payload.logs : [],
    total: Number(payload?.total || 0),
    limit: Number(payload?.limit || 50),
    offset: Number(payload?.offset || 0)
  };
}

export async function runNotificationRecovery() {
  const payload = await api.post("admin/notifications/monitoring/recover", {});
  return asObject(payload?.result || payload);
}

export async function retryNotificationEmailDelivery(deliveryId) {
  const id = encodeURIComponent(String(deliveryId || "").trim());
  const payload = await api.post(`admin/notifications/monitoring/deliveries/${id}/retry`, {});
  return asObject(payload);
}

export async function getNotificationAnalytics(options = {}) {
  const params = new URLSearchParams();
  if (options.preset) params.set("preset", String(options.preset));
  if (options.from) params.set("from", String(options.from));
  if (options.to) params.set("to", String(options.to));
  if (options.type) params.set("type", String(options.type));
  if (options.status) params.set("status", String(options.status));
  if (options.eventKey) params.set("eventKey", String(options.eventKey));
  if (options.emailStatus) params.set("emailStatus", String(options.emailStatus));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const payload = await withRetry("admin/notifications/analytics", () => api.get(`admin/notifications/analytics${suffix}`));
  return asObject(payload?.analytics || payload);
}

export async function getNotificationAnalyticsReport(options = {}) {
  const params = new URLSearchParams();
  if (options.preset) params.set("preset", String(options.preset));
  if (options.from) params.set("from", String(options.from));
  if (options.to) params.set("to", String(options.to));
  if (options.type) params.set("type", String(options.type));
  if (options.status) params.set("status", String(options.status));
  if (options.eventKey) params.set("eventKey", String(options.eventKey));
  if (options.emailStatus) params.set("emailStatus", String(options.emailStatus));
  if (options.limit != null) params.set("limit", String(options.limit));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const payload = await withRetry("admin/notifications/analytics/report", () => api.get(`admin/notifications/analytics/report${suffix}`));
  return asObject(payload?.report || payload);
}

export async function validateAdminSeo(nextSeo) {
  const payload = await api.post("admin/seo/validate", asObject(nextSeo));
  return {
    valid: Boolean(payload?.valid),
    warnings: Array.isArray(payload?.warnings) ? payload.warnings : []
  };
}

export async function setAdminSeoImage(field, assetPath) {
  const payload = await api.post(`admin/seo/images/${encodeURIComponent(field)}`, {
    path: String(assetPath || "").trim()
  });
  const seo = asObject(payload?.seo);
  if (Object.keys(seo).length) {
    writeMemoryCache("admin-seo", seo);
    writeCache("admin-seo", seo);
    emitSync("admin-seo", seo);
  }
  return seo;
}

export async function removeAdminSeoImage(field) {
  const payload = await api.remove(`admin/seo/images/${encodeURIComponent(field)}`);
  const seo = asObject(payload?.seo);
  if (Object.keys(seo).length) {
    writeMemoryCache("admin-seo", seo);
    writeCache("admin-seo", seo);
    emitSync("admin-seo", seo);
  }
  return seo;
}

function persistAdminProfileLocally(profile) {
  const safeProfile = asObject(profile);
  if (!safeProfile.id && !safeProfile.email) {
    return safeProfile;
  }

  try {
    const existing = JSON.parse(window.localStorage.getItem("adminProfile") || "null") || {};
    const nextProfile = {
      ...existing,
      id: safeProfile.id || existing.id,
      email: safeProfile.email || existing.email,
      role: safeProfile.role || existing.role || "admin",
      name: safeProfile.name || existing.name,
      firstName: safeProfile.firstName || existing.firstName,
      lastName: safeProfile.lastName || existing.lastName,
      username: safeProfile.username || existing.username,
      avatar: safeProfile.avatar || "",
      avatarUrl: safeProfile.avatarUrl || "",
      status: safeProfile.status || existing.status,
      verified: Boolean(safeProfile.verified)
    };
    window.localStorage.setItem("adminProfile", JSON.stringify(nextProfile));
    if (nextProfile.email) {
      window.localStorage.setItem("adminEmail", nextProfile.email);
    }
    window.dispatchEvent(new CustomEvent("byose:admin-profile-updated", { detail: { profile: nextProfile } }));
  } catch (_error) {
    // Ignore local persistence failures.
  }

  return safeProfile;
}

export async function getAdminProfile(options = {}) {
  const force = options?.force === true;
  const cached = getCachedScopePayload("admin-profile");
  if (!force && cached && typeof cached === "object") {
    return asObject(cached);
  }

  const payload = await withRetry("admin/profile", () => api.get("admin/profile"));
  const profile = asObject(payload?.profile || payload);
  writeMemoryCache("admin-profile", profile);
  writeCache("admin-profile", profile);
  persistAdminProfileLocally(profile);
  emitSync("admin-profile", profile);
  return profile;
}

export async function updateAdminProfile(updates) {
  const payload = await api.put("admin/profile", asObject(updates));
  const profile = asObject(payload?.profile || payload);
  writeMemoryCache("admin-profile", profile);
  writeCache("admin-profile", profile);
  persistAdminProfileLocally(profile);
  emitSync("admin-profile", profile);
  return profile;
}

export async function uploadAdminProfilePhoto(avatarPath) {
  const payload = await api.post("admin/profile/photo", {
    avatar: normalizeText(avatarPath)
  });
  const profile = asObject(payload?.profile || payload);
  writeMemoryCache("admin-profile", profile);
  writeCache("admin-profile", profile);
  persistAdminProfileLocally(profile);
  emitSync("admin-profile", profile);
  return profile;
}

export async function removeAdminProfilePhoto() {
  const payload = await api.remove("admin/profile/photo");
  const profile = asObject(payload?.profile || payload);
  writeMemoryCache("admin-profile", profile);
  writeCache("admin-profile", profile);
  persistAdminProfileLocally(profile);
  emitSync("admin-profile", profile);
  return profile;
}

function getDeviceFingerprint() {
  if (window.AdminSecurity && typeof window.AdminSecurity.getDeviceFingerprint === "function") {
    return window.AdminSecurity.getDeviceFingerprint();
  }
  try {
    return String(window.localStorage.getItem("adminDeviceFingerprint") || "").trim();
  } catch (_error) {
    return "";
  }
}

export async function getAdminSecurityOverview(options = {}) {
  const force = options?.force === true;
  const cached = getCachedScopePayload("admin-security");
  if (!force && cached && typeof cached === "object") {
    return asObject(cached);
  }

  const payload = await withRetry("admin/security", () => api.get("admin/security"));
  const overview = asObject(payload);
  writeMemoryCache("admin-security", overview);
  writeCache("admin-security", overview);
  emitSync("admin-security", overview);
  return overview;
}

export async function getAdminSecuritySessions() {
  const payload = await api.get("admin/security/sessions");
  return asObject(payload);
}

export async function terminateAdminSession(sessionId, { confirmCurrent = false } = {}) {
  const encoded = encodeURIComponent(String(sessionId || "").trim());
  const suffix = confirmCurrent ? "?confirmCurrent=true" : "";
  const payload = await api.remove(`admin/security/sessions/${encoded}${suffix}`);
  emitSync("admin-security", null);
  return asObject(payload);
}

export async function logoutOtherAdminSessions() {
  const payload = await api.post("admin/security/sessions/logout-others", {});
  emitSync("admin-security", null);
  return asObject(payload);
}

export async function logoutAllAdminSessions({ confirmAll = true } = {}) {
  const payload = await api.post("admin/security/sessions/logout-all", {
    confirmAll: Boolean(confirmAll)
  });
  emitSync("admin-security", null);
  return asObject(payload);
}

export async function logoutSelectedAdminSessions(sessionIds, { confirmCurrent = false } = {}) {
  const payload = await api.post("admin/security/sessions/logout-selected", {
    sessionIds: Array.isArray(sessionIds) ? sessionIds : [],
    confirmCurrent: Boolean(confirmCurrent)
  });
  emitSync("admin-security", null);
  return asObject(payload);
}

export async function getAdminCurrentSession() {
  const payload = await api.get("admin/security/sessions/current");
  return asObject(payload);
}

export async function validateAdminSecuritySession() {
  const payload = await api.get("admin/security/sessions/validate");
  return asObject(payload);
}

export async function getAdminSessionPolicy() {
  const payload = await api.get("admin/security/sessions/policy");
  return asObject(payload?.policy || payload);
}

export async function updateAdminSessionPolicy(policy) {
  const payload = await api.put("admin/security/sessions/policy", asObject(policy));
  emitSync("admin-security", null);
  return asObject(payload?.policy || payload);
}

export async function getAdminLoginHistory(options = {}) {
  const query = new URLSearchParams();
  if (options.query) query.set("q", String(options.query));
  if (options.status) query.set("status", String(options.status));
  if (options.page) query.set("page", String(options.page));
  if (options.limit) query.set("limit", String(options.limit));
  if (options.sort) query.set("sort", String(options.sort));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const payload = await api.get(`admin/security/login-history${suffix}`);
  return asObject(payload);
}

export async function getAdminTrustedDevices() {
  const payload = await api.get("admin/security/trusted-devices");
  return asArray(payload?.devices);
}

export async function trustCurrentAdminDevice(payload = {}) {
  const body = {
    deviceFingerprint: payload.deviceFingerprint || getDeviceFingerprint(),
    deviceName: normalizeText(payload.deviceName, "Trusted device")
  };
  const response = await api.post("admin/security/trusted-devices", body);
  emitSync("admin-security", null);
  return asObject(response?.device || response);
}

export async function renameAdminTrustedDevice(deviceId, deviceName) {
  const payload = await api.put(`admin/security/trusted-devices/${encodeURIComponent(deviceId)}`, {
    deviceName: normalizeText(deviceName)
  });
  emitSync("admin-security", null);
  return asObject(payload?.device || payload);
}

export async function removeAdminTrustedDevice(deviceId) {
  const payload = await api.remove(`admin/security/trusted-devices/${encodeURIComponent(deviceId)}`);
  emitSync("admin-security", null);
  return asObject(payload?.device || payload);
}

export async function getAdminSecurityEvents(options = {}) {
  const query = new URLSearchParams();
  if (options.page) query.set("page", String(options.page));
  if (options.limit) query.set("limit", String(options.limit));
  if (options.eventType) query.set("type", String(options.eventType));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const payload = await api.get(`admin/security/events${suffix}`);
  return asObject(payload);
}

export async function getAdminTwoFactorStatus() {
  const payload = await api.get("admin/security/two-factor");
  return asObject(payload?.twoFactor || payload);
}

export async function updateAdminTwoFactorPlaceholder(enabled) {
  const payload = await api.put("admin/security/two-factor", { enabled: Boolean(enabled) });
  emitSync("admin-security", null);
  return asObject(payload?.twoFactor || payload);
}

export async function getAdminPasswordStatus(options = {}) {
  const force = options?.force === true;
  const cached = getCachedScopePayload("admin-password");
  if (!force && cached && typeof cached === "object") {
    return asObject(cached);
  }

  const payload = await withRetry("admin/password", () => api.get("admin/password"));
  const password = asObject(payload?.password || payload);
  writeMemoryCache("admin-password", password);
  writeCache("admin-password", password);
  emitSync("admin-password", password);
  return password;
}

export async function validateAdminPasswordStrength(password, currentPassword = "") {
  const payload = await api.post("admin/password/validate", {
    password: String(password || ""),
    currentPassword: String(currentPassword || "")
  });
  return asObject(payload?.strength || payload);
}

export async function verifyAdminCurrentPassword(currentPassword) {
  const payload = await api.post("admin/password/verify-current", {
    currentPassword: String(currentPassword || "")
  });
  return Boolean(payload?.valid || payload?.success);
}

export async function changeAdminPassword(payload = {}) {
  const response = await api.put("admin/password", {
    currentPassword: String(payload.currentPassword || ""),
    newPassword: String(payload.newPassword || ""),
    confirmPassword: String(payload.confirmPassword || "")
  });
  const password = asObject(response?.password || response);
  writeMemoryCache("admin-password", password);
  writeCache("admin-password", password);
  emitSync("admin-password", password);
  emitSync("admin-security", null);
  return {
    ...password,
    message: response?.message || "Password updated successfully.",
    revokedOtherSessions: Number(response?.revokedOtherSessions || 0) || 0
  };
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

export async function updateOrderStatus(orderId, status, options = {}) {
  const id = normalizeText(orderId);
  const nextStatus = normalizeText(status);
  const returnAction = normalizeText(options?.returnAction);
  const paymentStatus = normalizeText(options?.paymentStatus);
  if (!id || (!nextStatus && !returnAction && !paymentStatus)) {
    throw new Error("Order id and status (or returnAction / paymentStatus) are required.");
  }

  const body = {
    reason: normalizeText(options?.reason),
    cancellationReason: normalizeText(options?.cancellationReason || options?.reason),
    note: normalizeText(options?.note || options?.reason || options?.adminNotes),
    adminNotes: normalizeText(options?.adminNotes || options?.note || options?.reason),
    customerNotes: normalizeText(options?.customerNotes),
    productCondition: normalizeText(options?.productCondition),
    refundMethod: normalizeText(options?.refundMethod)
  };
  if (nextStatus) body.status = nextStatus;
  if (returnAction) body.returnAction = returnAction;
  if (paymentStatus) body.paymentStatus = paymentStatus;
  if (options?.refundAmount != null && options?.refundAmount !== "") {
    body.refundAmount = toNumber(options.refundAmount);
  }
  if (Array.isArray(options?.returnImages)) {
    body.returnImages = options.returnImages.map((image) => normalizeText(image)).filter(Boolean);
  }
  if (options?.inspectResult != null) body.inspectResult = normalizeText(options.inspectResult);
  if (options?.inspectPassed != null) body.inspectPassed = Boolean(options.inspectPassed);
  if (options?.restockEligible != null) body.restockEligible = Boolean(options.restockEligible);
  if (options?.reasonCode) body.reasonCode = normalizeText(options.reasonCode);

  const payload = await api.put(`admin/orders/${encodeURIComponent(id)}/status`, body);
  await resyncEnterpriseScopes(["orders", "products", "inventory", "analytics"]);
  return payload?.order || payload || null;
}

export async function getOrderById(orderId) {
  const id = normalizeText(orderId);
  if (!id) {
    throw new Error("Order id is required.");
  }
  const payload = await api.get(`admin/orders/${encodeURIComponent(id)}`);
  const normalized = normalizeOrder(payload?.order || payload);
  const requested = id.toLowerCase();
  const matches = [normalized.orderId, normalized.id, normalized.recordId]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .includes(requested);
  if (!matches) {
    throw new Error("Order lookup did not return the requested order.");
  }
  return normalized;
}

export async function getInvoiceVerification(orderId) {
  const id = normalizeText(orderId);
  if (!id) {
    throw new Error("Order id is required.");
  }
  const payload = await api.get(`admin/orders/${encodeURIComponent(id)}/verification`);
  return asObject(payload?.verification || payload);
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
      void refreshRealtimeIntelligence().catch((error) => {
        console.error("[Admin Data] Visibility intelligence refresh failed:", error);
      });
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
  void refreshRealtimeIntelligence().catch((error) => {
    console.error("[Admin Data] Initial realtime intelligence refresh failed:", error);
  });
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

let publishingGlobalProductSync = false;

function publishGlobalProductSync(products) {
  if (publishingGlobalProductSync || typeof window === "undefined" || !window.dispatchEvent) {
    return;
  }

  publishingGlobalProductSync = true;
  try {
    window.dispatchEvent(new CustomEvent("byose:products-synchronized", {
      detail: {
        products: Array.isArray(products) ? products : [],
        syncedAt: new Date().toISOString(),
        source: "admin"
      }
    }));

    window.dispatchEvent(new CustomEvent("byose:products-changed", {
      detail: { products: Array.isArray(products) ? products : [] }
    }));
  } finally {
    publishingGlobalProductSync = false;
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
