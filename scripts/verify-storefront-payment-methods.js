#!/usr/bin/env node
/**
 * STEP 2 — customer-facing payment methods.
 * Confirms the Payment Step exposes only MTN MoMo, Card, and Cash on Delivery,
 * that DPO remains the backend gateway for online methods, and that removed
 * methods are rejected by the backend.
 *
 * Run: node scripts/verify-storefront-payment-methods.js
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

function checkStorefrontResolver() {
    const {
        ALLOWED_IDS,
        resolveStorefrontPaymentMethod,
        isGatewayPaymentMethod,
        isCodPaymentMethod
    } = require('../server/payments/storefront-methods');

    assert(ALLOWED_IDS.join(',') === 'mtn,card,cod', `allowed ids must be mtn,card,cod — got ${ALLOWED_IDS.join(',')}`);

    const mtn = resolveStorefrontPaymentMethod('mtn_momo');
    assert(mtn.ok && mtn.id === 'mtn' && mtn.usesDpo, 'mtn_momo must map to DPO MTN MoMo');

    const card = resolveStorefrontPaymentMethod('visa');
    assert(card.ok && card.id === 'card' && card.usesDpo, 'visa must map to DPO Card');

    const cod = resolveStorefrontPaymentMethod('cash_on_delivery');
    assert(cod.ok && cod.id === 'cod' && !cod.usesDpo, 'cash_on_delivery must map to COD without DPO');

    assert(isGatewayPaymentMethod('mtn') && isGatewayPaymentMethod('card'), 'MTN and Card are gateway methods');
    assert(isCodPaymentMethod('cod') && !isGatewayPaymentMethod('cod'), 'COD is not a DPO method');

    ['airtel', 'bank', 'dpo', 'dpo_pay', 'pay_online', 'crypto'].forEach((method) => {
        const resolved = resolveStorefrontPaymentMethod(method);
        assert(!resolved.ok && resolved.code === 'UNSUPPORTED_PAYMENT_METHOD', `${method} must be rejected`);
    });

    const missing = resolveStorefrontPaymentMethod('');
    assert(!missing.ok && missing.code === 'PAYMENT_METHOD_REQUIRED', 'empty method must be required');
}

function checkCustomerPaymentUi() {
    const constants = read('orders/core/constants.js');
    const methodIds = [...constants.matchAll(/id:\s*'([^']+)'/g)]
        .map((match) => match[1])
        .filter((id) => ['mtn', 'card', 'cod', 'airtel', 'bank', 'dpo'].includes(id));
    assert(methodIds.join(',') === 'mtn,card,cod', `PAYMENT_METHODS ids must be mtn,card,cod — got ${methodIds.join(',')}`);
    assert(constants.includes("label: 'MTN MoMo'"), 'MTN MoMo label required');
    assert(constants.includes("subtitle: 'Visa / Mastercard'"), 'Card must show Visa / Mastercard');
    assert(constants.includes("label: 'Cash on Delivery'"), 'Cash on Delivery label required');
    assert(constants.includes("Pay with MTN MoMo"), 'MTN CTA required');
    assert(constants.includes("Pay with Card"), 'Card CTA required');
    assert(constants.includes("Place Order"), 'COD CTA required');

    const paymentJs = read('orders/payment.js');
    assert(paymentJs.includes('initiateDpoPayment'), 'online methods must start existing DPO initiate');
    assert(paymentJs.includes('isGatewayPaymentMethod'), 'MTN/Card must be treated as gateway methods');
    assert(paymentJs.includes('isCodPaymentMethod'), 'COD path must be explicit');
    assert(paymentJs.includes("window.location.href = `order-success.html"), 'COD must go to Success without DPO');
    assert(!paymentJs.includes("method === 'dpo'"), 'standalone DPO must not be selected in payment.js');
    assert(paymentJs.includes('placeInFlight'), 'duplicate Pay clicks must be locked on the Payment page');
    assert(paymentJs.includes('renderPaymentPanel'), 'payment page must render the selected-method panel');
    assert(paymentJs.includes('readMomoPhoneFromPanel'), 'MTN phone must be read from the payment panel');

    const layout = read('orders/ui/layout.js');
    assert(constants.includes('Pay with MTN Mobile Money'), 'MTN description required');
    assert(constants.includes('Pay securely with Visa / Mastercard'), 'Card description required');
    assert(constants.includes('Pay when your order is delivered'), 'COD description required');
    assert(layout.includes('method.hint'), 'payment cards must render method descriptions');
    assert(layout.includes('renderCompactDeliverySummary'), 'payment page must reuse shipping as a compact summary');
    assert(!/Airtel/i.test(layout), 'Airtel must not appear in payment layout');
    assert(!/Bank Transfer/i.test(layout), 'Bank Transfer must not appear in payment layout');
    assert(!/DPO Pay/i.test(layout), 'DPO Pay must not appear in payment layout');

    const paymentHtml = read('orders/payment.html');
    assert(paymentHtml.includes('id="paymentMethods"'), 'live Payment Step is orders/payment.html');
    assert(paymentHtml.includes('payment.js'), 'payment.html must load payment.js');
    assert(paymentHtml.includes('id="paymentMethodPanel"'), 'selected-method panel must exist');
    assert(!paymentHtml.includes('id="paymentPhoneField"'), 'duplicate hidden payment phone field must be removed');

    const panel = read('orders/ui/payment-panel.js');
    assert(panel.includes('momoPhoneInput'), 'MTN panel must collect the authorizing mobile number');
    assert(panel.includes('+250'), 'MTN panel must show the Rwanda prefix');
    assert(!/name=["']cvv["']/i.test(panel), 'BYOSE must not collect CVV');
    assert(!/name=["']cardNumber["']/i.test(panel), 'BYOSE must not collect card number');
    assert(!/PIN/i.test(panel) || panel.includes('never ask for your PIN'), 'BYOSE must not collect MTN PIN');

    const success = read('orders/order-success.js');
    assert(success.includes('Payment Successful'), 'paid online orders still show Payment Successful');
    assert(success.includes('This order is not paid online.'), 'COD success must not look like an online paid order');
    assert(success.includes('confirmationIsCod'), 'Success must skip DPO verify for Cash on Delivery');

    const orderJs = read('orders/core/order.js');
    assert(orderJs.includes("usesCod ? 'cod' : state.payment.method"), 'order payload keeps selected method');
    assert(orderJs.includes('initiateDpoPayment'), 'DPO initiate helper remains in checkout order module');

    const css = read('orders/checkout.css');
    assert(css.includes('.ck-pay-card.is-selected'), 'selected payment card style required');
    assert(css.includes('repeat(3, minmax(0, 1fr))'), 'desktop payment grid is three columns');
}

function checkBackendGuards() {
    const controller = read('server/controllers/ordercontroller.js');
    assert(controller.includes('resolveStorefrontPaymentMethod'), 'order create must resolve storefront methods');
    assert(controller.includes('UNSUPPORTED_PAYMENT_METHOD'), 'order create must reject unsupported methods');

    const dpoService = read('server/services/dpopayment.service.js');
    assert(dpoService.includes('assertOrderEligibleForDpo'), 'DPO service must refuse ineligible methods');
    assert(dpoService.includes('DPO_NOT_USED_FOR_COD'), 'COD must not call DPO');
    assert(dpoService.includes('createToken'), 'existing DPO createToken path must remain');
    assert(dpoService.includes('verifyToken') || dpoService.includes('verifyAndUpdateOrder'), 'existing DPO verify path must remain');

    const admin = read('admin/app/pages/settings-payment.js');
    assert(admin.includes('Company Token') || admin.includes('companyToken'), 'Admin payment configuration must remain');
}

function main() {
    console.log('[verify-storefront-payment-methods] starting STEP 2 checks');
    checkStorefrontResolver();
    checkCustomerPaymentUi();
    checkBackendGuards();

    if (failures.length) {
        console.error('[verify-storefront-payment-methods] FAIL:');
        failures.forEach((item) => console.error(` - ${item}`));
        process.exit(1);
    }

    console.log('[verify-storefront-payment-methods] PASS');
    console.log(' Customer methods: MTN MoMo, Card, Cash on Delivery');
    console.log(' DPO remains the gateway for MTN MoMo and Card');
    console.log(' Cash on Delivery does not call DPO');
    console.log(' Backend rejects airtel, bank, standalone dpo, and unknown methods');
}

main();
