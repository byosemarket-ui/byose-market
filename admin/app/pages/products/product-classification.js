export const CATEGORY_TAXONOMY = [
  {
    value: "fashion",
    label: "Fashion",
    description: "Apparel, lifestyle wear, and style-led catalog collections.",
    keywords: ["fashion", "apparel", "clothing"],
    subcategories: [
      { value: "women-wear", label: "Women Wear" },
      { value: "men-wear", label: "Men Wear" },
      { value: "streetwear", label: "Streetwear" },
      { value: "formal-wear", label: "Formal Wear" }
    ]
  },
  {
    value: "shoes",
    label: "Shoes",
    description: "Footwear for performance, style, and everyday use.",
    keywords: ["shoes", "footwear", "sneakers"],
    subcategories: [
      { value: "sneakers", label: "Sneakers" },
      { value: "running", label: "Running" },
      { value: "formal", label: "Formal" },
      { value: "sandals", label: "Sandals" }
    ]
  },
  {
    value: "electronics",
    label: "Electronics",
    description: "Smart devices, accessories, and connected technology products.",
    keywords: ["electronics", "devices", "smart"],
    subcategories: [
      { value: "smartphones", label: "Smartphones" },
      { value: "audio", label: "Audio" },
      { value: "wearables", label: "Wearables" },
      { value: "computing", label: "Computing" }
    ]
  },
  {
    value: "beauty",
    label: "Beauty",
    description: "Skincare, cosmetics, and wellness-focused beauty products.",
    keywords: ["beauty", "skincare", "cosmetics"],
    subcategories: [
      { value: "skincare", label: "Skincare" },
      { value: "makeup", label: "Makeup" },
      { value: "fragrance", label: "Fragrance" },
      { value: "hair-care", label: "Hair Care" }
    ]
  },
  {
    value: "home-items",
    label: "Home Items",
    description: "Home decor, utility, and everyday living collections.",
    keywords: ["home", "living", "decor"],
    subcategories: [
      { value: "decor", label: "Decor" },
      { value: "kitchen", label: "Kitchen" },
      { value: "storage", label: "Storage" },
      { value: "lighting", label: "Lighting" }
    ]
  },
  {
    value: "accessories",
    label: "Accessories",
    description: "Bags, watches, jewelry, and daily accessory essentials.",
    keywords: ["accessories", "bags", "watches"],
    subcategories: [
      { value: "bags", label: "Bags" },
      { value: "watches", label: "Watches" },
      { value: "jewelry", label: "Jewelry" },
      { value: "belts", label: "Belts" }
    ]
  }
];

export const CATEGORY_RELATIONSHIP_OPTIONS = [
  { value: "direct", label: "Direct assignment", description: "Product belongs directly to the selected primary category." },
  { value: "parent-child", label: "Parent-child hierarchy", description: "Product follows a nested path from primary category to subcategory." },
  { value: "cross-category", label: "Cross-category relationship", description: "Product spans multiple categories for broader discovery and grouping." }
];

export const CATEGORY_INHERITANCE_OPTIONS = [
  { value: "none", label: "No inheritance", description: "Classification uses only product-specific tags and labels." },
  { value: "category-keywords", label: "Inherit category keywords", description: "Adds category-level keywords into search and filtering foundations." },
  { value: "category-labels", label: "Inherit category labels", description: "Adds category labels for merchandising and grouping consistency." }
];

export const COLLECTION_GROUP_OPTIONS = [
  { value: "core-catalog", label: "Core Catalog", description: "Always-on base collection for long-lived catalog products." },
  { value: "editorial", label: "Editorial Collection", description: "Curated collection for storytelling and manual merchandising edits." },
  { value: "premium", label: "Premium Collection", description: "High-value products grouped for premium browsing experiences." },
  { value: "discovery", label: "Discovery Collection", description: "Long-tail assortment prepared for recommendation and browse surfaces." }
];

