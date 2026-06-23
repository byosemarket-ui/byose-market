import { escapeHtml, formatCurrency, formatVariantDetailsText } from './utils.js';
import { mountStickyCheckoutBar, renderStageProgress, renderSummaryProducts } from './checkout-ui.js';
import {
  getResolvedCustomerName,
  getStageUrl,
  getState,
  initializeOrderFlow,
  resolveStageAccess,
  setStage,
  subscribe,
  updateProductQuantity,
  validateShippingStage
} from './state.js';

const ui = {
  progress: document.getElementById('checkoutProgress'),
  sidebar: document.getElementById('checkoutSidebar'),
  message: document.getElementById('checkoutMessage'),
  content: document.getElementById('checkoutContent'),
  loading: document.getElementById('checkoutLoading'),
  stickyBar: document.getElementById('checkoutStickyBar')
};

function setMessage(message) {
  ui.message.hidden = !message;
  ui.message.textContent = message || '';
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

  const gpsText = address.latitude && address.longitude
    ? `${address.latitude}, ${address.longitude}`
    : '';

  return `
    <section class="orders-review-card orders-review-card--summary">
      <div class="orders-section-head">
        <div class="orders-shipping-summary-copy">
          <span class="orders-sidebar-label">Delivery</span>
          <div class="orders-shipping-summary-inline">
            <h3>${escapeHtml(getResolvedCustomerName())}</h3>
            <span>${escapeHtml(address.phone || '')}</span>
          </div>
          <p class="orders-shipping-summary-address">${escapeHtml(addressText || 'Address not available')}</p>
          ${gpsText ? `<p class="orders-shipping-summary-gps">GPS: ${escapeHtml(gpsText)}</p>` : ''}
        </div>
        <a class="orders-text-link" href="shipping.html">Edit</a>
      </div>
    </section>
  `;
}

function renderProductList(state) {
  return `
    <section class="orders-review-card">
      <div class="orders-section-head">
        <div>
          <span class="orders-sidebar-label">Order items</span>
          <h3>${state.products.length} product${state.products.length === 1 ? '' : 's'}</h3>
        </div>
      </div>
      <div class="orders-product-list">
        ${state.products.map((item) => `
          <article class="orders-review-product" data-product-id="${escapeHtml(item.id)}" data-variant-key="${escapeHtml(item.variantKey || '')}">
            <img src="${escapeHtml(item.colorImage || item.image || item.img || '')}" alt="${escapeHtml(item.name || 'Product')}">
            <div class="orders-review-product-copy">
              <div class="orders-review-product-top">
                <div class="orders-review-product-meta">
                  <h4>${escapeHtml(item.name || 'Product')}</h4>
                  <p>${escapeHtml(formatVariantDetailsText(item))}</p>
                  <strong class="orders-review-unit-price">${formatCurrency(item.price || 0)} each</strong>
                </div>
              </div>
              <div class="orders-review-product-bottom">
                <div class="orders-qty-control">
                  <button type="button" data-action="decrease" aria-label="Decrease quantity">-</button>
                  <input type="number" min="1" value="${Number(item.qty || 1)}" aria-label="Quantity for ${escapeHtml(item.name || 'Product')}">
                  <button type="button" data-action="increase" aria-label="Increase quantity">+</button>
                </div>
                <div class="orders-review-price-stack">
                  <span>Line total</span>
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

function renderPriceBreakdown(state) {
  return `
    <section class="orders-review-card orders-review-card--totals">
      <div class="orders-total-row"><span>Subtotal</span><strong>${formatCurrency(state.totals.subtotal)}</strong></div>
      <div class="orders-total-row"><span>Delivery fee</span><strong>${formatCurrency(state.totals.shippingFee)}</strong></div>
      <div class="orders-total-row is-total"><span>Total</span><strong>${formatCurrency(state.totals.total)}</strong></div>
    </section>
  `;
}

function handleContinueToPayment() {
  const shippingValidation = validateShippingStage();
  if (!shippingValidation.valid) {
    setMessage(shippingValidation.message || 'Shipping data is incomplete.');
    window.location.assign('shipping.html');
    return;
  }

  setMessage('');
  setStage('payment');
  window.location.assign(getStageUrl('payment'));
}

function renderSidebar(state) {
  const shippingValid = validateShippingStage().valid;
  const isDisabled = !state.products.length || !shippingValid;
  const itemCount = state.products.reduce((sum, item) => sum + Number(item.qty || 0), 0);

  ui.sidebar.innerHTML = `
    <section class="orders-sidebar-card orders-sidebar-card--sticky orders-order-summary-card">
      <span class="orders-sidebar-label">Order summary</span>
      <div class="orders-sidebar-heading">
        <h3>${itemCount} item${itemCount === 1 ? '' : 's'}</h3>
        <span>${escapeHtml(getResolvedCustomerName())}</span>
      </div>
      <div class="orders-summary-product-list orders-summary-product-list--compact">
        ${renderSummaryProducts(state.products)}
      </div>
      <div class="orders-total-row"><span>Subtotal</span><strong>${formatCurrency(state.totals.subtotal)}</strong></div>
      <div class="orders-total-row"><span>Delivery fee</span><strong>${formatCurrency(state.totals.shippingFee)}</strong></div>
      <div class="orders-total-row is-total"><span>Total</span><strong>${formatCurrency(state.totals.total)}</strong></div>
      <button type="button" class="orders-next-button" id="continuePaymentButton" ${isDisabled ? 'disabled' : ''}>Continue to Payment</button>
    </section>
  `;

  ui.sidebar.querySelector('#continuePaymentButton')?.addEventListener('click', handleContinueToPayment);

  mountStickyCheckoutBar(ui.stickyBar, {
    total: state.totals.total,
    label: 'Order total',
    buttonText: 'Continue',
    disabled: isDisabled,
    onAction: handleContinueToPayment
  });
}

function renderContent(state) {
  ui.content.innerHTML = `
    <div class="orders-step-stack orders-step-stack--review">
      ${renderShippingSummary(state)}
      ${renderProductList(state)}
      ${renderPriceBreakdown(state)}
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
}

function render(state) {
  if (!state.products.length) {
    window.location.assign('../cart.html');
    return;
  }

  renderStageProgress(ui.progress, 'checkout');
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
