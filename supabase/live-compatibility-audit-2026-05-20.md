# Supabase Live Compatibility Audit

Date: 2026-05-20
Project: Byose Market
Live Supabase project: https://myxiomacezwqkybaxwhz.supabase.co
Scope: frontend, backend, admin, add-product flow, product details, auth, cart, orders, customers, dashboard, uploads, realtime, storefront rendering, messages, activity, analytics, visits, image rendering, product listing, filters, search, sorting, and detail pages.

## Method

This audit compared:
- Live Supabase REST and Storage behavior using the publishable key configured in the repo.
- Runtime code expectations in the browser services, backend services, admin data layer, and account/order flows.
- Checked-in bootstrap schema in supabase/setup.sql.

The live project was probed non-destructively for reads, explicit-column availability, storage bucket visibility, and storage write behavior. Existing production write failures from the current session were reused where they already established the behavior safely.

## A. What Already Works Correctly

- Browser-side product reads are wired to Supabase and are actively used by the storefront and detail pages through services/productService.js.
- Product realtime wiring exists in services/productService.js and admin/app/services/admin-data.service.js. The app expects postgres_changes on public.products.
- The backend Render entrypoint and CORS configuration are aligned with server/server.js and render.yaml.
- Backend auth, admin session handling, orders, messages, activity, dashboards, and most operational data are still backed by MongoDB, so those flows do not currently depend on Supabase for core production behavior.
- Live Supabase currently exposes these existing tables: public.products, public.users, public.orders, public.visits, and public.order_items.
- Live Supabase Storage API is reachable, even though the required bucket configuration is still missing.

## B. What Is Broken

### Active production blockers

1. Admin product creation is still blocked.
- Direct product inserts with numeric priority no longer fail on integer casting.
- The current live failure is row-level security rejection on public.products.
- Browser uploads to Storage are blocked by policy.
- The required products bucket does not exist.

2. The live products table does not match the code.
- Missing columns: name, badge, updated_at.
- Existing columns confirmed live: id, catalog_id, title, description, short_description, long_description, category, price, old_price, stock, image, main_image, gallery, keywords, highlights, trust, specs, attributes, variants, visibility, priority, order_index, highlight_tag, status, page, url, main_image_storage_path, gallery_storage_paths, extra_info, created_at.
- services/productService.js already contains a runtime workaround for missing name and updated_at, but badge is still expected by normalization and storefront rendering.

3. Multiple Supabase-backed helper services cannot work against the live project.
- public.cart_items is missing.
- public.visitors is missing.
- public.product_reviews is missing.
- Live public.users, public.orders, and public.visits are missing many fields expected by services/userService.js and services/orderService.js.

### Schema mismatches by table

#### products
Expected by code:
- id, catalog_id, name, title, description, short_description, long_description, badge, category, price, old_price, stock, image, main_image, gallery, keywords, highlights, trust, specs, attributes, variants, visibility, priority, order_index, highlight_tag, status, page, url, main_image_storage_path, gallery_storage_paths, extra_info, created_at, updated_at

Confirmed live missing:
- name
- badge
- updated_at

#### users
Expected by code or bootstrap:
- id, customer_code, name, email, phone, password_hash, avatar, role, status, verified, address, created_at, updated_at

Confirmed live existing:
- id, email, phone, address, created_at

Confirmed live missing:
- customer_code
- name
- password_hash
- avatar
- role
- status
- verified
- updated_at

#### orders
Expected by code or bootstrap:
- id, order_id, user_id, customer_id, customer_name, customer_email, customer_phone, status, order_status, payment_status, payment_status_label, payment_method, payment_type, note, subtotal, shipping_fee, delivery_fee, cod_fee, total, total_amount, total_price, delivery_method, delivery_label, items, products, shipping_address, full_address, gps_location, payment, customer, status_history, created_at, updated_at

Confirmed live existing:
- id, user_id, status, payment_method, total_price, created_at

Confirmed live missing:
- order_id
- customer_id
- customer_name
- customer_email
- customer_phone
- order_status
- payment_status
- payment_status_label
- payment_type
- note
- subtotal
- shipping_fee
- delivery_fee
- cod_fee
- total
- total_amount
- delivery_method
- delivery_label
- items
- products
- shipping_address
- full_address
- gps_location
- payment
- customer
- status_history
- updated_at

