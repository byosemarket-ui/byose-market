import {
  extractColorVariantsFromProduct,
  migrateLegacyToColorVariants,
  normalizeColorVariants,
  computeProductTotalStock
} from "../../../../js/color-variant-inventory.js";
import {
  CATEGORY_OPTIONS,
  CURRENCY_OPTIONS,
  DRAFT_STORAGE_KEY,
  PLACEMENT_OPTIONS,
  POSITION_MODE_OPTIONS,
  PRODUCT_CONDITION_OPTIONS,
  PRODUCT_STATUS_OPTIONS,
  PRODUCT_TYPE_OPTIONS,
  SIZE_PRESETS,
  WARRANTY_OPTIONS
} from "./constants.js";
import {
  clearJsonStorage,
  isPersistableAssetUrl,
  normalizeAssetUrl,
  normalizeStoragePath,
  parseTagsInput,
  preferCanonicalAssetUrl,
  preferCanonicalStoragePath,
  readJsonStorage,
  sanitizePersistedGallery,
  slugify,
  toNumber,
  writeJsonStorage
} from "./utils.js";
import { productImagesMatch } from "../../../../services/storefront-asset-url.js";

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
  if (quantity <= 20) {
    return "limited_stock";
  }
  return "in_stock";
}

function createDefaultInfo() {
  return {
    name: "",
    shortName: "",
    category: "fashion",
    brand: "",
    manufacturer: "",
    countryOfOrigin: "",
    tags: "",
    visibility: "both",
    productType: "simple",
    condition: "new",
    highlights: "",
    warranty: "none",
    warrantyCustom: "",
    featuredProduct: false,
    placement: [],
    positionMode: "automatic",
    priorityScore: "50",
    publishStatus: "active"
  };
}

const VALID_PLACEMENT_VALUES = new Set(PLACEMENT_OPTIONS.map((entry) => entry.value));
const VALID_POSITION_MODES = new Set(POSITION_MODE_OPTIONS.map((entry) => entry.value));

function normalizePlacement(value) {
  const source = Array.isArray(value) ? value : (value ? [value] : []);
  const normalized = source
    .map((entry) => String(entry || "").trim().toLowerCase())
    .map((entry) => {
      if (entry === "featured") {
        return "featured_products";
      }
      return entry;
    })
    .filter((entry) => VALID_PLACEMENT_VALUES.has(entry));
  return [...new Set(normalized)];
}

function getCategoryValue(category) {
  if (typeof category === "object" && category?.value) {
    return String(category.value).toLowerCase();
  }
  return String(category || "general").toLowerCase();
}

function normalizeInfoFields(info = {}, defaults = createDefaultInfo()) {
  const categoryValues = CATEGORY_OPTIONS.map((entry) => entry.value);
  const rawCategory = getCategoryValue(info.category);
  const category = categoryValues.includes(rawCategory)
    ? rawCategory
    : (rawCategory || defaults.category);
  const productType = PRODUCT_TYPE_OPTIONS.some((entry) => entry.value === info.productType)
    ? info.productType
    : defaults.productType;
  const condition = PRODUCT_CONDITION_OPTIONS.some((entry) => entry.value === info.condition)
    ? info.condition
    : defaults.condition;
  const warranty = WARRANTY_OPTIONS.some((entry) => entry.value === info.warranty)
    ? info.warranty
    : defaults.warranty;
  const publishStatus = PRODUCT_STATUS_OPTIONS.some((entry) => entry.value === info.publishStatus)
    ? info.publishStatus
    : defaults.publishStatus;

  return {
    name: String(info.name || ""),
    shortName: String(info.shortName || ""),
    category,
    brand: String(info.brand || ""),
    manufacturer: String(info.manufacturer || ""),
    countryOfOrigin: String(info.countryOfOrigin || ""),
    tags: Array.isArray(info.tags) ? info.tags.join(", ") : String(info.tags || ""),
    visibility: ["home", "shop", "both"].includes(String(info.visibility || "").toLowerCase())
      ? String(info.visibility).toLowerCase()
      : defaults.visibility,
    productType,
    condition,
    highlights: Array.isArray(info.highlights) ? info.highlights.join(", ") : String(info.highlights || ""),
    warranty,
    warrantyCustom: String(info.warrantyCustom || ""),
    featuredProduct: Boolean(
      info.featuredProduct
      || info.featuredHomepage
      || info.featuredProducts
    ),
    placement: normalizePlacement(info.placement),
    positionMode: VALID_POSITION_MODES.has(String(info.positionMode || "").toLowerCase())
      ? String(info.positionMode).toLowerCase()
      : defaults.positionMode,
    priorityScore: String(
      Math.max(0, Math.min(100, Math.floor(toNumber(info.priorityScore, toNumber(defaults.priorityScore, 50)))))
    ),
    publishStatus
  };
}

