import {
  buildMerchandisingFoundation,
  CAMPAIGN_SLOT_OPTIONS,
  createDefaultMerchandisingState,
  FEATURED_PLACEMENT_OPTIONS,
  FEATURED_TAG_OPTIONS,
  HOMEPAGE_PLACEMENT_OPTIONS,
  ORDERING_MODE_OPTIONS,
  PUBLISHING_STATE_OPTIONS,
  RECOMMENDATION_FLOW_OPTIONS,
  SHOP_PLACEMENT_OPTIONS,
  SORTING_STRATEGY_OPTIONS,
  normalizeMerchandisingState,
  setSurfaceVisibility,
  setVisibilityPreset
} from "./product-merchandising.js";
import {
  buildClassificationFoundation,
  CAMPAIGN_GROUP_OPTIONS,
  CATEGORY_INHERITANCE_OPTIONS,
  CATEGORY_OPTIONS,
  CATEGORY_RELATIONSHIP_OPTIONS,
  COLLECTION_GROUP_OPTIONS,
  createDefaultClassificationState,
  FILTER_PRIORITY_OPTIONS,
  getSubcategoryOptions,
  HOMEPAGE_GROUP_OPTIONS,
  RECOMMENDATION_GROUP_OPTIONS,
  SEARCH_BOOST_OPTIONS,
  SEASONAL_GROUP_OPTIONS
} from "./product-classification.js";

export const DEFAULT_IMAGE = "../img/logo.png";
export const TAG_SUGGESTIONS = ["new-arrival", "homepage", "shop-ready", "featured-drop", "limited-offer", "best-seller"];
export const LABEL_SUGGESTIONS = ["Featured", "Trending", "Premium", "Limited", "New", "Editor Pick"];

export const CURRENCY_OPTIONS = [
  { value: "RWF", label: "RWF" },
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" }
];
export const STATUS_OPTIONS = PUBLISHING_STATE_OPTIONS;
export const VISIBILITY_OPTIONS = [
  { value: "home", label: "Show in Home", description: "Homepage spotlight rows and curated merchandising." },
  { value: "shop", label: "Show in Shop", description: "Shop grid cards, category listings, and browsing." },
  { value: "both", label: "Show Everywhere", description: "Homepage, shop, and downstream storefront surfaces." }
];
export const POSITION_OPTIONS = [
  { value: "top", label: "Top", description: "Highest merchandising priority for future sort rules." },
  { value: "middle", label: "Middle", description: "Balanced placement for standard catalog ordering." },
  { value: "bottom", label: "Bottom", description: "Lower-priority placement for long-tail catalog entries." }
];

const DEFAULT_COLOR_VARIANT_OPTIONS = [
  "Black|black|#111111",
  "White|white|#f7f7f7",
  "Emerald|emerald|#00b894"
];

const DEFAULT_SIZE_VARIANT_OPTIONS = [
  "XS|xs",
  "S|s",
  "M|m",
  "L|l"
];

const DEFAULT_STYLE_VARIANT_OPTIONS = [
  "Classic|classic",
  "Regular|regular",
  "Premium|premium"
];
export {
  CAMPAIGN_GROUP_OPTIONS,
  CAMPAIGN_SLOT_OPTIONS,
  CATEGORY_INHERITANCE_OPTIONS,
  CATEGORY_RELATIONSHIP_OPTIONS,
  COLLECTION_GROUP_OPTIONS,
  FEATURED_PLACEMENT_OPTIONS,
  FEATURED_TAG_OPTIONS,
  FILTER_PRIORITY_OPTIONS,
  HOMEPAGE_GROUP_OPTIONS,
  HOMEPAGE_PLACEMENT_OPTIONS,
  ORDERING_MODE_OPTIONS,
  RECOMMENDATION_GROUP_OPTIONS,
  RECOMMENDATION_FLOW_OPTIONS,
  SEARCH_BOOST_OPTIONS,
  SEASONAL_GROUP_OPTIONS,
  SHOP_PLACEMENT_OPTIONS,
  SORTING_STRATEGY_OPTIONS
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  if (isPlainObject(value)) {
    return Object.entries(value).reduce((result, [key, entry]) => {
      result[key] = cloneValue(entry);
      return result;
    }, {});
  }

  return value;
}

