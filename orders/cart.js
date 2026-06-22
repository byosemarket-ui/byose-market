import { escapeHtml, formatCurrency, formatVariantDetailsText } from './utils.js';
import { validateCartStep } from './state.js';

export const cartStep = {
  id: 'cart',
  title: 'Review cart',
  description: 'Confirm the products, quantities, and variants before capturing delivery details.',
  nextLabel: 'Continue to shipping',
  render(container, context) {
    const { state, actions } = context;

    if (!state.products.length) {
      container.innerHTML = `
        <div class="orders-empty-state">
          <h3>Your cart is empty</h3>
          <p>Add products from the shop, then return here to complete the order.</p>
          <a class="orders-link-button" href="../shop.html">Go to shop</a>
        </div>
      `;
      return;
    }

    const itemCount = state.products.reduce((sum, item) => sum + item.qty, 0);
    container.innerHTML = `
      <div class="orders-step-stack">
        <div class="orders-step-intro">
          <span>${itemCount} item${itemCount === 1 ? '' : 's'} ready for checkout</span>
          <p>Changes here update the live cart so the storefront and checkout stay in sync.</p>
        </div>
        <div class="orders-cart-list">
          ${state.products.map((item) => `
            <article class="orders-cart-item" data-product-id="${escapeHtml(item.id)}" data-variant-key="${escapeHtml(item.variantKey || '')}">
              <img src="${escapeHtml(item.colorImage || item.image || item.img || '')}" alt="${escapeHtml(item.name)}">
              <div class="orders-cart-copy">
                <div class="orders-cart-topline">
                  <div>
                    <h3>${escapeHtml(item.name)}</h3>
                    <p>${escapeHtml(formatVariantDetailsText(item))}</p>
                  </div>
                  <strong>${formatCurrency(item.price)}</strong>
                </div>
                <div class="orders-cart-bottomline">
                  <div class="orders-qty-control">
                    <button type="button" data-action="decrease">-</button>
                    <input type="number" min="1" value="${item.qty}" aria-label="Quantity for ${escapeHtml(item.name)}">
                    <button type="button" data-action="increase">+</button>
                  </div>
                  <div class="orders-cart-actions">
                    <strong>${formatCurrency(item.total || (item.price * item.qty))}</strong>
                    <button type="button" class="orders-text-button" data-action="remove">Remove</button>
                  </div>
                </div>
              </div>
            </article>
          `).join('')}
        </div>
      </div>
    `;

    container.querySelectorAll('.orders-cart-item').forEach((row) => {
      const productId = row.getAttribute('data-product-id') || '';
      const variantKey = row.getAttribute('data-variant-key') || '';
      const input = row.querySelector('input');
      const readQuantity = () => Math.max(1, Number(input?.value || 1) || 1);

      row.querySelector('[data-action="decrease"]')?.addEventListener('click', () => {
        actions.updateProductQuantity(productId, variantKey, readQuantity() - 1);
      });

      row.querySelector('[data-action="increase"]')?.addEventListener('click', () => {
        actions.updateProductQuantity(productId, variantKey, readQuantity() + 1);
      });

      input?.addEventListener('change', () => {
        actions.updateProductQuantity(productId, variantKey, readQuantity());
      });

      row.querySelector('[data-action="remove"]')?.addEventListener('click', () => {
        actions.removeProduct(productId, variantKey);
      });
    });
  },
  validate() {
    return validateCartStep();
  }
};
