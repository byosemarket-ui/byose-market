import { slugify, toNumber, sanitizePersistedGallery, isPersistableAssetUrl, normalizeStoragePath } from "./utils.js";
import { parseTagsInput } from "./draft.js";

function resolveInfoPriority(info = {}) {
  const mode = String(info.positionMode || "automatic").toLowerCase();
  if (mode === "top") return 100;
  if (mode === "middle") return 50;
  if (mode === "bottom") return 10;
  return Math.max(0, Math.min(100, Math.floor(toNumber(info.priorityScore, 50))));
}

function buildSeoMetadata(seo = {}) {
  return {
    focusKeywordRw: String(seo.focusKeywordRw || "").trim(),
    focusKeywordEn: String(seo.focusKeywordEn || "").trim(),
    searchVisibility: String(seo.searchVisibility || "homepage_shop"),
    slugManual: Boolean(seo.slugManual)
  };
}

function buildInfoMetadata(info = {}) {
  const highlights = parseTagsInput(info.highlights);
  const placement = Array.isArray(info.placement) ? info.placement : parseTagsInput(info.placement);

  return {
    shortName: String(info.shortName || "").trim(),
    productType: String(info.productType || "simple"),
    condition: String(info.condition || "new"),
    manufacturer: String(info.manufacturer || "").trim(),
    countryOfOrigin: String(info.countryOfOrigin || "").trim(),
    searchKeywords: parseTagsInput(info.searchKeywords),
    highlights,
    warranty: String(info.warranty || "none"),
    warrantyCustom: String(info.warrantyCustom || "").trim(),
    featuredHomepage: Boolean(info.featuredHomepage),
    featuredProducts: Boolean(info.featuredProducts),
    featuredBestSellers: Boolean(info.featuredBestSellers),
    featuredFreshPicks: Boolean(info.featuredFreshPicks),
    placement,
    positionMode: String(info.positionMode || "automatic"),
    priorityScore: resolveInfoPriority(info),
    shortDescription: String(info.shortDescription || "").trim(),
    longDescription: String(info.longDescription || info.description || "").trim()
  };
}

function buildColorAttribute(colors = []) {
  const options = colors
    .map((entry) => ({
      label: String(entry?.name || "").trim(),
      value: slugify(entry?.name || entry?.label || ""),
      swatch: String(entry?.hex || "#00b894").trim() || "#00b894",
      stock: 0,
      availability: "future"
    }))
    .filter((entry) => entry.label && entry.value);

  if (!options.length) {
    return null;
  }

  return {
    name: "Color",
    key: "color",
    axis: "color",
    type: "color",
    required: false,
    options
  };
}

function buildVariantItems(variants = []) {
  return (Array.isArray(variants) ? variants : [])
    .map((entry, index) => ({
      id: slugify(entry?.label || `variant-${index + 1}`) || `variant-${index + 1}`,
      label: String(entry?.label || "").trim() || `Variant ${index + 1}`,
      colorName: String(entry?.colorName || "").trim(),
      image: String(entry?.image || "").trim(),
      stock: Math.max(0, Math.floor(toNumber(entry?.stock, 0)))
    }))
    .filter((entry) => entry.label);
}

function buildSizeAttribute(sizes = []) {
  const options = sizes
    .map((entry) => ({
      label: String(entry || "").trim(),
      value: slugify(entry),
      stock: 0,
      availability: "future"
    }))
    .filter((entry) => entry.label && entry.value);

  if (!options.length) {
    return null;
  }

  return {
    name: "Size",
    key: "size",
    axis: "size",
    type: "size",
    required: false,
    options
  };
}

