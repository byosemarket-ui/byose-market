import { getConfirmation, initCheckout } from './core/state.js';
import { DELIVERY_FEE } from './core/constants.js';
import { renderProductList, renderShippingSummary, renderTotals } from './ui/layout.js';
import { escapeHtml, resolveApiOrigin, saveCheckoutConfirmation, clearPendingOrderSubmission } from './utils.js';
import {
  clearActiveCheckoutKeys,
  clearAwaitingGatewayOrderId,
  removePurchasedItemsFromCart,
  shouldRemoveCartAfterPurchase
} from './checkout-session.js';

const container = document.getElementById('successContent');
const params = new URLSearchParams(window.location.search);
const orderId = params.get('orderId') || '';

function isPaidStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (!status) return false;
  if (
    status.includes('unpaid')
    || status.includes('awaiting')
    || status.includes('pending')
    || status.includes('fail')
    || status.includes('cancel')
    || status.includes('unsuccess')
    || status.includes('invalid')
    || status.includes('refund')
  ) {
    return false;
  }
  return status === 'paid'
    || status === 'success'
    || status === 'successful'
    || status === 'completed'
    || status === 'complete'
    || status === 'payment_successful'
    || status === 'authorized';
}

function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  try {
    const token = window.authService?.getToken?.() || window.localStorage?.getItem('bm_auth_token') || '';
    if (token) headers.Authorization = `Bearer ${String(token).trim()}`;
  } catch (_error) { /* optional auth */ }
  return headers;
}

async function fetchServerConfirmation(id) {
  const base = resolveApiOrigin();
  if (!base || !id) return null;
  const endpoint = base.endsWith('/api')
    ? `${base}/orders/confirmation/${encodeURIComponent(id)}`
    : `${base}/api/orders/confirmation/${encodeURIComponent(id)}`;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), 8000) : 0;
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: getAuthHeaders(),
      ...(controller ? { signal: controller.signal } : {})
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success || !payload.confirmation) return null;
    return payload.confirmation;
  } catch (_error) {
    return null;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

async function verifyPaidStatus(id) {
  const base = resolveApiOrigin();
  if (!base || !id) return null;
  const endpoint = base.endsWith('/api')
    ? `${base}/payments/dpo/verify`
    : `${base}/api/payments/dpo/verify`;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), 8000) : 0;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ orderId: id }),
      ...(controller ? { signal: controller.signal } : {})
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) return null;
    return payload;
  } catch (_error) {
    return null;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

function renderUnavailable(resolvedId) {
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
}

function renderSuccess(confirmation, resolvedId) {
  const items = confirmation?.items || [];
  const subtotal = Number(confirmation?.subtotal)
    || items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity || i.qty) || 1), 0);
  const deliveryFee = Number(confirmation?.deliveryFee);
  const codFee = Number(confirmation?.codFee);
  const totals = {
    subtotal,
    discount: Number(confirmation?.discount) || 0,
    tax: Number(confirmation?.tax) || 0,
    deliveryFee: Number.isFinite(deliveryFee) ? deliveryFee : DELIVERY_FEE,
    codFee: Number.isFinite(codFee) ? codFee : 0,
    total: Number(confirmation?.total) || (subtotal + (Number.isFinite(deliveryFee) ? deliveryFee : DELIVERY_FEE) + (Number.isFinite(codFee) ? codFee : 0))
  };

  const isCod = confirmation?.payment?.method === 'cod' || confirmation?.paymentMethod === 'cod';
  const paid = isPaidStatus(confirmation?.paymentStatus || confirmation?.payment?.status);
  const methodKey = String(confirmation?.paymentMethod || confirmation?.payment?.method || '').toLowerCase();
  const paymentLabel = isCod
    ? (confirmation?.paymentMethodLabel || confirmation?.payment?.methodLabel || 'Cash on Delivery')
    : (confirmation?.paymentMethodLabel
      || confirmation?.payment?.methodLabel
      || (methodKey === 'mtn' ? 'MTN MoMo' : methodKey === 'card' ? 'Card' : 'Card'));
  const paymentStatus = confirmation?.paymentStatusLabel
    || confirmation?.payment?.statusLabel
    || (paid ? 'Paid' : (isCod ? 'Awaiting Delivery Payment' : 'Awaiting Payment'));

  const shippingForSummary = {
    ...(confirmation?.shippingAddress || {}),
    latitude: confirmation?.gpsLocation?.latitude || confirmation?.shippingAddress?.latitude || '',
    longitude: confirmation?.gpsLocation?.longitude || confirmation?.shippingAddress?.longitude || '',
    mapLink: confirmation?.gpsLocation?.googleMapsLink
      || confirmation?.gpsLocation?.mapLink
      || confirmation?.shippingAddress?.mapLink
      || ''
  };

  const paymentNote = isCod
    ? 'Pay when your order arrives. This order is not paid online.'
    : (paid
      ? 'Payment confirmed. Thank you — your order is paid.'
      : 'Complete the payment on the secure payment page. Your order stays awaiting payment until confirmed.');

  container.innerHTML = `
    <div class="ck-success-icon">✓</div>
    <h1>${paid && !isCod ? 'Payment Successful!' : 'Order Placed!'}</h1>
    <p>Thank you, ${escapeHtml(confirmation?.customerName || 'customer')}. Your order has been received.</p>
    <p class="ck-cod-success-note">${escapeHtml(paymentNote)}</p>
    <p><strong>Order ID:</strong> ${escapeHtml(resolvedId)}</p>
    <div class="ck-success-details">
      <h3>Order Summary</h3>
      ${renderProductList(items)}
      ${renderTotals(totals)}
      <p style="margin-top:12px"><strong>Payment:</strong> ${escapeHtml(paymentLabel)}</p>
      ${paymentStatus ? `<p><strong>Payment status:</strong> ${escapeHtml(paymentStatus)}</p>` : ''}
      <div style="margin-top:16px">${renderShippingSummary(shippingForSummary)}</div>
    </div>
    <div class="ck-success-actions">
      <a class="ck-btn ck-btn--primary" href="../index.html">Continue Shopping</a>
      <a class="ck-btn ck-btn--ghost" href="../account/account.html">My Account</a>
    </div>
  `;
}

