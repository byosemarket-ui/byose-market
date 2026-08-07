/**
 * Shared storefront product visibility, placement, and display ordering.
 */

import { isProductPublished } from "./product-visibility.js";

export { detectStorefrontVisibilityIssues, isProductPublished, resolvePublishStatus } from "./product-visibility.js";

export const PLACEMENT_SECTIONS = Object.freeze({
  featured_products: "featured_products",
  best_sellers: "best_sellers",
  fresh_picks: "fresh_picks",
  new_arrivals: "new_arrivals",
  recommended_products: "recommended_products",
  flash_deals: "flash_deals"
});

const PLACEMENT_ALIASES = Object.freeze({
  featured: "featured_products",
  featuredproduct: "featured_products",
  featuredproducts: "featured_products",
  bestsellers: "best_sellers",
  best_seller: "best_sellers",
  freshpicks: "fresh_picks",
  fresh_picks: "fresh_picks",
  newarrivals: "new_arrivals",
  new_arrival: "new_arrivals",
  recommended: "recommended_products",
  recommendedproducts: "recommended_products",
  flashdeals: "flash_deals",
  flash_deal: "flash_deals",
  flash: "flash_deals"
});

const VALID_POSITION_MODES = new Set(["automatic", "top", "middle", "bottom"]);

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizePlacementKey(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "all" || raw === "homepage" || raw === "home" || raw === "shop" || raw === "shop_page") {
    return "";
  }

  const compact = raw.replace(/[\s-]+/g, "_");
  if (Object.values(PLACEMENT_SECTIONS).includes(compact)) {
    return compact;
  }

  const alias = PLACEMENT_ALIASES[compact.replace(/_/g, "")] || PLACEMENT_ALIASES[compact];
  return alias || "";
}

export function normalizePlacementList(value) {
  const source = asArray(value);
  const normalized = source.map(normalizePlacementKey).filter(Boolean);
  return [...new Set(normalized)];
}

export function getProductPlacements(product) {
  const metadata = asObject(product?.metadata);
  const fromMetadata = normalizePlacementList(
    (Array.isArray(metadata.placement) && metadata.placement.length)
      ? metadata.placement
      : metadata.placements
  );
  if (fromMetadata.length) {
    return fromMetadata;
  }

  // Also honor top-level placement arrays from normalized card payloads.
  const fromProduct = normalizePlacementList(product?.placement);
  if (fromProduct.length) {
    return fromProduct;
  }

  const placements = new Set();

  if (metadata.featuredProduct || metadata.featuredProducts || metadata.featuredHomepage) {
    placements.add(PLACEMENT_SECTIONS.featured_products);
  }
  if (metadata.featuredBestSellers) {
    placements.add(PLACEMENT_SECTIONS.best_sellers);
  }
  if (metadata.featuredFreshPicks) {
    placements.add(PLACEMENT_SECTIONS.fresh_picks);
  }

  return [...placements];
}

export function productHasPlacement(product, section) {
  const target = normalizePlacementKey(section);
  if (!target) {
    return false;
  }
  return getProductPlacements(product).includes(target);
}

export function normalizeVisibility(value) {
  const normalized = normalizeText(value).replace(/\s+/g, "-");
  if (normalized === "home" || normalized === "shop" || normalized === "both") {
    return normalized;
  }
  if (normalized === "home-only" || normalized === "homepage-only") {
    return "home";
  }
  if (normalized === "shop-only") {
    return "shop";
  }
  if (normalized === "all") {
    return "both";
  }
  return "both";
}

export function shouldShowOnSurface(product, surface) {
  if (!isProductPublished(product)) {
    return false;
  }
  const visibility = normalizeVisibility(product?.visibility);
  return visibility === "both" || visibility === surface;
}

export function normalizeDisplayPriority(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, Math.floor(value)));
  }

  const normalizedText = normalizeText(value);
  if (!normalizedText || normalizedText === "normal" || normalizedText === "automatic") {
    return 50;
  }
  if (normalizedText === "top" || normalizedText === "featured") {
    return 90;
  }
  if (normalizedText === "middle") {
    return 50;
  }
  if (normalizedText === "bottom" || normalizedText === "low") {
    return 10;
  }

  const parsed = Number(String(value || "").trim());
  if (Number.isFinite(parsed)) {
    return Math.max(0, Math.min(100, Math.floor(parsed)));
  }

  return 50;
}

export function normalizePositionMode(value) {
  const normalized = String(value || "automatic").trim().toLowerCase();
  return VALID_POSITION_MODES.has(normalized) ? normalized : "automatic";
}

export function resolveOrderIndex(positionMode, priorityScore) {
  const score = normalizeDisplayPriority(priorityScore);
  const mode = normalizePositionMode(positionMode);

  if (mode === "top") {
    return 3000 + score;
  }
  if (mode === "middle") {
    return 2000 + score;
  }
  if (mode === "bottom") {
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

export function resolveHighlightTagFromPlacements(placements = []) {
  const normalized = normalizePlacementList(placements);
  if (normalized.includes(PLACEMENT_SECTIONS.flash_deals)) {
    return "trending";
  }
  if (normalized.includes(PLACEMENT_SECTIONS.new_arrivals)) {
    return "new";
  }
  if (normalized.includes(PLACEMENT_SECTIONS.featured_products)) {
    return "featured";
  }
  return "";
}

export function sortProductsByDisplay(left, right) {
  const leftOrder = Math.max(0, Number(left?.orderIndex ?? left?.order_index) || 0);
  const rightOrder = Math.max(0, Number(right?.orderIndex ?? right?.order_index) || 0);
  if (leftOrder !== rightOrder) {
    return rightOrder - leftOrder;
  }

  const leftPriority = normalizeDisplayPriority(left?.priority ?? left?.metadata?.priorityScore);
  const rightPriority = normalizeDisplayPriority(right?.priority ?? right?.metadata?.priorityScore);
  if (leftPriority !== rightPriority) {
    return rightPriority - leftPriority;
  }

  const leftUpdated = String(left?.updatedAt || left?.updated_at || "");
  const rightUpdated = String(right?.updatedAt || right?.updated_at || "");
  if (leftUpdated !== rightUpdated) {
    return rightUpdated.localeCompare(leftUpdated);
  }

  const leftIndex = Math.max(0, Number(left?.defaultIndex) || 0);
  const rightIndex = Math.max(0, Number(right?.defaultIndex) || 0);
  return leftIndex - rightIndex;
}

export function filterProductsForSection(products, section, surface = "home") {
  const target = normalizePlacementKey(section);
  return asArray(products)
    .filter((product) => shouldShowOnSurface(product, surface))
    .filter((product) => !target || productHasPlacement(product, target))
    .sort(sortProductsByDisplay);
}
