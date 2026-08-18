/**
 * STEP 1 verification: Edit Product must load every Add Product field
 * and changing one field must not wipe the rest.
 *
 * Run: node scripts/verify-product-edit-preservation.mjs
 */

import { createDefaultDraft, hydrateDraftFromProduct, sanitizeDraft } from "../admin/app/pages/products/draft.js";
import { buildProductPayload } from "../admin/app/pages/products/payload.js";

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

function sampleFullProduct() {
  return {
    id: 42,
    catalogId: 42,
    name: "Leather Runner Sneakers",
    title: "Leather Runner",
    description: "Full grain leather sneakers with cushioned sole.\n\nDesigned for daily wear.",
    shortDescription: "Premium leather sneakers for daily wear.",
    longDescription: [
      "Full grain leather sneakers with cushioned sole.",
      "Designed for daily wear."
    ],
    category: "shoes",
    brand: "BYOSE",
    badge: "BYOSE",
    price: 45000,
    oldPrice: 60000,
    originalPrice: 60000,
    compareAtPrice: 60000,
    stock: 7,
    sku: "SH-42-RUN",
    visibility: "both",
    status: "active",
    mainImage: "https://byosemarket.com/uploads/products/main-42.webp",
    image: "https://byosemarket.com/uploads/products/main-42.webp",
    originalImage: "https://byosemarket.com/uploads/products/main-42.webp",
    cardImage: "https://byosemarket.com/uploads/products/cards/main-42.webp",
    mainImageStoragePath: "products/main-42.webp",
    imageStoragePath: "products/main-42.webp",
    gallery: [
      "https://byosemarket.com/uploads/products/main-42.webp",
      "https://byosemarket.com/uploads/products/gallery-42-a.webp",
      "https://byosemarket.com/uploads/products/gallery-42-b.webp"
    ],
    galleryStoragePaths: [
      "products/main-42.webp",
      "products/gallery-42-a.webp",
      "products/gallery-42-b.webp"
    ],
    keywords: ["leather", "sneakers", "shoes"],
    highlights: ["Genuine leather", "Cushioned sole"],
    tags: ["leather", "sneakers"],
    trust: ["Authentic", "7-day returns"],
    specs: [["Material", "Leather"], ["Origin", "Rwanda"]],
    attributes: [
      {
        name: "Color",
        key: "color",
        axis: "color",
        type: "color",
        options: [
          {
            label: "Black",
            value: "black",
            image: "https://byosemarket.com/uploads/products/color-black.webp",
            stock: 4
          }
        ]
      },
      {
        name: "Size",
        key: "size",
        axis: "size",
        type: "size",
        options: [{ label: "42", value: "42", stock: 4 }]
      }
    ],
    variants: {
      enabled: true,
      mode: "color_size",
      colorVariants: [
        {
          id: "black",
          clientKey: "black",
          colorName: "Black",
          image: "https://byosemarket.com/uploads/products/color-black.webp",
          imageStoragePath: "products/color-black.webp",
          sizes: [{ size: "42", stock: 4 }, { size: "43", stock: 3 }]
        }
      ],
      items: [
        { colorName: "Black", colorId: "black", size: "42", stock: 4, image: "https://byosemarket.com/uploads/products/color-black.webp" },
        { colorName: "Black", colorId: "black", size: "43", stock: 3, image: "https://byosemarket.com/uploads/products/color-black.webp" }
      ]
    },
    metaTitle: "BYOSE | Leather Runner Sneakers | Shoes | BYOSE Market",
    metaDescription: "Premium leather sneakers for daily wear.",
    slug: "leather-runner-sneakers",
    costPrice: 22000,
    metadata: {
      shortName: "Leather Runner",
      brand: "BYOSE",
      sku: "SH-42-RUN",
      manufacturer: "Kigali Atelier",
      countryOfOrigin: "RW",
      productType: "variable",
      condition: "new",
      warranty: "6_months",
      highlights: ["Genuine leather", "Cushioned sole"],
      placement: ["featured_products", "new_arrivals"],
      positionMode: "top",
      priorityScore: 80,
      publishStatus: "active",
      originalPrice: 60000,
      costPrice: 22000,
      customSizes: ["42", "43"],
      inventoryAttributes: { material: "leather" },
      colorVariants: [
        {
          id: "black",
          clientKey: "black",
          colorName: "Black",
          image: "https://byosemarket.com/uploads/products/color-black.webp",
          imageStoragePath: "products/color-black.webp",
          sizes: [{ size: "42", stock: 4 }, { size: "43", stock: 3 }]
        }
      ]
    }
  };
}

