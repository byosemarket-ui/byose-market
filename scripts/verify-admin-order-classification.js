#!/usr/bin/env node
/**
 * Admin order classification verification (STEP 1 — data foundation).
 * Run: node scripts/verify-admin-order-classification.js
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

function viewsOf(classifyOrder, order) {
  return classifyOrder(order).views;
}

async function main() {
  const utilJs = read('admin/app/utils/order-classification.js');
  const ordersJs = read('admin/app/pages/orders.js');
  const dataJs = read('admin/app/services/admin-data.service.js');
  const addressJs = read('admin/app/utils/order-address.js');
  const invoiceJs = read('admin/app/services/invoice-document.service.js');
  const paymentStatusJs = read('server/payments/payment-status.js');
  const storefrontJs = read('server/payments/storefront-methods.js');
  const dpoJs = read('server/services/dpopayment.service.js');

  assert(utilJs.includes('export function classifyOrder'), 'shared classifyOrder must exist');
  assert(utilJs.includes('ORDER_VIEWS'), 'canonical view names must exist');
  assert(utilJs.includes('PAID: "paid"') && utilJs.includes('COD: "cod"'), 'Paid and COD views must be defined');
  assert(ordersJs.includes('from "../utils/order-classification.js"'), 'Orders UI must consume the shared classifier');
  assert(!/function\s+matchesNavStatus\s*\(/.test(ordersJs), 'orders.js must not keep a local matchesNavStatus');
  assert(!/function\s+isSettledPaidStatus\s*\(/.test(ordersJs), 'orders.js must not keep a local isSettledPaidStatus');
  assert(!/function\s+classifyOrder\s*\(/.test(ordersJs), 'orders.js must not keep a competing classifyOrder');
  assert(dataJs.includes('from "../utils/order-classification.js"'), 'normalizeOrder must use the shared classifier');
  assert(dataJs.includes('normalized.classification = classifyOrder(normalized)'), 'normalized orders must expose classification');
  assert(!dataJs.includes('order?.paymentStatus || payment.status || status'), 'normalizeOrder must not copy order status into payment status');
  assert(addressJs.includes('cellName') && ordersJs.includes('from "../utils/order-address.js"'), 'address resolver must remain in use');
  assert(invoiceJs.includes('invoiceOrderMatchesRequested') || ordersJs.includes('invoiceOrderMatchesRequested'), 'invoice still keys off selected order id');
  assert(ordersJs.includes('prepareAndOpenInvoice'), 'View Invoice opener must remain');
  assert(!dpoJs.includes('order-classification'), 'classifier must not alter DPO payment processing');
  assert(paymentStatusJs.includes("status === 'paid'"), 'server paid values remain the canonical source');
  assert(storefrontJs.includes("id: 'cod'"), 'storefront still owns the COD method id');

  const {
    classifyOrder,
    orderMatchesView,
    isSettledPaidStatus,
    resolveCanonicalPaymentMethod,
    resolvePaymentStatusKind
  } = await import('../admin/app/utils/order-classification.js');

  assert(isSettledPaidStatus('paid') === true, 'paid is settled');
  assert(isSettledPaidStatus('successful') === true, 'successful is settled');
  assert(isSettledPaidStatus('unpaid') === false, 'unpaid is not settled');
  assert(isSettledPaidStatus('awaiting_payment') === false, 'awaiting_payment is not settled');
  assert(isSettledPaidStatus('awaiting_delivery_payment') === false, 'awaiting_delivery_payment is not settled');
  assert(isSettledPaidStatus('authorized') === false, 'authorized is not settled paid');
  assert(isSettledPaidStatus('') === false, 'empty payment status is not invented as paid');
  assert(resolveCanonicalPaymentMethod({ paymentMethod: 'cod' }) === 'cod', 'cod method is canonical');
  assert(resolveCanonicalPaymentMethod({ paymentMethod: 'mtn' }) === 'mtn', 'mtn method is canonical');
  assert(resolveCanonicalPaymentMethod({ paymentMethod: 'card' }) === 'card', 'card method is canonical');
  assert(resolveCanonicalPaymentMethod({ paymentMethod: 'cash_on_delivery' }) === 'cod', 'cash_on_delivery alias is COD');
  assert(resolveCanonicalPaymentMethod({ paymentType: 'cod' }) === 'cod', 'paymentType cod is a method fallback');
  assert(resolveCanonicalPaymentMethod({ paymentMethod: 'mtn', paymentMethodLabel: 'Pay on Delivery' }) === 'mtn', 'label must not override a stored method');

  // TEST A — Payment successful, delivery pending
  const testA = viewsOf(classifyOrder, {
    status: 'Pending',
    paymentMethod: 'mtn',
    paymentStatus: 'paid',
    deliveryStatus: 'Pending'
  });
  assert(testA.paid === true && testA.cod === false && testA.completed === false, 'TEST A: paid + pending delivery is Paid, not COD, not Completed');

  // TEST B — Payment successful, delivery delivered
  const testB = viewsOf(classifyOrder, {
    status: 'Delivered',
    paymentMethod: 'card',
    paymentStatus: 'successful',
    deliveryStatus: 'Delivered'
  });
  assert(testB.paid === true && testB.completed === true && testB.cod === false, 'TEST B: paid + delivered is Paid and Completed, not COD');

  // TEST C — COD, payment pending, delivery pending
  const testC = viewsOf(classifyOrder, {
    status: 'Pending',
    paymentMethod: 'cod',
    paymentStatus: 'awaiting_delivery_payment',
    deliveryStatus: 'Pending'
  });
  assert(testC.cod === true && testC.paid === false && testC.pending === true, 'TEST C: COD pending is COD and Pending, not Paid');

  // TEST D — COD, payment pending, delivery delivered
  const testD = viewsOf(classifyOrder, {
    status: 'Delivered',
    paymentMethod: 'cod',
    paymentStatus: 'awaiting_delivery_payment',
    deliveryStatus: 'Delivered',
    amountPaid: 0
  });
  assert(testD.cod === true && testD.paid === false && testD.completed === true, 'TEST D: delivered COD stays COD until payment is recorded');

  // TEST E — Mobile Money pending
  const testE = viewsOf(classifyOrder, {
    status: 'Pending',
    paymentMethod: 'mtn',
    paymentStatus: 'awaiting_payment'
  });
  assert(testE.cod === false && testE.paid === false && testE.pending === true, 'TEST E: MTN pending is not COD and not Paid');

  // TEST F — Card payment successful
  const testF = viewsOf(classifyOrder, {
    status: 'Confirmed',
    paymentMethod: 'card',
    paymentStatus: 'payment_successful'
  });
  assert(testF.paid === true && testF.cod === false, 'TEST F: card successful is Paid, not COD');

  // TEST G — Paid payment, order cancelled
  const testGOrder = {
    status: 'Cancelled',
    paymentMethod: 'mtn',
    paymentStatus: 'paid'
  };
  const testG = viewsOf(classifyOrder, testGOrder);
  assert(testG.cancelled === true && testG.paid === false && testG.pending === false, 'TEST G: cancelled paid order is Cancelled, not active Paid');
  assert(orderMatchesView(testGOrder, 'cancelled') === true, 'TEST G: cancelled view remains authoritative');
  assert(orderMatchesView(testGOrder, 'paid') === false, 'TEST G: cancelled order must not match Paid Orders');

  // TEST H — Paid payment, refunded/returned
  const testHOrder = {
    status: 'Refunded',
    paymentMethod: 'card',
    paymentStatus: 'refunded',
    refundRequired: true,
    returnWorkflow: { returnStatus: 'approved', refundStatus: 'completed' }
  };
  const testH = viewsOf(classifyOrder, testHOrder);
  assert(testH.returns === true && testH.paid === false && testH.cod === false, 'TEST H: refunded order stays in Returns & Refunds, not Paid/COD');
  assert(orderMatchesView(testHOrder, 'returns') === true, 'TEST H: returns view remains correct');

  // TEST I — Missing payment data
  const missingPayment = classifyOrder({ status: 'Pending', orderId: 'missing-pay' });
  assert(missingPayment.paymentStatusKind === 'unknown', 'TEST I: missing payment must not invent a payment status');
  assert(missingPayment.paymentStatusRaw === '', 'TEST I: missing payment raw status is empty');
  assert(missingPayment.views.paid === false && missingPayment.views.cod === false, 'TEST I: missing payment is not Paid or COD');
  assert(JSON.stringify(missingPayment).includes('undefined') === false, 'TEST I: classification JSON must not contain undefined');
  assert(!String(missingPayment.paymentMethod).includes('[object Object]'), 'TEST I: method must not stringify as [object Object]');
  assert(classifyOrder(null).views.all === true, 'TEST I: null order must not crash');
  assert(classifyOrder(undefined).paymentStatusKind === 'unknown', 'TEST I: undefined order must not crash');
  assert(classifyOrder({ payment: 'oops', paymentStatus: { nested: true } }).paymentStatusKind === 'unknown', 'TEST I: invalid payment object must not crash');

  // TEST J — Missing delivery data
  const missingDelivery = classifyOrder({
    paymentMethod: 'card',
    paymentStatus: 'paid'
  });
  assert(missingDelivery.views.paid === true && missingDelivery.views.completed === false, 'TEST J: missing delivery must not crash or invent completed');
  assert(classifyOrder({ paymentMethod: 'cod', paymentStatus: 'awaiting_delivery_payment' }).views.cod === true, 'TEST J: COD without delivery data remains COD');

  // TEST — COD delivered + amount paid 0 must not become Paid
  const codEdge = classifyOrder({
    status: 'Delivered',
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    amountPaid: 0,
    grandTotal: 15000,
    deliveryStatus: 'Delivered',
    transactionId: '',
    paymentReference: ''
  });
  assert(codEdge.views.cod === true, 'COD edge: remains COD');
  assert(codEdge.views.paid === false, 'COD edge: delivery + zero paid must not become Paid');
  assert(codEdge.isPaidPayment === false, 'COD edge: payment is not settled');
  assert(codEdge.views.completed === true, 'COD edge: existing completed logic still matches delivered');

  // Existing queues still work through the same matcher
  assert(orderMatchesView({ status: 'Pending', paymentStatus: 'awaiting_payment' }, 'pending'), 'existing pending MoMo still pending');
  assert(orderMatchesView({ status: 'Pending', paymentStatus: 'awaiting_delivery_payment', paymentMethod: 'cod' }, 'pending'), 'existing pending COD still pending');
  assert(!orderMatchesView({ status: 'Delivered', paymentStatus: 'awaiting_payment' }, 'pending'), 'delivered awaiting payment is not pending');
  assert(orderMatchesView({ status: 'Delivered', paymentStatus: 'paid' }, 'completed'), 'delivered paid is completed');
  assert(orderMatchesView({ status: 'Cancelled', paymentStatus: 'unpaid' }, 'cancelled'), 'cancelled remains cancelled');
  assert(orderMatchesView({
    status: 'Returned',
    paymentStatus: 'refund_required',
    returnWorkflow: { returnStatus: 'approved', refundStatus: 'required' }
  }, 'returns'), 'return workflow remains in returns');
  assert(!orderMatchesView({ status: 'Delivered', paymentStatus: 'paid' }, 'returns'), 'normal paid must not fake returns');

  // Multi-membership stays explicit
  const pendingCod = viewsOf(classifyOrder, {
    status: 'Pending',
    paymentMethod: 'cod',
    paymentStatus: 'awaiting_delivery_payment'
  });
  assert(pendingCod.pending && pendingCod.cod && !pendingCod.paid, 'pending COD belongs to Pending and COD');
  const paidDelivered = viewsOf(classifyOrder, {
    status: 'Delivered',
    paymentMethod: 'mtn',
    paymentStatus: 'paid'
  });
  assert(paidDelivered.paid && paidDelivered.completed && !paidDelivered.cod, 'paid delivered belongs to Paid and Completed');

  // Paid COD after payment is recorded leaves the COD queue
  const paidCod = viewsOf(classifyOrder, {
    status: 'Delivered',
    paymentMethod: 'cod',
    paymentStatus: 'paid'
  });
  assert(paidCod.paid === true && paidCod.cod === false && paidCod.completed === true, 'COD becomes Paid only after payment is recorded as received');

  assert(resolvePaymentStatusKind({}) === 'unknown', 'empty kind is unknown, not pending');
  assert(resolvePaymentStatusKind({ paymentStatus: 'awaiting_payment' }) === 'pending', 'awaiting_payment kind is pending');
  assert(resolvePaymentStatusKind({ paymentStatus: 'failed' }) === 'failed', 'failed kind is failed');
  assert(resolvePaymentStatusKind({ paymentStatus: 'cancelled' }) === 'cancelled', 'cancelled payment kind is cancelled');

  if (failures.length) {
    console.error('FAIL verify-admin-order-classification');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('PASS verify-admin-order-classification');
  console.log(' - Paid / COD classification from real payment method + payment status');
  console.log(' - Existing pending/completed/cancelled/returns rules preserved');
  console.log(' - Cancelled/refunded remain authoritative over historical paid');
  console.log(' - Missing payment/delivery data does not crash or invent status');
}

main().catch((error) => {
  console.error('FAIL verify-admin-order-classification');
  console.error(error);
  process.exit(1);
});
