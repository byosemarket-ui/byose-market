#!/usr/bin/env node
/**
 * STEP 1 — two-step checkout: Shipping → Review & Pay.
 * Source-level checks only. Does not call DPO LIVE or mark orders PAID.
 *
 * Run: node scripts/verify-checkout-two-step.js
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

function main() {
  const constants = read('orders/core/constants.js');
  const layout = read('orders/ui/layout.js');
  const checkoutHtml = read('orders/checkout.html');
  const checkoutJs = read('orders/checkout.js');
  const shippingHtml = read('orders/shipping.html');
  const paymentHtml = read('orders/payment.html');
  const paymentResult = read('orders/payment-result.js');
  const css = read('orders/checkout.css');
  const dpoRoutes = read('server/routes/dpopayments.js');
  const orderRoutes = read('server/routes/orders.js');
  const dpoConfig = read('server/payments/dpo/config.js');
  const provider = read('server/payments/providers/dpo.provider.js');
  const service = read('server/services/dpopayment.service.js');

  assert(constants.includes("id: 'shipping'"), 'Shipping step required');
  assert(constants.includes("label: 'Review & Pay'"), 'Review & Pay step label required');
  assert(constants.includes("file: 'checkout.html'"), 'Review & Pay must stay on checkout.html');
  assert(!constants.includes("file: 'payment.html'"), 'payment.html must not be a checkout step');
  assert(!/id:\s*'payment'/.test(constants), 'Payment must not remain a checkout step id');
  assert(constants.includes('CHECKOUT_PROGRESS_STEPS'), 'progress must use the two checkout steps');
  assert(constants.includes("id: 'mtn'") && constants.includes("id: 'card'") && constants.includes("id: 'cod'"), 'MTN, Card, and COD methods remain for later checkout buttons');

  assert(layout.includes('CHECKOUT_PROGRESS_STEPS'), 'progress renderer must ignore Success');
  assert(!layout.includes('STEPS.slice(0, 3)'), 'progress must not render three checkout steps');
  assert(!layout.includes('renderCouponPanel'), 'coupon panel renderer must be removed from checkout UI');
  assert(layout.includes('hideAction'), 'Review sticky bar can show total without a dead payment button');
  assert(layout.includes('Delivery Address'), 'Review must still show delivery address');
  assert(layout.includes('Customer:'), 'Review must still show customer name');
  assert(layout.includes('Phone:'), 'Review must still show phone');
  assert(layout.includes('Subtotal'), 'Review must still show subtotal');
  assert(layout.includes('Delivery'), 'Review must still show delivery fee');
  assert(layout.includes('totals.total'), 'Review must still show trusted total');

  assert(checkoutHtml.includes('Review & Pay'), 'Review page title must be Review & Pay');
  assert(checkoutHtml.includes('Step 2 of 2'), 'Review must be Step 2 of 2');
  assert(checkoutHtml.includes('choose how you want to complete payment'), 'Review subtitle must mention completing payment');
  assert(!checkoutHtml.includes('Step 3'), 'Review must not mention Step 3');
  assert(!checkoutHtml.includes('couponBlock'), 'Review must not include coupon container');
  assert(!checkoutHtml.includes('Continue to Payment'), 'Continue to Payment must be removed');
  assert(!checkoutHtml.includes('payment.html'), 'Review must not navigate to payment.html');
  assert(checkoutHtml.includes('id="shippingSummary"'), 'customer/shipping summary remains');
  assert(checkoutHtml.includes('id="productList"'), 'product list remains');
  assert(checkoutHtml.includes('id="totalsBlock"'), 'totals remain');
  assert(checkoutHtml.includes('href="shipping.html"'), 'Back to Shipping remains');

  assert(!checkoutJs.includes('payment.html'), 'checkout.js must not send customers to payment.html');
  assert(!checkoutJs.includes('setStep(\'payment\')'), 'checkout.js must not enter a Payment step');
  assert(!checkoutJs.includes('Continue to Payment'), 'checkout.js must not keep Continue to Payment');
  assert(!checkoutJs.includes('bindCouponPanel'), 'coupon event wiring must be removed');
  assert(!checkoutJs.includes('applyCheckoutCoupon'), 'Review must not apply coupons from this page');
  assert(!checkoutJs.includes('renderCouponPanel'), 'Review must not render coupon UI');
  assert(checkoutJs.includes("window.__ckStep = 'review'"), 'Review still sets the checkout step');
  assert(checkoutJs.includes('hideAction: true'), 'Review sticky bar must not keep a dead continue button');

  assert(shippingHtml.includes('Step 1 of 2'), 'Shipping must be Step 1 of 2');
  assert(!shippingHtml.includes('Step 1 of 4'), 'Shipping must not still say Step 1 of 4');

  assert(/location\.replace\(\s*'checkout.html'/.test(paymentHtml), 'old Payment URL must redirect to Review & Pay');
  assert(paymentHtml.includes('http-equiv="refresh"'), 'old Payment URL must have a refresh fallback');
  assert(!paymentHtml.includes('payment.js'), 'old Payment page must not load the Payment-step script');
  assert(!paymentHtml.includes('Step 3 of 4'), 'Step 3 of 4 must be gone');
  assert(!paymentHtml.includes('couponBlock'), 'redirect page must not show Coupon');

  assert(paymentResult.includes("href: 'checkout.html'"), 'failed-payment return must go to Review & Pay');
  assert(!paymentResult.includes("href: 'payment.html'"), 'failed-payment return must not go to payment.html');

  assert(!css.includes('.ck-coupon'), 'unused coupon checkout styles must be removed');
  assert(css.includes('.ck-sticky--total-only'), 'total-only sticky bar style required');

  assert(dpoRoutes.includes("router.get('/config'"), 'GET /api/payments/dpo/config remains');
  assert(dpoRoutes.includes("router.post('/initiate'"), 'POST /api/payments/dpo/initiate remains');
  assert(dpoRoutes.includes("router.post('/verify'"), 'POST /api/payments/dpo/verify remains');
  assert(orderRoutes.includes("router.get('/confirmation/:id'"), 'GET /api/orders/confirmation/:id remains');
  assert(dpoConfig.includes("CHECKOUT_MODE = 'live'"), 'DPO checkout mode remains LIVE');
  assert(provider.includes("LIVE_SERVICE_TYPE_ID = '112815'"), 'LIVE Service Type 112815 remains');
  assert(service.includes('DPO_NOT_USED_FOR_COD'), 'COD still does not call DPO');
  assert(!dpoConfig.includes('TEST fallback') || dpoConfig.includes('Incomplete LIVE never substitutes TEST'), 'no LIVE → TEST fallback');

  if (failures.length) {
    console.error('[verify-checkout-two-step] FAIL:');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('[verify-checkout-two-step] PASS');
  console.log(' Checkout steps: Shipping → Review & Pay');
  console.log(' Separate BYOSE Payment step removed');
  console.log(' Coupon UI removed from this checkout flow');
  console.log(' DPO LIVE routes and Service Type 112815 unchanged');
  console.log(' No real-money LIVE transaction was performed');
}

main();