function sampleCardProduct() {
  return {
    id: 42,
    catalogId: 42,
    name: "Leather Runner Sneakers",
    title: "Leather Runner",
    category: "shoes",
    price: 45000,
    oldPrice: 60000,
    stock: 7,
    mainImage: "https://byosemarket.com/uploads/products/main-42.webp",
    image: "https://byosemarket.com/uploads/products/main-42.webp",
    gallery: ["https://byosemarket.com/uploads/products/main-42.webp"],
    visibility: "both",
    status: "active",
    metadata: {
      placement: ["featured_products"],
      shortName: "Leather Runner"
    }
  };
}

const fullProduct = sampleFullProduct();
const hydrated = hydrateDraftFromProduct(fullProduct);

assert(hydrated.productId === "42", "hydrate stores the catalog product id");
assert(hydrated.info.name === "Leather Runner Sneakers", "hydrate restores product name");
assert(hydrated.info.shortName === "Leather Runner", "hydrate restores short name");
assert(hydrated.info.brand === "BYOSE", "hydrate restores brand");
assert(hydrated.info.category === "shoes", "hydrate restores category");
assert(hydrated.info.manufacturer === "Kigali Atelier", "hydrate restores manufacturer");
assert(hydrated.info.countryOfOrigin === "RW", "hydrate restores country of origin");
assert(hydrated.description.shortDescription.includes("Premium leather"), "hydrate restores short description");
assert(hydrated.description.longDescription.includes("Full grain leather"), "hydrate restores long description from array");
assert(String(hydrated.pricing.sellingPrice) === "45000", "hydrate restores selling price");
assert(String(hydrated.pricing.originalPrice) === "60000", "hydrate restores old/original price");
assert(String(hydrated.pricing.costPrice) === "22000", "hydrate restores cost price");
assert(hydrated.inventory.sku === "SH-42-RUN", "hydrate restores SKU");
assert(hydrated.inventory.variantsEnabled === true, "hydrate restores variants enabled");
assert(hydrated.inventory.colorVariants.length === 1, "hydrate restores color variants");
assert(hydrated.inventory.colorVariants[0].sizes.length === 2, "hydrate restores size rows");
assert(hydrated.media.mainImage.includes("main-42.webp"), "hydrate restores main image");
assert(!hydrated.media.mainImage.includes("/cards/"), "hydrate uses the original image instead of the card thumbnail");
assert(hydrated.media.gallery.length === 2, "hydrate keeps extra gallery images and drops duplicated main image");
assert(hydrated.media.gallery.some((entry) => entry.includes("gallery-42-a.webp")), "hydrate restores first extra gallery image");
assert(hydrated.media.gallery.some((entry) => entry.includes("gallery-42-b.webp")), "hydrate restores second extra gallery image");
assert(hydrated.info.placement.includes("featured_products"), "hydrate restores placement");
assert(hydrated.info.highlights.includes("Genuine leather"), "hydrate restores highlights");

const roundTrip = buildProductPayload(hydrated);
assert(roundTrip.name === fullProduct.name, "payload keeps name after hydrate");
assert(roundTrip.price === 45000, "payload keeps selling price after hydrate");
assert(roundTrip.oldPrice === 60000, "payload keeps original price after hydrate");
assert(roundTrip.mainImage.includes("main-42.webp"), "payload keeps main image after hydrate");
assert(!String(roundTrip.mainImage).includes("/cards/"), "payload does not persist card thumbnail as the product image");
assert(roundTrip.gallery.every((entry) => !String(entry).includes("/cards/")), "payload gallery does not include card thumbnails");
assert(roundTrip.gallery.some((entry) => entry.includes("gallery-42-a.webp")), "payload keeps extra gallery images");
assert(roundTrip.gallery.some((entry) => entry.includes("gallery-42-b.webp")), "payload keeps second extra gallery image");
assert(roundTrip.description.includes("Full grain leather"), "payload keeps long description");
assert(roundTrip.shortDescription.includes("Premium leather"), "payload keeps short description");
assert(roundTrip.brand === "BYOSE", "payload keeps brand");
assert(roundTrip.sku === "SH-42-RUN", "payload keeps SKU");
assert(roundTrip.stock === 7, "payload keeps total stock from color sizes");
assert(Array.isArray(roundTrip.metadata.colorVariants) && roundTrip.metadata.colorVariants.length === 1, "payload keeps color variants in metadata");
assert(roundTrip.metadata.colorVariants[0].image.includes("color-black.webp"), "payload keeps color variant image");
assert(roundTrip.category === "shoes", "payload keeps category");

