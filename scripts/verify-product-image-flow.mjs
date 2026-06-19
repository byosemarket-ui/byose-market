/**
 * End-to-end product image URL verification for pre-deploy checks.
 * Run: node scripts/verify-product-image-flow.mjs
 */

import {
  normalizeStorefrontAssetUrl,
  resolveProductImageUrl
} from "../services/storefront-asset-url.js";

const PRODUCTION_ORIGIN = "https://byosemarket.com";
const API_URL = `${PRODUCTION_ORIGIN}/api/products`;

globalThis.window = {
  location: {
    protocol: "https:",
    origin: PRODUCTION_ORIGIN
  }
};

let failures = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failures += 1;
    return false;
  }
  console.log(`PASS: ${message}`);
  return true;
}

function runUnitTests() {
  console.log("\n=== Unit tests: storefront asset URL resolution ===\n");

  assert(
    normalizeStorefrontAssetUrl("/uploads/products/test.jpg") === `${PRODUCTION_ORIGIN}/uploads/products/test.jpg`,
    "normalize relative /uploads path"
  );

  assert(
    normalizeStorefrontAssetUrl("products/abc.webp") === `${PRODUCTION_ORIGIN}/uploads/products/abc.webp`,
    "normalize storage-relative products/ path"
  );

  assert(
    resolveProductImageUrl({ mainImage: "/uploads/products/a.jpg" }) === `${PRODUCTION_ORIGIN}/uploads/products/a.jpg`,
    "resolve mainImage from /uploads path"
  );

  assert(
    resolveProductImageUrl({
      mainImageStoragePath: "products/uuid-main.jpg",
      galleryStoragePaths: ["products/uuid-2.jpg"]
    }) === `${PRODUCTION_ORIGIN}/uploads/products/uuid-main.jpg`,
    "resolve from storage paths when public URL missing"
  );

  assert(
    resolveProductImageUrl({
      mainImage: `${PRODUCTION_ORIGIN}/uploads/products/abs.jpg`
    }) === `${PRODUCTION_ORIGIN}/uploads/products/abs.jpg`,
    "preserve absolute HTTPS URL from API"
  );

  assert(
    resolveProductImageUrl({ name: "No image product" }) === "",
    "empty product returns no image URL"
  );
}

async function verifyLiveApi() {
  console.log("\n=== Live API: product image URLs ===\n");

  let response;
  try {
    response = await fetch(API_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    assert(false, `API fetch failed: ${error.message}`);
    return;
  }

  assert(response.ok, `GET /api/products returns HTTP ${response.status}`);

  const payload = await response.json();
  const products = Array.isArray(payload?.products) ? payload.products : [];
  assert(products.length > 0, `API returned ${products.length} product(s)`);

  const withImages = products.filter((product) => {
    const url = String(product?.mainImage || product?.image || "").trim();
    return Boolean(url) && !/\/img\/logo\.png/i.test(url);
  });

  assert(withImages.length > 0, `at least one product has a non-logo mainImage (${withImages.length}/${products.length})`);

  for (const product of withImages.slice(0, 5)) {
    const rawImage = String(product.mainImage || product.image || "").trim();
    const imageUrl = resolveProductImageUrl(product) || normalizeStorefrontAssetUrl(rawImage);

    assert(/^https?:\/\//i.test(imageUrl), `product ${product.id} resolves to absolute URL: ${imageUrl}`);

    if (!/^https?:\/\//i.test(rawImage)) {
      console.log(`INFO: product ${product.id} API returns relative path (frontend will resolve): ${rawImage}`);
    }

    let imageResponse;
    try {
      imageResponse = await fetch(imageUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(10000)
      });
    } catch (error) {
      assert(false, `product ${product.id} image HEAD failed: ${error.message}`);
      continue;
    }

    assert(
      imageResponse.ok,
      `product ${product.id} image reachable (${imageResponse.status}): ${imageUrl}`
    );
  }
}

async function main() {
  runUnitTests();
  await verifyLiveApi();

  console.log(`\n=== Summary: ${failures} failure(s) ===\n`);
  if (failures > 0) {
    process.exit(1);
  }

  console.log("Product image flow verification passed.");
}

main().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
