/**
 * STEP 2: SQLite image-row preservation for product edits.
 * Run: node scripts/verify-product-edit-sqlite.cjs
 */

const { initializeClient, closeClient } = require("../server/database/sqlite/client");
const { applyMigrations } = require("../server/database/sqlite/migrate");
const config = require("../server/config/env");
const productRepository = require("../server/repositories/sqlite/product.repository");

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

function loadImageRows(recordId) {
  const db = require("../server/database/sqlite/client").getClient();
  return db.prepare(`
    SELECT id, image_url, kind, sort_order
    FROM product_images
    WHERE product_id = ?
    ORDER BY sort_order ASC, id ASC
  `).all(Number(recordId));
}

async function main() {
  initializeClient();
  applyMigrations(require("../server/database/sqlite/client").getClient(), config.sqlite.migrationsDir);

  const catalogId = 9101;
  const sample = {
    catalogId,
    name: "Edit Preservation Runner",
    title: "Edit Runner",
    description: "Original description for edit preservation.",
    shortDescription: "Short original description.",
    longDescription: ["Original description for edit preservation."],
    category: "shoes",
    brand: "BYOSE",
    price: 20000,
    oldPrice: 25000,
    stock: 15,
    sku: "EDIT-9101",
    status: "active",
    visibility: "both",
    mainImage: "products/edit-main-9101.webp",
    image: "products/edit-main-9101.webp",
    gallery: [
      "products/edit-g1-9101.webp",
      "products/edit-g2-9101.webp",
      "products/edit-g3-9101.webp",
      "products/edit-g4-9101.webp"
    ],
    attributes: [],
    variants: {},
    metadata: {
      shortName: "Edit Runner",
      brand: "BYOSE",
      sku: "EDIT-9101"
    }
  };

  await productRepository.save(sample, { identifier: catalogId });
  const created = await productRepository.findByIdentifier(catalogId);
  assert(created?.catalogId === catalogId, "seed product uses a stable catalog id");
  assert(created?.gallery?.length >= 4, "seed product stores extra gallery images");

  const beforeRows = loadImageRows(created.recordId);
  const beforeIds = beforeRows.map((row) => Number(row.id));
  assert(beforeIds.length >= 4, "product_images has a row per stored image");

  const priceOnly = {
    ...created,
    price: 22000
  };
  await productRepository.save(priceOnly, { identifier: catalogId });
  const afterPrice = await productRepository.findByIdentifier(catalogId);
  const afterPriceRows = loadImageRows(afterPrice.recordId);
  assert(afterPrice.price === 22000, "price-only update changes price");
  assert(afterPrice.description === sample.description, "price-only update keeps description");
  assert(afterPrice.oldPrice === 25000, "price-only update keeps old price");
  assert(afterPrice.stock === 15, "price-only update keeps stock");
  assert(afterPrice.catalogId === catalogId, "price-only update keeps catalog id");
  assert(
    JSON.stringify(afterPriceRows.map((row) => Number(row.id))) === JSON.stringify(beforeIds),
    "price-only update keeps the same product_images row ids"
  );
  assert(
    JSON.stringify(afterPriceRows.map((row) => row.image_url)) === JSON.stringify(beforeRows.map((row) => row.image_url)),
    "price-only update does not rewrite image paths"
  );

  const descriptionOnly = {
    ...afterPrice,
    description: "Updated description only."
  };
  await productRepository.save(descriptionOnly, { identifier: catalogId });
  const afterDescription = await productRepository.findByIdentifier(catalogId);
  assert(afterDescription.description === "Updated description only.", "description-only update changes description");
  assert(afterDescription.price === 22000, "description-only update keeps the new price");
  assert(
    JSON.stringify(loadImageRows(afterDescription.recordId).map((row) => Number(row.id))) === JSON.stringify(beforeIds),
    "description-only update keeps existing image rows"
  );

  const sizeOnly = {
    ...afterDescription,
    attributes: [{ name: "Size", options: [{ label: "40" }, { label: "41" }, { label: "42" }] }],
    variants: { enabled: true, items: [{ size: "40" }, { size: "41" }, { size: "42" }] }
  };
  await productRepository.save(sizeOnly, { identifier: catalogId });
  const afterSize = await productRepository.findByIdentifier(catalogId);
  assert(afterSize.price === 22000, "size-only update keeps price");
  assert(afterSize.description === "Updated description only.", "size-only update keeps description");
  assert(afterSize.catalogId === catalogId, "size-only update keeps catalog id");
  assert(
    JSON.stringify(loadImageRows(afterSize.recordId).map((row) => Number(row.id))) === JSON.stringify(beforeIds),
    "size-only update keeps existing image rows"
  );

  const multiField = {
    ...afterSize,
    name: "Edit Preservation Runner Pro",
    price: 24500,
    stock: 18
  };
  await productRepository.save(multiField, { identifier: catalogId });
  const afterMulti = await productRepository.findByIdentifier(catalogId);
  assert(afterMulti.name === "Edit Preservation Runner Pro", "multi-field update changes the name");
  assert(afterMulti.price === 24500, "multi-field update changes the price");
  assert(afterMulti.stock === 18, "multi-field update changes stock");
  assert(afterMulti.description === "Updated description only.", "multi-field update keeps the untouched description");
  assert(afterMulti.catalogId === catalogId, "multi-field update keeps catalog id");
  assert(
    JSON.stringify(loadImageRows(afterMulti.recordId).map((row) => Number(row.id))) === JSON.stringify(beforeIds),
    "multi-field update keeps existing image rows"
  );

  const stockOnlyEmptyImages = {
    ...afterMulti,
    stock: 22,
    image: "",
    mainImage: "",
    gallery: []
  };
  await productRepository.save(stockOnlyEmptyImages, { identifier: catalogId });
  const afterStockOnly = await productRepository.findByIdentifier(catalogId);
  const afterStockRows = loadImageRows(afterStockOnly.recordId);
  assert(afterStockOnly.stock === 22, "stock-only empty-image save changes stock");
  assert(String(afterStockOnly.mainImage || afterStockOnly.image).includes("edit-main-9101.webp"), "stock-only empty-image save keeps the main image column");
  assert(
    afterStockRows.some((row) => String(row.image_url).includes("edit-g1-9101.webp")),
    "stock-only empty-image save keeps gallery image rows"
  );
  assert(
    JSON.stringify(afterStockRows.map((row) => Number(row.id))) === JSON.stringify(beforeIds),
    "stock-only empty-image save keeps the same product_images row ids"
  );

  const addedGallery = {
    ...afterStockOnly,
    gallery: [...(afterStockOnly.gallery || []), "products/edit-g5-9101.webp"],
    imagesChanged: true,
    preserveExistingImages: false
  };
  await productRepository.save(addedGallery, { identifier: catalogId });
  const afterAdd = await productRepository.findByIdentifier(catalogId);
  const afterAddRows = loadImageRows(afterAdd.recordId);
  const afterAddIds = afterAddRows.map((row) => Number(row.id));
  assert(afterAddRows.some((row) => String(row.image_url).includes("edit-g5-9101.webp")), "adding one image inserts the new image");
  assert(beforeIds.every((id) => afterAddIds.includes(id)), "adding one image keeps every previous image row id");
  assert(afterAddIds.length === beforeIds.length + 1, "adding one image adds exactly one image row");

  const removedGallery = {
    ...afterAdd,
    gallery: (afterAdd.gallery || []).filter((entry) => !String(entry).includes("edit-g2-9101.webp")),
    imagesChanged: true,
    preserveExistingImages: false
  };
  await productRepository.save(removedGallery, { identifier: catalogId });
  const afterRemove = await productRepository.findByIdentifier(catalogId);
  const afterRemoveRows = loadImageRows(afterRemove.recordId);
  assert(!afterRemoveRows.some((row) => String(row.image_url).includes("edit-g2-9101.webp")), "removing one image deletes only that image row");
  assert(afterRemoveRows.some((row) => String(row.image_url).includes("edit-g1-9101.webp")), "removing one image keeps remaining gallery image");
  assert(afterRemoveRows.some((row) => String(row.image_url).includes("edit-g5-9101.webp")), "removing one image keeps the newly added image");
  assert(afterRemove.catalogId === catalogId, "image removal keeps the original catalog id");

  const cardOverwrite = {
    ...afterRemove,
    stock: Number(afterRemove.stock || 0) + 1,
    image: "products/cards/edit-main-9101.webp",
    mainImage: "https://byosemarket.com/uploads/products/cards/edit-main-9101.webp",
    gallery: []
  };
  await productRepository.save(cardOverwrite, { identifier: catalogId });
  const afterCard = await productRepository.findByIdentifier(catalogId);
  const afterCardRows = loadImageRows(afterCard.recordId);
  assert(afterCard.stock === Number(afterRemove.stock || 0) + 1, "card-thumbnail save still updates stock");
  assert(
    !String(afterCard.mainImage || afterCard.image || "").includes("/cards/"),
    "card thumbnail is not stored as the canonical product image"
  );
  assert(
    afterCardRows.some((row) => String(row.image_url).includes("edit-g1-9101.webp")),
    "card-thumbnail save keeps existing gallery image rows"
  );
  assert(
    afterCardRows.some((row) => String(row.image_url).includes("edit-g5-9101.webp")),
    "card-thumbnail save keeps previously added gallery images"
  );

  const omittedImages = {
    ...afterCard,
    stock: Number(afterCard.stock || 0) + 2,
    image: "",
    mainImage: "",
    gallery: []
  };
  await productRepository.save(omittedImages, { identifier: catalogId });
  const afterOmitted = await productRepository.findByIdentifier(catalogId);
  const afterOmittedRows = loadImageRows(afterOmitted.recordId);
  assert(afterOmitted.stock === Number(afterCard.stock || 0) + 2, "update without imagesChanged still changes stock");
  assert(
    JSON.stringify(afterOmittedRows.map((row) => row.image_url)) === JSON.stringify(afterCardRows.map((row) => row.image_url)),
    "update without imagesChanged does not rewrite original image rows"
  );

  const lockedRowsBefore = loadImageRows(afterOmitted.recordId).map((row) => ({
    id: Number(row.id),
    image_url: row.image_url
  }));
  await productRepository.save({
    ...afterOmitted,
    stock: Number(afterOmitted.stock || 0) + 4,
    image: "",
    mainImage: "products/cards/should-not-win.webp",
    gallery: ["products/cards/should-not-win.webp"],
    preserveExistingImages: true
  }, { identifier: catalogId });
  const afterLock = await productRepository.findByIdentifier(catalogId);
  const afterLockRows = loadImageRows(afterLock.recordId);
  assert(afterLock.stock === Number(afterOmitted.stock || 0) + 4, "preserveExistingImages still updates stock");
  assert(
    JSON.stringify(afterLockRows.map((row) => Number(row.id))) === JSON.stringify(lockedRowsBefore.map((row) => row.id)),
    "preserveExistingImages does not insert or delete product_images rows"
  );
  assert(
    JSON.stringify(afterLockRows.map((row) => row.image_url)) === JSON.stringify(lockedRowsBefore.map((row) => row.image_url)),
    "preserveExistingImages does not rewrite original image paths"
  );

  await productRepository.remove(catalogId);

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    closeClient();
    process.exit(1);
  }

  console.log("\n[verify-product-edit-sqlite] All image-row preservation checks passed.");
  closeClient();
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
