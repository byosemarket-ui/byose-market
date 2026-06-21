import { slugify, toNumber, sanitizePersistedGallery, isPersistableAssetUrl, normalizeStoragePath } from "./utils.js";
import { parseTagsInput } from "./draft.js";

function toLabel(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildAutoKeywords(info = {}, description = {}) {
  const tags = parseTagsInput(info.tags);
  const highlights = parseTagsInput(info.highlights);
  const parts = [
    info.name,
    info.shortName,
    info.brand,
    info.manufacturer,
    info.category,
    description.shortDescription,
    ...tags,
    ...highlights
  ];
  return [...new Set(
    parts
      .flatMap((entry) => String(entry || "").split(/[\s,;/]+/))
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 2)
  )];
}

function buildAutoSeo(info = {}, description = {}, brand = "") {
  const name = String(info.name || "").trim();
  const category = toLabel(info.category || "general");
  const shortDesc = String(description.shortDescription || description.longDescription || "").trim();
  const metaTitle = `${brand ? `${brand} | ` : ""}${name}${category ? ` | ${category}` : ""} | BYOSE Market`
    .replace(/\s+\|\s+\|/g, " | ")
    .trim()
    .slice(0, 80);
  const metaDescription = (shortDesc || `${name}${brand ? ` by ${brand}` : ""}. Shop on BYOSE Market.`).slice(0, 160);
  return {
    metaTitle,
    metaDescription,
    slug: slugify(name)
  };
}

function resolveAutoPriority(info = {}) {
  if (Boolean(info.featuredProduct)) {
    return 75;
  }
  return 50;
}

function resolveAutoPlacement(info = {}) {
  const visibility = String(info.visibility || "both").toLowerCase();
  const placement = ["all"];
  if (Boolean(info.featuredProduct)) {
    placement.push("featured", "homepage");
  }
  if (visibility === "home" || visibility === "both") {
    placement.push("homepage");
  }
  if (visibility === "shop" || visibility === "both") {
    placement.push("shop");
  }
  return [...new Set(placement)];
}

