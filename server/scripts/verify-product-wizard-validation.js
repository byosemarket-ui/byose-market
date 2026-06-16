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

console.log("[verify-product-wizard-validation] All checks passed.");
