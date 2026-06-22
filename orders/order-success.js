import { escapeHtml, formatCurrency, formatVariantDetailsText } from './utils.js';
import { getConfirmationState } from './state.js';

const SUPPORT_PHONE = '+250780430710';
const SUPPORT_WHATSAPP = '250780430710';

function getPaymentLabel(confirmation) {
  if (confirmation?.paymentType === 'cod' || String(confirmation?.paymentMethod || '').toLowerCase() === 'cod') {
    return 'Pay on Delivery';
  }

  if (confirmation?.paymentMethod === 'mtn') {
    return 'MTN Mobile Money';
  }

  if (confirmation?.paymentMethod === 'airtel') {
    return 'Airtel Money';
  }

  if (confirmation?.paymentMethod === 'bank') {
    return 'Bank Transfer';
  }

  if (confirmation?.paymentMethod === 'card') {
    return 'Visa / Mastercard';
  }

  return 'Payment pending';
}

function getPaymentNote(confirmation) {
  if (confirmation?.paymentType === 'cod' || String(confirmation?.paymentMethod || '').toLowerCase() === 'cod') {
    return {
      title: 'Cash on delivery',
      lines: [
        'You will pay when your order is delivered.',
        'Uzishyura ari uko igicuruzwa kikugezeho.'
      ]
    };
  }

  return {
    title: getPaymentLabel(confirmation),
    lines: [
      'Your order is saved with the selected payment method and is awaiting processing.',
      'Order details are already visible in the admin system.'
    ]
  };
}

function buildSupportMessage(confirmation) {
  return [
    `Muraho Byose Market, ndifuza ubufasha kuri order ${confirmation.orderId || ''}.`,
    `Hello Byose Market, I need help with order ${confirmation.orderId || ''}.`
  ].join(' ');
}

function renderProducts(products) {
  return (products || []).map((item) => `
    <article class="orders-success-product-card">
      <img src="${escapeHtml(item.colorImage || item.image || item.img || '')}" alt="${escapeHtml(item.name || 'Product')}">
      <div class="orders-success-product-copy">
        <div class="orders-success-product-head">
          <h3>${escapeHtml(item.name || 'Product')}</h3>
          <strong>${formatCurrency(item.total || ((Number(item.qty || 0) || 0) * (Number(item.price || 0) || 0)))}</strong>
        </div>
        <p>${escapeHtml(formatVariantDetailsText(item))}</p>
        <div class="orders-success-product-meta">
          <span>Qty: ${Number(item.qty || 0)}</span>
          <span>${formatCurrency(item.price || 0)} each</span>
        </div>
      </div>
    </article>
  `).join('');
}

function renderAddress(address) {
  const addressLine = [
    address?.provinceCity || address?.city,
    address?.district,
    address?.sector,
    address?.cell,
    address?.village,
    address?.street,
    address?.note
  ].filter(Boolean).join(', ');

  return `
    <div class="orders-success-info-list">
      <div class="orders-success-info-row">
        <span>Full name</span>
        <strong>${escapeHtml([address?.firstName, address?.lastName].filter(Boolean).join(' ') || address?.fullName || 'Customer')}</strong>
      </div>
      <div class="orders-success-info-row">
        <span>Phone number</span>
        <strong>${escapeHtml(address?.phone || '')}</strong>
      </div>
      <div class="orders-success-info-row">
        <span>Full address</span>
        <strong>${escapeHtml(addressLine || 'Address not available')}</strong>
      </div>
      <div class="orders-success-info-row">
        <span>Google Maps</span>
        ${address?.mapLink
          ? `<a class="orders-map-link" href="${escapeHtml(address.mapLink)}" target="_blank" rel="noreferrer noopener">Open live location</a>`
          : '<strong>Not provided</strong>'}
      </div>
    </div>
  `;
}

function renderSummary(confirmation) {
  return `
    <div class="orders-success-metrics">
      <div class="orders-success-metric-card">
        <span>Order ID</span>
        <strong>${escapeHtml(confirmation.orderId || '')}</strong>
      </div>
      <div class="orders-success-metric-card">
        <span>Payment Method</span>
        <strong>${escapeHtml(getPaymentLabel(confirmation))}</strong>
      </div>
      <div class="orders-success-metric-card">
        <span>Total Amount</span>
        <strong>${formatCurrency(confirmation.total || 0)}</strong>
      </div>
      <div class="orders-success-metric-card">
        <span>Status</span>
        <strong>${escapeHtml(confirmation.status || 'Pending')}</strong>
      </div>
    </div>
  `;
}

