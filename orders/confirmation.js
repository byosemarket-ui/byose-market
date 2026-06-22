import { escapeHtml, formatCurrency, formatVariantDetailsText } from './utils.js';
import { getConfirmationState } from './state.js';

function renderProducts(products) {
  return (products || []).map((item) => `
    <div class="orders-summary-product">
      <img src="${escapeHtml(item.colorImage || item.image || item.img || '')}" alt="${escapeHtml(item.name || 'Product')}">
      <div>
        <strong>${escapeHtml(item.name || 'Product')}</strong>
        <p>${escapeHtml(formatVariantDetailsText(item))}</p>
        <span>${Number(item.qty || 0)} x ${formatCurrency(item.price || 0)}</span>
      </div>
      <strong>${formatCurrency(item.total || ((Number(item.qty || 0) || 0) * (Number(item.price || 0) || 0)))}</strong>
    </div>
  `).join('');
}

function renderAddress(address) {
  const rows = [
    ['Recipient', [address?.firstName, address?.lastName].filter(Boolean).join(' ') || address?.fullName],
    ['Phone', address?.phone],
    ['Province / City', address?.provinceCity || address?.city],
    ['District', address?.district],
    ['Sector', address?.sector],
    ['Cell', address?.cell],
    ['Village', address?.village],
    ['Street / Landmark', address?.street],
    ['Note', address?.note],
    ['GPS', address?.latitude && address?.longitude ? `${address.latitude}, ${address.longitude}` : ''],
    ['Google Maps', address?.mapLink ? `<a class="orders-map-link" href="${escapeHtml(address.mapLink)}" target="_blank" rel="noreferrer noopener">Open live location</a>` : '']
  ].filter(([, value]) => Boolean(value));

  return rows.map(([label, value]) => `
    <p><strong>${escapeHtml(label)}:</strong> ${label === 'Google Maps' ? value : escapeHtml(value)}</p>
  `).join('');
}

function renderConfirmation(confirmation) {
  return `
    <div class="orders-confirmation">
      <div class="orders-confirmation-badge">Order sent to admin</div>
      <h2>Order placed successfully</h2>
      <p>${escapeHtml(confirmation.customerName || 'Customer')} order is saved and visible to the admin orders system.</p>
      <div class="orders-confirmation-grid">
        <div>
          <span>Order ID</span>
          <strong>${escapeHtml(confirmation.orderId || '')}</strong>
        </div>
        <div>
          <span>Total</span>
          <strong>${formatCurrency(confirmation.total || 0)}</strong>
        </div>
        <div>
          <span>Status</span>
          <strong>${escapeHtml(confirmation.status || 'Pending')}</strong>
        </div>
        <div>
          <span>Placed at</span>
          <strong>${escapeHtml(new Date(confirmation.placedAt || Date.now()).toLocaleString())}</strong>
        </div>
      </div>
      <div class="orders-step-stack">
        <section class="orders-review-card">
          <h3>Delivery info</h3>
          ${renderAddress(confirmation.shippingAddress || {})}
          <p><strong>Method:</strong> ${escapeHtml(confirmation.deliveryLabel || 'Delivery')}</p>
          <p><strong>Payment:</strong> ${escapeHtml(confirmation.paymentLabel || 'Payment pending')}</p>
        </section>
        <section class="orders-review-card">
          <h3>Order summary</h3>
          <div class="orders-summary-product-list">
            ${renderProducts(confirmation.products)}
          </div>
          <div class="orders-step-stack">
            <div class="orders-total-row"><span>Subtotal</span><strong>${formatCurrency(confirmation.subtotal || 0)}</strong></div>
            <div class="orders-total-row"><span>Shipping</span><strong>${formatCurrency(confirmation.shippingFee || 0)}</strong></div>
            ${(confirmation.codFee || 0) > 0 ? `<div class="orders-total-row"><span>COD fee</span><strong>${formatCurrency(confirmation.codFee || 0)}</strong></div>` : ''}
            <div class="orders-total-row is-total"><span>Total</span><strong>${formatCurrency(confirmation.total || 0)}</strong></div>
          </div>
        </section>
      </div>
      <div class="orders-confirmation-actions">
        <a class="orders-link-button" href="../index.html">Go Home</a>
        <a class="orders-secondary-link" href="../admin/orders/index.html">View Orders</a>
      </div>
    </div>
  `;
}

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('orderId');
  const confirmation = getConfirmationState(orderId);
  const root = document.getElementById('confirmationContent');

  if (!root) {
    return;
  }

  if (!confirmation) {
    root.innerHTML = `
      <div class="orders-confirmation">
        <h2>No confirmation found</h2>
        <p>The order summary could not be loaded. Return to checkout and try again.</p>
        <div class="orders-confirmation-actions">
          <a class="orders-link-button" href="shipping.html">Back to checkout</a>
          <a class="orders-secondary-link" href="../index.html">Go Home</a>
        </div>
      </div>
    `;
    return;
  }

  document.title = `Order ${confirmation.orderId} | Byose Market`;
  root.innerHTML = renderConfirmation(confirmation);
});
