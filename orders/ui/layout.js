import { escapeHtml, formatCurrency, resolveCheckoutAsset, resolveOrderItemImage } from '../utils.js';
import { DELIVERY_FEE, STEPS } from '../core/constants.js';
import { getState, getStepIndex } from '../core/state.js';

export function renderProgress(currentStepId) {
  const currentIndex = getStepIndex(currentStepId);
  return STEPS.slice(0, 3).map((step, index) => {
    const cls = index < currentIndex ? 'ck-step is-done' : index === currentIndex ? 'ck-step is-active' : 'ck-step';
    return `<div class="${cls}"><span class="ck-step-num">${index + 1}</span><strong>${escapeHtml(step.label)}</strong></div>`;
  }).join('');
}

function resolveProductImageSrc(product) {
  const preferred = String(product?.colorImage || '').trim();
  if (preferred) {
    return resolveCheckoutAsset(preferred);
  }
  return resolveCheckoutAsset(resolveOrderItemImage(product));
}

export function renderProductLine(product) {
  const img = resolveProductImageSrc(product);
  const meta = [product.colorName || product.color, product.sizeLabel || product.size].filter(Boolean).join(' · ');
  const qty = Math.max(1, Number(product.qty || product.quantity) || 1);
  const price = Number(product.price) || 0;
  const name = product.name || product.productName || 'Product';

  return `
    <article class="ck-product">
      <div class="ck-product-img">${img ? `<img src="${escapeHtml(img)}" alt="">` : '<span class="ck-product-ph" aria-hidden="true"></span>'}</div>
      <div class="ck-product-body">
        <h3>${escapeHtml(name)}</h3>
        ${meta ? `<p class="ck-product-meta">${escapeHtml(meta)}</p>` : ''}
        <p class="ck-product-qty">Qty: ${qty} · ${formatCurrency(price)} each</p>
      </div>
      <div class="ck-product-price">${formatCurrency(price * qty)}</div>
    </article>
  `;
}

export function renderProductList(products, { editable = false } = {}) {
  if (!products.length) {
    return '<p class="ck-empty">No products in checkout.</p>';
  }

  return products.map((product) => {
    if (!editable) return renderProductLine(product);

    const key = `${product.id}::${product.variantKey || ''}`;
    const qty = Math.max(1, Number(product.qty || product.quantity) || 1);
    const img = resolveProductImageSrc(product);
    const meta = [product.colorName || product.color, product.sizeLabel || product.size].filter(Boolean).join(' · ');
    const name = product.name || product.productName || 'Product';

    return `
      <article class="ck-product ck-product--edit" data-product-key="${escapeHtml(key)}">
        <div class="ck-product-img">${img ? `<img src="${escapeHtml(img)}" alt="">` : '<span class="ck-product-ph" aria-hidden="true"></span>'}</div>
        <div class="ck-product-body">
          <h3>${escapeHtml(name)}</h3>
          ${meta ? `<p class="ck-product-meta">${escapeHtml(meta)}</p>` : ''}
          <p class="ck-product-unit">${formatCurrency((Number(product.price) || 0))} each</p>
          <div class="ck-qty-controls">
            <button type="button" class="ck-qty-btn" data-qty-action="dec" data-id="${escapeHtml(product.id)}" data-variant="${escapeHtml(product.variantKey || '')}">−</button>
            <span>${qty}</span>
            <button type="button" class="ck-qty-btn" data-qty-action="inc" data-id="${escapeHtml(product.id)}" data-variant="${escapeHtml(product.variantKey || '')}">+</button>
          </div>
        </div>
        <div class="ck-product-price">${formatCurrency((Number(product.price) || 0) * qty)}</div>
      </article>
    `;
  }).join('');
}

export function renderDeliveryInfo() {
  return `
    <section class="ck-delivery-info" aria-label="Delivery method">
      <span class="ck-delivery-info__icon" aria-hidden="true">🚚</span>
      <div class="ck-delivery-info__body">
        <strong>Delivery</strong>
        <p>Delivered to your address · ${formatCurrency(DELIVERY_FEE)}</p>
      </div>
    </section>
  `;
}

export function renderPaymentMethods(methods, selectedId) {
  if (!Array.isArray(methods) || !methods.length) {
    return '<p class="ck-empty">No payment methods available.</p>';
  }

  return methods.map((method) => {
    const checked = method.id === selectedId;
    const logo = resolveCheckoutAsset(method.logo);
    const codClass = method.id === 'cod' ? ' ck-pay-card--cod' : '';

    return `
      <label class="ck-pay-card${codClass}${checked ? ' is-selected' : ''}">
        <input
          type="radio"
          class="ck-pay-card__input"
          name="paymentMethod"
          value="${escapeHtml(method.id)}"
          ${checked ? 'checked' : ''}
        >
        <span class="ck-pay-card__logo">
          <img src="${escapeHtml(logo)}" alt="${escapeHtml(method.label)} logo" width="40" height="40" loading="lazy" decoding="async">
        </span>
        <span class="ck-pay-card__body">
          <span class="ck-pay-card__name">${escapeHtml(method.label)}</span>
          ${method.hint ? `<span class="ck-pay-card__hint${method.id === 'cod' ? ' ck-pay-card__hint--rw' : ''}">${escapeHtml(method.hint)}</span>` : ''}
        </span>
        <span class="ck-pay-card__radio" aria-hidden="true"></span>
      </label>
    `;
  }).join('');
}

