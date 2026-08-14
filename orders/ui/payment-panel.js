import { escapeHtml, formatCurrency, normalizePhone } from '../utils.js';
import { isCodPaymentMethod, isGatewayPaymentMethod } from '../core/constants.js';

function nationalPhoneDigits(value) {
  const normalized = normalizePhone(value);
  const match = String(normalized || '').match(/^\+250(\d{9})$/);
  return match ? match[1] : String(value || '').replace(/\D/g, '').slice(-9);
}

export function renderPaymentPanel({ method, totals = {}, shipping = {}, payment = {} } = {}) {
  const id = String(method || '').toLowerCase();
  const total = formatCurrency(totals.total || 0);

  if (isCodPaymentMethod(id)) {
    return `
      <section class="ck-pay-panel ck-pay-panel--cod" aria-label="Cash on Delivery">
        <div class="ck-pay-amount">
          <span>Amount due on delivery</span>
          <strong>${total}</strong>
        </div>
        <p>Pay when your order is delivered. Available in Kigali only. No online payment is taken now.</p>
      </section>
    `;
  }

  if (id === 'mtn') {
    const seed = payment.phone || shipping.phone || '';
    const national = nationalPhoneDigits(seed);
    return `
      <section class="ck-pay-panel ck-pay-panel--mtn" aria-label="MTN MoMo">
        <div class="ck-pay-amount">
          <span>Amount</span>
          <strong>${total}</strong>
        </div>
        <label class="ck-field ck-momo-field">
          <span>MTN Mobile Number</span>
          <div class="ck-momo-input">
            <span class="ck-momo-prefix">+250</span>
            <input
              type="tel"
              name="momoPhone"
              id="momoPhoneInput"
              inputmode="numeric"
              autocomplete="tel"
              maxlength="9"
              placeholder="7XXXXXXXX"
              value="${escapeHtml(national)}"
            >
          </div>
          <small class="ck-field-error" data-error="phone"></small>
        </label>
        <p>Enter the MTN number that will authorize this payment. You will confirm it with MTN. We never ask for your PIN.</p>
      </section>
    `;
  }

  if (id === 'card' || isGatewayPaymentMethod(id)) {
    return `
      <section class="ck-pay-panel ck-pay-panel--card" aria-label="Card payment">
        <div class="ck-pay-amount">
          <span>Amount</span>
          <strong>${total}</strong>
        </div>
        <p>Pay securely with Visa or Mastercard on the official payment page. Card number and CVV stay with the payment provider — BYOSE Market never stores them.</p>
      </section>
    `;
  }

  return `
    <section class="ck-pay-panel">
      <p>Select MTN MoMo, Card, or Cash on Delivery.</p>
    </section>
  `;
}

export function readMomoPhoneFromPanel(container) {
  const input = container?.querySelector('#momoPhoneInput');
  if (!input) return '';
  return normalizePhone(String(input.value || '').trim());
}
