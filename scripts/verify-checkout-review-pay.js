#!/usr/bin/env node
/**
 * STEP 2 — Review & Pay actions: Cash on Delivery + Online Payment.
 * Source-level checks only. Does not call DPO LIVE or mark orders PAID.
 *
 * Run: node scripts/verify-checkout-review-pay.js
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

function sliceFunction(source, name, nextName) {
  const start = source.indexOf(`async function ${name}`);
  const end = nextName ? source.indexOf(`async function ${nextName}`) : source.length;
  assert(start >= 0, `${name} must exist`);
  return start >= 0 ? source.slice(start, end >= 0 ? end : source.length) : '';
}

function main() {
  const checkoutHtml = read('orders/checkout.html');
  const checkoutJs = read('orders/checkout.js');
  const layout = read('orders/ui/layout.js');
  const css = read('orders/checkout.css');
  const success = read('orders/order-success.js');
  const paymentHtml = read('orders/payment.html');
  const constants = read('orders/core/constants.js');
  const orderJs = read('orders/core/order.js');
  const dpoRoutes = read('server/routes/dpopayments.js');
  const orderRoutes = read('server/routes/orders.js');
  const dpoConfig = read('server/payments/dpo/config.js');
  const provider = read('server/payments/providers/dpo.provider.js');
  const client = read('server/payments/dpo/client.js');
  const service = read('server/services/dpopayment.service.js');

  assert(checkoutHtml.includes('Review & Pay'), 'Review page title must be Review & Pay');
  assert(checkoutHtml.includes('id="codPayBtn"'), 'Cash on Delivery button required');
  assert(checkoutHtml.includes('id="onlinePayBtn"'), 'Online Payment button required');
  assert(checkoutHtml.includes('href="shipping.html"'), 'Back to Shipping remains');
  assert(!checkoutHtml.includes('Continue to Payment'), 'Continue to Payment must stay removed');
  assert(!checkoutHtml.includes('payment.html'), 'Review must not navigate to payment.html');
  assert(!checkoutHtml.includes('Choose Payment Method'), 'no BYOSE payment-method selection heading');
  assert(!/Pay with MTN|Pay with Card|Pay with DPO/i.test(checkoutHtml), 'old payment CTAs must not appear on Review');

  assert(checkoutJs.includes('handleCashOnDelivery'), 'COD handler required');
  assert(checkoutJs.includes('handleOnlinePayment'), 'Online Payment handler required');
  assert(checkoutJs.includes('submitOrder'), 'both actions reuse existing order creation');
  assert(checkoutJs.includes('initiateDpoPayment'), 'Online Payment reuses existing DPO initiate');
  assert(checkoutJs.includes("setPaymentMethod('cod')"), 'COD must set existing COD method');
  assert(checkoutJs.includes('actionInFlight'), 'duplicate-click lock required');
  assert(checkoutJs.includes('Connecting to secure payment...'), 'Online Payment loading copy required');
  assert(checkoutJs.includes('ONLINE_PAYMENT_START_ERROR'), 'Review must use the customer-safe online payment error');
  assert(orderJs.includes('Online payment could not be started. Please try again or choose Cash on Delivery.'), 'customer-safe online failure copy required');
  assert(!checkoutJs.includes('payment.html'), 'checkout.js must not open payment.html');
  assert(!/paymentStatus\s*=\s*['"]paid['"]/i.test(checkoutJs), 'browser must not mark PAID');
  assert(!/name=["']cardNumber["']/i.test(checkoutJs), 'no card number field');
  assert(!/name=["']cvv["']/i.test(checkoutJs), 'no CVV field');

  const codFn = sliceFunction(checkoutJs, 'handleCashOnDelivery', 'handleOnlinePayment');
  assert(codFn.includes('submitOrder'), 'COD must create the order');
  assert(!codFn.includes('initiateDpoPayment'), 'COD must never call DPO initiate');
  assert(codFn.includes('order-success.html'), 'COD must go to the existing success page');

  const onlineFn = sliceFunction(checkoutJs, 'handleOnlinePayment', '');
  assert(onlineFn.includes('startGatewayPayment') || onlineFn.includes('initiateDpoPayment'), 'Online Payment must start DPO');
  assert(onlineFn.includes('submitOrder'), 'Online Payment must create/prepare the order first');

  assert(layout.includes('stickyCodBtn') || checkoutJs.includes('stickyCodBtn'), 'mobile sticky COD action required');
  assert(layout.includes('actions') && layout.includes('ck-sticky--review-pay'), 'sticky bar supports Review & Pay actions');
  assert(css.includes('.ck-actions--review-pay'), 'desktop Review & Pay action row required');
  assert(css.includes('.ck-sticky--review-pay'), 'mobile sticky Review & Pay actions required');
  assert(css.includes('min-height: 48px') || css.includes('min-height: 46px'), 'tap targets must remain usable');

  assert(success.includes('This order is not paid online.'), 'COD success must say payment was not made online');
  assert(success.includes('pay when the order is delivered') || success.includes('Please pay when the order is delivered'), 'COD success must say pay on delivery');
  assert(success.includes('confirmationIsCod'), 'Success must skip DPO verify for COD');

  assert(/location\.replace\(\s*'checkout.html'/.test(paymentHtml), 'old Payment URL still redirects to Review & Pay');
  assert(!paymentHtml.includes('payment.js'), 'old Payment page must not load Payment-step JS');

  assert(constants.includes('DELIVERY_FEE = 2000'), 'delivery fee remains 2000 RWF');
  assert(!constants.includes('3500'), 'no 3500 RWF surcharge');
  assert(orderJs.includes('initiateDpoPayment'), 'existing DPO helper remains');
  assert(orderJs.includes('/payments/dpo/initiate'), 'existing initiate path remains');

  assert(dpoRoutes.includes("router.get('/config'"), 'GET /api/payments/dpo/config remains');
  assert(dpoRoutes.includes("router.post('/initiate'"), 'POST /api/payments/dpo/initiate remains');
  assert(dpoRoutes.includes("router.post('/verify'"), 'POST /api/payments/dpo/verify remains');
  assert(orderRoutes.includes("router.get('/confirmation/:id'"), 'GET /api/orders/confirmation/:id remains');
  assert(dpoConfig.includes("CHECKOUT_MODE = 'live'"), 'DPO checkout mode remains LIVE');
  assert(provider.includes("LIVE_SERVICE_TYPE_ID = '112815'"), 'LIVE Service Type 112815 remains');
  assert(service.includes('DPO_NOT_USED_FOR_COD'), 'COD still does not call DPO');
  assert(service.includes('assertTrustedOrderAmount'), 'trusted server-side amount remains');
  assert(!client.includes('54841'), 'DPO client must not hard-code TEST Service Type');
  assert(client.includes("code !== 'CC' && code !== 'MO'") || client.includes("code !== 'CC' && code !== 'MO'"), 'DPO hosted page keeps Card and MTN available');

  if (failures.length) {
    console.error('[verify-checkout-review-pay] FAIL:');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('[verify-checkout-review-pay] PASS');
  console.log(' Review & Pay actions: Cash on Delivery, Online Payment');
  console.log(' COD uses existing order create and never calls DPO');
  console.log(' Online Payment uses existing DPO LIVE initiate');
  console.log(' No separate BYOSE Payment step');
  console.log(' No real-money LIVE transaction was performed');
}

main();
