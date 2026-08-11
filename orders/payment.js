import { initiateDpoPayment, submitOrder } from './core/order.js';
import {
  applyCheckoutCoupon,
  clearCheckoutCoupon,
  getPaymentMethods, getState, guardStep, initCheckout,
  loadGatewayPaymentConfig,
  setPaymentMethod, setPaymentPhone, subscribe
} from './core/state.js';
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
const phoneInput = document.querySelector('input[name="paymentPhone"]');
const messageEl = document.getElementById('message');
const form = document.getElementById('paymentForm');
const placeBtn = document.getElementById('placeOrderBtn');

function setBusy(isBusy, label) {
  const busyLabel = label || 'Placing order...';
  const idleLabel = getState().payment.method === 'dpo' ? 'Pay with DPO' : 'Place Order';
  if (placeBtn) {
    placeBtn.disabled = isBusy;
    placeBtn.textContent = isBusy ? busyLabel : idleLabel;
  }
  const stickyBtn = document.getElementById('stickyContinueBtn');
  if (stickyBtn) {
    stickyBtn.disabled = isBusy;
    stickyBtn.textContent = isBusy ? busyLabel : idleLabel;
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

  const isCod = state.payment.method === 'cod';
  const isDpo = state.payment.method === 'dpo';
  phoneField.hidden = isCod || isDpo;
  if (!isCod && !isDpo && !phoneInput.value) {
    phoneInput.value = state.payment.phone || state.shipping.phone || '';
  }
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
  const cta = state.payment.method === 'dpo' ? 'Pay with DPO' : 'Place Order';
  stickyEl.innerHTML = renderStickyBar(cta, 'placeOrderBtn', { disabled: state.isSubmitting });
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

phoneInput?.addEventListener('input', () => {
  setPaymentPhone(phoneInput.value);
});

form?.addEventListener('submit', handlePlaceOrder);
placeBtn?.addEventListener('click', (e) => { e.preventDefault(); handlePlaceOrder(e); });

async function handlePlaceOrder(e) {
  e?.preventDefault?.();
  showMessage(messageEl, '');

  if (getState().isSubmitting) {
    return;
  }

  const state = getState();
  if (state.payment.method !== 'cod' && state.payment.method !== 'dpo') {
    setPaymentPhone(phoneInput.value);
  }

  const check = validatePayment(getState().payment, getState().shipping);
  if (!check.valid) {
    const msg = check.errors.method || check.errors.phone || 'Please complete payment details.';
    showMessage(messageEl, msg);
    if (check.errors.phone) {
      document.querySelector('[data-error="phone"]').textContent = check.errors.phone;
    }
    return;
  }

  const usesDpo = getState().payment.method === 'dpo';
  setBusy(true, usesDpo ? 'Starting secure payment...' : 'Placing order...');

  try {
    const result = await submitOrder();
    if (!result.valid) {
      showMessage(messageEl, result.message || result.errors?.method || 'Unable to place order.');
      setBusy(false);
      return;
    }

    if (usesDpo) {
      setBusy(true, 'Redirecting to DPO Pay...');
      const payment = await initiateDpoPayment(result.orderId);
      if (!payment.success || (!payment.paymentUrl && !payment.redirectUrl)) {
        showMessage(
          messageEl,
          payment.message || 'Order was created but DPO payment could not start. Open your orders and try again.'
        );
        setBusy(false);
        return;
      }
      window.location.href = payment.paymentUrl || payment.redirectUrl;
      return;
    }

    window.location.href = `order-success.html?orderId=${encodeURIComponent(result.orderId)}`;
  } catch (err) {
    console.error(err);
    showMessage(messageEl, 'Something went wrong. Please try again.');
    setBusy(false);
  }
}

guardStep('payment');
subscribe(render);
initCheckout('payment').then(async () => {
  await loadGatewayPaymentConfig();
  render();
});
