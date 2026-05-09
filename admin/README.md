# Admin Dashboard System

This directory contains the active admin dashboard frontend used by Byose Market.

## Current Status

- Active architecture: multi-page admin UI with centralized core/services/components/page scripts under `admin/js`.
- Legacy compatibility: top-level admin route files (for example `orders.html`) are redirect entry points to module pages.
- Auth guard: access protection is enforced through `admin/admin-login/js/admin-security.js`.
- API bridge: centralized requests are handled by `admin/js/core/api-client.js` and `admin/js/core/config.js`.

## Cleanup Baseline (2026-05-07)

- Removed dead placeholder scripts from active admin runtime.
- Archived unused component preview HTML and empty CSS placeholders to `archive-unused/admin-dashboard-cleanup-2026-05-07`.
- Fixed structural HTML rendering issues across active admin pages (missing opening header wrappers).

## Important Constraint

Backend models, authentication/business logic, and database integrations are intentionally preserved. This cleanup targets dashboard architecture only.
