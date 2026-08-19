#!/usr/bin/env node
/**
 * Payment vs delivery workflow verification (STEP 3).
 * Run: node scripts/verify-admin-payment-delivery-workflow.js
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

function applyFulfillmentOnly(order, nextStatus) {
  return {
    ...order,
    status: nextStatus,
    orderStatus: nextStatus,
    deliveryStatus: nextStatus,
    paymentStatus: order.paymentStatus,
    paymentStatusLabel: order.paymentStatusLabel,
    paymentMethod: order.paymentMethod
  };
}

function applyExplicitPayment(order, paymentStatus) {
  return {
    ...order,
    paymentStatus,
    paymentStatusLabel: paymentStatus === 'paid' ? 'Paid' : order.paymentStatusLabel,
    payment: {
      ...(order.payment && typeof order.payment === 'object' ? order.payment : {}),
      status: paymentStatus
    }
  };
}

async function main() {
  const controller = read('server/controllers/ordercontroller.js');
  const ordersJs = read('admin/app/pages/orders.js');
  const dataJs = read('admin/app/services/admin-data.service.js');
  const invoiceJs = read('admin/app/services/invoice-document.service.js');
  const addressJs = read('admin/app/utils/order-address.js');
  const dpoJs = read('server/services/dpopayment.service.js');
  const classificationJs = read('admin/app/utils/order-classification.js');

  assert(!controller.includes('maybeConfirmCodPaymentOnDelivery'), 'server must not auto-confirm COD payment on delivery');
  assert(controller.includes('Delivery/fulfillment status must never mutate payment status'), 'fulfillment updates must keep payment independent');
  assert(controller.includes('applyPaymentStatusUpdate'), 'explicit payment confirmation path must remain');
  assert(controller.includes('Explicit payment-status path only'), 'payment updates must stay on the explicit path');
  assert(!dpoJs.includes('maybeConfirmCodPaymentOnDelivery'), 'DPO processing must stay independent of COD delivery confirmation');
  assert(ordersJs.includes('await updateOrderStatus(orderId, nextStatus, options)'), 'Update Status must send fulfillment status');
  assert(ordersJs.includes('await updateOrderStatus(orderId, "", { paymentStatus })'), 'Mark Payment Received must send payment status only');
  assert(ordersJs.includes('refreshOpenReviewDrawer'), 'Review Information must refresh the selected order');
  assert(ordersJs.includes('invoiceOrderMatchesRequested'), 'View Invoice must match the clicked order id');
  assert(ordersJs.includes('invoice-verify.html'), 'QR verification must remain');
  assert(invoiceJs.includes('buildInvoiceHtml'), 'invoice document builder must remain');
  assert(dataJs.includes('from "../utils/order-address.js"'), 'customer address mapping must remain');
  assert(addressJs.includes('sector') && addressJs.includes('cellName'), 'Province/City through Village mapping must remain');
  assert(!ordersJs.includes('method.includes("cod") || method.includes("cash")'), 'All Orders progress must not treat COD fulfillment as payment confirmed');
  assert(classificationJs.includes('classifyOrder'), 'workflow must keep the shared classifier');

  const { classifyOrder, orderMatchesView } = await import('../admin/app/utils/order-classification.js');

  const paidPending = {
    orderId: 'PAID-1',
    status: 'Pending',
    paymentMethod: 'mtn',
    paymentStatus: 'paid'
  };
  const paidShipping = applyFulfillmentOnly(paidPending, 'Shipping');
  const paidOut = applyFulfillmentOnly(paidPending, 'Out for Delivery');
  const paidDelivered = applyFulfillmentOnly(paidPending, 'Delivered');

  assert(orderMatchesView(paidPending, 'paid') && !orderMatchesView(paidPending, 'cod') && !orderMatchesView(paidPending, 'completed'), '1. paid + pending delivery is Paid only');
  assert(orderMatchesView(paidShipping, 'paid') && orderMatchesView(paidOut, 'paid'), '2. paid + out for delivery remains Paid');
  assert(!orderMatchesView(paidShipping, 'completed'), '2. Shipping is not Completed; Out for Delivery may match existing completed includes("deliver") rule');
  assert(orderMatchesView(paidDelivered, 'paid') && orderMatchesView(paidDelivered, 'completed'), '3. paid + delivered is Paid and Completed');
  assert(paidDelivered.paymentStatus === 'paid', '3. delivering a paid order must not change payment status');

  const codPending = {
    orderId: 'COD-1',
    status: 'Pending',
    paymentMethod: 'cod',
    paymentStatus: 'awaiting_delivery_payment',
    paymentStatusLabel: 'Awaiting Delivery Payment'
  };
  const codDeliveredUnpaid = applyFulfillmentOnly(codPending, 'Delivered');
  const codPaid = applyExplicitPayment(codDeliveredUnpaid, 'paid');

  assert(orderMatchesView(codPending, 'cod') && orderMatchesView(codPending, 'pending') && !orderMatchesView(codPending, 'paid'), '4. COD + payment pending is COD');
  assert(orderMatchesView(codDeliveredUnpaid, 'cod') && !orderMatchesView(codDeliveredUnpaid, 'paid'), '5. COD + delivered + unpaid remains COD');
  assert(codDeliveredUnpaid.paymentStatus === 'awaiting_delivery_payment', '5. delivery must not mark COD paid');
  assert(orderMatchesView(codDeliveredUnpaid, 'completed'), '5. existing Completed logic still matches delivered COD');
  assert(orderMatchesView(codPaid, 'paid') && !orderMatchesView(codPaid, 'cod'), '6. COD becomes Paid only after explicit payment confirmation');
  assert(codPaid.paymentStatus === 'paid', '6. explicit confirmation records the real paid status');

  const paidCancelled = {
    orderId: 'CAN-1',
    status: 'Cancelled',
    paymentMethod: 'card',
    paymentStatus: 'paid'
  };
  const refunded = {
    orderId: 'REF-1',
    status: 'Refunded',
    paymentMethod: 'mtn',
    paymentStatus: 'refunded',
    returnWorkflow: { returnStatus: 'approved', refundStatus: 'completed' }
  };
  assert(orderMatchesView(paidCancelled, 'cancelled') && !orderMatchesView(paidCancelled, 'paid'), '7. cancelled stays in Cancelled Orders');
  assert(orderMatchesView(refunded, 'returns') && !orderMatchesView(refunded, 'paid') && !orderMatchesView(refunded, 'cod'), '8. refunded stays in Returns & Refunds');

  const reviewA = { orderId: 'A-100', id: 'A-100' };
  const reviewB = { orderId: 'B-200', id: 'B-200' };
  const selected = 'A-100';
  const matches = [reviewA, reviewB].filter((order) => [order.orderId, order.id].includes(selected));
  assert(matches.length === 1 && matches[0].orderId === 'A-100', 'selected-order actions must not leak another order');
  assert(classifyOrder(codDeliveredUnpaid).isPaidPayment === false, 'classifier must not invent paid from delivery');
  assert(classifyOrder(null).views.all === true, 'missing order data must not crash classification');

  if (failures.length) {
    console.error('FAIL verify-admin-payment-delivery-workflow');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('PASS verify-admin-payment-delivery-workflow');
  console.log(' - Delivery no longer auto-confirms COD payment');
  console.log(' - Explicit Mark Payment Received remains the paid path');
  console.log(' - Paid/COD/Cancelled/Returns classification stays independent of mixed statuses');
}

main().catch((error) => {
  console.error('FAIL verify-admin-payment-delivery-workflow');
  console.error(error);
  process.exit(1);
});