export function renderTotals(totals) {
  const discount = Number(totals.discount) || 0;
  const tax = Number(totals.tax) || 0;
  return `
    <dl class="ck-totals">
      <div><dt>Subtotal</dt><dd>${formatCurrency(totals.subtotal)}</dd></div>
      ${discount > 0 ? `<div><dt>Discount</dt><dd>−${formatCurrency(discount)}</dd></div>` : ''}
      <div><dt>Delivery</dt><dd>${formatCurrency(totals.deliveryFee)}</dd></div>
      ${tax > 0 ? `<div><dt>Tax</dt><dd>${formatCurrency(tax)}</dd></div>` : ''}
      ${totals.codFee > 0 ? `<div><dt>COD fee</dt><dd>${formatCurrency(totals.codFee)}</dd></div>` : ''}
      <div class="ck-totals-total"><dt>Total</dt><dd>${formatCurrency(totals.total)}</dd></div>
    </dl>
  `;
}

export function renderSidebar(products, totals) {
  return `
    <div class="ck-sidebar-card">
      <h3>Order Summary</h3>
      <div class="ck-sidebar-products">${renderProductList(products)}</div>
      ${renderTotals(totals)}
    </div>
  `;
}

export function renderStickyBar(label, buttonId, options = {}) {
  const state = getState();
  const disabled = Boolean(options.disabled || state.isSubmitting);
  return `
    <div class="ck-sticky">
      <div class="ck-sticky-total">
        <span>Total</span>
        <strong>${formatCurrency(state.totals.total)}</strong>
      </div>
      <button type="button" class="ck-btn ck-btn--primary" id="stickyContinueBtn" ${disabled ? 'disabled' : ''}>${escapeHtml(label)}</button>
    </div>
  `;
}

export function renderPaymentInstructions(methodId, totals = {}) {
  const method = String(methodId || '').toLowerCase();
  if (!method || method === 'cod') {
    return `
      <div class="ck-pay-instructions ck-pay-instructions--cod">
        <strong>Cash on Delivery</strong>
        <p>Pay when your order arrives. Available in Kigali only.</p>
      </div>
    `;
  }

  const accounts = [
    { id: 'mtn', label: 'MTN Mobile Money', number: '0780430710', accountName: 'Vestine Uwifashije' },
    { id: 'airtel', label: 'Airtel Money', number: '0723137250', accountName: 'Kwizera Byose Market' },
    { id: 'bank', label: 'Bank Transfer', number: 'Contact support after placing the order', accountName: 'Byose Market' },
    { id: 'card', label: 'Card Payment', number: 'We will confirm card payment manually', accountName: 'Byose Market' }
  ];
  const account = accounts.find((entry) => entry.id === method) || accounts[0];
  const total = formatCurrency(totals.total || 0);

  return `
    <div class="ck-pay-instructions">
      <strong>Payment instructions</strong>
      <p>After placing your order, send <strong>${total}</strong> via ${escapeHtml(account.label)}.</p>
      <p><strong>Account:</strong> ${escapeHtml(account.accountName)}</p>
      <p><strong>Number:</strong> ${escapeHtml(account.number)}</p>
      <p>Use your order ID as the payment reference. Your order stays <em>Awaiting Payment</em> until we confirm.</p>
    </div>
  `;
}

export function renderShippingSummary(shipping) {
  const lines = [
    shipping.fullName,
    shipping.phone,
    [shipping.provinceCity, shipping.district].filter(Boolean).join(', '),
    [shipping.sector, shipping.cell, shipping.village].filter(Boolean).join(', '),
    shipping.note
  ].filter(Boolean);

  const mapLink = String(shipping.mapLink || shipping.googleMapsLink || '').trim()
    || (shipping.latitude && shipping.longitude
      ? `https://www.google.com/maps?q=${encodeURIComponent(`${shipping.latitude},${shipping.longitude}`)}`
      : '');

  return `
    <section class="ck-card">
      <h3>Delivery Address</h3>
      <p>${lines.map((l) => escapeHtml(l)).join('<br>')}</p>
      ${shipping.latitude && shipping.longitude ? `<p class="ck-gps">GPS: ${escapeHtml(shipping.latitude)}, ${escapeHtml(shipping.longitude)}</p>` : ''}
      ${mapLink ? `<p class="ck-gps"><a class="ck-map-link" href="${escapeHtml(mapLink)}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a></p>` : ''}
    </section>
  `;
}

export function showMessage(el, text, type = 'error') {
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.className = `ck-message ck-message--${type}`;
}