function toTrimmedString(value) {
  return String(value || "").trim();
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toSlug(value) {
  return toTrimmedString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueItems(values, transformer = (value) => value) {
  const seen = new Set();
  const result = [];

  values.forEach((value) => {
    const key = transformer(value);
    if (!key || seen.has(key)) {
      return;
    }

    seen.add(key);
    result.push(value);
  });

  return result;
}

function splitVariantToken(value) {
  return String(value || "")
    .split("|")
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function toVariantOptionTokens(options, fallbackTokens = []) {
  const source = Array.isArray(options) ? options : [];
  const tokens = source
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

  return tokens.length ? uniqueItems(tokens, (entry) => entry.toLowerCase()) : [...fallbackTokens];
}

function createDefaultVariantGroup({ label, type, required = true, options = [] }) {
  return {
    enabled: true,
    label,
    type,
    required,
    optionTokens: [...options]
  };
}

export function createDefaultVariantFoundation() {
  return {
    enabled: false,
    optionMode: "structured",
    imagePerColor: true,
    pricingPerVariant: false,
    inventoryReady: true,
    skuPerVariant: true,
    groups: {
      color: createDefaultVariantGroup({
        label: "Color",
        type: "color",
        required: true,
        options: DEFAULT_COLOR_VARIANT_OPTIONS
      }),
      size: createDefaultVariantGroup({
        label: "Size",
        type: "size",
        required: true,
        options: DEFAULT_SIZE_VARIANT_OPTIONS
      }),
      style: createDefaultVariantGroup({
        label: "Style",
        type: "text",
        required: false,
        options: DEFAULT_STYLE_VARIANT_OPTIONS
      })
    }
  };
}

export function normalizeVariantFoundation(source = {}) {
  const fallback = createDefaultVariantFoundation();
  const groupsSource = source?.groups && typeof source.groups === "object" ? source.groups : {};

  const groups = Object.entries(fallback.groups).reduce((result, [groupKey, fallbackGroup]) => {
    const nextGroup = groupsSource[groupKey] && typeof groupsSource[groupKey] === "object" ? groupsSource[groupKey] : {};
    result[groupKey] = {
      enabled: Boolean(nextGroup.enabled ?? fallbackGroup.enabled),
      label: toTrimmedString(nextGroup.label, fallbackGroup.label),
      type: ["color", "size", "image", "text"].includes(toTrimmedString(nextGroup.type || fallbackGroup.type).toLowerCase())
        ? toTrimmedString(nextGroup.type || fallbackGroup.type).toLowerCase()
        : fallbackGroup.type,
      required: Boolean(nextGroup.required ?? fallbackGroup.required),
      optionTokens: toVariantOptionTokens(nextGroup.optionTokens || nextGroup.options || fallbackGroup.optionTokens, fallbackGroup.optionTokens)
    };
    return result;
  }, {});

  return {
    enabled: Boolean(source?.enabled ?? fallback.enabled),
    optionMode: toTrimmedString(source?.optionMode, fallback.optionMode) || fallback.optionMode,
    imagePerColor: Boolean(source?.imagePerColor ?? fallback.imagePerColor),
    pricingPerVariant: Boolean(source?.pricingPerVariant ?? fallback.pricingPerVariant),
    inventoryReady: Boolean(source?.inventoryReady ?? fallback.inventoryReady),
    skuPerVariant: Boolean(source?.skuPerVariant ?? fallback.skuPerVariant),
    groups
  };
}

export function buildVariantAttributesFromFoundation(variantFoundation) {
  const foundation = normalizeVariantFoundation(variantFoundation);

  return Object.entries(foundation.groups)
    .map(([groupKey, group]) => {
      if (!group.enabled) {
        return null;
      }

      const options = uniqueItems(group.optionTokens, (entry) => entry.toLowerCase())
        .map((token) => {
          const [labelPart, valuePart, swatchPart, imagePart] = splitVariantToken(token);
          const label = labelPart || valuePart || token;
          const value = (valuePart || labelPart || token).toLowerCase();

          return {
            label,
            value,
            swatch: group.type === "color" ? (swatchPart || "") : "",
            image: group.type === "color" ? (imagePart || "") : "",
            stock: 0,
            availability: "future",
            isDefault: false
          };
        })
        .filter((option) => option.value);

      if (!group.label || !options.length) {
        return null;
      }

      return {
        name: group.label,
        key: groupKey,
        axis: group.type,
        type: group.type,
        required: group.required !== false,
        options
      };
    })
    .filter(Boolean);
}

function getValueByPath(source, path) {
  return String(path || "")
    .split(".")
    .filter(Boolean)
    .reduce((value, segment) => value?.[segment], source);
}

function setValueByPath(source, path, nextValue) {
  const segments = String(path || "").split(".").filter(Boolean);
  if (!segments.length) {
    return cloneValue(source);
  }

  const draft = cloneValue(source);
  let cursor = draft;

  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      cursor[segment] = nextValue;
      return;
    }

    if (!isPlainObject(cursor[segment])) {
      cursor[segment] = {};
    }

    cursor = cursor[segment];
  });

  return draft;
}

