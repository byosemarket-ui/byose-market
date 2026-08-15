#!/usr/bin/env node
/**
 * STEP 3 — Online Payment connects directly to existing DPO LIVE.
 * Source-level checks only. Does not complete a real-money LIVE charge.
 *
 * Run: node scripts/verify-online-payment-dpo-handoff.js
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

function sliceFunction(source, name, nextName) {
  const start = source.indexOf(`async function ${name}`);
  const end = nextName ? source.indexOf(`async function ${nextName}`) : source.length;
  assert(start >= 0, `${name} must exist`);
  return start >= 0 ? source.slice(start, end >= 0 ? end : source.length) : '';
}

function main() {
  const checkoutHtml = read('orders/checkout.html');
  const checkoutJs = read('orders/checkout.js');
  const paymentHtml = read('orders/payment.html');
  const paymentResult = read('orders/payment-result.js');
  const success = read('orders/order-success.js');
  const orderJs = read('orders/core/order.js');
  const session = read('orders/checkout-session.js');
  const actions = read('details/js/product-actions.js');
  const cart = read('services/byose-cart.js');
  const constants = read('orders/core/constants.js');
  const dpoRoutes = read('server/routes/dpopayments.js');
  const orderRoutes = read('server/routes/orders.js');
  const dpoConfig = read('server/payments/dpo/config.js');
  const endpoints = read('server/payments/dpo/endpoints.js');
  const provider = read('server/payments/providers/dpo.provider.js');
  const client = read('server/payments/dpo/client.js');
  const service = read('server/services/dpopayment.service.js');
  const controller = read('server/controllers/dpopaymentcontroller.js');

  assert(checkoutHtml.includes('id="onlinePayBtn"'), 'Online Payment button required');
  assert(checkoutHtml.includes('id="codPayBtn"'), 'Cash on Delivery button required');
  assert(!checkoutHtml.includes('payment.html'), 'Review must not open payment.html');
  assert(!/Choose MTN|Choose Card|Choose Payment Method/i.test(checkoutHtml + checkoutJs), 'no BYOSE MTN/Card selection screen');
  assert(!/Airtel Money|Bank Transfer|Sandbox|TEST payment/i.test(checkoutHtml), 'removed methods must not appear');

  const onlineFn = sliceFunction(checkoutJs, 'handleOnlinePayment', '');
  assert(onlineFn.includes('beginAction(\'online\')'), 'Online Payment must lock immediately');
  assert(onlineFn.includes('submitOrder') || checkoutJs.includes('submitOrder'), 'Online Payment uses existing order create');
  assert(checkoutJs.includes('initiateDpoPayment'), 'Online Payment uses existing DPO initiate');
  assert(checkoutJs.includes('location.replace(payment.paymentUrl)'), 'Online Payment must redirect to the DPO URL, not a BYOSE payment page');
  assert(!checkoutJs.includes('payment.html'), 'checkout.js must not navigate to payment.html');
  assert(checkoutJs.includes('checkoutReady'), 'Online Payment must validate checkout before DPO');
  assert(checkoutJs.includes('validateShipping'), 'Online Payment must reuse shipping already collected');
  assert(!/name=["']cardNumber["']/i.test(checkoutJs), 'no card number field');
  assert(!/name=["']cvv["']/i.test(checkoutJs), 'no CVV field');

  const codFn = sliceFunction(checkoutJs, 'handleCashOnDelivery', 'handleOnlinePayment');
  assert(codFn.includes('submitOrder'), 'COD still creates the order');
  assert(!codFn.includes('initiateDpoPayment'), 'COD must never call DPO');
  assert(codFn.includes('order-success.html'), 'COD still goes to success');

  assert(orderJs.includes('JSON.stringify({ orderId })'), 'initiate sends only the order ID, not a frontend amount');
  assert(orderJs.includes('isOfficialDpoHostedPaymentUrl'), 'frontend must accept only the official DPO hosted URL');
  assert(orderJs.includes("hostname === 'secure.3gdirectpay.com'"), 'DPO host must be LIVE secure.3gdirectpay.com');
  assert(orderJs.includes('payv3'), 'DPO hosted page must be payv3.php');
  assert(orderJs.includes('Online payment could not be started. Please try again or choose Cash on Delivery.'), 'customer-safe initiate error required');
  assert(!orderJs.includes('companyToken'), 'frontend order helper must not mention Company Token');

  assert(/location\.replace\(\s*'checkout.html'/.test(paymentHtml), 'old Payment URL still redirects to Review & Pay');
  assert(!paymentHtml.includes('payment.js'), 'old Payment page must not load Payment-step JS');
  assert(paymentResult.includes('initiateDpoPayment'), 'retry uses existing DPO initiate');
  assert(paymentResult.includes('location.replace(payment.paymentUrl)'), 'retry must go to DPO, not payment.html');
  assert(!paymentResult.includes("href: 'payment.html'"), 'payment-result must not open payment.html');
  assert(success.includes('verifyPaidStatus'), 'success still verifies with the backend');
  assert(success.includes('Confirming payment'), 'opening DPO must not flash PAID');
  assert(success.includes('confirmationIsCod'), 'COD still skips DPO verify');

  assert(actions.includes('startBuyNowSession'), 'Buy Now isolation remains');
  assert(cart.includes('startCartCheckoutSession'), 'Cart checkout isolation remains');
  assert(session.includes('clearAbandonedCheckoutSession'), 'new checkout clears abandoned gateway state');
  assert(session.includes('clearAwaitingGatewayOrderId'), 'Buy Now/Cart must not reuse another order\'s DPO token');

  assert(constants.includes('DELIVERY_FEE = 2000'), 'delivery fee remains 2000 RWF');
  assert(!constants.includes('3500'), 'no 3500 surcharge');

  assert(dpoRoutes.includes("router.post('/initiate'"), 'POST /api/payments/dpo/initiate remains');
  assert(dpoRoutes.includes("router.post('/verify'"), 'POST /api/payments/dpo/verify remains');
  assert(dpoRoutes.includes("router.get('/config'"), 'GET /api/payments/dpo/config remains');
  assert(orderRoutes.includes("router.get('/confirmation/:id'"), 'GET /api/orders/confirmation/:id remains');
  assert(dpoConfig.includes("CHECKOUT_MODE = 'live'"), 'DPO remains LIVE');
  assert(endpoints.includes("DEFAULT_API_BASE = 'https://secure.3gdirectpay.com/API/v6/'"), 'LIVE API v6 remains');
  assert(endpoints.includes("DEFAULT_PAYMENT_PAGE = 'https://secure.3gdirectpay.com/payv3.php?ID=token'"), 'LIVE payv3 remains');
  assert(provider.includes("LIVE_SERVICE_TYPE_ID = '112815'"), 'Service Type 112815 remains');
  assert(client.includes("defaultPayment: 'MO'"), 'MTN still uses official DefaultPayment MO');
  assert(client.includes("defaultPayment: 'CC'"), 'Card still uses official DefaultPayment CC');
  assert(!/ALL_BLOCKABLE_PAYMENTS = Object\.freeze\(\[[^\]]*SE/.test(client), 'BlockPayment must not include undocumented SE');
  assert(service.includes('assertTrustedOrderAmount'), 'DPO amount remains server-authoritative');
  assert(service.includes('DPO_NOT_USED_FOR_COD'), 'COD still cannot initiate DPO');
  assert(service.includes('initiateLocks'), 'backend duplicate initiate lock remains');
  assert(controller.includes('customerSafePaymentMessage'), 'initiate errors stay customer-safe');
  assert(!dpoConfig.includes('TEST fallback') || dpoConfig.includes('Incomplete LIVE never substitutes TEST'), 'no LIVE → TEST fallback');

  if (failures.length) {
    console.error('[verify-online-payment-dpo-handoff] FAIL:');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('[verify-online-payment-dpo-handoff] PASS');
  console.log(' Online Payment → existing order create → existing DPO LIVE initiate → payv3.php');
  console.log(' No BYOSE payment-selection page');
  console.log(' COD never calls DPO');
  console.log(' Service Type 112815 and LIVE endpoints unchanged');
  console.log(' No real-money LIVE transaction was performed');
}

main();