function createDefaultPricing() {
  return {
    costPrice: "",
    originalPrice: "",
    sellingPrice: "",
    currency: "RWF"
  };
}

function normalizePricingFields(pricing = {}, defaults = createDefaultPricing()) {
  const currency = CURRENCY_OPTIONS.some((entry) => entry.value === String(pricing.currency || "").toUpperCase())
    ? String(pricing.currency).toUpperCase()
    : defaults.currency;

  return {
    costPrice: String(pricing.costPrice ?? ""),
    originalPrice: String(pricing.originalPrice ?? pricing.discountPrice ?? ""),
    sellingPrice: String(pricing.sellingPrice ?? ""),
    currency
  };
}

function createDefaultInventory() {
  return {
    sku: "",
    quantity: "0",
    stockStatus: "out_of_stock",
    variantsEnabled: false,
    sizes: [],
    customSizes: [],
    attributes: {},
    variants: [],
    colorVariants: []
  };
}

function createDefaultDescription() {
  return {
    shortDescription: "",
    longDescription: "",
    description: ""
  };
}

function createDefaultSeo() {
  return {
    metaTitle: "",
    metaDescription: "",
    slug: "",
    slugManual: false
  };
}

function normalizeSeoFields(seo = {}, info = {}, description = {}, defaults = createDefaultSeo()) {
  return {
    metaTitle: String(seo.metaTitle || info.name || ""),
    metaDescription: String(
      seo.metaDescription
      || description.shortDescription
      || description.longDescription
      || description.description
      || ""
    ),
    slug: slugify(seo.slug || info.name || ""),
    slugManual: Boolean(seo.slugManual)
  };
}

function normalizeDescriptionFields(description = {}) {
  const longDescription = String(description.longDescription || description.description || "");
  const shortDescription = String(description.shortDescription || "");
  return {
    shortDescription,
    longDescription,
    description: longDescription
  };
}

function normalizeInventoryFields(inventory = {}, defaults = createDefaultInventory()) {
  const colorVariants = normalizeColorVariants(
    Array.isArray(inventory.colorVariants) && inventory.colorVariants.length
      ? inventory.colorVariants
      : migrateLegacyToColorVariants(inventory.variants, inventory.sizes)
  ).map((entry) => ({
    id: entry.id,
    clientKey: entry.clientKey || entry.id,
    colorName: entry.colorName,
    image: entry.image,
    imageStoragePath: entry.imageStoragePath || "",
    sizes: entry.sizes.map((row) => ({
      size: row.size,
      stock: String(row.stock)
    }))
  }));

  const legacyVariants = Array.isArray(inventory.variants)
    ? inventory.variants.map((entry, index) => ({
        label: String(entry?.label || "").trim() || `Variant ${index + 1}`,
        colorName: String(entry?.colorName || "").trim(),
        image: String(entry?.image || "").trim(),
        stock: String(Math.max(0, Math.floor(toNumber(entry?.stock, 0))))
      }))
    : [];

  const totalColorStock = computeProductTotalStock(colorVariants, toNumber(inventory.quantity, 0));
  const quantitySource = colorVariants.length ? totalColorStock : toNumber(inventory.quantity, 0);
  const quantity = String(Math.max(0, Math.floor(quantitySource)));

  return {
    quantity,
    stockStatus: inferStockStatus(quantity),
    sku: String(inventory.sku ?? defaults.sku ?? ""),
    variantsEnabled: Boolean(inventory.variantsEnabled || colorVariants.length || legacyVariants.length),
    sizes: Array.isArray(inventory.sizes)
      ? inventory.sizes.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [...defaults.sizes],
    customSizes: Array.isArray(inventory.customSizes)
      ? inventory.customSizes.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [...defaults.customSizes],
    attributes: inventory.attributes && typeof inventory.attributes === "object" ? inventory.attributes : {},
    variants: legacyVariants,
    colorVariants
  };
}

export function createDefaultDraft() {
  return {
    productId: "",
    step: "info",
    savedProductId: "",
    info: createDefaultInfo(),
    pricing: createDefaultPricing(),
    inventory: createDefaultInventory(),
    description: createDefaultDescription(),
    media: {
      mainImage: "",
      mainImageStoragePath: "",
      gallery: [],
      galleryStoragePaths: [],
      pendingMainFile: false,
      pendingGalleryCount: 0
    },
    seo: createDefaultSeo()
  };
}