function normalizeToken(value, preserveCase = false) {
  const trimmed = toTrimmedString(value).replace(/\s+/g, " ");
  if (!trimmed) {
    return "";
  }

  return preserveCase ? trimmed : toSlug(trimmed);
}

export function getCategorySubcategoryOptions(categoryValue) {
  return getSubcategoryOptions(categoryValue);
}

export function createDefaultProductDraft() {
  return {
    basic: {
      name: "",
      shortDescription: "",
      fullDescription: "",
      summary: "",
      brand: "",
      sku: "",
      productCode: ""
    },
    pricing: {
      originalPrice: "",
      discountPrice: "",
      currency: "RWF",
      saleEnabled: false
    },
    classification: {
      ...createDefaultClassificationState()
    },
    variants: createDefaultVariantFoundation(),
    merchandising: createDefaultMerchandisingState(),
    media: {
      mainImage: null,
      gallery: []
    }
  };
}

export function cloneDraft(draft) {
  return cloneValue(draft);
}

export function getDraftValue(draft, path) {
  return getValueByPath(draft, path);
}

export function setDraftValue(draft, path, value) {
  return setValueByPath(draft, path, value);
}

export function addDraftToken(draft, path, value, options = {}) {
  const normalized = normalizeToken(value, options.preserveCase === true);
  if (!normalized) {
    return draft;
  }

  const current = Array.isArray(getDraftValue(draft, path)) ? getDraftValue(draft, path) : [];
  const next = uniqueItems([...current, normalized], (entry) => options.preserveCase === true ? entry.toLowerCase() : entry);
  return setDraftValue(draft, path, next);
}

export function removeDraftToken(draft, path, value) {
  const current = Array.isArray(getDraftValue(draft, path)) ? getDraftValue(draft, path) : [];
  const normalized = String(value || "").toLowerCase();
  return setDraftValue(draft, path, current.filter((entry) => String(entry || "").toLowerCase() !== normalized));
}

export function updateMerchandisingSurface(draft, surface, enabled) {
  return setDraftValue(draft, "merchandising", setSurfaceVisibility(getDraftValue(draft, "merchandising"), surface, enabled));
}

export function updateMerchandisingVisibilityPreset(draft, preset) {
  return setDraftValue(draft, "merchandising", setVisibilityPreset(getDraftValue(draft, "merchandising"), preset));
}

export function createImageAsset(fileData) {
  return {
    id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: toTrimmedString(fileData?.name || "Image") || "Image",
    size: Number(fileData?.size || 0),
    type: toTrimmedString(fileData?.type || "image/*") || "image/*",
    src: toTrimmedString(fileData?.dataUrl || "")
  };
}

