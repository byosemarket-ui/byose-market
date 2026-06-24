export const STORAGE_KEYS = {
  cart: 'byose_market_cart_v1',
  checkoutActive: 'byose_checkout_active_v1',
  directCheckout: 'byose_direct_checkout',
  orders: 'byose_orders',
  draft: 'byose_checkout_draft_v1',
  confirmation: 'byose_checkout_confirmation_v1',
  pendingOrderSubmission: 'byose_pending_order_submission_v1',
  currentUser: 'bm_current_user',
  legacyUser: 'bm_user',
  storefrontUser: 'byose_market_user'
};

const PRODUCTION_API_ORIGIN = 'https://byosesemarket4.onrender.com';
const STOREFRONT_STATE_FIELDS = {
  [STORAGE_KEYS.cart]: 'cartItems',
  [STORAGE_KEYS.directCheckout]: 'directCheckout',
  [STORAGE_KEYS.draft]: 'checkoutDraft',
  [STORAGE_KEYS.confirmation]: 'checkoutConfirmation'
};

let suppressStorefrontSync = false;
let storefrontHydrationPromise = null;
let storefrontSyncQueue = Promise.resolve({ skipped: true });
let pendingStorefrontPatch = null;
const STOREFRONT_REQUEST_TIMEOUT_MS = 10000;
const transientStore = new Map();

export const PAYMENT_ACCOUNTS = [
  {
    id: 'mtn',
    label: 'MTN Mobile Money',
    number: '0780430710',
    accountName: 'Vestine Uwifashije'
  },
  {
    id: 'airtel',
    label: 'Airtel Money',
    number: '0723137250',
    accountName: 'Kwizera Byose Market'
  }
];

export function clone(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function normalizeBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
}

function shouldUseProductionApi(hostname) {
  return /(^|\.)(github\.io|byosemarket\.com)$/i.test(String(hostname || ''));
}

export function resolveApiOrigin() {
  const explicit = normalizeBase(window.BYOSE_API_BASE_URL || window.__BYOSE_API_BASE__ || '');
  if (explicit) {
    return explicit;
  }

  const protocol = String(window.location?.protocol || '').toLowerCase();
  const hostname = String(window.location?.hostname || '').trim();

  if (protocol === 'file:' || isLocalHost(hostname)) {
    return `http://${hostname || 'localhost'}:5000`;
  }

  if (shouldUseProductionApi(hostname)) {
    return PRODUCTION_API_ORIGIN;
  }

  return normalizeBase(window.location?.origin || '');
}

function getStorefrontStateUrl() {
  const base = resolveApiOrigin();
  if (!base) {
    return '';
  }

  return base.endsWith('/api') ? `${base}/storefront/state` : `${base}/api/storefront/state`;
}

function getAuthToken() {
  try {
    if (window.authService && typeof window.authService.getToken === 'function') {
      return String(window.authService.getToken() || '').trim();
    }
  } catch (error) {
    console.error(error);
  }

  return String(window.localStorage.getItem('bm_auth_token') || '').trim();
}

async function requestStorefrontState(method, body) {
  const endpoint = getStorefrontStateUrl();
  const token = getAuthToken();

  if (!endpoint || !token) {
    return { skipped: true };
  }

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutId = controller
    ? window.setTimeout(() => controller.abort(new Error('Storefront state request timeout')), STOREFRONT_REQUEST_TIMEOUT_MS)
    : 0;

  try {
    const response = await fetch(endpoint, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...(controller ? { signal: controller.signal } : {})
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        message: payload?.message || `Storefront state request failed with status ${response.status}`
      };
    }

    if (!payload || typeof payload !== 'object') {
      return {
        success: false,
        message: 'Storefront state API returned an invalid response.'
      };
    }

    return payload;
  } catch (error) {
    return {
      success: false,
      timeout: error?.name === 'AbortError',
      error,
      message: error?.name === 'AbortError'
        ? 'Storefront state request timed out.'
        : 'Unable to reach the storefront state service.'
    };
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
}