function buildVariantFoundation(attributes = []) {
  const groups = {};
  attributes.forEach((attribute) => {
    const key = String(attribute.key || attribute.axis || "option").toLowerCase();
    groups[key] = {
      enabled: true,
      label: attribute.name || key,
      type: attribute.type || attribute.axis || "text",
      required: false,
      optionTokens: (attribute.options || []).map((option) => {
        const label = String(option.label || option.value || "").trim();
        const value = String(option.value || option.label || "").trim();
        const swatch = String(option.swatch || option.hex || "").trim();
        return [label, value, swatch].filter(Boolean).join("|");
      })
    };
  });

  return {
    enabled: attributes.length > 0,
    optionMode: "structured",
    imagePerColor: false,
    pricingPerVariant: false,
    inventoryReady: true,
    skuPerVariant: false,
    groups
  };
}

export function buildProductPayload(draft, assetOverrides = {}) {
  const safeDraft = draft && typeof draft === "object" ? draft : {};
  const info = safeDraft.info || {};
  const pricing = safeDraft.pricing || {};
  const inventory = safeDraft.inventory || {};
  const media = safeDraft.media || {};
  const seo = safeDraft.seo || {};

  const sellingPrice = toNumber(pricing.sellingPrice, 0);
  const discountPrice = toNumber(pricing.discountPrice, 0);
  const oldPrice = discountPrice > sellingPrice ? discountPrice : 0;
  const tags = parseTagsInput(info.tags);
  const searchKeywords = parseTagsInput(info.searchKeywords);
  const keywords = [...new Set([...tags, ...searchKeywords])];
  const infoMetadata = buildInfoMetadata(info);
  const seoMetadata = buildSeoMetadata(seo);
  const slug = slugify(seo.slug || info.name);
  const persistedGallery = sanitizePersistedGallery(
    assetOverrides.gallery || media.gallery || [],
    assetOverrides.galleryStoragePaths || media.galleryStoragePaths || []
  );
  const mainImage = isPersistableAssetUrl(assetOverrides.mainImage || media.mainImage)
    ? String(assetOverrides.mainImage || media.mainImage || "").trim()
    : "";
  const mainImageStoragePath = normalizeStoragePath(
    assetOverrides.mainImageStoragePath || media.mainImageStoragePath || mainImage
  );
  const gallery = persistedGallery.gallery;
  const galleryStoragePaths = persistedGallery.galleryStoragePaths;

  const variantItems = buildVariantItems(inventory.variants);
  const variantStock = variantItems.reduce((sum, entry) => sum + entry.stock, 0);
  const totalStock = variantItems.length
    ? variantStock
    : Math.max(0, Math.floor(toNumber(inventory.quantity, 0)));
  const attributes = [];
  if (inventory.variantsEnabled) {
    const colorAttribute = buildColorAttribute(variantItems.map((entry) => ({ name: entry.colorName || entry.label })));
    const sizeAttribute = buildSizeAttribute(inventory.sizes);
    if (colorAttribute) {
      attributes.push(colorAttribute);
    }
    if (sizeAttribute) {
      attributes.push(sizeAttribute);
    }
  }

  const stockStatus = totalStock <= 0
    ? "out_of_stock"
    : totalStock <= 5
      ? "low_stock"
      : totalStock <= 20
        ? "limited_stock"
        : "in_stock";
  const status = stockStatus === "out_of_stock" ? "inactive" : "active";

  return {
    name: String(info.name || "").trim(),
    title: String(info.shortName || info.name || "").trim() || String(info.name || "").trim(),
    description: String(info.longDescription || info.description || "").trim(),
    shortDescription: String(info.shortDescription || info.longDescription || info.description || "").trim(),
    category: String(info.category || "general").toLowerCase(),
    brand: String(info.brand || "").trim(),
    sku: String(info.sku || "").trim(),
    tags,
    keywords,
    highlights: infoMetadata.highlights,
    price: sellingPrice,
    oldPrice,
    costPrice: toNumber(pricing.costPrice, 0),
    taxRate: toNumber(pricing.taxRate, 0),
    taxIncluded: Boolean(pricing.taxIncluded),
    stock: totalStock,
    visibility: String(info.visibility || "both").toLowerCase(),
    status,
    mainImage,
    image: mainImage,
    mainImageStoragePath,
    imageStoragePath: mainImageStoragePath,
    gallery,
    galleryStoragePaths,
    metaTitle: String(seo.metaTitle || info.name || "").trim(),
    metaDescription: String(seo.metaDescription || info.shortDescription || info.longDescription || info.description || "").trim(),
    slug,
    attributes,
    variants: {
      ...buildVariantFoundation(attributes),
      items: variantItems
    },
    badge: String(info.brand || "").trim(),
    priority: resolveInfoPriority(info),
    orderIndex: resolveInfoPriority(info) * 2,
    metadata: {
      ...infoMetadata,
      ...seoMetadata,
      inventoryAttributes: inventory.attributes && typeof inventory.attributes === "object" ? inventory.attributes : {},
      customSizes: Array.isArray(inventory.customSizes) ? inventory.customSizes : [],
      variantStockTotal: totalStock
    }
  };
}

