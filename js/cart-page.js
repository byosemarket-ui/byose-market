import ByoseCart from '../services/byose-cart.js';
import productService from '../services/centralized-products.service.js';

const els = {
  items: document.getElementById('cartItems'),
  saved: document.getElementById('savedItems'),
  savedSection: document.getElementById('savedSection'),
  count: document.getElementById('cartCount'),
  selectAll: document.getElementById('cartSelectAll'),
  summarySelected: document.getElementById('summarySelected'),
  summarySubtotal: document.getElementById('summarySubtotal'),
  summaryDiscount: document.getElementById('summaryDiscount'),
  summaryShipping: document.getElementById('summaryShipping'),
  summaryTax: document.getElementById('summaryTax'),
  summaryTotal: document.getElementById('summaryTotal'),
  checkoutBtn: document.getElementById('checkoutBtn'),
  whatsappBtn: document.getElementById('whatsappBtn'),
  stickyCheckoutBtn: document.getElementById('stickyCheckoutBtn'),
  stickyTotal: document.getElementById('stickyTotal')
};

function badgeHtml(item) {
  const badges = [];
  if (item.unavailable || item.availability === 'out_of_stock') {
    badges.push('<span class="cart-badge cart-badge--stock">Out of stock</span>');
  } else if (item.availability === 'low_stock') {
    badges.push('<span class="cart-badge cart-badge--low">Low stock</span>');
  }
  if (item.priceChanged) {
    badges.push('<span class="cart-badge cart-badge--price">Price updated</span>');
  }
  if (item.variantInvalid) {
    badges.push('<span class="cart-badge cart-badge--stock">Reselect variant</span>');
  }
  return badges.join('');
}

function renderVariantDetails(item) {
  const color = item.colorName || item.color;
  const size = item.sizeLabel || item.size;
  const parts = [];
  if (color) {
    parts.push(`Color: ${color}`);
  }
  if (size) {
    parts.push(`Size: ${size}`);
  }
  return parts.length ? parts.join(' · ') : (item.attributeSummary || 'Standard option');
}

function renderItem(item, { saved = false } = {}) {
  const url = ByoseCart.getProductUrl(item);
  const compare = item.comparePrice > item.price
    ? `<span class="cart-item__compare">${ByoseCart.formatPrice(item.comparePrice)}</span>`
    : '';
  const disabled = item.unavailable ? 'disabled' : '';
  const checked = item.selected !== false ? 'checked' : '';
  const lineImage = item.colorImage || item.image || 'img/logo.png';
  const variantDetails = renderVariantDetails(item);

  const selectCell = saved
    ? ''
    : `<label class="cart-item__select"><input type="checkbox" data-action="toggle" data-line-id="${item.lineId}" ${checked} aria-label="Select ${ByoseCart.escapeHtml(item.name)}"></label>`;

  const actions = saved
    ? `
      <button type="button" class="cart-text-btn" data-action="restore" data-line-id="${item.lineId}">Move to cart</button>
      <button type="button" class="cart-text-btn cart-text-btn--danger" data-action="remove-saved" data-line-id="${item.lineId}">Remove</button>
    `
    : `
      <div class="cart-qty">
        <button type="button" data-action="dec" data-line-id="${item.lineId}" ${disabled} aria-label="Decrease quantity">−</button>
        <span>${item.qty}</span>
        <button type="button" data-action="inc" data-line-id="${item.lineId}" ${disabled} aria-label="Increase quantity">+</button>
      </div>
      <button type="button" class="cart-text-btn" data-action="save" data-line-id="${item.lineId}">Save for later</button>
      <button type="button" class="cart-text-btn cart-text-btn--danger" data-action="remove" data-line-id="${item.lineId}">Remove</button>
    `;

  return `
    <article class="cart-item" data-line-id="${item.lineId}">
      ${selectCell}
      <a href="${url}" class="cart-item__media">
        <img src="${ByoseCart.escapeHtml(lineImage)}" alt="" loading="lazy" decoding="async">
      </a>
      <div class="cart-item__body">
        <h3 class="cart-item__name"><a href="${url}">${ByoseCart.escapeHtml(item.name)}</a></h3>
        ${variantDetails ? `<p class="cart-item__variant">${ByoseCart.escapeHtml(variantDetails)}</p>` : ''}
        <div class="cart-item__badges">${badgeHtml(item)}</div>
        <div class="cart-item__pricing">
          <span class="cart-item__price">${ByoseCart.formatPrice(item.price)}</span>
          ${compare}
        </div>
        <div class="cart-item__actions">${actions}</div>
      </div>
      ${saved ? '' : `<div class="cart-item__subtotal">${ByoseCart.formatPrice(item.price * item.qty)}</div>`}
    </article>
  `;
}

