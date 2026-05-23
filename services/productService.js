export const GLOBAL_SYNC_EVENT = "byose:products-synchronized";
export const PRODUCT_CHANGED_EVENT = "byose:products-changed";

const DEFAULT_DETAIL_PAGE = "product-details1.html";
const STOREFRONT_CATALOG_STORAGE_KEY = "byose_market_products_catalog_v1";
const STALE_THRESHOLD_MS = 45000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_TIMEOUT_MS = 90000;
const LIVE_SYNC_INTERVAL_MS = 30000;

let cachedProducts = [];
let lastSnapshotAt = 0;
let hasHydratedCatalog = false;
let liveSyncTimerId = null;
let liveSyncStarted = false;
let liveSyncAbortController = null;
let detachLiveSyncListeners = null;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toIsoString(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeVisibility(value) {
  const normalized = normalizeText(value, "both").toLowerCase();
  if (normalized === "all") {
    return "both";
  }

  return ["home", "shop", "both"].includes(normalized) ? normalized : "both";
}

function normalizePriority(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.floor(value);
    return normalized === 2 ? 2 : normalized === 1 ? 1 : 0;
  }

  const normalizedText = normalizeText(value).toLowerCase();
  if (!normalizedText || normalizedText === "normal") {
    return 0;
  }

  if (normalizedText === "top") {
    return 1;
  }

  if (normalizedText === "featured") {
    return 2;
  }

  const parsed = Number(normalizedText);
  if (Number.isFinite(parsed)) {
    const normalized = Math.floor(parsed);
    return normalized === 2 ? 2 : normalized === 1 ? 1 : 0;
  }

  return 0;
}

function buildKeywords(product) {
  const keywords = new Set();
  [product?.name, product?.title, product?.category, ...(asArray(product?.highlights)), ...(asArray(product?.trust))]
    .join(" ")
    .split(/\s+/)
    .map((entry) => normalizeText(entry).toLowerCase())
    .filter(Boolean)
    .forEach((entry) => keywords.add(entry));
  return Array.from(keywords);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  return [];
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  return {};
}

function normalizeManagedUploadPath(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  if (normalized.startsWith("/uploads/")) {
    return normalized.slice("/uploads/".length).replace(/^\/+/, "");
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.pathname.startsWith("/uploads/")) {
      return parsed.pathname.slice("/uploads/".length).replace(/^\/+/, "");
    }
  } catch (_error) {
    // Ignore URL parsing failures.
  }

  return "";
}

function readStoredProducts() {
  if (typeof window === "undefined") {
    return cachedProducts.slice();
  }

  try {
    const raw = window.localStorage.getItem(STOREFRONT_CATALOG_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return asArray(parsed);
  } catch (_error) {
    return [];
  }
}

function writeStoredProducts(products) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STOREFRONT_CATALOG_STORAGE_KEY, JSON.stringify(products));
  } catch (_error) {
    // Ignore storage failures.
  }
}