function maybeRemovePurchasedCartItems(confirmation) {
  if (!confirmation || !shouldRemoveCartAfterPurchase(confirmation)) {
    return;
  }
  removePurchasedItemsFromCart(
    confirmation.items || confirmation.products || [],
    confirmation.purchasedCartKeys || []
  );
}

await initCheckout('success');

let confirmation = getConfirmation();
const resolvedId = orderId || confirmation?.orderId || '';
let confirmationMatches = confirmation
  && (!orderId || String(confirmation.orderId || '') === String(orderId));

if (confirmationMatches) {
  renderSuccess(confirmation, resolvedId);
  maybeRemovePurchasedCartItems(confirmation);
}

if (resolvedId) {
  const remote = await fetchServerConfirmation(resolvedId);
  if (remote) {
    confirmation = {
      ...(confirmation && confirmationMatches ? confirmation : {}),
      ...remote,
      checkoutSource: remote.checkoutSource || confirmation?.checkoutSource || 'unknown'
    };
    saveCheckoutConfirmation(confirmation);
    confirmationMatches = true;
    renderSuccess(confirmation, resolvedId);
    maybeRemovePurchasedCartItems(confirmation);
  }
}

if (!confirmationMatches) {
  renderUnavailable(resolvedId);
}

const confirmationIsCod = confirmationMatches
  && (
    String(confirmation?.payment?.method || confirmation?.paymentMethod || '').toLowerCase() === 'cod'
    || String(confirmation?.payment?.type || confirmation?.paymentType || '').toLowerCase() === 'cod'
  );

if (confirmationMatches && resolvedId && !confirmationIsCod) {
  const verified = await verifyPaidStatus(resolvedId);
  if (verified && (verified.outcome === 'success' || isPaidStatus(verified.paymentStatus))) {
    confirmation = {
      ...confirmation,
      paymentStatus: 'paid',
      paymentStatusLabel: 'Paid',
      payment: {
        ...(confirmation.payment || {}),
        status: 'paid',
        statusLabel: 'Paid',
        method: confirmation.payment?.method || confirmation.paymentMethod || 'card',
        methodLabel: confirmation.payment?.methodLabel || confirmation.paymentMethodLabel || 'Card'
      }
    };
    saveCheckoutConfirmation(confirmation);
    renderSuccess(confirmation, resolvedId);
    maybeRemovePurchasedCartItems(confirmation);
    clearPendingOrderSubmission();
    clearAwaitingGatewayOrderId();
    clearActiveCheckoutKeys();
  }
}
