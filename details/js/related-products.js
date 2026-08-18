import ProductCardSystem from '../../js/product-card-system.js';
import { buildDiscountedProductView } from '../../js/storefront-discount.js';

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
  const cardsHtml = products
    .filter((product) => String(product?.id || product?.catalogId || '').trim())
    .map((product) => buildCard(product))
    .join('');

  if (!cardsHtml.trim()) {
    container.innerHTML = `
      <div class="byose-product-grid-empty">
        <div class="byose-product-grid-empty-icon">📭</div>
        <p class="byose-product-grid-empty-text">No related products available right now.</p>
      </div>
    `;
    return;
  }

  container.classList.add('related-products-host');
  container.innerHTML = `<div class="byose-product-grid byose-product-grid--5col related-grid related-products-grid">${cardsHtml}</div>`;
  ProductCardSystem.bindCards(container);
}
