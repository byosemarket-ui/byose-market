import { getConfirmation, initCheckout } from './core/state.js';
import { renderProductList, renderTotals } from './ui/layout.js';
import { escapeHtml, formatCurrency } from './utils.js';

const container = document.getElementById('successContent');
const params = new URLSearchParams(window.location.search);
const orderId = params.get('orderId') || '';

await initCheckout('success');

const confirmation = getConfirmation();
const resolvedId = orderId || confirmation?.orderId || '';

if (!confirmation && !resolvedId) {
  container.innerHTML = `
    <div class="ck-success-icon">!</div>
    <h1>Order Not Found</h1>
    <p>We could not find your order confirmation. If you just placed an order, check your phone for updates.</p>
    <div class="ck-success-actions">
      <a class="ck-btn ck-btn--primary" href="../index.html">Continue Shopping</a>
    </div>
  `;
} else {
  const items = confirmation?.items || [];
  const totals = {
    subtotal: items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 1), 0),
    deliveryFee: 0,
    codFee: 0,
    total: confirmation?.total || 0
  };

  const paymentLabel = confirmation?.payment?.method === 'cod'
    ? 'Cash on Delivery'
    : (confirmation?.payment?.method || 'Mobile Money').toUpperCase();

  container.innerHTML = `
    <div class="ck-success-icon">✓</div>
    <h1>Order Placed!</h1>
    <p>Thank you, ${escapeHtml(confirmation?.customerName || 'customer')}. Your order has been received.</p>
    <p><strong>Order ID:</strong> ${escapeHtml(resolvedId)}</p>
    <div class="ck-success-details">
      <h3>Order Summary</h3>
      ${renderProductList(items)}
      <p style="margin-top:12px"><strong>Total:</strong> ${formatCurrency(confirmation?.total || totals.total)}</p>
      <p><strong>Payment:</strong> ${escapeHtml(paymentLabel)}</p>
      ${confirmation?.shippingAddress ? `
        <h3 style="margin-top:16px">Delivery To</h3>
        <p>${escapeHtml(confirmation.shippingAddress.fullName || '')}<br>
        ${escapeHtml(confirmation.shippingAddress.phone || '')}<br>
        ${escapeHtml([confirmation.shippingAddress.provinceCity, confirmation.shippingAddress.district, confirmation.shippingAddress.sector].filter(Boolean).join(', '))}</p>
      ` : ''}
      ${confirmation?.gpsLocation?.latitude ? `<p class="ck-gps">GPS: ${escapeHtml(confirmation.gpsLocation.latitude)}, ${escapeHtml(confirmation.gpsLocation.longitude)}</p>` : ''}
    </div>
    <div class="ck-success-actions">
      <a class="ck-btn ck-btn--primary" href="../index.html">Continue Shopping</a>
      <a class="ck-btn ck-btn--ghost" href="../account/account.html">My Account</a>
    </div>
  `;
}
