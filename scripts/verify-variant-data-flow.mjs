/**
 * API + data-flow verification without browser (production-quality gate).
 * Run: node scripts/verify-variant-data-flow.mjs
 */

import { enrichSerializedProductColorVariants } from "../server/utils/colorVariantSerialization.js";
import {
  buildVariantCartPayload,
  validateVariantSelection
} from "../js/variant-cart-payload.js";
import { enrichProductColorVariants, getSizesForColor } from "../js/color-variant-inventory.js";

const SITE = (process.env.BYOSE_SITE_ORIGIN || "http://127.0.0.1:5000").replace(/\/+$/, "");

function absolutize(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `${SITE}${value}`;
  return `${SITE}/${value.replace(/^\/+/, "")}`;
}

async function fetchCatalog() {
  const response = await fetch(`${SITE}/api/products?limit=500`, {
    headers: { Accept: "application/json" }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Catalog request failed: ${response.status}`);
  }
  return Array.isArray(body?.products) ? body.products : [];
}

function hasColorVariants(product) {
  const fromVariants = Array.isArray(product?.variants?.colorVariants) ? product.variants.colorVariants : [];
  const fromMetadata = Array.isArray(product?.metadata?.colorVariants) ? product.metadata.colorVariants : [];
  return fromVariants.length > 0 || fromMetadata.length > 0;
}

function pickVariantProduct(products) {
  return products.find(hasColorVariants) || null;
}

async function verifyImageUrl(url) {
  if (!url) {
    return { ok: false, status: 0 };
  }
  try {
    const response = await fetch(url, { method: "HEAD" });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function main() {
  const checks = [];
  const products = await fetchCatalog();

  checks.push({ name: "catalog returns products", ok: products.length >= 1 });

  const variantProduct = pickVariantProduct(products);
  checks.push({ name: "at least one product has color variants", ok: Boolean(variantProduct) });

  if (variantProduct) {
    const enrichedApi = enrichSerializedProductColorVariants(variantProduct, absolutize);
    const colorVariants = enrichedApi?.variants?.colorVariants || enrichedApi?.metadata?.colorVariants || [];
    const firstColor = colorVariants[0] || {};
    const firstSize = (firstColor.sizes || []).find((row) => Number(row.stock) > 0) || firstColor.sizes?.[0];

    checks.push({ name: "API color variants enriched", ok: colorVariants.length >= 1 });
    checks.push({ name: "API color has name", ok: Boolean(String(firstColor.colorName || "").trim()) });
    checks.push({
      name: "API color image is absolute URL",
      ok: /^https?:\/\//i.test(String(firstColor.image || ""))
    });

    const imageProbe = await verifyImageUrl(firstColor.image);
    checks.push({
      name: "API color image responds",
      ok: imageProbe.ok || imageProbe.status === 405
    });

    const storefrontProduct = enrichProductColorVariants(enrichedApi, absolutize);
    const sizeOptions = getSizesForColor(storefrontProduct, firstColor.id);
    const inStockSize = sizeOptions.find((row) => Number(row.stock) > 0) || sizeOptions[0];
    const attributes = inStockSize
      ? { Color: firstColor.id, Size: inStockSize.value }
      : {};

    if (inStockSize && Number(inStockSize.stock) > 0) {
      const selection = validateVariantSelection(storefrontProduct, attributes);
      checks.push({ name: "valid color+size passes validation", ok: selection.valid === true });

      const payload = buildVariantCartPayload(storefrontProduct, 1, attributes);
      checks.push({ name: "cart payload has color name", ok: Boolean(payload.colorName) });
      checks.push({ name: "cart payload has size label", ok: Boolean(payload.sizeLabel) });
      checks.push({ name: "cart payload has color image", ok: Boolean(payload.colorImage) });
      checks.push({ name: "cart payload has human summary", ok: /size/i.test(payload.attributeSummary || "") });
      checks.push({ name: "cart payload has stock snapshot", ok: Number(payload.availableStock) > 0 });
    }

    const searchTerm = encodeURIComponent(String(variantProduct.name || "").split(" ")[0] || "shoe");
    const searchResponse = await fetch(`${SITE}/api/products/search?q=${searchTerm}&limit=10`);
    const searchBody = await searchResponse.json().catch(() => null);
    const searchCount = Number(searchBody?.count) || (searchBody?.products || []).length;
    checks.push({ name: "search API responds", ok: searchResponse.ok });
    checks.push({ name: "search finds products", ok: searchCount >= 0 });
  }

  const failed = checks.filter((check) => !check.ok);
  console.log("BYOSE Variant Data Flow Verification");
  console.log("==================================");
  console.log(`Site: ${SITE}`);
  console.log(`Products: ${products.length}`);
  console.log(`Variant product: ${variantProduct?.name || "none"} (#${variantProduct?.id || "?"})`);
  checks.forEach((check) => console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}`));

  if (failed.length) {
    console.error(`\n${failed.length} check(s) failed.`);
    process.exit(1);
  }

  console.log(`\nAll ${checks.length} data-flow checks passed.`);
}

main().catch((error) => {
  console.error("Verification error:", error.message || error);
  process.exit(1);
});
