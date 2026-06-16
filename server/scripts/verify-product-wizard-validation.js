/**
 * Verifies Add Product wizard media validation honors pending uploads.
 * Run: node server/scripts/verify-product-wizard-validation.js
 */

import { validateStep, validateAllSteps } from "../../admin/app/pages/products/payload.js";
import { createDefaultDraft } from "../../admin/app/pages/products/draft.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const draft = createDefaultDraft();

assert(
  validateStep("media", draft).includes("Main product image is required."),
  "Empty draft should require main image on media step"
);

assert(
  !validateStep("media", draft, { hasPendingMainImage: true }).includes("Main product image is required."),
  "Pending main image option should satisfy media step validation"
);

assert(
  !validateAllSteps(draft, { hasPendingMainImage: true }).includes("Main product image is required."),
  "Pending main image option should satisfy full review validation"
);

assert(
  validateAllSteps(draft).includes("Main product image is required."),
  "Review validation without pending image should still require main image"
);

const draftWithPricing = {
  ...draft,
  pricing: {
    costPrice: "5000",
    sellingPrice: "12000",
    discountPrice: "15000",
    taxRate: "18",
    taxIncluded: true
  },
  inventory: {
    quantity: "10",
    stockStatus: "in_stock",
    variantsEnabled: true,
    sizes: ["42", "43", "44", "45"],
    colors: [{ name: "Black", hex: "#000000" }, { name: "Red", hex: "#ff0000" }]
  }
};

assert(
  Number(draftWithPricing.pricing.sellingPrice) === 12000,
  "Draft pricing should remain available for review payload generation"
);

assert(
  draftWithPricing.inventory.sizes.length === 4,
  "Draft sizes should remain available for review payload generation"
);

assert(
  draftWithPricing.inventory.colors.length === 2,
  "Draft colors should remain available for review payload generation"
);

console.log("[verify-product-wizard-validation] All checks passed.");