export const SEASONAL_GROUP_OPTIONS = [
  { value: "always-on", label: "Always-on", description: "No seasonal restrictions. Product remains in all-season catalog flows." },
  { value: "spring-summer", label: "Spring/Summer", description: "Prepared for warm-season merchandising and seasonal navigation." },
  { value: "autumn-winter", label: "Autumn/Winter", description: "Prepared for cold-season merchandising and category filtering." },
  { value: "holiday", label: "Holiday", description: "Prepared for holiday campaigns and gift-focused grouping." }
];

export const CAMPAIGN_GROUP_OPTIONS = [
  { value: "none", label: "No campaign", description: "Product is not assigned to a campaign-specific group yet." },
  { value: "launch", label: "Launch", description: "Product participates in launch campaign group foundations." },
  { value: "promotion", label: "Promotion", description: "Product participates in promotion and discount-driven campaigns." },
  { value: "clearance", label: "Clearance", description: "Product participates in clearance and stock-reduction campaigns." }
];

export const HOMEPAGE_GROUP_OPTIONS = [
  { value: "standard", label: "Standard Home Group", description: "Prepared for default homepage category and product grouping surfaces." },
  { value: "hero", label: "Hero Home Group", description: "Prepared for top-tier hero category and collection modules." },
  { value: "featured", label: "Featured Home Group", description: "Prepared for premium featured-home grouping zones." },
  { value: "seasonal", label: "Seasonal Home Group", description: "Prepared for seasonal homepage campaign modules." }
];

export const RECOMMENDATION_GROUP_OPTIONS = [
  { value: "balanced", label: "Balanced", description: "Neutral recommendation grouping for broad catalog discovery." },
  { value: "similarity", label: "Similarity", description: "Prepared for related-product and attribute-similarity recommendations." },
  { value: "style-match", label: "Style Match", description: "Prepared for style, trend, and visual-match recommendation systems." },
  { value: "upsell", label: "Upsell", description: "Prepared for premium and upgrade-focused recommendation grouping." }
];

export const SEARCH_BOOST_OPTIONS = [
  { value: "normal", label: "Normal", description: "Standard search weighting for the product classification profile." },
  { value: "boosted", label: "Boosted", description: "Prepared for higher search relevance weighting in category queries." },
  { value: "discoverable", label: "Discoverable", description: "Prepared for broader search visibility and long-tail query coverage." }
];

export const FILTER_PRIORITY_OPTIONS = [
  { value: "standard", label: "Standard", description: "Default category filter priority and listing behavior." },
  { value: "primary", label: "Primary", description: "Prepared to appear in high-priority category filter positions." },
  { value: "supporting", label: "Supporting", description: "Prepared for secondary filter positions and fallback grouping." }
];

function toTrimmedString(value, fallbackValue = "") {
  const result = String(value || "").trim();
  return result || String(fallbackValue || "").trim();
}

function toSlug(value) {
  return toTrimmedString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];

  (Array.isArray(values) ? values : []).forEach((value) => {
    const normalized = toSlug(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    result.push(normalized);
  });

  return result;
}

function normalizeOption(value, options, fallbackValue) {
  const normalized = toTrimmedString(value, fallbackValue).toLowerCase();
  return options.some((option) => option.value === normalized) ? normalized : fallbackValue;
}

function getOptionLabel(options, value, fallbackValue) {
  const match = options.find((option) => option.value === value);
  return match ? match.label : fallbackValue;
}

function findCategoryNode(categoryValue) {
  return CATEGORY_TAXONOMY.find((entry) => entry.value === categoryValue) || null;
}

export const CATEGORY_OPTIONS = CATEGORY_TAXONOMY.map((entry) => ({
  value: entry.value,
  label: entry.label
}));

export function getSubcategoryOptions(categoryValue) {
  const categoryNode = findCategoryNode(categoryValue);
  if (!categoryNode) {
    return [];
  }

  return (categoryNode.subcategories || []).map((entry) => ({
    value: entry.value,
    label: entry.label
  }));
}

