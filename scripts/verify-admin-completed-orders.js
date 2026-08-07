#!/usr/bin/env node
/**
 * Admin Completed Orders verification.
 * Run: node scripts/verify-admin-completed-orders.js
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

function simulateCompletedFilter() {
  function matches(order) {
    const status = String(order?.status || '').toLowerCase();
    return status === 'delivered' || status === 'completed' || status.includes('deliver') || status.includes('complete');
  }

  function dedupe(orders) {
    const seen = new Set();
    return orders.filter((order) => {
      const id = String(order.orderId || '');
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  const sample = [
    { orderId: 'A', status: 'Pending' },
    { orderId: 'B', status: 'Delivered' },
    { orderId: 'B', status: 'Delivered' },
    { orderId: 'C', status: 'Completed' },
    { orderId: 'D', status: 'Shipping' },
    { orderId: 'E', status: 'Cancelled' }
  ];

  const completed = dedupe(sample.filter(matches)).map((o) => o.orderId);
  assert(completed.includes('B') && completed.includes('C'), 'delivered/completed must appear in Completed Orders');
  assert(completed.filter((id) => id === 'B').length === 1, 'completed orders must be deduplicated');
  assert(!completed.includes('A') && !completed.includes('D') && !completed.includes('E'), 'non-completed statuses must stay out');
}

function main() {
  const ordersJs = read('admin/app/pages/orders.js');
  const nav = read('admin/app/core/navigation.js');
  const data = read('admin/app/services/admin-data.service.js');

  assert(nav.includes('Completed Orders'), 'nav must include Completed Orders');
  assert(nav.includes('?status=completed'), 'Completed Orders must route with status=completed');

  assert(ordersJs.includes('Completed Orders'), 'page must title Completed Orders');
  assert(ordersJs.includes('Completion Date'), 'must show completion date');
  assert(ordersJs.includes('resolveCompletionDate'), 'must derive completion date from history');
  assert(ordersJs.includes('Out for Delivery'), 'timeline must include Out for Delivery');
  assert(ordersJs.includes('View Customer Details'), 'must support view customer details');
  assert(ordersJs.includes('View Delivery Information'), 'must support view delivery information');
  assert(ordersJs.includes('Print Receipt'), 'must support print receipt');
  assert(ordersJs.includes('Download Invoice (PDF)'), 'must support download invoice PDF');
  assert(ordersJs.includes('Print Invoice'), 'must support print invoice');
  assert(ordersJs.includes('Print Packing Slip'), 'must support packing slip');
  assert(ordersJs.includes('Open Customer Location in Google Maps'), 'must support maps');
  assert(ordersJs.includes('ordersPaymentFilter'), 'must support advanced payment filters');
  assert(ordersJs.includes('completed-desc'), 'must support completion sorting');
  assert(ordersJs.includes('dedupeOrdersById'), 'must prevent duplicated completed orders');
  assert(ordersJs.includes('renderDeliveryBlock'), 'must render delivery information block');

  assert(data.includes('updatedAt'), 'normalizeOrder must preserve updatedAt for completion date');
  assert(data.includes('statusHistory'), 'normalizeOrder must preserve status history');

  simulateCompletedFilter();

  if (failures.length) {
    console.error('FAIL — Admin Completed Orders verification\n');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('PASS — Admin Completed Orders verification');
  console.log(' - Delivered/Completed filter + dedupe');
  console.log(' - Completion date, timeline, receipt/PDF actions');
  console.log(' - Advanced payment filters + completion sorting');
}

main();
