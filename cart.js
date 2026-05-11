// Kwizera Cart Pack — cart.js
(() => {
  const KEY = 'byose_market_cart_v1';
  const MAX_QTY_PER_LINE = 99;
  let cartCache = null;
  let cartCacheRaw = '';

  const $ = (sel, root = document) => root.querySelector(sel);

  function safeGetStorage(key) {
    try {
      if (window.ByoseStorefrontSync?.isManagedKey?.(key)) {
        const value = window.ByoseStorefrontSync.readStateByKey(key);
        return value === undefined ? null : JSON.stringify(value);
      }

      return localStorage.getItem(key);
    } catch (error) {
      console.warn(`Unable to read ${key} from local storage.`, error);
      return null;
    }
  }

  function safeSetStorage(key, value) {
    try {
      if (window.ByoseStorefrontSync?.isManagedKey?.(key)) {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return window.ByoseStorefrontSync.writeStateByKey(key, parsed);
      }

      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      console.warn(`Unable to write ${key} to local storage.`, error);
      return false;
    }
  }

  function safeRemoveStorage(key) {
    try {
      if (window.ByoseStorefrontSync?.isManagedKey?.(key)) {
        window.ByoseStorefrontSync.removeStateByKey(key);
        return;
      }

      localStorage.removeItem(key);
    } catch (error) {
      console.warn(`Unable to remove ${key} from local storage.`, error);
    }
  }

  function migrateOldKey() {
    const oldKey = 'kwizeraCart_v1';
    try {
      if (oldKey !== KEY && localStorage.getItem(oldKey)) {
        safeRemoveStorage(oldKey);
      }
    } catch (error) {
      // Ignore storage migration issues.
    }
  }

  function normalizeAttributes(item) {
    if (item && item.attributes && typeof item.attributes === 'object' && !Array.isArray(item.attributes)) {
      return Object.fromEntries(
        Object.entries(item.attributes).filter(([, value]) => value !== undefined && value !== null && value !== '')
      );
    }

    const attributes = {};
    if (item && item.color) attributes.Color = item.color;
    if (item && item.size) attributes.Size = item.size;
    return attributes;
  }

  function buildVariantKey(attributes) {
    return Object.entries(attributes || {})
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
      .map(([key, value]) => `${key}:${value}`)
      .join('|');
  }

  function getLegacyFields(attributes) {
    const entries = Object.entries(attributes || {});
    const read = (target) => {
      const match = entries.find(([key]) => String(key).toLowerCase() === target);
      return match ? match[1] : '';
    };

    return {
      color: read('color'),
      size: read('size')
    };
  }

  function formatAttributeSummary(item) {
    if (item && item.attributeSummary) {
      return item.attributeSummary;
    }

    const pairs = Object.entries(normalizeAttributes(item));
    if (!pairs.length) {
      return 'Standard option';
    }

    return pairs.map(([key, value]) => `${key}: ${value}`).join(' | ');
  }

  function getItemVariantKey(item) {
    return item && item.variantKey ? item.variantKey : buildVariantKey(normalizeAttributes(item));
  }

  function normalizeText(value) {
    return String(value || '').trim();
  }

  function normalizeAvailability(value, quantity = 0) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized) {
      return normalized;
    }

    return Number(quantity || 0) > 0 ? 'in_stock' : 'out_of_stock';
  }

  function getItemStockLimit(item) {
    const candidates = [
      item?.availableStock,
      item?.available,
      item?.stock,
      item?.inventorySnapshot?.available,
      item?.inventory?.available,
      item?.inventory?.quantity
    ];

    for (const candidate of candidates) {
      const quantity = Number(candidate);
      if (Number.isFinite(quantity) && quantity >= 0) {
        return quantity;
      }
    }

    return Number.POSITIVE_INFINITY;
  }

  function clampQuantity(quantity, max = MAX_QTY_PER_LINE) {
    return Math.min(Math.max(1, Number(quantity) || 1), Math.max(1, Number(max) || MAX_QTY_PER_LINE));
  }

  function buildCartLine(item) {
    const attributes = normalizeAttributes(item);
    const legacy = getLegacyFields(attributes);
    const qty = clampQuantity(item?.qty || 1);
    const unitPrice = Number(item?.price || 0) || 0;
    const variantKey = normalizeText(item?.variantKey) || buildVariantKey(attributes);
    const imageUrl = normalizeText(item?.img || item?.image || item?.imageUrl || item?.mainImage || item?.thumbnail);
    const availability = normalizeAvailability(item?.availability || item?.inventorySnapshot?.status, item?.stock || item?.available);
    const stockLimit = getItemStockLimit(item);
    const quantity = Number.isFinite(stockLimit) ? Math.min(qty, Math.max(0, stockLimit)) : qty;

    return {
      id: normalizeText(item?.id || item?.productId || getIdFromPage()) || getIdFromPage(),
      productId: normalizeText(item?.productId || item?.id || getIdFromPage()),
      name: normalizeText(item?.name) || 'Item',
      price: unitPrice,
      img: imageUrl,
      image: imageUrl,
      imageUrl,
      color: legacy.color || normalizeText(item?.color),
      size: legacy.size || normalizeText(item?.size),
      attributes,
      attributeSummary: normalizeText(item?.attributeSummary) || formatAttributeSummary({ attributes }),
      variantKey,
      variantType: normalizeText(item?.variantType || item?.variantSelection?.type) || (Object.keys(attributes).length ? 'variant' : 'simple'),
      variantSelection: item?.variantSelection && typeof item.variantSelection === 'object'
        ? {
            key: normalizeText(item.variantSelection.key || variantKey),
            type: normalizeText(item.variantSelection.type) || (Object.keys(attributes).length ? 'variant' : 'simple'),
            attributes: normalizeAttributes({ attributes: item.variantSelection.attributes || {} }),
            attributeSummary: normalizeText(item.variantSelection.attributeSummary) || formatAttributeSummary({ attributes }),
            color: normalizeText(item.variantSelection.color || legacy.color),
            size: normalizeText(item.variantSelection.size || legacy.size)
          }
        : {
            key: variantKey,
            type: Object.keys(attributes).length ? 'variant' : 'simple',
            attributes,
            attributeSummary: formatAttributeSummary({ attributes }),
            color: legacy.color,
            size: legacy.size
          },
      sku: normalizeText(item?.sku || item?.inventorySnapshot?.sku),
      availability,
      availableStock: Number.isFinite(stockLimit) ? Math.max(0, stockLimit) : null,
      lowStockThreshold: Number(item?.lowStockThreshold || item?.inventorySnapshot?.lowStockThreshold || 5) || 5,
      inventorySnapshot: item?.inventorySnapshot && typeof item.inventorySnapshot === 'object'
        ? {
            sku: normalizeText(item.inventorySnapshot.sku || item.sku),
            status: normalizeAvailability(item.inventorySnapshot.status || availability, item.inventorySnapshot.available),
            available: Number(item.inventorySnapshot.available || item.availableStock || 0) || 0,
            lowStockThreshold: Number(item.inventorySnapshot.lowStockThreshold || item.lowStockThreshold || 5) || 5
          }
        : null,
      qty: Math.max(1, quantity || qty),
      total: unitPrice * Math.max(1, quantity || qty)
    };
  }

  function createQuantityValidationResult(lineItem, requestedQty) {
    const stockLimit = getItemStockLimit(lineItem);
    const hardCap = Math.min(MAX_QTY_PER_LINE, Number.isFinite(stockLimit) ? Math.max(0, stockLimit) : MAX_QTY_PER_LINE);
    const requested = clampQuantity(requestedQty, MAX_QTY_PER_LINE);
    const accepted = hardCap > 0 ? Math.min(requested, hardCap) : 0;

    return {
      requested,
      accepted,
      isOutOfStock: hardCap === 0,
      limitedByStock: Number.isFinite(stockLimit) && requested > accepted,
      maxAllowed: hardCap
    };
  }

  function resolveAttributesArg(attributesOrColor, size) {
    if (attributesOrColor && typeof attributesOrColor === 'object' && !Array.isArray(attributesOrColor)) {
      return Object.fromEntries(
        Object.entries(attributesOrColor).filter(([, value]) => value !== undefined && value !== null && value !== '')
      );
    }

    const attributes = {};
    if (attributesOrColor) attributes.Color = attributesOrColor;
    if (size) attributes.Size = size;
    return attributes;
  }

  function load() {
    migrateOldKey();
    try {
      const raw = safeGetStorage(KEY) || '';
      if (cartCache && raw === cartCacheRaw) {
        return cartCache.map((item) => ({ ...item, attributes: { ...(item.attributes || {}) } }));
      }

      const cart = JSON.parse(raw || '[]') || [];
      const normalizedCart = cart.map((item) => buildCartLine(item));
      cartCache = normalizedCart.map((item) => ({ ...item, attributes: { ...(item.attributes || {}) } }));
      cartCacheRaw = raw;
      return normalizedCart;
    } catch {
      return [];
    }
  }

  function save(cart) {
    const serialized = JSON.stringify(Array.isArray(cart) ? cart : []);
    if (!safeSetStorage(KEY, serialized)) {
      return false;
    }

    cartCache = Array.isArray(cart) ? cart.map((item) => ({ ...item, attributes: { ...(item.attributes || {}) } })) : [];
    cartCacheRaw = serialized;

    try {
      window.ByoseStorefrontSync?.syncStorageKey?.(KEY, cart);
    } catch (error) {
      console.warn('Cart sync provider failed; local cart state was preserved.', error);
    }

    return true;
  }

  function count(cart) {
    return cart.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  }

  function total(cart) {
    return cart.reduce((sum, item) => sum + (item.total || (item.price * item.qty)), 0);
  }

  function emitCartEvents() {
    if (window.dispatchEvent) {
      window.dispatchEvent(new Event('kcart:updated'));
      window.dispatchEvent(new Event('cart:updated'));
    }
  }

  function openWhatsAppOrder(customMessage = '') {
    const cart = load();
    if (cart.length === 0) {
      alert('Your cart is empty. Add items before ordering via WhatsApp.');
      return;
    }

    let message = 'Hello! 👋\n\nI would like to place an order for the following items:\n\n';

    cart.forEach((item, index) => {
      const subtotal = item.price * item.qty;
      message += `${index + 1}. *${item.name}*\n`;
      Object.entries(normalizeAttributes(item)).forEach(([key, value]) => {
        message += `   ${key}: ${value}\n`;
      });
      message += `   Price: RWF ${item.price.toLocaleString('en-US')}\n`;
      message += `   Quantity: ${item.qty}\n`;
      message += `   Subtotal: RWF ${subtotal.toLocaleString('en-US')}\n`;
      if (item.img) message += `   Image: ${item.img}\n`;
      message += '\n';
    });

    const cartTotal = total(cart);
    message += `*TOTAL: RWF ${cartTotal.toLocaleString('en-US')}*\n\n`;
    message += 'Please confirm availability and delivery details.\n';

    if (customMessage.trim()) {
      message += `\nAdditional notes: ${customMessage}\n`;
    }

    const phoneNumber = '250723137250';
    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodedMessage}`;
    window.open(whatsappUrl, '_blank');
  }

  function getIdFromPage() {
    const path = (location.pathname || '').toLowerCase();
    const match = path.match(/product(\d*)-details\.html/);
    if (match) {
      return match[1] ? `product${match[1]}` : 'product';
    }

    const base = path.split('/').pop() || 'page';
    return base.replace(/\.html?$/, '').replace(/[^a-z0-9]+/g, '_');
  }

  function add(item) {
    const cart = load();
    const normalizedLine = buildCartLine(item || {});
    const attributes = normalizedLine.attributes;
    const variantKey = normalizedLine.variantKey;
    const existing = cart.find(entry => String(entry.id) === String(normalizedLine.id) && getItemVariantKey(entry) === variantKey);

    if (existing) {
      const quantityCheck = createQuantityValidationResult(existing, Number(existing.qty || 0) + Number(normalizedLine.qty || 1));
      if (quantityCheck.isOutOfStock) {
        window.dispatchEvent(new CustomEvent('byose:cart-validation-warning', {
          detail: {
            reason: 'out_of_stock',
            item: existing
          }
        }));
        return;
      }

      existing.qty = quantityCheck.accepted;
      existing.total = existing.price * existing.qty;
      if (normalizedLine.img) existing.img = normalizedLine.img;
      if (normalizedLine.image) existing.image = normalizedLine.image;
      existing.attributes = attributes;
      existing.attributeSummary = normalizedLine.attributeSummary || formatAttributeSummary({ attributes });
      existing.variantKey = variantKey;
      existing.color = normalizedLine.color || existing.color || '';
      existing.size = normalizedLine.size || existing.size || '';
      existing.sku = normalizedLine.sku || existing.sku || '';
      existing.availability = normalizedLine.availability || existing.availability || 'in_stock';
      existing.availableStock = normalizedLine.availableStock;
      existing.inventorySnapshot = normalizedLine.inventorySnapshot || existing.inventorySnapshot || null;
    } else {
      const quantityCheck = createQuantityValidationResult(normalizedLine, normalizedLine.qty || 1);
      if (quantityCheck.isOutOfStock) {
        window.dispatchEvent(new CustomEvent('byose:cart-validation-warning', {
          detail: {
            reason: 'out_of_stock',
            item: normalizedLine
          }
        }));
        return;
      }

      cart.push({
        ...normalizedLine,
        qty: quantityCheck.accepted,
        total: (Number(normalizedLine.price) || 0) * quantityCheck.accepted
      });
    }

    if (!save(cart)) {
      alert('Unable to update your cart right now. Please check storage permissions and try again.');
      return;
    }

    renderCount();
    emitCartEvents();
  }

  function remove(id, attributesOrColor, size) {
    const variantKey = buildVariantKey(resolveAttributesArg(attributesOrColor, size));
    const cart = load().filter(item => !(String(item.id) === String(id) && getItemVariantKey(item) === variantKey));
    if (!save(cart)) {
      alert('Unable to update your cart right now. Please check storage permissions and try again.');
      return;
    }

    render();
    renderCount();
    emitCartEvents();
  }

  function updateQty(id, attributesOrColor, size, qty) {
    const variantKey = buildVariantKey(resolveAttributesArg(attributesOrColor, size));
    const cart = load();
    const item = cart.find(entry => String(entry.id) === String(id) && getItemVariantKey(entry) === variantKey);
    if (!item) return;

    const desiredQuantity = Math.max(0, Number(qty) || 0);
    const quantityCheck = createQuantityValidationResult(item, desiredQuantity);
    if (quantityCheck.isOutOfStock && desiredQuantity > 0) {
      window.dispatchEvent(new CustomEvent('byose:cart-validation-warning', {
        detail: {
          reason: 'out_of_stock',
          item
        }
      }));
      return;
    }

    item.qty = desiredQuantity > 0 ? quantityCheck.accepted : 0;
    item.total = item.price * item.qty;
    if (item.qty === 0) {
      save(cart.filter(entry => !(String(entry.id) === String(id) && getItemVariantKey(entry) === variantKey)));
    } else {
      save(cart);
    }

    render();
    renderCount();
    emitCartEvents();
  }

  function clear() {
    save([]);
    render();
    renderCount();
    emitCartEvents();
  }

  function ensureUI() {
    if (document.getElementById('cartBtn') || location.pathname.toLowerCase().endsWith('cart.html')) {
      return;
    }

    if ($('.kcart-icon')) return;

    const icon = document.createElement('button');
    icon.className = 'kcart-icon';
    icon.setAttribute('aria-label', 'Open cart');
    icon.innerHTML = '🛒 <span class="kcart-badge">0</span>';
    icon.addEventListener('click', open);
    document.body.appendChild(icon);

    const overlay = document.createElement('div');
    overlay.className = 'kcart-overlay';
    overlay.addEventListener('click', close);
    document.body.appendChild(overlay);

    const panel = document.createElement('aside');
    panel.className = 'kcart-panel';
    panel.innerHTML = `
      <div class="kcart-header">
        <span>My Cart</span>
        <button class="kcart-close" aria-label="Close cart">✕</button>
      </div>
      <div class="kcart-body"></div>
      <div class="kcart-footer">
        <div class="kcart-row"><span>Subtotal</span><strong class="kcart-subtotal">RWF 0</strong></div>
        <button class="kcart-checkout">Checkout</button>
      </div>
    `;
    document.body.appendChild(panel);

    $('.kcart-close', panel).addEventListener('click', close);
    $('.kcart-checkout', panel).addEventListener('click', () => {
      window.location.href = (window.KCart && KCart.checkoutUrl) || 'orders/shipping.html';
    });
  }

  function formatRWF(value) {
    return 'RWF ' + (Number(value) || 0).toLocaleString('en-US');
  }

  function render() {
    ensureUI();
    const cart = load();
    const body = $('.kcart-body');
    if (!body) {
      return;
    }

    body.innerHTML = '';
    if (cart.length === 0) {
      body.innerHTML = '<p style="padding:16px;color:#6b7280;">Your cart is empty.</p>';
    } else {
      cart.forEach(item => {
        const row = document.createElement('div');
        row.className = 'kcart-item';
        row.innerHTML = `
          <img src="${item.img || ''}" alt="">
          <div>
            <div class="kcart-name">${item.name || 'Item'}</div>
            <div class="kcart-options">${formatAttributeSummary(item)}</div>
            <div class="kcart-price">${formatRWF(item.price)}</div>
            <div class="kcart-actions">
              <div class="kcart-qty">
                <button data-act="dec" aria-label="Decrease">−</button>
                <input type="number" min="0" value="${item.qty}" aria-label="Quantity">
                <button data-act="inc" aria-label="Increase">+</button>
              </div>
              <button class="kcart-remove" title="Remove">🗑</button>
            </div>
          </div>
          <div style="align-self:start;font-weight:700;">${formatRWF(item.total || (item.price * item.qty))}</div>
        `;

        const input = $('input', row);
        $('button[data-act="dec"]', row).addEventListener('click', () => updateQty(item.id, item.attributes || {}, undefined, Number(input.value) - 1));
        $('button[data-act="inc"]', row).addEventListener('click', () => updateQty(item.id, item.attributes || {}, undefined, Number(input.value) + 1));
        input.addEventListener('change', event => updateQty(item.id, item.attributes || {}, undefined, event.target.value));
        $('.kcart-remove', row).addEventListener('click', () => remove(item.id, item.attributes || {}, undefined));
        body.appendChild(row);
      });
    }

    $('.kcart-subtotal').textContent = formatRWF(total(cart));
  }

  function renderCount() {
    ensureUI();
    const value = count(load());
    const badge = $('.kcart-badge');
    if (badge) badge.textContent = value;

    const headerBadge = document.getElementById('cartBadge');
    if (headerBadge) {
      headerBadge.textContent = value;
      headerBadge.style.display = value > 0 ? 'flex' : 'none';
    }
  }

  function open() {
    ensureUI();
    render();
    const overlay = $('.kcart-overlay');
    overlay.classList.add('kcart-open');
  }

  function close() {
    const overlay = $('.kcart-overlay');
    if (overlay) overlay.classList.remove('kcart-open');
  }

  function bindAddToCart() {
    document.addEventListener('click', event => {
      const button = event.target.closest('.add-to-cart');
      const quickAddButton = event.target.closest('.byose-product-quick-add');
      const targetButton = button || quickAddButton;
      if (!targetButton) return;

      event.preventDefault();
      event.stopPropagation();

      const id = targetButton.dataset.id || getIdFromPage();
      const name = targetButton.dataset.name || targetButton.getAttribute('data-name') || (document.querySelector('h1,h2')?.textContent || 'Item');
      const price = Number(targetButton.dataset.price || targetButton.getAttribute('data-price') || 0);
      const img = targetButton.dataset.img || targetButton.dataset.image || (document.querySelector('img')?.getAttribute('src') || '');
      const sku = targetButton.dataset.sku || '';
      const stock = Number(targetButton.dataset.stock || targetButton.dataset.available || 0);
      const availability = targetButton.dataset.availability || '';
      add({ id, productId: id, name, price, img, image: img, sku, stock, availability, qty: 1 });
      targetButton.disabled = true;
      setTimeout(() => {
        targetButton.disabled = false;
      }, 450);
    });
  }

  async function hydrateFromServer() {
    try {
      const hydrated = await window.ByoseStorefrontSync?.hydrate?.();
      if (hydrated) {
        cartCache = null;
        cartCacheRaw = '';
        render();
        renderCount();
        emitCartEvents();
      }
    } catch (error) {
      console.warn('Cart hydrate failed; centralized cart state could not be refreshed.', error);
    }
  }

  async function init() {
    ensureUI();
    renderCount();
    bindAddToCart();
    document.addEventListener('cart:updated', renderCount);
    window.addEventListener('byose:storefront-state-updated', (event) => {
      if (!event.detail?.changedFields?.includes('cartItems')) {
        return;
      }

      cartCache = null;
      cartCacheRaw = '';
      renderCount();
      if ($('.kcart-overlay')?.classList.contains('kcart-open')) {
        render();
      }
    });
    await hydrateFromServer();
  }

  document.addEventListener('DOMContentLoaded', () => {
    void init();
  });

  window.KCart = {
    add,
    addMany: (items = []) => {
      (Array.isArray(items) ? items : []).forEach((entry) => add(entry));
      renderCount();
      emitCartEvents();
    },
    remove,
    updateQty,
    clear,
    open,
    render,
    renderCount,
    getSummary: () => {
      const cart = load();
      return {
        items: cart.length,
        quantity: count(cart),
        subtotal: total(cart)
      };
    },
    mergeGuestCart: (guestItems = []) => {
      const incoming = Array.isArray(guestItems) ? guestItems : [];
      incoming.forEach((item) => add(item));
      return load();
    },
    syncNow: async () => {
      try {
        await window.ByoseStorefrontSync?.syncPatch?.({ cartItems: load() });
        window.dispatchEvent(new CustomEvent('byose:cart-sync-status', {
          detail: {
            success: true,
            source: 'manual'
          }
        }));
      } catch (error) {
        window.dispatchEvent(new CustomEvent('byose:cart-sync-status', {
          detail: {
            success: false,
            source: 'manual',
            message: String(error?.message || 'Cart sync failed')
          }
        }));
      }
    },
    openWhatsAppOrder,
    checkoutUrl: 'orders/shipping.html',
    load
  };

  window.addToCart = add;
})();