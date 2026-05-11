export const SORTING_STRATEGY_OPTIONS = [
  { value: "automatic", label: "Automatic", description: "Use merchandising weights to derive stable storefront ordering foundations automatically." },
  { value: "manual", label: "Manual ranking", description: "Prepare explicit sequencing numbers for homepage, shop, featured, category, and recommendation placements." },
  { value: "featured-first", label: "Featured-first", description: "Bias the ordering foundation toward featured and spotlight merchandising experiences." },
  { value: "newest-foundation", label: "Newest foundation", description: "Reserve this product for future recency-first ranking strategies without changing live storefront logic yet." },
  { value: "sales-foundation", label: "Sales foundation", description: "Prepare this product for future sales-led ranking and campaign sequencing." },
  { value: "popularity-foundation", label: "Popularity foundation", description: "Prepare this product for future popularity and engagement-based ranking models." }
];

export const HOMEPAGE_PLACEMENT_OPTIONS = [
  { value: "hero", label: "Hero feature", description: "Highest homepage prominence for lead merchandising and hero-adjacent placement." },
  { value: "featured-row", label: "Featured row", description: "Priority placement inside the main featured product rows on the homepage." },
  { value: "standard-grid", label: "Standard grid", description: "Balanced homepage grid placement for general catalog visibility." },
  { value: "trailing-grid", label: "Trailing grid", description: "Lower homepage sequencing for long-tail browsing and secondary merchandising." }
];

export const SHOP_PLACEMENT_OPTIONS = [
  { value: "featured-first", label: "Featured-first", description: "Bias this product toward the first shop rows and premium browsing sequences." },
  { value: "top-grid", label: "Top grid", description: "Place this product near the top of the main shop product grid." },
  { value: "standard-grid", label: "Standard grid", description: "Use balanced shop positioning for default catalog flow." },
  { value: "trailing-grid", label: "Trailing grid", description: "Reserve this product for later grid positions and discovery browsing." }
];

export const FEATURED_PLACEMENT_OPTIONS = [
  { value: "hero-feature", label: "Hero featured", description: "Highest featured merchandising rank for future spotlight and hero-product treatments." },
  { value: "spotlight", label: "Spotlight", description: "Premium featured-row placement with strong visual prominence." },
  { value: "supporting", label: "Supporting", description: "Secondary featured support placement for richer merchandising rows." },
  { value: "none", label: "Not featured", description: "Keep this product out of featured sequencing foundations for now." }
];

export const CAMPAIGN_SLOT_OPTIONS = [
  { value: "none", label: "No campaign", description: "Use standard merchandising without campaign-reserved placement." },
  { value: "seasonal", label: "Seasonal", description: "Reserve this product for future seasonal campaigns and timed merchandising collections." },
  { value: "launch", label: "Launch", description: "Prepare this product for release-focused campaign sequencing and launch support." },
  { value: "editorial", label: "Editorial", description: "Prepare this product for curated edits, banners, and storytelling-led placements." },
  { value: "clearance", label: "Clearance", description: "Reserve this product for future promotion and clearance-driven merchandising." }
];

export const RECOMMENDATION_FLOW_OPTIONS = [
  { value: "balanced", label: "Balanced", description: "Use a neutral recommendation posture for future discovery and related-product systems." },
  { value: "priority-first", label: "Priority-first", description: "Bias this product toward premium ranking and high-visibility recommendation slots." },
  { value: "featured-first", label: "Featured-first", description: "Pair recommendation sequencing with featured product treatment and highlight surfaces." },
  { value: "discovery-tail", label: "Discovery tail", description: "Prepare this product for later-sequence discovery and long-tail recommendation flows." }
];

const POSITION_BASE_WEIGHTS = {
  top: 700,
  middle: 420,
  bottom: 140
};

const HOMEPAGE_PLACEMENT_WEIGHTS = {
  hero: 320,
  "featured-row": 240,
  "standard-grid": 140,
  "trailing-grid": 40
};

const SHOP_PLACEMENT_WEIGHTS = {
  "featured-first": 260,
  "top-grid": 180,
  "standard-grid": 120,
  "trailing-grid": 40
};

