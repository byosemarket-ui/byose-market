import { initiateDpoPayment, ONLINE_PAYMENT_START_ERROR, submitOrder } from './core/order.js';
import {
  getState,
  guardStep,
  initCheckout,
  isCodAvailable,
  loadGatewayPaymentConfig,
  refreshBackendDeliveryQuote,
  setPaymentMethod,
  setPaymentPhone,
  setSubmitting,
  subscribe,
  updateProductQty
} from './core/state.js';
import {
  renderDeliveryInfo, renderProgress, renderProductList, renderShippingSummary, renderSidebar,
  renderStickyBar, renderTotals, showMessage
} from './ui/layout.js';
import { validateProducts, validateShipping } from './core/validation.js';
import {
  readAwaitingGatewayOrderId,
  writeAwaitingGatewayOrderId
} from './checkout-session.js';

const ONLINE_GATEWAY_METHOD = 'card';

const progressEl = document.getElementById('progress');
const sidebarEl = document.getElementById('sidebar');
const stickyEl = document.getElementById('stickyBar');
const shippingSummaryEl = document.getElementById('shippingSummary');
const deliveryInfoEl = document.getElementById('deliveryInfo');
const productListEl = document.getElementById('productList');
const totalsBlockEl = document.getElementById('totalsBlock');
const messageEl = document.getElementById('message');
const form = document.getElementById('reviewForm');

let createdGatewayOrderId = readAwaitingGatewayOrderId();
let actionInFlight = false;
let busyKind = '';

function rememberGatewayOrder(orderId) {
  createdGatewayOrderId = String(orderId || '').trim();
  if (createdGatewayOrderId) writeAwaitingGatewayOrderId(createdGatewayOrderId);
}

function applyBusyState() {
  const onlineLabel = busyKind === 'online' ? 'Connecting to secure payment...' : 'Online Payment';
  const codLabel = busyKind === 'cod' ? 'Placing order...' : 'Cash on Delivery';
  const ids = ['codPayBtn', 'onlinePayBtn', 'stickyCodBtn', 'stickyOnlineBtn'];
  ids.forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const isOnline = id === 'onlinePayBtn' || id === 'stickyOnlineBtn';
    btn.textContent = isOnline ? onlineLabel : codLabel;
  });
  syncActionAvailability();
}

function syncActionAvailability() {
  const state = getState();
  const busy = actionInFlight || Boolean(state.isSubmitting);
  const codOk = isCodAvailable();
  const onlineOk = !state.gateway?.loaded || Boolean(state.gateway?.dpoEnabled);
  [
    ['codPayBtn', !codOk, 'Cash on Delivery is only available in Kigali.'],
    ['stickyCodBtn', !codOk, 'Cash on Delivery is only available in Kigali.'],
    ['onlinePayBtn', !onlineOk, 'Online payment is not available right now.'],
    ['stickyOnlineBtn', !onlineOk, 'Online payment is not available right now.']
  ].forEach(([id, blocked, title]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (busy) {
      btn.disabled = true;
      return;
    }
    btn.disabled = blocked;
    btn.title = blocked ? title : '';
  });
}

function render() {
  const state = getState();
  progressEl.innerHTML = renderProgress('review');
  shippingSummaryEl.innerHTML = renderShippingSummary(state.shipping);
  deliveryInfoEl.innerHTML = renderDeliveryInfo();
  productListEl.innerHTML = renderProductList(state.products, { editable: true });
  totalsBlockEl.innerHTML = renderTotals(state.totals);
  sidebarEl.innerHTML = renderSidebar(state.products, state.totals);
  stickyEl.innerHTML = renderStickyBar('', 'reviewContinueBtn', {
    actions: [
      { id: 'stickyCodBtn', label: 'Cash on Delivery', className: 'ck-btn ck-btn--cod' },
      { id: 'stickyOnlineBtn', label: 'Online Payment', className: 'ck-btn ck-btn--primary ck-btn--online' }
    ]
  });
  applyBusyState();
}

function releaseActionLock() {
  actionInFlight = false;
  busyKind = '';
  setSubmitting(false);
  applyBusyState();
}

function beginAction(kind) {
  if (actionInFlight || getState().isSubmitting) return false;
  actionInFlight = true;
  busyKind = kind;
  applyBusyState();
  return true;
}

function checkoutReady() {
  const productsCheck = validateProducts(getState().products);
  if (!productsCheck.valid) {
    showMessage(messageEl, productsCheck.message);
    return false;
  }
  const shippingCheck = validateShipping(getState().shipping);
  if (!shippingCheck.valid) {
    showMessage(messageEl, 'Please complete your delivery address.');
    window.location.href = 'shipping.html';
    return false;
  }
  showMessage(messageEl, '');
  return true;
}

