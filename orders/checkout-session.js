/**
 * Isolated purchase-session helpers.
 *
 * Cart        = persistent shopping list (byose_market_cart_v1)
 * Buy Now     = temporary direct checkout (byose_direct_checkout)
 * Checkout    = active session (intent + draft/commit/handoff)
 * Completed   = confirmation after a real order
 *
 * These must not overwrite one another. Cart lines are never cleared here.
 */
import {
  STORAGE_KEYS,
  emitCartUpdated,
  normalizeCartItem,
  readStorage,
  removeStorage,
  writeStorage
} from './utils.js';

export const CHECKOUT_INTENT_KEY = STORAGE_KEYS.checkoutIntent;
export const STEP1_COMMIT_KEY = 'byose_checkout_step1_commit_v1';
export const HANDOFF_KEY = 'byose_checkout_handoff_v1';
export const SELECTED_COUPON_KEY = 'byose_selected_coupon_v1';
const INTENT_TTL_MS = 30 * 60 * 1000;

function removeBrowserKey(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (_error) { /* ignore */ }
  try {
    window.sessionStorage.removeItem(key);
  } catch (_error) { /* ignore */ }
}

function syncRemove(key, field) {
  try {
    window.ByoseStorefrontSync?.removeStateByKey?.(key);
  } catch (_error) { /* ignore */ }
  if (field) {
    try {
      window.ByoseStorefrontSync?.syncPatch?.({ [field]: null });
    } catch (_error) { /* ignore */ }
  }
}

export function productLineKey(product) {
  if (!product || typeof product !== 'object') return '';
  const lineId = String(product.lineId || '').trim();
  if (lineId) return `line:${lineId}`;
  const productId = String(product.productId || product.id || '').trim();
  const variantKey = String(product.variantKey || '').trim();
  return `pv:${productId}|${variantKey}`;
}

export function productKeysSignature(products = []) {
  return (Array.isArray(products) ? products : [])
    .map(productLineKey)
    .filter(Boolean)
    .sort()
    .join(',');
}

export function purchasedLineKeys(products = []) {
  const keys = new Set();
  (Array.isArray(products) ? products : []).forEach((product) => {
    const lineId = String(product?.lineId || '').trim();
    if (lineId) keys.add(`line:${lineId}`);
    const productId = String(
      product?.productId
      || product?.id
      || product?.catalogId
      || product?.product_catalog_id
      || ''
    ).trim();
    const variantKey = String(product?.variantKey || '').trim();
    const size = String(product?.sizeValue || product?.size || product?.sizeLabel || '').trim().replace(/^size\s+/i, '');
    if (productId) {
      keys.add(`pv:${productId}|${variantKey}`);
      if (size) keys.add(`ps:${productId}|${size}`);
    }
  });
  return keys;
}