function applyRemoteStorefrontState(state) {
  suppressStorefrontSync = true;

  try {
    if (Array.isArray(state?.cartItems)) {
      writeStorage(STORAGE_KEYS.cart, state.cartItems.map(normalizeCartItem));
    }

    if (Object.prototype.hasOwnProperty.call(state || {}, 'directCheckout')) {
      if (state.directCheckout) {
        writeStorage(STORAGE_KEYS.directCheckout, normalizeCartItem(state.directCheckout));
      } else {
        removeStorage(STORAGE_KEYS.directCheckout);
      }
    }

    if (Object.prototype.hasOwnProperty.call(state || {}, 'checkoutDraft')) {
      if (state.checkoutDraft) {
        writeStorage(STORAGE_KEYS.draft, clone(state.checkoutDraft));
      }
    }

    if (Object.prototype.hasOwnProperty.call(state || {}, 'checkoutConfirmation')) {
      if (state.checkoutConfirmation) {
        writeStorage(STORAGE_KEYS.confirmation, clone(state.checkoutConfirmation));
      } else {
        removeStorage(STORAGE_KEYS.confirmation);
      }
    }
  } finally {
    suppressStorefrontSync = false;
  }
}

export async function syncStorefrontState(patch = {}) {
  if (window.ByoseStorefrontSync && typeof window.ByoseStorefrontSync.syncPatch === 'function') {
    return window.ByoseStorefrontSync.syncPatch(clone(patch || {}));
  }

  if (!patch || !Object.keys(patch).length) {
    return { skipped: true };
  }

  pendingStorefrontPatch = {
    ...(pendingStorefrontPatch || {}),
    ...clone(patch)
  };

  storefrontSyncQueue = storefrontSyncQueue.then(async () => {
    const nextPatch = pendingStorefrontPatch;
    pendingStorefrontPatch = null;

    if (!nextPatch || !Object.keys(nextPatch).length) {
      return { skipped: true };
    }

    const payload = await requestStorefrontState('PUT', nextPatch);
    if (payload?.state) {
      applyRemoteStorefrontState(payload.state);
    } else if (payload?.success === false) {
      console.warn('Unable to sync storefront state to the API.', payload.message || payload.error || payload);
    }

    return payload;
  });

  return storefrontSyncQueue;
}

function syncStorefrontStorageKey(key, value) {
  if (window.ByoseStorefrontSync && typeof window.ByoseStorefrontSync.syncStorageKey === 'function') {
    window.ByoseStorefrontSync.syncStorageKey(key, value);
    return;
  }

  if (suppressStorefrontSync) {
    return;
  }

  const field = STOREFRONT_STATE_FIELDS[key];
  if (!field) {
    return;
  }

  void syncStorefrontState({ [field]: clone(value) });
}

export async function hydrateStorefrontState(force = false) {
  if (window.ByoseStorefrontSync && typeof window.ByoseStorefrontSync.hydrate === 'function') {
    return window.ByoseStorefrontSync.hydrate(force);
  }

  if (storefrontHydrationPromise && !force) {
    return storefrontHydrationPromise;
  }

  storefrontHydrationPromise = requestStorefrontState('GET')
    .then((payload) => {
      if (payload?.state) {
        applyRemoteStorefrontState(payload.state);
        return payload.state;
      }

      if (payload?.success === false) {
        console.warn('Unable to hydrate storefront state from the API.', payload.message || payload.error || payload);
      }

      return null;
    })
    .finally(() => {
      storefrontHydrationPromise = null;
    });

  return storefrontHydrationPromise;
}

export function readStorage(key, fallback) {
  try {
    if (window.ByoseStorefrontSync?.isManagedKey?.(key)) {
      const managedValue = window.ByoseStorefrontSync.readStateByKey(key);
      return managedValue === undefined ? fallback : managedValue;
    }

    if (transientStore.has(key)) {
      return clone(transientStore.get(key));
    }

    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }

    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

/** Read persisted checkout draft directly from localStorage (cross-page navigation). */
export function readPersistedDraft() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.draft);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Read direct-checkout item directly from localStorage. */
export function readPersistedDirectCheckout() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.directCheckout);
    return raw ? normalizeCartItem(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeStorage(key, value) {
  if (window.ByoseStorefrontSync?.isManagedKey?.(key)) {
    window.ByoseStorefrontSync.writeStateByKey(key, value);
    return;
  }

  transientStore.set(key, clone(value));
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('Unable to persist storage key', key, error);
  }
  syncStorefrontStorageKey(key, value);
}

