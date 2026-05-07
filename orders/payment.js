import { escapeHtml, formatCurrency } from './utils.js';
import {
  getResolvedCustomerName,
  getState,
  initializeOrderFlow,
  isCodAvailable,
  resolveStageAccess,
  setStage,
  submitOrder,
  subscribe,
  updatePaymentDetails,
  validatePaymentStage
} from './state.js';

const steps = [
  { id: 'shipping', label: 'Shipping' },
  { id: 'checkout', label: 'Checkout' },
  { id: 'payment', label: 'Payment' }
];

const ui = {
  progress: document.getElementById('checkoutProgress'),
  sidebar: document.getElementById('checkoutSidebar'),
  form: document.getElementById('paymentForm'),
  message: document.getElementById('paymentMessage'),
  loading: document.getElementById('checkoutLoading')
};

function renderProgress(activeStage) {
  const activeIndex = steps.findIndex((step) => step.id === activeStage);
  ui.progress.innerHTML = steps.map((step, index) => {
    const tone = index < activeIndex ? 'is-complete' : index === activeIndex ? 'is-active' : '';
    return `
      <button type="button" class="orders-progress-step ${tone}" disabled>
        <span>${index + 1}</span>
        <strong>${escapeHtml(step.label)}</strong>
      </button>
    `;
  }).join('');
}

function renderProducts(products) {
  return products.map((item) => `
    <article class="orders-summary-product">
      <img src="${escapeHtml(item.image || item.img || '')}" alt="${escapeHtml(item.name || 'Product')}">
      <div>
        <strong>${escapeHtml(item.name || 'Product')}</strong>
        <p>${escapeHtml(item.attributeSummary || 'Standard option')}</p>
        <span>Qty ${Number(item.qty || 0)} x ${formatCurrency(item.price || 0)}</span>
      </div>
      <strong>${formatCurrency(item.total || ((Number(item.qty || 0) || 0) * (Number(item.price || 0) || 0)))}</strong>
    </article>
  `).join('');
}

function renderSidebar(state) {
  const itemCount = state.products.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  ui.sidebar.innerHTML = `
    <section class="orders-sidebar-card orders-sidebar-card--sticky">
      <span class="orders-sidebar-label">Ready to place</span>
      <div class="orders-sidebar-heading">
        <h3>${escapeHtml(getResolvedCustomerName())}</h3>
        <span>${itemCount} item${itemCount === 1 ? '' : 's'}</span>
      </div>
      <div class="orders-summary-product-list orders-summary-product-list--compact">
        ${renderProducts(state.products)}
      </div>
      <div class="orders-total-row"><span>Subtotal</span><strong>${formatCurrency(state.totals.subtotal)}</strong></div>
      <div class="orders-total-row"><span>Shipping</span><strong>${formatCurrency(state.totals.shippingFee)}</strong></div>
      <div class="orders-total-row is-total"><span>Total</span><strong>${formatCurrency(state.totals.total)}</strong></div>
    </section>
  `;
}

function setMessage(message) {
  ui.message.hidden = !message;
  ui.message.textContent = message || '';
}

function syncForm(state) {
  ui.form.querySelectorAll('input[name="method"]').forEach((input) => {
    const isCodInput = input.value === 'cod';
    const isDisabled = isCodInput && !isCodAvailable();

    input.disabled = isDisabled;
    if (isDisabled && input.checked) {
      input.checked = false;
    }

    input.checked = input.value === state.payment.method;
    input.closest('.orders-choice-card')?.classList.toggle('is-selected', input.checked);
    input.closest('.orders-choice-card')?.classList.toggle('is-disabled', isDisabled);
  });

  const phoneInput = ui.form.querySelector('input[name="phone"]');
  if (phoneInput) {
    phoneInput.value = state.payment.phone || state.shippingAddress.phone || '';
  }
}

function bindForm() {
  ui.form.querySelectorAll('input[name="method"]').forEach((input) => {
    input.addEventListener('change', (event) => {
      updatePaymentDetails({ method: event.currentTarget.value });
      syncForm(getState());
      renderSidebar(getState());
      setMessage('');
    });
  });

  ui.form.querySelector('input[name="phone"]')?.addEventListener('input', (event) => {
    updatePaymentDetails({ phone: event.currentTarget.value });
    renderSidebar(getState());
    setMessage('');
  });

  ui.form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const phone = ui.form.querySelector('input[name="phone"]')?.value || '';
    const method = ui.form.querySelector('input[name="method"]:checked')?.value || 'mtn';
    updatePaymentDetails({ phone, method });

    const validation = validatePaymentStage();
    if (!validation.valid) {
      setMessage(validation.message || 'Complete payment details before placing the order.');
      return;
    }

    setMessage('');
    setStage('payment');
    const result = await submitOrder();
    if (!result.valid) {
      setMessage(result.message || 'Unable to place the order right now.');
      return;
    }

    window.location.assign(result.redirectUrl);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await initializeOrderFlow('payment');
  const access = resolveStageAccess('payment');
  if (!access.valid) {
    window.location.assign(access.redirectUrl);
    return;
  }

  subscribe((state) => {
    ui.loading.hidden = !state.isSubmitting;
  });

  const state = getState();
  renderProgress('payment');
  renderSidebar(state);
  syncForm(state);
  bindForm();
  setMessage('');
});