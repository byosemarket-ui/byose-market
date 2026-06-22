/**
 * Storefront product publish/visibility rules (mirrors server/utils/product-visibility.js).
 */

const PUBLIC_PUBLISH_STATUSES = new Set(["active", "published", "live"]);
const BLOCKED_PUBLISH_STATUSES = new Set(["draft", "inactive", "archived", "disabled"]);

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function readMetadata(product) {
  if (!product || typeof product !== "object") {
    return {};
  }
  return product.metadata && typeof product.metadata === "object" ? product.metadata : {};
}

export function resolvePublishStatus(product) {
  const metadata = readMetadata(product);
  const fromMetadata = normalizeText(metadata.publishStatus);
  if (fromMetadata) {
    return fromMetadata;
  }
  return normalizeText(product?.status || "active") || "active";
}

function wasHiddenByStockStatusBug(product) {
  const status = normalizeText(product?.status);
  const publishStatus = resolvePublishStatus(product);
  return status === "inactive" && publishStatus === "active";
}

export function isProductPublished(product) {
  const status = normalizeText(product?.status || "active");
  const publishStatus = resolvePublishStatus(product);

  if (BLOCKED_PUBLISH_STATUSES.has(publishStatus)) {
    return false;
  }

  if (publishStatus === "draft" || status === "draft") {
    return false;
  }

  if (status === "inactive") {
    return wasHiddenByStockStatusBug(product);
  }

  return PUBLIC_PUBLISH_STATUSES.has(status) || publishStatus === "active";
}

export function detectStorefrontVisibilityIssues(products = []) {
  const issues = [];
  const list = Array.isArray(products) ? products : [];

  list.forEach((product) => {
    const publishStatus = resolvePublishStatus(product);
    const status = normalizeText(product?.status || "active");
    const name = String(product?.name || product?.title || product?.catalogId || "unknown").trim();
    const catalogId = product?.catalogId || product?.id || "";

    if (publishStatus === "active" && !isProductPublished(product)) {
      issues.push({
        type: "published_hidden",
        catalogId,
        name,
        status,
        publishStatus,
        visibility: product?.visibility || "both",
        stock: Number(product?.stock) || 0,
        message: `Published product "${name}" (${catalogId}) is hidden from storefront (status=${status}).`
      });
    }

    if (publishStatus === "active" && wasHiddenByStockStatusBug(product)) {
      issues.push({
        type: "stock_status_mismatch",
        catalogId,
        name,
        status,
        publishStatus,
        stock: Number(product?.stock) || 0,
        message: `Product "${name}" (${catalogId}) was marked inactive due to zero stock but publishStatus is active.`
      });
    }
  });

  return issues;
}
