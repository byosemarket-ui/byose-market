import supabase from "../config/supabase.js";
import uploadService from "./uploadService.js";

export const GLOBAL_SYNC_EVENT = "byose:products-synchronized";
export const PRODUCT_CHANGED_EVENT = "byose:products-changed";

const PRODUCTS_TABLE = "products";
const DEFAULT_DETAIL_PAGE = "product-details1.html";
const STOREFRONT_CATALOG_STORAGE_KEY = "byose_market_products_catalog_v1";
const STALE_THRESHOLD_MS = 45000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_TIMEOUT_MS = 90000;

let cachedProducts = [];
let lastSnapshotAt = 0;
let hasHydratedCatalog = false;
let realtimeChannel = null;
let realtimeStarted = false;

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
  return normalizeText(value, "normal").toLowerCase() === "top" ? "top" : "normal";
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

function mapSupabaseError(error, fallbackMessage) {
  const message = String(error?.message || fallbackMessage || "Supabase request failed.").trim();

  if (/row-level security|policy/i.test(message)) {
    const normalized = new Error("Supabase write access is blocked by policy. Run the Supabase setup SQL or update RLS policies before saving products.");
    normalized.code = "SUPABASE_POLICY_BLOCKED";
    return normalized;
  }

  if (/bucket/i.test(message) && /not found|does not exist/i.test(message)) {
    const normalized = new Error("Supabase storage bucket 'products' is missing. Create it before uploading product images.");
    normalized.code = "SUPABASE_BUCKET_MISSING";
    return normalized;
  }

  if (/schema cache|column/i.test(message)) {
    const normalized = new Error("Supabase products table is missing required columns for this storefront. Apply the bootstrap SQL before saving products.");
    normalized.code = "SUPABASE_SCHEMA_MISMATCH";
    return normalized;
  }

  if (/relation .* does not exist|table .* not found/i.test(message)) {
    const normalized = new Error("Supabase products table is not available yet. Apply the bootstrap SQL before saving products.");
    normalized.code = "SUPABASE_TABLE_MISSING";
    return normalized;
  }

  return error instanceof Error ? error : new Error(message || fallbackMessage || "Supabase request failed.");
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
    supabaseId: normalizeText(source.id),
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
    mainImageStoragePath: normalizeText(source.main_image_storage_path ?? source.mainImageStoragePath),
    galleryStoragePaths: parseJsonArray(source.gallery_storage_paths ?? source.galleryStoragePaths),
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
    const leftPriority = String(left?.priority || "").toLowerCase() === "top" ? 1 : 0;
    const rightPriority = String(right?.priority || "").toLowerCase() === "top" ? 1 : 0;
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

function publishProducts(products, source = "supabase") {
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

  throw mapSupabaseError(lastError, `${label} failed.`);
}

async function getNextCatalogId() {
  const { data, error } = await withTimeout("Supabase product ID lookup", supabase
    .from(PRODUCTS_TABLE)
    .select("catalog_id")
    .order("catalog_id", { ascending: false })
    .limit(1));

  if (error) {
    throw mapSupabaseError(error, "Unable to generate the next product id.");
  }

  const current = Array.isArray(data) && data.length ? toNumber(data[0]?.catalog_id, 0) : 0;
  return current + 1;
}

async function findProductRow(identifier) {
  const catalogId = Math.max(0, Math.floor(toNumber(identifier, 0)));
  const { data, error } = await withTimeout("Supabase product lookup", supabase
    .from(PRODUCTS_TABLE)
    .select("*")
    .eq("catalog_id", catalogId)
    .maybeSingle());

  if (error) {
    throw mapSupabaseError(error, "Unable to load the product for update.");
  }

  return data ? normalizeProductRecord(data) : null;
}

async function resolveHeroAsset(productId, nextImage, previousProduct, onProgress) {
  const incomingImage = normalizeText(nextImage || previousProduct?.mainImage || previousProduct?.image);
  if (!incomingImage) {
    return {
      image: "",
      storagePath: "",
      obsoletePaths: previousProduct?.mainImageStoragePath ? [previousProduct.mainImageStoragePath] : []
    };
  }

  if (/^(?:https?:|\/|\.\/|\.\.\/)/i.test(incomingImage) && !/^data:/i.test(incomingImage)) {
    return {
      image: incomingImage,
      storagePath: normalizeText(previousProduct?.mainImageStoragePath),
      obsoletePaths: []
    };
  }

  const uploaded = await uploadService.uploadWithRetry(incomingImage, {
    productId,
    kind: "hero",
    onProgress,
    progressLabel: "Uploading hero image to Supabase..."
  });

  return {
    image: uploaded.url,
    storagePath: uploaded.path,
    obsoletePaths: previousProduct?.mainImageStoragePath && previousProduct.mainImageStoragePath !== uploaded.path
      ? [previousProduct.mainImageStoragePath]
      : []
  };
}

async function resolveGalleryAssets(productId, nextGallery, previousProduct, onProgress) {
  const gallery = asArray(nextGallery);
  const previousUrls = asArray(previousProduct?.gallery);
  const previousPaths = asArray(previousProduct?.galleryStoragePaths);
  const previousPathByUrl = new Map();
  previousUrls.forEach((url, index) => {
    const normalizedUrl = normalizeText(url);
    const normalizedPath = normalizeText(previousPaths[index]);
    if (normalizedUrl && normalizedPath) {
      previousPathByUrl.set(normalizedUrl, normalizedPath);
    }
  });

  const nextUrls = [];
  const nextPaths = [];

  for (let index = 0; index < gallery.length; index += 1) {
    const entry = normalizeText(gallery[index]);
    if (!entry) {
      continue;
    }

    if (/^(?:https?:|\/|\.\/|\.\.\/)/i.test(entry) && !/^data:/i.test(entry)) {
      nextUrls.push(entry);
      nextPaths.push(previousPathByUrl.get(entry) || "");
      continue;
    }

    const uploaded = await uploadService.uploadWithRetry(entry, {
      productId,
      kind: "gallery",
      index,
      total: gallery.length,
      onProgress,
      progressLabel: `Uploading gallery image ${index + 1} of ${gallery.length}...`
    });
    nextUrls.push(uploaded.url);
    nextPaths.push(uploaded.path);
  }

  const obsoletePaths = previousPaths.filter((path) => {
    const normalizedPath = normalizeText(path);
    return normalizedPath && !nextPaths.includes(normalizedPath);
  });

  return {
    gallery: nextUrls,
    galleryStoragePaths: nextPaths.filter(Boolean),
    obsoletePaths
  };
}

function buildSupabasePayload(productId, productData, assets, previousProduct = {}) {
  const name = normalizeText(productData?.name || productData?.title || previousProduct?.name, "Untitled product");
  const price = toNumber(productData?.price ?? previousProduct?.price, 0);
  const oldPrice = toNumber(productData?.oldPrice ?? previousProduct?.oldPrice, 0);
  const stock = Math.max(0, Math.floor(toNumber(productData?.stock ?? previousProduct?.stock, 0)));
  const visibility = normalizeVisibility(productData?.visibility ?? previousProduct?.visibility);
  const priority = normalizePriority(productData?.priority ?? previousProduct?.priority);
  const orderIndex = Math.max(0, Math.floor(toNumber(productData?.orderIndex ?? previousProduct?.orderIndex, 0)));
  const nowIso = new Date().toISOString();

  return {
    catalog_id: productId,
    name,
    title: name,
    description: normalizeText(productData?.description ?? previousProduct?.description),
    short_description: normalizeText(productData?.shortDescription ?? productData?.description ?? previousProduct?.shortDescription ?? previousProduct?.description),
    long_description: asArray(productData?.longDescription ?? previousProduct?.longDescription),
    badge: normalizeText(productData?.badge ?? previousProduct?.badge),
    category: normalizeText(productData?.category ?? previousProduct?.category, "general").toLowerCase(),
    price,
    old_price: oldPrice > price ? oldPrice : 0,
    stock,
    image: normalizeText(assets.image || productData?.image || previousProduct?.image),
    main_image: normalizeText(assets.image || productData?.mainImage || productData?.image || previousProduct?.mainImage || previousProduct?.image),
    gallery: asArray(assets.gallery || productData?.gallery || previousProduct?.gallery),
    keywords: asArray(productData?.keywords).length ? asArray(productData?.keywords) : buildKeywords(productData),
    highlights: asArray(productData?.highlights ?? previousProduct?.highlights),
    trust: asArray(productData?.trust ?? previousProduct?.trust),
    specs: asArray(productData?.specs ?? previousProduct?.specs),
    attributes: asArray(productData?.attributes ?? previousProduct?.attributes),
    variants: asObject(productData?.variants ?? previousProduct?.variants),
    visibility,
    priority,
    order_index: orderIndex,
    highlight_tag: normalizeText(productData?.highlightTag ?? previousProduct?.highlightTag).toLowerCase(),
    status: normalizeText(productData?.status ?? previousProduct?.status, "active").toLowerCase(),
    page: normalizeText(productData?.page ?? previousProduct?.page, DEFAULT_DETAIL_PAGE),
    url: `${DEFAULT_DETAIL_PAGE}?id=${encodeURIComponent(String(productId))}`,
    main_image_storage_path: normalizeText(assets.storagePath),
    gallery_storage_paths: asArray(assets.galleryStoragePaths),
    extra_info: asObject(productData?.extraInfo ?? previousProduct?.extraInfo),
    created_at: previousProduct?.createdAt || nowIso,
    updated_at: nowIso
  };
}

export async function fetchProductsFromBackend() {
  return forceRefreshProducts();
}

export async function forceRefreshProducts() {
  const { data, error } = await withTimeout("Supabase product refresh", supabase
    .from(PRODUCTS_TABLE)
    .select("*"));

  if (error) {
    throw mapSupabaseError(error, "Unable to refresh the product catalog from Supabase.");
  }

  return publishProducts(asArray(data), "supabase-refresh");
}

export async function getProducts() {
  if (hasHydratedCatalog) {
    return cachedProducts.slice();
  }

  return getProductsWithRetry();
}

export async function getProductsWithRetry() {
  try {
    return await withRetry("Supabase product fetch", () => forceRefreshProducts());
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
  if (realtimeStarted) {
    return Promise.resolve(() => stopProductLiveSync());
  }

  realtimeStarted = true;
  realtimeChannel = supabase
    .channel("byose-products-live")
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: PRODUCTS_TABLE
    }, () => {
      void forceRefreshProducts().catch((error) => {
        console.error("[Product Service] Realtime refresh failed:", error);
      });
    })
    .subscribe();

  return Promise.resolve(() => stopProductLiveSync());
}

