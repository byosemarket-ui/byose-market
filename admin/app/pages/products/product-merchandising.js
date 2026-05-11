import {
  CAMPAIGN_SLOT_OPTIONS,
  buildPositioningFoundation,
  createDefaultPositioningState,
  FEATURED_PLACEMENT_OPTIONS,
  HOMEPAGE_PLACEMENT_OPTIONS,
  normalizePositioningState,
  RECOMMENDATION_FLOW_OPTIONS,
  SHOP_PLACEMENT_OPTIONS,
  SORTING_STRATEGY_OPTIONS
} from "./product-positioning.js";

export {
  CAMPAIGN_SLOT_OPTIONS,
  FEATURED_PLACEMENT_OPTIONS,
  HOMEPAGE_PLACEMENT_OPTIONS,
  RECOMMENDATION_FLOW_OPTIONS,
  SHOP_PLACEMENT_OPTIONS,
  SORTING_STRATEGY_OPTIONS
};

export const PUBLISHING_STATE_OPTIONS = [
  { value: "draft", label: "Draft", description: "Keep the product private while content and media are still being prepared." },
  { value: "published", label: "Published", description: "Allow the product to render on approved storefront surfaces." },
  { value: "hidden", label: "Hidden", description: "Remove the product from storefront surfaces while preserving the admin record." },
  { value: "scheduled", label: "Scheduled", description: "Prepare a future publishing window without activating automated release yet." },
  { value: "featured", label: "Featured", description: "Publish the product with premium merchandising treatment and elevated placement." }
];

export const FEATURED_TAG_OPTIONS = [
  { value: "none", label: "Standard", description: "Use regular catalog presentation without promoted highlight treatment." },
  { value: "featured", label: "Featured", description: "Best for homepage highlights and premium featured sections." },
  { value: "trending", label: "Highlighted", description: "Best for trending and momentum-driven merchandising blocks." },
  { value: "new", label: "Promoted", description: "Best for launches, campaigns, and promotion-driven placement." }
];

export const ORDERING_MODE_OPTIONS = [
  { value: "automatic", label: "Automatic", description: "Use the visibility and position engine to assign rendering weight automatically." },
  { value: "manual", label: "Manual foundation", description: "Reserve this product for future explicit ordering controls and drag sorting." }
];

function toTrimmedString(value, fallbackValue = "") {
  const result = String(value || "").trim();
  return result || String(fallbackValue || "").trim();
}

function normalizeOption(value, options, fallbackValue) {
  const normalized = toTrimmedString(value, fallbackValue).toLowerCase();
  return options.some((option) => option.value === normalized) ? normalized : fallbackValue;
}

function toBoolean(value, fallbackValue = false) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = toTrimmedString(value).toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  return fallbackValue;
}

function toNonNegativeNumber(value, fallbackValue = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallbackValue;
}

function normalizeVisibility(value) {
  const normalized = toTrimmedString(value, "both").toLowerCase();
  if (normalized === "home" || normalized === "shop" || normalized === "both") {
    return normalized;
  }

  return "both";
}

function normalizeSurfacesFromVisibility(value) {
  const visibility = normalizeVisibility(value);
  return {
    home: visibility === "home" || visibility === "both",
    shop: visibility === "shop" || visibility === "both"
  };
}

function deriveVisibilityFromSurfaces(surfaces) {
  const home = Boolean(surfaces?.home);
  const shop = Boolean(surfaces?.shop);

  if (home && shop) {
    return "both";
  }
  if (home) {
    return "home";
  }
  if (shop) {
    return "shop";
  }

  return "hidden";
}

function mapPositionToOrderIndex(position, orderingMode) {
  if (orderingMode === "manual") {
    if (position === "top") {
      return 500;
    }
    if (position === "middle") {
      return 300;
    }
    return 150;
  }

  if (position === "top") {
    return 300;
  }
  if (position === "middle") {
    return 200;
  }
  return 100;
}

function getOptionLabel(options, value, fallbackValue) {
  const option = options.find((entry) => entry.value === value);
  return option ? option.label : fallbackValue;
}

function normalizeScheduleAt(value) {
  return toTrimmedString(value);
}

export function createDefaultMerchandisingState() {
  return {
    status: "draft",
    visibility: "both",
    position: "middle",
    surfaces: {
      home: true,
      shop: true
    },
    featuredTag: "none",
    orderingMode: "automatic",
    scheduleAt: "",
    positioning: createDefaultPositioningState()
  };
}

