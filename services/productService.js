export const GLOBAL_SYNC_EVENT = "byose:products-synchronized";
export const PRODUCT_CHANGED_EVENT = "byose:products-changed";

import { buildApiUrl, ensureUploadCapableApiBaseUrl, resolveApiBaseUrl } from "./api-origin.js";
import { normalizeStorefrontAssetList, normalizeStorefrontAssetUrl, purgeLegacyStorefrontCatalogCache, resolveProductImageUrl } from "./storefront-asset-url.js";
import { enrichProductColorVariants } from "../js/color-variant-inventory.js";
import { detectStorefrontVisibilityIssues } from "../js/product-visibility.js";
import { traceStorefrontStage } from "../js/storefront-pipeline-trace.js";

if (typeof window !== "undefined") {
  window.addEventListener("load", () => {
    console.debug("[ProductCatalog] API base:", resolveApiBaseUrl());
  }, { once: true });
}

const DEFAULT_DETAIL_PAGE = "details/product-details1.html";
const STOREFRONT_CATALOG_STORAGE_KEY = "byose_market_products_catalog_v4";

purgeLegacyStorefrontCatalogCache(STOREFRONT_CATALOG_STORAGE_KEY);
const STALE_THRESHOLD_MS = 120000;
const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_TIMEOUT_MS = 8000;
const LIVE_SYNC_INTERVAL_MS = 90000;
const STOREFRONT_CATALOG_QUERY = "products?limit=120&fields=card";

let cachedProducts = [];
let lastSnapshotAt = 0;
let hasHydratedCatalog = false;
let liveSyncTimerId = null;
let liveSyncStarted = false;
let liveSyncAbortController = null;
let detachLiveSyncListeners = null;
let catalogFetchInFlight = null;
let lastStoredFingerprint = "";

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
    return Math.max(0, Math.min(100, Math.floor(value)));
  }

  const normalizedText = normalizeText(value);
  if (!normalizedText || normalizedText === "normal" || normalizedText === "automatic") {
    return 50;
  }

  if (normalizedText === "top" || normalizedText === "featured") {
    return 90;
  }

  if (normalizedText === "middle") {
    return 50;
  }

  if (normalizedText === "bottom" || normalizedText === "low") {
    return 10;
  }

  const parsed = Number(String(value || "").trim());
  if (Number.isFinite(parsed)) {
    return Math.max(0, Math.min(100, Math.floor(parsed)));
  }

  return 50;
}

function buildKeywords(product) {
  const keywords = new Set();
  [product?.name, product?.title, product?.category, ...(asArray(product?.highlights)), ...(asArray(product?.trust)), ...(asArray(product?.tags))]
    .join(" ")
    .split(/\s+/)
    .map((entry) => normalizeText(entry).toLowerCase())
    .filter(Boolean)
    .forEach((entry) => keywords.add(entry));
  return Array.from(keywords);
}

function uniqueKeywordList(productData, previousProduct = {}) {
  const keywords = new Set([
    ...buildKeywords(productData),
    ...asArray(productData?.tags),
    ...asArray(previousProduct?.tags),
    ...asArray(previousProduct?.keywords)
  ].map((entry) => normalizeText(entry).toLowerCase()).filter(Boolean));
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

  if (/^(?:products|categories|users|reviews|temp)\//i.test(normalized)) {
    return normalized.replace(/^\/+/, "");
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
    return asArray(parsed).map((entry) => normalizeProductRecord(entry));
  } catch (_error) {
    return [];
  }
}

function writeStoredProducts(products) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const fingerprint = `${products.length}:${products.map((entry) => `${entry.id}:${entry.updatedAt || ''}:${entry.price || 0}:${entry.stock || 0}:${entry.name || ''}:${entry.mainImage || entry.image || ''}`).join("|")}`;
    if (fingerprint === lastStoredFingerprint) {
      return;
    }

    window.localStorage.setItem(STOREFRONT_CATALOG_STORAGE_KEY, JSON.stringify(products));
    lastStoredFingerprint = fingerprint;
  } catch (_error) {
    // Ignore storage failures.
  }
}

