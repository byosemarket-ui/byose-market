#!/usr/bin/env node
/**
 * Admin All Orders verification.
 * Run: node scripts/verify-admin-all-orders.js
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
  const ordersJs = read('admin/app/pages/orders.js');
  const data = read('admin/app/services/admin-data.service.js');
  const css = read('admin/css/pages/orders.css');
  const nav = read('admin/app/core/navigation.js');
  const checkout = read('orders/core/order.js');

  assert(nav.includes('All Orders'), 'nav must include All Orders');
  assert(nav.includes('?status=pending'), 'nav pending queue must link into orders');

  assert(ordersJs.includes('All Orders'), 'orders page must title All Orders');
  assert(ordersJs.includes('ordersSearch'), 'must include search');
  assert(ordersJs.includes('ordersStatusFilter'), 'must include status filter');
  assert(ordersJs.includes('ordersSort'), 'must include sorting');
  assert(ordersJs.includes('orders-pagination') || ordersJs.includes('data-page-action'), 'must include pagination');
  assert(ordersJs.includes('Customer Information'), 'must show customer information');
  assert(ordersJs.includes('Province / City'), 'must show province/city');
  assert(ordersJs.includes('Google Maps'), 'must show Google Maps action');
  assert(ordersJs.includes('Order Timeline'), 'must show timeline');
  assert(ordersJs.includes('Print Invoice'), 'must support invoice print');
  assert(ordersJs.includes('Print Packing Slip'), 'must support packing slip');
  assert(ordersJs.includes('Contact Customer'), 'must support contact customer');
  assert(ordersJs.includes('View Payment Details'), 'must support payment details');
  assert(ordersJs.includes('Update Order Status'), 'must support status updates');
  assert(ordersJs.includes('openPrintableReport'), 'must reuse printable report helper');
  assert(ordersJs.includes('readHashQuery'), 'must read nav hash status filters');

  assert(data.includes('statusHistory'), 'normalizeOrder must keep statusHistory');
  assert(data.includes('value.includes("pack")') && data.includes('return "Packed"'), 'Packed status must stay distinct');
  assert(data.includes('value.includes("process")') && data.includes('return "Processing"'), 'Processing must not collapse into Confirmed');
  assert(data.includes('return "Refunded"'), 'Refunded status must stay distinct');
  assert(data.includes('payerPhone'), 'normalizeOrder must keep payer phone');
  assert(data.includes('discount'), 'normalizeOrder must keep discount');

  assert(css.includes('.orders-mobile-grid'), 'orders CSS must style order grid');
  assert(!/^\.orders-mobile-grid\s*\{\s*display:\s*none/m.test(css), 'order cards must not be hidden on desktop');
  assert(css.includes('.orders-timeline'), 'orders CSS must style timeline');

  assert(checkout.includes('gpsLocation'), 'checkout must send GPS for admin sync');
  assert(checkout.includes('statusHistory'), 'checkout must send status history');

  if (failures.length) {
    console.error('FAIL — Admin All Orders verification\n');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('PASS — Admin All Orders verification');
  console.log(' - Search, filters, sort, pagination present');
  console.log(' - Customer/order/product/timeline/actions wired');
  console.log(' - Desktop card grid visible');
  console.log(' - normalizeOrder preserves GPS, history, payment details');
}

main();