export function removeStorage(key) {
  if (window.ByoseStorefrontSync?.isManagedKey?.(key)) {
    window.ByoseStorefrontSync.removeStateByKey(key);
    return;
  }

  transientStore.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.warn('Unable to remove storage key', key, error);
  }
  syncStorefrontStorageKey(key, null);
}

export function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function formatCurrency(value) {
  return `RWF ${(Number(value) || 0).toLocaleString('en-US')}`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Resolve a site-root asset path for pages under /orders/. */
export function resolveCheckoutAsset(path) {
  const raw = String(path || '').trim().replace(/^\/+/, '');
  if (!raw) return '';
  return `../${raw.split('/').map(encodeURIComponent).join('/')}`;
}

export function resolveProductUrl(product = {}) {
  const slug = String(product?.slug || '').trim();
  const id = String(product?.id || product?.productId || '').trim();
  const base = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : '';
  if (slug) {
    return `${base}/details/product-details1.html?slug=${encodeURIComponent(slug)}`;
  }
  if (id) {
    return `${base}/details/product-details1.html?id=${encodeURIComponent(id)}`;
  }
  return '';
}

export function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) {
    return '';
  }

  if (digits.startsWith('250') && digits.length === 12) {
    return `+${digits}`;
  }

  if (digits.startsWith('0') && digits.length === 10) {
    return `+250${digits.slice(1)}`;
  }

  if (digits.length === 9) {
    return `+250${digits}`;
  }

  return digits.startsWith('+') ? digits : `+${digits}`;
}

export function isValidPhone(value) {
  const normalized = normalizePhone(value);
  return /^\+250\d{9}$/.test(normalized);
}

export function normalizeAttributes(item) {
  if (item && item.attributes && typeof item.attributes === 'object' && !Array.isArray(item.attributes)) {
    return Object.fromEntries(
      Object.entries(item.attributes).filter(([, value]) => value !== undefined && value !== null && value !== '')
    );
  }

  const attributes = {};
  if (item?.color) {
    attributes.Color = item.color;
  }
  if (item?.size) {
    attributes.Size = item.size;
  }
  return attributes;
}

export function buildVariantKey(attributes) {
  return Object.entries(attributes || {})
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([key, value]) => `${key}:${value}`)
    .join('|');
}

export function describeAttributes(item) {
  const entries = Object.entries(normalizeAttributes(item));
  if (!entries.length) {
    return 'Standard option';
  }

  return entries.map(([key, value]) => `${key}: ${value}`).join(' | ');
}

export function formatVariantDetailsText(item = {}) {
  const colorName = String(item?.colorName || item?.color || item?.variantSelection?.color || '').trim();
  const sizeLabel = String(item?.sizeLabel || item?.size || item?.variantSelection?.size || '').trim();
  const parts = [];
  if (colorName) {
    parts.push(colorName);
  }
  if (sizeLabel) {
    parts.push(`Size ${sizeLabel}`);
  }
  if (parts.length) {
    return parts.join(' · ');
  }
  return String(item?.attributeSummary || describeAttributes(item)).trim() || 'Standard option';
}

export function resolveOrderItemImage(item) {
  const galleryImage = Array.isArray(item?.gallery) ? item.gallery.find((entry) => String(entry || '').trim()) : '';
  return String(
    item?.image
    || item?.img
    || item?.imageUrl
    || item?.productImage
    || item?.mainImage
    || item?.thumbnail
    || galleryImage
    || 'img/logo.png'
  ).trim();
}

