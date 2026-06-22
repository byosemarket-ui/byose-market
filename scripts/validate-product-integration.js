/**
 * Add Product → Website integration audit.
 * Run: node scripts/validate-product-integration.js
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildProductPayload } from "../admin/app/pages/products/payload.js";
import { createDefaultDraft } from "../admin/app/pages/products/draft.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const INTEGRATION_MAP = [
  { field: "info.name", payload: "name", db: "name", surfaces: ["cards", "pdp", "cart", "search"] },
  { field: "info.shortName", payload: "title + metadata.shortName", db: "metadata_json", surfaces: ["cards"] },
  { field: "info.category", payload: "category", db: "category_slug", surfaces: ["shop-filters", "pdp", "search"] },
  { field: "info.brand", payload: "brand + badge", db: "badge + metadata", surfaces: ["pdp-badge", "search-index"] },
  { field: "info.visibility", payload: "visibility", db: "visibility", surfaces: ["home-filter", "shop-filter"] },
  { field: "info.placement", payload: "metadata.placement + highlightTag", db: "metadata + highlight_tag", surfaces: ["home-sections"] },
  { field: "info.positionMode", payload: "metadata.positionMode + orderIndex", db: "order_index", surfaces: ["sort-order"] },
  { field: "info.priorityScore", payload: "priority + orderIndex", db: "priority + order_index", surfaces: ["sort-order"] },
  { field: "info.publishStatus", payload: "status", db: "status", surfaces: ["visibility-gate"] },
  { field: "pricing.sellingPrice", payload: "price", db: "price", surfaces: ["cards", "pdp", "cart"] },
  { field: "pricing.originalPrice", payload: "oldPrice", db: "old_price", surfaces: ["cards", "pdp", "discount-badge"] },
  { field: "pricing.costPrice", payload: "costPrice", db: "metadata", surfaces: ["admin-only"] },
  { field: "inventory.sku", payload: "sku", db: "metadata", surfaces: ["cart-metadata"] },
  { field: "inventory.colorVariants", payload: "variants + metadata.colorVariants", db: "variants_json", surfaces: ["pdp-modal", "cart-stock"] },
  { field: "description.shortDescription", payload: "shortDescription", db: "short_description", surfaces: ["pdp", "seo-fallback"] },
  { field: "description.longDescription", payload: "description + longDescription[]", db: "description + long_description_json", surfaces: ["pdp-accordion"] },
  { field: "media.mainImage", payload: "mainImage", db: "main_image + product_images", surfaces: ["cards", "pdp-gallery"] },
  { field: "media.gallery", payload: "gallery", db: "product_images", surfaces: ["pdp-gallery"] },
  { field: "seo.metaTitle", payload: "metaTitle", db: "title + metadata", surfaces: ["pdp-title-tag"] },
  { field: "seo.metaDescription", payload: "metaDescription", db: "metadata", surfaces: ["pdp-meta-tag"] },
  { field: "seo.slug", payload: "slug", db: "metadata", surfaces: ["future-routing"] }
];

const REQUIRED_FILES = [
  "admin/app/pages/products/payload.js",
  "admin/app/pages/products/review-engine.js",
  "server/controllers/productcontroller.js",
  "server/repositories/sqlite/product.repository.js",
  "services/productService.js",
  "js/storefront-display.js",
  "js/product-card-system.js",
  "script.js",
  "details/js/product-data-loader.js",
  "details/js/product-details.js",
  "details/js/product-modal.js",
  "services/byose-cart.js",
  "js/variant-cart-payload.js",
  "js/color-variant-inventory.js",
  "server/utils/colorVariantSerialization.js"
];

const SOURCE_CHECKS = [
  {
    id: "payload-long-description",
    file: "admin/app/pages/products/payload.js",
    pattern: /longDescription:\s*splitLongDescription/,
    message: "Payload emits longDescription array for DB persistence"
  },
  {
    id: "pdp-seo-meta",
    file: "details/js/product-details.js",
    pattern: /product\.metaTitle/,
    message: "PDP uses admin metaTitle for document title"
  },
  {
    id: "homepage-placement-filter",
    file: "script.js",
    pattern: /filterProductsForSection/,
    message: "Homepage uses placement filtering for merchandising sections"
  },
  {
    id: "product-card-syntax",
    file: "js/product-card-system.js",
    pattern: /function renderDiscountBadge\(product\)/,
    message: "Product card discount badge renderer is defined"
  },
  {
    id: "card-highlight-badge",
    file: "js/product-card-system.js",
    pattern: /renderHighlightBadge/,
    message: "Product cards render highlight/placement badges"
  },
  {
    id: "card-short-name",
    file: "js/product-card-system.js",
    pattern: /getCardDisplayName/,
    message: "Product cards prefer shortName when available"
  },
  {
    id: "storefront-visibility",
    file: "js/storefront-display.js",
    pattern: /shouldShowOnSurface/,
    message: "Visibility rules shared across storefront surfaces"
  },
  {
    id: "storefront-published-check",
    file: "js/product-visibility.js",
    pattern: /isProductPublished/,
    message: "Storefront publish visibility helper exists"
  },
  {
    id: "variant-cart-payload",
    file: "js/variant-cart-payload.js",
    pattern: /buildVariantCartPayload/,
    message: "Variant cart payload builder exists for cart/checkout flow"
  },
  {
    id: "color-variant-enrichment",
    file: "js/color-variant-inventory.js",
    pattern: /enrichProductColorVariants/,
    message: "Color variant enrichment helper exists"
  }
];

function readSource(relativePath) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    return "";
  }
  return readFileSync(absolutePath, "utf8");
}

function buildSampleDraft() {
  const draft = createDefaultDraft();
  draft.info.name = "Integration Audit Sneaker";
  draft.info.shortName = "Audit Sneaker";
  draft.info.category = "shoes";
  draft.info.brand = "Byose";
  draft.info.placement = ["featured_products", "fresh_picks"];
  draft.info.visibility = "both";
  draft.pricing.sellingPrice = "45000";
  draft.pricing.originalPrice = "60000";
  draft.description.shortDescription = "Lightweight sneaker for daily wear.";
  draft.description.longDescription = "Paragraph one.\n\nParagraph two.";
  draft.media.mainImage = "/uploads/sample-main.jpg";
  draft.media.gallery = ["/uploads/sample-gallery.jpg"];
  draft.inventory.sku = "AUDIT-001";
  draft.inventory.quantity = "12";
  draft.inventory.colorVariants = [{
    clientKey: "color-audit",
    colorName: "White",
    image: "/uploads/white.jpg",
    sizes: [{ size: "41", stock: 6 }, { size: "42", stock: 6 }]
  }];
  draft.inventory.variantsEnabled = true;
  return draft;
}

function runPayloadChecks() {
  const draft = buildSampleDraft();
  const payload = buildProductPayload(draft);
  const checks = [];

  checks.push({
    name: "Payload includes selling price",
    ok: Number(payload.price) > 0
  });
  checks.push({
    name: "Payload includes longDescription array",
    ok: Array.isArray(payload.longDescription) && payload.longDescription.length >= 1
  });
  checks.push({
    name: "Payload includes placement metadata",
    ok: Array.isArray(payload.metadata?.placement) && payload.metadata.placement.length >= 1
  });
  checks.push({
    name: "Payload includes color variant matrix",
    ok: Array.isArray(payload.variants?.items) && payload.variants.items.length >= 1
  });
  checks.push({
    name: "Payload includes SEO fields",
    ok: Boolean(payload.metaTitle) && Boolean(payload.slug)
  });
  checks.push({
    name: "Payload includes main image",
    ok: Boolean(payload.mainImage)
  });

  checks.push({
    name: "Payload keeps published products active when out of stock",
    ok: (() => {
      const zeroStockDraft = buildSampleDraft();
      zeroStockDraft.inventory.quantity = "0";
      zeroStockDraft.info.publishStatus = "active";
      const zeroStockPayload = buildProductPayload(zeroStockDraft);
      return zeroStockPayload.status === "active";
    })()
  });
  checks.push({
    name: "Payload marks draft products as draft regardless of stock",
    ok: (() => {
      const draftProduct = buildSampleDraft();
      draftProduct.info.publishStatus = "draft";
      draftProduct.inventory.quantity = "25";
      return buildProductPayload(draftProduct).status === "draft";
    })()
  });
  checks.push({
    name: "Payload marks inactive publish status as inactive",
    ok: (() => {
      const inactiveProduct = buildSampleDraft();
      inactiveProduct.info.publishStatus = "inactive";
      inactiveProduct.inventory.quantity = "25";
      return buildProductPayload(inactiveProduct).status === "inactive";
    })()
  });

  return checks;
}

function runSourceChecks() {
  return SOURCE_CHECKS.map((check) => {
    const source = readSource(check.file);
    return {
      name: check.message,
      ok: check.pattern.test(source),
      id: check.id
    };
  });
}

function runFilePresenceChecks() {
  return REQUIRED_FILES.map((relativePath) => ({
    name: `Required integration file exists: ${relativePath}`,
    ok: existsSync(join(root, relativePath))
  }));
}

const payloadChecks = runPayloadChecks();
const sourceChecks = runSourceChecks();
const fileChecks = runFilePresenceChecks();
const allChecks = [...payloadChecks, ...sourceChecks, ...fileChecks];
const failed = allChecks.filter((check) => !check.ok);

console.log("BYOSE Market — Add Product Integration Audit");
console.log("============================================");
console.log(`Mapped admin fields: ${INTEGRATION_MAP.length}`);
INTEGRATION_MAP.forEach((entry) => {
  console.log(`  • ${entry.field} → ${entry.payload} → ${entry.db} → [${entry.surfaces.join(", ")}]`);
});

console.log("\nAutomated checks:");
allChecks.forEach((check) => {
  console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}`);
});

if (failed.length) {
  console.error(`\n${failed.length} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${allChecks.length} automated integration checks passed.`);
}