async function startGatewayPayment(orderId) {
  applyBusyState();
  const payment = await initiateDpoPayment(orderId);
  if (payment.alreadyPaid) {
    window.location.replace(`order-success.html?orderId=${encodeURIComponent(orderId)}`);
    return true;
  }
  if (!payment.success || !payment.paymentUrl) {
    showMessage(messageEl, ONLINE_PAYMENT_START_ERROR);
    return false;
  }
  window.location.replace(payment.paymentUrl);
  return true;
}

async function handleCashOnDelivery(event) {
  event?.preventDefault?.();
  if (!checkoutReady()) return;
  if (!isCodAvailable()) {
    showMessage(messageEl, 'Cash on Delivery is only available in Kigali.');
    return;
  }
  if (createdGatewayOrderId) {
    showMessage(
      messageEl,
      'This order is already created for online payment. Complete Online Payment for the same order, or return later. Cash on Delivery cannot replace a started online payment.'
    );
    return;
  }
  if (!beginAction('cod')) return;

  try {
    setPaymentMethod('cod');
    const result = await submitOrder();
    if (!result.valid) {
      showMessage(messageEl, result.message || result.errors?.method || 'Unable to place order.');
      releaseActionLock();
      return;
    }
    window.location.href = `order-success.html?orderId=${encodeURIComponent(result.orderId)}`;
  } catch (_error) {
    showMessage(messageEl, 'Something went wrong. Please try again.');
    releaseActionLock();
  }
}

async function handleOnlinePayment(event) {
  event?.preventDefault?.();
  if (!checkoutReady()) return;
  if (!beginAction('online')) return;

  try {
    if (!getState().gateway?.loaded) {
      await loadGatewayPaymentConfig();
    }
    if (!getState().gateway?.dpoEnabled) {
      showMessage(messageEl, ONLINE_PAYMENT_START_ERROR);
      releaseActionLock();
      return;
    }

    setPaymentMethod(ONLINE_GATEWAY_METHOD);
    const shippingPhone = getState().shipping?.phone || getState().customer?.phone || '';
    if (shippingPhone) setPaymentPhone(shippingPhone);

    if (createdGatewayOrderId) {
      const started = await startGatewayPayment(createdGatewayOrderId);
      if (!started) releaseActionLock();
      return;
    }

    const result = await submitOrder();
    if (!result.valid) {
      showMessage(messageEl, result.message || result.errors?.method || result.errors?.phone || 'Unable to place order.');
      releaseActionLock();
      return;
    }

    rememberGatewayOrder(result.orderId);
    const started = await startGatewayPayment(result.orderId);
    if (!started) releaseActionLock();
  } catch (_error) {
    showMessage(messageEl, ONLINE_PAYMENT_START_ERROR);
    releaseActionLock();
  }
}

productListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-qty-action]');
  if (!btn) return;
  const state = getState();
  const id = btn.dataset.id;
  const variant = btn.dataset.variant || '';
  const item = state.products.find((p) => String(p.id) === id && String(p.variantKey || '') === variant);
  if (!item) return;
  const delta = btn.dataset.qtyAction === 'inc' ? 1 : -1;
  updateProductQty(id, variant, (item.qty || 1) + delta);
  const check = validateProducts(getState().products);
  if (!check.valid) {
    showMessage(messageEl, check.message);
    return;
  }
  showMessage(messageEl, '');
});

form?.addEventListener('submit', (event) => event.preventDefault());
form?.addEventListener('click', (event) => {
  if (event.target.closest('#codPayBtn')) {
    void handleCashOnDelivery(event);
  } else if (event.target.closest('#onlinePayBtn')) {
    void handleOnlinePayment(event);
  }
});
stickyEl?.addEventListener('click', (event) => {
  if (event.target.closest('#stickyCodBtn')) {
    void handleCashOnDelivery(event);
  } else if (event.target.closest('#stickyOnlineBtn')) {
    void handleOnlinePayment(event);
  }
});

subscribe(() => render());

await initCheckout('review');
const access = guardStep('review');
if (!access.ok) {
  console.warn('REDIRECT_REASON', access.code || 'UNKNOWN', access);
  window.location.href = access.redirect;
} else {
  render();
  window.__ckStep = 'review';
  void refreshBackendDeliveryQuote();
  await loadGatewayPaymentConfig();
  render();
}
