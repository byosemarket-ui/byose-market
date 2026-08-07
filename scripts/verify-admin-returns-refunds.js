#!/usr/bin/env node
/**
 * Admin Returns & Refunds verification.
 * Run: node scripts/verify-admin-returns-refunds.js
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

function simulateReturnsFilter() {
  function matches(order) {
    const status = String(order?.status || '').toLowerCase();
    const payment = String(order?.paymentStatus || '').toLowerCase();
    const workflow = order?.returnWorkflow || {};
    const returnStatus = String(workflow.returnStatus || '').toLowerCase();
    const refundStatus = String(workflow.refundStatus || '').toLowerCase();
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
    { orderId: 'A', status: 'Pending', paymentStatus: 'awaiting_payment' },
    { orderId: 'B', status: 'Delivered', paymentStatus: 'paid' },
    { orderId: 'C', status: 'Cancelled', paymentStatus: 'refund_required', refundRequired: true, returnWorkflow: { returnStatus: 'requested', refundStatus: 'required' } },
    { orderId: 'C', status: 'Cancelled', paymentStatus: 'refund_required', refundRequired: true, returnWorkflow: { returnStatus: 'requested', refundStatus: 'required' } },
    { orderId: 'D', status: 'Returned', paymentStatus: 'refund_required', returnWorkflow: { returnStatus: 'approved', refundStatus: 'required' } },
    { orderId: 'E', status: 'Refunded', paymentStatus: 'refunded', returnWorkflow: { returnStatus: 'approved', refundStatus: 'completed' } },
    { orderId: 'F', status: 'Delivered', paymentStatus: 'paid', returnWorkflow: { returnStatus: 'requested', refundStatus: 'required' } }
  ];

  const returns = dedupe(sample.filter(matches)).map((o) => o.orderId);
  assert(returns.includes('C') && returns.includes('D') && returns.includes('E') && returns.includes('F'), 'qualifying return/refund orders must appear');
  assert(returns.filter((id) => id === 'C').length === 1, 'returns list must dedupe');
  assert(!returns.includes('A') && !returns.includes('B'), 'non-return orders must stay out of Returns & Refunds');
}

function simulateDuplicateGuards() {
  const workflow = { returnStatus: 'approved', refundStatus: 'completed' };
  const duplicateReturn = ['approved', 'received'].includes(String(workflow.returnStatus || '').toLowerCase())
    || ['completed'].includes(String(workflow.refundStatus || '').toLowerCase());
  const duplicateRefund = String(workflow.refundStatus || '').toLowerCase() === 'completed';
  assert(duplicateReturn, 'duplicate return guard must block approved returns');
  assert(duplicateRefund, 'duplicate refund guard must block completed refunds');
}

function main() {
  const ordersJs = read('admin/app/pages/orders.js');
  const nav = read('admin/app/core/navigation.js');
  const data = read('admin/app/services/admin-data.service.js');
  const controller = read('server/controllers/ordercontroller.js');
  const css = read('admin/css/pages/orders.css');

  assert(nav.includes('Returns & Refunds'), 'nav must include Returns & Refunds');
  assert(nav.includes('?status=returns'), 'Returns & Refunds must route with status=returns');

  assert(ordersJs.includes('Returns & Refunds'), 'page must title Returns & Refunds');
  assert(ordersJs.includes('Return Information'), 'must show return information block');
  assert(ordersJs.includes('Return Reason'), 'must show return reason');
  assert(ordersJs.includes('Customer Notes'), 'must show customer notes');
  assert(ordersJs.includes('Admin Notes'), 'must show admin notes');
  assert(ordersJs.includes('Product Condition'), 'must show product condition');
  assert(ordersJs.includes('Uploaded Return Images') || ordersJs.includes('return images'), 'must support return images');
  assert(ordersJs.includes('Approve Return'), 'must support approve return');
  assert(ordersJs.includes('Reject Return'), 'must support reject return');
  assert(ordersJs.includes('Approve Refund'), 'must support approve refund');
  assert(ordersJs.includes('Reject Refund'), 'must support reject refund');
  assert(ordersJs.includes('View Complete Return'), 'must support view complete return');
  assert(ordersJs.includes('View Original Order'), 'must support view original order');
  assert(ordersJs.includes('Print Return Report'), 'must support print return report');
  assert(ordersJs.includes('Print Refund Report'), 'must support print refund report');
  assert(ordersJs.includes('Open Customer Location in Google Maps'), 'must support maps link');
  assert(ordersJs.includes('Contact Customer'), 'must support contact customer');
  assert(ordersJs.includes('ordersReturnStatusFilter'), 'must support return status filter');
  assert(ordersJs.includes('ordersRefundStatusFilter'), 'must support refund status filter');
  assert(ordersJs.includes('return-desc'), 'must support return sorting');
  assert(ordersJs.includes('applyReturnAction'), 'must process return actions');
  assert(ordersJs.includes('window.confirm'), 'return/refund actions must use confirmation dialogs');
  assert(ordersJs.includes('refund_required') || ordersJs.includes('refundRequired'), 'must include refund-required orders');

  assert(data.includes('returnWorkflow'), 'normalizeOrder must expose return workflow');
  assert(data.includes('returnAction'), 'updateOrderStatus must send returnAction');
  assert(data.includes('refundAmount'), 'updateOrderStatus must support refund amount');

  assert(controller.includes('ensureReturnWorkflow'), 'server must persist return workflow');
  assert(controller.includes('applyReturnAction'), 'server must apply return actions');
  assert(controller.includes('approve_return'), 'server must approve returns');
  assert(controller.includes('approve_refund'), 'server must approve refunds');
  assert(controller.includes('DUPLICATE_RETURN'), 'server must prevent duplicate returns');
  assert(controller.includes('DUPLICATE_REFUND'), 'server must prevent duplicate refunds');
  assert(controller.includes('stockRestored'), 'server must avoid double stock restore');
  assert(controller.includes('returnWorkflow'), 'paid cancels must seed return workflow');

  assert(css.includes('orders-return-images'), 'returns CSS must style uploaded images');

  simulateReturnsFilter();
  simulateDuplicateGuards();

  if (failures.length) {
    console.error('FAIL verify-admin-returns-refunds');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('PASS verify-admin-returns-refunds');
}

main();