function buildInfoMetadata(info = {}, description = {}) {
  const highlights = parseTagsInput(info.highlights);
  const searchKeywords = buildAutoKeywords(info, description);
  const featured = Boolean(info.featuredProduct);
  const priorityScore = resolveAutoPriority(info);

  return {
    shortName: String(info.shortName || "").trim(),
    productType: String(info.productType || "simple"),
    condition: String(info.condition || "new"),
    manufacturer: String(info.manufacturer || "").trim(),
    countryOfOrigin: String(info.countryOfOrigin || "").trim(),
    searchKeywords,
    highlights,
    warranty: String(info.warranty || "none"),
    warrantyCustom: String(info.warrantyCustom || "").trim(),
    featuredProduct: featured,
    featuredHomepage: featured,
    featuredProducts: featured,
    featuredBestSellers: false,
    featuredFreshPicks: false,
    placement: resolveAutoPlacement(info),
    positionMode: "automatic",
    priorityScore,
    publishStatus: String(info.publishStatus || "active"),
    shortDescription: String(description.shortDescription || "").trim(),
    longDescription: String(description.longDescription || description.description || "").trim()
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
  const description = safeDraft.description || {};
  const pricing = safeDraft.pricing || {};
  const inventory = safeDraft.inventory || {};
  const media = safeDraft.media || {};
  const seoInput = safeDraft.seo || {};

  const sellingPrice = toNumber(pricing.sellingPrice, 0);
  const discountPrice = toNumber(pricing.discountPrice, 0);
  const oldPrice = discountPrice > sellingPrice ? discountPrice : 0;
  const tags = parseTagsInput(info.tags);
  const autoSeo = buildAutoSeo(info, description, info.brand);
  const infoMetadata = buildInfoMetadata(info, description);
  const keywords = [...new Set([...tags, ...infoMetadata.searchKeywords])];
  const slug = slugify(seoInput.slug || autoSeo.slug || info.name);
  const metaTitle = String(seoInput.metaTitle || autoSeo.metaTitle || info.name || "").trim();
  const metaDescription = String(
    seoInput.metaDescription
    || autoSeo.metaDescription
    || description.shortDescription
    || description.longDescription
    || ""
  ).trim();
  const priorityScore = infoMetadata.priorityScore;

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

  const publishStatus = String(info.publishStatus || "active").toLowerCase();
  const status = publishStatus === "inactive" || stockStatus === "out_of_stock"
    ? "inactive"
    : (publishStatus === "draft" ? "draft" : "active");

  return {
    name: String(info.name || "").trim(),
    title: String(info.shortName || info.name || "").trim() || String(info.name || "").trim(),
    description: String(description.longDescription || description.description || "").trim(),
    shortDescription: String(description.shortDescription || description.longDescription || description.description || "").trim(),
    category: String(info.category || "general").toLowerCase(),
    brand: String(info.brand || "").trim(),
    sku: String(inventory.sku || "").trim(),
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
    metaTitle,
    metaDescription,
    slug,
    attributes,
    variants: {
      ...buildVariantFoundation(attributes),
      items: variantItems
    },
    badge: String(info.brand || "").trim(),
    priority: priorityScore,
    orderIndex: priorityScore * 2,
    metadata: {
      ...infoMetadata,
      inventoryAttributes: inventory.attributes && typeof inventory.attributes === "object" ? inventory.attributes : {},
      customSizes: Array.isArray(inventory.customSizes) ? inventory.customSizes : [],
      variantStockTotal: totalStock,
      seoAutoGenerated: true
    }
  };
}

export function validateStep(step, draft, options = {}) {
  const hasPendingMainImage = Boolean(options.hasPendingMainImage);
  const errors = [];
  const info = draft?.info || {};
  const description = draft?.description || {};
  const pricing = draft?.pricing || {};
  const inventory = draft?.inventory || {};
  const media = draft?.media || {};

  if (step === "info") {
    if (!String(info.name || "").trim()) {
      errors.push("Izina rya product rirakenewe / Product name is required.");
    }
    if (!String(info.category || "").trim()) {
      errors.push("Icyiciro kirakenewe / Category is required.");
    }
    if (String(info.warranty || "") === "custom" && !String(info.warrantyCustom || "").trim()) {
      errors.push("Andika garanti yihariye / Enter custom warranty details.");
    }
  }

  if (step === "pricing") {
    if (!String(pricing.sellingPrice || "").trim() || toNumber(pricing.sellingPrice, 0) <= 0) {
      errors.push("Igiciro cyo kugurisha kirakenewe / Selling price must be greater than zero.");
    }
    const discount = toNumber(pricing.discountPrice, 0);
    const selling = toNumber(pricing.sellingPrice, 0);
    if (discount > 0 && discount <= selling) {
      errors.push("Igiciro cyo kugabanywa kigomba kuba kinini kurusha igiciro cyo kugurisha / Discount price must be higher than selling price.");
    }
  }

  if (step === "inventory") {
    if (toNumber(inventory.quantity, 0) < 0) {
      errors.push("Umubare wa stock ntushobora kuba uciriritse / Quantity cannot be negative.");
    }
    if (inventory.variantsEnabled && (!Array.isArray(inventory.variants) || !inventory.variants.length)) {
      errors.push("Ongeramo nibura variant imwe / Add at least one product variant.");
    }
    if (Array.isArray(inventory.variants)) {
      const invalidVariant = inventory.variants.some((entry) => !String(entry?.label || "").trim());
      if (invalidVariant) {
        errors.push("Buri variant igomba kugira izina / Each variant must have a label.");
      }
    }
  }

  if (step === "description") {
    if (!String(description.shortDescription || "").trim()) {
      errors.push("Ibisobanuro bigufi birakenewe / Short description is required.");
    }
  }

  if (step === "media") {
    const hasPersistedMainImage = Boolean(String(media.mainImage || "").trim());
    if (!hasPendingMainImage && !hasPersistedMainImage) {
      errors.push("Ifoto nyamukuru irakenewe / Main product image is required.");
    }
  }

  if (step === "publish") {
    if (!["active", "draft", "inactive"].includes(String(info.publishStatus || "active").toLowerCase())) {
      errors.push("Hitamo imiterere ya product / Select a product status.");
    }
  }

  if (step === "review") {
    errors.push(...validateStep("info", draft, options));
    errors.push(...validateStep("pricing", draft, options));
    errors.push(...validateStep("inventory", draft, options));
    errors.push(...validateStep("description", draft, options));
    errors.push(...validateStep("media", draft, options));
    errors.push(...validateStep("publish", draft, options));
  }

  return Array.from(new Set(errors));
}

export function validateAllSteps(draft, options = {}) {
  return validateStep("review", draft, options);
}

export { buildAutoSeo, buildAutoKeywords };
