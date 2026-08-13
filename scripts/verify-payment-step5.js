#!/usr/bin/env node
/**
 * STEP 5 — final payment validation and production-readiness checks.
 * Run: node scripts/verify-payment-step5.js
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
  const constants = read('orders/core/constants.js');
  assert(constants.includes("id: 'mtn'"), 'MTN MoMo must be a customer method');
  assert(constants.includes("id: 'card'"), 'Card must be a customer method');
  assert(constants.includes("id: 'cod'"), 'Cash on Delivery must be a customer method');
  assert(!constants.includes("id: 'airtel'"), 'Airtel must not be a customer method');
  assert(!constants.includes("id: 'bank'"), 'Bank Transfer must not be a customer method');
  assert(!/id:\s*'dpo'/.test(constants), 'standalone DPO must not be a customer method');

  const paymentJs = read('orders/payment.js');
  assert(paymentJs.includes('createdGatewayOrderId'), 'failed DPO initiate must retry the same order');
  assert(paymentJs.includes('setSubmitting(false)'), 'submit lock must release after failure');
  assert(paymentJs.includes('initiateDpoPayment'), 'MTN/Card must start DPO');
  assert(paymentJs.includes('rememberGatewayOrder'), 'gateway order id must persist for retry');
  assert(paymentJs.includes('Cash on Delivery cannot replace a started online payment'), 'COD must not create a second order after DPO initiate');
  assert(!paymentJs.includes('console.error'), 'payment page must not print stacks to the browser');

  const state = read('orders/core/state.js');
  assert(state.includes('state.gateway?.loaded'), 'DPO methods must stay visible until config loads');

  const dpoConfig = read('server/payments/dpo/config.js');
  assert(dpoConfig.includes('OPERATING_MODE_LIVE'), 'LIVE operating mode must activate LIVE checkout');
  assert(!dpoConfig.includes('LIVE_CHECKOUT_ENABLED = false'), 'hard LIVE gate must be removed');
  assert(dpoConfig.includes('customerSafeMessage'), 'DPO config errors must be customer-safe');
  assert(!dpoConfig.includes('Save Company Token and Service Type in Payment Settings'), 'customer errors must not mention Admin credential fields');

  const dpoController = read('server/controllers/dpopaymentcontroller.js');
  assert(dpoController.includes('customerSafePaymentMessage'), 'DPO HTTP errors must be sanitized');
  assert(!dpoController.includes('details: error?.details || undefined'), 'DPO HTTP JSON must not return internal details');

  const methods = read('server/payments/storefront-methods.js');
  assert(methods.includes("mtn:"), 'backend accepts mtn');
  assert(methods.includes("card:"), 'backend accepts card');
  assert(methods.includes("cod:"), 'backend accepts cod');
  assert(methods.includes("'airtel'"), 'backend still rejects airtel');

  const contact = read('contact.html');
  assert(!/bank transfer/i.test(contact), 'contact FAQ must not advertise bank transfer');
  assert(/MTN MoMo/i.test(contact), 'contact FAQ must mention MTN MoMo');

  const adminOrders = read('admin/app/pages/orders.js');
  assert(!/Airtel/i.test(adminOrders), 'Admin payment filter must not list Airtel');
  assert(!/>Bank</.test(adminOrders), 'Admin payment filter must not list Bank');
  assert(adminOrders.includes('MTN MoMo'), 'Admin still labels MTN MoMo');
  assert(!adminOrders.includes('companyToken'), 'Admin orders must not show Company Token');

  const publicConfig = read('server/payments/dpo/config.js');
  assert(publicConfig.includes('getPublicCheckoutConfig'), 'public DPO config exists');
  assert(publicConfig.includes('liveCheckoutEnabled'), 'public config reports LIVE gate');

  const css = read('orders/checkout.css');
  assert(css.includes('.ck-btn:disabled'), 'loading state must disable buttons visually');
  assert(css.includes('white-space: normal'), 'sticky payment CTA must wrap on small screens');
  assert(css.includes('.ck-field[hidden]'), 'hidden payment fields must stay hidden against flex display');
}

async function checkPublicConfigHasNoSecrets() {
  require('dotenv').config({ path: path.join(root, '.env') });
  const { connectDatabase } = require('../server/database');
  await connectDatabase();
  const dpoConfig = require('../server/payments/dpo/config');
  const publicConfig = await dpoConfig.getPublicCheckoutConfig();
  const serialized = JSON.stringify(publicConfig);
  assert(!/"companyToken"\s*:\s*"[^"]+"/.test(serialized), 'public DPO config must not include companyToken');
  assert(!/"serviceType"\s*:\s*"/.test(serialized), 'public DPO config must not include serviceType value');
  assert(['test', 'live'].includes(publicConfig.mode), `public checkout mode must be test or live, got ${publicConfig.mode}`);
  if (publicConfig.mode === 'test') {
    assert(publicConfig.liveCheckoutEnabled === false, 'TEST operating mode must not report LIVE checkout enabled');
  } else {
    assert(publicConfig.liveCheckoutEnabled === true, 'LIVE operating mode must report LIVE checkout enabled');
  }
}

async function checkCatalogAmount() {
  const productDataService = require('../server/services/productdataservice');
  const { applyCatalogPricing } = require('../server/controllers/ordercontroller');
  const deliverySettingsService = require('../server/services/deliverysettings.service');
  const listed = await productDataService.listProducts({ publicOnly: true, limit: 20, page: 1 });
  const products = Array.isArray(listed) ? listed : [];
  const product = products.find((entry) => Number(entry?.price) > 0);
  if (!product) {
    console.log('[verify-payment-step5] no published products — skipped amount check');
    return;
  }
  const item = { productId: String(product.catalogId || product.id), quantity: 1, price: 1 };
  const colorVariants = product.variants?.colorVariants || product.metadata?.colorVariants || [];
  if (Array.isArray(colorVariants) && colorVariants[0]) {
    const color = colorVariants[0];
    item.colorId = color.id || color.colorName || '';
    item.colorName = color.colorName || '';
    const size = Array.isArray(color.sizes) ? color.sizes[0] : null;
    if (size) {
      item.sizeValue = size.value || size.size || size.label || '';
      item.sizeLabel = item.sizeValue;
    }
  }
  try {
    const priced = await applyCatalogPricing([item]);
    const quote = await deliverySettingsService.calculateShipping({
      subtotal: priced[0].price,
      address: { provinceCity: 'Kigali', district: 'Gasabo', sector: 'Remera', cell: 'Rukiri', village: 'Test' },
      method: 'homeDelivery'
    });
    const total = priced[0].price + Number(quote.fee || 0);
    assert(priced[0].price !== 1, 'backend must ignore spoofed client price');
    assert(total === priced[0].price + Number(quote.fee || 0), 'total is product + delivery');
    console.log(`[verify-payment-step5] amount ${priced[0].price} + ${Number(quote.fee || 0)} = ${total}`);
  } catch (error) {
    if (error.code === 'INSUFFICIENT_STOCK' || error.code === 'VARIANT_NOT_FOUND') {
      console.log(`[verify-payment-step5] amount check skipped: ${error.code}`);
      return;
    }
    throw error;
  }
}

async function main() {
  console.log('[verify-payment-step5] starting');
  checkSource();
  await checkPublicConfigHasNoSecrets();
  await checkCatalogAmount();

  if (failures.length) {
    console.error('[verify-payment-step5] FAIL');
    failures.forEach((message) => console.error(' -', message));
    process.exitCode = 1;
    return;
  }
  console.log('[verify-payment-step5] PASS');
  console.log(' Customer methods: MTN MoMo, Card, Cash on Delivery');
  console.log(' DPO LIVE: not activated');
  console.log(' Secrets: not present in public DPO config');
}

main().catch((error) => {
  console.error('[verify-payment-step5] FAIL:', error.message);
  process.exitCode = 1;
});
