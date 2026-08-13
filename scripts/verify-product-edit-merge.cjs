/**
 * Backend merge preservation: omitted fields must survive product update normalization.
 * Run: node scripts/verify-product-edit-merge.cjs
 */

const {
  mergeProductUpdate,
  normalizePayload
} = require("../server/controllers/productcontroller");

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

const existing = {
  catalogId: 42,
  name: "Leather Runner Sneakers",
  title: "Leather Runner",
  description: "Full grain leather sneakers with cushioned sole.",
  shortDescription: "Premium leather sneakers for daily wear.",
  longDescription: ["Full grain leather sneakers with cushioned sole."],
  category: "shoes",
  brand: "BYOSE",
  price: 45000,
  oldPrice: 60000,
  stock: 7,
  sku: "SH-42-RUN",
  mainImage: "/uploads/products/main-42.webp",
  image: "/uploads/products/main-42.webp",
  gallery: [
    "/uploads/products/gallery-42-a.webp",
    "/uploads/products/gallery-42-b.webp"
  ],
  keywords: ["leather", "sneakers"],
  highlights: ["Genuine leather"],
  trust: ["Authentic", "7-day returns"],
  specs: [{ label: "Material", value: "Leather" }],
  attributes: [{ name: "Color", key: "color", options: [{ label: "Black", value: "black" }] }],
  variants: { enabled: true, colorVariants: [{ colorName: "Black" }] },
  visibility: "both",
  status: "active",
  metadata: {
    shortName: "Leather Runner",
    manufacturer: "Kigali Atelier",
    colorVariants: [{ colorName: "Black", image: "/uploads/products/color-black.webp" }]
  }
};

const priceOnlyBody = {
  name: existing.name,
  title: existing.title,
  price: 47000,
  oldPrice: 60000,
  description: existing.description,
  shortDescription: existing.shortDescription,
  category: existing.category,
  stock: 7,
  mainImage: existing.mainImage,
  gallery: existing.gallery,
  brand: existing.brand
};

const normalized = normalizePayload(priceOnlyBody);
const merged = mergeProductUpdate(existing, normalized, priceOnlyBody);

assert(merged.catalogId === 42, "update keeps the same catalog id");
assert(merged.price === 47000, "update applies the new price");
assert(merged.oldPrice === 60000, "update keeps original price");
assert(merged.mainImage === existing.mainImage, "update keeps main image");
assert(merged.gallery.length === 2, "update keeps extra gallery images");
assert(merged.description === existing.description, "update keeps description");
assert(merged.trust.length === 2, "update keeps trust fields omitted from the wizard payload");
assert(merged.specs.length === 1, "update keeps specs omitted from the wizard payload");
assert(merged.metadata.manufacturer === "Kigali Atelier", "update merges metadata instead of replacing it");
assert(merged.metadata.shortName === "Leather Runner", "update keeps short name in metadata");
assert(merged.title === "Leather Runner", "update does not overwrite title/short name with the full product name");
assert(merged.sku === "SH-42-RUN", "update keeps SKU when omitted from the body");

const emptyGalleryNormalized = normalizePayload({
  name: existing.name,
  price: 45000,
  gallery: []
});
assert(Array.isArray(emptyGalleryNormalized.gallery) && emptyGalleryNormalized.gallery.length === 0, "empty gallery payload is not filled with the main image");

const clearedGallery = mergeProductUpdate(
  existing,
  emptyGalleryNormalized,
  { name: existing.name, price: 45000, gallery: [] }
);
assert(clearedGallery.gallery.length === 2, "empty gallery without a main image does not wipe existing extras");
assert(clearedGallery.mainImage === existing.mainImage, "empty gallery without a main image keeps the existing main image");
assert(clearedGallery.catalogId === 42, "empty gallery without a main image does not change the catalog id");

const intentionalExtrasClear = mergeProductUpdate(
  existing,
  normalizePayload({
    name: existing.name,
    price: 45000,
    mainImage: existing.mainImage,
    gallery: []
  }),
  { name: existing.name, price: 45000, mainImage: existing.mainImage, gallery: [] }
);
assert(intentionalExtrasClear.gallery.length === 0, "explicit empty gallery with a real main image clears extras only");
assert(intentionalExtrasClear.mainImage === existing.mainImage, "explicit extras clear keeps the main image");

const emptyGalleryBody = {
  name: existing.name,
  price: 45000
};
const incompleteNormalized = normalizePayload(emptyGalleryBody);
const preserved = mergeProductUpdate(existing, incompleteNormalized, emptyGalleryBody);
assert(preserved.gallery.length === 2, "incomplete payload without gallery does not wipe existing gallery images");
assert(preserved.mainImage === existing.mainImage, "incomplete payload without images does not wipe main image");
assert(preserved.trust.length === 2, "incomplete payload does not wipe trust");
assert(preserved.variants.enabled === true, "incomplete payload does not wipe variants");

const stockOnlyEmptyImages = mergeProductUpdate(
  existing,
  normalizePayload({
    name: existing.name,
    price: existing.price,
    stock: 5,
    mainImage: "",
    image: "",
    gallery: []
  }),
  {
    name: existing.name,
    price: existing.price,
    stock: 5,
    mainImage: "",
    image: "",
    gallery: []
  }
);
assert(stockOnlyEmptyImages.stock === 5, "stock-only update with empty image fields changes stock");
assert(stockOnlyEmptyImages.mainImage === existing.mainImage, "stock-only update with empty image fields keeps main image");
assert(stockOnlyEmptyImages.gallery.length === 2, "stock-only update with empty image fields keeps gallery");
assert(stockOnlyEmptyImages.price === existing.price, "stock-only update with empty image fields keeps price");

const logoOverwrite = mergeProductUpdate(
  existing,
  normalizePayload({
    name: existing.name,
    price: existing.price,
    stock: 9,
    mainImage: "https://byosemarket.com/img/logo.png",
    image: "../img/logo.png",
    gallery: []
  }),
  {
    name: existing.name,
    price: existing.price,
    stock: 9,
    mainImage: "https://byosemarket.com/img/logo.png",
    image: "../img/logo.png",
    gallery: []
  }
);
assert(logoOverwrite.stock === 9, "logo payload still applies stock");
assert(logoOverwrite.mainImage === existing.mainImage, "company logo is not saved as the product image");
assert(logoOverwrite.gallery.length === 2, "company logo payload does not wipe gallery images");

const missingUpdate = mergeProductUpdate(
  { catalogId: 42, name: "Existing", price: 1000, gallery: ["/uploads/products/a.webp"] },
  require("../server/controllers/productcontroller").normalizePayload({ name: "Existing", price: 1000 }),
  { name: "Existing", price: 1000 }
);
assert(missingUpdate.catalogId === 42, "merged update never assigns a new catalog id");

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}

console.log("\n[verify-product-edit-merge] All backend merge checks passed.");