#### visits
Expected by bootstrap:
- id, client_activity_id, user_id, session_id, event_type, path, referrer, user_agent, device, ip, city, country, org, duration, meta, started_at, ended_at, created_at, updated_at

Confirmed live existing:
- id, device, country, created_at

Confirmed live missing:
- client_activity_id
- user_id
- session_id
- event_type
- path
- referrer
- user_agent
- ip
- city
- org
- duration
- meta
- started_at
- ended_at
- updated_at

#### Missing tables
- public.cart_items
- public.visitors
- public.product_reviews

#### Legacy live table not used by current browser code
- public.order_items exists live with id, order_id, product_id, quantity, price.
- Current browser/runtime code does not use this table.
- The table should either be documented as legacy or aligned intentionally.

## C. What Is Missing

### Database objects
- products.name
- products.badge
- products.updated_at
- users columns listed above
- orders columns listed above
- visits columns listed above
- cart_items table
- visitors table
- product_reviews table
- updated_at triggers for live tables missing updated_at
- production indexes for the actual query patterns in product, order, cart, visitor, and review services
- a consistent schema choice between visits and visitors

### Storage
- products bucket
- safe read policy for product images
- a secure upload path for admin product media

### Infrastructure and config
- SUPABASE_SERVICE_ROLE_KEY in Render
- a server-side mutation path for admin product writes and storage writes
- explicit publication enrollment for public.products in supabase_realtime

## D. What Is Unsafe

1. Live anon reads are currently allowed on sensitive tables.
- The publishable key can successfully select from public.users, public.orders, public.visits, and public.order_items.
- The tables are empty right now, but if production data is inserted, it will be exposed to any browser holding the public key.

2. The checked-in bootstrap file is not production-safe as written.
- supabase/setup.sql contains wide-open policies such as using (true) with check (true).
- If applied directly, those policies would allow unsafe public writes to products, users, orders, cart_items, visits, visitors, and product_reviews.

3. The current add-product flow is browser-write based.
- services/productService.js and services/uploadService.js attempt direct browser writes using the publishable key.
- That forces you into a choice between broken writes or unsafe public write policies.
- The production-safe answer is to move writes behind the backend with the service role key.

4. Hard-coded public key usage is acceptable but operationally brittle.
- The publishable key is public by design, but hard-coding it in config/supabase.js and server/config/supabase.js makes rotation harder.
- Runtime env-based configuration should be preferred.

## E. What Must Be Added

- Missing columns on products, users, orders, and visits.
- Missing tables cart_items, visitors, and product_reviews.
- products bucket.
- Safe indexes that match query patterns.
- updated_at trigger coverage.
- secure RLS policies.
- products table enrollment in supabase_realtime.
- SUPABASE_SERVICE_ROLE_KEY in Render.

## F. What Must Be Repaired

### High priority
- Repair the public.products schema.
- Create the products bucket.
- Replace direct browser admin writes and uploads with server-side service-role operations.
- Lock down public.users, public.orders, public.visits, and public.order_items from anon reads.

### Medium priority
- Align or remove dormant Supabase helper services for users, orders, cart, visitors, and reviews.
- Decide whether tracking lives in visits or visitors and keep only one canonical table.
- Align reviews if product detail pages should support Supabase-backed reviews.

### Low priority
- Remove the optional-column workaround after schema alignment is complete.
- Move the publishable URL/key to runtime configuration only.

## G. Exact SQL Migration Required

Use: supabase/live-compatibility-repair-2026-05-20.sql

That SQL file includes:
- schema alignment for existing tables
- creation of missing tables
- trigger/function repair
- index creation
- safe RLS repair
- storage bucket creation
- storage policy repair
- realtime publication repair

## H. Exact Supabase Dashboard Actions Required

1. In Project Settings -> API
- Verify the project URL matches the repo config.
- Rotate the publishable key after the migration if you want to stop relying on the checked-in key.

2. In Storage
- Confirm the products bucket exists after migration.
- Confirm the bucket is public for reads only.
- Do not add public write policies for anon uploads.

