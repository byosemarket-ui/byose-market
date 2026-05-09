# Admin Rebuild Foundation (Preparation)

## Target Professional Structure

Proposed structure for the next rebuild phase (not implemented fully in this cleanup):

admin/
  app/
    core/
      config.js
      api-client.js
      auth-guard.js
      event-bus.js
    layout/
      shell.js
      sidebar.js
      topbar.js
    domains/
      dashboard/
        dashboard.service.js
        dashboard.page.js
      orders/
        orders.service.js
        orders.page.js
      customers/
        customers.service.js
        customers.page.js
      products/
        products.service.js
        products.page.js
      messages/
        messages.service.js
        messages.page.js
      reviews/
        reviews.service.js
        reviews.page.js
      homepage/
        homepage.service.js
        homepage.page.js
      settings/
        settings.service.js
        settings.page.js
    shared/
      ui/
      utils/
      validators/
  pages/
    dashboard.html
    orders/index.html
    orders/details.html
    products/index.html
    products/create.html
    products/edit.html
    products/view.html
    customers/index.html
    customers/profile.html
    messages/index.html
    messages/details.html
    reviews/index.html
    reviews/details.html
    homepage/index.html
    categories/index.html
    settings/index.html
  legacy-entrypoints/
    (redirect-only compatibility pages)

## Route Policy

- Keep one canonical page per feature route.
- Keep backward-compatible redirects, but isolate them from active page implementation.
- Route guard runs before page boot and before service hydration.

## Data Policy

- API-first for all admin reads/writes.
- Local storage only as explicit offline/cache adapter, never primary source.
- Domain services expose stable contracts:
  - `init`
  - `refresh`
  - `getState`
  - domain actions (`create/update/delete`)

## State Policy

- Each domain keeps internal state cache.
- Cross-domain updates emit events through one event bus.
- Page controllers subscribe/unsubscribe on lifecycle boundaries.

## Rendering Policy

- Shared shell/topbar/sidebar components initialized once per page.
- Domain pages own only domain-specific rendering blocks.
- Avoid giant single-line HTML payloads; preserve readable formatting.

## Stability Guardrails

- No orphan tags in route templates.
- No empty placeholder assets in active runtime directories.
- No duplicate runtime entry files with same domain names.

## Phase Checklist (After This Cleanup)

1. Create new `app/` folder and migrate one domain at a time.
2. Move redirects to `legacy-entrypoints/` while keeping behavior unchanged.
3. Convert one module (recommended: orders) to rebuilt domain pattern.
4. Add route smoke validation for all admin pages.
5. Remove remaining storage-first fallbacks where API is available.
