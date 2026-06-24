import {
  getState, guardStep, initCheckout, setDelivery, setStep, subscribe, updateProductQty
} from './core/state.js';
import {
  renderProgress, renderProductList, renderShippingSummary, renderSidebar,
  renderStickyBar, renderTotals, showMessage
} from './ui/layout.js';
import { validateProducts } from './core/validation.js';

const progressEl = document.getElementById('progress');
const sidebarEl = document.getElementById('sidebar');
const stickyEl = document.getElementById('stickyBar');
const shippingSummaryEl = document.getElementById('shippingSummary');
const productListEl = document.getElementById('productList');
const totalsBlockEl = document.getElementById('totalsBlock');
const deliveryToggle = document.getElementById('deliveryToggle');
const messageEl = document.getElementById('message');
const continueBtn = document.getElementById('reviewContinueBtn');

function render() {
  const state = getState();
  progressEl.innerHTML = renderProgress('review');
  shippingSummaryEl.innerHTML = renderShippingSummary(state.shipping);
  productListEl.innerHTML = renderProductList(state.products, { editable: true });
  totalsBlockEl.innerHTML = renderTotals(state.totals);
  sidebarEl.innerHTML = renderSidebar(state.products, state.totals);
  stickyEl.innerHTML = renderStickyBar('Continue to Payment', 'reviewContinueBtn');
  document.getElementById('stickyContinueBtn')?.addEventListener('click', handleContinue);

  deliveryToggle.querySelectorAll('.ck-delivery-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.delivery === state.delivery);
  });
}

deliveryToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-delivery]');
  if (!btn) return;
  setDelivery(btn.dataset.delivery);
});

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
});

function handleContinue() {
  const check = validateProducts(getState().products);
  if (!check.valid) {
    showMessage(messageEl, check.message);
    return;
  }
  setStep('payment');
  window.location.assign('payment.html');
}

continueBtn?.addEventListener('click', handleContinue);
document.getElementById('reviewForm')?.addEventListener('submit', (e) => { e.preventDefault(); handleContinue(); });

subscribe(() => render());

await initCheckout('review');
const access = guardStep('review');
if (!access.ok) {
  window.location.href = access.redirect;
} else {
  render();
  window.__ckStep = 'review';
}
