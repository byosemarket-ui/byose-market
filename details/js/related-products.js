import { createProductUrl, formatPrice } from './product-data-loader.js';
import ProductCardSystem from '../../js/product-card-system.js';
import { buildDiscountedProductView } from '../../js/storefront-discount.js';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createCategoryLabel(category) {
  return String(category || 'featured').replace(/(^\w|\s\w)/g, match => match.toUpperCase());
}

function buildCard(product) {
  const normalized = buildDiscountedProductView(product);
  return ProductCardSystem.renderCard(normalized);
}

export function renderRelatedProducts(container, products) {
  if (!container) {
    return;
  }

  if (!Array.isArray(products) || !products.length) {
    container.innerHTML = `
      <div class="byose-product-grid-empty">
        <div class="byose-product-grid-empty-icon">📭</div>
        <p class="byose-product-grid-empty-text">No related products available right now.</p>
      </div>
    `;
    return;
  }

  // Wrap with unified grid classes (5 columns on desktop per related products convention)
  const cardsHtml = products.map(buildCard).join('');
  container.innerHTML = `<div class="byose-product-grid byose-product-grid--5col related-grid">${cardsHtml}</div>`;
  ProductCardSystem.bindCards(container);
}