function renderSuccess(confirmation) {
  const supportMessage = encodeURIComponent(buildSupportMessage(confirmation));
  const paymentNote = getPaymentNote(confirmation);

  return `
    <div class="orders-success-page">
      <section class="orders-success-hero">
        <div class="orders-success-check" aria-hidden="true">
          <svg viewBox="0 0 80 80" fill="none">
            <circle cx="40" cy="40" r="36"></circle>
            <path d="M24 41.5L34.5 52L57 29.5"></path>
          </svg>
        </div>
        <div class="orders-success-copy">
          <span class="orders-sidebar-label">Order Success</span>
          <h1>Order Placed Successfully</h1>
          <p>Your order has been received and is being processed.</p>
        </div>
      </section>

      <section class="orders-success-section orders-success-section--summary">
        <div class="orders-success-section-head">
          <div>
            <span class="orders-sidebar-label">Order summary</span>
            <h2>Everything is saved</h2>
          </div>
        </div>
        ${renderSummary(confirmation)}
      </section>

      <div class="orders-success-grid">
        <section class="orders-success-section">
          <div class="orders-success-section-head">
            <div>
              <span class="orders-sidebar-label">Delivery information</span>
              <h2>Where the order is going</h2>
            </div>
          </div>
          ${renderAddress(confirmation.shippingAddress || {})}
        </section>

        <section class="orders-success-section">
          <div class="orders-success-section-head">
            <div>
              <span class="orders-sidebar-label">Payment</span>
              <h2>${escapeHtml(paymentNote.title)}</h2>
            </div>
          </div>
          <div class="orders-success-payment-note">
            ${paymentNote.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
          </div>
        </section>
      </div>

      <section class="orders-success-section">
        <div class="orders-success-section-head">
          <div>
            <span class="orders-sidebar-label">Products</span>
            <h2>Items in this order</h2>
          </div>
        </div>
        <div class="orders-success-product-list">
          ${renderProducts(confirmation.products || [])}
        </div>
      </section>

      <section class="orders-success-section orders-success-section--support">
        <div class="orders-success-section-head">
          <div>
            <span class="orders-sidebar-label">Support</span>
            <h2>Need help? Contact us anytime.</h2>
          </div>
        </div>
        <div class="orders-success-support-actions">
          <a class="orders-success-support-button is-whatsapp" href="https://wa.me/${SUPPORT_WHATSAPP}?text=${supportMessage}" target="_blank" rel="noreferrer noopener">WhatsApp</a>
          <a class="orders-success-support-button is-call" href="tel:${SUPPORT_PHONE}">Call</a>
        </div>
      </section>

      <div class="orders-success-actions">
        <a class="orders-link-button" href="../index.html">Back to Home</a>
        <button type="button" class="orders-success-track-button" disabled aria-disabled="true">Track Order <span>Soon</span></button>
      </div>
    </div>
  `;
}

function renderEmptyState() {
  return `
    <div class="orders-success-page orders-success-page--empty">
      <section class="orders-success-section">
        <div class="orders-success-copy">
          <span class="orders-sidebar-label">Order Success</span>
          <h1>No order found</h1>
          <p>The success summary could not be loaded. Return to checkout and try again.</p>
        </div>
        <div class="orders-success-actions">
          <a class="orders-link-button" href="shipping.html">Back to checkout</a>
          <a class="orders-success-support-button is-call" href="../index.html">Back to Home</a>
        </div>
      </section>
    </div>
  `;
}

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('orderId');
  const confirmation = getConfirmationState(orderId);
  const root = document.getElementById('orderSuccessContent');

  if (!root) {
    return;
  }

  if (!confirmation) {
    root.innerHTML = renderEmptyState();
    return;
  }

  document.title = `Order ${confirmation.orderId} | Byose Market`;
  root.innerHTML = renderSuccess(confirmation);
});