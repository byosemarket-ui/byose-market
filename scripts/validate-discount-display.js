/**
 * End-to-end discount display validation.
 * Run: node scripts/validate-discount-display.js
 */

globalThis.window = globalThis.window || {
  localStorage: {
    getItem() {
      return null;
    },
    setItem() {}
  }
};

const failures = [];

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function assertIncludes(haystack, needle, message) {
  if (!String(haystack || "").includes(needle)) {
    failures.push(`${message} (missing "${needle}")`);
  }
}

function assertExcludes(haystack, needle, message) {
  if (String(haystack || "").includes(needle)) {
    failures.push(`${message} (unexpected "${needle}")`);
  }
}

const { computeProductDiscount } = await import("../admin/app/pages/products/pricing.js");
const {
  formatDiscountBadgeLabel,
  resolveProductDiscount,
  buildDiscountedProductView
} = await import("../js/storefront-discount.js");
const ProductCardSystem = (await import("../js/product-card-system.js")).default;

const adminSummary = computeProductDiscount({ originalPrice: "25000", sellingPrice: "20000" });
assert(adminSummary.hasDiscount === true, "Admin discount should be active for 25000 -> 20000");
assert(adminSummary.discountPercent === 20, "Admin discount percent should be 20");
assert(adminSummary.discountAmount === 5000, "Admin discount amount should be 5000");

const noDiscount = computeProductDiscount({ originalPrice: "20000", sellingPrice: "20000" });
assert(noDiscount.hasDiscount === false, "Equal prices should not create discount");
assert(noDiscount.discountPercent === 0, "Equal prices discount percent should be 0");

const storefrontDiscount = resolveProductDiscount({
  price: 20000,
  oldPrice: 25000,
  discountPercent: 20
});
assert(storefrontDiscount.hasDiscount === true, "Storefront resolver should detect discount");
assert(storefrontDiscount.discountPercent === 20, "Storefront resolver should keep stored percent");

const computedOnly = resolveProductDiscount({ price: 15000, oldPrice: 30000 });
assert(computedOnly.discountPercent === 50, "Storefront resolver should compute 50%");

assert(formatDiscountBadgeLabel(20) === "-20%", "Badge label should be -20%");
assert(formatDiscountBadgeLabel(0) === "", "Zero percent badge should be empty");

const discountedProduct = buildDiscountedProductView({
  id: 101,
  name: "Discounted Shoe",
  price: 20000,
  oldPrice: 25000,
  discountPercent: 20,
  mainImage: "img/logo.png"
});

const discountedCard = ProductCardSystem.renderCard(discountedProduct);
assertIncludes(discountedCard, "byose-product-badge--discount", "Discounted card should include badge class");
assertIncludes(discountedCard, "-20%", "Discounted card should show -20% badge");
assertIncludes(discountedCard, "byose-product-wishlist", "Card should include wishlist control");
assertIncludes(discountedCard, "byose-product-price", "Card should include selling price");
assertIncludes(discountedCard, "byose-product-old-price", "Discounted card should include old price");
assertIncludes(discountedCard, "RWF 20,000", "Card should format selling price");
assertIncludes(discountedCard, "RWF 25,000", "Card should format original price");

const regularProduct = buildDiscountedProductView({
  id: 102,
  name: "Regular Item",
  price: 20000,
  oldPrice: 0,
  discountPercent: 0,
  mainImage: "img/logo.png"
});

const regularCard = ProductCardSystem.renderCard(regularProduct);
assertExcludes(regularCard, "byose-product-badge--discount", "Regular card should not include discount badge");
assertExcludes(regularCard, "byose-product-old-price", "Regular card should not include old price");
assertIncludes(regularCard, "RWF 20,000", "Regular card should show selling price only");

const badgeIndex = discountedCard.indexOf("byose-product-badge--discount");
const wishlistIndex = discountedCard.indexOf("byose-product-wishlist");
assert(badgeIndex > 0 && wishlistIndex > badgeIndex, "Wishlist should render after discount badge in image wrapper");

if (failures.length) {
  console.error("Discount validation failed:");
  failures.forEach((entry) => console.error(`  - ${entry}`));
  process.exit(1);
}

console.log("Discount display validation passed.");
console.log(`  Admin formula: 25,000 -> 20,000 = ${adminSummary.discountPercent}% (${adminSummary.discountAmount} RWF off)`);
console.log("  Storefront cards: badge, pricing, and no-discount paths verified.");
