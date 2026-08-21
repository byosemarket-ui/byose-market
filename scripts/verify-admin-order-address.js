#!/usr/bin/env node
/**
 * Admin order address mapping verification.
 * Run: node scripts/verify-admin-order-address.js
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

async function main() {
  const ordersJs = read('admin/app/pages/orders.js');
  const invoiceJs = read('admin/app/services/invoice-document.service.js');
  const dataJs = read('admin/app/services/admin-data.service.js');
  const controller = read('server/controllers/ordercontroller.js');
  const utilJs = read('admin/app/utils/order-address.js');
  const orderJs = read('orders/core/order.js');
  const stateJs = read('orders/core/state.js');
  const verifyJs = read('invoice-verify.js');
  const invoiceVerifyService = read('server/services/invoice-verification.service.js');

  assert(ordersJs.includes('from "../utils/order-address.js"'), 'Review Information must use the shared address resolver');
  assert(!/function\s+resolveOrderCustomer\s*\(/.test(ordersJs), 'orders.js must not redeclare imported resolveOrderCustomer');
  assert(invoiceJs.includes('from "../utils/order-address.js"'), 'View Invoice must use the shared address resolver');
  assert(dataJs.includes('applyCanonicalAddress'), 'Admin order normalization must apply canonical address fields');
  assert(utilJs.includes('ship.cellName') && utilJs.includes('full.cellName'), 'resolver must accept cell aliases');
  assert(controller.includes('function locationText'), 'backend must extract location names from objects/aliases');
  assert(controller.includes('incomingFull.cellName'), 'backend must persist cell from aliases and fullAddress');
  assert(controller.includes('street,'), 'backend order snapshot must persist street');
  assert(orderJs.includes('street: state.shipping.street'), 'checkout order payload must include street');
  assert(stateJs.includes("street: ''"), 'checkout shipping state must include street');
  assert(ordersJs.includes('refreshReviewDrawerFromApi'), 'Review Information must refresh the selected order from the API');
  assert(!ordersJs.includes('uniqueReviewText'), 'Review Information must not unique-dedupe hierarchy fields');
  assert(!invoiceJs.includes('uniqueText(') && !invoiceJs.includes('function uniqueText'), 'Invoice must not unique-dedupe hierarchy fields');
  assert(ordersJs.includes('formatResolvedAddressLine'), 'Admin detail/delivery helpers must share one address formatter');
  assert(ordersJs.includes('resolveOrderAddress(order)'), 'Admin delivery/copy paths must use resolveOrderAddress');
  assert(!ordersJs.includes('|| order?.shippingAddress?.note'), 'internal notes must not reuse delivery landmark');
  assert(invoiceJs.includes('Landmark / Note'), 'invoice customer column must show landmark when present');
  assert(invoiceVerifyService.includes('toLimitedVerification'), 'public QR verification stays limited');
  assert(!verifyJs.includes('shippingAddress') && !verifyJs.includes('village'), 'public QR page must not expose delivery address');

  const { resolveOrderAddress, extractAddressText } = await import('../admin/app/utils/order-address.js');
  const { buildInvoiceHtml } = await import('../admin/app/services/invoice-document.service.js');

  assert(extractAddressText({ name: 'Gatenga' }) === 'Gatenga', 'nested name objects must resolve to display text');
  assert(extractAddressText('[object Object]') === '', '[object Object] must not be shown');

  const colliding = resolveOrderAddress({
    shippingAddress: {
      fullName: 'Test Customer',
      provinceCity: 'Kigali City',
      district: 'Kicukiro',
      sector: 'Gatenga',
      cell: 'Gatenga',
      village: 'Gatenga',
      street: 'Near the market',
      note: 'Near the market'
    }
  });
  assert(colliding.sector === 'Gatenga' && colliding.cell === 'Gatenga' && colliding.village === 'Gatenga', 'matching Cell/Village/Sector names must all remain visible');
  assert(colliding.street === 'Near the market' && colliding.landmark === 'Near the market', 'street and landmark must both remain even when equal');

  const aliased = resolveOrderAddress({
    shippingAddress: {
      provinceCity: 'Southern Province',
      district: 'Huye',
      sector: 'Ngoma',
      cellName: 'Butare',
      villageName: 'Cyarwa'
    }
  });
  assert(aliased.cell === 'Butare' && aliased.village === 'Cyarwa', 'cellName/villageName aliases must display');

  const nested = resolveOrderAddress({
    shippingAddress: {
      provinceCity: 'Kigali City',
      district: 'Gasabo',
      sector: 'Remera',
      cell: { name: 'Rukiri I' },
      village: { label: 'Gishushu' }
    }
  });
  assert(nested.cell === 'Rukiri I' && nested.village === 'Gishushu', 'object cell/village values must display their names');

  const fromFull = resolveOrderAddress({
    shippingAddress: { provinceCity: 'Kigali City', district: 'Nyarugenge', sector: 'Nyamirambo' },
    fullAddress: { cell: 'Mumena', village: 'Kavumu', street: 'KN 2 Ave' }
  });
  assert(fromFull.cell === 'Mumena' && fromFull.village === 'Kavumu', 'values stored only on fullAddress must still display');
  assert(fromFull.street === 'KN 2 Ave', 'street stored only on fullAddress must still display');

  const missing = resolveOrderAddress({
    shippingAddress: { provinceCity: 'Kigali City', district: 'Kicukiro', sector: 'Gikondo' }
  });
  assert(!missing.cell && !missing.village, 'genuinely missing cell/village must stay empty');

  const company = { storeName: 'BYOSE Market', origin: 'https://byosemarket.com', currency: 'RWF', primary: '#00B894' };
  const htmlA = buildInvoiceHtml({
    orderId: 'BM-ADDR-A',
    shippingAddress: {
      fullName: 'Alice',
      provinceCity: 'Kigali City',
      district: 'Kicukiro',
      sector: 'Gatenga',
      cell: 'Gatenga',
      village: 'Karambo',
      note: 'Blue gate'
    }
  }, { company });
  const htmlB = buildInvoiceHtml({
    orderId: 'BM-ADDR-B',
    shippingAddress: {
      fullName: 'Bob',
      provinceCity: 'Southern Province',
      district: 'Huye',
      sector: 'Ngoma',
      cell: 'Butare',
      village: 'Cyarwa'
    }
  }, { company });
  assert(htmlA.includes('Gatenga') && htmlA.includes('Karambo'), 'invoice A must show its cell and village');
  assert(htmlA.includes('Blue gate'), 'invoice A must show landmark from order snapshot');
  assert(htmlB.includes('Butare') && htmlB.includes('Cyarwa'), 'invoice B must show its cell and village');
  assert(!htmlA.includes('Cyarwa') && !htmlB.includes('Karambo'), 'invoice address data must stay order-specific');
  assert(!htmlB.includes('Blue gate'), 'invoice B must not inherit order A landmark');

  if (failures.length) {
    console.error('FAIL verify-admin-order-address');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('PASS verify-admin-order-address');
  console.log(' - Shared Review/Invoice/Delivery address resolver');
  console.log(' - Duplicate hierarchy names remain visible');
  console.log(' - Historical order snapshots stay order-specific');
}

main().catch((error) => {
  console.error('FAIL verify-admin-order-address');
  console.error(error);
  process.exit(1);
});
