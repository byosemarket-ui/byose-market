import { slugify, toNumber, sanitizePersistedGallery, isPersistableAssetUrl, normalizeStoragePath } from "./utils.js";
import { parseTagsInput } from "./draft.js";

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

  const attributes = [];
  if (inventory.variantsEnabled) {
    const colorAttribute = buildColorAttribute(inventory.colors);
    const sizeAttribute = buildSizeAttribute(inventory.sizes);
    if (colorAttribute) {
      attributes.push(colorAttribute);
    }
    if (sizeAttribute) {
      attributes.push(sizeAttribute);
    }
  }

  const stockStatus = String(inventory.stockStatus || "in_stock").toLowerCase();
  const status = stockStatus === "out_of_stock" ? "inactive" : "active";

  return {
    name: String(info.name || "").trim(),
    description: String(info.description || "").trim(),
    shortDescription: String(info.description || "").trim(),
    category: String(info.category || "general").toLowerCase(),
    brand: String(info.brand || "").trim(),
    sku: String(info.sku || "").trim(),
    tags,
    keywords: tags,
    price: sellingPrice,
    oldPrice,
    costPrice: toNumber(pricing.costPrice, 0),
    taxRate: toNumber(pricing.taxRate, 0),
    taxIncluded: Boolean(pricing.taxIncluded),
    stock: Math.max(0, Math.floor(toNumber(inventory.quantity, 0))),
    visibility: String(info.visibility || "both").toLowerCase(),
    status,
    mainImage,
    image: mainImage,
    mainImageStoragePath,
    imageStoragePath: mainImageStoragePath,
    gallery,
    galleryStoragePaths,
    metaTitle: String(seo.metaTitle || info.name || "").trim(),
    metaDescription: String(seo.metaDescription || info.description || "").trim(),
    slug,
    attributes,
    variants: buildVariantFoundation(attributes),
    badge: String(info.brand || "").trim(),
    priority: 0,
    orderIndex: 200
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
    if (inventory.variantsEnabled) {
      if (!inventory.colors?.length && !inventory.sizes?.length) {
        errors.push("Enable at least one color or size when variants are enabled.");
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