const priceOnlyDraft = JSON.parse(JSON.stringify(hydrated));
priceOnlyDraft.pricing.sellingPrice = "47000";
const priceOnlyPayload = buildProductPayload(priceOnlyDraft);
assert(priceOnlyPayload.price === 47000, "changing only price updates price");
assert(priceOnlyPayload.oldPrice === 60000, "changing only price keeps original price");
assert(priceOnlyPayload.mainImage === roundTrip.mainImage, "changing only price keeps main image");
assert(JSON.stringify(priceOnlyPayload.gallery) === JSON.stringify(roundTrip.gallery), "changing only price keeps gallery");
assert(priceOnlyPayload.description === roundTrip.description, "changing only price keeps description");
assert(priceOnlyPayload.shortDescription === roundTrip.shortDescription, "changing only price keeps short description");
assert(priceOnlyPayload.category === roundTrip.category, "changing only price keeps category");
assert(priceOnlyPayload.brand === roundTrip.brand, "changing only price keeps brand");
assert(priceOnlyPayload.stock === roundTrip.stock, "changing only price keeps stock");
assert(JSON.stringify(priceOnlyPayload.metadata.colorVariants) === JSON.stringify(roundTrip.metadata.colorVariants), "changing only price keeps color/size inventory");
assert(priceOnlyPayload.sku === roundTrip.sku, "changing only price keeps SKU");
assert(Number(priceOnlyPayload.catalogId) === 42, "price-only save keeps the original catalog id");
assert(Number(roundTrip.catalogId) === 42, "edit payload targets the original catalog id");

const stockOnlyDraft = JSON.parse(JSON.stringify(hydrated));
stockOnlyDraft.inventory.quantity = "5";
if (Array.isArray(stockOnlyDraft.inventory.colorVariants) && stockOnlyDraft.inventory.colorVariants[0]?.sizes?.[0]) {
  stockOnlyDraft.inventory.colorVariants[0].sizes[0].stock = "5";
  if (stockOnlyDraft.inventory.colorVariants[0].sizes[1]) {
    stockOnlyDraft.inventory.colorVariants[0].sizes[1].stock = "0";
  }
}
const stockOnlyPayload = buildProductPayload(stockOnlyDraft);
assert(stockOnlyPayload.stock === 5, "changing only stock updates stock");
assert(stockOnlyPayload.mainImage === roundTrip.mainImage, "changing only stock keeps main image");
assert(JSON.stringify(stockOnlyPayload.gallery) === JSON.stringify(roundTrip.gallery), "changing only stock keeps gallery");
assert(stockOnlyPayload.price === roundTrip.price, "changing only stock keeps price");
assert(stockOnlyPayload.description === roundTrip.description, "changing only stock keeps description");
assert(stockOnlyPayload.category === roundTrip.category, "changing only stock keeps category");

const walked = sanitizeDraft(sanitizeDraft(hydrated));
assert(walked.info.name === hydrated.info.name, "next/back sanitizing keeps product name");
assert(walked.description.longDescription === hydrated.description.longDescription, "next/back sanitizing keeps long description");
assert(walked.media.gallery.length === hydrated.media.gallery.length, "next/back sanitizing keeps gallery images");
assert(walked.inventory.colorVariants.length === hydrated.inventory.colorVariants.length, "next/back sanitizing keeps color variants");
assert(walked.pricing.sellingPrice === hydrated.pricing.sellingPrice, "next/back sanitizing keeps price");
assert(walked.productId === "42", "next/back sanitizing keeps product id");

const descriptionOnlyDraft = JSON.parse(JSON.stringify(hydrated));
descriptionOnlyDraft.description.longDescription = "Updated long description only.";
descriptionOnlyDraft.description.description = "Updated long description only.";
const descriptionOnlyPayload = buildProductPayload(descriptionOnlyDraft);
assert(descriptionOnlyPayload.description === "Updated long description only.", "changing only description updates description");
assert(descriptionOnlyPayload.price === roundTrip.price, "changing only description keeps price");
assert(JSON.stringify(descriptionOnlyPayload.gallery) === JSON.stringify(roundTrip.gallery), "changing only description keeps gallery");
assert(descriptionOnlyPayload.stock === roundTrip.stock, "changing only description keeps stock");
assert(JSON.stringify(descriptionOnlyPayload.metadata.colorVariants) === JSON.stringify(roundTrip.metadata.colorVariants), "changing only description keeps colors/sizes");

