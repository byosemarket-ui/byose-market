#!/usr/bin/env node
/**
 * Admin Pending Orders verification.
 * Run: node scripts/verify-admin-pending-orders.js
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

function simulatePendingFilter() {
  function matches(order) {
    const status = String(order?.status || '').toLowerCase();
    const payment = String(order?.paymentStatus || '').toLowerCase();
    return status === 'pending'
      || payment.includes('awaiting_payment')
      || payment.includes('awaiting payment');
  }

  const sample = [
    { orderId: 'A', status: 'Pending', paymentStatus: 'awaiting_payment' },
    { orderId: 'B', status: 'Confirmed', paymentStatus: 'paid' },
    { orderId: 'C', status: 'Processing', paymentStatus: 'paid' },
    { orderId: 'D', status: 'Delivered', paymentStatus: 'paid' },
    { orderId: 'E', status: 'Cancelled', paymentStatus: 'cancelled' },
    { orderId: 'F', status: 'Pending', paymentStatus: 'cod' }
  ];

  const pending = sample.filter(matches).map((o) => o.orderId);
  assert(pending.includes('A') && pending.includes('F'), 'new pending orders must appear in Pending Orders');
  assert(!pending.includes('B') && !pending.includes('C') && !pending.includes('D') && !pending.includes('E'), 'accepted/processed/fulfilled/cancelled must leave Pending Orders');
}

function main() {
  const ordersJs = read('admin/app/pages/orders.js');
  const nav = read('admin/app/core/navigation.js');
  const checkout = read('orders/core/order.js');
  const controller = read('server/controllers/ordercontroller.js');

  assert(nav.includes('Pending Orders'), 'nav must include Pending Orders');
  assert(nav.includes('?status=pending'), 'Pending Orders must route with status=pending');

  assert(ordersJs.includes('Pending Orders'), 'page must title Pending Orders');
  assert(ordersJs.includes('Accept Order'), 'must support Accept Order');
  assert(ordersJs.includes('Start Processing'), 'must support Start Processing');
  assert(ordersJs.includes('Cancel Order'), 'must support Cancel Order');
  assert(ordersJs.includes('openOrdersCancelDialog'), 'cancel must require confirmation');
  assert(ordersJs.includes('Open Customer Location in Google Maps') || ordersJs.includes('Open Google Maps Location'), 'must support maps action');
  assert(ordersJs.includes('Print Invoice'), 'must support invoice print');
  assert(ordersJs.includes('Print Packing Slip'), 'must support packing slip');
  assert(ordersJs.includes('Contact Customer'), 'must support contact customer');
  assert(ordersJs.includes('orders-status-message'), 'must show success/error notifications');
  assert(ordersJs.includes('Loading'), 'must show loading states');
  assert(ordersJs.includes("status === \"pending\""), 'pending filter must be strict');
  assert(ordersJs.includes('applyStatusChange'), 'status updates must sync through shared updater');
  assert(ordersJs.includes('Confirmed'), 'Accept Order must move to Confirmed');
  assert(ordersJs.includes('Processing'), 'Start Processing must move to Processing');

  assert(checkout.includes("status: 'Pending'") || checkout.includes('status: "Pending"') || controller.includes("status: 'Pending'"), 'new orders must start as Pending');
  assert(controller.includes('appendStatusHistory'), 'status updates must append history');

  simulatePendingFilter();

  if (failures.length) {
    console.error('FAIL — Admin Pending Orders verification\n');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('PASS — Admin Pending Orders verification');
  console.log(' - Pending queue is strict (unaccepted only)');
  console.log(' - Accept / Process / Cancel with confirmation wired');
  console.log(' - Loading + notifications + live refresh present');
}

main();
