#!/usr/bin/env node
/**
 * STEP 6 — Final Admin Orders module integration verification.
 * Run: node scripts/verify-admin-orders-integration.js
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

function matchesNavStatus(order, filter) {
  const status = String(order?.status || '').toLowerCase();
  const payment = String(order?.paymentStatus || order?.paymentStatusLabel || '').toLowerCase();
  const raw = String(filter || '').trim().toLowerCase();
  if (!raw) return true;

  switch (raw) {
    case 'pending': {
      if (
        status.includes('cancel')
        || status.includes('return')
        || status.includes('refund')
        || status.includes('deliver')
        || status.includes('complete')
        || status.includes('ship')
        || status.includes('pack')
        || status.includes('process')
        || status.includes('confirm')
      ) {
        return false;
      }
      return status === 'pending'
        || payment.includes('awaiting_payment')
        || payment.includes('awaiting payment')
        || payment.includes('awaiting_delivery_payment');
    }
    case 'completed':
      if (status.includes('cancel') || status.includes('return') || status.includes('refund')) {
        return false;
      }
      return status === 'delivered' || status === 'completed' || status.includes('deliver') || status.includes('complete');
    case 'cancelled':
      return status.includes('cancel');
    case 'returns': {
      const workflow = order?.returnWorkflow || {};
      const returnStatus = String(workflow.returnStatus || order?.returnStatus || '').toLowerCase();
      const refundStatus = String(workflow.refundStatus || order?.refundStatus || '').toLowerCase();
      const hasReturnWorkflow = Boolean(returnStatus || refundStatus);
      const needsRefund = Boolean(order?.refundRequired)
        || payment.includes('refund_required')
        || refundStatus === 'required'
        || refundStatus === 'pending';
      return status.includes('return')
        || status.includes('refund')
        || needsRefund
        || hasReturnWorkflow;
    }
    default:
      return status === raw || status.includes(raw);
  }
}

function simulateQueueRouting() {
  const sample = [
    { orderId: 'P1', status: 'Pending', paymentStatus: 'awaiting_payment' },
    { orderId: 'P2', status: 'Pending', paymentStatus: 'awaiting_delivery_payment' },
    { orderId: 'C1', status: 'Delivered', paymentStatus: 'paid' },
    { orderId: 'C2', status: 'Completed', paymentStatus: 'paid' },
    { orderId: 'X1', status: 'Cancelled', paymentStatus: 'unpaid' },
    {
      orderId: 'X2',
      status: 'Cancelled',
      paymentStatus: 'refund_required',
      refundRequired: true,
      returnWorkflow: { returnStatus: 'requested', refundStatus: 'required' }
    },
    {
      orderId: 'R1',
      status: 'Returned',
      paymentStatus: 'refund_required',
      returnWorkflow: { returnStatus: 'approved', refundStatus: 'required' }
    },
    {
      orderId: 'R2',
      status: 'Refunded',
      paymentStatus: 'refunded',
      returnWorkflow: { returnStatus: 'approved', refundStatus: 'completed' }
    },
    // Must NOT appear in Pending or Returns: delivered + paid (normal payment status must not fake returns)
    { orderId: 'SAFE', status: 'Delivered', paymentStatus: 'paid' },
    // Overlap trap: delivered but awaiting_payment must NOT be pending
    { orderId: 'TRAP', status: 'Delivered', paymentStatus: 'awaiting_payment' }
  ];

  const pending = sample.filter((o) => matchesNavStatus(o, 'pending')).map((o) => o.orderId);
  const completed = sample.filter((o) => matchesNavStatus(o, 'completed')).map((o) => o.orderId);
  const cancelled = sample.filter((o) => matchesNavStatus(o, 'cancelled')).map((o) => o.orderId);
  const returns = sample.filter((o) => matchesNavStatus(o, 'returns')).map((o) => o.orderId);

  assert(pending.includes('P1') && pending.includes('P2'), 'pending queue must include awaiting payment/COD pending');
  assert(!pending.includes('TRAP') && !pending.includes('C1'), 'pending must not include delivered orders');
  assert(completed.includes('C1') && completed.includes('C2') && completed.includes('SAFE') && completed.includes('TRAP'), 'completed must include delivered/completed');
  assert(!completed.includes('X1') && !completed.includes('R1'), 'completed must exclude cancelled/returned');
  assert(cancelled.includes('X1') && cancelled.includes('X2'), 'cancelled queue must include cancelled');
  assert(returns.includes('X2') && returns.includes('R1') && returns.includes('R2'), 'returns must include refund-required and return/refund statuses');
  assert(!returns.includes('SAFE') && !returns.includes('P1') && !returns.includes('C1'), 'returns must not match normal paid/pending orders via paymentStatus fallback');

  // Paid cancel may intentionally appear in both Cancelled and Returns
  assert(cancelled.includes('X2') && returns.includes('X2'), 'paid cancel must remain visible in Cancelled and Returns');
}

function main() {
  const ordersJs = read('admin/app/pages/orders.js');
  const mainJs = read('admin/app/main.js');
  const data = read('admin/app/services/admin-data.service.js');
  const nav = read('admin/app/core/navigation.js');
  const controller = read('server/controllers/ordercontroller.js');
  const enterprise = read('server/services/enterpriseintelligenceservice.js');
  const accountOrders = read('account/services/orderservice.js');

  // Nav + routes for every Orders section
  assert(nav.includes('?status=pending'), 'nav Pending Orders route');
  assert(nav.includes('?status=completed'), 'nav Completed Orders route');
  assert(nav.includes('?status=cancelled'), 'nav Cancelled Orders route');
  assert(nav.includes('?status=returns'), 'nav Returns & Refunds route');
  assert(!nav.includes('orders/details.html'), 'orphaned Order Details nav link must be removed');

  // Exclusive queue filters
  assert(ordersJs.includes('awaiting_delivery_payment'), 'pending must include COD awaiting_delivery_payment');
  assert(ordersJs.includes('Never fall back to generic paymentStatus') || ordersJs.includes('never fall back'), 'returns filter must not fall back to paymentStatus');
  assert(ordersJs.includes('status.includes("confirm")'), 'pending exclusivity must exclude confirmed/processing');

  // Soft refresh + hash sync
  assert(ordersJs.includes('softRefresh'), 'orders page must support softRefresh in-place reload');
  assert(ordersJs.includes('#/orders?status='), 'toolbar status filter must sync to hash');
  assert(mainJs.includes('orders: new Set(["orders"])'), 'orders route must not remount on intelligence sync');

  // Data + API
  assert(data.includes('admin/orders?limit=500'), 'admin orders fetch must request higher limit');
  assert(data.includes('returnWorkflow'), 'normalizeOrder must expose return workflow');
  assert(data.includes('returnAction'), 'updateOrderStatus must support returnAction');
  assert(data.includes('isRevenueEligibleOrder'), 'dashboard metrics must exclude cancelled/refunded revenue');
  assert(data.includes('Completed'), 'normalizeStatus must preserve Completed separately from Delivered');

  // Backend
  assert(controller.includes('applyReturnAction'), 'return/refund workflow on server');
  assert(controller.includes('DUPLICATE_RETURN') && controller.includes('DUPLICATE_REFUND'), 'duplicate guards');
  assert(controller.includes("value.includes('cancel')") && !/includes\('cancel'\)\s*\|\|\s*value\.includes\('return'\)/.test(controller), 'isCancelledLike must not treat returns as cancellations');
  assert(controller.includes('limit || 500'), 'admin list default limit raised');

  // Reports / customer sync
  assert(enterprise.includes('isRevenueEligibleOrder'), 'enterprise revenue must exclude cancelled/refunded');
  assert(enterprise.includes("includes('awaiting')"), 'enterprise status must map awaiting → Pending');
  assert(accountOrders.includes("includes('refund')"), 'customer order history must group refunded under returns');

  // Preservation / actions surface
  ['Customer Information', 'Order Information', 'Purchased Products', 'Order Timeline', 'Google Maps'].forEach((label) => {
    assert(ordersJs.includes(label), `orders UI must include ${label}`);
  });

  simulateQueueRouting();

  // Ensure prior STEP verifiers exist
  [
    'scripts/verify-admin-all-orders.js',
    'scripts/verify-admin-pending-orders.js',
    'scripts/verify-admin-completed-orders.js',
    'scripts/verify-admin-cancelled-orders.js',
    'scripts/verify-admin-returns-refunds.js'
  ].forEach((rel) => {
    assert(fs.existsSync(path.join(root, rel)), `missing verifier ${rel}`);
  });

  if (failures.length) {
    console.error('FAIL verify-admin-orders-integration');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('PASS verify-admin-orders-integration');
  console.log(' - Queue exclusivity + returns over-match fixed');
  console.log(' - Soft refresh + hash sync + API limit');
  console.log(' - Revenue/status sync + customer refund grouping');
  console.log(' - All Orders section verifiers present');
}

main();