export function createDefaultClassificationState() {
  return {
    category: "fashion",
    subcategory: "",
    tags: [],
    labels: [],
    taxonomy: {
      primaryCategory: "fashion",
      secondaryCategories: [],
      relationship: "direct",
      inheritance: "category-keywords",
      customCategoryDraft: "",
      customSubcategoryDraft: ""
    },
    organization: {
      collectionGroup: "core-catalog",
      seasonalGroup: "always-on",
      campaignGroup: "none",
      homepageGroup: "standard",
      recommendationGroup: "balanced",
      searchBoost: "normal",
      filterPriority: "standard"
    }
  };
}

export function normalizeClassificationState(source = {}) {
  const primaryCategory = normalizeOption(
    source?.taxonomy?.primaryCategory || source?.category,
    CATEGORY_OPTIONS,
    "fashion"
  );
  const subcategoryOptions = getSubcategoryOptions(primaryCategory);
  const subcategoryValue = toSlug(source?.subcategory || source?.taxonomy?.customSubcategoryDraft);
  const subcategory = subcategoryOptions.some((entry) => entry.value === subcategoryValue)
    ? subcategoryValue
    : toTrimmedString(source?.subcategory || "");

  const secondaryCategories = uniqueStrings(source?.taxonomy?.secondaryCategories)
    .filter((entry) => entry !== primaryCategory)
    .slice(0, 5);

  return {
    category: primaryCategory,
    subcategory,
    tags: uniqueStrings(source?.tags),
    labels: uniqueStrings(source?.labels),
    taxonomy: {
      primaryCategory,
      secondaryCategories,
      relationship: normalizeOption(source?.taxonomy?.relationship, CATEGORY_RELATIONSHIP_OPTIONS, "direct"),
      inheritance: normalizeOption(source?.taxonomy?.inheritance, CATEGORY_INHERITANCE_OPTIONS, "category-keywords"),
      customCategoryDraft: toTrimmedString(source?.taxonomy?.customCategoryDraft),
      customSubcategoryDraft: toTrimmedString(source?.taxonomy?.customSubcategoryDraft)
    },
    organization: {
      collectionGroup: normalizeOption(source?.organization?.collectionGroup, COLLECTION_GROUP_OPTIONS, "core-catalog"),
      seasonalGroup: normalizeOption(source?.organization?.seasonalGroup, SEASONAL_GROUP_OPTIONS, "always-on"),
      campaignGroup: normalizeOption(source?.organization?.campaignGroup, CAMPAIGN_GROUP_OPTIONS, "none"),
      homepageGroup: normalizeOption(source?.organization?.homepageGroup, HOMEPAGE_GROUP_OPTIONS, "standard"),
      recommendationGroup: normalizeOption(source?.organization?.recommendationGroup, RECOMMENDATION_GROUP_OPTIONS, "balanced"),
      searchBoost: normalizeOption(source?.organization?.searchBoost, SEARCH_BOOST_OPTIONS, "normal"),
      filterPriority: normalizeOption(source?.organization?.filterPriority, FILTER_PRIORITY_OPTIONS, "standard")
    }
  };
}