function createTimeoutError(label, timeoutMs) {
  const error = new Error(`${label} timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
  error.code = "OPERATION_TIMEOUT";
  return error;
}

async function withTimeout(label, promise, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let timerId = null;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timerId = window.setTimeout(() => reject(createTimeoutError(label, timeoutMs)), timeoutMs);
      })
    ]);
  } finally {
    if (timerId) {
      window.clearTimeout(timerId);
    }
  }
}

function reportProgress(onProgress, message, extra = {}) {
  if (typeof onProgress === "function") {
    onProgress({ message, ...extra });
  }
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

function fallbackMessageForStatus(status) {
  if (status === 401) {
    return "Admin authentication is required for this action.";
  }

  if (status === 403) {
    return "Admin access is required for this action.";
  }

  if (status === 404) {
    return "The requested product resource was not found.";
  }

  return "The backend request failed.";
}

function mapApiError(error, fallbackMessage) {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error?.message || fallbackMessage || "API request failed."));
}

async function apiRequest(path, options = {}) {
  const url = /^https?:/i.test(String(path || "")) ? String(path) : buildApiUrl(path);
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const token = options.requiresAdmin ? getAdminToken() : "";
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const requestPromise = fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: controller?.signal
  }).then(async (response) => {
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : await response.text().catch(() => "");

    if (!response.ok) {
      const error = new Error(payload?.message || fallbackMessageForStatus(response.status));
      error.status = response.status;
      error.payload = payload;
      error.code = String(payload?.code || "").trim();
      throw error;
    }

    return payload;
  });

  return withTimeout(
    `API request ${options.method || "GET"} ${path}`,
    requestPromise.finally(() => controller?.abort()),
    timeoutMs
  );
}

function normalizeProductRecord(record) {
  const source = asObject(record);
  const catalogId = Math.max(0, Math.floor(toNumber(source.catalog_id ?? source.catalogId ?? source.id, 0)));
  const mainImage = normalizeText(source.main_image ?? source.mainImage ?? source.image);
  const gallery = asArray(parseJsonArray(source.gallery).map((entry) => normalizeText(entry))).filter(Boolean);
  const createdAt = toIsoString(source.created_at ?? source.createdAt) || new Date().toISOString();
  const updatedAt = toIsoString(source.updated_at ?? source.updatedAt) || createdAt;
  const visibility = normalizeVisibility(source.visibility);
  const price = toNumber(source.price, 0);
  const oldPrice = toNumber(source.old_price ?? source.oldPrice, 0);

  return {
    ...source,
    id: catalogId,
    catalogId,
    name: normalizeText(source.name || source.title, "Untitled product"),
    title: normalizeText(source.title || source.name, "Untitled product"),
    description: normalizeText(source.description || source.short_description || source.shortDescription),
    shortDescription: normalizeText(source.short_description ?? source.shortDescription ?? source.description),
    longDescription: parseJsonArray(source.long_description ?? source.longDescription),
    badge: normalizeText(source.badge),
    category: normalizeText(source.category, "general").toLowerCase(),
    price,
    oldPrice: oldPrice > price ? oldPrice : 0,
    stock: Math.max(0, Math.floor(toNumber(source.stock, 0))),
    availableStock: Math.max(0, Math.floor(toNumber(source.stock, 0))),
    image: mainImage,
    mainImage,
    gallery,
    keywords: parseJsonArray(source.keywords).length ? parseJsonArray(source.keywords) : buildKeywords(source),
    highlights: parseJsonArray(source.highlights),
    trust: parseJsonArray(source.trust),
    specs: parseJsonArray(source.specs),
    attributes: parseJsonArray(source.attributes),
    variants: parseJsonObject(source.variants),
    visibility,
    priority: normalizePriority(source.priority),
    orderIndex: Math.max(0, Math.floor(toNumber(source.order_index ?? source.orderIndex, 0))),
    highlightTag: normalizeText(source.highlight_tag ?? source.highlightTag).toLowerCase(),
    status: normalizeText(source.status, "active"),
    page: normalizeText(source.page, DEFAULT_DETAIL_PAGE),
    url: normalizeText(source.url, `${DEFAULT_DETAIL_PAGE}?id=${encodeURIComponent(String(catalogId || ""))}`),
    createdAt,
    updatedAt,
    mainImageStoragePath: normalizeText(source.main_image_storage_path ?? source.mainImageStoragePath) || normalizeManagedUploadPath(mainImage),
    galleryStoragePaths: (parseJsonArray(source.gallery_storage_paths ?? source.galleryStoragePaths).length
      ? parseJsonArray(source.gallery_storage_paths ?? source.galleryStoragePaths)
      : gallery.map((entry) => normalizeManagedUploadPath(entry)).filter(Boolean)),
    extraInfo: parseJsonObject(source.extra_info ?? source.extraInfo),
    inventory: asObject(source.inventory) || {
      available: Math.max(0, Math.floor(toNumber(source.stock, 0))),
      totalAvailable: Math.max(0, Math.floor(toNumber(source.stock, 0))),
      status: Math.max(0, Math.floor(toNumber(source.stock, 0))) > 0 ? "in_stock" : "out_of_stock"
    }
  };
}

function sortProducts(products) {
  return products.slice().sort((left, right) => {
    const leftPriority = normalizePriority(left?.priority);
    const rightPriority = normalizePriority(right?.priority);
    if (leftPriority !== rightPriority) {
      return rightPriority - leftPriority;
    }

    const rightOrder = toNumber(right?.orderIndex, 0);
    const leftOrder = toNumber(left?.orderIndex, 0);
    if (leftOrder !== rightOrder) {
      return rightOrder - leftOrder;
    }

    return String(right?.updatedAt || "").localeCompare(String(left?.updatedAt || ""));
  });
}

function publishProducts(products, source = "api") {
  const normalizedProducts = sortProducts(asArray(products).map((product) => normalizeProductRecord(product)));
  cachedProducts = normalizedProducts;
  lastSnapshotAt = Date.now();
  hasHydratedCatalog = true;
  writeStoredProducts(normalizedProducts);

  if (typeof window !== "undefined" && window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent(GLOBAL_SYNC_EVENT, {
      detail: {
        products: normalizedProducts.slice(),
        syncedAt: new Date().toISOString(),
        source
      }
    }));

    window.dispatchEvent(new CustomEvent(PRODUCT_CHANGED_EVENT, {
      detail: {
        products: normalizedProducts.slice(),
        syncedAt: new Date().toISOString(),
        source
      }
    }));
  }

  return normalizedProducts;
}

async function withRetry(label, action, retryCount = DEFAULT_RETRY_COUNT) {
  let lastError = null;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await action(attempt);
    } catch (error) {
      lastError = error;
    }
  }

  throw mapApiError(lastError, `${label} failed.`);
}

function isDirectAssetReference(value) {
  return /^(?:data:|blob:|https?:|\/|\.\/|\.\.\/)/i.test(normalizeText(value));
}

function normalizeGalleryEntries(entries = []) {
  return asArray(entries)
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
    .filter((entry, index, values) => values.indexOf(entry) === index);
}

function prepareAssetFields(productData = {}, previousProduct = {}) {
  const nextMainImage = normalizeText(
    productData.mainImage
      ?? productData.image
      ?? previousProduct.mainImage
      ?? previousProduct.image
  );
  const nextGallery = normalizeGalleryEntries(
    Object.prototype.hasOwnProperty.call(productData, "gallery")
      ? productData.gallery
      : (previousProduct.gallery || [])
  );

  return {
    image: isDirectAssetReference(nextMainImage) ? nextMainImage : normalizeText(previousProduct.image),
    mainImage: isDirectAssetReference(nextMainImage) ? nextMainImage : normalizeText(previousProduct.mainImage ?? previousProduct.image),
    gallery: nextGallery.filter((entry) => isDirectAssetReference(entry))
  };
}

function buildApiPayload(productData, previousProduct = {}) {
  const assets = prepareAssetFields(productData, previousProduct);
  const name = normalizeText(productData?.name || productData?.title || previousProduct?.name, "Untitled product");
  const price = toNumber(productData?.price ?? previousProduct?.price, 0);
  const oldPrice = toNumber(productData?.oldPrice ?? previousProduct?.oldPrice, 0);
  const catalogId = Math.max(0, Math.floor(toNumber(productData?.catalogId ?? productData?.id ?? previousProduct?.catalogId ?? previousProduct?.id, 0)));

  return {
    ...(catalogId ? { catalogId } : {}),
    name,
    title: name,
    description: normalizeText(productData?.description ?? previousProduct?.description),
    shortDescription: normalizeText(productData?.shortDescription ?? productData?.description ?? previousProduct?.shortDescription ?? previousProduct?.description),
    longDescription: asArray(productData?.longDescription ?? previousProduct?.longDescription),
    badge: normalizeText(productData?.badge ?? previousProduct?.badge),
    category: normalizeText(productData?.category ?? previousProduct?.category, "general").toLowerCase(),
    price,
    oldPrice: oldPrice > price ? oldPrice : 0,
    stock: Math.max(0, Math.floor(toNumber(productData?.stock ?? previousProduct?.stock, 0))),
    image: assets.image,
    mainImage: assets.mainImage,
    gallery: assets.gallery,
    keywords: asArray(productData?.keywords).length ? asArray(productData?.keywords) : buildKeywords(productData),
    highlights: asArray(productData?.highlights ?? previousProduct?.highlights),
    trust: asArray(productData?.trust ?? previousProduct?.trust),
    specs: asArray(productData?.specs ?? previousProduct?.specs),
    attributes: asArray(productData?.attributes ?? previousProduct?.attributes),
    variants: asObject(productData?.variants ?? previousProduct?.variants),
    visibility: normalizeVisibility(productData?.visibility ?? previousProduct?.visibility),
    priority: normalizePriority(productData?.priority ?? previousProduct?.priority),
    orderIndex: Math.max(0, Math.floor(toNumber(productData?.orderIndex ?? previousProduct?.orderIndex, 0))),
    highlightTag: normalizeText(productData?.highlightTag ?? previousProduct?.highlightTag).toLowerCase(),
    status: normalizeText(productData?.status ?? previousProduct?.status, "active").toLowerCase(),
    page: normalizeText(productData?.page ?? previousProduct?.page, DEFAULT_DETAIL_PAGE),
    extraInfo: asObject(productData?.extraInfo ?? previousProduct?.extraInfo),
    mainImageStoragePath: "",
    galleryStoragePaths: []
  };
}

async function fetchCatalogSnapshot(signal) {
  const payload = await apiRequest("/api/products?limit=500", {
    method: "GET",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    signal
  });

  return publishProducts(asArray(payload?.products), "api-refresh");
}

function scheduleLiveSync() {
  if (typeof window === "undefined") {
    return;
  }

  if (liveSyncTimerId) {
    window.clearInterval(liveSyncTimerId);
  }

  liveSyncTimerId = window.setInterval(() => {
    void forceRefreshProducts({ silent: true }).catch((error) => {
      console.error("[Product Service] Background refresh failed:", error);
    });
  }, LIVE_SYNC_INTERVAL_MS);
}

function attachLiveSyncListeners() {
  if (typeof window === "undefined") {
    return;
  }

  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible" && isCacheStale()) {
      void forceRefreshProducts({ silent: true }).catch((error) => {
        console.error("[Product Service] Visibility refresh failed:", error);
      });
    }
  };

  const handleOnline = () => {
    void forceRefreshProducts({ silent: true }).catch((error) => {
      console.error("[Product Service] Online refresh failed:", error);
    });
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("online", handleOnline);

  detachLiveSyncListeners = () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("online", handleOnline);
    detachLiveSyncListeners = null;
  };
}

export async function fetchProductsFromBackend() {
  return forceRefreshProducts();
}

export async function forceRefreshProducts(options = {}) {
  if (liveSyncAbortController) {
    liveSyncAbortController.abort();
  }

  liveSyncAbortController = typeof AbortController !== "undefined" ? new AbortController() : null;

  try {
    return await fetchCatalogSnapshot(liveSyncAbortController?.signal);
  } catch (error) {
    if (!options?.silent) {
      throw mapApiError(error, "Unable to refresh the product catalog from the backend.");
    }

    throw error;
  } finally {
    liveSyncAbortController = null;
  }
}

export async function getProducts() {
  if (hasHydratedCatalog) {
    return cachedProducts.slice();
  }

  return getProductsWithRetry();
}

export async function getProductsWithRetry() {
  try {
    return await withRetry("Backend product fetch", () => forceRefreshProducts());
  } catch (error) {
    const cached = readStoredProducts();
    if (cached.length) {
      return publishProducts(cached, "cache-fallback");
    }

    throw error;
  }
}

export function getCachedProducts() {
  return cachedProducts.slice();
}

export function getLastSnapshotAt() {
  return lastSnapshotAt;
}

export function isCacheStale() {
  return !lastSnapshotAt || Date.now() - lastSnapshotAt > STALE_THRESHOLD_MS;
}

export function subscribeToProducts(onProducts, onError) {
  ensureProductLiveSync();

  const listener = (event) => {
    if (typeof onProducts === "function") {
      onProducts(asArray(event?.detail?.products));
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener(GLOBAL_SYNC_EVENT, listener);
  }

  Promise.resolve().then(async () => {
    try {
      const products = await getProductsWithRetry();
      if (typeof onProducts === "function") {
        onProducts(products.slice());
      }
    } catch (error) {
      if (typeof onError === "function") {
        onError(error);
      }
    }
  });

  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener(GLOBAL_SYNC_EVENT, listener);
    }
  };
}

export function ensureProductLiveSync() {
  if (liveSyncStarted) {
    return Promise.resolve(() => stopProductLiveSync());
  }

  liveSyncStarted = true;
  scheduleLiveSync();
  attachLiveSyncListeners();

  return Promise.resolve(() => stopProductLiveSync());
}

export function stopProductLiveSync() {
  liveSyncStarted = false;

  if (liveSyncTimerId && typeof window !== "undefined") {
    window.clearInterval(liveSyncTimerId);
  }

  liveSyncTimerId = null;

  if (typeof detachLiveSyncListeners === "function") {
    detachLiveSyncListeners();
  }

  if (liveSyncAbortController) {
    liveSyncAbortController.abort();
    liveSyncAbortController = null;
  }
}

export async function createProduct(productData = {}, options = {}) {
  const onProgress = options?.onProgress;
  reportProgress(onProgress, "Preparing product save to backend...");

  const payload = buildApiPayload(productData);
  reportProgress(onProgress, "Saving product record to backend...");
  const response = await apiRequest("/api/admin/products", {
    method: "POST",
    body: payload,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    requiresAdmin: true
  });

  const createdProduct = normalizeProductRecord(response?.product);
  publishProducts([...cachedProducts.filter((product) => Number(product.id) !== Number(createdProduct.id)), createdProduct], "api-create");
  reportProgress(onProgress, "Product saved successfully to backend.", { phase: "completed" });
  return createdProduct;
}

export async function updateProduct(productId, productData = {}, options = {}) {
  const onProgress = options?.onProgress;
  const catalogId = Math.max(0, Math.floor(toNumber(productId, 0)));
  if (!catalogId) {
    throw new Error("Product id is required.");
  }

  const previousProduct = cachedProducts.find((product) => Number(product.id) === catalogId || Number(product.catalogId) === catalogId) || {};
  const payload = buildApiPayload(productData, previousProduct);
  reportProgress(onProgress, "Updating product record in backend...");
  const response = await apiRequest(`/api/admin/products/${encodeURIComponent(String(catalogId))}`, {
    method: "PUT",
    body: payload,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    requiresAdmin: true
  });

  const updatedProduct = normalizeProductRecord(response?.product);
  publishProducts([...cachedProducts.filter((product) => Number(product.id) !== Number(updatedProduct.id)), updatedProduct], "api-update");
  reportProgress(onProgress, "Product updated successfully in backend.", { phase: "completed" });
  return updatedProduct;
}

export async function deleteProduct(productId, options = {}) {
  const onProgress = options?.onProgress;
  const catalogId = Math.max(0, Math.floor(toNumber(productId, 0)));
  if (!catalogId) {
    throw new Error("Product id is required.");
  }

  reportProgress(onProgress, "Deleting product from backend...");
  await apiRequest(`/api/admin/products/${encodeURIComponent(String(catalogId))}`, {
    method: "DELETE",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    requiresAdmin: true
  });

  const products = cachedProducts.filter((product) => Number(product.id) !== catalogId && Number(product.catalogId) !== catalogId);
  publishProducts(products, "api-delete");
  return { id: catalogId, products };
}

export async function handleAdminProductUpdate() {
  return forceRefreshProducts();
}

export default {
  GLOBAL_SYNC_EVENT,
  PRODUCT_CHANGED_EVENT,
  fetchProductsFromBackend,
  getProducts,
  getProductsWithRetry,
  getCachedProducts,
  getLastSnapshotAt,
  isCacheStale,
  forceRefreshProducts,
  subscribeToProducts,
  ensureProductLiveSync,
  stopProductLiveSync,
  createProduct,
  updateProduct,
  deleteProduct,
  handleAdminProductUpdate,
  startBackgroundSync: ensureProductLiveSync,
  stopBackgroundSync: stopProductLiveSync
};