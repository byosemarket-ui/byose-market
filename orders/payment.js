import { initiateDpoPayment, submitOrder } from './core/order.js';
import {
  getPaymentMethods, getState, guardStep, initCheckout,
  loadGatewayPaymentConfig,
  refreshBackendDeliveryQuote,
  setPaymentMethod,
  setPaymentPhone,
  setSubmitting,
  subscribe
} from './core/state.js';
import { isCodPaymentMethod, isGatewayPaymentMethod, paymentCtaLabel } from './core/constants.js';
import {
  readAwaitingGatewayOrderId,
  writeAwaitingGatewayOrderId
} from './checkout-session.js';
import { validatePayment } from './core/validation.js';
import { formatCurrency } from './utils.js';
import {
  renderPaymentMethods, renderProgress, renderCompactDeliverySummary,
  renderSidebar, renderStickyBar, renderTotals, showMessage
} from './ui/layout.js';
import { readMomoPhoneFromPanel, renderPaymentPanel } from './ui/payment-panel.js';

const progressEl = document.getElementById('progress');
const sidebarEl = document.getElementById('sidebar');
const stickyEl = document.getElementById('stickyBar');
const methodsEl = document.getElementById('paymentMethods');
const totalsBlockEl = document.getElementById('totalsBlock');
const shippingSummaryEl = document.getElementById('paymentShippingSummary');
const methodPanelEl = document.getElementById('paymentMethodPanel');
const messageEl = document.getElementById('message');
const form = document.getElementById('paymentForm');
const placeBtn = document.getElementById('placeOrderBtn');
let createdGatewayOrderId = readAwaitingGatewayOrderId();
let placeInFlight = false;

function rememberGatewayOrder(orderId) {
  createdGatewayOrderId = String(orderId || '').trim();
  if (createdGatewayOrderId) writeAwaitingGatewayOrderId(createdGatewayOrderId);
}

function selectedMethod() {
  return String(getState().payment.method || '').toLowerCase();
}

function idleCta() {
  const state = getState();
  return paymentCtaLabel(selectedMethod(), formatCurrency(state.totals.total));
}

function setBusy(isBusy, label) {
  const busyLabel = label || 'Placing order...';
  const nextLabel = isBusy ? busyLabel : idleCta();
  if (placeBtn) {
    placeBtn.disabled = isBusy;
    placeBtn.textContent = nextLabel;
  }
  const stickyBtn = document.getElementById('stickyContinueBtn');
  if (stickyBtn) {
    stickyBtn.disabled = isBusy;
    stickyBtn.textContent = nextLabel;
  }
  const momoInput = document.getElementById('momoPhoneInput');
  if (momoInput) momoInput.disabled = Boolean(isBusy);
}

function bindMomoPhone() {
  const input = document.getElementById('momoPhoneInput');
  input?.addEventListener('input', () => {
    input.value = String(input.value || '').replace(/\D/g, '').slice(0, 9);
    const errorEl = methodPanelEl?.querySelector('[data-error="phone"]');
    if (errorEl) errorEl.textContent = '';
  });
}

function renderMethods() {
  const state = getState();
  const methods = getPaymentMethods();
  methodsEl.innerHTML = renderPaymentMethods(methods, state.payment.method);
  if (methodPanelEl) {
    methodPanelEl.innerHTML = renderPaymentPanel({
      method: state.payment.method,
      totals: state.totals,
      shipping: state.shipping,
      payment: state.payment
    });
    bindMomoPhone();
  }
}

function render() {
  const state = getState();
  progressEl.innerHTML = renderProgress('payment');
  if (shippingSummaryEl) {
    shippingSummaryEl.innerHTML = renderCompactDeliverySummary(state.shipping);
  }
  renderMethods();
  totalsBlockEl.innerHTML = renderTotals(state.totals);
  sidebarEl.innerHTML = renderSidebar(state.products, state.totals);
  stickyEl.innerHTML = renderStickyBar(idleCta(), 'placeOrderBtn', { disabled: state.isSubmitting });
  document.getElementById('stickyContinueBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    handlePlaceOrder(e);
  });
  setBusy(state.isSubmitting);
}