export function stopProductLiveSync() {
  realtimeStarted = false;
  if (realtimeChannel) {
    void supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

export async function createProduct(productData = {}, options = {}) {
  const onProgress = options?.onProgress;
  reportProgress(onProgress, "Preparing product save to Supabase...");
  const productId = await getNextCatalogId();
  const heroImage = await resolveHeroAsset(productId, productData?.mainImage || productData?.image, null, onProgress);
  const galleryAssets = await resolveGalleryAssets(productId, productData?.gallery, null, onProgress);
  const payload = buildSupabasePayload(productId, productData, {
    image: heroImage.image,
    storagePath: heroImage.storagePath,
    gallery: galleryAssets.gallery,
    galleryStoragePaths: galleryAssets.galleryStoragePaths
  });

  reportProgress(onProgress, "Saving product record to Supabase...");
  const { data, error } = await withTimeout("Supabase product create", supabase
    .from(PRODUCTS_TABLE)
    .insert(payload)
    .select("*")
    .single());

  if (error) {
    throw mapSupabaseError(error, "Unable to save the new product to Supabase.");
  }

  const createdProduct = normalizeProductRecord(data);
  publishProducts([...cachedProducts.filter((product) => Number(product.id) !== Number(createdProduct.id)), createdProduct], "supabase-create");
  reportProgress(onProgress, "Product saved successfully to Supabase.", { phase: "completed" });
  return createdProduct;
}

export async function updateProduct(productId, productData = {}, options = {}) {
  const onProgress = options?.onProgress;
  const catalogId = Math.max(0, Math.floor(toNumber(productId, 0)));
  if (!catalogId) {
    throw new Error("Product id is required.");
  }

  reportProgress(onProgress, "Loading product from Supabase for update...");
  const previousProduct = await findProductRow(catalogId);

  if (!previousProduct) {
    return createProduct({ ...productData, catalogId }, options);
  }

  const heroImage = await resolveHeroAsset(catalogId, productData?.mainImage || productData?.image, previousProduct, onProgress);
  const galleryAssets = await resolveGalleryAssets(catalogId, Object.prototype.hasOwnProperty.call(productData, "gallery") ? productData.gallery : previousProduct.gallery, previousProduct, onProgress);
  const payload = buildSupabasePayload(catalogId, productData, {
    image: heroImage.image,
    storagePath: heroImage.storagePath,
    gallery: galleryAssets.gallery,
    galleryStoragePaths: galleryAssets.galleryStoragePaths
  }, previousProduct);

  reportProgress(onProgress, "Updating product record in Supabase...");
  const { data, error } = await withTimeout("Supabase product update", supabase
    .from(PRODUCTS_TABLE)
    .update(payload)
    .eq("catalog_id", catalogId)
    .select("*")
    .single());

  if (error) {
    throw mapSupabaseError(error, "Unable to update the product in Supabase.");
  }

  const obsoletePaths = [...heroImage.obsoletePaths, ...galleryAssets.obsoletePaths].filter(Boolean);
  if (obsoletePaths.length) {
    try {
      await uploadService.removeStoredAssets(obsoletePaths);
    } catch (error) {
      console.warn("[Product Service] Failed to clean old product assets:", error);
    }
  }

  const updatedProduct = normalizeProductRecord(data);
  publishProducts([...cachedProducts.filter((product) => Number(product.id) !== Number(updatedProduct.id)), updatedProduct], "supabase-update");
  reportProgress(onProgress, "Product updated successfully in Supabase.", { phase: "completed" });
  return updatedProduct;
}

export async function deleteProduct(productId, options = {}) {
  const onProgress = options?.onProgress;
  const catalogId = Math.max(0, Math.floor(toNumber(productId, 0)));
  if (!catalogId) {
    throw new Error("Product id is required.");
  }

  const existingProduct = await findProductRow(catalogId);
  reportProgress(onProgress, "Deleting product from Supabase...");

  const { error } = await withTimeout("Supabase product delete", supabase
    .from(PRODUCTS_TABLE)
    .delete()
    .eq("catalog_id", catalogId));

  if (error) {
    throw mapSupabaseError(error, "Unable to delete the product from Supabase.");
  }

  if (existingProduct) {
    const paths = [existingProduct.mainImageStoragePath, ...asArray(existingProduct.galleryStoragePaths)].filter(Boolean);
    if (paths.length) {
      try {
        await uploadService.removeStoredAssets(paths);
      } catch (cleanupError) {
        console.warn("[Product Service] Failed to remove Supabase storage assets:", cleanupError);
      }
    }
  }

  const products = cachedProducts.filter((product) => Number(product.id) !== catalogId && Number(product.catalogId) !== catalogId);
  publishProducts(products, "supabase-delete");
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