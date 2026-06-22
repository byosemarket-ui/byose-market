/* ========================================
   CART MANAGEMENT SYSTEM - Central Logic
   ======================================== */

const Cart = {
  STORAGE_KEY: 'byose_market_cart_v1',
  SHIPPING_COST: 5000,
  MAX_QTY_PER_LINE: 99,

  init() {
    this.render();
    this.setupEventListeners();
    this.updateBadge();
    window.addEventListener('cart:updated', () => this.render());
    window.addEventListener('byose:storefront-state-updated', () => {
      this.updateBadge();
      this.render();
    });
  },

  setupEventListeners() {
    const cartBtn = document.getElementById('cartBtn');
    const cartClose = document.getElementById('cartClose');
    const cartOverlay = document.getElementById('cartOverlay');
    const checkoutBtn = document.getElementById('checkoutBtn');

    if (cartBtn) cartBtn.addEventListener('click', () => this.openCart());
    if (cartClose) cartClose.addEventListener('click', () => this.closeCart());
    if (cartOverlay) cartOverlay.addEventListener('click', () => this.closeCart());
    if (checkoutBtn) checkoutBtn.addEventListener('click', () => this.checkout());

    window.addEventListener('addToCart', event => {
      this.addItem(event.detail);
    });
  },

  getCart() {
    const cart = Util.getFromStorage(this.STORAGE_KEY, []);
    return cart.map(item => this.normalizeItem(item));
  },

  saveCart(cart) {
    Util.setToStorage(this.STORAGE_KEY, cart);
    if (window.dispatchEvent) {
      window.dispatchEvent(new Event('cart:updated'));
      window.dispatchEvent(new Event('kcart:updated'));
    }
  },

  normalizeAttributes(item) {
    if (item && item.attributes && typeof item.attributes === 'object' && !Array.isArray(item.attributes)) {
      return Object.fromEntries(
        Object.entries(item.attributes).filter(([, value]) => value !== undefined && value !== null && value !== '')
      );
    }

    const attributes = {};
    if (item?.color) attributes.Color = item.color;
    if (item?.size) attributes.Size = item.size;
    return attributes;
  },

  buildVariantKey(attributes) {
    return Object.entries(attributes || {})
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
      .map(([key, value]) => `${key}:${value}`)
      .join('|');
  },

  getLegacyFields(attributes) {
    const entries = Object.entries(attributes || {});
    const read = target => entries.find(([key]) => String(key).toLowerCase() === target)?.[1] || '';
    return {
      color: read('color'),
      size: read('size')
    };
  },

  formatAttributeSummary(item) {
    if (item?.attributeSummary) {
      return item.attributeSummary;
    }

    const attributes = this.normalizeAttributes(item);
    const pairs = Object.entries(attributes);
    if (!pairs.length) {
      return 'Standard option';
    }

    return pairs.map(([key, value]) => `${key}: ${value}`).join(' | ');
  },

  normalizeItem(item) {
    const attributes = this.normalizeAttributes(item);
    const legacy = this.getLegacyFields(attributes);
    const stockLimit = this.getStockLimit(item);
    const qty = this.clampQuantity(item.qty, stockLimit);
    const availability = this.normalizeAvailability(item.availability || item.inventorySnapshot?.status, stockLimit);
    return {
      ...item,
      id: String(item.id),
      productId: String(item.productId || item.id),
      image: item.image || item.img || '',
      attributes,
      attributeSummary: item.attributeSummary || this.formatAttributeSummary({ attributes }),
      variantKey: item.variantKey || this.buildVariantKey(attributes),
      variantType: item.variantType || (Object.keys(attributes).length ? 'variant' : 'simple'),
      variantSelection: item.variantSelection && typeof item.variantSelection === 'object'
        ? {
            key: item.variantSelection.key || item.variantKey || this.buildVariantKey(attributes),
            type: item.variantSelection.type || (Object.keys(attributes).length ? 'variant' : 'simple'),
            attributes: this.normalizeAttributes({ attributes: item.variantSelection.attributes || {} }),
            attributeSummary: item.variantSelection.attributeSummary || this.formatAttributeSummary({ attributes }),
            color: item.variantSelection.color || legacy.color || '',
            colorId: item.variantSelection.colorId || item.colorId || '',
            colorImage: item.variantSelection.colorImage || item.colorImage || '',
            size: item.variantSelection.size || legacy.size || '',
            sizeValue: item.variantSelection.sizeValue || item.sizeValue || ''
          }
        : {
            key: item.variantKey || this.buildVariantKey(attributes),
            type: Object.keys(attributes).length ? 'variant' : 'simple',
            attributes,
            attributeSummary: this.formatAttributeSummary({ attributes }),
            color: legacy.color || '',
            colorId: item.colorId || '',
            colorImage: item.colorImage || '',
            size: legacy.size || '',
            sizeValue: item.sizeValue || ''
          },
      color: item.color || legacy.color || '',
      size: item.size || legacy.size || '',
      colorName: item.colorName || item.color || legacy.color || '',
      colorId: item.colorId || item.variantSelection?.colorId || '',
      colorImage: item.colorImage || item.variantSelection?.colorImage || '',
      sizeLabel: item.sizeLabel || item.size || legacy.size || '',
      sizeValue: item.sizeValue || item.variantSelection?.sizeValue || '',
      sku: item.sku || item.variantSku || item.inventorySnapshot?.sku || '',
      variantSku: item.variantSku || item.sku || item.inventorySnapshot?.sku || '',
      availability,
      availableStock: Number.isFinite(stockLimit) ? Math.max(0, stockLimit) : null,
      lowStockThreshold: Number(item.lowStockThreshold || item.inventorySnapshot?.lowStockThreshold || 5) || 5,
      inventorySnapshot: item.inventorySnapshot && typeof item.inventorySnapshot === 'object'
        ? {
            sku: item.inventorySnapshot.sku || item.sku || '',
            status: this.normalizeAvailability(item.inventorySnapshot.status || availability, item.inventorySnapshot.available),
            available: Number(item.inventorySnapshot.available || stockLimit || 0) || 0,
            lowStockThreshold: Number(item.inventorySnapshot.lowStockThreshold || item.lowStockThreshold || 5) || 5
          }
        : null,
      qty,
      total: item.total || ((Number(item.price) || 0) * qty)
    };
  },

  normalizeAvailability(value, stockLimit) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized) {
      return normalized;
    }

    if (Number.isFinite(stockLimit)) {
      return stockLimit > 0 ? 'in_stock' : 'out_of_stock';
    }

    return 'in_stock';
  },

  getStockLimit(item) {
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
  },

  clampQuantity(quantity, max = this.MAX_QTY_PER_LINE) {
    const limit = Number(max);
    const hardCap = Number.isFinite(limit) ? Math.max(0, limit) : this.MAX_QTY_PER_LINE;
    const parsed = Math.max(1, parseInt(quantity, 10) || 1);
    if (hardCap === 0) {
      return 0;
    }
    return Math.min(parsed, Math.max(1, hardCap));
  },

  resolveAttributesArg(attributesOrColor, size) {
    if (attributesOrColor && typeof attributesOrColor === 'object' && !Array.isArray(attributesOrColor)) {
      return Object.fromEntries(
        Object.entries(attributesOrColor).filter(([, value]) => value !== undefined && value !== null && value !== '')
      );
    }

    const attributes = {};
    if (attributesOrColor) attributes.Color = attributesOrColor;
    if (size) attributes.Size = size;
    return attributes;
  },

  addItem(product) {
    if (!product.id || !product.name || product.price === undefined) {
      console.error('Invalid product object:', product);
      return false;
    }

    const cart = this.getCart();
    const normalizedProduct = this.normalizeItem(product);
    const existingItem = cart.find(item => (
      String(item.id) === String(normalizedProduct.id)
      && item.variantKey === normalizedProduct.variantKey
    ));

    if (existingItem) {
      const stockLimit = this.getStockLimit(existingItem);
      const requestedQty = Number(existingItem.qty || 0) + Number(normalizedProduct.qty || 1);
      const acceptedQty = this.clampQuantity(requestedQty, Math.min(this.MAX_QTY_PER_LINE, stockLimit));

      if (acceptedQty === 0) {
        Util.showWarning('This item is out of stock.');
        return false;
      }

      existingItem.qty = acceptedQty;
      existingItem.total = existingItem.price * existingItem.qty;
      existingItem.availability = normalizedProduct.availability || existingItem.availability || 'in_stock';
      existingItem.availableStock = Number.isFinite(stockLimit) ? stockLimit : existingItem.availableStock;
      existingItem.sku = normalizedProduct.sku || existingItem.sku || '';
      existingItem.variantSelection = normalizedProduct.variantSelection || existingItem.variantSelection || null;
      if (Number.isFinite(stockLimit) && requestedQty > acceptedQty) {
        Util.showInfo(`Quantity capped at ${acceptedQty} based on current availability.`);
      }
    } else {
      const stockLimit = this.getStockLimit(normalizedProduct);
      const acceptedQty = this.clampQuantity(normalizedProduct.qty || 1, Math.min(this.MAX_QTY_PER_LINE, stockLimit));
      if (acceptedQty === 0) {
        Util.showWarning('This item is currently out of stock.');
        return false;
      }

      normalizedProduct.qty = acceptedQty;
      normalizedProduct.total = normalizedProduct.price * acceptedQty;
      cart.push(normalizedProduct);
    }

    this.saveCart(cart);
    Util.showSuccess(`${product.name} added to cart!`);
    return true;
  },

  removeItem(productId, attributesOrColor, size) {
    const variantKey = this.buildVariantKey(this.resolveAttributesArg(attributesOrColor, size));
    const cart = this.getCart().filter(item => !(String(item.id) === String(productId) && item.variantKey === variantKey));
    this.saveCart(cart);
    Util.showInfo('Item removed from cart');
    return true;
  },

  updateQty(productId, attributesOrColor, size, quantity) {
    const variantKey = this.buildVariantKey(this.resolveAttributesArg(attributesOrColor, size));
    const cart = this.getCart();
    const item = cart.find(entry => String(entry.id) === String(productId) && entry.variantKey === variantKey);

    if (!item) return false;

    const stockLimit = this.getStockLimit(item);
    const nextQuantity = Math.max(0, parseInt(quantity, 10) || 0);
    if (nextQuantity === 0) {
      this.removeItem(productId, attributesOrColor, size);
    } else {
      const acceptedQty = this.clampQuantity(nextQuantity, Math.min(this.MAX_QTY_PER_LINE, stockLimit));
      if (acceptedQty === 0) {
        this.removeItem(productId, attributesOrColor, size);
        return true;
      }

      item.qty = acceptedQty;
      item.total = item.price * item.qty;
      this.saveCart(cart);
      if (acceptedQty !== nextQuantity) {
        Util.showInfo(`Quantity adjusted to ${acceptedQty} based on stock limits.`);
      }
    }

    return true;
  },

  clear() {
    if (confirm('Are you sure you want to clear your cart?')) {
      this.saveCart([]);
      Util.showInfo('Cart cleared');
      return true;
    }
    return false;
  },

  getSummary() {
    const cart = this.getCart();
    const subtotal = cart.reduce((sum, item) => sum + (item.total || (item.price * item.qty)), 0);
    const shipping = cart.length > 0 ? this.SHIPPING_COST : 0;
    return {
      items: cart.length,
      quantity: cart.reduce((sum, item) => sum + item.qty, 0),
      subtotal,
      shipping,
      total: subtotal + shipping
    };
  },

  updateBadge() {
    const badge = document.getElementById('cartBadge');
    if (!badge) return;

    const summary = this.getSummary();
    badge.textContent = summary.quantity;
    badge.style.display = summary.quantity > 0 ? 'flex' : 'none';
  },

  openCart() {
    const sidebar = document.getElementById('cartSidebar');
    const overlay = document.getElementById('cartOverlay');
    if (sidebar) sidebar.classList.add('active');
    if (overlay) overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  },

  closeCart() {
    const sidebar = document.getElementById('cartSidebar');
    const overlay = document.getElementById('cartOverlay');
    if (sidebar) sidebar.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
    document.body.style.overflow = '';
  },

  render() {
    const cart = this.getCart();
    const summary = this.getSummary();
    const cartBody = document.getElementById('cartBody');
    const cartFooter = document.getElementById('cartFooter');

    if (!cartBody) return;

    if (cart.length === 0) {
      cartBody.innerHTML = `
        <div class="cart-empty">
          <i class="fas fa-shopping-bag"></i>
          <p>Your cart is empty</p>
          <a href="shop.html" class="btn btn-primary">Start Shopping</a>
        </div>
      `;
      if (cartFooter) cartFooter.style.display = 'none';
      this.updateBadge();
      return;
    }

    cartBody.innerHTML = cart.map(item => `
      <div class="cart-item" data-product-id="${item.id}" data-variant-key="${item.variantKey}">
        <img src="${item.colorImage || item.image}" alt="${item.name}" class="cart-item-image">
        <div class="cart-item-info">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-options" style="font-size: 12px; color: #666; margin: 4px 0;">
            ${item.colorName || item.color ? `Color: ${item.colorName || item.color}` : ''}${(item.colorName || item.color) && (item.sizeLabel || item.size) ? ' · ' : ''}${item.sizeLabel || item.size ? `Size: ${item.sizeLabel || item.size}` : (item.attributeSummary || '')}
          </div>
          <div class="cart-item-price">${Util.formatPrice(item.price)}</div>
          <div class="cart-item-controls">
            <div class="qty-control">
              <button class="qty-decrease" data-product-id="${item.id}" data-variant-key="${item.variantKey}">−</button>
              <input type="number" class="qty-input" value="${item.qty}" data-product-id="${item.id}" data-variant-key="${item.variantKey}" min="1">
              <button class="qty-increase" data-product-id="${item.id}" data-variant-key="${item.variantKey}">+</button>
            </div>
            <button class="cart-remove-btn" data-product-id="${item.id}" data-variant-key="${item.variantKey}" title="Remove">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
        <div class="cart-item-subtotal">${Util.formatPrice(item.total || (item.price * item.qty))}</div>
      </div>
    `).join('');

    this.setupQuantityControls();

    if (cartFooter) {
      cartFooter.style.display = 'block';
      cartFooter.innerHTML = `
        <div class="cart-summary">
          <div class="summary-row">
            <span>Subtotal:</span>
            <span id="cartSubtotal">${Util.formatPrice(summary.subtotal)}</span>
          </div>
          <div class="summary-row">
            <span>Shipping:</span>
            <span id="cartShipping">${Util.formatPrice(summary.shipping)}</span>
          </div>
          <div class="summary-row total">
            <span>Total:</span>
            <span id="cartTotal">${Util.formatPrice(summary.total)}</span>
          </div>
        </div>
        <button class="btn btn-primary btn-lg" id="checkoutBtn">Proceed to Checkout</button>
        <a href="cart.html" class="btn btn-outline btn-lg" style="display: block; text-align: center; margin-top: 8px;">View Cart</a>
      `;

      const checkoutBtn = cartFooter.querySelector('#checkoutBtn');
      if (checkoutBtn) {
        checkoutBtn.addEventListener('click', () => this.checkout());
      }
    }

    this.updateBadge();
  },

  setupQuantityControls() {
    const decreaseButtons = document.querySelectorAll('.qty-decrease');
    const increaseButtons = document.querySelectorAll('.qty-increase');
    const quantityInputs = document.querySelectorAll('.qty-input');
    const removeButtons = document.querySelectorAll('.cart-remove-btn');

    decreaseButtons.forEach(btn => {
      btn.addEventListener('click', event => {
        const productId = event.target.dataset.productId;
        const variantKey = event.target.dataset.variantKey;
        const input = document.querySelector(`.qty-input[data-product-id="${productId}"][data-variant-key="${variantKey}"]`);
        const currentQty = parseInt(input.value, 10);
        if (currentQty > 1) {
          this.updateQty(productId, this.getCart().find(item => item.variantKey === variantKey)?.attributes || {}, undefined, currentQty - 1);
        }
      });
    });

    increaseButtons.forEach(btn => {
      btn.addEventListener('click', event => {
        const productId = event.target.dataset.productId;
        const variantKey = event.target.dataset.variantKey;
        const input = document.querySelector(`.qty-input[data-product-id="${productId}"][data-variant-key="${variantKey}"]`);
        const currentQty = parseInt(input.value, 10);
        this.updateQty(productId, this.getCart().find(item => item.variantKey === variantKey)?.attributes || {}, undefined, currentQty + 1);
      });
    });

    quantityInputs.forEach(input => {
      input.addEventListener('change', event => {
        const productId = event.target.dataset.productId;
        const variantKey = event.target.dataset.variantKey;
        const qty = parseInt(event.target.value, 10);
        const item = this.getCart().find(entry => entry.variantKey === variantKey);
        if (!item) return;
        if (qty > 0) {
          this.updateQty(productId, item.attributes || {}, undefined, qty);
        } else {
          this.removeItem(productId, item.attributes || {}, undefined);
        }
      });
    });

    removeButtons.forEach(btn => {
      btn.addEventListener('click', event => {
        const button = event.target.closest('.cart-remove-btn');
        const productId = button.dataset.productId;
        const variantKey = button.dataset.variantKey;
        const item = this.getCart().find(entry => entry.variantKey === variantKey);
        if (!item) return;
        this.removeItem(productId, item.attributes || {}, undefined);
      });
    });
  },

  checkout() {
    const summary = this.getSummary();
    if (summary.items === 0) {
      Util.showWarning('Your cart is empty!');
      return;
    }
    window.location.href = 'orders/shipping.html';
  },

  getItemCount() {
    return this.getCart().reduce((sum, item) => sum + item.qty, 0);
  },

  getItems() {
    return this.getCart();
  },

  hasItem(productId) {
    return this.getCart().some(item => String(item.id) === String(productId));
  },

  exportForOrder() {
    const cart = this.getCart();
    const summary = this.getSummary();
    return {
      items: cart,
      itemCount: summary.items,
      quantity: summary.quantity,
      subtotal: summary.subtotal,
      shipping: summary.shipping,
      total: summary.total,
      timestamp: new Date().toISOString()
    };
  },

  addMany(items = []) {
    (Array.isArray(items) ? items : []).forEach(item => this.addItem(item));
    this.render();
    this.updateBadge();
  },

  mergeGuestCart(items = []) {
    this.addMany(items);
    return this.getCart();
  },

  async syncNow() {
    try {
      await window.ByoseStorefrontSync?.syncPatch?.({ cartItems: this.getCart() });
      window.dispatchEvent(new CustomEvent('byose:cart-sync-status', {
        detail: { success: true, source: 'legacy-cart-adapter' }
      }));
      return true;
    } catch (error) {
      window.dispatchEvent(new CustomEvent('byose:cart-sync-status', {
        detail: {
          success: false,
          source: 'legacy-cart-adapter',
          message: String(error?.message || 'Cart sync failed')
        }
      }));
      return false;
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  Cart.init();
});