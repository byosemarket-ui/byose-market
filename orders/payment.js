import { initiateDpoPayment, submitOrder } from './core/order.js';
import {
  applyCheckoutCoupon,
  clearCheckoutCoupon,
  getPaymentMethods, getState, guardStep, initCheckout,
  loadGatewayPaymentConfig,
  refreshBackendDeliveryQuote,
  setPaymentMethod,
  setSubmitting,
  subscribe
} from './core/state.js';
import { isCodPaymentMethod, isGatewayPaymentMethod, paymentCtaLabel } from './core/constants.js';
import {
  readAwaitingGatewayOrderId,
  writeAwaitingGatewayOrderId
} from './checkout-session.js';
import { validatePayment } from './core/validation.js';
import {
  renderCouponPanel, renderPaymentInstructions, renderPaymentMethods, renderProgress, renderShippingSummary,
  renderSidebar, renderStickyBar, renderTotals, showMessage
} from './ui/layout.js';

const progressEl = document.getElementById('progress');
const sidebarEl = document.getElementById('sidebar');
const stickyEl = document.getElementById('stickyBar');
const methodsEl = document.getElementById('paymentMethods');
const couponBlockEl = document.getElementById('couponBlock');
const totalsBlockEl = document.getElementById('totalsBlock');
const shippingSummaryEl = document.getElementById('paymentShippingSummary');
const instructionsEl = document.getElementById('paymentInstructions');
const phoneField = document.getElementById('paymentPhoneField');
const messageEl = document.getElementById('message');
const form = document.getElementById('paymentForm');
const placeBtn = document.getElementById('placeOrderBtn');
let createdGatewayOrderId = readAwaitingGatewayOrderId();

function rememberGatewayOrder(orderId) {
  createdGatewayOrderId = String(orderId || '').trim();
  if (createdGatewayOrderId) writeAwaitingGatewayOrderId(createdGatewayOrderId);
}

function selectedMethod() {
  return String(getState().payment.method || '').toLowerCase();
}

function idleCta() {
  return paymentCtaLabel(selectedMethod());
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
}

function bindCouponPanel() {
  const applyBtn = document.getElementById('couponApplyBtn');
  const clearBtn = document.getElementById('couponClearBtn');
  const input = document.getElementById('couponCodeInput');
  const message = document.getElementById('couponMessage');

  applyBtn?.addEventListener('click', async () => {
    applyBtn.disabled = true;
    const result = await applyCheckoutCoupon(input?.value || '');
    if (!result.ok && message) {
      message.textContent = result.message || 'Unable to apply coupon.';
    }
    applyBtn.disabled = false;
    render();
  });

  clearBtn?.addEventListener('click', () => {
    clearCheckoutCoupon();
    render();
  });
}

function renderMethods() {
  const state = getState();
  const methods = getPaymentMethods();
  methodsEl.innerHTML = renderPaymentMethods(methods, state.payment.method);
  if (phoneField) phoneField.hidden = true;
  if (instructionsEl) {
    instructionsEl.innerHTML = renderPaymentInstructions(state.payment.method, state.totals);
  }
}

function render() {
  const state = getState();
  progressEl.innerHTML = renderProgress('payment');
  if (shippingSummaryEl) {
    shippingSummaryEl.innerHTML = renderShippingSummary(state.shipping);
  }
  renderMethods();
  if (couponBlockEl) {
    couponBlockEl.innerHTML = renderCouponPanel(state.coupon);
    bindCouponPanel();
  }
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
  setBusy(true, method === 'mtn' ? 'Redirecting to MTN MoMo...' : 'Redirecting to card payment...');
  const payment = await initiateDpoPayment(orderId);
  if (payment.alreadyPaid) {
    window.location.href = `order-success.html?orderId=${encodeURIComponent(orderId)}`;
    return true;
  }
  if (!payment.success || (!payment.paymentUrl && !payment.redirectUrl)) {
    showMessage(
      messageEl,
      payment.message || 'Order was created but online payment could not start. You can try again without placing a new order.'
    );
    setSubmitting(false);
    setBusy(false);
    return false;
  }
  window.location.href = payment.paymentUrl || payment.redirectUrl;
  return true;
}

async function handlePlaceOrder(e) {
  e?.preventDefault?.();
  showMessage(messageEl, '');

  const method = selectedMethod();
  const usesGateway = isGatewayPaymentMethod(method);
  const usesCod = isCodPaymentMethod(method);

  if (getState().isSubmitting) {
    return;
  }

  const check = validatePayment(getState().payment, getState().shipping);
  if (!check.valid) {
    const msg = check.errors.method || check.errors.phone || 'Please complete payment details.';
    showMessage(messageEl, msg);
    return;
  }

  setBusy(true, usesGateway ? 'Starting secure payment...' : 'Placing order...');

  try {
    if (createdGatewayOrderId) {
      if (usesGateway) {
        await startGatewayPayment(createdGatewayOrderId, method);
        return;
      }
      showMessage(
        messageEl,
        'This order is already created for online payment. Complete MTN MoMo or Card for the same order. Cash on Delivery cannot replace a started online payment.'
      );
      setSubmitting(false);
      setBusy(false);
      return;
    }

    const result = await submitOrder();
    if (!result.valid) {
      showMessage(messageEl, result.message || result.errors?.method || 'Unable to place order.');
      setSubmitting(false);
      setBusy(false);
      return;
    }

    if (usesGateway) {
      rememberGatewayOrder(result.orderId);
      await startGatewayPayment(result.orderId, method);
      return;
    }

    if (!usesCod && !usesGateway) {
      showMessage(messageEl, 'Select MTN MoMo, Card, or Cash on Delivery.');
      setSubmitting(false);
      setBusy(false);
      return;
    }

    window.location.href = `order-success.html?orderId=${encodeURIComponent(result.orderId)}`;
  } catch (_error) {
    showMessage(messageEl, 'Something went wrong. Please try again.');
    setSubmitting(false);
    setBusy(false);
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
  render();
});
