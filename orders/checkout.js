import { escapeHtml, formatCurrency } from './utils.js';
import {
  getResolvedCustomerName,
  getState,
  initializeOrderFlow,
  isCodAvailable,
  resolveStageAccess,
  submitOrder,
  subscribe,
  updatePaymentDetails,
  updateProductQuantity,
  validatePaymentStage,
  validateShippingStage
} from './state.js';

const steps = [
  { id: 'shipping', label: 'Shipping' },
  { id: 'checkout', label: 'Checkout' },
  { id: 'payment', label: 'Payment' }
];

const paymentOptions = [
  {
    id: 'mtn',
    title: 'MTN Mobile Money',
    detail: 'Pay with MTN MoMo',
    icon: '../img/MTN.jpeg'
  },
  {
    id: 'airtel',
    title: 'Airtel Money',
    detail: 'Use Airtel Money',
    icon: '../img/airtel.jpeg'
  },
  {
    id: 'bank',
    title: 'Bank Transfer',
    detail: 'Pay by Bank Transfer',
    icon: '../img/BANK TRANSFER.jpeg'
  },
  {
    id: 'card',
    title: 'Visa / Mastercard',
    detail: 'Pay with Visa or Mastercard',
    icon: '../img/VASA  MASTERCARD.jpeg'
  },
  {
    id: 'cod',
    title: 'Pay on Delivery',
    detail: 'Pay after receiving your order.',
    detailSecondary: 'Available in Kigali only.',
    detailRw: 'Wishyura nyuma yo kwakira igicuruzwa, ukishyura umaze kugenzura ko gihuye n’icyo waguze.',
    unavailable: 'Iyi serivisi iboneka gusa mu Mujyi wa Kigali.',
    icon: '../img/PAY ON DELIVERY.jpeg'
  }
];

