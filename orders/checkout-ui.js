import { escapeHtml, formatCurrency, formatVariantDetailsText } from './utils.js';
import { ORDER_STEPS } from './checkout-foundation.js';

export function renderStageProgress(container, activeStage, steps = ORDER_STEPS) {
  if (!container) {
    return;
  }

  const activeIndex = steps.findIndex((step) => step.id === activeStage);
  container.innerHTML = steps.map((step, index) => {
    const tone = index < activeIndex ? 'is-complete' : index === activeIndex ? 'is-active' : '';
    return `
      <button type="button" class="orders-progress-step ${tone}" disabled>
        <span>${index + 1}</span>
        <strong>${escapeHtml(step.label)}</strong>
      </button>
    `;
  }).join('');
}

export function renderSummaryProducts(products = []) {
  return (Array.isArray(products) ? products : []).map((item) => `
    <article class="orders-summary-product">
      <img src="${escapeHtml(item.colorImage || item.image || item.img || '')}" alt="${escapeHtml(item.name || 'Product')}">
      <div>
        <strong>${escapeHtml(item.name || 'Product')}</strong>
        <p>${escapeHtml(formatVariantDetailsText(item))}</p>
        <span>Qty ${Number(item.qty || 0)} x ${formatCurrency(item.price || 0)}</span>
      </div>
      <strong>${formatCurrency(item.total || ((Number(item.qty || 0) || 0) * (Number(item.price || 0) || 0)))}</strong>
    </article>
  `).join('');
}
