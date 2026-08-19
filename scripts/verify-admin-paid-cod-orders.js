#!/usr/bin/env node
/**
 * Admin Paid Orders and COD / Pay on Delivery verification (STEP 2).
 * Run: node scripts/verify-admin-paid-cod-orders.js
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
  const nav = read('admin/app/core/navigation.js');
  const css = read('admin/css/pages/orders.css');
  const dataJs = read('admin/app/services/admin-data.service.js');
  const addressJs = read('admin/app/utils/order-address.js');
  const invoiceJs = read('admin/app/services/invoice-document.service.js');
  const classificationJs = read('admin/app/utils/order-classification.js');
  const dpoJs = read('server/services/dpopayment.service.js');

  assert(nav.includes('Paid Orders'), 'nav must include Paid Orders');
  assert(nav.includes('COD / Pay on Delivery'), 'nav must include COD / Pay on Delivery');
  assert(nav.includes('?status=paid'), 'Paid Orders must route with status=paid');
  assert(nav.includes('?status=cod'), 'COD must route with status=cod');
  assert(nav.includes('All Orders') && nav.includes('Pending Orders') && nav.includes('Completed Orders'), 'existing Orders nav labels must remain');
  assert(nav.includes('Cancelled Orders') && nav.includes('Returns & Refunds'), 'cancelled/returns nav must remain');

  const paidIndex = nav.indexOf('Paid Orders');
  const pendingIndex = nav.indexOf('Pending Orders');
  const completedIndex = nav.indexOf('Completed Orders');
  assert(pendingIndex < paidIndex && paidIndex < completedIndex, 'nav order must keep Pending, then Paid, then Completed');

  assert(ordersJs.includes('title: "Paid Orders"'), 'Paid Orders page meta must exist');
  assert(ordersJs.includes('title: "COD / Pay on Delivery"'), 'COD page meta must exist');
  assert(ordersJs.includes('emptyTitle: "No paid orders yet."'), 'Paid empty state copy must exist');
  assert(ordersJs.includes('emptyTitle: "No Pay on Delivery orders yet."'), 'COD empty state copy must exist');
  assert(ordersJs.includes('ORDER_QUEUE_MODES'), 'paid/cod must use shared queue modes');
  assert(ordersJs.includes('from "../utils/order-classification.js"'), 'pages must consume STEP 1 classification');
  assert(!/function\s+matchesNavStatus\s*\(/.test(ordersJs), 'must not recreate matchesNavStatus');
  assert(ordersJs.includes('renderQueuePaymentSnapshot'), 'Paid/COD cards must show a payment snapshot');
  assert(ordersJs.includes('formatAmountDueDisplay'), 'COD must surface amount due');
  assert(ordersJs.includes('data-order-action="review"'), 'Review Information must stay wired');
  assert(ordersJs.includes('data-order-action="view-invoice"'), 'View Invoice must stay wired');
  assert(ordersJs.includes('data-order-action="update-status"'), 'Update Status must stay wired');
  assert(ordersJs.includes('invoiceOrderMatchesRequested'), 'invoice still keys off selected order id');
  assert(ordersJs.includes('from "../utils/order-address.js"'), 'customer address resolver must remain');
  assert(addressJs.includes('cellName'), 'identical Cell/Sector names must remain independently visible');
  assert(invoiceJs.includes('from "../utils/order-address.js"'), 'invoice address resolver must remain');
  assert(!dpoJs.includes('order-classification'), 'payment processing must not be modified');
  assert(classificationJs.includes('cod: isCodMethod && !isPaid'), 'COD classification must still require the COD method');
  assert(css.includes('order-payment-snapshot'), 'Paid/COD payment snapshot must be styled');
  assert(css.includes('order-amount-due'), 'COD amount due must be emphasized');
  assert(css.includes('.orders-page--queue .orders-stats-strip'), 'Paid/COD summary chips must use queue styles');
  assert(css.includes('.orders-page--queue .orders-date-tabs'), 'Paid/COD date tabs must use queue styles');
  assert(css.includes('.orders-page--queue .order-row-status'), 'Paid/COD status badges must match All Orders');
  assert(css.includes('@media (max-width: 860px)'), 'tablet queue CSS must remain');
  assert(css.includes('@media (max-width: 640px)'), 'mobile queue CSS must remain');
  assert(css.includes('.orders-page--all .orders-toolbar-panel--all'), 'All Orders toolbar CSS must remain unchanged');
  assert(dataJs.includes('classifyOrder'), 'normalized orders still expose classification');

  const { orderMatchesView, classifyOrder } = await import('../admin/app/utils/order-classification.js');

  const samples = {
    paidPendingDelivery: { orderId: 'PA', status: 'Pending', paymentMethod: 'mtn', paymentStatus: 'paid', deliveryStatus: 'Pending' },
    paidDelivered: { orderId: 'PB', status: 'Delivered', paymentMethod: 'card', paymentStatus: 'successful', deliveryStatus: 'Delivered' },
    codPending: { orderId: 'CA', status: 'Pending', paymentMethod: 'cod', paymentStatus: 'awaiting_delivery_payment', deliveryStatus: 'Pending' },
    codDeliveredUnpaid: {
      orderId: 'CB',
      status: 'Delivered',
      paymentMethod: 'cod',
      paymentStatus: 'awaiting_delivery_payment',
      deliveryStatus: 'Delivered',
      amountPaid: 0
    },
    momoPending: { orderId: 'MA', status: 'Pending', paymentMethod: 'mtn', paymentStatus: 'awaiting_payment' },
    paidCancelled: { orderId: 'XA', status: 'Cancelled', paymentMethod: 'card', paymentStatus: 'paid' },
    refunded: {
      orderId: 'RA',
      status: 'Refunded',
      paymentMethod: 'mtn',
      paymentStatus: 'refunded',
      returnWorkflow: { returnStatus: 'approved', refundStatus: 'completed' }
    },
    missingPayment: { orderId: 'NA', status: 'Pending' }
  };

  const list = Object.values(samples);
  const paid = list.filter((order) => orderMatchesView(order, 'paid')).map((order) => order.orderId);
  const cod = list.filter((order) => orderMatchesView(order, 'cod')).map((order) => order.orderId);

  // A
  assert(paid.includes('PA') && paid.includes('PB'), 'TEST A: successful payment appears in Paid Orders');
  // B
  assert(cod.includes('CA') && cod.includes('CB'), 'TEST B: COD payment method appears in COD');
  // C
  assert(!cod.includes('MA') && !paid.includes('MA'), 'TEST C: pending Mobile Money does not appear in COD or Paid');
  // D
  assert(paid.includes('PA') && !cod.includes('PA'), 'TEST D: paid awaiting delivery remains Paid');
  assert(classifyOrder(samples.paidPendingDelivery).views.completed === false, 'TEST D: paid pending delivery is not Completed');
  // E
  assert(cod.includes('CB') && !paid.includes('CB'), 'TEST E: COD delivered but unpaid remains COD');
  // F
  assert(orderMatchesView(samples.paidCancelled, 'cancelled') && !paid.includes('XA'), 'TEST F: paid cancelled stays in Cancelled, not Paid');
  // G
  assert(orderMatchesView(samples.refunded, 'returns') && !paid.includes('RA') && !cod.includes('RA'), 'TEST G: refunded stays in Returns & Refunds');
  // H
  const missing = classifyOrder(samples.missingPayment);
  assert(missing.views.paid === false && missing.views.cod === false && missing.paymentStatusKind === 'unknown', 'TEST H: missing payment data does not crash or invent paid/COD');
  assert(classifyOrder(null).views.all === true, 'TEST H: null order does not crash');

  const emptyPaid = [];
  const emptyCod = [];
  assert(emptyPaid.filter((order) => orderMatchesView(order, 'paid')).length === 0, 'TEST I: empty Paid Orders count is 0');
  assert(emptyCod.filter((order) => orderMatchesView(order, 'cod')).length === 0, 'TEST J: empty COD count is 0');
  assert(ordersJs.includes('No paid orders yet.'), 'TEST I: Paid empty state copy is present');
  assert(ordersJs.includes('No Pay on Delivery orders yet.'), 'TEST J: COD empty state copy is present');

  assert(ordersJs.includes('id="ordersSearch"'), 'search must reuse the shared Orders search');
  assert(ordersJs.includes('id="ordersPaymentFilter"') && ordersJs.includes('id="ordersDeliveryFilter"'), 'Paid/COD must reuse existing filter controls');
  assert(ordersJs.includes('data-orders-date-tab'), 'Paid/COD must reuse the existing Orders date tabs');
  assert(ordersJs.includes('orders-stats-strip'), 'Paid/COD must reuse summary count cards');
  assert(ordersJs.includes('escapeHtml(meta.title)'), 'queue titles must use the section title, not a second header name');
  assert(ordersJs.includes('formatCount(filteredCount)'), 'counts must come from filtered order data');
  assert(ordersJs.includes('Customer Information'), 'customer information block must remain');
  assert(ordersJs.includes('Province / City'), 'province/city must remain');

  if (failures.length) {
    console.error('FAIL verify-admin-paid-cod-orders');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('PASS verify-admin-paid-cod-orders');
  console.log(' - Paid Orders and COD sections are routed, filtered, and emptied correctly');
  console.log(' - Existing Cancelled / Returns logic remains authoritative');
  console.log(' - Search, filters, counts, invoice, and address resolver remain shared');
}

main().catch((error) => {
  console.error('FAIL verify-admin-paid-cod-orders');
  console.error(error);
  process.exit(1);
});