export function normalizeCartItem(item) {
  const attributes = normalizeAttributes(item);
  const variantKey = item?.variantKey || buildVariantKey(attributes);
  const colorName = String(item?.colorName || item?.variantSelection?.color || item?.color || '').trim();
  const sizeLabel = String(item?.sizeLabel || item?.variantSelection?.size || item?.size || '').trim();
  const colorImage = String(item?.colorImage || item?.variantSelection?.colorImage || '').trim();
  const productImage = resolveOrderItemImage(item);
  const image = String(item?.image || item?.img || colorImage || productImage).trim();
  const qty = Math.max(1, Number(item?.qty || 1) || 1);
  const price = Number(item?.price || 0) || 0;
  const comparePrice = Number(item?.comparePrice ?? item?.oldPrice ?? 0) || 0;
  const resolvedComparePrice = comparePrice > price ? comparePrice : 0;

  return {
    id: String(item?.id || `${item?.name || 'item'}-${variantKey || 'default'}`),
    productId: String(item?.productId || item?.id || '').trim(),
    name: String(item?.name || 'Product').trim() || 'Product',
    slug: String(item?.slug || '').trim(),
    price,
    comparePrice: resolvedComparePrice,
    oldPrice: resolvedComparePrice,
    discountPrice: Number(item?.discountPrice ?? price) || price,
    discountPercent: Number(item?.discountPercent || 0) || 0,
    discountAmount: Number(item?.discountAmount || 0) || 0,
    qty,
    quantity: qty,
    image,
    img: image,
    imageUrl: image,
    productImage: String(item?.productImage || productImage).trim(),
    colorImage,
    mainImage: image,
    thumbnail: image,
    attributes,
    attributeSummary: item?.attributeSummary || formatVariantDetailsText({ ...item, colorName, sizeLabel, attributes }),
    variantKey,
    variantType: String(item?.variantType || (Object.keys(attributes).length ? 'variant' : 'simple')),
    variantSelection: item?.variantSelection && typeof item.variantSelection === 'object'
      ? {
          key: String(item.variantSelection.key || variantKey).trim(),
          type: String(item.variantSelection.type || (Object.keys(attributes).length ? 'variant' : 'simple')).trim(),
          attributes: normalizeAttributes({ attributes: item.variantSelection.attributes || attributes }),
          attributeSummary: String(item.variantSelection.attributeSummary || item?.attributeSummary || '').trim(),
          color: String(item.variantSelection.color || colorName).trim(),
          colorId: String(item.variantSelection.colorId || item?.colorId || '').trim(),
          colorImage: String(item.variantSelection.colorImage || colorImage).trim(),
          size: String(item.variantSelection.size || sizeLabel).trim(),
          sizeValue: String(item.variantSelection.sizeValue || item?.sizeValue || '').trim()
        }
      : null,
    color: colorName,
    colorName,
    colorId: String(item?.colorId || attributes.Color || '').trim(),
    size: sizeLabel,
    sizeLabel,
    sizeValue: String(item?.sizeValue || attributes.Size || '').trim(),
    sku: String(item?.sku || item?.variantSku || '').trim(),
    variantSku: String(item?.variantSku || item?.sku || '').trim(),
    availableStock: Number.isFinite(Number(item?.availableStock))
      ? Math.max(0, Number(item.availableStock))
      : Number.isFinite(Number(item?.stock))
        ? Math.max(0, Number(item.stock))
        : null,
    stock: Number.isFinite(Number(item?.stock))
      ? Math.max(0, Number(item.stock))
      : Number.isFinite(Number(item?.availableStock))
        ? Math.max(0, Number(item.availableStock))
        : null,
    inventorySnapshot: item?.inventorySnapshot && typeof item.inventorySnapshot === 'object'
      ? {
          sku: String(item.inventorySnapshot.sku || item?.variantSku || item?.sku || '').trim(),
          status: String(item.inventorySnapshot.status || '').trim(),
          available: Math.max(0, Number(item.inventorySnapshot.available || item?.availableStock || 0) || 0),
          lowStockThreshold: Math.max(0, Number(item.inventorySnapshot.lowStockThreshold || 5) || 5)
        }
      : null,
    total: price * qty
  };
}

