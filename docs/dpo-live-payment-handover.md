# BYOSE Market DPO LIVE payment handover

Internal operations guide for the production DPO LIVE checkout. Do not put Company Token, encryption keys, card data, PINs, or OTPs in this document.

## 1. Production LIVE configuration

| Item | Value |
|---|---|
| Provider | DPO Pay |
| Mode | LIVE only |
| LIVE Service Type | `112815` |
| LIVE API | `https://secure.3gdirectpay.com/API/v6/` |
| LIVE payment URL | `https://secure.3gdirectpay.com/payv3.php?ID=token` |
| Company Token | Encrypted server-side. Never in Git, frontend, URLs, or logs. |

Customer checkout never falls back to TEST. If LIVE is incomplete or unavailable, online payment fails safely and Cash on Delivery remains available.

Source of truth: **Admin → Payment Management** (encrypted credential store + operating flags). Runtime resolver: `server/payments/dpo/config.js`.

## 2. Customer payment methods

Enabled customer methods:

- MTN MoMo (DPO hosted mobile money, `DefaultPayment=MO`)
- Card (DPO hosted card page, `DefaultPayment=CC`)
- Cash on Delivery (no DPO)

Do not reintroduce Airtel Money, Bank Transfer, a duplicate “DPO Pay” option, TEST, or Sandbox.

## 3. Order / payment data contract

One purchase uses one BYOSE Market order record. Payment state lives on that order (`payment_json` plus payment/order status columns). There is no separate payments table.

| Field | Meaning |
|---|---|
| Order ID | BYOSE Market order identifier (also used as DPO company reference) |
| Customer | Name, phone, email, shipping address |
| Product / variant / qty / price | Catalog-priced line items |
| Delivery | Configured delivery fee (default **2,000 RWF**) |
| Total | Product total − coupon + delivery. This is the amount sent to DPO. |
| Payment method | `mtn` / `card` / `cod` with customer labels MTN MoMo / Card / Cash on Delivery |
| Payment status | `awaiting_payment`, `awaiting_delivery_payment` (COD), `paid`, `failed`, `cancelled` (pending stays `awaiting_payment`) |
| Order status | Separate from payment. Verified online PAID → `processing`. COD stays pending. |
| DPO reference | Safe merchant reference (`transRef`). Full transToken is not returned to customers. |
| Mode | `live` for online DPO; empty / non-DPO for COD |
| Timestamp | Order created/updated and gateway `verifiedAt` |

Public confirmation: `GET /api/orders/confirmation/:id`.

A missing or unknown order ID correctly returns HTTP **404** with `{ "success": false, "message": "Order not found" }`. That is not a missing route. An unauthenticated Admin payment request correctly returns HTTP **401**.

### Status pairing

| Outcome | Payment | Order |
|---|---|---|
| Online verified success | PAID | PROCESSING |
| Online failed | FAILED | unpaid (`awaiting_payment`) |
| Online cancelled | CANCELLED | unpaid |
| Online still processing / verify timeout | PENDING / `awaiting_payment` | unpaid |
| Cash on Delivery | UNPAID / `awaiting_delivery_payment` | PENDING |

`authorized` is not PAID.

## 4. How payment verification works

1. Customer selects MTN MoMo or Card and submits payment.
2. Backend validates the stored order (identity, method, catalog amount, delivery, currency).
3. Backend creates a DPO LIVE token and redirects to the hosted payment page.
4. Customer return, back URL, and callback are **not** proof of payment.
5. Backend calls DPO `verifyToken`, binds the result to the stored order/token/amount, then updates payment and order status together.
6. Success page calls `POST /api/payments/dpo/verify` and only then shows Payment Successful.

COD never calls DPO. Place Order creates the order and shows success immediately.

## 5. Cart and Buy Now

- Cart checkout purchases cart lines only.
- Buy Now (`direct`) is isolated and must not purchase leftover cart items.
- Online: clear purchased cart lines only after verified PAID.
- Failed / cancelled / pending: do not clear the cart.
- COD: clear purchased lines after the COD order is created.

## 6. Admin Payment Management

Path: Admin → Payment Management.

Confirm:

- Operating Mode: LIVE
- LIVE credentials: Stored (masked hint only)
- LIVE configuration: Ready
- LIVE checkout: Active
- LIVE Service Type: 112815
- Provider: Enabled
- Online payments: Enabled
- Encryption: Ready

Payment Activity is generated from database LIVE gateway records. Historical TEST records stay TEST and are excluded from LIVE operational activity (`server/payments/dpo/test-history.classifier.js`). Do not rewrite TEST history as LIVE. Archive with `scripts/migrate-dpo-test-history.js` only when the business explicitly requests it.

## 7. Safe operating procedure

1. Admin → Payment Management
2. Verify LIVE, credentials stored, configuration ready, online payments enabled
3. If a credential is missing:
   - **Do not switch to TEST**
   - Temporarily disable online payments
   - Restore the official LIVE Company Token and Service Type `112815`
   - Save and verify Encryption Ready / LIVE configuration Ready
   - Enable online payments
4. Customers can use Cash on Delivery while online payment is disabled

## 8. How to disable online payments safely

Admin → Payment Management → turn **Enable online payments** off → Save.

Checkout then shows online payment as unavailable. COD remains available. Do not change Service Type to `54841`. Do not copy the TEST Company Token into LIVE.

## 9. Troubleshooting payment failures

| Symptom | What to check |
|---|---|
| Customer returned but Success does not show PAID | Backend verify is still pending/failed. Do not mark PAID in Admin by hand. |
| “Online payment is temporarily unavailable” | LIVE credentials, encryption key, Service Type 112815, online payments enabled |
| Amount mismatch | Catalog price + 2,000 RWF delivery vs stored order total. Client totals are ignored. |
| Duplicate Pay clicks | Same order is reused; initiate is locked. Do not create a second order. |
| COD order has a DPO reference | Defect. COD must not call DPO. |
| Admin shows TEST as LIVE | Classifier/mode/serviceType. Do not rewrite the record. |

Customer messages must stay safe. Do not expose stack traces, filesystem paths, Company Token, Service Type mix-ups, or encryption details.

## 10. Production monitoring

Useful log events (no secrets):

- `dpo.config.resolved` — mode, LIVE configured, credentials present (redacted)
- `dpo.payment.initiated` / `initiate_reused` — order ID, mode, method default
- `dpo.payment.request_token_ignored` — order ID only
- `dpo.payment.verify_unavailable` — keep PENDING, not FAILED
- `dpo.payment.binding_rejected` — order/token/amount mismatch
- XML logs use `redactXmlSecrets` (`CompanyToken` → `[redacted]`)

Never log Company Token, card number, CVV, PIN, OTP, or `PAYMENT_ENCRYPTION_KEY`.

## 11. Deploy and health

1. Push intended changes to `origin/main`
2. GitHub Actions **Deploy to VPS** pulls `/root/BYOSESEMARKET4`, reloads PM2 `byosemarket-api`, checks nginx and `/healthz`
3. Verify:
   - `https://byosemarket.com`
   - `https://byosemarket.com/healthz` → `{ "status": "ok", "dbConnected": true }`
   - `https://byosemarket.com/api/payments/dpo/config` → `{ enabled: true, label: "Pay Online" }` only
   - Payment page methods: MTN MoMo, Card, Cash on Delivery
   - Admin Payment Management still LIVE

Do not perform an uncontrolled real-money transaction to “test” a deploy.

## 12. Regression tests

```bash
npm run verify:dpo-handover
```

This runs the twelve-rule regression lock plus LIVE readiness, lifecycle, checkout UX, delivery-fee, and storefront method checks. Isolated HTTP fixtures live in `scripts/verify-dpo-payment-test.js` and must never use the real production credential store.

## 13. Security lock

- Company Token: encrypted file `server/secure/payment-credentials.enc` (gitignored)
- Encryption key: `PAYMENT_ENCRYPTION_KEY` in server `.env` only
- Admin `/api/admin/payment` requires authentication
- Browser storage may hold checkout draft, cart, Buy Now item, and awaiting order ID — never payment secrets
- Query parameters may include `orderId` and a status hint — never tokens or credentials