export function normalizeMerchandisingState(source = {}) {
  const fallbackSurfaces = normalizeSurfacesFromVisibility(source?.visibility);
  const surfaces = {
    home: toBoolean(source?.surfaces?.home, fallbackSurfaces.home),
    shop: toBoolean(source?.surfaces?.shop, fallbackSurfaces.shop)
  };
  const visibility = deriveVisibilityFromSurfaces(surfaces);

  return {
    status: normalizeOption(source?.status, PUBLISHING_STATE_OPTIONS, "draft"),
    visibility,
    position: normalizeOption(source?.position, [
      { value: "top" },
      { value: "middle" },
      { value: "bottom" }
    ], "middle"),
    surfaces,
    featuredTag: normalizeOption(source?.featuredTag, FEATURED_TAG_OPTIONS, "none"),
    orderingMode: normalizeOption(source?.orderingMode, ORDERING_MODE_OPTIONS, "automatic"),
    scheduleAt: normalizeScheduleAt(source?.scheduleAt),
    positioning: normalizePositioningState(source?.positioning)
  };
}

export function setVisibilityPreset(merchandising, preset) {
  const next = normalizeMerchandisingState(merchandising);

  if (preset === "home") {
    next.surfaces = { home: true, shop: false };
  } else if (preset === "shop") {
    next.surfaces = { home: false, shop: true };
  } else if (preset === "both") {
    next.surfaces = { home: true, shop: true };
  } else if (preset === "hidden") {
    next.surfaces = { home: false, shop: false };
  }

  next.visibility = deriveVisibilityFromSurfaces(next.surfaces);
  return next;
}

export function setSurfaceVisibility(merchandising, surface, enabled) {
  const next = normalizeMerchandisingState(merchandising);
  next.surfaces = {
    ...next.surfaces,
    [surface]: Boolean(enabled)
  };
  next.visibility = deriveVisibilityFromSurfaces(next.surfaces);
  return next;
}

export function buildMerchandisingFoundation(source = {}) {
  const merchandising = normalizeMerchandisingState(source);
  const positioning = buildPositioningFoundation(merchandising.positioning, merchandising);
  const visibility = deriveVisibilityFromSurfaces(merchandising.surfaces);
  const hiddenFromAll = !merchandising.surfaces.home && !merchandising.surfaces.shop;
  const isHidden = merchandising.status === "hidden" || hiddenFromAll;
  const isScheduled = merchandising.status === "scheduled";
  const isFeaturedState = merchandising.status === "featured";
  const showInHome = merchandising.surfaces.home && !isHidden;
  const showInShop = merchandising.surfaces.shop && !isHidden;
  const showEverywhere = showInHome && showInShop;
  const effectiveHighlightTag = merchandising.featuredTag !== "none"
    ? merchandising.featuredTag
    : isFeaturedState
      ? "featured"
      : "";
  const effectivePriority = positioning.future.priority || (merchandising.position === "top" ? "top" : "normal");
  const orderIndex = positioning.future.orderIndex || mapPositionToOrderIndex(merchandising.position, merchandising.orderingMode);
  const effectiveStatus = isFeaturedState || merchandising.status === "published"
    ? "active"
    : merchandising.status;
  const featuredPlacement = effectiveHighlightTag === "featured" || isFeaturedState;

  return {
    ...merchandising,
    visibility,
    labels: {
      status: getOptionLabel(PUBLISHING_STATE_OPTIONS, merchandising.status, "Draft"),
      visibility: visibility === "both"
        ? "Show Everywhere"
        : visibility === "home"
          ? "Show in Home"
          : visibility === "shop"
            ? "Show in Shop"
            : "Hidden from storefront",
      position: merchandising.position === "top"
        ? "Top"
        : merchandising.position === "middle"
          ? "Middle"
          : "Bottom",
      featuredTag: getOptionLabel(FEATURED_TAG_OPTIONS, merchandising.featuredTag, "Standard"),
      orderingMode: getOptionLabel(ORDERING_MODE_OPTIONS, merchandising.orderingMode, "Automatic")
    },
    positioning,
    rendering: {
      showInHome,
      showInShop,
      showEverywhere,
      hiddenFromAll,
      featuredPlacement,
      schedulePending: isScheduled,
      priorityBucket: merchandising.position,
      merchandisingWeight: orderIndex,
      merchandisingScore: positioning.future.score,
      surfaces: {
        home: merchandising.surfaces.home,
        shop: merchandising.surfaces.shop
      }
    },
    workflow: {
      isPublished: merchandising.status === "published" || isFeaturedState,
      isDraft: merchandising.status === "draft",
      isHidden,
      isScheduled,
      scheduleAt: merchandising.scheduleAt,
      featuredPlacement
    },
    future: {
      visibility: visibility === "hidden" ? "both" : visibility,
      priority: effectivePriority,
      orderIndex: toNonNegativeNumber(orderIndex, 0),
      highlightTag: effectiveHighlightTag,
      status: effectiveStatus,
      positioning: positioning.future.sequencePayload
    }
  };
}