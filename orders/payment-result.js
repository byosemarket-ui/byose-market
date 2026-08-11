import { resolveApiOrigin } from './utils.js';

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
      <div class="ck-actions">
        ${actions.map((action) => (
          `<a class="ck-btn ${action.primary ? 'ck-btn--primary' : 'ck-btn--ghost'}" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>`
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
      message: 'You cancelled the DPO payment. Your order is saved and waiting if you want to try again.',
      tone: 'warn'
    },
    invalid: {
      title: 'Invalid payment token',
      message: 'We could not verify this payment token. If you were charged, contact support with your order ID.',
      tone: 'error'
    },
    pending: {
      title: 'Payment still pending',
      message: 'DPO has not confirmed payment yet. You can wait a moment and refresh, or return to checkout.',
      tone: 'warn'
    },
    failed: {
      title: 'Payment failed',
      message: 'The DPO payment did not complete successfully. You can retry from your order or place a new checkout.',
      tone: 'error'
    }
  };

  const selected = map[status] || map.failed;
  renderResult({
    title: selected.title,
    message: selected.message,
    orderId,
    tone: selected.tone,
    actions: [
      { label: 'Back to shop', href: '../shop/index.html', primary: true },
      { label: 'Try payment again', href: 'payment.html' },
      orderId ? { label: 'View confirmation', href: `order-success.html?orderId=${encodeURIComponent(orderId)}` } : null
    ].filter(Boolean)
  });
}

boot();