function renderEmpty() {
  return `
    <div class="cart-empty">
      <div class="cart-empty__icon"><i class="fa-solid fa-bag-shopping"></i></div>
      <h2 class="cart-empty__title">Your cart is empty</h2>
      <p class="cart-empty__text">Browse products and add items to start shopping.</p>
      <a href="shop.html" class="cart-btn cart-btn--primary" style="display:inline-flex;width:auto;padding:0 20px;text-decoration:none;">Start shopping</a>
    </div>
  `;
}

function updateSummary() {
  const summary = ByoseCart.getSummary({ selectedOnly: true });
  const all = ByoseCart.getItems();

  if (els.count) {
    const qty = all.reduce((sum, item) => sum + item.qty, 0);
    els.count.textContent = `${qty} item${qty === 1 ? '' : 's'}`;
  }

  if (els.summarySelected) els.summarySelected.textContent = String(summary.quantity);
  if (els.summarySubtotal) els.summarySubtotal.textContent = ByoseCart.formatPrice(summary.subtotal);
  if (els.summaryDiscount) els.summaryDiscount.textContent = summary.discounts > 0 ? `-${ByoseCart.formatPrice(summary.discounts)}` : 'RWF 0';
  if (els.summaryShipping) els.summaryShipping.textContent = ByoseCart.formatPrice(summary.shipping);
  if (els.summaryTax) els.summaryTax.textContent = ByoseCart.formatPrice(summary.tax);
  if (els.summaryTotal) els.summaryTotal.textContent = ByoseCart.formatPrice(summary.total);
  if (els.stickyTotal) els.stickyTotal.textContent = ByoseCart.formatPrice(summary.total);

  const canCheckout = summary.canCheckout;
  [els.checkoutBtn, els.stickyCheckoutBtn].forEach((btn) => {
    if (btn) btn.disabled = !canCheckout;
  });
  if (els.whatsappBtn) els.whatsappBtn.disabled = !canCheckout;

  if (els.selectAll) {
    const selectedCount = all.filter((item) => item.selected !== false).length;
    els.selectAll.checked = all.length > 0 && selectedCount === all.length;
    els.selectAll.indeterminate = selectedCount > 0 && selectedCount < all.length;
  }
}

function render() {
  const items = ByoseCart.getItems();
  const saved = ByoseCart.getSavedItems();

  if (els.items) {
    els.items.innerHTML = items.length ? items.map((item) => renderItem(item)).join('') : renderEmpty();
  }

  if (els.savedSection && els.saved) {
    if (saved.length) {
      els.savedSection.hidden = false;
      els.saved.innerHTML = saved.map((item) => renderItem(item, { saved: true })).join('');
    } else {
      els.savedSection.hidden = true;
      els.saved.innerHTML = '';
    }
  }

  updateSummary();
}

async function syncCatalog() {
  try {
    const products = await productService.getProductsWithRetry();
    if (Array.isArray(products) && products.length) {
      ByoseCart.applyCatalogUpdates(products);
    }
  } catch {
    /* keep local cart */
  }
  render();
}

function handleClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  const lineId = target.dataset.lineId;
  if (!lineId && action !== 'checkout' && action !== 'whatsapp') return;

  switch (action) {
    case 'toggle':
      ByoseCart.toggleSelect(lineId, target.checked);
      break;
    case 'inc':
      ByoseCart.updateQty(lineId, (ByoseCart.findLine(lineId)?.qty || 1) + 1);
      break;
    case 'dec':
      ByoseCart.updateQty(lineId, (ByoseCart.findLine(lineId)?.qty || 1) - 1);
      break;
    case 'remove':
      ByoseCart.remove(lineId);
      break;
    case 'save':
      ByoseCart.saveForLater(lineId);
      break;
    case 'restore':
      ByoseCart.restoreFromSaved(lineId);
      break;
    case 'remove-saved':
      ByoseCart.removeSaved(lineId);
      break;
    default:
      return;
  }

  render();
}

function bindEvents() {
  document.addEventListener('click', handleClick);

  els.selectAll?.addEventListener('change', (event) => {
    ByoseCart.selectAll(event.target.checked);
    render();
  });

  els.checkoutBtn?.addEventListener('click', () => {
    try {
      ByoseCart.proceedToCheckout();
    } catch (error) {
      alert(error.message);
    }
  });

  els.stickyCheckoutBtn?.addEventListener('click', () => {
    try {
      ByoseCart.proceedToCheckout();
    } catch (error) {
      alert(error.message);
    }
  });

  els.whatsappBtn?.addEventListener('click', () => ByoseCart.openWhatsAppOrder());

  window.addEventListener('byose:cart-updated', render);
  window.addEventListener('cart:updated', render);
}

ByoseCart.init();
bindEvents();
void syncCatalog();
