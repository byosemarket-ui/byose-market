import { escapeHtml, formatCurrency, resolveCheckoutAsset, resolveOrderItemImage } from '../utils.js';
import { CHECKOUT_PROGRESS_STEPS, DELIVERY_FEE } from '../core/constants.js';
import { getState } from '../core/state.js';

export function renderProgress(currentStepId) {
  const currentIndex = CHECKOUT_PROGRESS_STEPS.findIndex((step) => step.id === currentStepId);
  return CHECKOUT_PROGRESS_STEPS.map((step, index) => {
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

function productIdentityLine(product) {
  const productId = String(product.productId || product.id || '').trim();
  const sku = String(product.variantSku || product.sku || '').trim();
  const variantKey = String(product.variantKey || product.colorId || '').trim();
  const parts = [];
  if (productId) parts.push(`ID ${productId}`);
  if (sku) parts.push(`SKU ${sku}`);
  else if (variantKey) parts.push(variantKey);
  return parts.join(' · ');
}

export function renderProductLine(product) {
  const img = resolveProductImageSrc(product);
  const meta = [product.colorName || product.color, product.sizeLabel || product.size].filter(Boolean).join(' · ');
  const identity = productIdentityLine(product);
  const qty = Math.max(1, Number(product.qty || product.quantity) || 1);
  const price = Number(product.price) || 0;
  const name = product.name || product.productName || 'Product';

  return `
    <article class="ck-product">
      <div class="ck-product-img">${img ? `<img src="${escapeHtml(img)}" alt="">` : '<span class="ck-product-ph" aria-hidden="true"></span>'}</div>
      <div class="ck-product-body">
        <h3>${escapeHtml(name)}</h3>
        ${meta ? `<p class="ck-product-meta">${escapeHtml(meta)}</p>` : ''}
        ${identity ? `<p class="ck-product-ids">${escapeHtml(identity)}</p>` : ''}
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
    const identity = productIdentityLine(product);
    const name = product.name || product.productName || 'Product';

    return `
      <article class="ck-product ck-product--edit" data-product-key="${escapeHtml(key)}">
        <div class="ck-product-img">${img ? `<img src="${escapeHtml(img)}" alt="">` : '<span class="ck-product-ph" aria-hidden="true"></span>'}</div>
        <div class="ck-product-body">
          <h3>${escapeHtml(name)}</h3>
          ${meta ? `<p class="ck-product-meta">${escapeHtml(meta)}</p>` : ''}
          ${identity ? `<p class="ck-product-ids">${escapeHtml(identity)}</p>` : ''}
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
  const fee = Number(getState().totals?.deliveryFee);
  const amount = Number.isFinite(fee) ? fee : DELIVERY_FEE;
  return `
    <section class="ck-delivery-info" aria-label="Delivery">
      <span class="ck-delivery-info__icon" aria-hidden="true">🚚</span>
      <div class="ck-delivery-info__body">
        <strong>Delivery</strong>
        <p>Delivered to your address · ${formatCurrency(amount)}</p>
      </div>
    </section>
  `;
}

export function renderPaymentMethods(methods, selectedId) {
  if (!Array.isArray(methods) || !methods.length) {
    return '<p class="ck-empty">No payment methods available right now. Please try again shortly.</p>';
  }

  return methods.map((method) => {
    const checked = method.id === selectedId;
    const logo = resolveCheckoutAsset(method.logo);
    const selectedClass = checked ? ' is-selected' : '';

    return `
      <label class="ck-pay-card${selectedClass}">
        <input
          type="radio"
          class="ck-pay-card__input"
          name="paymentMethod"
          value="${escapeHtml(method.id)}"
          ${checked ? 'checked' : ''}
          aria-describedby="pay-hint-${escapeHtml(method.id)}"
        >
        <span class="ck-pay-card__logo">
          <img src="${escapeHtml(logo)}" alt="" width="40" height="40" loading="lazy" decoding="async">
        </span>
        <span class="ck-pay-card__body">
          <span class="ck-pay-card__name">${escapeHtml(method.label)}</span>
          ${method.subtitle ? `<span class="ck-pay-card__subtitle">${escapeHtml(method.subtitle)}</span>` : ''}
          ${method.hint ? `<span class="ck-pay-card__hint" id="pay-hint-${escapeHtml(method.id)}">${escapeHtml(method.hint)}</span>` : ''}
        </span>
        <span class="ck-pay-card__radio" aria-hidden="true"></span>
      </label>
    `;
  }).join('');
}

export function renderTotals(totals) {
  const discount = Number(totals.discount) || 0;
  const couponDiscount = Number(totals.couponDiscount) || 0;
  const tax = Number(totals.tax) || 0;
  return `
    <dl class="ck-totals">
      <div><dt>Subtotal</dt><dd>${formatCurrency(totals.subtotal)}</dd></div>
      ${discount > 0 ? `<div><dt>Product savings</dt><dd>−${formatCurrency(discount)}</dd></div>` : ''}
      ${couponDiscount > 0 ? `<div><dt>Coupon${totals.couponCode ? ` (${escapeHtml(totals.couponCode)})` : ''}</dt><dd>−${formatCurrency(couponDiscount)}</dd></div>` : ''}
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
  const hideAction = Boolean(options.hideAction);
  const actions = Array.isArray(options.actions) ? options.actions : [];
  const actionHtml = actions.length
    ? `<div class="ck-sticky-actions">${actions.map((action) => {
        const className = escapeHtml(action.className || 'ck-btn ck-btn--primary');
        return `<button type="button" class="${className}" id="${escapeHtml(action.id)}" ${disabled ? 'disabled' : ''}>${escapeHtml(action.label)}</button>`;
      }).join('')}</div>`
    : (hideAction
      ? ''
      : `<button type="button" class="ck-btn ck-btn--primary" id="stickyContinueBtn" ${disabled ? 'disabled' : ''}>${escapeHtml(label)}</button>`);
  const stickyClass = [
    'ck-sticky',
    hideAction && !actions.length ? 'ck-sticky--total-only' : '',
    actions.length ? 'ck-sticky--review-pay' : ''
  ].filter(Boolean).join(' ');
  return `
    <div class="${stickyClass}">
      <div class="ck-sticky-total">
        <span>Total</span>
        <strong>${formatCurrency(state.totals.total)}</strong>
      </div>
      ${actionHtml}
    </div>
  `;
}

export function renderCompactDeliverySummary(shipping) {
  const customer = String(shipping.fullName || '').trim();
  const phone = String(shipping.phone || '').trim();
  const place = [shipping.provinceCity, shipping.district].filter(Boolean).join(', ');
  const line = [customer, phone, place].filter(Boolean).join(' · ');
  if (!line) return '';
  return `
    <p class="ck-delivery-compact">Delivering to ${escapeHtml(line)}</p>
  `;
}

export function renderShippingSummary(shipping) {
  const customer = String(shipping.fullName || '').trim();
  const phone = String(shipping.phone || '').trim();
  const address = [
    shipping.provinceCity,
    shipping.district,
    shipping.sector,
    shipping.cell,
    shipping.village
  ].filter(Boolean).join(', ');
  const note = String(shipping.note || '').trim();
  const savedId = String(shipping.savedAddressId || '').trim();

  const mapLink = String(shipping.mapLink || shipping.googleMapsLink || '').trim()
    || (shipping.latitude && shipping.longitude
      ? `https://www.google.com/maps?q=${encodeURIComponent(`${shipping.latitude},${shipping.longitude}`)}`
      : '');

  return `
    <section class="ck-card">
      <h3>Delivery Address</h3>
      ${savedId ? '<p class="ck-saved-tag">Saved address selected for this order</p>' : ''}
      ${customer ? `<p><strong>Customer:</strong> ${escapeHtml(customer)}</p>` : ''}
      ${phone ? `<p><strong>Phone:</strong> ${escapeHtml(phone)}</p>` : ''}
      ${address ? `<p><strong>Address:</strong> ${escapeHtml(address)}</p>` : ''}
      ${note ? `<p><strong>Landmark / Note:</strong> ${escapeHtml(note)}</p>` : ''}
      ${shipping.latitude && shipping.longitude ? `<p class="ck-gps">GPS: ${escapeHtml(shipping.latitude)}, ${escapeHtml(shipping.longitude)}</p>` : ''}
      ${mapLink ? `<p class="ck-gps"><a class="ck-map-link" href="${escapeHtml(mapLink)}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a></p>` : ''}
      <p class="ck-address-change"><a href="shipping.html?change=1">Change Address</a></p>
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
