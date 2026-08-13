import {
  applyCheckoutCoupon,
  clearCheckoutCoupon,
  getState, guardStep, initCheckout, refreshBackendDeliveryQuote, setStep, subscribe, updateProductQty
} from './core/state.js';
import {
  renderCouponPanel, renderDeliveryInfo, renderProgress, renderProductList, renderShippingSummary, renderSidebar,
  renderStickyBar, renderTotals, showMessage
} from './ui/layout.js';
import { validateProducts } from './core/validation.js';

const progressEl = document.getElementById('progress');
const sidebarEl = document.getElementById('sidebar');
const stickyEl = document.getElementById('stickyBar');
const shippingSummaryEl = document.getElementById('shippingSummary');
const deliveryInfoEl = document.getElementById('deliveryInfo');
const productListEl = document.getElementById('productList');
const couponBlockEl = document.getElementById('couponBlock');
const totalsBlockEl = document.getElementById('totalsBlock');
const messageEl = document.getElementById('message');
const continueBtn = document.getElementById('reviewContinueBtn');
let continueBound = false;

function bindCouponPanel() {
  const applyBtn = document.getElementById('couponApplyBtn');
  const clearBtn = document.getElementById('couponClearBtn');
  const input = document.getElementById('couponCodeInput');
  const message = document.getElementById('couponMessage');

  applyBtn?.addEventListener('click', async () => {
    applyBtn.disabled = true;
    const result = await applyCheckoutCoupon(input?.value || '');
    if (!result.ok && message) {
      message.textContent = result.message || 'Unable to apply coupon.';
    }
    applyBtn.disabled = false;
    render();
  });

  clearBtn?.addEventListener('click', () => {
    clearCheckoutCoupon();
    render();
  });
}

function render() {
  const state = getState();
  progressEl.innerHTML = renderProgress('review');
  shippingSummaryEl.innerHTML = renderShippingSummary(state.shipping);
  deliveryInfoEl.innerHTML = renderDeliveryInfo();
  productListEl.innerHTML = renderProductList(state.products, { editable: true });
  if (couponBlockEl) {
    couponBlockEl.innerHTML = renderCouponPanel(state.coupon);
    bindCouponPanel();
  }
  totalsBlockEl.innerHTML = renderTotals(state.totals);
  sidebarEl.innerHTML = renderSidebar(state.products, state.totals);
  stickyEl.innerHTML = renderStickyBar('Continue to Payment', 'reviewContinueBtn');
}

function handleContinue(event) {
  event?.preventDefault?.();
  const check = validateProducts(getState().products);
  if (!check.valid) {
    showMessage(messageEl, check.message);
    return;
  }
  setStep('payment');
  window.location.assign(`payment.html?from=review&t=${Date.now()}`);
}

productListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-qty-action]');
  if (!btn) return;
  const state = getState();
  const id = btn.dataset.id;
  const variant = btn.dataset.variant || '';
  const item = state.products.find((p) => String(p.id) === id && String(p.variantKey || '') === variant);
  if (!item) return;
  const delta = btn.dataset.qtyAction === 'inc' ? 1 : -1;
  updateProductQty(id, variant, (item.qty || 1) + delta);
  const couponCode = getState().coupon?.code;
  if (couponCode) {
    void applyCheckoutCoupon(couponCode).then(() => render());
  }
});

if (!continueBound) {
  continueBound = true;
  continueBtn?.addEventListener('click', handleContinue);
  document.getElementById('reviewForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    handleContinue(e);
  });
  stickyEl?.addEventListener('click', (e) => {
    if (!e.target?.closest?.('#stickyContinueBtn')) return;
    handleContinue(e);
  });
}

subscribe(() => render());

await initCheckout('review');
const access = guardStep('review');
if (!access.ok) {
  console.warn('REDIRECT_REASON', access.code || 'UNKNOWN', access);
  window.location.href = access.redirect;
} else {
  render();
  window.__ckStep = 'review';
  void refreshBackendDeliveryQuote();
}
