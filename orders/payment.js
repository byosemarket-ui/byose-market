import { escapeHtml, formatCurrency } from './utils.js';
import {
  mountStickyCheckoutBar,
  renderSelectedPaymentMethod,
  renderStageProgress,
  renderSummaryProducts
} from './checkout-ui.js';
import {
  getPaymentMethodLabel,
  getPaymentStateView,
  getState,
  initializeOrderFlow,
  resolveStageAccess,
  setStage,
  submitOrder,
  subscribe,
  updatePaymentDetails,
  validatePaymentStage
} from './state.js';

function getUi() {
  return {
    progress: document.getElementById('checkoutProgress'),
    sidebar: document.getElementById('checkoutSidebar'),
    form: document.getElementById('paymentForm'),
    message: document.getElementById('paymentMessage'),
    loading: document.getElementById('checkoutLoading'),
    methodSummary: document.getElementById('paymentMethodSummary'),
    statusCard: document.getElementById('paymentStatusCard'),
    stickyBar: document.getElementById('paymentStickyBar'),
    placeOrderButton: document.getElementById('placeOrderButton')
  };
}

function renderSidebar(state) {
  const ui = getUi();
  if (!ui.sidebar) {
    return;
  }

  const products = Array.isArray(state?.products) ? state.products : [];
  const totals = state?.totals || { subtotal: 0, shippingFee: 0, total: 0 };
  const payment = state?.payment || {};
  const itemCount = products.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const isSubmitting = Boolean(state?.isSubmitting);
  const hasProducts = products.length > 0;

  ui.sidebar.innerHTML = `
    <section class="orders-sidebar-card orders-sidebar-card--sticky orders-order-summary-card">
      <span class="orders-sidebar-label">Order summary</span>
      <div class="orders-sidebar-heading">
        <h3>${itemCount} item${itemCount === 1 ? '' : 's'}</h3>
        <span>${escapeHtml(getPaymentMethodLabel(payment.method) || 'Select payment')}</span>
      </div>
      <div class="orders-summary-product-list orders-summary-product-list--compact">
        ${renderSummaryProducts(products)}
      </div>
      <div class="orders-total-row"><span>Subtotal</span><strong>${formatCurrency(totals.subtotal)}</strong></div>
      <div class="orders-total-row"><span>Delivery fee</span><strong>${formatCurrency(totals.shippingFee)}</strong></div>
      <div class="orders-total-row is-total"><span>Total</span><strong>${formatCurrency(totals.total)}</strong></div>
      <button type="submit" class="orders-next-button orders-place-order-button" form="paymentForm" ${isSubmitting || !hasProducts ? 'disabled' : ''}>
        ${isSubmitting ? 'Placing Order...' : 'Place Order'}
      </button>
    </section>
  `;

  if (ui.placeOrderButton) {
    ui.placeOrderButton.disabled = isSubmitting || !hasProducts;
    ui.placeOrderButton.textContent = isSubmitting ? 'Placing Order...' : 'Place Order';
  }
}

function renderStickyActions(state) {
  const totals = state.totals || { total: 0 };
  const products = Array.isArray(state.products) ? state.products : [];
  const isSubmitting = Boolean(state?.isSubmitting);
  const stickyBar = document.getElementById('paymentStickyBar');

  mountStickyCheckoutBar(stickyBar, {
    total: totals.total,
    label: 'Total due',
    buttonText: isSubmitting ? 'Placing...' : 'Place Order',
    disabled: isSubmitting || !products.length,
    onAction: () => document.getElementById('paymentForm')?.requestSubmit()
  });
}

function setMessage(message) {
  const ui = getUi();
  if (!ui.message) {
    return;
  }
  ui.message.hidden = !message;
  ui.message.textContent = message || '';
}

function renderPaymentSummary(state) {
  const ui = getUi();
  const paymentState = getPaymentStateView();

  if (ui.methodSummary) {
    ui.methodSummary.innerHTML = renderSelectedPaymentMethod(state, { showPhone: true });
  }

  if (ui.statusCard) {
    ui.statusCard.innerHTML = `
      <span class="orders-payment-state-pill is-${escapeHtml(paymentState.tone)}">${escapeHtml(paymentState.label)}</span>
      <p>Your order will be created and sent to Admin Orders after you place it.</p>
    `;
  }
}

function syncForm(state) {
  const ui = getUi();
  const phoneInput = ui.form?.querySelector('input[name="phone"]');
  if (phoneInput) {
    phoneInput.value = state.payment.phone || state.shippingAddress.phone || '';
  }

  renderPaymentSummary(state);
}

async function handleSubmit(event) {
  event.preventDefault();
  const ui = getUi();

  const phone = ui.form.querySelector('input[name="phone"]')?.value || '';
  updatePaymentDetails({ phone, method: getState().payment.method });

  const validation = validatePaymentStage();
  if (!validation.valid) {
    setMessage(validation.message || 'Complete payment details before placing the order.');
    render(getState());
    return;
  }

  setMessage('');
  setStage('payment');
  const result = await submitOrder();
  if (!result.valid) {
    setMessage(result.message || 'Unable to place the order right now.');
    render(getState());
    return;
  }

  window.location.assign(result.redirectUrl);
}

function render(state) {
  const ui = getUi();
  const snapshot = state || getState();

  renderStageProgress(ui.progress, 'payment');
  syncForm(snapshot);

  try {
    renderSidebar(snapshot);
  } catch (error) {
    console.error('Payment sidebar render failed:', error);
  }

  renderStickyActions(snapshot);

  if (ui.loading) {
    ui.loading.hidden = !snapshot.isSubmitting;
  }
}

function bindForm() {
  const ui = getUi();

  ui.form?.querySelector('input[name="phone"]')?.addEventListener('input', (event) => {
    updatePaymentDetails({ phone: event.currentTarget.value });
    setMessage('');
  });

  ui.form?.addEventListener('submit', handleSubmit);
}

document.addEventListener('DOMContentLoaded', async () => {
  await initializeOrderFlow('payment');
  const access = resolveStageAccess('payment');
  if (!access.valid) {
    window.location.assign(access.redirectUrl);
    return;
  }

  subscribe((state) => {
    render(state);
  });

  bindForm();
  setMessage('');
  render(getState());
});