methodsEl?.addEventListener('change', (e) => {
  if (e.target.name === 'paymentMethod') {
    setPaymentMethod(e.target.value);
    render();
  }
});

form?.addEventListener('submit', handlePlaceOrder);
placeBtn?.addEventListener('click', (e) => { e.preventDefault(); handlePlaceOrder(e); });

async function startGatewayPayment(orderId, method) {
  setBusy(true, method === 'mtn' ? 'Starting MTN MoMo...' : 'Opening secure card payment...');
  const payment = await initiateDpoPayment(orderId);
  if (payment.alreadyPaid) {
    window.location.href = `order-success.html?orderId=${encodeURIComponent(orderId)}`;
    return true;
  }
  if (!payment.success || (!payment.paymentUrl && !payment.redirectUrl)) {
    showMessage(
      messageEl,
      payment.message || 'Online payment could not start. You can try again without placing a new order.'
    );
    return false;
  }
  window.location.href = payment.paymentUrl || payment.redirectUrl;
  return true;
}

function releasePlaceLock() {
  placeInFlight = false;
  setSubmitting(false);
  setBusy(false);
}

async function handlePlaceOrder(e) {
  e?.preventDefault?.();
  showMessage(messageEl, '');

  const method = selectedMethod();
  const usesGateway = isGatewayPaymentMethod(method);
  const usesCod = isCodPaymentMethod(method);

  if (placeInFlight || getState().isSubmitting) {
    return;
  }
  placeInFlight = true;

  if (method === 'mtn') {
    setPaymentPhone(readMomoPhoneFromPanel(methodPanelEl) || getState().payment.phone);
  }

  const check = validatePayment(getState().payment, getState().shipping);
  if (!check.valid) {
    const msg = check.errors.method || check.errors.phone || 'Please complete payment details.';
    showMessage(messageEl, msg);
    const phoneError = methodPanelEl?.querySelector('[data-error="phone"]');
    if (phoneError && check.errors.phone) phoneError.textContent = check.errors.phone;
    releasePlaceLock();
    return;
  }

  setBusy(true, usesGateway ? idleCta() : 'Placing order...');

  try {
    if (createdGatewayOrderId) {
      if (usesGateway) {
        const started = await startGatewayPayment(createdGatewayOrderId, method);
        if (!started) releasePlaceLock();
        return;
      }
      showMessage(
        messageEl,
        'This order is already created for online payment. Complete MTN MoMo or Card for the same order. Cash on Delivery cannot replace a started online payment.'
      );
      releasePlaceLock();
      return;
    }

    const result = await submitOrder();
    if (!result.valid) {
      showMessage(messageEl, result.message || result.errors?.method || result.errors?.phone || 'Unable to place order.');
      releasePlaceLock();
      return;
    }

    if (usesGateway) {
      rememberGatewayOrder(result.orderId);
      const started = await startGatewayPayment(result.orderId, method);
      if (!started) releasePlaceLock();
      return;
    }

    if (!usesCod && !usesGateway) {
      showMessage(messageEl, 'Select MTN MoMo, Card, or Cash on Delivery.');
      releasePlaceLock();
      return;
    }

    window.location.href = `order-success.html?orderId=${encodeURIComponent(result.orderId)}`;
  } catch (_error) {
    showMessage(messageEl, 'Something went wrong. Please try again.');
    releasePlaceLock();
  }
}

subscribe(render);
initCheckout('payment').then(async () => {
  const access = guardStep('payment');
  if (!access.ok) {
    window.location.href = access.redirect;
    return;
  }
  window.__ckStep = 'payment';
  await loadGatewayPaymentConfig();
  void refreshBackendDeliveryQuote();
  const state = getState();
  if (!state.payment.phone && state.shipping.phone) {
    setPaymentPhone(state.shipping.phone);
  }
  render();
});