const sizeOnlyDraft = JSON.parse(JSON.stringify(hydrated));
if (sizeOnlyDraft.inventory.colorVariants[0]) {
  sizeOnlyDraft.inventory.colorVariants[0].sizes = [
    { size: "40", stock: "2" },
    { size: "41", stock: "3" },
    { size: "42", stock: "2" }
  ];
}
const sizeOnlyPayload = buildProductPayload(sizeOnlyDraft);
assert(sizeOnlyPayload.metadata.colorVariants[0].sizes.some((row) => row.size === "40"), "changing only size updates sizes");
assert(sizeOnlyPayload.mainImage === roundTrip.mainImage, "changing only size keeps main image");
assert(JSON.stringify(sizeOnlyPayload.gallery) === JSON.stringify(roundTrip.gallery), "changing only size keeps gallery");
assert(sizeOnlyPayload.price === roundTrip.price, "changing only size keeps price");
assert(sizeOnlyPayload.description === roundTrip.description, "changing only size keeps description");

const multiFieldDraft = JSON.parse(JSON.stringify(hydrated));
multiFieldDraft.pricing.sellingPrice = "48000";
multiFieldDraft.inventory.quantity = "9";
if (multiFieldDraft.inventory.colorVariants[0]?.sizes?.[0]) {
  multiFieldDraft.inventory.colorVariants[0].sizes[0].stock = "5";
  if (multiFieldDraft.inventory.colorVariants[0].sizes[1]) {
    multiFieldDraft.inventory.colorVariants[0].sizes[1].stock = "4";
  }
}
multiFieldDraft.description.longDescription = "Updated description with price and stock.";
multiFieldDraft.description.description = "Updated description with price and stock.";
const multiFieldPayload = buildProductPayload(multiFieldDraft);
assert(multiFieldPayload.price === 48000, "changing price+stock+description updates price");
assert(multiFieldPayload.stock === 9, "changing price+stock+description updates stock");
assert(multiFieldPayload.description === "Updated description with price and stock.", "changing price+stock+description updates description");
assert(multiFieldPayload.mainImage === roundTrip.mainImage, "changing price+stock+description keeps main image");
assert(JSON.stringify(multiFieldPayload.gallery) === JSON.stringify(roundTrip.gallery), "changing price+stock+description keeps gallery");

const addImageDraft = JSON.parse(JSON.stringify(hydrated));
addImageDraft.media.gallery = [
  ...addImageDraft.media.gallery,
  "https://byosemarket.com/uploads/products/gallery-42-c.webp"
];
addImageDraft.media.galleryStoragePaths = [
  ...addImageDraft.media.galleryStoragePaths,
  "products/gallery-42-c.webp"
];
const addImagePayload = buildProductPayload(addImageDraft);
assert(addImagePayload.gallery.some((entry) => entry.includes("gallery-42-a.webp")), "adding one image keeps first existing gallery image");
assert(addImagePayload.gallery.some((entry) => entry.includes("gallery-42-b.webp")), "adding one image keeps second existing gallery image");
assert(addImagePayload.gallery.some((entry) => entry.includes("gallery-42-c.webp")), "adding one image appends the new gallery image");
assert(addImagePayload.mainImage === roundTrip.mainImage, "adding one image keeps the main image");
assert(addImagePayload.gallery.filter((entry) => entry.includes("gallery-42-a.webp")).length === 1, "adding one image does not duplicate existing images");

const removeImageDraft = JSON.parse(JSON.stringify(hydrated));
removeImageDraft.media.gallery = removeImageDraft.media.gallery.filter((entry) => !entry.includes("gallery-42-a.webp"));
removeImageDraft.media.galleryStoragePaths = removeImageDraft.media.galleryStoragePaths.filter((entry) => !entry.includes("gallery-42-a.webp"));
const removeImagePayload = buildProductPayload(removeImageDraft);
assert(!removeImagePayload.gallery.some((entry) => entry.includes("gallery-42-a.webp")), "removing one image drops only that image");
assert(removeImagePayload.gallery.some((entry) => entry.includes("gallery-42-b.webp")), "removing one image keeps the remaining gallery image");
assert(removeImagePayload.mainImage === roundTrip.mainImage, "removing one gallery image keeps the main image");
assert(removeImagePayload.price === roundTrip.price, "removing one image keeps price");

const cardHydrated = hydrateDraftFromProduct(sampleCardProduct());
assert(!cardHydrated.description.longDescription.includes("Full grain leather"), "card list records do not contain full description (must not be used for edit)");
assert(cardHydrated.media.gallery.length === 0, "card list records do not contain extra gallery images (must not be used for edit)");
assert(cardHydrated.inventory.colorVariants.length === 0, "card list records do not contain color variants (must not be used for edit)");

