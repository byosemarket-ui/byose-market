import { resolveApiOrigin } from './utils.js';
import { initiateDpoPayment } from './core/order.js';

const contentEl = document.getElementById('paymentResultContent');

function params() {
  return new URLSearchParams(window.location.search || '');
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderResult({ title, message, orderId, tone = 'error', actions = [] }) {
  if (!contentEl) return;
  contentEl.innerHTML = `
    <div class="ck-result ck-result--${escapeHtml(tone)}">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      ${orderId ? `<p><strong>Order:</strong> ${escapeHtml(orderId)}</p>` : ''}
      <p id="paymentResultMessage" class="ck-message" hidden></p>
      <div class="ck-actions">
        ${actions.map((action) => (
          action.retry
            ? `<button type="button" class="ck-btn ${action.primary ? 'ck-btn--primary' : 'ck-btn--ghost'}" id="retryPaymentBtn">${escapeHtml(action.label)}</button>`
            : `<a class="ck-btn ${action.primary ? 'ck-btn--primary' : 'ck-btn--ghost'}" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>`
        )).join('')}
      </div>
    </div>
  `;
}

async function verifyOnLoad(orderId, statusHint) {
  const base = resolveApiOrigin();
  if (!base || !orderId) return null;
  const endpoint = base.endsWith('/api')
    ? `${base}/payments/dpo/verify`
    : `${base}/api/payments/dpo/verify`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ orderId })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      return { outcome: statusHint || 'failed', orderId, message: payload?.message || '' };
    }
    return payload;
  } catch (_error) {
    return { outcome: statusHint || 'failed', orderId };
  }
}

async function retryExistingPayment(orderId) {
  const messageEl = document.getElementById('paymentResultMessage');
  const retryBtn = document.getElementById('retryPaymentBtn');
  if (retryBtn) retryBtn.disabled = true;
  if (messageEl) {
    messageEl.hidden = false;
    messageEl.textContent = 'Starting a secure payment session...';
  }

  try {
    const payment = await initiateDpoPayment(orderId);
    if (payment.alreadyPaid) {
      window.location.replace(`order-success.html?orderId=${encodeURIComponent(orderId)}`);
      return;
    }
    if (!payment.success || (!payment.paymentUrl && !payment.redirectUrl)) {
      if (messageEl) {
        messageEl.textContent = payment.message || 'Unable to restart payment. Please try again shortly.';
      }
      if (retryBtn) retryBtn.disabled = false;
      return;
    }
    window.location.href = payment.paymentUrl || payment.redirectUrl;
  } catch (_error) {
    if (messageEl) {
      messageEl.textContent = 'Payment is temporarily unavailable. Please try again shortly.';
    }
    if (retryBtn) retryBtn.disabled = false;
  }
}

async function boot() {
  const query = params();
  const orderId = String(query.get('orderId') || '').trim();
  const status = String(query.get('status') || 'failed').trim().toLowerCase();

  if (status === 'pending' || status === 'failed' || status === 'invalid') {
    const verified = await verifyOnLoad(orderId, status);
    if (verified?.outcome === 'success' || verified?.paymentStatus === 'paid') {
      window.location.replace(`order-success.html?orderId=${encodeURIComponent(orderId)}`);
      return;
    }
  }

  const map = {
    cancelled: {
      title: 'Payment cancelled',
      message: 'You cancelled the payment. Your order is saved and waiting if you want to try again.',
      tone: 'warn'
    },
    invalid: {
      title: 'Invalid payment token',
      message: 'We could not verify this payment token. If you were charged, contact support with your order ID.',
      tone: 'error'
    },
    pending: {
      title: 'Payment still pending',
      message: 'Payment has not been confirmed yet. You can wait a moment and refresh, or retry the payment.',
      tone: 'warn'
    },
    failed: {
      title: 'Payment failed',
      message: 'The payment did not complete successfully. You can retry this same order without creating a new one.',
      tone: 'error'
    }
  };

  const selected = map[status] || map.failed;
  const actions = [
    { label: 'Back to shop', href: '../shop/shop.html' }
  ];
  if (orderId) {
    actions.unshift({ label: 'Try payment again', retry: true, primary: true });
  } else {
    actions.unshift({ label: 'Return to checkout', href: 'payment.html', primary: true });
  }

  renderResult({
    title: selected.title,
    message: selected.message,
    orderId,
    tone: selected.tone,
    actions
  });

  document.getElementById('retryPaymentBtn')?.addEventListener('click', (event) => {
    event.preventDefault();
    void retryExistingPayment(orderId);
  });
}

boot();