export function sanitizeDraft(input) {
  const defaults = createDefaultDraft();
  const draft = input && typeof input === "object" ? input : {};
  const info = draft.info && typeof draft.info === "object" ? draft.info : {};
  const pricing = draft.pricing && typeof draft.pricing === "object" ? draft.pricing : {};
  const inventory = draft.inventory && typeof draft.inventory === "object" ? draft.inventory : {};
  const description = draft.description && typeof draft.description === "object" ? draft.description : {};
  const media = draft.media && typeof draft.media === "object" ? draft.media : {};
  const seo = draft.seo && typeof draft.seo === "object" ? draft.seo : {};
  const persistedGallery = sanitizePersistedGallery(media.gallery, media.galleryStoragePaths);
  const galleryUrls = persistedGallery.gallery;
  const galleryStorage = persistedGallery.galleryStoragePaths;
  const normalizedMainImage = preferCanonicalAssetUrl(media.mainImage, media.mainImageStoragePath);
  const normalizedMainStoragePath = preferCanonicalStoragePath(
    media.mainImageStoragePath,
    normalizedMainImage
  );

  return {
    productId: String(draft.productId || draft.savedProductId || ""),
    savedProductId: String(draft.savedProductId || draft.productId || ""),
    step: String(draft.step || "info"),
    info: normalizeInfoFields(info, defaults.info),
    pricing: normalizePricingFields(pricing, defaults.pricing),
    inventory: normalizeInventoryFields(inventory, defaults.inventory),
    description: normalizeDescriptionFields(description),
    media: {
      mainImage: normalizedMainImage,
      mainImageStoragePath: normalizedMainStoragePath,
      gallery: galleryUrls,
      galleryStoragePaths: galleryStorage,
      pendingMainFile: Boolean(media.pendingMainFile),
      pendingGalleryCount: Math.max(0, Math.floor(Number(media.pendingGalleryCount || 0)))
    },
    seo: normalizeSeoFields(seo, info, description, defaults.seo)
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

function joinLongDescription(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean).join("\n\n");
  }
  return String(value || "").trim();
}

function isSameAsset(left, right) {
  const leftUrl = normalizeAssetUrl(left);
  const rightUrl = normalizeAssetUrl(right);
  if (leftUrl && rightUrl && leftUrl === rightUrl) {
    return true;
  }

  if (productImagesMatch(left, right) || productImagesMatch(leftUrl, rightUrl)) {
    return true;
  }

  const leftPath = normalizeStoragePath(left);
  const rightPath = normalizeStoragePath(right);
  return Boolean(leftPath && rightPath && leftPath === rightPath);
}

function galleryWithoutMainImage(gallery, galleryStoragePaths, mainImage) {
  const persisted = sanitizePersistedGallery(gallery, galleryStoragePaths);
  const urls = [];
  const storage = [];

  persisted.gallery.forEach((url, index) => {
    const storagePath = persisted.galleryStoragePaths[index] || normalizeStoragePath(url);
    if (isSameAsset(url, mainImage) || isSameAsset(storagePath, mainImage)) {
      return;
    }
    urls.push(url);
    storage.push(storagePath);
  });

  return { gallery: urls, galleryStoragePaths: storage };
}