const FEATURED_PLACEMENT_WEIGHTS = {
  "hero-feature": 320,
  spotlight: 220,
  supporting: 120,
  none: 0
};

const CAMPAIGN_SLOT_WEIGHTS = {
  none: 0,
  seasonal: 50,
  launch: 80,
  editorial: 60,
  clearance: 40
};

const RECOMMENDATION_FLOW_WEIGHTS = {
  balanced: 40,
  "priority-first": 110,
  "featured-first": 140,
  "discovery-tail": 20
};

const SORTING_STRATEGY_WEIGHTS = {
  automatic: 0,
  manual: 90,
  "featured-first": 140,
  "newest-foundation": 60,
  "sales-foundation": 90,
  "popularity-foundation": 70
};

function toTrimmedString(value, fallbackValue = "") {
  const result = String(value || "").trim();
  return result || String(fallbackValue || "").trim();
}

function normalizeOption(value, options, fallbackValue) {
  const normalized = toTrimmedString(value, fallbackValue).toLowerCase();
  return options.some((option) => option.value === normalized) ? normalized : fallbackValue;
}

function toNonNegativeInteger(value, fallbackValue = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallbackValue;
}

function getOptionLabel(options, value, fallbackValue) {
  const option = options.find((entry) => entry.value === value);
  return option ? option.label : fallbackValue;
}

function getWeight(map, key, fallbackValue = 0) {
  return Number(map[key] || fallbackValue || 0);
}

function buildManualOrderBoost(sequence, maxBoost = 1000) {
  if (!sequence) {
    return 0;
  }

  return Math.max(maxBoost - sequence, 1);
}

function getDerivedPriority(positioning, merchandising) {
  if (merchandising?.position === "top") {
    return "top";
  }

  if (positioning.homePlacement === "hero" || positioning.featuredPlacement === "hero-feature") {
    return "top";
  }

  return "normal";
}

export function createDefaultPositioningState() {
  return {
    sortStrategy: "automatic",
    homePlacement: "featured-row",
    homeOrder: 0,
    shopPlacement: "standard-grid",
    shopOrder: 0,
    featuredPlacement: "none",
    featuredOrder: 0,
    categoryOrder: 0,
    recommendationOrder: 0,
    campaignSlot: "none",
    recommendationFlow: "balanced"
  };
}

export function normalizePositioningState(source = {}) {
  return {
    sortStrategy: normalizeOption(source?.sortStrategy, SORTING_STRATEGY_OPTIONS, "automatic"),
    homePlacement: normalizeOption(source?.homePlacement, HOMEPAGE_PLACEMENT_OPTIONS, "featured-row"),
    homeOrder: toNonNegativeInteger(source?.homeOrder, 0),
    shopPlacement: normalizeOption(source?.shopPlacement, SHOP_PLACEMENT_OPTIONS, "standard-grid"),
    shopOrder: toNonNegativeInteger(source?.shopOrder, 0),
    featuredPlacement: normalizeOption(source?.featuredPlacement, FEATURED_PLACEMENT_OPTIONS, "none"),
    featuredOrder: toNonNegativeInteger(source?.featuredOrder, 0),
    categoryOrder: toNonNegativeInteger(source?.categoryOrder, 0),
    recommendationOrder: toNonNegativeInteger(source?.recommendationOrder, 0),
    campaignSlot: normalizeOption(source?.campaignSlot, CAMPAIGN_SLOT_OPTIONS, "none"),
    recommendationFlow: normalizeOption(source?.recommendationFlow, RECOMMENDATION_FLOW_OPTIONS, "balanced")
  };
}

