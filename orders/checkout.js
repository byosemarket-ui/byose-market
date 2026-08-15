import {
  getState, guardStep, initCheckout, refreshBackendDeliveryQuote, subscribe, updateProductQty
} from './core/state.js';
import {
  renderDeliveryInfo, renderProgress, renderProductList, renderShippingSummary, renderSidebar,
  renderStickyBar, renderTotals, showMessage
} from './ui/layout.js';
import { validateProducts } from './core/validation.js';

const progressEl = document.getElementById('progress');
const sidebarEl = document.getElementById('sidebar');
const stickyEl = document.getElementById('stickyBar');
const shippingSummaryEl = document.getElementById('shippingSummary');
const deliveryInfoEl = document.getElementById('deliveryInfo');
const productListEl = document.getElementById('productList');
const totalsBlockEl = document.getElementById('totalsBlock');
const messageEl = document.getElementById('message');

function render() {
  const state = getState();
  progressEl.innerHTML = renderProgress('review');
  shippingSummaryEl.innerHTML = renderShippingSummary(state.shipping);
  deliveryInfoEl.innerHTML = renderDeliveryInfo();
  productListEl.innerHTML = renderProductList(state.products, { editable: true });
  totalsBlockEl.innerHTML = renderTotals(state.totals);
  sidebarEl.innerHTML = renderSidebar(state.products, state.totals);
  stickyEl.innerHTML = renderStickyBar('', 'reviewContinueBtn', { hideAction: true });
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
  const check = validateProducts(getState().products);
  if (!check.valid) {
    showMessage(messageEl, check.message);
    return;
  }
  showMessage(messageEl, '');
});

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