export function validateStep(step, draft, options = {}) {
  const hasPendingMainImage = Boolean(options.hasPendingMainImage);
  const errors = [];
  const info = draft?.info || {};
  const pricing = draft?.pricing || {};
  const inventory = draft?.inventory || {};
  const media = draft?.media || {};
  const seo = draft?.seo || {};

  if (step === "info") {
    if (!String(info.name || "").trim()) {
      errors.push("Product name is required.");
    }
    if (!String(info.category || "").trim()) {
      errors.push("Category is required.");
    }
    if (String(info.warranty || "") === "custom" && !String(info.warrantyCustom || "").trim()) {
      errors.push("Enter custom warranty details.");
    }
  }

  if (step === "pricing") {
    if (!String(pricing.sellingPrice || "").trim() || toNumber(pricing.sellingPrice, 0) <= 0) {
      errors.push("Selling price must be greater than zero.");
    }
    const discount = toNumber(pricing.discountPrice, 0);
    const selling = toNumber(pricing.sellingPrice, 0);
    if (discount > 0 && discount <= selling) {
      errors.push("Discount price must be higher than the selling price to show as a strike-through.");
    }
  }

  if (step === "inventory") {
    if (toNumber(inventory.quantity, 0) < 0) {
      errors.push("Quantity cannot be negative.");
    }
    if (inventory.variantsEnabled && (!Array.isArray(inventory.variants) || !inventory.variants.length)) {
      errors.push("Add at least one product variant.");
    }
    if (Array.isArray(inventory.variants)) {
      const invalidVariant = inventory.variants.some((entry) => !String(entry?.label || "").trim());
      if (invalidVariant) {
        errors.push("Each variant must have a label.");
      }
    }
  }

  if (step === "media") {
    const hasPersistedMainImage = Boolean(String(media.mainImage || "").trim());
    if (!hasPendingMainImage && !hasPersistedMainImage) {
      errors.push("Main product image is required.");
    }
  }

  if (step === "seo") {
    if (!String(seo.metaTitle || info.name || "").trim()) {
      errors.push("Meta title is required.");
    }
    if (!String(seo.slug || slugify(info.name)).trim()) {
      errors.push("Product slug is required.");
    }
    const titleLength = String(seo.metaTitle || info.name || "").trim().length;
    if (titleLength > 60) {
      errors.push("Meta title should be 60 characters or fewer.");
    }
    const descLength = String(seo.metaDescription || "").trim().length;
    if (descLength > 160) {
      errors.push("Meta description should be 160 characters or fewer.");
    }
  }

  if (step === "review") {
    errors.push(...validateStep("info", draft, options));
    errors.push(...validateStep("pricing", draft, options));
    errors.push(...validateStep("inventory", draft, options));
    errors.push(...validateStep("media", draft, options));
    errors.push(...validateStep("seo", draft, options));
  }

  return Array.from(new Set(errors));
}

export function validateAllSteps(draft, options = {}) {
  return validateStep("review", draft, options);
}
