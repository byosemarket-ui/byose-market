import { escapeHtml, formatCurrency, formatVariantDetailsText } from './utils.js';

function renderProducts(products) {
  return products.map((item) => `
    <div class="orders-summary-product">
      <img src="${escapeHtml(item.colorImage || item.image || item.img || '')}" alt="${escapeHtml(item.name)}">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <p>${escapeHtml(formatVariantDetailsText(item))}</p>
        <span>${item.qty} x ${formatCurrency(item.price)}</span>
      </div>
      <strong>${formatCurrency(item.total || (item.price * item.qty))}</strong>
    </div>
  `).join('');
}

export const summaryStep = {
  id: 'summary',
  title: 'Order summary',
  description: 'Review the final order payload before it is written to the admin order store.',
  nextLabel: 'Confirm order',
  render(container, context) {
    const { state } = context;
    const paymentLabel = state.payment.paymentType === 'cod'
      ? 'Cash on delivery'
      : (state.payment.method === 'mtn' ? 'MTN Mobile Money' : state.payment.method === 'airtel' ? 'Airtel Money' : 'Not selected');

    container.innerHTML = `
      <div class="orders-step-stack">
        <section class="orders-review-card">
          <h3>Shipping</h3>
          <p>${escapeHtml([state.shippingAddress.firstName, state.shippingAddress.lastName].filter(Boolean).join(' '))}</p>
          <p>${escapeHtml(state.shippingAddress.phone)}</p>
          <p>${escapeHtml([
            state.shippingAddress.city,
            state.shippingAddress.district,
            state.shippingAddress.sector,
            state.shippingAddress.cell,
            state.shippingAddress.village,
            state.shippingAddress.street
          ].filter(Boolean).join(', '))}</p>
        </section>
        <section class="orders-review-card">
          <h3>Delivery and payment</h3>
          <div class="orders-review-grid">
            <div>
              <span>Delivery</span>
              <strong>${escapeHtml(state.delivery.label)}</strong>
            </div>
            <div>
              <span>Payment</span>
              <strong>${escapeHtml(paymentLabel)}</strong>
            </div>
            <div>
              <span>Payer phone</span>
              <strong>${escapeHtml(state.payment.payerPhone || state.shippingAddress.phone || 'Not required')}</strong>
            </div>
            <div>
              <span>Status after checkout</span>
              <strong>${state.payment.paymentType === 'cod' ? 'Pending Delivery (COD)' : 'Pending Payment Verification'}</strong>
            </div>
          </div>
        </section>
        <section class="orders-review-card">
          <h3>Products</h3>
          <div class="orders-summary-product-list">
            ${renderProducts(state.products)}
          </div>
        </section>
      </div>
    `;
  },
  validate() {
    return { valid: true };
  }
};