const freshCreate = createDefaultDraft();
assert(!freshCreate.productId, "new product draft starts without a product id");
assert(!freshCreate.media.mainImage, "new product draft does not inherit previous images");

const cardOnlyHydrated = hydrateDraftFromProduct({
  ...fullProduct,
  mainImage: fullProduct.cardImage,
  image: fullProduct.cardImage,
  originalImage: fullProduct.cardImage,
  thumbnail: fullProduct.cardImage
});
assert(cardOnlyHydrated.media.mainImage.includes("main-42.webp") && !cardOnlyHydrated.media.mainImage.includes("/cards/"), "hydrate recovers original image when API mainImage is a card thumbnail");
assert(cardOnlyHydrated.media.gallery.length === 2, "hydrate still restores extra gallery images when mainImage is a card thumbnail");
assert(!cardOnlyHydrated.media.gallery.some((entry) => String(entry).includes("/cards/")), "hydrate gallery excludes card thumbnails");

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}

console.log("\n[verify-product-edit-preservation] All frontend hydrate/payload checks passed.");

const LIVE_API_URL = "https://byosemarket.com/api/products?limit=5";

async function verifyLiveEditRoundTrip() {
  console.log("\n=== Live API: Edit Product image preservation ===\n");
  let response;
  try {
    response = await fetch(LIVE_API_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    console.error(`FAIL: live product fetch failed: ${error.message}`);
    process.exit(1);
  }

  if (!response.ok) {
    console.error(`FAIL: live product fetch returned HTTP ${response.status}`);
    process.exit(1);
  }

  const payload = await response.json();
  const products = Array.isArray(payload?.products) ? payload.products : [];
  const listed = products.find((product) => Number(product?.id || product?.catalogId) > 0) || products[0];
  if (!listed) {
    console.error("FAIL: live API returned no products to verify");
    process.exit(1);
  }

  const liveId = listed.id || listed.catalogId;
  let liveProduct = listed;
  try {
    const detailResponse = await fetch(`https://byosemarket.com/api/products/${encodeURIComponent(String(liveId))}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000)
    });
    if (detailResponse.ok) {
      const detailPayload = await detailResponse.json();
      if (detailPayload?.product) {
        liveProduct = detailPayload.product;
      }
    }
  } catch (_error) {
    // Fall back to the list record if the detail endpoint is temporarily unavailable.
  }

  const liveHydrated = hydrateDraftFromProduct(liveProduct);
  assert(Boolean(liveHydrated.media.mainImage), `live product ${liveProduct.id} hydrates a main image`);
  assert(!String(liveHydrated.media.mainImage).includes("/cards/"), `live product ${liveProduct.id} hydrates the original image, not a card thumbnail`);
  assert(
    liveHydrated.media.gallery.length >= Math.max(0, (liveProduct.gallery || []).filter((entry) => !String(entry).includes("/cards/")).length - 1),
    `live product ${liveProduct.id} hydrates existing extra gallery images`
  );

  const stockOnlyLive = JSON.parse(JSON.stringify(liveHydrated));
  stockOnlyLive.inventory.quantity = String(Math.max(0, Number(stockOnlyLive.inventory.quantity || 0)));
  const livePayload = buildProductPayload(stockOnlyLive);
  assert(livePayload.mainImage === liveHydrated.media.mainImage, `live product ${liveProduct.id} stock-only payload keeps main image`);
  assert(JSON.stringify(livePayload.gallery) === JSON.stringify(buildProductPayload(liveHydrated).gallery), `live product ${liveProduct.id} stock-only payload keeps gallery`);
  assert(!String(livePayload.mainImage).includes("/cards/"), `live product ${liveProduct.id} payload does not persist a card thumbnail`);

  const imageUrl = liveHydrated.media.mainImage;
  if (/^https?:\/\//i.test(imageUrl)) {
    try {
      const imageResponse = await fetch(imageUrl, { method: "HEAD", signal: AbortSignal.timeout(10000) });
      assert(imageResponse.ok, `live product ${liveProduct.id} original image is reachable (${imageResponse.status}): ${imageUrl}`);
    } catch (error) {
      console.error(`FAIL: live product ${liveProduct.id} image HEAD failed: ${error.message}`);
      process.exit(1);
    }
  }
}

await verifyLiveEditRoundTrip();

if (failures) {
  console.error(`\n${failures} check(s) failed after live verification.`);
  process.exit(1);
}

console.log("\n[verify-product-edit-preservation] Live edit image preservation checks passed.");
