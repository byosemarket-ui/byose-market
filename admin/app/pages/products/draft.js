import {
  CATEGORY_OPTIONS,
  DRAFT_STORAGE_KEY,
  SIZE_PRESETS,
  STOCK_STATUS_OPTIONS
} from "./constants.js";
import {
  clearJsonStorage,
  isPersistableAssetUrl,
  normalizeAssetUrl,
  normalizeStoragePath,
  parseTagsInput,
  readJsonStorage,
  sanitizePersistedGallery,
  slugify,
  toNumber,
  writeJsonStorage
} from "./utils.js";

function getSizeOptions(category) {
  const normalized = String(category || "general").toLowerCase();
  if (SIZE_PRESETS[normalized]) {
    return SIZE_PRESETS[normalized];
  }
  return SIZE_PRESETS.default;
}

function inferStockStatus(stock) {
  const quantity = Math.max(0, Math.floor(toNumber(stock, 0)));
  if (quantity <= 0) {
    return "out_of_stock";
  }
  if (quantity <= 5) {
    return "low_stock";
  }
  return "in_stock";
}

export function createDefaultDraft() {
  return {
    productId: "",
    step: "info",
    savedProductId: "",
    info: {
      name: "",
      category: "fashion",
      brand: "",
      description: "",
      sku: "",
      tags: "",
      visibility: "both"
    },
    pricing: {
      costPrice: "",
      sellingPrice: "",
      discountPrice: "",
      taxRate: "",
      taxIncluded: false
    },
    inventory: {
      quantity: "0",
      stockStatus: "in_stock",
      variantsEnabled: false,
      sizes: [],
      colors: []
    },
    media: {
      mainImage: "",
      mainImageStoragePath: "",
      gallery: [],
      galleryStoragePaths: [],
      pendingMainFile: false,
      pendingGalleryCount: 0
    },
    seo: {
      metaTitle: "",
      metaDescription: "",
      slug: ""
    }
  };
}

export function sanitizeDraft(input) {
  const defaults = createDefaultDraft();
  const draft = input && typeof input === "object" ? input : {};
  const info = draft.info && typeof draft.info === "object" ? draft.info : {};
  const pricing = draft.pricing && typeof draft.pricing === "object" ? draft.pricing : {};
  const inventory = draft.inventory && typeof draft.inventory === "object" ? draft.inventory : {};
  const media = draft.media && typeof draft.media === "object" ? draft.media : {};
  const seo = draft.seo && typeof draft.seo === "object" ? draft.seo : {};
  const category = CATEGORY_OPTIONS.includes(String(info.category || "").toLowerCase())
    ? String(info.category).toLowerCase()
    : defaults.info.category;
  const sizeOptions = getSizeOptions(category);
  const stockStatusValues = STOCK_STATUS_OPTIONS.map((entry) => entry.value);
  const quantity = String(Math.max(0, Math.floor(toNumber(inventory.quantity, 0))));
  const stockStatus = stockStatusValues.includes(String(inventory.stockStatus || "").toLowerCase())
    ? String(inventory.stockStatus).toLowerCase()
    : inferStockStatus(quantity);

  const colors = Array.isArray(inventory.colors)
    ? inventory.colors.map((entry, index) => ({
        name: String(entry?.name || "").trim() || `Color ${index + 1}`,
        hex: String(entry?.hex || "#00b894").trim() || "#00b894"
      }))
    : [];

  const sizes = Array.isArray(inventory.sizes)
    ? inventory.sizes
        .map((entry) => String(entry || "").trim())
        .filter((entry, index, array) => entry && array.indexOf(entry) === index)
    : [];

  const persistedGallery = sanitizePersistedGallery(media.gallery, media.galleryStoragePaths);
  const galleryUrls = persistedGallery.gallery;
  const galleryStorage = persistedGallery.galleryStoragePaths;
  const normalizedMainImage = isPersistableAssetUrl(media.mainImage) ? normalizeAssetUrl(media.mainImage) : "";
  const normalizedMainStoragePath = normalizeStoragePath(
    media.mainImageStoragePath || normalizedMainImage
  );

  return {
    productId: String(draft.productId || draft.savedProductId || ""),
    savedProductId: String(draft.savedProductId || draft.productId || ""),
    step: String(draft.step || "info"),
    info: {
      name: String(info.name || ""),
      category,
      brand: String(info.brand || ""),
      description: String(info.description || ""),
      sku: String(info.sku || ""),
      tags: Array.isArray(info.tags) ? info.tags.join(", ") : String(info.tags || ""),
      visibility: ["home", "shop", "both"].includes(String(info.visibility || "").toLowerCase())
        ? String(info.visibility).toLowerCase()
        : defaults.info.visibility
    },
    pricing: {
      costPrice: String(pricing.costPrice ?? ""),
      sellingPrice: String(pricing.sellingPrice ?? ""),
      discountPrice: String(pricing.discountPrice ?? ""),
      taxRate: String(pricing.taxRate ?? ""),
      taxIncluded: Boolean(pricing.taxIncluded)
    },
    inventory: {
      quantity,
      stockStatus,
      variantsEnabled: Boolean(inventory.variantsEnabled),
      sizes,
      colors
    },
    media: {
      mainImage: normalizedMainImage,
      mainImageStoragePath: normalizedMainStoragePath,
      gallery: galleryUrls,
      galleryStoragePaths: galleryStorage,
      pendingMainFile: Boolean(media.pendingMainFile),
      pendingGalleryCount: Math.max(0, Math.floor(Number(media.pendingGalleryCount || 0)))
    },
    seo: {
      metaTitle: String(seo.metaTitle || ""),
      metaDescription: String(seo.metaDescription || ""),
      slug: slugify(seo.slug || info.name || "")
    }
  };
}