function createTimeoutError(label, timeoutMs) {
  const error = new Error(`${label} timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
  error.code = "OPERATION_TIMEOUT";
  return error;
}

async function withTimeout(label, promise, timeoutMs = DEFAULT_TIMEOUT_MS, onTimeout) {
  let timerId = null;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timerId = window.setTimeout(() => {
          if (typeof onTimeout === "function") {
            onTimeout();
          }
          reject(createTimeoutError(label, timeoutMs));
        }, timeoutMs);
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
  const url = buildApiUrl(path);
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const token = options.requiresAdmin ? getAdminToken() : "";
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const method = options.method || "GET";
  if (options.signal && controller) {
    if (options.signal.aborted) {
      controller.abort();
    } else if (typeof options.signal.addEventListener === "function") {
      options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  const requestPromise = fetch(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: controller?.signal,
    cache: options.cache || "default"
  }).then(async (response) => {
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : await response.text().catch(() => "");

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        if (typeof window !== "undefined" && window.AdminSecurity && typeof window.AdminSecurity.handleUnauthorized === "function") {
          window.AdminSecurity.handleUnauthorized();
        }
      }

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
    requestPromise,
    timeoutMs,
    () => controller?.abort()
  );
}

function resolveComparePrice(source, price) {
  const candidates = [
    source.old_price,
    source.oldPrice,
    source.compareAtPrice,
    source.originalPrice,
    source.discountPrice,
    source.metadata?.compareAtPrice,
    source.metadata?.originalPrice
  ];

  for (const candidate of candidates) {
    const parsed = toNumber(candidate, 0);
    if (parsed > price) {
      return parsed;
    }
  }

  return 0;
}

function resolveProductImages(source) {
  const galleryRaw = asArray(parseJsonArray(source.gallery).map((entry) => normalizeText(entry)))
    .filter((entry) => entry && !isCompanyLogoUrl(entry));
  const galleryStorageRaw = asArray(parseJsonArray(source.gallery_storage_paths ?? source.galleryStoragePaths))
    .map((entry) => normalizeText(entry))
    .filter((entry) => entry && !isCompanyLogoUrl(entry));

  const resolvedMainImage = firstNonEmpty(
    source.cardImage,
    source.card_image,
    source.main_image,
    source.mainImage,
    source.image,
    source.thumbnail,
    galleryRaw[0],
    galleryStorageRaw[0]
  );

  const mainImage = resolveProductImageUrl({
    mainImage: resolvedMainImage,
    image: resolvedMainImage,
    thumbnail: source.thumbnail,
    gallery: galleryRaw,
    mainImageStoragePath: source.main_image_storage_path ?? source.mainImageStoragePath ?? source.imageStoragePath,
    imageStoragePath: source.image_storage_path ?? source.imageStoragePath,
    galleryStoragePaths: galleryStorageRaw
  });

  const gallery = normalizeStorefrontAssetList([
    mainImage,
    ...galleryRaw,
    ...galleryStorageRaw
  ]);

  return {
    mainImage: mainImage || gallery[0] || "",
    image: mainImage || gallery[0] || "",
    gallery
  };
}

function isCardLikePayload(source) {
  if (!source || typeof source !== "object") {
    return true;
  }

  // Full product serialization always includes these keys. Card list payloads omit them.
  if (
    Object.prototype.hasOwnProperty.call(source, "shortDescription")
    || Object.prototype.hasOwnProperty.call(source, "keywords")
    || Object.prototype.hasOwnProperty.call(source, "galleryStoragePaths")
    || Object.prototype.hasOwnProperty.call(source, "attributes")
  ) {
    return false;
  }

  const variants = source.variants;
  const attributes = source.attributes;
  const emptyVariants = !variants
    || variants === "{}"
    || (typeof variants === "object" && !Array.isArray(variants) && Object.keys(variants).length === 0);
  const emptyAttributes = !attributes
    || attributes === "[]"
    || (Array.isArray(attributes) && attributes.length === 0);
  return emptyVariants && emptyAttributes && !source.colorVariants && !source.color_variants;
}

function normalizeProductRecord(record) {
  const source = asObject(record);
  const catalogId = Math.max(0, Math.floor(toNumber(source.catalog_id ?? source.catalogId ?? source.id, 0)));
  const images = resolveProductImages(source);
  const mainImage = images.mainImage;
  const gallery = images.gallery;
  const createdAt = toIsoString(source.created_at ?? source.createdAt) || new Date().toISOString();
  const updatedAt = toIsoString(source.updated_at ?? source.updatedAt) || createdAt;
  const visibility = normalizeVisibility(source.visibility);
  const price = toNumber(source.price ?? source.salePrice, 0);
  const resolvedOldPrice = resolveComparePrice(source, price);
  const oldPrice = resolvedOldPrice > price ? resolvedOldPrice : 0;
  const metadataObject = parseJsonObject(source.metadata);
  const storedDiscountPercent = toNumber(metadataObject.discountPercent, NaN);
  const discountPercent = Number.isFinite(storedDiscountPercent) && storedDiscountPercent > 0
    ? Math.max(0, Math.min(100, Math.floor(storedDiscountPercent)))
    : (oldPrice > price ? Math.round(((oldPrice - price) / oldPrice) * 100) : 0);
  const cardLike = isCardLikePayload(source);
  const placementList = parseJsonArray(metadataObject.placement).length
    ? parseJsonArray(metadataObject.placement)
    : parseJsonArray(metadataObject.placements);

  const baseRecord = {
    ...source,
    id: catalogId,
    catalogId,
    name: normalizeText(source.name || source.title, "Untitled product"),
    title: normalizeText(source.title || source.name, "Untitled product"),
    description: normalizeText(source.description || source.short_description || source.shortDescription),
    shortDescription: normalizeText(source.short_description ?? source.shortDescription ?? source.description),
    longDescription: cardLike ? [] : parseJsonArray(source.long_description ?? source.longDescription),
    badge: normalizeText(source.badge),
    category: normalizeText(source.category, "general").toLowerCase(),
    price,
    salePrice: price,
    oldPrice,
    originalPrice: oldPrice,
    compareAtPrice: oldPrice,
    discountPercent,
    stock: Math.max(0, Math.floor(toNumber(source.stock, 0))),
    availableStock: Math.max(0, Math.floor(toNumber(source.stock, 0))),
    image: mainImage,
    mainImage,
    thumbnail: mainImage,
    gallery: cardLike ? (mainImage ? [mainImage] : gallery.slice(0, 1)) : gallery,
    keywords: cardLike ? [] : (parseJsonArray(source.keywords).length ? parseJsonArray(source.keywords) : buildKeywords(source)),
    highlights: cardLike ? [] : parseJsonArray(source.highlights),
    trust: cardLike ? [] : parseJsonArray(source.trust),
    specs: cardLike ? [] : parseJsonArray(source.specs),
    attributes: cardLike ? [] : parseJsonArray(source.attributes),
    variants: cardLike ? {} : parseJsonObject(source.variants),
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
    galleryStoragePaths: cardLike
      ? []
      : (parseJsonArray(source.gallery_storage_paths ?? source.galleryStoragePaths).length
        ? parseJsonArray(source.gallery_storage_paths ?? source.galleryStoragePaths)
        : gallery.map((entry) => normalizeManagedUploadPath(entry)).filter(Boolean)),
    extraInfo: cardLike ? {} : parseJsonObject(source.extra_info ?? source.extraInfo),
    brand: normalizeText(source.brand ?? source.metadata?.brand),
    sku: normalizeText(source.sku ?? source.metadata?.sku),
    costPrice: toNumber(source.costPrice ?? source.metadata?.costPrice, 0),
    taxRate: toNumber(source.taxRate ?? source.metadata?.taxRate, 0),
    taxIncluded: Boolean(source.taxIncluded ?? source.metadata?.taxIncluded),
    metaTitle: normalizeText(source.metaTitle ?? source.metadata?.metaTitle ?? source.title),
    metaDescription: normalizeText(source.metaDescription ?? source.metadata?.metaDescription ?? source.shortDescription),
    shortName: normalizeText(source.metadata?.shortName ?? source.shortName ?? ""),
    slug: normalizeText(source.slug ?? source.metadata?.slug),
    tags: cardLike ? [] : (parseJsonArray(source.tags).length ? parseJsonArray(source.tags) : asArray(source.metadata?.tags)),
    metadata: metadataObject,
    placement: placementList,
    positionMode: normalizeText(metadataObject.positionMode, "automatic"),
    priorityScore: normalizePriority(metadataObject.priorityScore ?? source.priority),
    inventory: asObject(source.inventory) || {
      available: Math.max(0, Math.floor(toNumber(source.stock, 0))),
      totalAvailable: Math.max(0, Math.floor(toNumber(source.stock, 0))),
      status: Math.max(0, Math.floor(toNumber(source.stock, 0))) > 0 ? "in_stock" : "out_of_stock"
    }
  };

  if (cardLike) {
    return {
      ...baseRecord,
      availableStock: baseRecord.stock,
      inventory: {
        ...(baseRecord.inventory || {}),
        available: baseRecord.stock,
        totalAvailable: baseRecord.stock,
        status: baseRecord.stock > 0 ? "in_stock" : "out_of_stock"
      }
    };
  }

  const enriched = enrichProductColorVariants(baseRecord, normalizeStorefrontAssetUrl);

  return {
    ...enriched,
    availableStock: Math.max(0, Math.floor(toNumber(enriched.stock, 0))),
    inventory: {
      ...(baseRecord.inventory || {}),
      available: Math.max(0, Math.floor(toNumber(enriched.stock, 0))),
      totalAvailable: Math.max(0, Math.floor(toNumber(enriched.stock, 0))),
      status: Math.max(0, Math.floor(toNumber(enriched.stock, 0))) > 0 ? "in_stock" : "out_of_stock"
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
  const storefrontWarnings = detectStorefrontVisibilityIssues(normalizedProducts);
  if (storefrontWarnings.length) {
    console.warn(
      `[Product Service] ${storefrontWarnings.length} published product(s) are hidden from the storefront.`,
      storefrontWarnings
    );
  }
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

    // Only notify "changed" for real mutations so pages do not refetch the same catalog.
    const mutationSources = new Set(["api-create", "api-update", "api-delete", "admin", "admin-update"]);
    if (mutationSources.has(String(source || ""))) {
      window.dispatchEvent(new CustomEvent(PRODUCT_CHANGED_EVENT, {
        detail: {
          products: normalizedProducts.slice(),
          syncedAt: new Date().toISOString(),
          source
        }
      }));
    }
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
      const status = Number(error?.status || 0);
      if (status === 429 || status === 401 || status === 403 || status === 404) {
        break;
      }
    }
  }

  throw mapApiError(lastError, `${label} failed.`);
}

function isManagedStoragePath(value) {
  const text = normalizeText(value);
  return Boolean(text) && /^(?:products|categories|users|reviews|temp)\//i.test(text);
}

function isCompanyLogoUrl(value) {
  const normalized = normalizeText(value).replace(/\\/g, "/").toLowerCase();
  if (!normalized) {
    return false;
  }

  return /(?:^|\/)img\/logo\.png(?:\?|#|$)/.test(normalized)
    || normalized === "img/logo.png"
    || normalized === "../img/logo.png"
    || normalized.endsWith("/img/logo.png");
}

function isDirectAssetReference(value) {
  const text = normalizeText(value);
  if (!text || isCompanyLogoUrl(text)) {
    return false;
  }

  if (/^blob:/i.test(text) || /^data:/i.test(text)) {
    return false;
  }

  if (/^(?:https?:|\/|\.\/|\.\.\/)/i.test(text)) {
    return !isCompanyLogoUrl(text);
  }

  return isManagedStoragePath(text);
}

function resolveAssetReference(value, fallback = "") {
  const text = normalizeText(value);
  if (!text) {
    return normalizeText(fallback);
  }

  if (isDirectAssetReference(text)) {
    return text;
  }

  return normalizeText(fallback);
}

function normalizeGalleryEntries(entries = []) {
  return asArray(entries)
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
    .filter((entry, index, values) => values.indexOf(entry) === index);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text && !isCompanyLogoUrl(text)) {
      return text;
    }
  }
  return "";
}

function prepareAssetFields(productData = {}, previousProduct = {}) {
  const nextMainImage = firstNonEmpty(
    productData.mainImage,
    productData.image,
    productData.mainImageStoragePath,
    productData.imageStoragePath,
    previousProduct.mainImage,
    previousProduct.image,
    previousProduct.mainImageStoragePath,
    previousProduct.imageStoragePath
  );
  const nextGallery = normalizeGalleryEntries(
    Object.prototype.hasOwnProperty.call(productData, "gallery")
      ? productData.gallery
      : (previousProduct.gallery || [])
  ).filter((entry) => !isCompanyLogoUrl(entry));
  const nextGalleryStorage = normalizeGalleryEntries(
    Object.prototype.hasOwnProperty.call(productData, "galleryStoragePaths")
      ? productData.galleryStoragePaths
      : (previousProduct.galleryStoragePaths || [])
  );

  const previousMain = firstNonEmpty(
    previousProduct.mainImage,
    previousProduct.image,
    previousProduct.mainImageStoragePath,
    previousProduct.imageStoragePath
  );
  const incomingHasGalleryKey = Object.prototype.hasOwnProperty.call(productData, "gallery")
    || Object.prototype.hasOwnProperty.call(productData, "galleryStoragePaths");
  const incomingHasRealMain = Boolean(firstNonEmpty(
    productData.mainImage,
    productData.image,
    productData.mainImageStoragePath,
    productData.imageStoragePath
  ));

  const mainImage = isDirectAssetReference(nextMainImage)
    ? resolveAssetReference(nextMainImage, previousMain)
    : previousMain;
  const image = mainImage;
  const gallery = (incomingHasGalleryKey && (nextGallery.length || incomingHasRealMain)
    ? nextGallery
    : normalizeGalleryEntries(previousProduct.gallery || [])
  )
    .filter((entry) => isDirectAssetReference(entry) || isManagedStoragePath(entry))
    .map((entry, index) => resolveAssetReference(entry, nextGalleryStorage[index] || ""))
    .filter(Boolean)
    .filter((entry, index, values) => values.indexOf(entry) === index);

  const mainImageStoragePath = normalizeManagedUploadPath(
    productData.mainImageStoragePath
      ?? productData.imageStoragePath
      ?? mainImage
  );
  const galleryStoragePaths = gallery
    .map((entry) => normalizeManagedUploadPath(entry))
    .filter(Boolean);

  return {
    image,
    mainImage,
    gallery,
    mainImageStoragePath,
    galleryStoragePaths
  };
}

function hasOwnKey(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function pickMergedArray(productData, previousProduct, key) {
  if (hasOwnKey(productData, key)) {
    return asArray(productData[key]);
  }
  if (hasOwnKey(previousProduct, key)) {
    return asArray(previousProduct[key]);
  }
  return undefined;
}

function isCompletePreviousProduct(product) {
  if (!product || typeof product !== "object") {
    return false;
  }
  const catalogId = Number(product.id || product.catalogId);
  if (!Number.isFinite(catalogId) || catalogId <= 0) {
    return false;
  }
  return !isCardLikePayload(product);
}

function overlayUpdatedListingFields(products, updatedProduct) {
  const updatedId = Number(updatedProduct?.id || updatedProduct?.catalogId);
  if (!updatedId) {
    return asArray(products);
  }

  let found = false;
  const next = asArray(products).map((product) => {
    if (Number(product.id) !== updatedId && Number(product.catalogId) !== updatedId) {
      return product;
    }
    found = true;
    return {
      ...product,
      name: updatedProduct.name || product.name,
      title: updatedProduct.title || product.title,
      price: updatedProduct.price,
      salePrice: updatedProduct.price,
      oldPrice: updatedProduct.oldPrice,
      stock: updatedProduct.stock,
      category: updatedProduct.category || product.category,
      status: updatedProduct.status || product.status,
      visibility: updatedProduct.visibility || product.visibility,
      image: updatedProduct.image || product.image,
      mainImage: updatedProduct.mainImage || product.mainImage,
      thumbnail: updatedProduct.mainImage || product.thumbnail,
      updatedAt: updatedProduct.updatedAt || product.updatedAt
    };
  });

  if (!found) {
    next.push(updatedProduct);
  }

  return next;
}

function buildApiPayload(productData, previousProduct = {}) {
  const assets = prepareAssetFields(productData, previousProduct);
  const name = normalizeText(productData?.name || productData?.title || previousProduct?.name, "Untitled product");
  const price = toNumber(productData?.price ?? previousProduct?.price, 0);
  const oldPrice = toNumber(productData?.oldPrice ?? previousProduct?.oldPrice, 0);
  const catalogId = Math.max(0, Math.floor(toNumber(productData?.catalogId ?? productData?.id ?? previousProduct?.catalogId ?? previousProduct?.id, 0)));
  const trust = pickMergedArray(productData, previousProduct, "trust");
  const specs = pickMergedArray(productData, previousProduct, "specs");
  const extraInfoSource = hasOwnKey(productData, "extraInfo")
    ? productData.extraInfo
    : (hasOwnKey(previousProduct, "extraInfo") ? previousProduct.extraInfo : undefined);

  return {
    ...(catalogId ? { catalogId } : {}),
    name,
    title: normalizeText(productData?.title ?? previousProduct?.title ?? name),
    description: normalizeText(productData?.description ?? previousProduct?.description),
    shortDescription: normalizeText(productData?.shortDescription ?? productData?.description ?? productData?.metaDescription ?? previousProduct?.shortDescription ?? previousProduct?.description),
    longDescription: asArray(productData?.longDescription ?? previousProduct?.longDescription),
    badge: normalizeText(productData?.badge ?? productData?.brand ?? previousProduct?.badge ?? previousProduct?.brand),
    category: normalizeText(productData?.category ?? previousProduct?.category, "general").toLowerCase(),
    price,
    oldPrice: oldPrice > price ? oldPrice : 0,
    stock: Math.max(0, Math.floor(toNumber(productData?.stock ?? previousProduct?.stock, 0))),
    image: assets.image,
    mainImage: assets.mainImage,
    gallery: assets.gallery,
    mainImageStoragePath: assets.mainImageStoragePath,
    imageStoragePath: assets.mainImageStoragePath,
    galleryStoragePaths: assets.galleryStoragePaths,
    keywords: asArray(productData?.keywords).length ? asArray(productData?.keywords) : uniqueKeywordList(productData, previousProduct),
    highlights: asArray(productData?.highlights ?? previousProduct?.highlights),
    ...(trust !== undefined ? { trust } : {}),
    ...(specs !== undefined ? { specs } : {}),
    attributes: asArray(productData?.attributes ?? previousProduct?.attributes),
    variants: asObject(productData?.variants ?? previousProduct?.variants),
    visibility: normalizeVisibility(productData?.visibility ?? previousProduct?.visibility),
    priority: normalizePriority(productData?.priority ?? previousProduct?.priority),
    orderIndex: Math.max(0, Math.floor(toNumber(productData?.orderIndex ?? previousProduct?.orderIndex, 0))),
    highlightTag: normalizeText(productData?.highlightTag ?? previousProduct?.highlightTag).toLowerCase(),
    status: normalizeText(productData?.status ?? previousProduct?.status, "active").toLowerCase(),
    page: normalizeText(productData?.page ?? previousProduct?.page, DEFAULT_DETAIL_PAGE),
    brand: normalizeText(productData?.brand ?? previousProduct?.brand),
    sku: normalizeText(productData?.sku ?? previousProduct?.sku),
    costPrice: toNumber(productData?.costPrice ?? previousProduct?.costPrice, 0),
    taxRate: toNumber(productData?.taxRate ?? previousProduct?.taxRate, 0),
    taxIncluded: Boolean(productData?.taxIncluded ?? previousProduct?.taxIncluded),
    metaTitle: normalizeText(productData?.metaTitle ?? previousProduct?.metaTitle ?? name),
    metaDescription: normalizeText(productData?.metaDescription ?? previousProduct?.metaDescription ?? productData?.description ?? previousProduct?.description),
    slug: normalizeText(productData?.slug ?? previousProduct?.slug),
    tags: asArray(productData?.tags ?? previousProduct?.tags),
    metadata: {
      ...asObject(previousProduct?.metadata),
      ...asObject(productData?.metadata)
    },
    ...(extraInfoSource !== undefined ? { extraInfo: asObject(extraInfoSource) } : {})
  };
}

async function consumeCatalogPrefetch() {
  if (typeof window === "undefined") {
    return null;
  }

  const pending = window.__BYOSE_CATALOG_PREFETCH__;
  if (!pending || typeof pending.then !== "function") {
    return null;
  }

  window.__BYOSE_CATALOG_PREFETCH__ = null;
  try {
    const payload = await pending;
    if (payload && payload.success !== false && Array.isArray(payload.products)) {
      return payload;
    }
  } catch (_error) {
    // Fall through to a normal catalog request.
  }

  return null;
}

async function consumeProductPrefetch(productId) {
  if (typeof window === "undefined") {
    return null;
  }

  const pending = window.__BYOSE_PRODUCT_PREFETCH__;
  const prefetchId = String(window.__BYOSE_PRODUCT_PREFETCH_ID__ || "").trim();
  if (!pending || typeof pending.then !== "function" || prefetchId !== String(productId || "").trim()) {
    return null;
  }

  window.__BYOSE_PRODUCT_PREFETCH__ = null;
  window.__BYOSE_PRODUCT_PREFETCH_ID__ = "";
  try {
    const payload = await pending;
    const product = payload?.product;
    if (product) {
      return normalizeProductRecord(product);
    }
  } catch (_error) {
    // Fall through to a normal product request.
  }

  return null;
}

async function fetchCatalogSnapshot(signal) {
  traceStorefrontStage("api-request", { path: STOREFRONT_CATALOG_QUERY });
  const prefetched = await consumeCatalogPrefetch();
  const response = prefetched || await apiRequest(STOREFRONT_CATALOG_QUERY, {
    method: "GET",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    signal
  });
  const products = asArray(response?.products);
  traceStorefrontStage("api-response", {
    path: STOREFRONT_CATALOG_QUERY,
    success: Boolean(response?.success),
    count: products.length,
    prefetched: Boolean(prefetched)
  });

  return publishProducts(products, "api-refresh");
}

function hydrateFromStorage() {
  if (hasHydratedCatalog) {
    return cachedProducts.slice();
  }

  const stored = readStoredProducts();
  if (!stored.length) {
    return [];
  }

  cachedProducts = stored;
  hasHydratedCatalog = true;
  lastSnapshotAt = Date.now() - Math.floor(STALE_THRESHOLD_MS / 2);
  return cachedProducts.slice();
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

  // Listen for admin window updates via localStorage changes so other tabs/windows
  // can pick up product catalog changes immediately without polling.
  const handleStorage = (event) => {
    try {
      if (!event || event.key !== STOREFRONT_CATALOG_STORAGE_KEY) {
        return;
      }

      const raw = event.newValue || event.oldValue || null;
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }

      // Publish parsed products into local cache and notify listeners
      publishProducts(parsed, 'local-storage');
    } catch (error) {
      // Ignore malformed storage entries
      console.warn('[Product Service] Failed to handle storage event:', error);
    }
  };

  window.addEventListener('storage', handleStorage);

  detachLiveSyncListeners = () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("online", handleOnline);
    window.removeEventListener('storage', handleStorage);
    detachLiveSyncListeners = null;
  };
}

export async function fetchProductsFromBackend() {
  return forceRefreshProducts();
}

export async function forceRefreshProducts(options = {}) {
  if (catalogFetchInFlight) {
    return catalogFetchInFlight;
  }

  if (liveSyncAbortController) {
    liveSyncAbortController.abort();
  }

  liveSyncAbortController = typeof AbortController !== "undefined" ? new AbortController() : null;

  catalogFetchInFlight = (async () => {
    try {
      return await fetchCatalogSnapshot(liveSyncAbortController?.signal);
    } catch (error) {
      if (!options?.silent) {
        throw mapApiError(error, "Unable to refresh the product catalog from the backend.");
      }

      throw error;
    } finally {
      liveSyncAbortController = null;
      catalogFetchInFlight = null;
    }
  })();

  return catalogFetchInFlight;
}

export async function getProducts() {
  hydrateFromStorage();

  // Stale-while-revalidate: paint cached catalog immediately, refresh in background.
  if (hasHydratedCatalog && cachedProducts.length) {
    if (isCacheStale() && !catalogFetchInFlight) {
      void forceRefreshProducts({ silent: true }).catch(() => {});
    }
    return cachedProducts.slice();
  }

  return getProductsWithRetry();
}

export async function getProductsWithRetry() {
  hydrateFromStorage();

  if (hasHydratedCatalog && cachedProducts.length) {
    // Soft background refresh without blocking first paint.
    if (!catalogFetchInFlight && isCacheStale()) {
      void forceRefreshProducts({ silent: true }).catch(() => {});
    }
    return cachedProducts.slice();
  }

  try {
    return await withRetry("Backend product fetch", () => forceRefreshProducts());
  } catch (error) {
    const cached = hydrateFromStorage();
    if (cached.length) {
      return publishProducts(cached, "cache-fallback");
    }

    throw error;
  }
}

export async function getProductById(productId) {
  const id = normalizeText(productId);
  if (!id) {
    return null;
  }

  const token = getAdminToken();
  const requestFullProduct = async (path, requiresAdmin) => {
    const response = await apiRequest(path, {
      method: "GET",
      timeoutMs: DEFAULT_TIMEOUT_MS,
      requiresAdmin
    });
    const product = response?.product;
    if (!product) {
      return null;
    }
    return normalizeProductRecord(product);
  };

  try {
    if (token) {
      const adminProduct = await requestFullProduct(`admin/products/${encodeURIComponent(id)}`, true);
      if (adminProduct) {
        return adminProduct;
      }
    }

    const prefetched = await consumeProductPrefetch(id);
    if (prefetched) {
      return prefetched;
    }

    return await requestFullProduct(`products/${encodeURIComponent(id)}`, false);
  } catch (error) {
    if (token) {
      try {
        return await requestFullProduct(`products/${encodeURIComponent(id)}`, false);
      } catch (_fallbackError) {
        throw mapApiError(error, "Unable to load the selected product.");
      }
    }
    throw mapApiError(error, "Unable to load the selected product.");
  }
}

export function getCachedProducts() {
  hydrateFromStorage();
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
  await ensureUploadCapableApiBaseUrl(options);

  const payload = buildApiPayload(productData);
  reportProgress(onProgress, "Saving product record to backend...");
  const response = await apiRequest("admin/products", {
    method: "POST",
    body: payload,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    requiresAdmin: true
  });

  const createdProduct = normalizeProductRecord(response?.product);
  publishProducts([...cachedProducts.filter((product) => Number(product.id) !== Number(createdProduct.id)), createdProduct], "api-create");
  reportProgress(onProgress, "Product saved successfully to backend.", { phase: "completed" });
  try {
    await forceRefreshProducts({ silent: true });
  } catch (_error) {
    // Keep the optimistic publish if background refresh fails.
  }
  return createdProduct;
}

async function resolvePreviousProductForUpdate(catalogId) {
  try {
    const fullProduct = await getProductById(String(catalogId));
    if (isCompletePreviousProduct(fullProduct)) {
      return fullProduct;
    }
  } catch (_error) {
    // Fall through to in-memory catalog, but never merge from card-list payloads.
  }

  const cached = cachedProducts.find((product) => (
    Number(product.id) === catalogId || Number(product.catalogId) === catalogId
  ));
  if (isCompletePreviousProduct(cached)) {
    return cached;
  }

  return {};
}

export async function updateProduct(productId, productData = {}, options = {}) {
  const onProgress = options?.onProgress;
  const catalogId = Math.max(0, Math.floor(toNumber(productId, 0)));
  if (!catalogId) {
    throw new Error("Product id is required.");
  }

  const previousProduct = await resolvePreviousProductForUpdate(catalogId);
  await ensureUploadCapableApiBaseUrl(options);
  const payload = buildApiPayload(productData, previousProduct);
  if (Number(payload.catalogId || catalogId) !== catalogId) {
    throw new Error("Product id is required.");
  }
  payload.catalogId = catalogId;
  reportProgress(onProgress, "Updating product record in backend...");
  const response = await apiRequest(`admin/products/${encodeURIComponent(String(catalogId))}`, {
    method: "PUT",
    body: payload,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    requiresAdmin: true
  });

  const updatedProduct = normalizeProductRecord(response?.product);
  if (Number(updatedProduct.id || updatedProduct.catalogId) !== catalogId) {
    throw new Error("Save did not update the original product. Reload and try again.");
  }

  publishProducts(
    overlayUpdatedListingFields(
      [...cachedProducts.filter((product) => Number(product.id) !== catalogId && Number(product.catalogId) !== catalogId), updatedProduct],
      updatedProduct
    ),
    "api-update"
  );
  reportProgress(onProgress, "Product updated successfully in backend.", { phase: "completed" });
  try {
    await forceRefreshProducts({ silent: true });
    publishProducts(overlayUpdatedListingFields(cachedProducts, updatedProduct), "api-update-sync");
  } catch (_error) {
    // Keep the optimistic publish if background refresh fails.
  }
  return updatedProduct;
}

export async function deleteProduct(productId, options = {}) {
  const onProgress = options?.onProgress;
  const catalogId = Math.max(0, Math.floor(toNumber(productId, 0)));
  if (!catalogId) {
    throw new Error("Product id is required.");
  }

  reportProgress(onProgress, "Deleting product from backend...");
  await apiRequest(`admin/products/${encodeURIComponent(String(catalogId))}`, {
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
  getProductById,
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