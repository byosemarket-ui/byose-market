#!/usr/bin/env node
/**
 * STEP 5 — DPO LIVE regression lock.
 * Source-level guards for the twelve production payment rules.
 * Does not call DPO LIVE and does not perform a real-money transaction.
 *
 * Run: node scripts/verify-dpo-regression-lock.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const failures = [];

function assert(condition, message) {
    if (!condition) failures.push(message);
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function trackedFiles() {
    return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
        .split(/\r?\n/)
        .filter(Boolean);
}

function trackedDeletedFiles() {
    return execFileSync('git', ['ls-files', '--deleted'], { cwd: root, encoding: 'utf8' })
        .split(/\r?\n/)
        .filter(Boolean);
}

function main() {
    const config = read('server/payments/dpo/config.js');
    const settings = read('server/services/paymentsettings.service.js');
    const service = read('server/services/dpopayment.service.js');
    const status = read('server/payments/payment-status.js');
    const success = read('orders/order-success.js');
    const result = read('orders/payment-result.js');
    const session = read('orders/checkout-session.js');
    const orderController = read('server/controllers/ordercontroller.js');
    const delivery = read('server/services/deliverysettings.service.js');
    const constants = read('orders/core/constants.js');
    const localE2e = read('scripts/e2e-checkout-both-flows.mjs');
    const classifier = read('server/payments/dpo/test-history.classifier.js');
    const docs = read('docs/dpo-live-payment-handover.md');
    const tracked = trackedFiles();
    const trackedDeleted = trackedDeletedFiles();

    // RULE 1 — LIVE never falls back to TEST
    assert(config.includes("CHECKOUT_MODE = 'live'"), 'RULE 1: customer checkout must be LIVE-only');
    assert(config.includes('Incomplete LIVE never substitutes TEST'), 'RULE 1: incomplete LIVE must not substitute TEST');
    assert(settings.includes('LIVE never falls back to TEST'), 'RULE 1: payment settings must forbid LIVE → TEST');
    assert(service.includes('TEST_SERVICE_TYPE_ID'), 'RULE 1: initiate must reject TEST Service Type 54841');
    assert(localE2e.includes('Refusing to run DPO TEST sandbox E2E against production LIVE'), 'RULE 1: local TEST E2E must abort on production');
    const prodTestE2e = path.join(root, 'scripts/e2e-checkout-prod-both-flows.mjs');
    assert(!fs.existsSync(prodTestE2e), 'RULE 1: production TEST-card E2E must be removed');
    assert(!tracked.includes('scripts/e2e-checkout-prod-both-flows.mjs') || trackedDeleted.includes('scripts/e2e-checkout-prod-both-flows.mjs'), 'RULE 1: production TEST-card E2E must not remain in git');

    // RULE 2 — COD never creates a DPO transaction
    assert(service.includes('DPO_NOT_USED_FOR_COD'), 'RULE 2: COD must not call DPO');

    // RULE 3 — frontend cannot mark PAID
    assert(success.includes('verifyPaidStatus'), 'RULE 3: success page must verify with the backend');
    assert(success.includes('Confirming payment'), 'RULE 3: success must not flash PAID from browser storage');
    assert(!success.includes("status === 'authorized'"), 'RULE 3: authorized must not display as Payment Successful');

    // RULE 4 — failed cannot become PAID
    assert(result.includes('Payment was not completed. Please try again or choose another payment method.'), 'RULE 4: failed copy required');
    assert(status.includes("status === 'paid'"), 'RULE 4: settled paid helper remains strict');

    // RULE 5 — cancelled cannot become PAID
    assert(result.includes('Payment was cancelled.'), 'RULE 5: cancelled copy required');
    assert(service.includes("'cancelled'") || service.includes('cancelled'), 'RULE 5: cancelled remains a first-class payment state');

    // RULE 6 — pending cannot become PAID without verify
    assert(service.includes('DPO_VERIFY_UNAVAILABLE') || service.includes('isUncertainVerifyError'), 'RULE 6: timeout/pending must not be treated as paid');
    assert(!/status === 'authorized'/.test(status), 'RULE 6: authorized must not count as PAID');

    // RULE 7 — payment belongs to the correct order
    assert(service.includes('assertVerifiedPaymentMatchesOrder'), 'RULE 7: PAID requires order/token/amount binding');
    assert(service.includes('request_token_ignored') || service.includes('storedToken || requestedToken'), 'RULE 7: request tokens cannot pay a different order');

    // RULE 8 — duplicate callbacks are idempotent
    assert(service.includes('verifyLocks'), 'RULE 8: duplicate verify/callback must be serialized');
    assert(service.includes('initiateLocks'), 'RULE 8: duplicate initiate must be locked');

    // RULE 9 — Buy Now cannot purchase an unrelated cart item
    assert(session.includes("source === 'direct'"), 'RULE 9: Buy Now isolation must remain');
    assert(session.includes('shouldRemoveCartAfterPurchase'), 'RULE 9: cart clearing stays gated on purchase outcome');

    // RULE 10 — amount equals trusted order total
    assert(service.includes('assertTrustedOrderAmount'), 'RULE 10: amount must be verified server-side');
    assert(orderController.includes('applyCatalogPricing'), 'RULE 10: order totals come from catalog, not the browser');

    // RULE 11 — delivery fee 2,000 RWF from official configuration
    assert(constants.includes('DELIVERY_FEE = 2000'), 'RULE 11: checkout fallback delivery fee is 2,000 RWF');
    assert(orderController.includes('DELIVERY_FEE = 2000'), 'RULE 11: order create fallback delivery fee is 2,000 RWF');
    assert(delivery.includes('configured delivery fee only'), 'RULE 11: shipping calculator uses configured fee');
    assert(delivery.includes('fixedFee: 2000'), 'RULE 11: default configured fee remains 2,000 RWF');

    // RULE 12 — no hidden 3,500 RWF surcharge
    assert(!orderController.includes('3500'), 'RULE 12: no 3,500 RWF surcharge in order create');
    assert(delivery.includes('old 3,500 RWF'), 'RULE 12: zone 3,500 quotes must not be charged');

    const client = read('server/payments/dpo/client.js');
    const paymentHtml = read('orders/payment.html');
    const paymentJs = read('orders/payment.js');

    assert(classifier.includes('isLiveGatewayActivity'), 'TEST history classifier must keep TEST out of LIVE activity');
    assert(docs.includes('Admin → Payment Management'), 'handover documentation must describe Admin Payment Management');
    assert(docs.includes('112815'), 'handover documentation must name LIVE Service Type 112815');
    assert(!/Company Token:\s*[A-Za-z0-9-]{12,}/.test(docs), 'handover documentation must not include a Company Token value');
    assert(client.includes("['CC', 'MO', 'PP', 'BT', 'XP']"), 'BlockPayment must use official DPO v6 codes only');
    assert(!/ALL_BLOCKABLE_PAYMENTS = Object\.freeze\(\[[^\]]*SE/.test(client), 'BlockPayment must not include undocumented SE');
    assert(!paymentHtml.includes('couponBlock'), 'payment page must not show a Coupon section');
    assert(!paymentJs.includes('renderCouponPanel'), 'payment.js must not render coupon UI');

    if (failures.length) {
        console.error('[verify-dpo-regression-lock] FAIL:');
        failures.forEach((item) => console.error(` - ${item}`));
        process.exit(1);
    }

    console.log('[verify-dpo-regression-lock] PASS');
    console.log(' Rules 1–12 locked for DPO LIVE production');
    console.log(' No real-money LIVE transaction was performed');
}

main();