const ui = {
  progress: document.getElementById('checkoutProgress'),
  sidebar: document.getElementById('checkoutSidebar'),
  message: document.getElementById('checkoutMessage'),
  content: document.getElementById('checkoutContent'),
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

function setMessage(message) {
  ui.message.hidden = !message;
  ui.message.textContent = message || '';
}

function getPaymentLabel(method) {
  return paymentOptions.find((option) => option.id === method)?.title || 'Not selected';
}

function renderShippingSummary(state) {
  const address = state.shippingAddress || {};
  const addressText = [
    address.provinceCity || address.city,
    address.district,
    address.sector,
    address.cell,
    address.village,
    address.note
  ].filter(Boolean).join(', ');

  return `
    <section class="orders-review-card orders-review-card--summary">
      <div class="orders-section-head">
        <div class="orders-shipping-summary-copy">
          <span class="orders-sidebar-label">Shipping summary</span>
          <div class="orders-shipping-summary-inline">
            <h3>${escapeHtml(getResolvedCustomerName())}</h3>
            <span>${escapeHtml(address.phone || '')}</span>
          </div>
          <p class="orders-shipping-summary-address">${escapeHtml(addressText || 'Address not available')}</p>
        </div>
        <a class="orders-text-link" href="shipping.html">Change</a>
      </div>
    </section>
  `;
}

function renderProductList(state) {
  return `
    <section class="orders-review-card">
      <div class="orders-section-head">
        <div>
          <span class="orders-sidebar-label">Products</span>
          <h3>Review items</h3>
        </div>
      </div>
      <div class="orders-product-list">
        ${state.products.map((item) => `
          <article class="orders-review-product" data-product-id="${escapeHtml(item.id)}" data-variant-key="${escapeHtml(item.variantKey || '')}">
            <img src="${escapeHtml(item.image || item.img || '')}" alt="${escapeHtml(item.name || 'Product')}">
            <div class="orders-review-product-copy">
              <div class="orders-review-product-top">
                <div class="orders-review-product-meta">
                  <h4>${escapeHtml(item.name || 'Product')}</h4>
                  <p>${escapeHtml(item.color || item.size ? [item.color, item.size].filter(Boolean).join(' • ') : (item.attributeSummary || 'Standard option'))}</p>
                  <strong class="orders-review-unit-price">${formatCurrency(item.price || 0)}</strong>
                </div>
              </div>
              <div class="orders-review-product-bottom">
                <div class="orders-qty-control">
                  <button type="button" data-action="decrease" aria-label="Decrease quantity">-</button>
                  <input type="number" min="1" value="${Number(item.qty || 1)}" aria-label="Quantity for ${escapeHtml(item.name || 'Product')}">
                  <button type="button" data-action="increase" aria-label="Increase quantity">+</button>
                </div>
                <div class="orders-review-price-stack">
                  <span>Subtotal</span>
                  <strong>${formatCurrency(item.total || ((Number(item.qty || 0) || 0) * (Number(item.price || 0) || 0)))}</strong>
                </div>
              </div>
            </div>
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function renderPaymentMethods(state) {
  const codVisible = isCodAvailable();

  return `
    <section class="orders-review-card">
      <div class="orders-section-head">
        <div>
          <span class="orders-sidebar-label">Payment methods</span>
          <h3>Select one payment method</h3>
        </div>
      </div>
      <div class="orders-payment-list" role="radiogroup" aria-label="Payment methods">
        ${paymentOptions.map((option) => {
          const isDisabled = option.id === 'cod' && !codVisible;
          return `
          <label class="orders-payment-option ${state.payment.method === option.id ? 'is-selected' : ''} ${isDisabled ? 'is-disabled' : ''}">
            <input type="radio" name="checkoutPaymentMethod" value="${option.id}" ${state.payment.method === option.id ? 'checked' : ''} ${isDisabled ? 'disabled' : ''}>
            <span class="orders-payment-radio" aria-hidden="true"></span>
            <img class="orders-payment-icon" src="${escapeHtml(option.icon)}" alt="${escapeHtml(option.title)} icon">
            <div class="orders-payment-option-copy">
              <strong>${escapeHtml(option.title)}</strong>
              <p>${escapeHtml(option.detail)}</p>
              ${option.detailSecondary ? `<p>${escapeHtml(option.detailSecondary)}</p>` : ''}
              ${option.detailRw ? `<p>${escapeHtml(option.detailRw)}</p>` : ''}
              ${isDisabled ? `<small class="orders-payment-warning">${escapeHtml(option.unavailable || 'Not available in your area.')}</small>` : ''}
            </div>
          </label>
        `;
        }).join('')}
      </div>
    </section>
  `;
}

async function handlePlaceOrder() {
  const shippingValidation = validateShippingStage();
  if (!shippingValidation.valid) {
    setMessage(shippingValidation.message || 'Shipping data is incomplete.');
    window.location.assign('shipping.html');
    return;
  }

  const paymentValidation = validatePaymentStage();
  if (!paymentValidation.valid) {
    setMessage(paymentValidation.message || 'Select a payment method before placing the order.');
    return;
  }

  setMessage('');
  const result = await submitOrder();
  if (!result.valid) {
    setMessage(result.message || 'Unable to place the order right now.');
    return;
  }

  window.location.assign(result.redirectUrl);
}

function renderSidebar(state) {
  const shippingValid = validateShippingStage().valid;
  const hasSelectedPayment = Boolean(state.payment.method);
  const isDisabled = state.isSubmitting || !state.products.length || !shippingValid || !hasSelectedPayment;
  const itemCount = state.products.reduce((sum, item) => sum + Number(item.qty || 0), 0);

  ui.sidebar.innerHTML = `
    <section class="orders-sidebar-card orders-sidebar-card--sticky orders-order-summary-card">
      <span class="orders-sidebar-label">Order summary</span>
      <div class="orders-sidebar-heading">
        <h3>${itemCount} item${itemCount === 1 ? '' : 's'}</h3>
        <span>${escapeHtml(getPaymentLabel(state.payment.method))}</span>
      </div>
      <div class="orders-total-row">
        <span>Subtotal</span>
        <strong>${formatCurrency(state.totals.subtotal)}</strong>
      </div>
      <div class="orders-total-row">
        <span>Delivery fee</span>
        <strong>${formatCurrency(state.totals.shippingFee)}</strong>
      </div>
      <div class="orders-total-row is-total">
        <span>Total</span>
        <strong>${formatCurrency(state.totals.total)}</strong>
      </div>
      <button type="button" class="orders-next-button orders-place-order-button" id="placeOrderButton" ${isDisabled ? 'disabled' : ''}>
        ${state.isSubmitting ? 'Placing Order...' : 'Place Order'}
      </button>
    </section>
    <section class="orders-mobile-checkout-bar" aria-label="Mobile checkout actions">
      <div class="orders-mobile-checkout-total">
        <span>Total</span>
        <strong>${formatCurrency(state.totals.total)}</strong>
      </div>
      <button type="button" class="orders-mobile-checkout-button" id="mobilePlaceOrderButton" ${isDisabled ? 'disabled' : ''}>
        ${state.isSubmitting ? 'Placing Order...' : 'Place Order'}
      </button>
    </section>
  `;

  ui.sidebar.querySelectorAll('#placeOrderButton, #mobilePlaceOrderButton').forEach((button) => {
    button.addEventListener('click', handlePlaceOrder);
  });
}

function renderContent(state) {
  ui.content.innerHTML = `
    <div class="orders-step-stack orders-step-stack--review">
      ${renderShippingSummary(state)}
      ${renderProductList(state)}
      ${renderPaymentMethods(state)}
    </div>
  `;

  ui.content.querySelectorAll('.orders-review-product').forEach((row) => {
    const productId = row.getAttribute('data-product-id') || '';
    const variantKey = row.getAttribute('data-variant-key') || '';
    const input = row.querySelector('input[type="number"]');
    const readQuantity = () => Math.max(1, Number(input?.value || 1) || 1);

    row.querySelector('[data-action="decrease"]')?.addEventListener('click', () => {
      updateProductQuantity(productId, variantKey, readQuantity() - 1);
    });

    row.querySelector('[data-action="increase"]')?.addEventListener('click', () => {
      updateProductQuantity(productId, variantKey, readQuantity() + 1);
    });

    input?.addEventListener('change', () => {
      updateProductQuantity(productId, variantKey, readQuantity());
    });
  });

  ui.content.querySelectorAll('input[name="checkoutPaymentMethod"]').forEach((input) => {
    input.addEventListener('change', (event) => {
      updatePaymentDetails({ method: event.currentTarget.value });
      setMessage('');
    });
  });
}

function render(state) {
  if (!state.products.length) {
    window.location.assign('../cart.html');
    return;
  }

  renderProgress('checkout');
  renderContent(state);
  renderSidebar(state);

  if (ui.loading) {
    ui.loading.hidden = !state.isSubmitting;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await initializeOrderFlow('checkout');
  const access = resolveStageAccess('checkout');
  if (!access.valid) {
    window.location.assign(access.redirectUrl);
    return;
  }

  subscribe((state) => {
    render(state);
  });

  setMessage('');
  render(getState());
});