import {
  CAMPAIGN_GROUP_OPTIONS,
  CAMPAIGN_SLOT_OPTIONS,
  CATEGORY_OPTIONS,
  CATEGORY_INHERITANCE_OPTIONS,
  CATEGORY_RELATIONSHIP_OPTIONS,
  COLLECTION_GROUP_OPTIONS,
  CURRENCY_OPTIONS,
  FEATURED_PLACEMENT_OPTIONS,
  FILTER_PRIORITY_OPTIONS,
  getCategorySubcategoryOptions,
  HOMEPAGE_GROUP_OPTIONS,
  HOMEPAGE_PLACEMENT_OPTIONS,
  POSITION_OPTIONS,
  RECOMMENDATION_GROUP_OPTIONS,
  RECOMMENDATION_FLOW_OPTIONS,
  SEARCH_BOOST_OPTIONS,
  SEASONAL_GROUP_OPTIONS,
  SHOP_PLACEMENT_OPTIONS,
  SORTING_STRATEGY_OPTIONS,
  STATUS_OPTIONS,
  buildProductFoundation
} from "./product-draft.js";
import {
  FEATURED_TAG_OPTIONS,
  ORDERING_MODE_OPTIONS,
  PUBLISHING_STATE_OPTIONS
} from "./product-merchandising.js";

const HOMEPAGE_FEATURED_LIMIT = 6;

function toTrimmedString(value) {
  return String(value || "").trim();
}

function normalizeIdentifier(value) {
  return toTrimmedString(value).replace(/\s+/g, "").toUpperCase();
}

function isUnsafeText(value) {
  return /<[^>]*>|javascript:|data:/i.test(String(value || ""));
}

function addIssue(target, path, message) {
  if (!target[path]) {
    target[path] = [];
  }

  target[path].push(message);
}

function flattenIssues(target) {
  return Object.entries(target).reduce((result, [path, messages]) => {
    if (!messages.length) {
      return result;
    }

    result[path] = messages[0];
    return result;
  }, {});
}

function isOptionValue(options, value) {
  return options.some((option) => option.value === value);
}

function isNonNegativeIntegerValue(value) {
  return Number.isInteger(Number(value)) && Number(value) >= 0;
}

function normalizeVariantToken(value) {
  return String(value || '').trim();
}

