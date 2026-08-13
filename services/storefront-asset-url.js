export const PRODUCTION_SITE_ORIGIN = "https://byosemarket.com";
export const STOREFRONT_CATALOG_CACHE_KEYS = [
  "byose_market_products_catalog_v1",
  "byose_market_products_catalog_v2",
  "byose_market_products_catalog_v3",
  "byose_market_products_catalog_v4"
];

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function resolveStorefrontOrigin() {
  if (typeof window !== "undefined") {
    const protocol = String(window.location?.protocol || "").toLowerCase();
    const origin = normalizeBaseUrl(window.location?.origin || "");
    if ((protocol === "http:" || protocol === "https:") && origin) {
      return origin;
    }
  }

  return PRODUCTION_SITE_ORIGIN;
}

export function normalizeStorefrontAssetUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  if (/^(?:https?:|data:|blob:)/i.test(normalized)) {
    return normalized;
  }

  const origin = resolveStorefrontOrigin();

  if (normalized.startsWith("/uploads/") || normalized.startsWith("/img/")) {
    return `${origin}${normalized}`;
  }

  if (normalized.startsWith("uploads/")) {
    return `${origin}/${normalized.replace(/^\/+/, "")}`;
  }

  if (/^(?:products|categories|users|reviews|hero|temp)\//i.test(normalized)) {
    return `${origin}/uploads/${normalized.replace(/^\/+/, "")}`;
  }

  if (normalized.startsWith("img/")) {
    return `${origin}/${normalized}`;
  }

  if (normalized.startsWith("/")) {
    return `${origin}${normalized}`;
  }

  return normalized;
}

export function normalizeStorefrontAssetList(values = []) {
  const seen = new Set();
  const output = [];

  for (const entry of values) {
    const normalized = normalizeStorefrontAssetUrl(entry);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

export function collectProductImageCandidates(product) {
  if (!product || typeof product !== "object") {
    return [];
  }

  const gallery = Array.isArray(product.gallery) ? product.gallery : [];
  const galleryStoragePaths = Array.isArray(product.galleryStoragePaths) ? product.galleryStoragePaths : [];

  return [
    product.mainImage,
    product.image,
    product.thumbnail,
    ...gallery,
    product.mainImageStoragePath,
    product.imageStoragePath,
    ...galleryStoragePaths
  ];
}

export function resolveProductImageUrl(product) {
  for (const candidate of collectProductImageCandidates(product)) {
    const normalized = normalizeStorefrontAssetUrl(candidate);
    if (!normalized || /^javascript:/i.test(normalized)) {
      continue;
    }

    const lowered = normalized.replace(/\\/g, "/").toLowerCase();
    if (/(?:^|\/)img\/logo\.png(?:\?|#|$)/.test(lowered) || lowered.endsWith("/img/logo.png")) {
      continue;
    }

    return normalized;
  }

  return "";
}

export function purgeLegacyStorefrontCatalogCache(activeKey = "byose_market_products_catalog_v4") {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }

  STOREFRONT_CATALOG_CACHE_KEYS.forEach((key) => {
    if (key === activeKey) {
      return;
    }

    try {
      window.localStorage.removeItem(key);
    } catch (_error) {
      // Ignore storage failures.
    }
  });
}

export default {
  PRODUCTION_SITE_ORIGIN,
  STOREFRONT_CATALOG_CACHE_KEYS,
  collectProductImageCandidates,
  normalizeStorefrontAssetUrl,
  normalizeStorefrontAssetList,
  purgeLegacyStorefrontCatalogCache,
  resolveProductImageUrl,
  resolveStorefrontOrigin
};
