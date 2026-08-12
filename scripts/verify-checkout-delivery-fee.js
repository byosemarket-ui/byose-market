#!/usr/bin/env node
/**
 * Ensures checkout uses the configured delivery fee only (2000 RWF),
 * not zone quotes or delivery-method surcharges (3500 RWF).
 * Run: node scripts/verify-checkout-delivery-fee.js
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function checkSource() {
  const html = read('orders/shipping.html');
  const shippingJs = read('orders/shipping.js');
  const constants = read('orders/core/constants.js');
  const state = read('orders/core/state.js');
  const order = read('orders/core/order.js');
  const service = read('server/services/deliverysettings.service.js');
  const controller = read('server/controllers/ordercontroller.js');
  const api = read('orders/shipping-api.js');

  assert(!/Delivery Method/i.test(html), 'shipping.html still has Delivery Method');
  assert(!/Home Delivery/i.test(html), 'shipping.html still has Home Delivery');
  assert(!/deliveryMethodKey/.test(html), 'shipping.html still has deliveryMethodKey');
  assert(!/3500/.test(html), 'shipping.html must not hardcode 3500');
  assert(!shippingJs.includes('loadDeliveryMethods'), 'shipping.js still loads delivery methods');
  assert(!shippingJs.includes('refreshShippingQuote'), 'shipping.js still quotes method/zone fees');
  assert(constants.includes('DELIVERY_FEE = 2000'), 'configured fallback fee must remain 2000');
  assert(!constants.includes('deliveryMethodKey'), 'required shipping fields must not include deliveryMethodKey');
  assert(state.includes('applyConfiguredDeliveryFee'), 'checkout state must apply configured fee');
  assert(!state.includes("deliveryMethodKey === 'storePickup' ? 0"), 'pickup must not zero the delivery fee');
  assert(order.includes("deliveryLabel: 'Delivery to address'"), 'orders must always be delivery to address');
  assert(service.includes('configured delivery fee only'), 'calculateShipping must use configured fee');
  assert(!service.includes('baseFee + toNumber(methodConfig.feeModifier'), 'method feeModifier must not be added');
  assert(controller.includes("method: 'homeDelivery'"), 'createOrder must not take client delivery-method fees');
  assert(api.includes('pricing.fixedFee'), 'storefront default fee must use configured fixedFee');
  assert(!api.includes('firstZone'), 'storefront default fee must not use the first zone fee');
}

async function checkServiceFee() {
  const { connectDatabase } = require('../server/database');
  await connectDatabase();
  const deliverySettingsService = require('../server/services/deliverysettings.service');
  const config = await deliverySettingsService.getDeliveryConfig();
  const expected = Number(config.pricing.fixedFee);
  assert(Number.isFinite(expected) && expected >= 0, 'configured fixedFee must exist');
  assert(expected === 2000, `configured fixedFee should be 2000, got ${expected}`);

  const quote = await deliverySettingsService.calculateShipping({
    subtotal: 23000,
    address: {
      country: 'Rwanda',
      provinceCity: 'Kigali City',
      district: 'Gasabo',
      sector: 'Kimironko',
      cell: 'Bibare',
      village: 'Test Village'
    },
    method: 'homeDelivery'
  });

  assert(quote.fee === 2000, `Kigali quote must be 2000, got ${quote.fee}`);
  assert(quote.fee !== 3500, 'Kigali quote must not be 3500');
  assert(23000 + quote.fee === 25000, 'product 23000 + delivery 2000 must equal 25000');
}

async function main() {
  checkSource();
  await checkServiceFee();
  if (failures.length) {
    console.error('[verify-checkout-delivery-fee] FAIL');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }
  console.log('[verify-checkout-delivery-fee] PASS configured fee=2000, no 3500 surcharge');
}

main().catch((error) => {
  console.error('[verify-checkout-delivery-fee] FAIL:', error.message);
  process.exit(1);
});
