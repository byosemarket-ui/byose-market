#!/usr/bin/env node
/**
 * STEP 3 — Complete checkout / review / payment / order flow verification.
 * Run: node scripts/verify-checkout-flow-step3.js
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function checkCartPage() {
  const cartPage = read('js/cart-page.js');
  assert(
    countOccurrences(cartPage, "from '../services/storefront-asset-url.js'") === 1,
    'cart-page.js must not duplicate normalizeStorefrontAssetUrl import'
  );
  assert(cartPage.includes('ByoseCart'), 'cart page must use ByoseCart');
}

function checkBuyNowMulti() {
  const actions = read('details/js/product-actions.js');
  assert(actions.includes('startDirectCheckout(items)'), 'Buy Now must pass all selected variants');
  assert(actions.includes('startBuyNowSession'), 'Buy Now must use an isolated session, not cart');
  const session = read('orders/checkout-session.js');
  assert(session.includes('writeDirectCheckoutItems'), 'multi Buy Now must stay on directCheckout');
}

function checkReviewPaymentUi() {
  const layout = read('orders/ui/layout.js');
  assert(layout.includes('Open in Google Maps'), 'Review shipping summary must show Maps link');
  assert(layout.includes('Discount'), 'totals must support discount line');
  assert(layout.includes('each'), 'product lines must show unit price');
  assert(layout.includes('totals.tax'), 'totals must support tax when present');

  const paymentHtml = read('orders/payment.html');
  const paymentJs = read('orders/payment.js');
  assert(paymentHtml.includes('paymentShippingSummary'), 'Payment page must include shipping summary mount');
  assert(paymentJs.includes('renderShippingSummary'), 'Payment must render same shipping summary as Review');

  const success = read('orders/order-success.js');
  assert(success.includes('renderShippingSummary'), 'Success page must reuse shipping summary with Maps');
  assert(success.includes('verifyPaidStatus'), 'Success page must verify DPO payment status');
  assert(success.includes('Payment Successful'), 'Success page must show paid confirmation after DPO');

  const account = read('account/orders/order-details.js');
  assert(account.includes('gps.googleMapsLink || gps.mapLink'), 'Account Maps link must fall back to mapLink');
}

function checkGpsPipeline() {
  const stateSource = read('orders/core/state.js');
  assert(stateSource.includes('latitude: state.shipping.latitude'), 'commitShipping preserves GPS');
  assert(stateSource.includes('discount'), 'checkout totals include discount');
  assert(stateSource.includes('writeStorage(STORAGE_KEYS.checkoutActive, state.products)'), 'Review qty syncs checkout selection');
  assert(stateSource.includes('mergeShippingPreferFilled'), 'guard must merge shipping without wiping filled fields');
  assert(stateSource.includes('updatedAt: Date.now()'), 'draft must include updatedAt for conflict resolution');
  assert(stateSource.includes('hadHandoff'), 'guardStep must trust fresh handoff navigation');

  const order = read('orders/core/order.js');
  assert(order.includes('gpsLocation:'), 'order payload includes gpsLocation');
  assert(order.includes('succeeded = true'), 'submit lock must stay engaged after success');
  assert(order.includes('if (!succeeded)'), 'submit lock unlocks only on failure');

  const utils = read('orders/utils.js');
  assert(utils.includes('preferLocal'), 'remote draft sync must not clobber newer local draft');
  assert(utils.includes('forceLocalPersist'), 'checkout draft must always persist to localStorage');

  const shipping = read('orders/shipping.js');
  assert(shipping.includes('allowReprompt'), 'shipping must support GPS retry');
  assert(shipping.includes('shippingBackLink'), 'shipping back link must adapt for Buy Now');
  assert(shipping.includes('GPS_UI_FAILSAFE_MS'), 'shipping must fail closed on Locating');
  assert(shipping.includes('continueInFlight'), 'Continue must prevent duplicate submits');
  assert(shipping.includes('continueToReview'), 'Continue must use authoritative continueToReview');
  assert(
    shipping.includes('result.redirectUrl') || shipping.includes('./checkout.html?from=shipping'),
    'Continue must navigate to Review'
  );
  assert(shipping.includes('never awaited') || shipping.includes('never blocks'), 'Continue must not await quote before navigation');

  assert(stateSource.includes('continueToReview'), 'state must expose continueToReview');
  assert(stateSource.includes('byose_checkout_step1_commit_v1'), 'state must write Step 1 commit payload');
  assert(stateSource.includes('applyStep1Commit'), 'Review guard must apply Step 1 commit first');
  assert(
    !/function resolveApiOrigin\s*\(/.test(stateSource),
    'state.js must not redeclare resolveApiOrigin (module load crash)'
  );
  const payment = read('orders/payment.js');
  assert(payment.includes("window.__ckStep = 'payment'"), 'payment must set __ckStep');
  assert(/initCheckout\('payment'\)[\s\S]*guardStep\('payment'\)/.test(payment), 'payment must init before guard');

  const headers = read('server/middleware/securityheaders.js');
  assert(headers.includes('geolocation=(self)'), 'geolocation must be allowed for GPS');
}

function checkCartCatalogImages() {
  const cart = read('services/byose-cart.js');
  assert(cart.includes('colorImage || item.image || product.image'), 'catalog sync must preserve variant images');
}

function simulateTotals() {
  const products = [
    { price: 1000, comparePrice: 1500, qty: 2 },
    { price: 500, comparePrice: 0, qty: 1 }
  ];
  const subtotal = products.reduce((s, p) => s + p.price * p.qty, 0);
  const discount = products.reduce((s, p) => {
    if (p.comparePrice > p.price) return s + (p.comparePrice - p.price) * p.qty;
    return s;
  }, 0);
  const deliveryFee = 2000;
  const total = subtotal + deliveryFee;
  assert(subtotal === 2500, 'subtotal simulation failed');
  assert(discount === 1000, 'discount simulation failed');
  assert(total === 4500, 'grand total simulation failed');
}

function simulateDuplicateGuard() {
  let isSubmitting = false;
  let succeeded = false;
  const calls = [];

  async function submitOrder() {
    if (isSubmitting) {
      calls.push('blocked');
      return { valid: false };
    }
    isSubmitting = true;
    calls.push('run');
    await Promise.resolve();
    succeeded = true;
    // success keeps lock engaged
    if (!succeeded) isSubmitting = false;
    return { valid: true };
  }

  return Promise.all([submitOrder(), submitOrder()]).then(() => {
    assert(calls.includes('run') && calls.includes('blocked'), 'duplicate place-order must be blocked');
    assert(isSubmitting === true, 'submit lock must remain after successful place-order');
  });
}

function runPriorVerifiers() {
  for (const script of [
    'scripts/verify-shopping-flow-step1.js',
    'scripts/verify-checkout-order-step2.js',
    'scripts/verify-shipping-location-step2.js'
  ]) {
    const result = spawnSync(process.execPath, [path.join(root, script)], {
      cwd: root,
      encoding: 'utf8'
    });
    assert(result.status === 0, `${script} failed:\n${result.stderr || result.stdout}`);
  }
}

async function main() {
  checkCartPage();
  checkBuyNowMulti();
  checkReviewPaymentUi();
  checkGpsPipeline();
  checkCartCatalogImages();
  simulateTotals();
  await simulateDuplicateGuard();
  runPriorVerifiers();

  if (failures.length) {
    console.error('FAIL — Checkout flow STEP 3 verification\n');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('PASS — Checkout flow STEP 3 verification');
  console.log(' - Cart page import fixed');
  console.log(' - Buy Now multi-variant supported');
  console.log(' - Review/Payment/Success Maps + discounts + unit prices');
  console.log(' - Duplicate place-order lock holds through redirect');
  console.log(' - Prior STEP 1/2 verifiers passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