export function attachDraftImages(draft, target, assets) {
  const nextDraft = cloneDraft(draft);
  const normalizedAssets = Array.isArray(assets) ? assets.filter(Boolean) : [];

  if (target === "main") {
    nextDraft.media.mainImage = normalizedAssets[0] || null;
    if (normalizedAssets.length > 1) {
      nextDraft.media.gallery = [...normalizedAssets.slice(1), ...nextDraft.media.gallery];
    }
    return nextDraft;
  }

  nextDraft.media.gallery = [...nextDraft.media.gallery, ...normalizedAssets];
  return nextDraft;
}

export function removeGalleryImage(draft, imageId) {
  const nextDraft = cloneDraft(draft);
  nextDraft.media.gallery = nextDraft.media.gallery.filter((image) => image.id !== imageId);
  return nextDraft;
}

export function promoteGalleryImage(draft, imageId) {
  const nextDraft = cloneDraft(draft);
  const match = nextDraft.media.gallery.find((image) => image.id === imageId);
  if (!match) {
    return nextDraft;
  }

  nextDraft.media.mainImage = match;
  nextDraft.media.gallery = nextDraft.media.gallery.filter((image) => image.id !== imageId);
  return nextDraft;
}

export function clearMainImage(draft) {
  const nextDraft = cloneDraft(draft);
  nextDraft.media.mainImage = null;
  return nextDraft;
}

export function resolveAdminImage(src) {
  const value = toTrimmedString(src);
  if (!value) {
    return DEFAULT_IMAGE;
  }

  if (/^(?:https?:|data:|blob:|\/)/i.test(value)) {
    return value;
  }

  if (value.startsWith("../")) {
    return value;
  }

  return `../${value.replace(/^\.\//, "")}`;
}

export function getPrimaryImage(draft) {
  return resolveAdminImage(
    draft?.media?.mainImage?.src || draft?.media?.gallery?.[0]?.src || DEFAULT_IMAGE
  );
}

export function getActivePrice(draft) {
  const originalPrice = toNumber(draft?.pricing?.originalPrice);
  const discountPrice = toNumber(draft?.pricing?.discountPrice);
  const saleEnabled = Boolean(draft?.pricing?.saleEnabled);
  return saleEnabled && discountPrice > 0 ? discountPrice : originalPrice;
}

export function getCompareAtPrice(draft) {
  const originalPrice = toNumber(draft?.pricing?.originalPrice);
  const discountPrice = toNumber(draft?.pricing?.discountPrice);
  const saleEnabled = Boolean(draft?.pricing?.saleEnabled);
  return saleEnabled && discountPrice > 0 && originalPrice > discountPrice ? originalPrice : 0;
}

export function getDraftStatusLabel(draft) {
  return buildMerchandisingFoundation(draft?.merchandising).labels.status;
}

export function getDraftVisibilityLabel(draft) {
  return buildMerchandisingFoundation(draft?.merchandising).labels.visibility;
}

export function getDraftPositionLabel(draft) {
  return buildMerchandisingFoundation(draft?.merchandising).labels.position;
}

export function getDraftBadgeLabel(draft) {
  const merchandising = buildMerchandisingFoundation(draft?.merchandising);
  if (merchandising.future.highlightTag) {
    return merchandising.labels.featuredTag;
  }

  if (Boolean(draft?.pricing?.saleEnabled) && toNumber(draft?.pricing?.discountPrice) > 0) {
    return "On Sale";
  }

  if (draft?.merchandising?.status === "published") {
    return "Live";
  }

  if (draft?.merchandising?.status === "hidden") {
    return "Hidden";
  }

  return "Draft";
}

