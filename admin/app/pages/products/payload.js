import { slugify, toNumber, sanitizePersistedGallery, isPersistableAssetUrl, normalizeStoragePath } from "./utils.js";
import { parseTagsInput } from "./draft.js";
import { PLACEMENT_OPTIONS, POSITION_MODE_OPTIONS } from "./constants.js";
import { computeProductDiscount } from "./pricing.js";
import {
  buildAttributesFromColorVariants,
  buildFlatInventoryItems,
  buildVariantFoundationForColorSize,
  computeProductTotalStock,
  migrateLegacyToColorVariants,
  normalizeColorVariants
} from "../../../../js/color-variant-inventory.js";

const VALID_PLACEMENT_VALUES = new Set(PLACEMENT_OPTIONS.map((entry) => entry.value));
const VALID_POSITION_MODES = new Set(POSITION_MODE_OPTIONS.map((entry) => entry.value));
const VALID_VISIBILITY = new Set(["both", "home", "shop"]);

function toLabel(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function splitLongDescription(text) {
  return String(text || "")
    .split(/\n{2,}|\r\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);
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

function resolvePriorityScore(info = {}) {
  return Math.max(0, Math.min(100, Math.floor(toNumber(info.priorityScore, 50))));
}

function resolvePositionMode(info = {}) {
  const mode = String(info.positionMode || "automatic").trim().toLowerCase();
  return VALID_POSITION_MODES.has(mode) ? mode : "automatic";
}

function resolveOrderIndex(positionMode, priorityScore) {
  const score = resolvePriorityScore({ priorityScore });
  if (positionMode === "top") {
    return 3000 + score;
  }
  if (positionMode === "middle") {
    return 2000 + score;
  }
  if (positionMode === "bottom") {
    return 1000 + score;
  }
  if (score >= 75) {
    return 2500 + score;
  }
  if (score >= 40) {
    return 2000 + score;
  }
  return 1500 + score;
}

function normalizePlacementSelections(info = {}) {
  const raw = Array.isArray(info.placement) ? info.placement : [];
  const selected = raw
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter((entry) => VALID_PLACEMENT_VALUES.has(entry));

  if (Boolean(info.featuredProduct) && !selected.includes("featured_products")) {
    selected.push("featured_products");
  }

  return [...new Set(selected)];
}

function resolveHighlightTag(placement = [], featured = false) {
  if (placement.includes("flash_deals")) {
    return "trending";
  }
  if (placement.includes("new_arrivals")) {
    return "new";
  }
  if (placement.includes("featured_products") || featured) {
    return "featured";
  }
  return "";
}

function resolveAutoPlacement(info = {}) {
  return normalizePlacementSelections(info);
}

function buildInfoMetadata(info = {}, description = {}) {
  const highlights = parseTagsInput(info.highlights);
  const searchKeywords = buildAutoKeywords(info, description);
  const featured = Boolean(info.featuredProduct);
  const placement = resolveAutoPlacement(info);
  const positionMode = resolvePositionMode(info);
  const priorityScore = resolvePriorityScore(info);

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
    featuredBestSellers: placement.includes("best_sellers"),
    featuredFreshPicks: placement.includes("fresh_picks"),
    placement,
    positionMode,
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

function buildColorVariantsFromInventory(inventory = {}) {
  const fromDraft = normalizeColorVariants(inventory.colorVariants);
  if (fromDraft.length) {
    return fromDraft;
  }
  return migrateLegacyToColorVariants(inventory.variants, inventory.sizes);
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

  const discountSummary = computeProductDiscount(pricing);
  const sellingPrice = discountSummary.sellingPrice;
  const oldPrice = discountSummary.oldPrice;
  const discountPercent = discountSummary.discountPercent;
  const discountAmount = discountSummary.discountAmount;
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
  const positionMode = infoMetadata.positionMode;
  const placement = infoMetadata.placement;
  const orderIndex = resolveOrderIndex(positionMode, priorityScore);
  const highlightTag = resolveHighlightTag(placement, infoMetadata.featuredProduct);

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

  const colorVariants = buildColorVariantsFromInventory(inventory);
  const variantItems = buildFlatInventoryItems(colorVariants);
  const totalStock = inventory.variantsEnabled && colorVariants.length
    ? computeProductTotalStock(colorVariants, 0)
    : Math.max(0, Math.floor(toNumber(inventory.quantity, 0)));
  const attributes = inventory.variantsEnabled && colorVariants.length
    ? buildAttributesFromColorVariants(colorVariants)
    : [];

  const stockStatus = totalStock <= 0
    ? "out_of_stock"
    : totalStock <= 5
      ? "low_stock"
      : totalStock <= 20
        ? "limited_stock"
        : "in_stock";

  const publishStatus = String(info.publishStatus || "active").toLowerCase();
  const status = publishStatus === "inactive"
    ? "inactive"
    : (publishStatus === "draft" ? "draft" : "active");

  const catalogId = Math.max(0, Math.floor(toNumber(safeDraft.productId || safeDraft.savedProductId, 0)));

  return {
    ...(catalogId ? { id: catalogId, catalogId } : {}),
    name: String(info.name || "").trim(),
    title: String(info.shortName || info.name || "").trim() || String(info.name || "").trim(),
    description: String(description.longDescription || description.description || "").trim(),
    shortDescription: String(description.shortDescription || description.longDescription || description.description || "").trim(),
    longDescription: splitLongDescription(description.longDescription || description.description || ""),
    category: String(info.category || "general").toLowerCase(),
    brand: String(info.brand || "").trim(),
    sku: String(inventory.sku || "").trim(),
    tags,
    keywords,
    highlights: infoMetadata.highlights,
    price: sellingPrice,
    oldPrice,
    originalPrice: oldPrice,
    compareAtPrice: oldPrice,
    discountPercent,
    costPrice: toNumber(pricing.costPrice, 0),
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
      ...(inventory.variantsEnabled && colorVariants.length
        ? buildVariantFoundationForColorSize(colorVariants)
        : buildVariantFoundation(attributes)),
      items: variantItems
    },
    badge: String(info.brand || "").trim(),
    priority: priorityScore,
    orderIndex,
    highlightTag,
    metadata: {
      ...infoMetadata,
      inventoryAttributes: inventory.attributes && typeof inventory.attributes === "object" ? inventory.attributes : {},
      customSizes: Array.isArray(inventory.customSizes) ? inventory.customSizes : [],
      colorVariants: colorVariants.map((entry) => ({
        id: entry.id,
        clientKey: entry.clientKey || entry.id,
        colorName: entry.colorName,
        image: entry.image,
        imageStoragePath: entry.imageStoragePath || "",
        sizes: entry.sizes.map((row) => ({ size: row.size, stock: row.stock }))
      })),
      variantStockTotal: totalStock,
      stockStatus,
      seoAutoGenerated: true,
      originalPrice: oldPrice,
      sellingPrice,
      discountPercent,
      discountAmount
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
    const original = toNumber(pricing.originalPrice, 0);
    const selling = toNumber(pricing.sellingPrice, 0);
    if (original > 0 && original < selling) {
      errors.push("Igiciro cy'imbere rigomba kuba kinini cyangwa kingana n'igiciro cyo kugurisha / Original price must be greater than or equal to selling price.");
    }
  }

  if (step === "inventory") {
    if (toNumber(inventory.quantity, 0) < 0) {
      errors.push("Umubare wa stock ntushobora kuba uciriritse / Quantity cannot be negative.");
    }
    if (inventory.variantsEnabled) {
      const colorVariants = buildColorVariantsFromInventory(inventory);
      if (!colorVariants.length) {
        errors.push("Ongeramo nibura ibara rimwe / Add at least one color variant.");
      }
      const invalidColor = colorVariants.some((entry) => !String(entry?.colorName || "").trim());
      if (invalidColor) {
        errors.push("Buri bara rigomba kugira izina / Each color variant must have a name.");
      }
      const missingSizes = colorVariants.some((entry) => !Array.isArray(entry.sizes) || !entry.sizes.length);
      if (missingSizes) {
        errors.push("Buri bara rigomba kugira nibura ingano imwe / Each color must have at least one size.");
      }
      const invalidSize = colorVariants.some((entry) =>
        (entry.sizes || []).some((row) => !String(row?.size || "").trim())
      );
      if (invalidSize) {
        errors.push("Buri size igomba kugira izina / Each size row must have a size value.");
      }
      const missingImage = colorVariants.some((entry) => !isPersistableAssetUrl(entry?.image));
      if (missingImage) {
        errors.push("Buri bara rigomba kugira ifoto yoherejwe / Each color variant must have an uploaded image.");
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
    const visibility = String(info.visibility || "both").toLowerCase();
    if (!VALID_VISIBILITY.has(visibility)) {
      errors.push("Hitamo aho product igaragara / Select product visibility.");
    }

    const placement = Array.isArray(info.placement) ? info.placement : [];
    const invalidPlacement = placement.some((entry) => !VALID_PLACEMENT_VALUES.has(String(entry || "").trim().toLowerCase()));
    if (invalidPlacement) {
      errors.push("Hitamo ibice byemewe gusa / Select valid placement sections only.");
    }

    const positionMode = String(info.positionMode || "automatic").toLowerCase();
    if (!VALID_POSITION_MODES.has(positionMode)) {
      errors.push("Hitamo aho product ihagaze / Select a valid product position.");
    }

    const priorityScore = toNumber(info.priorityScore, NaN);
    if (!Number.isFinite(priorityScore) || priorityScore < 0 || priorityScore > 100) {
      errors.push("Priority Score igomba kuba hagati ya 0 na 100 / Priority score must be between 0 and 100.");
    }

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