export function hydrateDraftFromProduct(product) {
  const defaults = createDefaultDraft();
  if (!product || typeof product !== "object") {
    return defaults;
  }

  const catalogId = String(product.id || product.catalogId || "").trim();
  const attributes = Array.isArray(product.attributes) ? product.attributes : [];
  const sizeAttribute = attributes.find((entry) => String(entry?.type || entry?.axis || "").toLowerCase() === "size");
  const variants = Array.isArray(product.variants?.items)
    ? product.variants.items.map((entry, index) => ({
        label: String(entry?.label || entry?.name || "").trim() || `Variant ${index + 1}`,
        colorName: String(entry?.colorName || entry?.color || "").trim(),
        image: String(entry?.image || "").trim(),
        stock: String(Math.max(0, Math.floor(toNumber(entry?.stock ?? entry?.available, 0))))
      }))
    : [];
  const sizes = Array.isArray(sizeAttribute?.options)
    ? sizeAttribute.options.map((option) => String(option?.label || option?.value || "").trim()).filter(Boolean)
    : [];
  const colorVariants = extractColorVariantsFromProduct(product).map((entry) => ({
    id: entry.id,
    clientKey: entry.clientKey || entry.id,
    colorName: entry.colorName,
    image: entry.image,
    imageStoragePath: entry.imageStoragePath || "",
    sizes: entry.sizes.map((row) => ({
      size: row.size,
      stock: String(row.stock)
    }))
  }));
  const tags = Array.isArray(product.tags) && product.tags.length
    ? product.tags
    : (Array.isArray(product.keywords) ? product.keywords : []);

  const metadata = product.metadata && typeof product.metadata === "object" ? product.metadata : {};
  const highlights = Array.isArray(product.highlights) && product.highlights.length
    ? product.highlights
    : (Array.isArray(metadata.highlights) ? metadata.highlights : []);
  const placement = normalizePlacement(
    metadata.placement || metadata.placements || product.placement || []
  );
  const mainImage = preferCanonicalAssetUrl(
    product.originalImage,
    product.mainImage,
    product.image,
    product.mainImageStoragePath,
    product.imageStoragePath,
    Array.isArray(product.gallery) ? product.gallery.find((entry) => isPersistableAssetUrl(entry)) : ""
  );
  const extraGallery = galleryWithoutMainImage(
    product.gallery || [],
    product.galleryStoragePaths || [],
    mainImage
  );
  const longDescription = joinLongDescription(
    (Array.isArray(product.longDescription) && product.longDescription.length)
      ? product.longDescription
      : (metadata.longDescription || product.description || "")
  );
  const sellingPrice = toNumber(product.price, 0);
  const storedOriginal = toNumber(
    product.oldPrice ?? product.originalPrice ?? product.compareAtPrice ?? metadata.originalPrice,
    0
  );

  return sanitizeDraft({
    productId: catalogId,
    savedProductId: catalogId,
    info: {
      name: product.name || product.title || "",
      shortName: metadata.shortName || product.shortName || "",
      category: product.category || "general",
      brand: product.brand || metadata.brand || product.badge || "",
      manufacturer: metadata.manufacturer || "",
      countryOfOrigin: metadata.countryOfOrigin || "",
      tags: tags.join(", "),
      visibility: product.visibility || "both",
      productType: metadata.productType || (colorVariants.length ? "variable" : "simple"),
      condition: metadata.condition || "new",
      highlights: highlights.join(", "),
      warranty: metadata.warranty || "none",
      warrantyCustom: metadata.warrantyCustom || "",
      featuredProduct: Boolean(
        metadata.featuredProduct
        || metadata.featuredHomepage
        || metadata.featuredProducts
        || placement.includes("featured_products")
      ),
      placement,
      positionMode: metadata.positionMode || product.positionMode || "automatic",
      priorityScore: String(
        Math.max(0, Math.min(100, Math.floor(toNumber(metadata.priorityScore ?? product.priority, 50))))
      ),
      publishStatus: metadata.publishStatus || (product.status === "inactive" ? "inactive" : (product.status === "draft" ? "draft" : "active"))
    },
    description: {
      description: longDescription || product.description || product.shortDescription || "",
      longDescription,
      shortDescription: product.shortDescription || metadata.shortDescription || ""
    },
    pricing: {
      costPrice: String(product.costPrice ?? metadata.costPrice ?? ""),
      originalPrice: storedOriginal > sellingPrice ? String(storedOriginal) : "",
      sellingPrice: String(product.price ?? ""),
      currency: metadata.currency || "RWF"
    },
    inventory: {
      sku: product.sku || metadata.sku || "",
      quantity: String(product.stock ?? 0),
      stockStatus: inferStockStatus(product.stock),
      variantsEnabled: Boolean(product.variants?.enabled || colorVariants.length || variants.length),
      sizes,
      customSizes: Array.isArray(metadata.customSizes) ? metadata.customSizes : [],
      attributes: metadata.inventoryAttributes && typeof metadata.inventoryAttributes === "object" ? metadata.inventoryAttributes : {},
      variants,
      colorVariants
    },
    media: {
      mainImage,
      mainImageStoragePath: preferCanonicalStoragePath(
        product.mainImageStoragePath,
        product.imageStoragePath,
        mainImage
      ),
      gallery: extraGallery.gallery,
      galleryStoragePaths: extraGallery.galleryStoragePaths
    },
    seo: {
      metaTitle: product.metaTitle || metadata.metaTitle || product.title || product.name || "",
      metaDescription: product.metaDescription || metadata.metaDescription || product.shortDescription || product.description || "",
      slug: product.slug || metadata.slug || slugify(product.name || product.title || ""),
      slugManual: Boolean(metadata.slugManual)
    }
  });
}

export function getSizeOptionsForCategory(category) {
  return getSizeOptions(category);
}

export { parseTagsInput, inferStockStatus };
