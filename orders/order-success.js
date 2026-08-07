import { getConfirmation, initCheckout } from './core/state.js';
import { DELIVERY_FEE } from './core/constants.js';
import { renderProductList, renderTotals } from './ui/layout.js';
import { escapeHtml } from './utils.js';

const container = document.getElementById('successContent');
const params = new URLSearchParams(window.location.search);
const orderId = params.get('orderId') || '';

await initCheckout('success');

const confirmation = getConfirmation();
const resolvedId = orderId || confirmation?.orderId || '';
const confirmationMatches = confirmation
  && (!orderId || String(confirmation.orderId || '') === String(orderId));

if (!confirmationMatches) {
  container.innerHTML = `
    <div class="ck-success-icon">!</div>
    <h1>${resolvedId ? 'Confirmation Unavailable' : 'Order Not Found'}</h1>
    <p>
      ${resolvedId
        ? `We could not load the local confirmation for order <strong>${escapeHtml(resolvedId)}</strong>. If you just placed an order, open My Account to view it.`
        : 'We could not find your order confirmation. If you just placed an order, check My Account or contact support.'}
    </p>
    <div class="ck-success-actions">
      <a class="ck-btn ck-btn--primary" href="../account/account.html">My Account</a>
      <a class="ck-btn ck-btn--ghost" href="../index.html">Continue Shopping</a>
    </div>
  `;
} else {
  const items = confirmation?.items || [];
  const subtotal = Number(confirmation?.subtotal)
    || items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity || i.qty) || 1), 0);
  const deliveryFee = Number(confirmation?.deliveryFee);
  const codFee = Number(confirmation?.codFee);
  const totals = {
    subtotal,
    deliveryFee: Number.isFinite(deliveryFee) ? deliveryFee : DELIVERY_FEE,
    codFee: Number.isFinite(codFee) ? codFee : 0,
    total: Number(confirmation?.total) || (subtotal + (Number.isFinite(deliveryFee) ? deliveryFee : DELIVERY_FEE) + (Number.isFinite(codFee) ? codFee : 0))
  };

  const isCod = confirmation?.payment?.method === 'cod' || confirmation?.paymentMethod === 'cod';
  const paymentLabel = isCod
    ? (confirmation?.paymentMethodLabel || confirmation?.payment?.methodLabel || 'Cash on Delivery')
    : (confirmation?.paymentMethodLabel || confirmation?.payment?.methodLabel || confirmation?.payment?.method || 'Mobile Money').toUpperCase();
  const paymentStatus = confirmation?.paymentStatusLabel || confirmation?.payment?.statusLabel || '';

  container.innerHTML = `
    <div class="ck-success-icon">✓</div>
    <h1>Order Placed!</h1>
    <p>Thank you, ${escapeHtml(confirmation?.customerName || 'customer')}. Your order has been received.</p>
    ${isCod
      ? '<p class="ck-cod-success-note">Kwishyura ibyo watumye bikugezeho — pay when your order arrives.</p>'
      : '<p class="ck-cod-success-note">Complete the payment using the instructions from checkout. Your order stays awaiting payment until confirmed.</p>'}
    <p><strong>Order ID:</strong> ${escapeHtml(resolvedId)}</p>
    <div class="ck-success-details">
      <h3>Order Summary</h3>
      ${renderProductList(items)}
      ${renderTotals(totals)}
      <p style="margin-top:12px"><strong>Payment:</strong> ${escapeHtml(paymentLabel)}</p>
      ${paymentStatus ? `<p><strong>Payment status:</strong> ${escapeHtml(paymentStatus)}</p>` : ''}
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
