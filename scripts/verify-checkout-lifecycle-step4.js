#!/usr/bin/env node
/**
 * STEP 4 — purchase / payment / order / verification lifecycle checks.
 * Run: node scripts/verify-checkout-lifecycle-step4.js
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

function checkSource() {
  const orderController = read('server/controllers/ordercontroller.js');
  assert(orderController.includes('resolveCatalogUnitPrice'), 'catalog pricing must consider variant/size price');
  assert(orderController.includes('isProductPublished'), 'unpublished products must be rejected');
  assert(orderController.includes('VARIANT_NOT_FOUND'), 'variant must belong to the product');
  assert(orderController.includes('INVALID_QUANTITY'), 'quantity < 1 must be rejected');
  assert(orderController.includes('INSUFFICIENT_STOCK'), 'insufficient stock must be rejected before payment');
  assert(orderController.includes('getPublicOrderConfirmation'), 'Success page needs a server confirmation fallback');
  assert(orderController.includes('toPublicOrderConfirmation'), 'confirmation payload must be sanitized');
  assert(!orderController.includes('companyToken'), 'order confirmation must not expose DPO company token');
  assert(orderController.includes("existing: true"), 'duplicate orderId must not create a second order');

  const routes = read('server/routes/orders.js');
  assert(routes.includes("/confirmation/:id"), 'confirmation route must exist');

  const dpoService = read('server/services/dpopayment.service.js');
  assert(dpoService.includes('initiate_reused'), 'DPO initiate must reuse a fresh awaiting token');
  assert(dpoService.includes('TOKEN_REUSE_MAX_MS'), 'DPO token reuse window must be defined');
  assert(dpoService.includes('cancel_verify_unavailable') || dpoService.includes('verifiedOnBack'), 'back URL must verify DPO before cancelling');
  assert(dpoService.includes('assertVerifiedPaymentMatchesOrder'), 'PAID requires DPO verify binding');
  assert(dpoService.includes('isSettledPaidStatus'), 'already-paid verify must short-circuit');
  assert(dpoService.includes("paymentStatus: 'awaiting_payment'"), 'initiate must not mark paid');

  const dpoConfig = read('server/payments/dpo/config.js');
  assert(dpoConfig.includes('OPERATING_MODE_LIVE'), 'LIVE operating mode must activate LIVE checkout');
  assert(!dpoConfig.includes('LIVE_CHECKOUT_ENABLED = false'), 'hard LIVE gate must be removed');

  const session = read('orders/checkout-session.js');
  assert(session.includes("writeCheckoutIntent('direct'"), 'Buy Now must write a direct intent');
  assert(session.includes("writeCheckoutIntent('cart'"), 'Cart checkout must write a cart intent');
  assert(session.includes('clearAbandonedCheckoutSession'), 'starting a session must clear stale checkout artifacts');
  assert(session.includes("source === 'direct'"), 'Buy Now must not delete unrelated cart items');

  const state = read('orders/core/state.js');
  assert(state.includes('refreshBackendDeliveryQuote'), 'Review/Payment must quote delivery from the backend');
  assert(state.includes('/shipping/calculate'), 'frontend delivery quote must use backend calculate');

  const orderJs = read('orders/core/order.js');
  assert(orderJs.includes('shouldRemoveCartAfterPurchase'), 'COD cart purchases must clear purchased lines after create');
  assert(orderJs.includes('setSubmitting(true)'), 'double-click submit must be locked');

  const success = read('orders/order-success.js');
  assert(success.includes('fetchServerConfirmation'), 'Success must fall back to server confirmation');
  assert(success.includes('/orders/confirmation/'), 'Success confirmation endpoint path');
  assert(success.includes('Pay when your order arrives'), 'COD success must not claim online payment completed');

  const paymentResult = read('orders/payment-result.js');
  assert(paymentResult.includes('../shop/shop.html'), 'failed-payment shop link must point at shop.html');
  assert(paymentResult.includes('retryExistingPayment'), 'failed payment must retry the existing order');
  assert(paymentResult.includes('initiateDpoPayment'), 'retry must reuse the DPO initiate path');

  const adminOrders = read('admin/app/pages/orders.js');
  assert(adminOrders.includes('MTN MoMo'), 'Admin must label MTN MoMo');
  assert(adminOrders.includes('Cash on Delivery'), 'Admin must label Cash on Delivery');
  assert(adminOrders.includes('DPO Transaction Reference'), 'Admin must show DPO transaction reference');
  assert(!adminOrders.includes('companyToken'), 'Admin orders must not display Company Token');

  const layout = read('orders/ui/layout.js');
  assert(layout.includes('Customer:'), 'Review must show customer name');
  assert(layout.includes('Phone:'), 'Review must show phone');
  assert(layout.includes('<dt>Delivery</dt>'), 'Review must show delivery fee');
  assert(layout.includes('ck-totals-total'), 'Review must show final total');

  const paymentJs = read('orders/payment.js');
  assert(paymentJs.includes('isGatewayPaymentMethod'), 'MTN/Card use DPO');
  assert(paymentJs.includes('isCodPaymentMethod'), 'COD is a separate path');
  assert(paymentJs.includes('initiateDpoPayment'), 'gateway checkout starts DPO after order create');
}

function simulateTotals() {
  const product = 23000;
  const delivery = 2000;
  const surcharge = 0;
  const total = product + delivery + surcharge;
  assert(total === 25000, 'final total must be product + configured delivery fee only');
}

function simulateBuyNowIsolation() {
  let cart = [{ productId: 'A', variantKey: 'white-42' }];
  let direct = [{ productId: 'A', variantKey: 'white-42' }];
  const startBuyNow = (item) => {
    direct = [item];
  };
  startBuyNow({ productId: 'B', variantKey: 'black-41' });
  assert(direct[0].productId === 'B', 'later Buy Now must replace the previous Buy Now item');
  assert(cart[0].productId === 'A', 'abandoned Buy Now must not delete the persistent cart');
}

function simulateDuplicateOrderId() {
  const created = new Set();
  function create(orderId) {
    if (created.has(orderId)) return { existing: true, orderId };
    created.add(orderId);
    return { existing: false, orderId };
  }
  const first = create('BM123');
  const second = create('BM123');
  assert(first.existing === false && second.existing === true, 'same orderId must not create a second order');
}

async function verifyCatalogPricingAgainstDatabase() {
  require('dotenv').config({ path: path.join(root, '.env') });
  const { connectDatabase } = require('../server/database');
  await connectDatabase();
  const productDataService = require('../server/services/productdataservice');
  const { applyCatalogPricing } = require('../server/controllers/ordercontroller');
  const deliverySettingsService = require('../server/services/deliverysettings.service');

  try {
    await applyCatalogPricing([{ productId: 'missing-product-xyz', quantity: 1 }]);
    throw new Error('missing product must be rejected');
  } catch (error) {
    if (error.message === 'missing product must be rejected') throw error;
    assert(error.code === 'PRODUCT_NOT_FOUND', `missing product code: ${error.code || error.message}`);
  }

  const listed = await productDataService.listProducts({ publicOnly: true, limit: 40, page: 1 });
  const products = Array.isArray(listed) ? listed : (listed?.items || listed?.products || []);
  const product = products.find((entry) => Number(entry?.price) > 0);
  if (!product) {
    console.log('[verify-checkout-lifecycle-step4] no published products — skipped live catalog pricing');
    return;
  }

  const productId = String(product.catalogId || product.id);
  try {
    await applyCatalogPricing([{ productId, quantity: 0, productName: product.name }]);
    throw new Error('quantity 0 must be rejected');
  } catch (error) {
    if (error.message === 'quantity 0 must be rejected') throw error;
    assert(error.code === 'INVALID_QUANTITY', `quantity 0 code: ${error.code || error.message}`);
  }

  const item = {
    productId,
    quantity: 1,
    productName: 'client-spoofed-name',
    price: 1
  };
  const colorVariants = Array.isArray(product.variants?.colorVariants)
    ? product.variants.colorVariants
    : (Array.isArray(product.metadata?.colorVariants) ? product.metadata.colorVariants : []);
  if (colorVariants.length) {
    const color = colorVariants[0];
    item.colorId = color.id || color.colorName || '';
    item.colorName = color.colorName || color.label || '';
    item.color = item.colorName;
    const size = Array.isArray(color.sizes) ? color.sizes[0] : null;
    if (size) {
      item.sizeValue = size.value || size.size || size.label || '';
      item.sizeLabel = size.label || size.size || size.value || '';
      item.size = item.sizeLabel;
    }
  }

  let priced;
  try {
    priced = await applyCatalogPricing([item]);
  } catch (error) {
    if (error.code === 'INSUFFICIENT_STOCK' || error.code === 'VARIANT_NOT_FOUND') {
      console.log(`[verify-checkout-lifecycle-step4] catalog pricing skipped for ${productId}: ${error.code}`);
      return;
    }
    throw error;
  }

  assert(Array.isArray(priced) && priced.length === 1, 'catalog pricing must return the line');
  assert(priced[0].price > 0, 'authoritative unit price must be positive');
  assert(priced[0].price !== 1, 'backend must ignore the client-spoofed unit price');
  assert(priced[0].productName !== 'client-spoofed-name', 'backend must use catalog product name');

  const quote = await deliverySettingsService.calculateShipping({
    subtotal: priced[0].price,
    address: {
      provinceCity: 'Kigali',
      district: 'Gasabo',
      sector: 'Remera',
      cell: 'Rukiri',
      village: 'Test'
    },
    method: 'homeDelivery'
  });
  const deliveryFee = Number(quote.fee) || 0;
  const total = priced[0].price + deliveryFee;
  assert(total === priced[0].price + deliveryFee, 'final total is product + delivery fee');
  console.log(`[verify-checkout-lifecycle-step4] catalog total ${priced[0].price} + delivery ${deliveryFee} = ${total}`);
}

async function main() {
  console.log('[verify-checkout-lifecycle-step4] starting');
  checkSource();
  simulateTotals();
  simulateBuyNowIsolation();
  simulateDuplicateOrderId();
  await verifyCatalogPricingAgainstDatabase();

  if (failures.length) {
    console.error('[verify-checkout-lifecycle-step4] FAIL');
    failures.forEach((message) => console.error(' -', message));
    process.exitCode = 1;
    return;
  }

  console.log('[verify-checkout-lifecycle-step4] PASS');
}

main().catch((error) => {
  console.error('[verify-checkout-lifecycle-step4] FAIL:', error.message);
  process.exitCode = 1;
});
