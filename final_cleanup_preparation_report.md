# Final Cleanup Preparation Report

Date: 2026-05-09
Scope: Entire Byose Market ecommerce platform
Purpose: Dangerous-remnants detection, legacy cleanup preparation, and safe deletion planning

## Executive Summary

The platform is no longer dominated by browser-local ecommerce ownership, but it still contains a mixed architecture with active centralized systems plus several dangerous legacy remnants.

The current architecture is split into:

- a centralized backend and admin SPA for core ecommerce ownership
- a live storefront compatibility layer that still uses browser storage for cache, session mirroring, and some storefront/runtime configuration
- dormant or semi-dormant legacy admin/account modules that remain in the repo and increase cleanup risk

This report separates:

- active centralized systems to keep
- active but dangerous remnants to migrate before deletion
- dormant or duplicate systems that appear safe to remove in the next cleanup step

## Verified Active Centralized Architecture To Keep

These are active and should not be removed:

- `server/server.js`
- `server/routes/products.js`
- `server/routes/orders.js`
- `server/routes/cart.js`
- `server/routes/storefrontstate.js`
- `server/routes/auth.js`
- `server/routes/admin*.js`
- `server/routes/realtime.js`
- `server/models/*.js`
- `admin/dashboard.html`
- `admin/app/main.js`
- `admin/app/pages/*.js`
- `admin/app/services/admin-data.service.js` for core admin dashboard/product/order/customer analytics aggregation
- `services/authservice.js`
- `account/services/orderservice.js`
- `admin/js/services/catalog.service.js` because storefront pages still actively depend on it
- `details/js/product-content.js` because storefront UI imports it and it delegates to the live catalog service

## Dangerous Active Remnants

These are still active and create cleanup risk, mixed ownership, or browser-local behavior.

### 1. Browser-local admin/storefront config ownership

Files:

- `admin/app/services/admin-data.service.js`
- `shared/storage.js`
- `js/storefront-config.js`
- `admin/js/core/config.js`

Findings:

- The active admin SPA settings page still persists settings only to browser cache through `getSettings()` and `updateSettings()` in `admin/app/services/admin-data.service.js`.
- `shared/storage.js` auto-injects `js/storefront-config.js` into active storefront pages.
- `js/storefront-config.js` reads `byose_admin_settings_v1` and `byose_admin_homepage_v1` from localStorage and applies them to the storefront.
- This is a live mixed-ownership path where browser cache still influences site-wide storefront behavior.

Risk:

- browser/device-specific storefront configuration
- stale config after refresh or cross-device use
- frontend config overriding centralized expectations

Cleanup status:

- not safe to delete yet
- must be centralized or disabled in a controlled migration first

### 2. Active local user database remnants

Files:

- `storage.js`
- `login.html`
- `signup.html`
- `login.js`
- `signup.js`
- `account/services/userservice.js`
- `account/js/profile.js`
- `orders/utils.js`
- `admin/js/core/config.js`

Findings:

- `storage.js` is still actively loaded by `login.html` and `signup.html`.
- `storage.js` still manages `bm_users` and `byose_market_users`, effectively a browser-local user collection.
- `account/services/userservice.js` and `account/js/profile.js` still merge profile changes into local user lists.
- `orders/utils.js` and older admin config still retain awareness of these legacy user collections.

Risk:

- hidden browser-local account ownership
- stale profile/account data across devices
- conflicting account truth between API user profile and local user lists

Cleanup status:

- not safe to mass-delete yet because `storage.js` is still loaded by live auth pages
- safe target for migration and replacement in next cleanup phase

### 3. Shared storefront injection bridge

Files:

- `shared/storage.js`
- `account/shared/storage.js`

Findings:

- `shared/storage.js` dynamically appends `account/shared/storage.js`, `js/storefront-config.js`, and `js/tracker.js`.
- This is a global compatibility bridge and a source of hidden side effects across storefront pages.

Risk:

- implicit runtime behavior
- hard-to-trace ownership and loading order
- stale legacy helpers silently loaded into unrelated pages

Cleanup status:

- not safe to remove yet because many live pages load it
- should be broken apart and replaced with explicit imports before deletion

### 4. Demo/fallback account dashboard behavior

Files:

- `account/js/account.js`

Findings:

- account dashboard still contains hardcoded fallback user, default products, and default notifications.
- this is fake/demo residue rather than centralized account data.

Risk:

- misleading UI data
- fake state in production-facing account surfaces

Cleanup status:

- active but cleanup-safe after replacing with real data or empty states

### 5. Local-only contact persistence

Files:

- `contact.js`

Findings:

- contact submissions are still stored in browser localStorage through `saveContactMessage()`.

Risk:

- browser-isolated contact records
- no centralized visibility
- inconsistent support history

Cleanup status:

- not safe to ignore
- should be migrated to the backend or disabled before deletion of local persistence

### 6. Local visit cache still retained

Files:

- `js/tracker.js`

Findings:

- tracker now posts visits to the backend, but still keeps a local visit cache in `byose_market_visitors_v1`.

Risk:

- duplicate analytics persistence
- stale browser-owned activity records

Cleanup status:

- keep for now if needed as short-lived cache only
- candidate for slimming once server-side analytics proves sufficient

## Dormant / Duplicate Admin Stack

The repo still contains an older admin stack that appears largely dormant.

### Evidence

- active admin entry is `admin/dashboard.html` loading `admin/app/main.js`
- many old admin HTML pages only redirect to `dashboard.html#/...`
- no live admin HTML entry point was found loading the old `admin/js/pages/*` or most `admin/js/services/*`

### Legacy admin files likely dormant

Files:

- `admin/js/admin.js`
- `admin/js/pages/settings.page.js`
- `admin/js/pages/homepage.page.js`
- `admin/js/pages/dashboard.page.js`
- `admin/js/pages/categories-list.page.js`
- `admin/js/pages/category-form.page.js`
- `admin/js/pages/customers-list.page.js`
- `admin/js/pages/customer-profile.page.js`
- `admin/js/pages/media-library.page.js`
- `admin/js/pages/media-upload.page.js`
- `admin/js/pages/messages-list.page.js`
- `admin/js/pages/message-details.page.js`
- `admin/js/pages/order-details.page.js`
- `admin/js/pages/orders-list.page.js`
- `admin/js/pages/product-create.page.js`
- `admin/js/pages/product-edit.page.js`
- `admin/js/pages/product-view.page.js`
- `admin/js/pages/products-list.page.js`
- `admin/js/pages/review-details.page.js`
- `admin/js/pages/reviews-list.page.js`
- `admin/js/pages/settings.page.js`
- `admin/js/services/settings.service.js`
- `admin/js/services/homepage.service.js`
- `admin/js/services/dashboard.service.js`
- `admin/js/services/categories.service.js`
- `admin/js/services/customers.service.js`
- `admin/js/services/media.service.js`
- `admin/js/services/messages.service.js`
- `admin/js/services/orders.service.js`
- `admin/js/services/products.service.js`
- `admin/js/services/reviews.service.js`

Exception:

- `admin/js/services/catalog.service.js` is still active in storefront pages and is not safe to remove yet.

Cleanup status:

- high-confidence deletion candidates as a bundle, but only after one final reference check during the deletion step

## Dormant / Unsupported Account Services

### Likely unsupported or orphaned

Files:

- `account/services/notificationservice.js`
- `account/services/walletservice.js`

Findings:

- these client services reference `/api/notifications` and `/api/wallet`
- no matching server route registration was found in the active backend
- no live HTML entry point was found loading them

Risk:

- broken future integrations
- misleading architecture surface

Cleanup status:

- high-confidence deletion candidates

### Active account service to keep

- `account/services/orderservice.js`

Reason:

- it is actively loaded by account order pages and reads centralized order data from `/api/orders`

## Static / Placeholder Account Pages

