## STEP 3E Product Visibility, Publishing, and Placement Report

### Scope Completed
- Added a dedicated merchandising foundation in `admin/app/pages/products/product-merchandising.js`.
- Extended product draft normalization so STEP 3E derives backend-compatible `visibility`, `priority`, `orderIndex`, `highlightTag`, and `status` from richer admin publishing state.
- Extended validation for scheduled publishing, hidden-state conflicts, featured placement advisories, and ordering-mode checks.
- Rebuilt the active Add Product route to include publishing workflow controls, visibility presets, Home/Shop surface toggles, featured treatment cards, and ordering foundation controls.
- Added STEP 3E styling for segmented visibility presets, surface toggles, and merchandising summary cards.
- Preserved storefront compatibility by continuing to serialize to the existing home/shop/backend fields.

### Architecture Notes
- `product-merchandising.js` is now the STEP 3E owner for publishing states, featured-tag mapping, surface visibility derivation, ordering mode, and future payload output.
- `product-draft.js` still owns the canonical nested draft, but now delegates merchandising normalization and payload derivation to the STEP 3E module.
- `product-validation.js` now validates the richer merchandising foundation without changing the backend schema contract.
- `admin/app/pages/products.js` remains the active admin shell route and now renders the professional publishing and placement UI directly inside the existing products workspace.

### Storefront Compatibility Preserved
- Home and shop compatibility still flows through the existing `visibility`, `priority`, `orderIndex`, and `highlightTag` fields used by `script.js`, `shop.js`, and the backend controller.
- `admin-data.service.js` now preserves `orderIndex` during normalization so admin-side validation and metrics can reason about placement more accurately.

### Validation Performed
- Diagnostics passed for:
  - `admin/app/pages/products/product-merchandising.js`
  - `admin/app/pages/products/product-draft.js`
  - `admin/app/pages/products/product-validation.js`
  - `admin/app/pages/products.js`
  - `admin/app/services/admin-data.service.js`
  - `admin/css/pages/products.css`
- Browser validation confirmed the STEP 3E route renders the new publishing and visibility sections on `#/products?view=create`.

### Validation Limits
- The local browser environment continued to return API `404` responses for admin/product endpoints, so catalog-backed data remained in fallback mode.
- During later interaction checks, the admin shell redirected back to login, which prevented a clean end-to-end browser automation pass for the visibility presets.
- No backend persistence or API submission was introduced in STEP 3E.

### Outcome
- STEP 3E now provides a dedicated enterprise visibility and publishing foundation inside the live admin Add Product workflow while remaining compatible with the current storefront rendering contract and deferred persistence strategy.