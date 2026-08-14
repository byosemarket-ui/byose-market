#!/usr/bin/env node
/**
 * STEP 2 — simplified DPO LIVE customer payment UX.
 * Source-level checks only. Does not perform a real-money LIVE transaction.
 *
 * Run: node scripts/verify-dpo-checkout-ux.js
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

function checkPaymentUi() {
    const constants = read('orders/core/constants.js');
    const paymentJs = read('orders/payment.js');
    const paymentHtml = read('orders/payment.html');
    const panel = read('orders/ui/payment-panel.js');
    const css = read('orders/checkout.css');
    const validation = read('orders/core/validation.js');
    const success = read('orders/order-success.js');
    const result = read('orders/payment-result.js');

    assert(constants.includes("id: 'mtn'"), 'MTN MoMo method required');
    assert(constants.includes("id: 'card'"), 'Card method required');
    assert(constants.includes("id: 'cod'"), 'COD method required');
    assert(!constants.includes("id: 'airtel'"), 'Airtel must not be a customer method');
    assert(!constants.includes("id: 'bank'"), 'Bank Transfer must not be a customer method');
    assert(!/id:\s*'dpo'/.test(constants), 'DPO must not be a standalone customer method');
    assert(constants.includes('Pay with MTN Mobile Money'), 'MTN hint required');
    assert(constants.includes('Pay securely with Visa / Mastercard'), 'Card hint required');
    assert(constants.includes('Pay when your order is delivered'), 'COD hint required');
    assert(constants.includes('DELIVERY_FEE = 2000'), 'delivery fee must remain 2000 RWF');
    assert(!constants.includes('3500'), 'no 3,500 RWF surcharge in checkout constants');

    assert(paymentHtml.includes('id="paymentMethodPanel"'), 'selected-method panel required');
    assert(paymentHtml.includes('Choose MTN MoMo, Card, or Cash on Delivery.'), 'payment heading copy required');
    assert(!paymentHtml.includes('couponBlock'), 'payment page must not show a Coupon section');
    assert(!paymentJs.includes('renderCouponPanel'), 'payment.js must not render coupon UI');
    assert(!paymentJs.includes('bindCouponPanel'), 'payment.js must not bind coupon UI');
    assert(!/Airtel Money|Bank Transfer|TEST Service Type|Sandbox/i.test(paymentHtml), 'TEST/Airtel/Bank must not appear on payment.html');

    assert(panel.includes('momoPhoneInput'), 'MTN panel collects the authorizing number');
    assert(panel.includes('+250'), 'MTN panel shows +250');
    assert(panel.includes('never ask for your PIN'), 'MTN panel must not collect PIN');
    assert(panel.includes('Card number and CVV stay with the payment provider'), 'card secrets stay with DPO');
    assert(!/name=["']cardNumber["']/i.test(panel + paymentHtml + paymentJs), 'no card number field');
    assert(!/name=["']cvv["']/i.test(panel + paymentHtml + paymentJs), 'no CVV field');
    assert(!/autocomplete=["']cc-/i.test(panel + paymentHtml), 'no browser card-autocomplete fields');

    assert(paymentJs.includes('placeInFlight'), 'frontend duplicate-click lock required');
    assert(paymentJs.includes('placeBtn.disabled'), 'Pay button must disable while processing');
    assert(paymentJs.includes('initiateDpoPayment'), 'online pay uses official DPO initiate');
    assert(paymentJs.includes('isCodPaymentMethod'), 'COD path must be explicit');
    assert(paymentJs.includes('renderCompactDeliverySummary'), 'shipping data reused on payment');
    assert(!paymentJs.includes('localStorage') || !/paymentStatus\s*=\s*['"]paid['"]/i.test(paymentJs), 'must not fake PAID in payment.js');

    assert(validation.includes('Enter a valid MTN Mobile Number'), 'MTN phone validation required');
    assert(css.includes('.ck-pay-panel'), 'payment panel styles required');
    assert(css.includes('.ck-momo-input'), 'MTN phone input styles required');
    assert(css.includes('min-height: 48px'), 'tap targets must be large enough');

    assert(success.includes('Payment Successful'), 'verified success heading required');
    assert(success.includes('PAID'), 'success must show PAID after verify');
    assert(success.includes('PROCESSING'), 'success must show PROCESSING after paid online orders');
    assert(success.includes('This order is not paid online.'), 'COD must not look paid');

    assert(result.includes('Payment was not completed. Please try again or choose another payment method.'), 'failed copy required');
    assert(result.includes('Payment was cancelled.'), 'cancelled copy required');
}

function checkDpoLivePath() {
    const client = read('server/payments/dpo/client.js');
    const service = read('server/services/dpopayment.service.js');
    const config = read('server/payments/dpo/config.js');
    const admin = read('admin/app/pages/orders.js');

    assert(client.includes("defaultPayment: 'MO'"), 'MTN uses official DefaultPayment MO');
    assert(client.includes("defaultPayment: 'CC'"), 'Card uses official DefaultPayment CC');
    assert(client.includes('BlockPayment'), 'unused DPO methods are blocked via official BlockPayment');
    assert(client.includes("['CC', 'MO', 'PP', 'BT', 'XP']"), 'BlockPayment must use official DPO v6 codes only');
    assert(!/ALL_BLOCKABLE_PAYMENTS = Object\.freeze\(\[[^\]]*SE/.test(client), 'BlockPayment must not include undocumented SE');
    assert(client.includes('customerFirstName'), 'customer details are prefilled for DPO');
    assert(!client.includes('54841'), 'DPO client must not hard-code TEST Service Type 54841');
    assert(!/chargeToken/i.test(client), 'do not invent a custom card chargeToken processor');

    assert(service.includes('resolveHostedPaymentOptions'), 'initiate must set hosted defaults from the selected method');
    assert(service.includes('initiateLocks'), 'backend duplicate initiate lock required');
    assert(service.includes('DPO_NOT_USED_FOR_COD'), 'COD must not create a DPO transaction');
    assert(service.includes('assertVerifiedPaymentMatchesOrder'), 'payment success requires verified DPO result');
    assert(service.includes('companyRef: id'), 'DPO token is bound to the BYOSE order ID');

    assert(config.includes("CHECKOUT_MODE = 'live'"), 'customer checkout mode is LIVE');
    assert(config.includes('Incomplete LIVE never substitutes TEST'), 'no LIVE → TEST fallback');

    assert(admin.includes('resolveAdminPaymentMode'), 'Admin must show LIVE/TEST mode without payment secrets');
    assert(!/cardNumber|cvv|cvc/i.test(admin), 'Admin must not display card secrets');
}

function checkOrderIntegrity() {
    const orderJs = read('orders/core/order.js');
    const session = read('orders/checkout-session.js');
    const controller = read('server/controllers/ordercontroller.js');

    assert(orderJs.includes('payerPhone'), 'MTN authorizing phone is stored as business data');
    assert(orderJs.includes("usesCod ? 'cod' : state.payment.method"), 'selected method is persisted on the order');
    assert(orderJs.includes('initiateDpoPayment'), 'DPO initiate helper remains');
    assert(session.includes('Buy Now') || session.includes('buyNow') || session.includes('BUY_NOW') || session.includes('checkoutSource'), 'Buy Now isolation module remains');
    assert(controller.includes('applyCatalogPricing'), 'backend must price from catalog');
}

function main() {
    console.log('[verify-dpo-checkout-ux] starting STEP 2 payment UX checks');
    checkPaymentUi();
    checkDpoLivePath();
    checkOrderIntegrity();

    if (failures.length) {
        console.error('[verify-dpo-checkout-ux] FAIL:');
        failures.forEach((item) => console.error(` - ${item}`));
        process.exit(1);
    }

    console.log('[verify-dpo-checkout-ux] PASS');
    console.log(' Customer methods: MTN MoMo, Card, Cash on Delivery');
    console.log(' Official DPO createToken defaults: MO / CC + BlockPayment');
    console.log(' No card number, CVV, or MTN PIN collection in BYOSE Market');
    console.log(' No real-money LIVE transaction was performed');
}

main();
