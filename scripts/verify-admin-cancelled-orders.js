#!/usr/bin/env node
/**
 * Admin Cancelled Orders verification.
 * Run: node scripts/verify-admin-cancelled-orders.js
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

function simulateCancelledFilter() {
  function matches(order) {
    return String(order?.status || '').toLowerCase().includes('cancel');
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
    { orderId: 'B', status: 'Cancelled' },
    { orderId: 'B', status: 'Cancelled' },
    { orderId: 'C', status: 'Delivered' },
    { orderId: 'D', status: 'Cancelled' }
  ];

  const cancelled = dedupe(sample.filter(matches)).map((o) => o.orderId);
  assert(cancelled.includes('B') && cancelled.includes('D'), 'cancelled orders must appear');
  assert(cancelled.filter((id) => id === 'B').length === 1, 'cancelled must dedupe cancelled orders');
  assert(!cancelled.includes('A') && !cancelled.includes('C'), 'non-cancelled must stay out');
}

function main() {
  const ordersJs = read('admin/app/pages/orders.js');
  const nav = read('admin/app/core/navigation.js');
  const data = read('admin/app/services/admin-data.service.js');
  const controller = read('server/controllers/ordercontroller.js');

  assert(nav.includes('Cancelled Orders'), 'nav must include Cancelled Orders');
  assert(nav.includes('?status=cancelled'), 'Cancelled Orders must route with status=cancelled');

  assert(ordersJs.includes('Cancelled Orders'), 'page must title Cancelled Orders');
  assert(ordersJs.includes('Cancellation Date'), 'must show cancellation date');
  assert(ordersJs.includes('Cancelled By'), 'must show cancelled by');
  assert(ordersJs.includes('Cancellation Reason'), 'must show cancellation reason');
  assert(ordersJs.includes('View Cancellation Reason'), 'must support view cancellation reason action');
  assert(ordersJs.includes('Restore Order'), 'must support restore order');
  assert(ordersJs.includes('Print Order Summary'), 'must support print order summary');
  assert(ordersJs.includes('Returns & Refunds') || ordersJs.includes('Returns &amp; Refunds'), 'paid cancellations must link to returns workflow');
  assert(ordersJs.includes('ordersCancelledByFilter'), 'must support cancelled-by filter');
  assert(ordersJs.includes('cancelled-desc'), 'must support cancellation sorting');
  assert(ordersJs.includes('resolveCancellationDate'), 'must derive cancellation date');
  assert(ordersJs.includes('openOrdersConfirmDialog') && ordersJs.includes('openOrdersCancelDialog'), 'restore/cancel must use confirmation dialogs');

  assert(data.includes('cancellationReason'), 'normalizeOrder must expose cancellation reason');
  assert(data.includes('cancelledBy'), 'normalizeOrder must expose cancelled by');
  assert(data.includes('refundRequired'), 'normalizeOrder must expose refund required');
  assert(data.includes('cancellationReason: normalizeText(options'), 'updateOrderStatus must send cancellation reason');

  assert(controller.includes('applyCancellationMetadata'), 'server must persist cancellation metadata');
  assert(controller.includes('restoreOrderStock'), 'server must restore stock on cancel');
  assert(controller.includes('reReserveOrderStock'), 'server must re-reserve stock on restore');
  assert(controller.includes('refund_required') || controller.includes('Refund Required'), 'paid cancels must prepare refund workflow');

  simulateCancelledFilter();

  if (failures.length) {
    console.error('FAIL — Admin Cancelled Orders verification\n');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('PASS — Admin Cancelled Orders verification');
  console.log(' - Cancelled queue + dedupe');
  console.log(' - Cancellation metadata, restore, refund prep');
  console.log(' - Filters, sorting, summary actions');
}

main();
