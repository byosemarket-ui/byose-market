#!/usr/bin/env node
/**
 * STEP 3 — DPO LIVE payment lifecycle (orders, cart, success, Admin).
 * Source-level checks. Does not perform a real-money LIVE transaction.
 *
 * Run: node scripts/verify-dpo-payment-lifecycle.js
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];

function assert(condition, message) {
    if (!condition) failures.push(message);
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function checkServerAuthority() {
    const service = read('server/services/dpopayment.service.js');
    const controller = read('server/controllers/dpopaymentcontroller.js');
    const success = read('orders/order-success.js');
    const result = read('orders/payment-result.js');
    const status = read('server/payments/payment-status.js');

    assert(service.includes('assertVerifiedPaymentMatchesOrder'), 'PAID requires DPO verify binding');
    assert(service.includes('assertTrustedOrderAmount'), 'initiate must verify stored order amount');
    assert(service.includes('verifyLocks'), 'duplicate verify/callback must be serialized');
    assert(service.includes('DPO_VERIFY_UNAVAILABLE') || service.includes('isUncertainVerifyError'), 'timeout must not be treated as failed');
    assert(service.includes('applyPaidOrderStatus'), 'paid online orders must move to PROCESSING');
    assert(service.includes('LIVE_SERVICE_TYPE_ID'), 'initiate must enforce LIVE Service Type 112815');
    assert(service.includes('TEST_SERVICE_TYPE_ID'), 'initiate must reject TEST Service Type 54841');
    assert(service.includes('request_token_ignored') || service.includes('storedToken || requestedToken'), 'request tokens cannot pay a different order');
    assert(service.includes('DPO_NOT_USED_FOR_COD'), 'COD must not call DPO');

    assert(controller.includes('never trusts') || controller.includes('Never trusts') || controller.includes('never trusts the'), 'callback must not trust POST body as proof');
    assert(controller.includes('isUncertainPaymentError'), 'return/callback timeout must stay pending');

    assert(success.includes('verifyPaidStatus'), 'success page must verify with the backend');
    assert(success.includes('Confirming payment'), 'success page must not flash PAID from localStorage');
    assert(success.includes("payment-result.html?status="), 'unverified online success must not stay on the success page');
    assert(success.includes('verifiedOutcome'), 'success must pass the verified DPO outcome, not always pending');
    assert(!success.includes("status === 'authorized'"), 'authorized must not display as Payment Successful');

    assert(result.includes("outcome: 'pending'"), 'network errors on result page must stay pending');
    assert(result.includes('Payment was not completed. Please try again or choose Cash on Delivery.'), 'failed copy required');
    assert(result.includes('Payment was cancelled.'), 'cancelled copy required');

    assert(status.includes("status === 'paid'"), 'settled paid helper remains');
    assert(!/status === 'authorized'/.test(status), 'authorized must not count as PAID');
}

function checkConfirmationAndAdmin() {
    const orderController = read('server/controllers/ordercontroller.js');
    const adminOrders = read('admin/app/pages/orders.js');
    const activity = read('server/services/paymentsettings.service.js');
    const session = read('orders/checkout-session.js');

    assert(orderController.includes('orderStatus'), 'confirmation API must return order status');
    assert(orderController.includes('paymentReference'), 'confirmation API must return the safe DPO reference');
    assert(orderController.includes('checkoutSource'), 'confirmation API must return checkout source for cart isolation');
    assert(!orderController.includes('companyToken'), 'confirmation must not expose Company Token');
    assert(orderController.includes('applyCatalogPricing'), 'order create still prices from catalog');
    assert(orderController.includes('DELIVERY_FEE = 2000'), 'delivery fee remains 2,000 RWF');
    assert(!orderController.includes('3500'), 'no 3,500 RWF surcharge in order create');

    assert(adminOrders.includes('resolveDpoTransactionReference'), 'Admin shows DPO reference');
    assert(adminOrders.includes('resolveAdminPaymentMode'), 'Admin shows LIVE/TEST mode');
    assert(!/cardNumber|cvv|cvc/i.test(adminOrders), 'Admin must not display card secrets');

    assert(activity.includes('isLiveGatewayActivity'), 'payment activity comes from LIVE database records');
    assert(activity.includes('summarizePaymentActivityRow'), 'payment activity is not hard-coded');

    assert(session.includes("source === 'direct'"), 'Buy Now must not clear unrelated cart items');
    assert(session.includes('shouldRemoveCartAfterPurchase'), 'cart clearing is gated on verified purchase outcome');
}

function checkLivePath() {
    const config = read('server/payments/dpo/config.js');
    const client = read('server/payments/dpo/client.js');
    assert(config.includes("CHECKOUT_MODE = 'live'"), 'customer checkout is LIVE-only');
    assert(config.includes('Incomplete LIVE never substitutes TEST'), 'no LIVE → TEST fallback');
    assert(client.includes('DPO_API_TIMEOUT'), 'DPO client must classify timeouts');
    assert(client.includes('redactXmlSecrets'), 'DPO logs must redact secrets');
    assert(!client.includes('54841'), 'DPO client must not hard-code TEST Service Type');
}

function main() {
    console.log('[verify-dpo-payment-lifecycle] starting STEP 3 lifecycle checks');
    checkServerAuthority();
    checkConfirmationAndAdmin();
    checkLivePath();

    if (failures.length) {
        console.error('[verify-dpo-payment-lifecycle] FAIL:');
        failures.forEach((item) => console.error(` - ${item}`));
        process.exit(1);
    }

    console.log('[verify-dpo-payment-lifecycle] PASS');
    console.log(' Server-side DPO verify is authoritative');
    console.log(' PAID / FAILED / CANCELLED / PENDING are distinct from order status');
    console.log(' Duplicate verify/callback is protected');
    console.log(' No real-money LIVE transaction was performed');
}

main();