export function buildPositioningFoundation(source = {}, merchandising = {}) {
  const positioning = normalizePositioningState(source);
  const position = toTrimmedString(merchandising?.position || "middle", "middle").toLowerCase();
  const baseWeight = getWeight(POSITION_BASE_WEIGHTS, position, POSITION_BASE_WEIGHTS.middle);
  const strategyWeight = getWeight(SORTING_STRATEGY_WEIGHTS, positioning.sortStrategy);
  const campaignWeight = getWeight(CAMPAIGN_SLOT_WEIGHTS, positioning.campaignSlot);
  const recommendationWeight = getWeight(RECOMMENDATION_FLOW_WEIGHTS, positioning.recommendationFlow);
  const homeWeight = baseWeight + strategyWeight + campaignWeight + getWeight(HOMEPAGE_PLACEMENT_WEIGHTS, positioning.homePlacement) + buildManualOrderBoost(positioning.homeOrder, 1200);
  const shopWeight = baseWeight + strategyWeight + campaignWeight + getWeight(SHOP_PLACEMENT_WEIGHTS, positioning.shopPlacement) + buildManualOrderBoost(positioning.shopOrder, 1100);
  const featuredWeight = baseWeight + strategyWeight + campaignWeight + getWeight(FEATURED_PLACEMENT_WEIGHTS, positioning.featuredPlacement) + buildManualOrderBoost(positioning.featuredOrder, 1300);
  const categoryWeight = baseWeight + strategyWeight + buildManualOrderBoost(positioning.categoryOrder, 900);
  const recommendationScore = baseWeight + strategyWeight + recommendationWeight + buildManualOrderBoost(positioning.recommendationOrder, 900);
  const merchandisingScore = Math.max(homeWeight, shopWeight, featuredWeight, categoryWeight, recommendationScore);
  const derivedOrderIndex = Math.max(0, Math.round(merchandisingScore));

  return {
    ...positioning,
    labels: {
      sortStrategy: getOptionLabel(SORTING_STRATEGY_OPTIONS, positioning.sortStrategy, "Automatic"),
      homePlacement: getOptionLabel(HOMEPAGE_PLACEMENT_OPTIONS, positioning.homePlacement, "Featured row"),
      shopPlacement: getOptionLabel(SHOP_PLACEMENT_OPTIONS, positioning.shopPlacement, "Standard grid"),
      featuredPlacement: getOptionLabel(FEATURED_PLACEMENT_OPTIONS, positioning.featuredPlacement, "Not featured"),
      campaignSlot: getOptionLabel(CAMPAIGN_SLOT_OPTIONS, positioning.campaignSlot, "No campaign"),
      recommendationFlow: getOptionLabel(RECOMMENDATION_FLOW_OPTIONS, positioning.recommendationFlow, "Balanced")
    },
    ranking: {
      baseWeight,
      strategyWeight,
      campaignWeight,
      homeWeight,
      shopWeight,
      featuredWeight,
      categoryWeight,
      recommendationWeight: recommendationScore,
      merchandisingScore
    },
    sequencing: {
      homepage: {
        placement: positioning.homePlacement,
        order: positioning.homeOrder,
        weight: homeWeight
      },
      shop: {
        placement: positioning.shopPlacement,
        order: positioning.shopOrder,
        weight: shopWeight
      },
      featured: {
        placement: positioning.featuredPlacement,
        order: positioning.featuredOrder,
        weight: featuredWeight
      },
      category: {
        order: positioning.categoryOrder,
        weight: categoryWeight
      },
      recommendation: {
        flow: positioning.recommendationFlow,
        order: positioning.recommendationOrder,
        weight: recommendationScore
      }
    },
    future: {
      priority: getDerivedPriority(positioning, merchandising),
      orderIndex: derivedOrderIndex,
      score: merchandisingScore,
      sequencePayload: {
        sortStrategy: positioning.sortStrategy,
        campaignSlot: positioning.campaignSlot,
        homepage: {
          placement: positioning.homePlacement,
          order: positioning.homeOrder,
          weight: homeWeight
        },
        shop: {
          placement: positioning.shopPlacement,
          order: positioning.shopOrder,
          weight: shopWeight
        },
        featured: {
          placement: positioning.featuredPlacement,
          order: positioning.featuredOrder,
          weight: featuredWeight
        },
        category: {
          order: positioning.categoryOrder,
          weight: categoryWeight
        },
        recommendation: {
          flow: positioning.recommendationFlow,
          order: positioning.recommendationOrder,
          weight: recommendationScore
        }
      }
    }
  };
}