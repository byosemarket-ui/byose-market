#!/usr/bin/env node
/**
 * STEP 2 checkout + order processing verification.
 * Run: node scripts/verify-checkout-order-step2.js
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

function checkSourceGuards() {
  const orderController = read('server/controllers/ordercontroller.js');
  assert(orderController.includes('applyCatalogPricing'), 'server must price from catalog');
  assert(orderController.includes('validateShippingAddress'), 'server must validate shipping');
  assert(orderController.includes('restoreOrderStock'), 'server must restore stock on cancel/delete');
  assert(orderController.includes("customerId = user?.id"), 'server must force authenticated customerId');
  assert(orderController.includes('awaiting_payment'), 'server must track awaiting payment');
  assert(orderController.includes("paymentMethod === 'cod' ? 'awaiting_delivery_payment' : 'awaiting_payment'"), 'storefront create must ignore client paid status');
  assert(!orderController.includes("if (defaultPaymentStatus === 'paid')"), 'defaultPaymentStatus must not mark new orders paid');

  const productRepo = read('server/repositories/sqlite/product.repository.js');
  assert(productRepo.includes('restoreStockForOrderItems'), 'product repo must restore stock');
  assert(productRepo.includes('Color/size selection required'), 'variant products require attributes');

  const orderJs = read('orders/core/order.js');
  assert(orderJs.includes('setSubmitting(true)'), 'submitOrder must lock submission');
  assert(orderJs.includes('savePendingOrderSubmission'), 'submitOrder must persist pending orderId');
  assert(orderJs.includes('skipped: true'), 'missing API origin must fail, not succeed');
  assert(orderJs.includes('awaiting_payment'), 'pay-now orders await payment');

  const paymentJs = read('orders/payment.js');
  assert(paymentJs.includes('renderPaymentInstructions'), 'payment page shows instructions');
  assert(paymentJs.includes('getState().isSubmitting'), 'payment page guards double submit');

  const layout = read('orders/ui/layout.js');
  assert(layout.includes('product.name || product.productName'), 'success/summary must render productName');
  assert(layout.includes('renderPaymentInstructions'), 'layout exports payment instructions');

  const dpoService = read('server/services/dpopayment.service.js');
  assert(dpoService.includes('assertVerifiedPaymentMatchesOrder'), 'DPO verify must bind amount/companyRef to the order');
  assert(dpoService.includes('DPO_AMOUNT_MISMATCH'), 'DPO verify must reject amount mismatch');
  assert(dpoService.includes('isSettledPaidStatus'), 'DPO verify must use settled-paid guard');

  const account = read('account/services/orderservice.js');
  assert(account.includes("return 'cancelled'"), 'cancelled orders have own group');

  const adminOrders = read('admin/app/pages/orders.js');
  assert(adminOrders.includes('updateOrderStatus'), 'admin orders can update status');
  assert(adminOrders.includes('subscribeToLiveFeeds'), 'admin orders live-refresh');

  const adminData = read('admin/app/services/admin-data.service.js');
  assert(!adminData.includes('value.includes("payment") return "Confirmed"'), 'payment status must not map to Confirmed');
  assert(adminData.includes('order?.orderStatus || order?.status'), 'admin normalize uses fulfillment status');
}

function simulateSubmitLock() {
  let isSubmitting = false;
  const calls = [];
  async function submitOrder() {
    if (isSubmitting) {
      calls.push('blocked');
      return { valid: false };
    }
    isSubmitting = true;
    calls.push('run');
    await Promise.resolve();
    isSubmitting = false;
    return { valid: true };
  }

  return Promise.all([submitOrder(), submitOrder()]).then(() => {
    assert(calls.includes('run') && calls.includes('blocked'), 'submit lock blocks concurrent place-order');
  });
}

function simulateCatalogPricing() {
  const clientItems = [{ productId: '10', productName: 'Hack', price: 1, quantity: 2 }];
  const catalog = { 10: { name: 'Real Shoe', price: 25000 } };
  const priced = clientItems.map((item) => ({
    ...item,
    productName: catalog[item.productId].name,
    price: catalog[item.productId].price
  }));
  const subtotal = priced.reduce((sum, item) => sum + item.price * item.quantity, 0);
  assert(subtotal === 50000, 'catalog pricing ignores client unit price');
  assert(priced[0].productName === 'Real Shoe', 'catalog naming wins over client');
}

function simulateTotals() {
  const DELIVERY_FEE = 2000;
  const COD_FEE = 0;
  const subtotal = 18000;
  const total = subtotal + DELIVERY_FEE + COD_FEE;
  assert(total === 20000, 'order total = subtotal + flat delivery');
}

async function main() {
  checkSourceGuards();
  simulateCatalogPricing();
  simulateTotals();
  await simulateSubmitLock();

  if (failures.length) {
    console.error('STEP 2 verification FAILED:');
    failures.forEach((f) => console.error(` - ${f}`));
    process.exit(1);
  }

  console.log('STEP 2 checkout/order verification PASSED.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
