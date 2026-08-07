import { submitOrder } from './core/order.js';
import {
  getPaymentMethods, getState, guardStep, initCheckout,
  setPaymentMethod, setPaymentPhone, subscribe
} from './core/state.js';
import { validatePayment } from './core/validation.js';
import {
  renderPaymentInstructions, renderPaymentMethods, renderProgress, renderSidebar,
  renderStickyBar, renderTotals, showMessage
} from './ui/layout.js';

const progressEl = document.getElementById('progress');
const sidebarEl = document.getElementById('sidebar');
const stickyEl = document.getElementById('stickyBar');
const methodsEl = document.getElementById('paymentMethods');
const totalsBlockEl = document.getElementById('totalsBlock');
const instructionsEl = document.getElementById('paymentInstructions');
const phoneField = document.getElementById('paymentPhoneField');
const phoneInput = document.querySelector('input[name="paymentPhone"]');
const messageEl = document.getElementById('message');
const form = document.getElementById('paymentForm');
const placeBtn = document.getElementById('placeOrderBtn');

function setBusy(isBusy) {
  if (placeBtn) {
    placeBtn.disabled = isBusy;
    placeBtn.textContent = isBusy ? 'Placing order...' : 'Place Order';
  }
  const stickyBtn = document.getElementById('stickyContinueBtn');
  if (stickyBtn) {
    stickyBtn.disabled = isBusy;
    stickyBtn.textContent = isBusy ? 'Placing order...' : 'Place Order';
  }
}

function renderMethods() {
  const state = getState();
  const methods = getPaymentMethods();
  methodsEl.innerHTML = renderPaymentMethods(methods, state.payment.method);

  const isCod = state.payment.method === 'cod';
  phoneField.hidden = isCod;
  if (!isCod && !phoneInput.value) {
    phoneInput.value = state.payment.phone || state.shipping.phone || '';
  }
  if (instructionsEl) {
    instructionsEl.innerHTML = renderPaymentInstructions(state.payment.method, state.totals);
  }
}

function render() {
  const state = getState();
  progressEl.innerHTML = renderProgress('payment');
  renderMethods();
  totalsBlockEl.innerHTML = renderTotals(state.totals);
  sidebarEl.innerHTML = renderSidebar(state.products, state.totals);
  stickyEl.innerHTML = renderStickyBar('Place Order', 'placeOrderBtn', { disabled: state.isSubmitting });
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
  if (state.payment.method !== 'cod') {
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

  setBusy(true);

  try {
    const result = await submitOrder();
    if (!result.valid) {
      showMessage(messageEl, result.message || result.errors?.method || 'Unable to place order.');
      setBusy(false);
      return;
    }
    window.location.href = `order-success.html?orderId=${encodeURIComponent(result.orderId)}`;
  } catch (err) {
    console.error(err);
    showMessage(messageEl, 'Something went wrong. Please try again.');
    setBusy(false);
  }
}

subscribe(() => render());

await initCheckout('payment');
const access = guardStep('payment');
if (!access.ok) {
  window.location.href = access.redirect;
} else {
  render();
  window.__ckStep = 'payment';
}