Several account settings pages are mostly placeholder UI shells with comments about future integrations.

Files:

- `account/settings/address.html`
- `account/settings/preferences.html`
- `account/settings/profile.html`

Findings:

- these pages mostly reference legacy modules in comments rather than active script tags
- `account/settings/language.html` is an exception because it actively loads `../../storage.js`

Risk:

- confusion during cleanup because comments imply live integration when there is little or no runtime dependency

Cleanup status:

- not deletion targets by default
- comments and placeholder hooks are cleanup candidates

## Mixed Product Ownership Surfaces

Files:

- `admin/js/services/catalog.service.js`
- `js/products.js`
- `details/js/product-content.js`
- `index.html`
- `shop.html`
- `search.html`
- `details/product-details1.html`

Findings:

- storefront pages still load `admin/js/services/catalog.service.js`
- `js/products.js` includes a static bootstrap array but then syncs from the live catalog service
- `details/js/product-content.js` exports static-seeming product content, but its public accessors delegate to the live catalog service

Risk:

- confusing duplicate product definitions in source
- maintenance pollution
- future divergence if developers edit static arrays instead of centralized catalog flow

Cleanup status:

- not safe to delete yet because these files are actively wired
- good candidates for internal simplification after confirming presentation metadata needs

## Archive / Safe Removal Candidates

### Safe remove now

- `archive-unused/`

Reason:

- explicitly archived path
- not part of runtime entry points found in this scan

### Safe remove with high confidence in next cleanup step

- `account/services/notificationservice.js`
- `account/services/walletservice.js`
- dormant old admin bundle under `admin/js/pages/` except keep any shared file proven live at deletion time
- dormant old admin services under `admin/js/services/` except `catalog.service.js`
- `admin/js/admin.js`

### Migrate first, then delete or slim

- `storage.js`
- `shared/storage.js`
- `account/shared/storage.js`
- `js/storefront-config.js`
- `account/services/userservice.js`
- `account/js/profile.js`
- `account/js/account.js`
- `contact.js`
- `js/tracker.js`

These are active and cannot be deleted safely without migration because they still affect live runtime behavior.

## Architecture Pollution Summary

The main remaining pollution patterns are:

1. mixed ownership between backend truth and browser-local config/account layers
2. duplicate admin architecture: modern SPA plus dormant legacy admin bundle
3. hidden side-effect loading through `shared/storage.js`
4. orphaned client services with no active backend support
5. fake/demo fallback content on real account surfaces

## Recommended Cleanup Sequence

### Phase 1: Safe deletion

- remove `archive-unused/`
- remove orphaned account services: `notificationservice.js`, `walletservice.js`
- remove dormant old admin page/service bundle except `catalog.service.js`

### Phase 2: Migration before deletion

- replace `storage.js` on login/signup with API/session-only compatibility helpers
- remove `bm_users` / `byose_market_users` ownership from active account flows
- centralize admin settings/homepage config instead of local browser cache
- stop `shared/storage.js` from auto-injecting storefront config and tracker side effects

### Phase 3: Stabilization cleanup

- remove demo/default account products and notifications
- move contact submissions to backend or disable local persistence
- reduce tracker local cache to transient telemetry only or remove it
- simplify static storefront product modules once catalog-backed rendering is fully explicit

## Final Professional Assessment

The platform is clearly converging toward one centralized ecommerce architecture, but it is not yet clean.

The most dangerous remnants are no longer the core orders/products/customers/admin APIs. The main remaining pollution is now in:

- browser-local config ownership
- legacy local account/user storage
- side-effect script loaders
- dormant duplicate admin code
- orphaned client services
- fake/demo account fallbacks

The platform is ready for an aggressive safe cleanup step next, provided that cleanup preserves:

- backend routes and models
- `services/authservice.js`
- `account/services/orderservice.js`
- `admin/app/*`
- `server/*`
- `admin/js/services/catalog.service.js` until storefront catalog loading is explicitly migrated
