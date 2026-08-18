/**
 * STEP 3: End-to-end Edit Product verification against live product 10
 * and a disposable local SQLite clone that never shares live VPS image paths.
 *
 * Run: node scripts/verify-product-edit-e2e.mjs
 */

import { collectOriginalImagesForDisplay, hydrateDraftFromProduct, snapshotCanonicalMedia } from "../admin/app/pages/products/draft.js";
import { buildProductPayload } from "../admin/app/pages/products/payload.js";
import { verifyReloadedProductUpdate } from "../admin/app/pages/products/edit-integrity.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  mergeProductUpdate,
  normalizePayload
} = require("../server/controllers/productcontroller");
const { initializeClient, closeClient, getClient } = require("../server/database/sqlite/client");
const { applyMigrations } = require("../server/database/sqlite/migrate");
const config = require("../server/config/env");
const productRepository = require("../server/repositories/sqlite/product.repository");

const LIVE_ID = 10;
const CLONE_ID = 9310;
const LIVE_DETAIL_URL = `https://byosemarket.com/api/products/${LIVE_ID}`;
const LIVE_STOREFRONT_URL = `https://byosemarket.com/details/product-details1.html?id=${LIVE_ID}`;

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

function originalUrls(product) {
  return [product?.originalImage, product?.mainImage, product?.image]
    .concat(Array.isArray(product?.gallery) ? product.gallery : [])
    .map((entry) => String(entry || "").trim())
    .filter((entry) => entry && !entry.includes("/cards/") && !entry.includes("img/logo.png"));
}

async function headOk(url) {
  const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(12000) });
  return response.ok;
}