export function readCheckoutIntent() {
  try {
    const raw = window.localStorage.getItem(CHECKOUT_INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const startedAt = Number(parsed?.startedAt || 0);
    if (!startedAt || Date.now() - startedAt > INTENT_TTL_MS) {
      removeBrowserKey(CHECKOUT_INTENT_KEY);
      return null;
    }
    if (parsed?.source !== 'direct' && parsed?.source !== 'cart') return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

export function writeCheckoutIntent(source, products = []) {
  const intent = {
    source,
    startedAt: Date.now(),
    productKeys: (Array.isArray(products) ? products : [])
      .map(productLineKey)
      .filter(Boolean)
  };
  try {
    window.localStorage.setItem(CHECKOUT_INTENT_KEY, JSON.stringify(intent));
  } catch (_error) { /* ignore */ }
  return intent;
}

export function clearCheckoutIntent() {
  removeBrowserKey(CHECKOUT_INTENT_KEY);
}

export function readDirectCheckoutItems() {
  const raw = readStorage(STORAGE_KEYS.directCheckout, null);
  if (!raw) {
    try {
      const persisted = window.localStorage.getItem(STORAGE_KEYS.directCheckout);
      if (!persisted) return [];
      const parsed = JSON.parse(persisted);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list.map(normalizeCartItem).filter(Boolean);
    } catch (_error) {
      return [];
    }
  }
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map(normalizeCartItem).filter(Boolean);
}

export function writeDirectCheckoutItems(itemsInput) {
  const items = (Array.isArray(itemsInput) ? itemsInput : [itemsInput])
    .map((item) => normalizeCartItem(item))
    .filter(Boolean);
  if (!items.length) {
    removeStorage(STORAGE_KEYS.directCheckout);
    removeBrowserKey(STORAGE_KEYS.directCheckout);
    syncRemove(STORAGE_KEYS.directCheckout, 'directCheckout');
    return [];
  }
  const payload = items.length === 1 ? items[0] : items;
  writeStorage(STORAGE_KEYS.directCheckout, payload);
  try {
    window.localStorage.setItem(STORAGE_KEYS.directCheckout, JSON.stringify(payload));
  } catch (_error) { /* ignore */ }
  try {
    window.ByoseStorefrontSync?.writeStateByKey?.(STORAGE_KEYS.directCheckout, payload);
    window.ByoseStorefrontSync?.syncPatch?.({ directCheckout: payload });
  } catch (_error) { /* ignore */ }
  return items;
}

/**
 * Clear abandoned checkout artifacts without touching the persistent cart.
 */
export function clearAbandonedCheckoutSession() {
  removeStorage(STORAGE_KEYS.draft);
  removeStorage(STORAGE_KEYS.confirmation);
  removeStorage(STORAGE_KEYS.pendingOrderSubmission);
  removeBrowserKey(STORAGE_KEYS.draft);
  removeBrowserKey(STORAGE_KEYS.confirmation);
  removeBrowserKey(STORAGE_KEYS.pendingOrderSubmission);
  removeBrowserKey(STEP1_COMMIT_KEY);
  removeBrowserKey(HANDOFF_KEY);
  removeBrowserKey(SELECTED_COUPON_KEY);
  syncRemove(STORAGE_KEYS.draft, 'checkoutDraft');
  syncRemove(STORAGE_KEYS.confirmation, 'checkoutConfirmation');
  try {
    window.ByoseStorefrontSync?.syncPatch?.({
      checkoutDraft: null,
      checkoutConfirmation: null
    });
  } catch (_error) { /* ignore */ }
}

export function startBuyNowSession(itemsInput) {
  const items = (Array.isArray(itemsInput) ? itemsInput : [itemsInput]).filter(Boolean);
  clearAbandonedCheckoutSession();
  removeStorage(STORAGE_KEYS.checkoutActive);
  removeBrowserKey(STORAGE_KEYS.checkoutActive);
  writeDirectCheckoutItems(items);
  writeCheckoutIntent('direct', items);
  return items;
}

export function startCartCheckoutSession(itemsInput) {
  const items = (Array.isArray(itemsInput) ? itemsInput : [itemsInput]).filter(Boolean);
  clearAbandonedCheckoutSession();
  removeStorage(STORAGE_KEYS.directCheckout);
  removeBrowserKey(STORAGE_KEYS.directCheckout);
  syncRemove(STORAGE_KEYS.directCheckout, 'directCheckout');
  writeStorage(STORAGE_KEYS.checkoutActive, items);
  try {
    window.localStorage.setItem(STORAGE_KEYS.checkoutActive, JSON.stringify(items));
  } catch (_error) { /* ignore */ }
  writeCheckoutIntent('cart', items);
  return items;
}

export function clearActiveCheckoutKeys() {
  removeStorage(STORAGE_KEYS.checkoutActive);
  removeStorage(STORAGE_KEYS.directCheckout);
  removeStorage(STORAGE_KEYS.draft);
  removeBrowserKey(STORAGE_KEYS.checkoutActive);
  removeBrowserKey(STORAGE_KEYS.directCheckout);
  removeBrowserKey(STORAGE_KEYS.draft);
  removeBrowserKey(STEP1_COMMIT_KEY);
  removeBrowserKey(HANDOFF_KEY);
  clearCheckoutIntent();
  syncRemove(STORAGE_KEYS.directCheckout, 'directCheckout');
  syncRemove(STORAGE_KEYS.draft, 'checkoutDraft');
}

export function intentMatchesProducts(products = []) {
  const intent = readCheckoutIntent();
  if (!intent) return true;
  const current = productKeysSignature(products);
  const expected = (intent.productKeys || []).slice().sort().join(',');
  if (!expected) return true;
  return current === expected;
}

export function removePurchasedItemsFromCart(products = [], extraKeys = []) {
  const keys = purchasedLineKeys(products);
  (Array.isArray(extraKeys) ? extraKeys : []).forEach((key) => {
    if (key) keys.add(String(key));
  });
  if (!keys.size) {
    return readStorage(STORAGE_KEYS.cart, []) || [];
  }

  const remaining = (readStorage(STORAGE_KEYS.cart, []) || []).filter((item) => {
    const lineId = String(item?.lineId || '').trim();
    if (lineId && keys.has(`line:${lineId}`)) return false;
    const productId = String(item?.productId || item?.id || item?.catalogId || '').trim();
    const variantKey = String(item?.variantKey || '').trim();
    const size = String(item?.sizeValue || item?.size || item?.sizeLabel || '').trim().replace(/^size\s+/i, '');
    if (productId && keys.has(`pv:${productId}|${variantKey}`)) return false;
    if (productId && size && keys.has(`ps:${productId}|${size}`)) return false;
    return true;
  });

  if (window.ByoseCart && typeof window.ByoseCart.saveItems === 'function') {
    window.ByoseCart.saveItems(remaining);
  } else {
    writeStorage(STORAGE_KEYS.cart, remaining);
    emitCartUpdated();
  }
  return remaining;
}

export function shouldRemoveCartAfterPurchase(confirmation = {}) {
  const method = String(
    confirmation?.payment?.method
    || confirmation?.paymentMethod
    || ''
  ).trim().toLowerCase();
  const status = String(
    confirmation?.paymentStatus
    || confirmation?.payment?.status
    || ''
  ).trim().toLowerCase();

  if (method === 'cod' || status === 'awaiting_delivery_payment') {
    return true;
  }

  if (
    status.includes('unpaid')
    || status.includes('awaiting')
    || status.includes('pending')
    || status.includes('fail')
    || status.includes('cancel')
    || status.includes('unsuccess')
    || status.includes('invalid')
    || status.includes('refund')
    || !status
  ) {
    return false;
  }

  return status === 'paid'
    || status === 'success'
    || status === 'successful'
    || status === 'completed'
    || status === 'complete'
    || status === 'payment_successful'
    || status === 'authorized';
}

if (typeof window !== 'undefined') {
  window.ByoseCheckoutSession = {
    startBuyNowSession,
    startCartCheckoutSession,
    clearAbandonedCheckoutSession,
    removePurchasedItemsFromCart,
    shouldRemoveCartAfterPurchase,
    readCheckoutIntent,
    readDirectCheckoutItems
  };
}