function splitVariantToken(value) {
  return normalizeVariantToken(value)
    .split('|')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function countCompletedFields(foundation) {
  const checks = [
    foundation.basic.name,
    foundation.basic.shortDescription,
    foundation.basic.fullDescription,
    foundation.basic.summary,
    foundation.basic.brand,
    foundation.basic.sku,
    foundation.basic.productCode,
    foundation.pricing.originalPrice > 0,
    foundation.pricing.currency,
    foundation.classification.category,
    foundation.classification.subcategory,
    foundation.merchandising.status,
    foundation.merchandising.position,
    foundation.merchandising.featuredTag,
    foundation.merchandising.orderingMode,
    foundation.merchandising.positioning?.sortStrategy,
    foundation.merchandising.positioning?.homePlacement,
    foundation.merchandising.positioning?.shopPlacement,
    foundation.merchandising.positioning?.campaignSlot,
    foundation.merchandising.positioning?.recommendationFlow,
    foundation.merchandising.surfaces?.home || foundation.merchandising.surfaces?.shop,
    foundation.media.mainImage?.src,
    foundation.variants?.enabled && Object.values(foundation.variants?.groups || {}).some((group) => group.enabled && Array.isArray(group.optionTokens) && group.optionTokens.length > 0)
  ];

  if (foundation.merchandising.status === "scheduled") {
    checks.push(foundation.merchandising.scheduleAt);
  }

  return checks.filter(Boolean).length;
}

function findDuplicate(existingProducts, field, value) {
  const normalized = normalizeIdentifier(value);
  if (!normalized) {
    return null;
  }

  return (existingProducts || []).find((product) => normalizeIdentifier(product?.[field] || product?.catalogId || product?.id) === normalized) || null;
}

export function validateProductDraft(draft, options = {}) {
  const existingProducts = Array.isArray(options.existingProducts) ? options.existingProducts : [];
  const foundation = buildProductFoundation(draft);
  const errorMap = {};
  const warningMap = {};

  if (foundation.basic.name.length < 3) {
    addIssue(errorMap, "basic.name", "Enter a product name with at least 3 characters.");
  }
  if (foundation.basic.name.length > 120) {
    addIssue(errorMap, "basic.name", "Product name must stay under 120 characters.");
  }
  if (isUnsafeText(foundation.basic.name)) {
    addIssue(errorMap, "basic.name", "Unsafe characters are not allowed in the product name.");
  }

  if (foundation.basic.shortDescription.length < 12) {
    addIssue(errorMap, "basic.shortDescription", "Short description should contain at least 12 characters.");
  }
  if (foundation.basic.shortDescription.length > 220) {
    addIssue(errorMap, "basic.shortDescription", "Short description should stay under 220 characters for card compatibility.");
  }
  if (isUnsafeText(foundation.basic.shortDescription)) {
    addIssue(errorMap, "basic.shortDescription", "Short description contains unsafe markup-like input.");
  }

  if (foundation.basic.fullDescription.length < 30) {
    addIssue(errorMap, "basic.fullDescription", "Full description should contain at least 30 characters.");
  }
  if (foundation.basic.fullDescription.length > 2400) {
    addIssue(errorMap, "basic.fullDescription", "Full description should stay under 2400 characters.");
  }
  if (isUnsafeText(foundation.basic.fullDescription)) {
    addIssue(errorMap, "basic.fullDescription", "Full description contains unsafe markup-like input.");
  }

  if (foundation.basic.summary.length < 16) {
    addIssue(errorMap, "basic.summary", "Product summary should contain at least 16 characters.");
  }
  if (foundation.basic.summary.length > 260) {
    addIssue(errorMap, "basic.summary", "Product summary should stay under 260 characters.");
  }
  if (isUnsafeText(foundation.basic.summary)) {
    addIssue(errorMap, "basic.summary", "Product summary contains unsafe markup-like input.");
  }

  if (foundation.basic.brand.length < 2) {
    addIssue(errorMap, "basic.brand", "Brand should contain at least 2 characters.");
  }
  if (foundation.basic.brand.length > 80) {
    addIssue(errorMap, "basic.brand", "Brand should stay under 80 characters.");
  }

  if (!/^[A-Z0-9][A-Z0-9-_/]{2,39}$/i.test(foundation.basic.sku)) {
    addIssue(errorMap, "basic.sku", "Use 3-40 characters with letters, numbers, hyphens, underscores, or slashes.");
  }

  if (!/^[A-Z0-9][A-Z0-9-_/]{2,39}$/i.test(foundation.basic.productCode)) {
    addIssue(errorMap, "basic.productCode", "Use 3-40 characters with letters, numbers, hyphens, underscores, or slashes.");
  }

  const duplicateSku = findDuplicate(existingProducts, "sku", foundation.basic.sku);
  if (duplicateSku) {
    addIssue(errorMap, "basic.sku", `SKU already exists in the live catalog (${duplicateSku.name || duplicateSku.id}).`);
  }

  const duplicateProductCode = findDuplicate(existingProducts, "productCode", foundation.basic.productCode);
  if (duplicateProductCode) {
    addIssue(errorMap, "basic.productCode", `Product code already exists in the live catalog (${duplicateProductCode.name || duplicateProductCode.id}).`);
  }

  if (foundation.pricing.originalPrice <= 0) {
    addIssue(errorMap, "pricing.originalPrice", "Original price must be greater than zero.");
  }

  if (!isOptionValue(CURRENCY_OPTIONS, foundation.pricing.currency)) {
    addIssue(errorMap, "pricing.currency", "Select a supported currency.");
  }

  if (foundation.pricing.saleEnabled) {
    if (foundation.pricing.discountPrice <= 0) {
      addIssue(errorMap, "pricing.discountPrice", "Discount price is required when sale status is enabled.");
    }
    if (foundation.pricing.discountPrice >= foundation.pricing.originalPrice) {
      addIssue(errorMap, "pricing.discountPrice", "Discount price must be lower than the original price.");
    }
  } else if (foundation.pricing.discountPrice > 0) {
    addIssue(warningMap, "pricing.discountPrice", "Discount price is set but sale status is still disabled.");
  }

  if (!isOptionValue(CATEGORY_OPTIONS, foundation.classification.category)) {
    addIssue(errorMap, "classification.category", "Choose a supported category.");
  }

  if (foundation.classification.subcategory.length < 2) {
    addIssue(errorMap, "classification.subcategory", "Enter a subcategory with at least 2 characters.");
  }
  if (foundation.classification.subcategory.length > 80) {
    addIssue(errorMap, "classification.subcategory", "Subcategory should stay under 80 characters.");
  }

  if (foundation.classification.tags.length > 10) {
    addIssue(errorMap, "classification.tags", "Use no more than 10 tags for a single product.");
  }
  if (foundation.classification.labels.length > 6) {
    addIssue(errorMap, "classification.labels", "Use no more than 6 labels for a single product.");
  }

  if (!isOptionValue(CATEGORY_RELATIONSHIP_OPTIONS, foundation.classification.taxonomy?.relationship)) {
    addIssue(errorMap, "classification.taxonomy.relationship", "Choose a supported category relationship model.");
  }

  if (!isOptionValue(CATEGORY_INHERITANCE_OPTIONS, foundation.classification.taxonomy?.inheritance)) {
    addIssue(errorMap, "classification.taxonomy.inheritance", "Choose a supported category inheritance strategy.");
  }

  if (!isOptionValue(COLLECTION_GROUP_OPTIONS, foundation.classification.organization?.collectionGroup)) {
    addIssue(errorMap, "classification.organization.collectionGroup", "Choose a supported collection grouping option.");
  }

  if (!isOptionValue(SEASONAL_GROUP_OPTIONS, foundation.classification.organization?.seasonalGroup)) {
    addIssue(errorMap, "classification.organization.seasonalGroup", "Choose a supported seasonal grouping option.");
  }

  if (!isOptionValue(CAMPAIGN_GROUP_OPTIONS, foundation.classification.organization?.campaignGroup)) {
    addIssue(errorMap, "classification.organization.campaignGroup", "Choose a supported campaign grouping option.");
  }

  if (!isOptionValue(HOMEPAGE_GROUP_OPTIONS, foundation.classification.organization?.homepageGroup)) {
    addIssue(errorMap, "classification.organization.homepageGroup", "Choose a supported homepage grouping option.");
  }

  if (!isOptionValue(RECOMMENDATION_GROUP_OPTIONS, foundation.classification.organization?.recommendationGroup)) {
    addIssue(errorMap, "classification.organization.recommendationGroup", "Choose a supported recommendation grouping option.");
  }

  if (!isOptionValue(SEARCH_BOOST_OPTIONS, foundation.classification.organization?.searchBoost)) {
    addIssue(errorMap, "classification.organization.searchBoost", "Choose a supported search boost profile.");
  }

  if (!isOptionValue(FILTER_PRIORITY_OPTIONS, foundation.classification.organization?.filterPriority)) {
    addIssue(errorMap, "classification.organization.filterPriority", "Choose a supported filter priority profile.");
  }

  const primaryCategory = String(foundation.classification.taxonomy?.primaryCategory || foundation.classification.category || "").trim();
  if (!primaryCategory) {
    addIssue(errorMap, "classification.taxonomy.primaryCategory", "A primary category is required for classification foundations.");
  }

  const validSubcategories = getCategorySubcategoryOptions(primaryCategory).map((entry) => entry.value);
  const normalizedSubcategory = String(foundation.classification.subcategory || "").trim();
  if (normalizedSubcategory && validSubcategories.length && !validSubcategories.includes(normalizedSubcategory)) {
    addIssue(errorMap, "classification.subcategory", "Selected subcategory does not match the active primary category hierarchy.");
  }

  const secondaryCategories = Array.isArray(foundation.classification.taxonomy?.secondaryCategories)
    ? foundation.classification.taxonomy.secondaryCategories
    : [];
  const duplicateSecondary = new Set();
  secondaryCategories.forEach((entry) => {
    const normalized = String(entry || "").trim();
    if (!normalized) {
      return;
    }

    if (normalized === primaryCategory) {
      addIssue(errorMap, "classification.taxonomy.secondaryCategories", "Primary category cannot also be assigned as a secondary category.");
      return;
    }

    if (duplicateSecondary.has(normalized)) {
      addIssue(errorMap, "classification.taxonomy.secondaryCategories", "Duplicate secondary category assignments are not allowed.");
      return;
    }

    duplicateSecondary.add(normalized);
  });

  if (foundation.classification.taxonomy?.relationship === "cross-category" && secondaryCategories.length === 0) {
    addIssue(warningMap, "classification.taxonomy.secondaryCategories", "Cross-category relationship is selected, but no secondary categories are assigned yet.");
  }

  if (foundation.classification.taxonomy?.inheritance === "category-labels" && foundation.classification.labels.length === 0) {
    addIssue(warningMap, "classification.labels", "Category label inheritance is selected, but no product labels are staged yet.");
  }

  if (foundation.classification.organization?.campaignGroup !== "none" && foundation.workflow.isHidden) {
    addIssue(warningMap, "classification.organization.campaignGroup", "Campaign grouping is active while product status is hidden. Campaign exposure remains suppressed until republish.");
  }

  if (foundation.classification.organization?.homepageGroup === "hero" && !Boolean(foundation.merchandising.surfaces?.home)) {
    addIssue(warningMap, "classification.organization.homepageGroup", "Hero homepage grouping is selected while Home visibility is turned off.");
  }

  if (!isOptionValue(PUBLISHING_STATE_OPTIONS, foundation.merchandising.status)) {
    addIssue(errorMap, "merchandising.status", "Choose a supported product state.");
  }

  if (!isOptionValue(POSITION_OPTIONS, foundation.merchandising.position)) {
    addIssue(errorMap, "merchandising.position", "Choose a supported positioning option.");
  }

  if (!isOptionValue(FEATURED_TAG_OPTIONS, foundation.merchandising.featuredTag)) {
    addIssue(errorMap, "merchandising.featuredTag", "Choose a supported featured product treatment.");
  }

  if (!isOptionValue(ORDERING_MODE_OPTIONS, foundation.merchandising.orderingMode)) {
    addIssue(errorMap, "merchandising.orderingMode", "Choose a supported ordering foundation.");
  }

  if (!isOptionValue(SORTING_STRATEGY_OPTIONS, foundation.merchandising.positioning?.sortStrategy)) {
    addIssue(errorMap, "merchandising.positioning.sortStrategy", "Choose a supported rendering priority strategy.");
  }

  if (!isOptionValue(HOMEPAGE_PLACEMENT_OPTIONS, foundation.merchandising.positioning?.homePlacement)) {
    addIssue(errorMap, "merchandising.positioning.homePlacement", "Choose a supported homepage placement foundation.");
  }

  if (!isOptionValue(SHOP_PLACEMENT_OPTIONS, foundation.merchandising.positioning?.shopPlacement)) {
    addIssue(errorMap, "merchandising.positioning.shopPlacement", "Choose a supported shop placement foundation.");
  }

  if (!isOptionValue(FEATURED_PLACEMENT_OPTIONS, foundation.merchandising.positioning?.featuredPlacement)) {
    addIssue(errorMap, "merchandising.positioning.featuredPlacement", "Choose a supported featured placement foundation.");
  }

  if (!isOptionValue(CAMPAIGN_SLOT_OPTIONS, foundation.merchandising.positioning?.campaignSlot)) {
    addIssue(errorMap, "merchandising.positioning.campaignSlot", "Choose a supported campaign merchandising slot.");
  }

  if (!isOptionValue(RECOMMENDATION_FLOW_OPTIONS, foundation.merchandising.positioning?.recommendationFlow)) {
    addIssue(errorMap, "merchandising.positioning.recommendationFlow", "Choose a supported recommendation flow foundation.");
  }

  [
    "homeOrder",
    "shopOrder",
    "featuredOrder",
    "categoryOrder",
    "recommendationOrder"
  ].forEach((fieldName) => {
    const fieldValue = foundation.merchandising.positioning?.[fieldName];
    if (!isNonNegativeIntegerValue(fieldValue)) {
      addIssue(errorMap, `merchandising.positioning.${fieldName}`, "Use a whole number greater than or equal to zero for ordering controls.");
    }
  });

  const homeSurfaceEnabled = Boolean(foundation.merchandising.surfaces?.home);
  const shopSurfaceEnabled = Boolean(foundation.merchandising.surfaces?.shop);

  if (!homeSurfaceEnabled && !shopSurfaceEnabled && foundation.workflow.isPublished) {
    addIssue(errorMap, "merchandising.visibility", "Published or featured products must remain visible on Home, Shop, or both storefront surfaces.");
  }

  if (foundation.workflow.isHidden && (homeSurfaceEnabled || shopSurfaceEnabled)) {
    addIssue(warningMap, "merchandising.visibility", "Hidden status overrides the current surface toggles until the product is republished.");
  }

  if (foundation.workflow.isScheduled && !foundation.merchandising.scheduleAt) {
    addIssue(errorMap, "merchandising.scheduleAt", "Choose a planned publish date or time before using scheduled status.");
  }

  if (!foundation.workflow.isScheduled && foundation.merchandising.scheduleAt) {
    addIssue(warningMap, "merchandising.scheduleAt", "A publish schedule is staged, but scheduled status is not active yet.");
  }

  if (foundation.rendering.featuredPlacement && !homeSurfaceEnabled) {
    addIssue(warningMap, "merchandising.featuredTag", "Featured and highlighted placement is strongest on Home, but Home visibility is currently disabled.");
  }

  if (foundation.merchandising.positioning?.sortStrategy === "manual") {
    const hasManualSequence = [
      foundation.merchandising.positioning.homeOrder,
      foundation.merchandising.positioning.shopOrder,
      foundation.merchandising.positioning.featuredOrder,
      foundation.merchandising.positioning.categoryOrder,
      foundation.merchandising.positioning.recommendationOrder
    ].some((value) => Number(value) > 0);

    if (!hasManualSequence) {
      addIssue(warningMap, "merchandising.positioning.sortStrategy", "Manual ranking is enabled, but no explicit sequencing values have been set yet.");
    }
  }

  if (foundation.merchandising.positioning?.featuredPlacement !== "none" && !foundation.rendering.featuredPlacement) {
    addIssue(warningMap, "merchandising.positioning.featuredPlacement", "Featured placement is configured, but featured treatment is still standard. Pair this with a featured or highlighted treatment when ready.");
  }

  if (foundation.merchandising.positioning?.featuredPlacement === "none" && Number(foundation.merchandising.positioning?.featuredOrder) > 0) {
    addIssue(warningMap, "merchandising.positioning.featuredOrder", "Featured order is set, but featured placement is currently disabled.");
  }

  if (!homeSurfaceEnabled && Number(foundation.merchandising.positioning?.homeOrder) > 0) {
    addIssue(warningMap, "merchandising.positioning.homeOrder", "Homepage sequence is set, but Home visibility is currently off.");
  }

  if (!shopSurfaceEnabled && Number(foundation.merchandising.positioning?.shopOrder) > 0) {
    addIssue(warningMap, "merchandising.positioning.shopOrder", "Shop sequence is set, but Shop visibility is currently off.");
  }

  if (foundation.workflow.isHidden && foundation.merchandising.positioning?.campaignSlot !== "none") {
    addIssue(warningMap, "merchandising.positioning.campaignSlot", "Campaign slot is reserved, but hidden status suppresses storefront merchandising until republished.");
  }

  if (foundation.merchandising.position === "top" && foundation.merchandising.positioning?.homePlacement === "trailing-grid") {
    addIssue(warningMap, "merchandising.positioning.homePlacement", "Top positioning conflicts with a trailing homepage placement. Promote the homepage slot or lower the positioning bucket.");
  }

  if (foundation.merchandising.position === "bottom" && foundation.merchandising.positioning?.shopPlacement === "featured-first") {
    addIssue(warningMap, "merchandising.positioning.shopPlacement", "Bottom positioning conflicts with featured-first shop placement. Align the global position or shop placement before publish.");
  }

  const existingHomepageFeaturedCount = existingProducts.filter((product) => {
    const visibility = normalizeIdentifier(product?.visibility || "both").toLowerCase();
    const status = normalizeIdentifier(product?.status || "").toLowerCase();
    const highlightTag = normalizeIdentifier(product?.highlightTag || "").toLowerCase();
    return (visibility === "home" || visibility === "both") && (highlightTag === "featured" || status === "featured");
  }).length;

  if (foundation.rendering.featuredPlacement && homeSurfaceEnabled && existingHomepageFeaturedCount >= HOMEPAGE_FEATURED_LIMIT) {
    addIssue(warningMap, "merchandising.featuredTag", `Homepage spotlight already has ${HOMEPAGE_FEATURED_LIMIT} featured products, so this placement may not appear in the first merchandising row.`);
  }

  if (!foundation.media.mainImage?.src) {
    addIssue(errorMap, "media.mainImage", "Add a main image so storefront previews and future publishing can render safely.");
  }

  if (foundation.media.gallery.length > 8) {
    addIssue(warningMap, "media.gallery", "Large galleries are supported later, but keep the initial setup focused for STEP 3C.");
  }

  const variantFoundation = foundation.variants || {};
  const variantGroups = variantFoundation.groups || {};
  const enabledVariantGroups = Object.entries(variantGroups).filter(([, group]) => Boolean(group?.enabled));

  if (variantFoundation.enabled && !enabledVariantGroups.length) {
    addIssue(errorMap, "variants.enabled", "Enable at least one variant group before turning on the variant foundation.");
  }

  enabledVariantGroups.forEach(([groupKey, group]) => {
    const optionTokens = Array.isArray(group?.optionTokens) ? group.optionTokens.map(normalizeVariantToken).filter(Boolean) : [];

    if (!group.label) {
      addIssue(errorMap, `variants.groups.${groupKey}.label`, "Provide a group label so the storefront can render the option header cleanly.");
    }

    if (!optionTokens.length) {
      addIssue(errorMap, `variants.groups.${groupKey}.optionTokens`, "Add at least one option token to this variant group.");
      return;
    }

    const duplicateValues = new Set();
    optionTokens.forEach((token) => {
      const [label, value] = splitVariantToken(token);
      const normalizedValue = String(value || label || '').toLowerCase();
      if (!normalizedValue) {
        addIssue(errorMap, `variants.groups.${groupKey}.optionTokens`, "Variant options must include a display label and value.");
        return;
      }

      if (duplicateValues.has(normalizedValue)) {
        addIssue(errorMap, `variants.groups.${groupKey}.optionTokens`, `Duplicate ${group.label.toLowerCase()} values are not allowed.`);
        return;
      }

      duplicateValues.add(normalizedValue);
    });

    if (group.type === "color") {
      const hasSwatchTokens = optionTokens.some((token) => splitVariantToken(token)[2]);
      if (!hasSwatchTokens) {
        addIssue(warningMap, `variants.groups.${groupKey}.optionTokens`, "Color options are staged without swatch values yet. Add hex values for premium visual rendering.");
      }
    }

    if (group.type === "size" && optionTokens.length < 2) {
      addIssue(warningMap, `variants.groups.${groupKey}.optionTokens`, "Size groups usually need at least two staged sizes for a useful storefront foundation.");
    }
  });

  if (variantFoundation.pricingPerVariant) {
    addIssue(warningMap, "variants.pricingPerVariant", "Per-variant pricing is staged, but advanced variant pricing remains deferred until the inventory phase.");
  }

  if (variantFoundation.inventoryReady && !variantFoundation.enabled) {
    addIssue(warningMap, "variants.inventoryReady", "Inventory-ready scaffolding is present, but the variant foundation is still disabled.");
  }

  const errors = flattenIssues(errorMap);
  const warnings = flattenIssues(warningMap);
  const totalTrackedFields = foundation.merchandising.status === "scheduled" ? 25 : 24;
  const completedFields = countCompletedFields(foundation);
  const completion = Math.round((completedFields / totalTrackedFields) * 100);
  const firstErrorPath = Object.keys(errors)[0] || "";
  const firstWarningPath = Object.keys(warnings)[0] || "";

  return {
    foundation,
    errors,
    warnings,
    errorCount: Object.keys(errors).length,
    warningCount: Object.keys(warnings).length,
    isValid: Object.keys(errors).length === 0,
    completion,
    completedFields,
    totalTrackedFields,
    firstErrorPath,
    firstWarningPath,
    duplicateSku: duplicateSku ? duplicateSku.id || duplicateSku.catalogId || duplicateSku.name : "",
    duplicateProductCode: duplicateProductCode ? duplicateProductCode.id || duplicateProductCode.catalogId || duplicateProductCode.name : ""
  };
}
