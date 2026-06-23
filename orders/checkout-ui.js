import { escapeHtml, formatCurrency, formatVariantDetailsText } from './utils.js';
import { ORDER_STEPS } from './checkout-foundation.js';
import { getPaymentMethodCatalog, resolvePaymentMethodLabel } from './payment-foundation.js';

export const PAYMENT_OPTION_VISUALS = {
  mtn: {
    detail: 'Pay with MTN MoMo',
    icon: '../img/MTN.jpeg'
  },
  airtel: {
    detail: 'Use Airtel Money',
    icon: '../img/airtel.jpeg'
  },
  bank: {
    detail: 'Pay by Bank Transfer',
    icon: '../img/BANK TRANSFER.jpeg'
  },
  card: {
    detail: 'Pay with Visa or Mastercard',
    icon: '../img/VASA  MASTERCARD.jpeg'
  },
  cod: {
    detail: 'Pay after receiving your order.',
    detailSecondary: 'Available in Kigali only.',
    detailRw: 'Wishyura nyuma yo kwakira igicuruzwa, ukishyura umaze kugenzura ko gihuye n’icyo waguze.',
    unavailable: 'Iyi serivisi iboneka gusa mu Mujyi wa Kigali.',
    icon: '../img/PAY ON DELIVERY.jpeg'
  },
  wallet: {
    detail: 'Digital wallet foundation is prepared for future activation.',
    unavailable: 'Wallet payments are coming soon.',
    icon: '../img/BANK TRANSFER.jpeg'
  }
};

export function renderStageProgress(container, activeStage, steps = ORDER_STEPS) {
  if (!container) {
    return;
  }

  const activeIndex = steps.findIndex((step) => step.id === activeStage);
  container.innerHTML = steps.map((step, index) => {
    const tone = index < activeIndex ? 'is-complete' : index === activeIndex ? 'is-active' : '';
    return `
      <button type="button" class="orders-progress-step ${tone}" disabled>
        <span>${index + 1}</span>
        <strong>${escapeHtml(step.label)}</strong>
      </button>
    `;
  }).join('');
}

export function renderSummaryProducts(products = []) {
  return (Array.isArray(products) ? products : []).map((item) => `
    <article class="orders-summary-product">
      <img src="${escapeHtml(item.colorImage || item.image || item.img || '')}" alt="${escapeHtml(item.name || 'Product')}">
      <div>
        <strong>${escapeHtml(item.name || 'Product')}</strong>
        <p>${escapeHtml(formatVariantDetailsText(item))}</p>
        <span>Qty ${Number(item.qty || 0)} x ${formatCurrency(item.price || 0)}</span>
      </div>
      <strong>${formatCurrency(item.total || ((Number(item.qty || 0) || 0) * (Number(item.price || 0) || 0)))}</strong>
    </article>
  `).join('');
}

export function renderPaymentMethodList(state, options = {}) {
  const {
    inputName = 'method',
    includeFuture = true,
    isCodAvailable = () => true
  } = options;

  const paymentOptions = getPaymentMethodCatalog({ includeFuture }).map((method) => ({
    id: method.id,
    title: method.label,
    detail: PAYMENT_OPTION_VISUALS[method.id]?.detail || 'Payment method',
    detailSecondary: method.id === 'wallet'
      ? 'Future wallet systems foundation'
      : PAYMENT_OPTION_VISUALS[method.id]?.detailSecondary,
    detailRw: PAYMENT_OPTION_VISUALS[method.id]?.detailRw,
    unavailable: PAYMENT_OPTION_VISUALS[method.id]?.unavailable || 'This method is not available in your area.',
    icon: PAYMENT_OPTION_VISUALS[method.id]?.icon || '../img/BANK TRANSFER.jpeg',
    enabled: method.enabled
  }));

  return paymentOptions.map((option) => {
    const isDisabled = !option.enabled || (option.id === 'cod' && !isCodAvailable());
    const isSelected = String(state?.payment?.method || '') === option.id;
    return `
      <label class="orders-payment-option ${isSelected ? 'is-selected' : ''} ${isDisabled ? 'is-disabled' : ''}">
        <input type="radio" name="${escapeHtml(inputName)}" value="${escapeHtml(option.id)}" ${isSelected ? 'checked' : ''} ${isDisabled ? 'disabled' : ''}>
        <span class="orders-payment-radio" aria-hidden="true"></span>
        <img class="orders-payment-icon" src="${escapeHtml(option.icon)}" alt="${escapeHtml(option.title)} icon">
        <div class="orders-payment-option-copy">
          <strong>${escapeHtml(option.title)}</strong>
          <p>${escapeHtml(option.detail)}</p>
          ${option.detailSecondary ? `<p>${escapeHtml(option.detailSecondary)}</p>` : ''}
          ${option.detailRw ? `<p>${escapeHtml(option.detailRw)}</p>` : ''}
          ${isDisabled ? `<small class="orders-payment-warning">${escapeHtml(option.unavailable || 'Not available in your area.')}</small>` : ''}
        </div>
      </label>
    `;
  }).join('');
}

export function renderSelectedPaymentMethod(state, options = {}) {
  const method = String(state?.payment?.method || '').trim();
  const methodMeta = PAYMENT_OPTION_VISUALS[method] || {};
  const title = resolvePaymentMethodLabel(method);

  if (!method) {
    return '<p class="orders-payment-empty">No payment method selected.</p>';
  }

  return `
    <article class="orders-payment-option is-selected orders-payment-option--summary">
      <img class="orders-payment-icon" src="${escapeHtml(methodMeta.icon || '../img/BANK TRANSFER.jpeg')}" alt="${escapeHtml(title)} icon">
      <div class="orders-payment-option-copy">
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(methodMeta.detail || 'Selected payment method')}</p>
        ${options.showPhone && state?.payment?.phone ? `<p>Phone: ${escapeHtml(state.payment.phone)}</p>` : ''}
      </div>
    </article>
  `;
}

export function mountStickyCheckoutBar(container, {
  total = 0,
  label = 'Total',
  buttonText = 'Continue',
  disabled = false,
  onAction = null
} = {}) {
  if (!container) {
    return;
  }

  container.hidden = false;
  container.innerHTML = `
    <div class="orders-sticky-checkout-bar__copy">
      <span>${escapeHtml(label)}</span>
      <strong>${formatCurrency(total)}</strong>
    </div>
    <button type="button" class="orders-sticky-checkout-bar__action" ${disabled ? 'disabled' : ''}>${escapeHtml(buttonText)}</button>
  `;

  const button = container.querySelector('.orders-sticky-checkout-bar__action');
  if (button) {
    button.onclick = typeof onAction === 'function' ? onAction : null;
  }
}
