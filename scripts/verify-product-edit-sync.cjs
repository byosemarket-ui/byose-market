/**
 * STEP 3: Safe update / VPS path identity / catalog-id stability.
 * Run: node scripts/verify-product-edit-sync.cjs
 */

const {
  mergeProductUpdate,
  normalizePayload
} = require("../server/controllers/productcontroller");
const {
  collectProductManagedPaths,
  normalizeManagedPath
} = require("../server/services/uploadstorage.service");

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

function collectRemovedPaths(previousProduct, nextProduct) {
  const previousPaths = new Set(collectProductManagedPaths(previousProduct));
  const nextPaths = new Set(collectProductManagedPaths(nextProduct));
  return Array.from(previousPaths).filter((entry) => !nextPaths.has(entry));
}

const existing = {
  catalogId: 77,
  name: "Nike Shoes",
  title: "Nike Shoes",
  description: "Original description",
  shortDescription: "Original short description",
  category: "shoes",
  price: 30000,
  oldPrice: 35000,
  stock: 20,
  mainImage: "/uploads/products/nike-main.webp",
  image: "/uploads/products/nike-main.webp",
  gallery: [
    "/uploads/products/nike-1.webp",
    "/uploads/products/nike-2.webp",
    "/uploads/products/nike-3.webp",
    "/uploads/products/nike-4.webp"
  ],
  trust: ["Authentic"],
  specs: [{ label: "Origin", value: "Rwanda" }],
  attributes: [{ name: "Size", options: [{ label: "39" }, { label: "40" }, { label: "41" }, { label: "42" }] }],
  variants: { enabled: true, items: [{ size: "39" }, { size: "40" }] },
  metadata: {
    colorVariants: [
      { colorName: "Black", image: "/uploads/products/nike-black.webp" },
      { colorName: "White", image: "/uploads/products/nike-white.webp" }
    ]
  }
};

const priceOnlyBody = {
  name: "Nike Shoes",
  price: 35000,
  oldPrice: 35000,
  description: "Original description",
  shortDescription: "Original short description",
  category: "shoes",
  stock: 20,
  mainImage: "/uploads/products/nike-main.webp",
  gallery: existing.gallery
};

const priceMerged = mergeProductUpdate(existing, normalizePayload(priceOnlyBody), priceOnlyBody);
assert(priceMerged.catalogId === 77, "price-only update keeps the original catalog id");
assert(priceMerged.price === 35000, "price-only update changes price");
assert(priceMerged.name === "Nike Shoes", "price-only update keeps the name");
assert(priceMerged.description === "Original description", "price-only update keeps the description");
assert(priceMerged.category === "shoes", "price-only update keeps the category");
assert(priceMerged.stock === 20, "price-only update keeps stock");
assert(priceMerged.gallery.length === 4, "price-only update keeps extra gallery images");
assert(priceMerged.trust.length === 1, "price-only update keeps omitted trust fields");
assert(priceMerged.metadata.colorVariants.length === 2, "price-only update keeps color variant metadata");

const omittedImages = mergeProductUpdate(
  existing,
  normalizePayload({ name: "Nike Shoes", price: 35000 }),
  { name: "Nike Shoes", price: 35000 }
);
assert(omittedImages.gallery.length === 4, "omitted gallery does not wipe VPS image references");
assert(omittedImages.mainImage === existing.mainImage, "omitted images keep the main VPS path");

const stockOnlyEmpty = mergeProductUpdate(
  existing,
  normalizePayload({
    name: "Nike Shoes",
    price: 30000,
    stock: 25,
    mainImage: "",
    image: "",
    gallery: []
  }),
  {
    name: "Nike Shoes",
    price: 30000,
    stock: 25,
    mainImage: "",
    image: "",
    gallery: []
  }
);
assert(stockOnlyEmpty.stock === 25, "stock-only empty-image merge updates stock");
assert(stockOnlyEmpty.mainImage === existing.mainImage, "stock-only empty-image merge keeps main VPS path");
assert(stockOnlyEmpty.gallery.length === 4, "stock-only empty-image merge keeps extra VPS gallery paths");
assert(collectRemovedPaths(existing, stockOnlyEmpty).length === 0, "stock-only empty-image merge does not collect VPS files for deletion");

const relativePrevious = {
  mainImage: "/uploads/products/nike-main.webp",
  gallery: [
    "https://byosemarket.com/uploads/products/nike-1.webp",
    "/uploads/products/nike-2.webp"
  ],
  metadata: {
    colorVariants: [{ image: "/uploads/products/nike-black.webp" }]
  }
};
const absoluteNext = {
  mainImage: "https://byosemarket.com/uploads/products/nike-main.webp",
  gallery: [
    "/uploads/products/nike-1.webp",
    "products/nike-2.webp"
  ],
  metadata: {
    colorVariants: [{ image: "products/nike-black.webp" }]
  }
};
assert(
  normalizeManagedPath(relativePrevious.mainImage) === normalizeManagedPath(absoluteNext.mainImage),
  "public URL and VPS path normalize to the same managed file"
);
assert(
  collectRemovedPaths(relativePrevious, absoluteNext).length === 0,
  "price-only URL absolutizing does not delete existing VPS files"
);

const addedImageNext = {
  ...absoluteNext,
  gallery: [...absoluteNext.gallery, "/uploads/products/nike-5.webp"]
};
assert(
  collectRemovedPaths(relativePrevious, addedImageNext).length === 0,
  "adding one image does not delete existing VPS files"
);

const removedOne = {
  ...absoluteNext,
  gallery: ["/uploads/products/nike-1.webp"]
};
const removed = collectRemovedPaths(relativePrevious, removedOne);
assert(removed.includes("products/nike-2.webp"), "removing one image collects only that VPS file");
assert(!removed.includes("products/nike-main.webp"), "removing one extra image keeps the main VPS file");
assert(!removed.includes("products/nike-black.webp"), "removing one extra image keeps color variant files");

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}

console.log("\n[verify-product-edit-sync] All safe-update and VPS path checks passed.");