export function readCartItems() {
  const checkoutActive = readStorage(STORAGE_KEYS.checkoutActive, []);
  if (Array.isArray(checkoutActive) && checkoutActive.length) {
    return checkoutActive.map(normalizeCartItem);
  }

  return readStorage(STORAGE_KEYS.cart, []).map(normalizeCartItem);
}

export function writeCartItems(items) {
  writeStorage(STORAGE_KEYS.cart, items.map(normalizeCartItem));
}

export function readDirectCheckout() {
  const item = readStorage(STORAGE_KEYS.directCheckout, null);
  return item ? normalizeCartItem(item) : null;
}

export function writeDirectCheckout(item) {
  if (!item) {
    removeStorage(STORAGE_KEYS.directCheckout);
    return;
  }

  writeStorage(STORAGE_KEYS.directCheckout, normalizeCartItem(item));
}

export function readCurrentUser() {
  try {
    if (window.authService && typeof window.authService.getCurrentUser === 'function') {
      return window.authService.getCurrentUser() || null;
    }
  } catch (error) {
    console.error(error);
  }

  return (
    readStorage(STORAGE_KEYS.currentUser, null)
    || readStorage(STORAGE_KEYS.legacyUser, null)
    || readStorage(STORAGE_KEYS.storefrontUser, null)
  );
}

export function getUserAddress(user) {
  const address = user?.address && typeof user.address === 'object' ? user.address : {};
  const [firstName, ...rest] = String(user?.name || '').trim().split(/\s+/).filter(Boolean);

  return {
    firstName: String(address.firstName || firstName || '').trim(),
    lastName: String(address.lastName || rest.join(' ') || '').trim(),
    phone: String(address.phone || user?.phone || '').trim(),
    city: String(address.city || '').trim(),
    district: String(address.district || '').trim(),
    sector: String(address.sector || '').trim(),
    cell: String(address.cell || '').trim(),
    village: String(address.village || '').trim(),
    street: String(address.street || address.line1 || '').trim()
  };
}

export function persistUserAddress(address) {
  const currentUser = readCurrentUser();
  if (!currentUser || !currentUser.id) {
    return;
  }

  const nextUser = {
    ...currentUser,
    phone: normalizePhone(address.phone) || currentUser.phone || '',
    address: {
      ...(currentUser.address || {}),
      ...clone(address),
      phone: normalizePhone(address.phone) || currentUser.phone || '',
      line1: address.street || currentUser.address?.line1 || ''
    }
  };

  if (window.authService && typeof window.authService.updateProfile === 'function') {
    return window.authService.updateProfile({
      name: nextUser.name || currentUser.name || '',
      phone: nextUser.phone || currentUser.phone || '',
      avatar: nextUser.avatar || currentUser.avatar || '',
      address: nextUser.address || {}
    }).catch((error) => {
      console.warn('Unable to sync the customer address to the API.', error);
    });
  }

  return undefined;
}

export function readOrders() {
  // Orders are centralized in the backend; browser storage is no longer used as an order database.
  return [];
}

export function readOrderById(orderId) {
  const _ignored = orderId;
  return null;
}

export function saveOrder(order) {
  const _ignored = order;
  return true;
}

export function saveCheckoutConfirmation(payload) {
  writeStorage(STORAGE_KEYS.confirmation, payload);
}

export function readCheckoutConfirmation() {
  return readStorage(STORAGE_KEYS.confirmation, null);
}

export function savePendingOrderSubmission(payload) {
  writeStorage(STORAGE_KEYS.pendingOrderSubmission, payload || null);
}

export function readPendingOrderSubmission() {
  return readStorage(STORAGE_KEYS.pendingOrderSubmission, null);
}

export function clearPendingOrderSubmission() {
  removeStorage(STORAGE_KEYS.pendingOrderSubmission);
}

export function emitCartUpdated() {
  window.dispatchEvent(new Event('cart:updated'));
  window.dispatchEvent(new Event('kcart:updated'));
}

export function createOrderId() {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000000);
  return `BM${String(timestamp)}${String(random).padStart(6, '0')}`;
}
