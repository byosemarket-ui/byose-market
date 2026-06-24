import { escapeHtml, formatCurrency } from '../utils.js';
import { STEPS } from '../core/constants.js';
import { getState, getStepIndex } from '../core/state.js';

export function renderProgress(currentStepId) {
  const currentIndex = getStepIndex(currentStepId);
  return STEPS.slice(0, 3).map((step, index) => {
    const cls = index < currentIndex ? 'ck-step is-done' : index === currentIndex ? 'ck-step is-active' : 'ck-step';
    return `<div class="${cls}"><span class="ck-step-num">${index + 1}</span><strong>${escapeHtml(step.label)}</strong></div>`;
  }).join('');
}

export function renderProductLine(product) {
  const img = product.colorImage || product.image || product.productImage || '';
  const meta = [product.colorName || product.color, product.sizeLabel || product.size].filter(Boolean).join(' · ');
  const qty = Math.max(1, Number(product.qty || product.quantity) || 1);
  const price = Number(product.price) || 0;

  return `
    <article class="ck-product">
      <div class="ck-product-img">${img ? `<img src="${escapeHtml(img)}" alt="">` : '<span class="ck-product-ph">📦</span>'}</div>
      <div class="ck-product-body">
        <h3>${escapeHtml(product.name)}</h3>
        ${meta ? `<p class="ck-product-meta">${escapeHtml(meta)}</p>` : ''}
        <p class="ck-product-qty">Qty: ${qty}</p>
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
    const img = product.colorImage || product.image || '';
    const meta = [product.colorName || product.color, product.sizeLabel || product.size].filter(Boolean).join(' · ');

    return `
      <article class="ck-product ck-product--edit" data-product-key="${escapeHtml(key)}">
        <div class="ck-product-img">${img ? `<img src="${escapeHtml(img)}" alt="">` : '<span class="ck-product-ph">📦</span>'}</div>
        <div class="ck-product-body">
          <h3>${escapeHtml(product.name)}</h3>
          ${meta ? `<p class="ck-product-meta">${escapeHtml(meta)}</p>` : ''}
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

export function renderTotals(totals) {
  return `
    <dl class="ck-totals">
      <div><dt>Subtotal</dt><dd>${formatCurrency(totals.subtotal)}</dd></div>
      <div><dt>Delivery</dt><dd>${formatCurrency(totals.deliveryFee)}</dd></div>
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

export function renderStickyBar(label, buttonId) {
  const state = getState();
  return `
    <div class="ck-sticky">
      <div class="ck-sticky-total">
        <span>Total</span>
        <strong>${formatCurrency(state.totals.total)}</strong>
      </div>
      <button type="button" class="ck-btn ck-btn--primary" id="stickyContinueBtn">${escapeHtml(label)}</button>
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

  return `
    <section class="ck-card">
      <h3>Delivery Address</h3>
      <p>${lines.map((l) => escapeHtml(l)).join('<br>')}</p>
      ${shipping.latitude && shipping.longitude ? `<p class="ck-gps">GPS: ${escapeHtml(shipping.latitude)}, ${escapeHtml(shipping.longitude)}</p>` : ''}
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