export function readDraft() {
  return sanitizeDraft(readJsonStorage(DRAFT_STORAGE_KEY));
}

export function writeDraft(draft) {
  writeJsonStorage(DRAFT_STORAGE_KEY, sanitizeDraft(draft));
}

export function clearDraft() {
  clearJsonStorage(DRAFT_STORAGE_KEY);
}

export function hydrateDraftFromProduct(product) {
  const defaults = createDefaultDraft();
  if (!product || typeof product !== "object") {
    return defaults;
  }

  const catalogId = String(product.id || product.catalogId || "").trim();
  const attributes = Array.isArray(product.attributes) ? product.attributes : [];
  const colorAttribute = attributes.find((entry) => String(entry?.type || entry?.axis || "").toLowerCase() === "color");
  const sizeAttribute = attributes.find((entry) => String(entry?.type || entry?.axis || "").toLowerCase() === "size");
  const colors = Array.isArray(colorAttribute?.options)
    ? colorAttribute.options.map((option) => ({
        name: String(option?.label || option?.value || "").trim(),
        hex: String(option?.swatch || option?.hex || "#00b894").trim() || "#00b894"
      })).filter((entry) => entry.name)
    : [];
  const sizes = Array.isArray(sizeAttribute?.options)
    ? sizeAttribute.options.map((option) => String(option?.label || option?.value || "").trim()).filter(Boolean)
    : [];
  const tags = Array.isArray(product.tags)
    ? product.tags
    : (Array.isArray(product.keywords) ? product.keywords : []);

  return sanitizeDraft({
    productId: catalogId,
    savedProductId: catalogId,
    info: {
      name: product.name || product.title || "",
      category: product.category || "general",
      brand: product.brand || product.badge || "",
      description: product.description || product.shortDescription || "",
      sku: product.sku || "",
      tags: tags.join(", "),
      visibility: product.visibility || "both"
    },
    pricing: {
      costPrice: String(product.costPrice ?? ""),
      sellingPrice: String(product.price ?? ""),
      discountPrice: String(product.oldPrice ?? ""),
      taxRate: String(product.taxRate ?? ""),
      taxIncluded: Boolean(product.taxIncluded)
    },
    inventory: {
      quantity: String(product.stock ?? 0),
      stockStatus: inferStockStatus(product.stock),
      variantsEnabled: Boolean(product.variants?.enabled || colors.length || sizes.length),
      sizes,
      colors
    },
    media: {
      mainImage: product.mainImage || product.image || "",
      mainImageStoragePath: product.mainImageStoragePath || product.imageStoragePath || "",
      gallery: product.gallery || [],
      galleryStoragePaths: product.galleryStoragePaths || []
    },
    seo: {
      metaTitle: product.metaTitle || product.title || product.name || "",
      metaDescription: product.metaDescription || product.shortDescription || product.description || "",
      slug: product.slug || slugify(product.name || product.title || "")
    }
  });
}

export function getSizeOptionsForCategory(category) {
  return getSizeOptions(category);
}

export { parseTagsInput, inferStockStatus };