async function fetchLiveProduct() {
  const response = await fetch(LIVE_DETAIL_URL, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    throw new Error(`Live product ${LIVE_ID} returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (!payload?.product) {
    throw new Error(`Live product ${LIVE_ID} payload is empty`);
  }
  return payload.product;
}

function loadImageRows(recordId) {
  return getClient().prepare(`
    SELECT id, image_url, kind, sort_order
    FROM product_images
    WHERE product_id = ?
    ORDER BY sort_order ASC, id ASC
  `).all(Number(recordId));
}

async function reopenClone() {
  return productRepository.findByIdentifier(CLONE_ID);
}

async function main() {
  console.log("\n=== STEP 3: Live product 10 load / storefront / original images ===\n");
  const live = await fetchLiveProduct();
  const liveHydrated = hydrateDraftFromProduct(live);
  const liveOriginals = collectOriginalImagesForDisplay(liveHydrated);
  const liveUrls = originalUrls(live);

  assert(Number(live.id || live.catalogId) === LIVE_ID, "live Edit target is existing product 10");
  assert(Boolean(live.name || live.title), "product 10 has product information");
  assert(Number(live.price) > 0, "product 10 has a price");
  assert(Number.isFinite(Number(live.stock)), "product 10 has stock");
  assert(Boolean(String(live.description || live.shortDescription || "").trim()), "product 10 has a description");
  assert(liveUrls.length >= 2, "product 10 has multiple original images");
  assert(!String(liveHydrated.media.mainImage).includes("/cards/"), "Edit hydrates the original main image, not a card thumbnail");
  assert(liveOriginals.length >= 2, "Edit displays every original image on load");
  assert(liveOriginals.every((entry) => !String(entry.url).includes("/cards/")), "Edit load never uses card thumbnails as originals");

  const storefrontPage = await fetch(LIVE_STOREFRONT_URL, { signal: AbortSignal.timeout(15000) });
  assert(storefrontPage.ok, `live storefront details page is reachable (${storefrontPage.status})`);

  let reachableOriginals = 0;
  for (const url of [...new Set(liveUrls)]) {
    if (!/^https?:/i.test(url)) {
      continue;
    }
    try {
      if (await headOk(url)) {
        reachableOriginals += 1;
      } else {
        console.error(`FAIL: original image not reachable: ${url}`);
        failures += 1;
      }
    } catch (error) {
      console.error(`FAIL: original image HEAD failed: ${url} (${error.message})`);
      failures += 1;
    }
  }
  assert(reachableOriginals >= 2, `at least two original VPS images are reachable (${reachableOriginals})`);

  console.log("\n=== STEP 3: Stock / price / description-only payloads against live product 10 ===\n");
  const snapshot = snapshotCanonicalMedia(liveHydrated);

  const stockDraft = JSON.parse(JSON.stringify(liveHydrated));
  if (stockDraft.inventory.colorVariants?.[0]?.sizes?.[0]) {
    stockDraft.inventory.colorVariants[0].sizes[0].stock = String(
      Math.max(0, Number(stockDraft.inventory.colorVariants[0].sizes[0].stock || 0))
    );
  } else {
    stockDraft.inventory.quantity = String(Math.max(0, Number(stockDraft.inventory.quantity || 0)));
  }
  const stockPayload = buildProductPayload(stockDraft, {
    ...snapshot,
    preserveExistingImages: true,
    imagesChanged: false
  });
  const stockMerged = mergeProductUpdate(live, normalizePayload(stockPayload), stockPayload);
  assert(stockPayload.preserveExistingImages === true, "stock-only save locks original images");
  assert(stockPayload.imagesChanged === false, "stock-only save does not mark images as changed");
  assert(JSON.stringify(stockMerged.gallery) === JSON.stringify(
    (live.gallery || []).filter((entry) => !String(entry).includes("/cards/"))
  ) || stockMerged.gallery.length >= liveHydrated.media.gallery.length, "stock-only merge keeps extra originals");
  assert(!String(stockMerged.mainImage || "").includes("/cards/"), "stock-only merge does not store a card thumbnail");
  assert(stockMerged.price === Number(live.price), "stock-only merge keeps price");
  assert(String(stockMerged.description || "").includes(String(live.description || "").slice(0, 20)) || !live.description, "stock-only merge keeps description");

  const priceDraft = JSON.parse(JSON.stringify(liveHydrated));
  priceDraft.pricing.sellingPrice = String(live.price);
  const pricePayload = buildProductPayload(priceDraft, {
    ...snapshot,
    preserveExistingImages: true,
    imagesChanged: false
  });
  const priceMerged = mergeProductUpdate(live, normalizePayload(pricePayload), pricePayload);
  assert(priceMerged.stock === Number(live.stock), "price-only merge keeps stock");
  assert(priceMerged.gallery.length >= liveHydrated.media.gallery.length, "price-only merge keeps extra originals");
  assert(!String(priceMerged.mainImage || "").includes("/cards/"), "price-only merge does not store a card thumbnail");

  const descriptionDraft = JSON.parse(JSON.stringify(liveHydrated));
  descriptionDraft.description.longDescription = liveHydrated.description.longDescription;
  descriptionDraft.description.description = liveHydrated.description.longDescription;
  const descriptionPayload = buildProductPayload(descriptionDraft, {
    ...snapshot,
    preserveExistingImages: true,
    imagesChanged: false
  });
  const descriptionMerged = mergeProductUpdate(live, normalizePayload(descriptionPayload), descriptionPayload);
  assert(descriptionMerged.price === Number(live.price), "description-only merge keeps price");
  assert(descriptionMerged.stock === Number(live.stock), "description-only merge keeps stock");
  assert(descriptionMerged.gallery.length >= liveHydrated.media.gallery.length, "description-only merge keeps extra originals");

  verifyReloadedProductUpdate({
    productId: LIVE_ID,
    beforeProduct: live,
    reloadedProduct: live,
    expectedPayload: { stock: live.stock, price: live.price, description: live.description },
    preserveExistingImages: true,
    expectedMedia: snapshot
  });
  assert(true, "reopening the live product still verifies existing fields and original images");

  verifyReloadedProductUpdate({
    productId: LIVE_ID,
    beforeProduct: { ...live, longDescription: [] },
    reloadedProduct: { ...live, longDescription: [], description: live.description || live.shortDescription },
    expectedPayload: { description: live.description || live.shortDescription },
    preserveExistingImages: true,
    expectedMedia: snapshot
  });
  assert(true, "description verification still works when longDescription is an empty array");

  console.log("\n=== STEP 3: Local SQLite clone save / reopen / image add-remove-replace ===\n");
  initializeClient();
  applyMigrations(getClient(), config.sqlite.migrationsDir);

  const leftoverClone = await productRepository.findByIdentifier(CLONE_ID);
  if (leftoverClone) {
    await productRepository.remove(CLONE_ID);
  }

  const clone = {
    catalogId: CLONE_ID,
    name: live.name || "E2E Edit Clone",
    title: live.title || live.name || "E2E Edit Clone",
    description: live.description || "Original description",
    shortDescription: live.shortDescription || live.description || "Original short description",
    longDescription: (Array.isArray(live.longDescription) && live.longDescription.some((entry) => String(entry || "").trim()))
      ? live.longDescription
      : [live.description || "Original description"],
    category: live.category || "shoes",
    brand: live.brand || "BYOSE",
    price: Number(live.price || 10000),
    oldPrice: Number(live.oldPrice || 0),
    stock: Number(live.stock || 4),
    sku: `E2E-${CLONE_ID}`,
    status: "active",
    visibility: "both",
    mainImage: "products/e2e-9310-main.png",
    image: "products/e2e-9310-main.png",
    gallery: [
      "products/e2e-9310-g1.png",
      "products/e2e-9310-g2.png",
      "products/e2e-9310-g3.png"
    ],
    attributes: [],
    variants: {},
    metadata: {
      shortName: live.title || live.name,
      sku: `E2E-${CLONE_ID}`,
      colorVariants: []
    }
  };

  try {
  await productRepository.save(clone, { identifier: CLONE_ID });
  let current = await reopenClone();
  const beforeRows = loadImageRows(current.recordId);
  const beforeIds = beforeRows.map((row) => Number(row.id));
  assert(current.catalogId === CLONE_ID, "clone uses a disposable catalog id, not live product 10");
  assert(beforeIds.length >= 3, "clone stores multiple original image rows");

  await productRepository.save({
    ...current,
    stock: Number(current.stock) + 1
  }, { identifier: CLONE_ID });
  current = await reopenClone();
  const afterStockRows = loadImageRows(current.recordId);
  assert(current.stock === Number(clone.stock) + 1, "Test A: stock-only save changes stock");
  assert(current.price === clone.price, "Test A: stock-only save keeps price");
  assert(current.description === clone.description, "Test A: stock-only save keeps description");
  assert(JSON.stringify(afterStockRows.map((row) => row.image_url)) === JSON.stringify(beforeRows.map((row) => row.image_url)), "Test A: stock-only save keeps every original image row");

  await productRepository.save({
    ...current,
    price: Number(current.price) + 500
  }, { identifier: CLONE_ID });
  current = await reopenClone();
  assert(current.price === Number(clone.price) + 500, "Test B: price-only save changes price");
  assert(current.stock === Number(clone.stock) + 1, "Test B: price-only save keeps the new stock");
  assert(current.description === clone.description, "Test B: price-only save keeps description");
  assert(
    JSON.stringify(loadImageRows(current.recordId).map((row) => Number(row.id))) === JSON.stringify(beforeIds),
    "Test B: price-only save keeps the same image row ids"
  );

  const updatedDescription = "Updated description only for Edit Product e2e.";
  await productRepository.save({
    ...current,
    description: updatedDescription,
    longDescription: [updatedDescription]
  }, { identifier: CLONE_ID });
  current = await reopenClone();
  assert(current.description === updatedDescription, "Test C: description-only save changes description");
  assert(current.price === Number(clone.price) + 500, "Test C: description-only save keeps price");
  assert(current.stock === Number(clone.stock) + 1, "Test C: description-only save keeps stock");
  assert(
    JSON.stringify(loadImageRows(current.recordId).map((row) => row.image_url)) === JSON.stringify(beforeRows.map((row) => row.image_url)),
    "Test C: description-only save keeps original images"
  );

  const reopenedHydrated = hydrateDraftFromProduct(current);
  assert(reopenedHydrated.media.gallery.length >= 2, "reopening Edit after field-only saves still loads extra originals");
  assert(!String(reopenedHydrated.media.mainImage).includes("/cards/"), "reopening Edit after field-only saves still uses original images");

  await productRepository.save({
    ...current,
    gallery: [...(current.gallery || []), "products/e2e-9310-g4.png"],
    imagesChanged: true,
    preserveExistingImages: false
  }, { identifier: CLONE_ID });
  current = await reopenClone();
  const afterAddRows = loadImageRows(current.recordId);
  assert(afterAddRows.some((row) => String(row.image_url).includes("e2e-9310-g4.png")), "add image inserts the new original");
  assert(beforeIds.every((id) => afterAddRows.some((row) => Number(row.id) === id)), "add image keeps every previous original row id");

  const keptAfterRemove = (current.gallery || []).filter((entry) => !String(entry).includes("e2e-9310-g2.png"));
  await productRepository.save({
    ...current,
    gallery: keptAfterRemove,
    imagesChanged: true,
    preserveExistingImages: false
  }, { identifier: CLONE_ID });
  current = await reopenClone();
  const afterRemoveRows = loadImageRows(current.recordId);
  assert(!afterRemoveRows.some((row) => String(row.image_url).includes("e2e-9310-g2.png")), "remove image deletes only the selected original");
  assert(afterRemoveRows.some((row) => String(row.image_url).includes("e2e-9310-g1.png")), "remove image keeps other originals");
  assert(afterRemoveRows.some((row) => String(row.image_url).includes("e2e-9310-g4.png")), "remove image keeps the newly added original");

  const replacedGallery = (current.gallery || [])
    .filter((entry) => !String(entry).includes("e2e-9310-g3.png"))
    .concat(["products/e2e-9310-g3-replaced.png"]);
  await productRepository.save({
    ...current,
    gallery: replacedGallery,
    imagesChanged: true,
    preserveExistingImages: false
  }, { identifier: CLONE_ID });
  current = await reopenClone();
  const afterReplaceRows = loadImageRows(current.recordId);
  assert(!afterReplaceRows.some((row) => String(row.image_url).includes("e2e-9310-g3.png") && !String(row.image_url).includes("replaced")), "replace image removes only the intended original");
  assert(afterReplaceRows.some((row) => String(row.image_url).includes("e2e-9310-g3-replaced.png")), "replace image stores the new original");
  assert(afterReplaceRows.some((row) => String(row.image_url).includes("e2e-9310-g1.png")), "replace image keeps untouched originals");

  const replaceRowIds = afterReplaceRows.map((row) => Number(row.id));
  await productRepository.save({
    ...current,
    stock: Number(current.stock) + 2
  }, { identifier: CLONE_ID });
  current = await reopenClone();
  assert(current.stock === Number(clone.stock) + 3, "leaving images unchanged still updates stock");
  assert(
    JSON.stringify(loadImageRows(current.recordId).map((row) => Number(row.id))) === JSON.stringify(replaceRowIds),
    "leaving images unchanged does not rewrite image rows"
  );

  const finalHydrated = hydrateDraftFromProduct(current);
  verifyReloadedProductUpdate({
    productId: CLONE_ID,
    beforeProduct: current,
    reloadedProduct: current,
    expectedPayload: { stock: current.stock, price: current.price, description: current.description },
    preserveExistingImages: true,
    expectedMedia: snapshotCanonicalMedia(finalHydrated)
  });
  assert(true, "reopening the saved clone still contains the updated values and remaining originals");

  await productRepository.remove(CLONE_ID);
  const removed = await productRepository.findByIdentifier(CLONE_ID);
  assert(!removed, "disposable e2e clone was removed without touching live product 10");
  } finally {
    try {
      const leftover = await productRepository.findByIdentifier(CLONE_ID);
      if (leftover) {
        await productRepository.remove(CLONE_ID);
      }
    } catch (_error) {
      // Clone cleanup must never touch live product 10; ignore local cleanup errors.
    }
    closeClient();
  }

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }

  console.log("\n[verify-product-edit-e2e] Live load, field-only saves, image add/remove/replace, and reopen all passed.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  try {
    closeClient();
  } catch (_error) {
    // Ignore close failures during crash reporting.
  }
  process.exit(1);
});
