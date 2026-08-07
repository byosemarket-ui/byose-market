/**
 * BYOSE Market — Unified Cart Service
 * Guest: localStorage | Logged-in: storefront state sync
 */

const CART_KEY = 'byose_market_cart_v1';
const SAVED_KEY = 'byose_market_saved_v1';
const CHECKOUT_KEY = 'byose_checkout_active_v1';
// Delivery is a flat fee per non-empty order. It is intentionally independent
// of item count, quantity, category, weight, and subtotal.
const SHIPPING_FEE = 2000;

function resolveShippingFee() {
  if (typeof window !== 'undefined' && window.ByoseShippingApi?.resolveDefaultFee) {
    return Number(window.ByoseShippingApi.resolveDefaultFee()) || SHIPPING_FEE;
  }
  const delivery = typeof window !== 'undefined' ? window.ByoseStoreSettings?.delivery : null;
  if (delivery?.pricing?.fixedFee != null) {
    return Number(delivery.pricing.fixedFee) || SHIPPING_FEE;
  }
  return SHIPPING_FEE;
}
const TAX_RATE = 0;
const MAX_QTY = 99;

function readRaw(key) {
  try {
    if (window.ByoseStorefrontSync?.isManagedKey?.(key)) {
      const value = window.ByoseStorefrontSync.readStateByKey(key);
      return value === undefined ? null : JSON.stringify(value);
    }
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key, value) {
  try {
    if (window.ByoseStorefrontSync?.isManagedKey?.(key)) {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      return window.ByoseStorefrontSync.writeStateByKey(key, parsed);
    }
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function readJson(key, fallback) {
  try {
    const raw = readRaw(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  writeRaw(key, JSON.stringify(value));
  try {
    window.ByoseStorefrontSync?.syncStorageKey?.(key, value);
  } catch {
    /* ignore */
  }
}

function normalizeAttributes(item) {
  if (item?.attributes && typeof item.attributes === 'object' && !Array.isArray(item.attributes)) {
    return Object.fromEntries(
      Object.entries(item.attributes).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );
  }
  const attrs = {};
  if (item?.color) attrs.Color = item.color;
  if (item?.size) attrs.Size = item.size;
  if (item?.material) attrs.Material = item.material;
  if (item?.storage) attrs.Storage = item.storage;
  return attrs;
}

function buildVariantKey(attributes) {
  return Object.entries(attributes || {})
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([k, v]) => `${k}:${v}`)
    .join('|');
}

function buildLineId(productId, variantKey) {
  return `${String(productId)}::${variantKey || 'default'}`;
}

function formatAttributes(attributes) {
  const pairs = Object.entries(attributes || {});
  if (!pairs.length) return '';
  return pairs.map(([k, v]) => `${k}: ${v}`).join(' · ');
}

function getStockLimit(item) {
  const candidates = [
    item?.availableStock,
    item?.stock,
    item?.inventorySnapshot?.available,
    item?.inventory?.available
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return Number.POSITIVE_INFINITY;
}

function normalizeAvailability(status, stock) {
  const s = String(status || '').trim().toLowerCase();
  if (s) return s;
  if (Number.isFinite(stock) && stock <= 0) return 'out_of_stock';
  if (Number.isFinite(stock) && stock <= 5) return 'low_stock';
  return 'in_stock';
}

function clampQty(qty, max = MAX_QTY) {
  const limit = Number.isFinite(max) ? Math.min(MAX_QTY, max) : MAX_QTY;
  return Math.min(Math.max(1, Number(qty) || 1), Math.max(1, limit));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeLine(item) {
  const attributes = normalizeAttributes(item);
  const variantKey = item.variantKey || buildVariantKey(attributes);
  const productId = String(item.productId || item.id || '');
  const lineId = item.lineId || buildLineId(productId, variantKey);
  const stock = getStockLimit(item);
  const qty = clampQty(item.qty ?? item.quantity ?? 1, stock);
  const price = Number(item.price ?? item.discountPrice ?? 0) || 0;
  const comparePrice = Number(item.comparePrice ?? item.oldPrice ?? 0) || 0;
  const discountPrice = Number(item.discountPrice ?? item.price ?? 0) || 0;
  const productImage = item.productImage || item.mainImage || item.thumbnail || '';
  const colorImage = item.colorImage || item.variantSelection?.colorImage || '';
  const image = item.image || item.img || colorImage || productImage || '';
  const availability = normalizeAvailability(item.availability, stock);
  const colorName = item.colorName || item.variantSelection?.color || item.color || '';
  const sizeLabel = item.sizeLabel || item.variantSelection?.size || item.size || '';
  const attributeSummary = item.attributeSummary
    || [colorName, sizeLabel ? `Size ${sizeLabel}` : ''].filter(Boolean).join(' · ')
    || formatAttributes(attributes);

  return {
    lineId,
    id: productId,
    productId,
    slug: item.slug || '',
    name: item.name || item.productName || 'Product',
    price,
    discountPrice,
    comparePrice: comparePrice > price ? comparePrice : 0,
    oldPrice: comparePrice > price ? comparePrice : 0,
    discountPercent: Number(item.discountPercent || 0) || 0,
    discountAmount: Number(item.discountAmount || 0) || 0,
    qty,
    image,
    img: image,
    colorImage,
    productImage: productImage || image,
    images: Array.isArray(item.images) ? item.images : image ? [image] : [],
    stock: Number.isFinite(stock) ? stock : null,
    availableStock: Number.isFinite(stock) ? stock : null,
    category: item.category || '',
    sku: item.sku || item.variantSku || item.inventorySnapshot?.sku || '',
    variantSku: item.variantSku || item.inventorySnapshot?.sku || item.sku || '',
    color: colorName,
    colorName,
    colorId: item.colorId || item.variantSelection?.colorId || attributes.Color || '',
    size: sizeLabel,
    sizeLabel,
    sizeValue: item.sizeValue || item.variantSelection?.sizeValue || attributes.Size || '',
    attributes,
    attributeSummary,
    variantKey,
    variantType: Object.keys(attributes).length ? 'variant' : 'simple',
    variantSelection: item.variantSelection && typeof item.variantSelection === 'object'
      ? {
          key: item.variantSelection.key || variantKey,
          type: item.variantSelection.type || (Object.keys(attributes).length ? 'variant' : 'simple'),
          attributes: normalizeAttributes({ attributes: item.variantSelection.attributes || attributes }),
          attributeSummary: item.variantSelection.attributeSummary || attributeSummary,
          color: item.variantSelection.color || colorName,
          colorId: item.variantSelection.colorId || item.colorId || '',
          colorImage: item.variantSelection.colorImage || colorImage,
          size: item.variantSelection.size || sizeLabel,
          sizeValue: item.variantSelection.sizeValue || item.sizeValue || ''
        }
      : {
          key: variantKey,
          type: Object.keys(attributes).length ? 'variant' : 'simple',
          attributes,
          attributeSummary,
          color: colorName,
          colorId: item.colorId || '',
          colorImage,
          size: sizeLabel,
          sizeValue: item.sizeValue || ''
        },
    deliveryInfo: item.deliveryInfo || '',
    availability,
    inventorySnapshot: item.inventorySnapshot && typeof item.inventorySnapshot === 'object'
      ? {
          sku: item.inventorySnapshot.sku || item.variantSku || item.sku || '',
          status: normalizeAvailability(item.inventorySnapshot.status || availability, item.inventorySnapshot.available ?? stock),
          available: Number(item.inventorySnapshot.available ?? stock ?? 0) || 0,
          lowStockThreshold: Number(item.inventorySnapshot.lowStockThreshold || 5) || 5
        }
      : null,
    selected: item.selected !== false,
    priceChanged: Boolean(item.priceChanged),
    unavailable: availability === 'out_of_stock' || (Number.isFinite(stock) && stock <= 0),
    variantInvalid: Boolean(item.variantInvalid),
    addedAt: item.addedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    total: price * qty
  };
}

function normalizeSaved(item) {
  const line = normalizeLine({ ...item, qty: 1 });
  return {
    ...line,
    savedAt: item.savedAt || new Date().toISOString()
  };
}

function emitUpdate() {
  window.dispatchEvent(new Event('byose:cart-updated'));
  window.dispatchEvent(new Event('cart:updated'));
  window.dispatchEvent(new Event('kcart:updated'));
}

function syncServer() {
  const patch = { cartItems: readJson(CART_KEY, []) };
  const saved = readJson(SAVED_KEY, []);
  if (saved.length) patch.savedItems = saved;
  return window.ByoseStorefrontSync?.syncPatch?.(patch)?.catch?.(() => false) ?? Promise.resolve(false);
}

const ByoseCart = {
  CART_KEY,
  SAVED_KEY,
  SHIPPING_FEE,

  init() {
    if (this._initialized) return;
    this._initialized = true;
    window.addEventListener('byose:storefront-state-updated', () => emitUpdate());
    if (window.ByoseStorefrontSync?.getToken?.()) {
      window.ByoseStorefrontSync.hydrate?.().catch(() => {});
    }
  },

  getItems() {
    return readJson(CART_KEY, []).map(normalizeLine);
  },

  getSavedItems() {
    return readJson(SAVED_KEY, []).map(normalizeSaved);
  },

  getSelectedItems() {
    return this.getItems().filter((item) => item.selected !== false);
  },

  getCount() {
    return this.getItems().reduce((sum, item) => sum + item.qty, 0);
  },

  saveItems(items) {
    const normalized = items.map(normalizeLine);
    writeJson(CART_KEY, normalized);
    emitUpdate();
    void syncServer();
    return normalized;
  },

  saveSavedItems(items) {
    const normalized = items.map(normalizeSaved);
    writeJson(SAVED_KEY, normalized);
    emitUpdate();
    void syncServer();
    return normalized;
  },

  findLine(lineId) {
    return this.getItems().find((item) => item.lineId === lineId);
  },

  add(rawItem) {
    const incoming = normalizeLine({ ...rawItem, qty: rawItem.qty ?? rawItem.quantity ?? 1 });
    if (incoming.unavailable) {
      throw new Error('This product is out of stock.');
    }

    const items = this.getItems();
    const index = items.findIndex((item) => item.lineId === incoming.lineId);

    if (index >= 0) {
      const existing = items[index];
      const max = getStockLimit(existing);
      const requestedQty = existing.qty + incoming.qty;
      const nextQty = clampQty(requestedQty, max);
      if (nextQty <= existing.qty && incoming.qty > 0) {
        const limitLabel = Number.isFinite(max) ? max : MAX_QTY;
        throw new Error(`Only ${limitLabel} available in stock for this item.`);
      }
      items[index] = normalizeLine({ ...existing, ...incoming, qty: nextQty, selected: true });
    } else {
      items.push({ ...incoming, selected: true });
    }

    return this.saveItems(items);
  },

  addMany(list = []) {
    (Array.isArray(list) ? list : []).forEach((item) => {
      try {
        this.add(item);
      } catch (err) {
        console.warn('[ByoseCart] addMany skipped item:', err.message);
      }
    });
    return this.getItems();
  },

  updateQty(lineId, qty) {
    const items = this.getItems();
    const index = items.findIndex((item) => item.lineId === lineId);
    if (index < 0) return items;

    const item = items[index];
    const max = getStockLimit(item);
    const nextQty = clampQty(qty, max);
    if (nextQty < 1) {
      return this.remove(lineId);
    }
    items[index] = normalizeLine({ ...item, qty: nextQty });
    return this.saveItems(items);
  },

  remove(lineId) {
    return this.saveItems(this.getItems().filter((item) => item.lineId !== lineId));
  },

  toggleSelect(lineId, selected) {
    const items = this.getItems().map((item) =>
      item.lineId === lineId ? { ...item, selected: selected ?? !item.selected } : item
    );
    return this.saveItems(items);
  },

  selectAll(selected = true) {
    return this.saveItems(this.getItems().map((item) => ({ ...item, selected })));
  },

  saveForLater(lineId) {
    const items = this.getItems();
    const index = items.findIndex((item) => item.lineId === lineId);
    if (index < 0) return this.getSavedItems();

    const [line] = items.splice(index, 1);
    const saved = this.getSavedItems();
    const savedIndex = saved.findIndex((item) => item.lineId === lineId);
    const savedLine = normalizeSaved({ ...line, qty: 1, savedAt: new Date().toISOString() });

    if (savedIndex >= 0) {
      saved[savedIndex] = savedLine;
    } else {
      saved.push(savedLine);
    }

    this.saveItems(items);
    return this.saveSavedItems(saved);
  },

  restoreFromSaved(lineId) {
    const saved = this.getSavedItems();
    const index = saved.findIndex((item) => item.lineId === lineId);
    if (index < 0) return this.getItems();

    const [item] = saved.splice(index, 1);
    this.saveSavedItems(saved);
    this.add({ ...item, qty: 1, selected: true });
    return this.getItems();
  },

  removeSaved(lineId) {
    return this.saveSavedItems(this.getSavedItems().filter((item) => item.lineId !== lineId));
  },

  clear() {
    writeJson(CART_KEY, []);
    emitUpdate();
    void syncServer();
  },

  clearSaved() {
    writeJson(SAVED_KEY, []);
    emitUpdate();
    void syncServer();
  },

  getSummary(options = {}) {
    const { selectedOnly = false, includeUnavailable = false } = options;
    let items = selectedOnly ? this.getSelectedItems() : this.getItems();
    if (!includeUnavailable) {
      items = items.filter((item) => !item.unavailable);
    }

    const quantity = items.reduce((sum, item) => sum + item.qty, 0);
    const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const discounts = items.reduce((sum, item) => {
      if (item.comparePrice > item.price) {
        return sum + (item.comparePrice - item.price) * item.qty;
      }
      return sum;
    }, 0);
    const shipping = quantity > 0 ? resolveShippingFee() : 0;
    const tax = Math.round(subtotal * TAX_RATE);
    const total = subtotal + shipping + tax;

    return {
      items: items.length,
      quantity,
      subtotal,
      discounts,
      shipping,
      tax,
      total,
      hasUnavailable: this.getItems().some((item) => item.unavailable),
      canCheckout: items.length > 0 && items.every((item) => !item.unavailable)
    };
  },

  mergeGuestCart(guestItems = []) {
    return this.addMany(guestItems);
  },

  async hydrateFromServer() {
    if (!window.ByoseStorefrontSync?.hydrate) return false;
    try {
      await window.ByoseStorefrontSync.hydrate();
      emitUpdate();
      return true;
    } catch {
      return false;
    }
  },

  async syncNow() {
    try {
      await syncServer();
      return true;
    } catch {
      return false;
    }
  },

  applyCatalogUpdates(products = []) {
    if (!Array.isArray(products) || !products.length) return this.getItems();

    const catalogMap = new Map(
      products.map((p) => [String(p.id || p.catalogId || p._id), p])
    );

    const items = this.getItems().map((item) => {
      const product = catalogMap.get(String(item.productId));
      if (!product) {
        return normalizeLine({ ...item, unavailable: true, availability: 'unavailable' });
      }

      const price = Number(product.price ?? product.discountPrice ?? item.price) || item.price;
      const comparePrice = Number(product.comparePrice ?? product.oldPrice ?? 0) || 0;
      const stock = getStockLimit(product);
      const availability = normalizeAvailability(product.availability, stock);
      const priceChanged = Math.round(price) !== Math.round(item.price);

      const colorImage = item.colorImage || item.variantSelection?.colorImage || '';
      return normalizeLine({
        ...item,
        name: product.name || item.name,
        slug: product.slug || item.slug,
        // Keep variant color image; fall back to catalog only when the line has none.
        colorImage,
        image: colorImage || item.image || product.image || product.mainImage || '',
        price,
        comparePrice,
        discountPrice: price,
        stock,
        availableStock: stock,
        availability,
        unavailable: availability === 'out_of_stock',
        priceChanged,
        qty: clampQty(item.qty, stock)
      });
    });

    return this.saveItems(items);
  },

  proceedToCheckout() {
    const selected = this.getSelectedItems().filter((item) => !item.unavailable);
    if (!selected.length) {
      throw new Error('Select at least one available item to checkout.');
    }

    writeJson(CHECKOUT_KEY, selected);

    // Cart checkout must win over any leftover Buy Now payload.
    try {
      window.localStorage.removeItem('byose_direct_checkout');
      window.ByoseStorefrontSync?.removeStateByKey?.('byose_direct_checkout');
      window.ByoseStorefrontSync?.syncPatch?.({ directCheckout: null });
    } catch {
      /* ignore */
    }

    const prefix = window.location.pathname.includes('/details/') ? '../' : '';
    window.location.href = `${prefix}orders/shipping.html`;
  },

  getProductUrl(item) {
    const prefix = window.location.pathname.includes('/details/') ? '' : 'details/';
    const productId = item.productId || item.id;
    if (productId) {
      return `${prefix}product-details1.html?id=${encodeURIComponent(productId)}`;
    }
    if (item.slug) {
      return `${prefix}product-details1.html?slug=${encodeURIComponent(item.slug)}`;
    }
    return `${prefix}product-details1.html`;
  },

  formatPrice(amount) {
    return `RWF ${Math.round(Number(amount) || 0).toLocaleString('en-US')}`;
  },

  escapeHtml,

  /* Legacy compatibility */
  getCart() {
    return this.getItems();
  },

  addItem(item) {
    return this.add(item);
  },

  removeItem(productId, attributes, _color, _size) {
    const variantKey = buildVariantKey(normalizeAttributes({ attributes }));
    const lineId = buildLineId(productId, variantKey);
    return this.remove(lineId);
  },

  updateItemQty(productId, attributes, qty) {
    const variantKey = buildVariantKey(normalizeAttributes({ attributes }));
    const lineId = buildLineId(productId, variantKey);
    return this.updateQty(lineId, qty);
  },

  checkout() {
    return this.proceedToCheckout();
  },

  getItemCount() {
    return this.getCount();
  },

  openWhatsAppOrder() {
    const items = this.getSelectedItems().filter((item) => !item.unavailable);
    if (!items.length) {
      alert('Your cart is empty.');
      return;
    }
    const lines = items.map((item) => {
      const attrs = item.attributeSummary ? ` (${item.attributeSummary})` : '';
      return `• ${item.name}${attrs} x${item.qty} — ${this.formatPrice(item.price * item.qty)}`;
    });
    const summary = this.getSummary({ selectedOnly: true });
    const storeName = String(window.ByoseStoreSettings?.storeName || 'Byose Market');
    const whatsapp = window.ByoseStoreSettings?.whatsappContact
      || window.ByoseStoreSettings?.whatsappNumber
      || '250723731250';
    const message =
      `Hello ${storeName}, I would like to order:\n\n${lines.join('\n')}\n\nTotal: ${this.formatPrice(summary.total)}`;
    const href = typeof window.ByoseStoreSettingsLoader?.waHref === 'function'
      ? window.ByoseStoreSettingsLoader.waHref(whatsapp, message)
      : `https://wa.me/${String(whatsapp).replace(/\D+/g, '')}?text=${encodeURIComponent(message)}`;
    window.open(href, '_blank', 'noopener');
  }
};

export default ByoseCart;
export { CART_KEY, SAVED_KEY, CHECKOUT_KEY, buildLineId, buildVariantKey, normalizeLine };