3. In Database -> Replication / Realtime
- Confirm public.products is included in supabase_realtime.
- Do not enable realtime broadly for sensitive tables unless there is a real subscriber.

4. In Auth
- This project is not using Supabase Auth for storefront/admin login.
- Disable unused providers and anonymous signup if they are enabled.
- Do not treat Supabase Auth as the source of truth until the app is explicitly migrated to it.

5. In Render environment variables
- Add SUPABASE_SERVICE_ROLE_KEY.
- Keep SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY aligned with the live project.

## I. Exact Storage Actions Required

- Create or update the products bucket as public read.
- Keep public read access for image rendering.
- Remove any public insert, update, or delete policies on storage.objects for the products bucket.
- Route admin uploads through backend/service-role or signed upload URLs.

## J. Exact Policy Fixes Required

- Allow public select on products only.
- Prefer products select to published records only, for example status in ('active', 'published').
- Deny anon select/write on users, orders, visits, visitors, cart_items, and order_items.
- Deny anon writes on product_reviews unless you intentionally want unauthenticated review posting.
- Do not restore the old using (true) with check (true) policies.

## K. Exact Code Fixes Still Required

1. Move admin product writes off the browser publishable key path.
- Current write path: services/productService.js and services/uploadService.js.
- Required repair: create backend endpoints that use getServiceRoleSupabaseClient() and call them from admin/app/pages/products.js.

2. Stop treating browser Supabase order/user/cart helpers as production-ready.
- services/userService.js expects users, cart_items, and visitors tables that do not exist or do not match live schema.
- services/orderService.js expects orders and product_reviews schemas that do not match live schema.
- Either retire these helpers or fully align schema plus secure access model before activating them.

3. Unify visit tracking.
- The repo bootstrap wants visits and visitors.
- Current user service writes visitors.
- Live project has visits only.
- Pick one canonical table and remove the other code path.

4. Remove schema-probe dependence after alignment.
- services/productService.js currently probes optional columns name and updated_at at runtime.
- Once the schema is fixed, this defensive path should no longer be necessary.

5. Consider switching product media uploads to signed URLs if admin uploads must stay browser initiated.
- That preserves security without public write policies.

## Performance Audit

### Current risks
- Product bootstrap SQL lacks a dedicated catalog_id index in the checked-in report path even though catalog_id is frequently used for lookups and updates.
- The storefront product service fetches full rows and then normalizes large JSON fields in the browser.
- Runtime schema probing on first product fetch adds avoidable latency.
- Browser-side image upload retries can amplify slow failures when storage is not configured.

### Required indexes
- products(catalog_id) unique
- products(status, order_index desc, created_at desc)
- products(category, visibility, status, created_at desc)
- orders(order_id) unique
- orders(user_id, created_at desc)
- cart_items(user_id, updated_at desc)
- visits(created_at desc)
- visitors(session_id, created_at desc)
- product_reviews(product_catalog_id, created_at desc)

## Production Readiness Verdict

Not safe to deploy as a Supabase-backed production system yet.

Reason:
- product writes are blocked
- storage is not configured
- live schema is materially different from code expectations
- sensitive tables are publicly readable
- secure server-side mutation wiring is incomplete

## Final Production Readiness Checklist

### Before GitHub push
- Apply the migration SQL in a staging or backup-aware workflow.
- Replace any copied unsafe policies from the current supabase/setup.sql with the secure policy set.
- Implement backend service-role product mutations and media uploads.
- Decide whether users/orders/cart/reviews should truly live in Supabase or remain Mongo-only.
- Remove or quarantine dormant Supabase service modules if they are not being shipped.

### Before Render deploy
- Add SUPABASE_SERVICE_ROLE_KEY.
- Verify CORS_ORIGINS still includes the live storefront origins.
- Verify the backend can reach both MongoDB and Supabase.
- Smoke test admin create product, update product, delete product, and image upload against the repaired backend path.

### Before production launch
- Confirm public.products reads work and product images render from Storage.
- Confirm anon cannot read users, orders, visits, or order_items.
- Confirm admin product writes succeed without public write policies.
- Confirm realtime refresh works for product changes.
- Confirm no Supabase browser helper still points at missing tables.
- Rotate the publishable key if you want to retire the currently checked-in key.