export function buildClassificationFoundation(source = {}) {
  const classification = normalizeClassificationState(source);
  const categoryNode = findCategoryNode(classification.taxonomy.primaryCategory);
  const subcategoryOptions = getSubcategoryOptions(classification.taxonomy.primaryCategory);
  const subcategorySlug = toSlug(classification.subcategory);
  const matchedSubcategory = subcategoryOptions.find((entry) => entry.value === subcategorySlug);
  const resolvedSubcategory = matchedSubcategory ? matchedSubcategory.value : toTrimmedString(classification.subcategory);
  const inheritedCategoryKeywords = categoryNode && classification.taxonomy.inheritance === "category-keywords"
    ? uniqueStrings(categoryNode.keywords || [])
    : [];
  const inheritedCategoryLabels = categoryNode && classification.taxonomy.inheritance === "category-labels"
    ? uniqueStrings([categoryNode.label])
    : [];

  const allCategories = uniqueStrings([
    classification.taxonomy.primaryCategory,
    ...classification.taxonomy.secondaryCategories
  ]);

  const filterTokens = uniqueStrings([
    classification.taxonomy.primaryCategory,
    resolvedSubcategory,
    ...classification.taxonomy.secondaryCategories,
    ...classification.tags,
    ...inheritedCategoryKeywords
  ]);

  return {
    ...classification,
    subcategory: resolvedSubcategory,
    availableSubcategories: subcategoryOptions,
    categoryTree: {
      primary: classification.taxonomy.primaryCategory,
      secondary: classification.taxonomy.secondaryCategories,
      all: allCategories,
      relationship: classification.taxonomy.relationship,
      inheritance: classification.taxonomy.inheritance
    },
    grouping: {
      collectionGroup: classification.organization.collectionGroup,
      seasonalGroup: classification.organization.seasonalGroup,
      campaignGroup: classification.organization.campaignGroup,
      homepageGroup: classification.organization.homepageGroup,
      recommendationGroup: classification.organization.recommendationGroup
    },
    rendering: {
      homeCategory: classification.taxonomy.primaryCategory,
      shopCategory: classification.taxonomy.primaryCategory,
      categoryNavigation: allCategories,
      categoryPagePath: resolvedSubcategory
        ? `${classification.taxonomy.primaryCategory}/${toSlug(resolvedSubcategory)}`
        : classification.taxonomy.primaryCategory,
      categoryFilterTokens: filterTokens
    },
    search: {
      searchBoost: classification.organization.searchBoost,
      filterPriority: classification.organization.filterPriority,
      inheritedKeywords: inheritedCategoryKeywords,
      inheritedLabels: inheritedCategoryLabels,
      filterTokens
    },
    optionLabels: {
      primaryCategory: getOptionLabel(CATEGORY_OPTIONS, classification.taxonomy.primaryCategory, "General"),
      relationship: getOptionLabel(CATEGORY_RELATIONSHIP_OPTIONS, classification.taxonomy.relationship, "Direct assignment"),
      inheritance: getOptionLabel(CATEGORY_INHERITANCE_OPTIONS, classification.taxonomy.inheritance, "No inheritance"),
      collectionGroup: getOptionLabel(COLLECTION_GROUP_OPTIONS, classification.organization.collectionGroup, "Core Catalog"),
      seasonalGroup: getOptionLabel(SEASONAL_GROUP_OPTIONS, classification.organization.seasonalGroup, "Always-on"),
      campaignGroup: getOptionLabel(CAMPAIGN_GROUP_OPTIONS, classification.organization.campaignGroup, "No campaign"),
      homepageGroup: getOptionLabel(HOMEPAGE_GROUP_OPTIONS, classification.organization.homepageGroup, "Standard Home Group"),
      recommendationGroup: getOptionLabel(RECOMMENDATION_GROUP_OPTIONS, classification.organization.recommendationGroup, "Balanced"),
      searchBoost: getOptionLabel(SEARCH_BOOST_OPTIONS, classification.organization.searchBoost, "Normal"),
      filterPriority: getOptionLabel(FILTER_PRIORITY_OPTIONS, classification.organization.filterPriority, "Standard")
    },
    future: {
      category: classification.taxonomy.primaryCategory,
      subcategory: resolvedSubcategory,
      taxonomy: {
        primaryCategory: classification.taxonomy.primaryCategory,
        secondaryCategories: classification.taxonomy.secondaryCategories,
        relationship: classification.taxonomy.relationship,
        inheritance: classification.taxonomy.inheritance
      },
      grouping: {
        collectionGroup: classification.organization.collectionGroup,
        seasonalGroup: classification.organization.seasonalGroup,
        campaignGroup: classification.organization.campaignGroup,
        homepageGroup: classification.organization.homepageGroup,
        recommendationGroup: classification.organization.recommendationGroup
      },
      rendering: {
        categoryNavigation: allCategories,
        categoryPagePath: resolvedSubcategory
          ? `${classification.taxonomy.primaryCategory}/${toSlug(resolvedSubcategory)}`
          : classification.taxonomy.primaryCategory,
        categoryFilterTokens: filterTokens,
        searchBoost: classification.organization.searchBoost,
        filterPriority: classification.organization.filterPriority
      }
    }
  };
}