export function buildProductFoundation(draft) {
  const basic = {
    name: toTrimmedString(draft?.basic?.name),
    shortDescription: toTrimmedString(draft?.basic?.shortDescription),
    fullDescription: toTrimmedString(draft?.basic?.fullDescription),
    summary: toTrimmedString(draft?.basic?.summary),
    brand: toTrimmedString(draft?.basic?.brand),
    sku: toTrimmedString(draft?.basic?.sku).toUpperCase(),
    productCode: toTrimmedString(draft?.basic?.productCode).toUpperCase()
  };

  const pricing = {
    originalPrice: toNumber(draft?.pricing?.originalPrice),
    discountPrice: toNumber(draft?.pricing?.discountPrice),
    currency: toTrimmedString(draft?.pricing?.currency || "RWF") || "RWF",
    saleEnabled: Boolean(draft?.pricing?.saleEnabled)
  };

  const classificationSeed = {
    ...(draft?.classification || {}),
    tags: uniqueItems((draft?.classification?.tags || []).map((entry) => normalizeToken(entry)), (entry) => entry),
    labels: uniqueItems((draft?.classification?.labels || []).map((entry) => normalizeToken(entry, true)), (entry) => entry.toLowerCase())
  };
  const classification = buildClassificationFoundation(classificationSeed);
  const variants = normalizeVariantFoundation(draft?.variants);
  const variantAttributes = buildVariantAttributesFromFoundation(variants);

  const merchandising = buildMerchandisingFoundation(normalizeMerchandisingState(draft?.merchandising));

  const media = {
    mainImage: draft?.media?.mainImage || null,
    gallery: Array.isArray(draft?.media?.gallery) ? draft.media.gallery.filter(Boolean) : []
  };

  const compareAtPrice = pricing.saleEnabled && pricing.discountPrice > 0 && pricing.originalPrice > pricing.discountPrice
    ? pricing.originalPrice
    : 0;
  const activePrice = pricing.saleEnabled && pricing.discountPrice > 0 ? pricing.discountPrice : pricing.originalPrice;
  const gallerySources = uniqueItems([
    media.mainImage?.src,
    ...media.gallery.map((image) => image?.src)
  ].map((entry) => toTrimmedString(entry)).filter(Boolean), (entry) => entry);
  const rendering = {
    ...merchandising.rendering,
    featuredPlacement: merchandising.rendering.featuredPlacement || classification.labels.some((label) => label.toLowerCase() === "featured")
  };
  const searchKeywords = uniqueItems([
    ...classification.tags,
    ...classification.labels.map((label) => label.toLowerCase()),
    ...classification.search.filterTokens,
    ...classification.search.inheritedKeywords,
    ...Object.values(variants.groups).flatMap((group) => [group.label, ...group.optionTokens.map((token) => splitVariantToken(token)[0] || token)]),
    classification.subcategory,
    basic.brand,
    basic.productCode,
    basic.sku,
    basic.name
  ].map((entry) => toSlug(entry)).filter(Boolean), (entry) => entry);
  const futurePayload = {
    name: basic.name,
    title: basic.name,
    description: basic.summary || basic.shortDescription,
    shortDescription: basic.shortDescription,
    longDescription: basic.fullDescription ? [basic.fullDescription] : [],
    badge: classification.labels[0] || getDraftBadgeLabel(draft),
    category: classification.category,
    price: activePrice,
    oldPrice: compareAtPrice,
    image: gallerySources[0] || "",
    mainImage: gallerySources[0] || "",
    gallery: gallerySources,
    keywords: searchKeywords,
    visibility: merchandising.future.visibility,
    priority: merchandising.future.priority,
    orderIndex: merchandising.future.orderIndex,
    highlightTag: merchandising.future.highlightTag,
    status: merchandising.future.status,
    page: "product-details1.html",
    url: "",
    sku: basic.sku,
    productCode: basic.productCode,
    brand: basic.brand,
    summary: basic.summary,
    subcategory: classification.subcategory,
    attributes: variantAttributes,
    variants,
    labels: classification.labels,
    taxonomy: classification.future.taxonomy,
    grouping: classification.future.grouping,
    categoryRendering: classification.future.rendering,
    positioning: merchandising.future.positioning
  };

  return {
    basic,
    pricing: {
      ...pricing,
      activePrice,
      compareAtPrice
    },
    classification,
    merchandising,
    media,
    rendering,
    workflow: {
      ...merchandising.workflow
    },
    readiness: {
      supportsGallery: true,
      supportsVariants: true,
      supportsInventory: true,
      supportsSeo: true,
      supportsAnalytics: true,
      supportsRecommendations: true,
      supportsSearchFiltering: true
    },
    futurePayload
  };
}
