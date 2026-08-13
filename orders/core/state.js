import {
  STORAGE_KEYS,
  clone,
  createOrderId,
  emitCartUpdated,
  formatCurrency,
  getUserAddress,
  hydrateStorefrontState,
  normalizePhone,
  persistUserAddress,
  readCartItems,
  readCheckoutConfirmation,
  readCurrentUser,
  readDirectCheckout,
  readPersistedDraft,
  readPersistedDirectCheckout,
  readStorage,
  removeStorage,
  resolveApiOrigin,
  saveCheckoutConfirmation,
  writeCartItems,
  writeStorage
} from '../utils.js';
import { COD_FEE, DELIVERY_FEE, PAYMENT_METHODS, STEPS } from './constants.js';
import { validateProducts, validateShipping } from './validation.js';

const listeners = new Set();
const HANDOFF_KEY = 'byose_checkout_handoff_v1';
const HANDOFF_TTL_MS = 30 * 60 * 1000;
/** Authoritative Step 1 → Step 2 payload (dual-written to session + local). */
const STEP1_COMMIT_KEY = 'byose_checkout_step1_commit_v1';
const STEP1_COMMIT_TTL_MS = 60 * 60 * 1000;

const DEFAULT_ADDRESS = {
  fullName: '',
  phone: '',
  provinceCity: '',
  district: '',
  sector: '',
  cell: '',
  village: '',
  note: '',
  latitude: '',
  longitude: '',
  mapLink: '',
  locationAccuracy: '',
  locationCapturedAt: ''
};

const state = {
  initialized: false,
  isSubmitting: false,
  step: 'shipping',
  source: 'cart',
  products: [],
  customer: { id: '', name: '', email: '', phone: '', avatar: '' },
  shipping: clone(DEFAULT_ADDRESS),
  deliveryMethodKey: 'homeDelivery',
  deliveryEstimate: '',
  payment: { method: 'dpo', phone: '' },
  gateway: { dpoEnabled: false, dpoLabel: 'Pay Online (DPO)', loaded: false },
  coupon: { code: '', title: '', discountAmount: 0, status: '' },
  totals: { subtotal: 0, discount: 0, couponDiscount: 0, tax: 0, deliveryFee: DELIVERY_FEE, codFee: 0, total: DELIVERY_FEE }
};

let runtimeDeliveryFee = DELIVERY_FEE;

function emit(event) {
  listeners.forEach((fn) => {
    try { fn(event, getState()); } catch (e) { console.error(e); }
  });
}

function shippingFieldFilled(value) {
  return Boolean(String(value == null ? '' : value).trim());
}

function countFilledShippingFields(shipping = {}) {
  return ['fullName', 'phone', 'provinceCity', 'district', 'sector', 'cell', 'village']
    .reduce((count, key) => count + (shippingFieldFilled(shipping[key]) ? 1 : 0), 0);
}

function stepRank(stepId) {
  const index = STEPS.findIndex((step) => step.id === stepId);
  return index >= 0 ? index : -1;
}

/**
 * Merge shipping objects without letting empty/stale values wipe completed fields.
 * Used when handoff (session) and draft (localStorage/remote) disagree.
 */
function mergeShippingPreferFilled(base = {}, incoming = {}) {
  const next = { ...clone(DEFAULT_ADDRESS), ...(base || {}) };
  Object.entries(incoming || {}).forEach(([key, value]) => {
    if (value == null) return;
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text) return;
      next[key] = text;
      return;
    }
    next[key] = value;
  });
  if (incoming?.phone != null || base?.phone != null) {
    next.phone = normalizePhone(incoming?.phone || base?.phone || next.phone);
  }
  return next;
}

function pickFresherDraft(localDraft, remoteDraft) {
  if (!remoteDraft || typeof remoteDraft !== 'object') return localDraft || null;
  if (!localDraft || typeof localDraft !== 'object') return remoteDraft;

  const localRank = stepRank(localDraft.step);
  const remoteRank = stepRank(remoteDraft.step);
  if (localRank > remoteRank) return localDraft;
  if (remoteRank > localRank) return remoteDraft;

  const localFilled = countFilledShippingFields(localDraft.shipping || localDraft.shippingAddress || {});
  const remoteFilled = countFilledShippingFields(remoteDraft.shipping || remoteDraft.shippingAddress || {});
  if (localFilled > remoteFilled) return localDraft;
  if (remoteFilled > localFilled) return remoteDraft;

  const localAt = Number(localDraft.updatedAt || 0);
  const remoteAt = Number(remoteDraft.updatedAt || 0);
  if (localAt && remoteAt) {
    return localAt >= remoteAt ? localDraft : remoteDraft;
  }
  return localDraft.updatedAt ? localDraft : remoteDraft;
}

function writeHandoff() {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({
      step: state.step,
      source: state.source,
      products: state.products,
      shipping: state.shipping,
      deliveryMethodKey: state.deliveryMethodKey,
      payment: state.payment,
      coupon: state.coupon,
      at: Date.now()
    }));
  } catch (_) { /* sessionStorage may be unavailable */ }
}

function buildStep1CommitPayload() {
  return {
    version: 1,
    committedAt: Date.now(),
    step: 'review',
    source: state.source,
    products: clone(state.products),
    shipping: clone(state.shipping),
    deliveryMethodKey: state.deliveryMethodKey || 'homeDelivery',
    customer: clone(state.customer),
    payment: clone(state.payment),
    coupon: clone(state.coupon)
  };
}

function writeStep1Commit(payload) {
  const raw = JSON.stringify(payload);
  let localOk = false;
  let sessionOk = false;
  try {
    window.localStorage.setItem(STEP1_COMMIT_KEY, raw);
    localOk = true;
  } catch (error) {
    console.error('STATE_SAVE_FAILED', 'localStorage', error);
  }
  try {
    window.sessionStorage.setItem(STEP1_COMMIT_KEY, raw);
    sessionOk = true;
  } catch (error) {
    console.error('STATE_SAVE_FAILED', 'sessionStorage', error);
  }
  return { ok: localOk || sessionOk, localOk, sessionOk };
}

function parseStep1Commit(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const at = Number(parsed?.committedAt || 0);
    if (!at || Date.now() - at > STEP1_COMMIT_TTL_MS) return null;
    if (!parsed?.shipping || typeof parsed.shipping !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function readStep1Commit() {
  let sessionCommit = null;
  let localCommit = null;
  try {
    sessionCommit = parseStep1Commit(window.sessionStorage.getItem(STEP1_COMMIT_KEY));
  } catch {
    sessionCommit = null;
  }
  try {
    localCommit = parseStep1Commit(window.localStorage.getItem(STEP1_COMMIT_KEY));
  } catch {
    localCommit = null;
  }
  if (sessionCommit && localCommit) {
    return Number(sessionCommit.committedAt) >= Number(localCommit.committedAt)
      ? sessionCommit
      : localCommit;
  }
  return sessionCommit || localCommit;
}

/**
 * Apply the authoritative Step 1 commit. Replaces shipping wholesale so stale
 * profile/draft empties cannot wipe the just-entered address.
 */
function applyStep1Commit() {
  const commit = readStep1Commit();
  if (!commit) return { applied: false, code: 'CHECKOUT_STATE_MISSING' };

  if (Array.isArray(commit.products) && commit.products.length) {
    state.source = commit.source || state.source;
    state.products = commit.products.map(normalizeProduct).filter(Boolean);
  }

  const deliveryMethodKey = String(
    commit.deliveryMethodKey
    || commit.shipping?.deliveryMethodKey
    || state.deliveryMethodKey
    || 'homeDelivery'
  );

  state.shipping = {
    ...clone(DEFAULT_ADDRESS),
    ...clone(commit.shipping || {}),
    deliveryMethodKey,
    phone: normalizePhone(commit.shipping?.phone || ''),
    note: String(commit.shipping?.note == null ? '' : commit.shipping.note).trim()
  };
  state.deliveryMethodKey = deliveryMethodKey;
  state.step = commit.step && STEPS.some((s) => s.id === commit.step) ? commit.step : 'review';

  if (commit.customer && typeof commit.customer === 'object') {
    state.customer = { ...state.customer, ...commit.customer };
  }
  if (commit.payment && typeof commit.payment === 'object') {
    state.payment = { method: 'dpo', phone: '', ...commit.payment };
  }
  if (commit.coupon && typeof commit.coupon === 'object') {
    state.coupon = {
      code: '',
      title: '',
      discountAmount: 0,
      status: '',
      ...commit.coupon
    };
  }

  return { applied: true, code: 'OK', commit };
}

function shippingForValidation(shipping = state.shipping) {
  return { ...shipping };
}

function hasValidStep1Commit() {
  const commit = readStep1Commit();
  if (!commit) return false;
  return validateShipping(shippingForValidation(commit.shipping)).valid
    && Array.isArray(commit.products)
    && commit.products.length > 0;
}

function readHandoff() {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.at || Date.now() - Number(parsed.at) > HANDOFF_TTL_MS) {
      sessionStorage.removeItem(HANDOFF_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearCheckoutHandoff() {
  try {
    sessionStorage.removeItem(HANDOFF_KEY);
  } catch (_) { /* ignore */ }
}

function applyHandoff() {
  const handoff = readHandoff();
  if (!handoff) return false;

  if (Array.isArray(handoff.products) && handoff.products.length) {
    state.source = handoff.source || state.source;
    state.products = handoff.products.map(normalizeProduct).filter(Boolean);
  }

  if (handoff.shipping && typeof handoff.shipping === 'object') {
    state.shipping = mergeShippingPreferFilled(state.shipping, handoff.shipping);
  }

  if (handoff.deliveryMethodKey) {
    state.deliveryMethodKey = String(handoff.deliveryMethodKey);
  }

  if (handoff.payment) {
    state.payment = { method: 'dpo', phone: '', ...handoff.payment };
  }

  if (handoff.coupon && typeof handoff.coupon === 'object') {
    state.coupon = {
      code: '',
      title: '',
      discountAmount: 0,
      status: '',
      ...handoff.coupon
    };
  }

  if (handoff.step && STEPS.some((s) => s.id === handoff.step)) {
    state.step = handoff.step;
  }

  return true;
}

function readActiveDraft() {
  return readPersistedDraft() || readStorage(STORAGE_KEYS.draft, null) || readHandoff();
}

function persistDraft() {
  writeStorage(STORAGE_KEYS.draft, {
    step: state.step,
    source: state.source,
    products: state.products,
    shipping: state.shipping,
    deliveryMethodKey: state.deliveryMethodKey,
    payment: state.payment,
    coupon: state.coupon,
    updatedAt: Date.now()
  });
  writeHandoff();
}

function recalcTotals() {
  const subtotal = state.products.reduce(
    (sum, p) => sum + (Number(p.price) || 0) * Math.max(1, Number(p.qty || p.quantity) || 1),
    0
  );
  const discount = state.products.reduce((sum, p) => {
    const price = Number(p.price) || 0;
    const compare = Number(p.comparePrice || p.oldPrice) || 0;
    const qty = Math.max(1, Number(p.qty || p.quantity) || 1);
    if (compare > price) {
      return sum + (compare - price) * qty;
    }
    return sum;
  }, 0);
  const deliveryFee = Math.max(0, Number(runtimeDeliveryFee) || 0);
  const codFee = state.payment.method === 'cod' ? COD_FEE : 0;
  const tax = 0;
  const couponDiscount = Math.max(0, Number(state.coupon?.discountAmount || 0));
  state.totals = {
    subtotal,
    discount,
    couponDiscount,
    couponCode: state.coupon?.code || '',
    tax,
    deliveryFee,
    codFee,
    total: Math.max(0, subtotal - couponDiscount) + deliveryFee + codFee
  };
}

export function setDeliveryQuote({ fee, estimate } = {}) {
  if (estimate != null) state.deliveryEstimate = String(estimate || '');
  if (fee != null && Number.isFinite(Number(fee))) {
    runtimeDeliveryFee = Math.max(0, Number(fee));
  }
  recalcTotals();
  emit({ type: 'delivery' });
  return getState();
}

function applyConfiguredDeliveryFee() {
  let fee = DELIVERY_FEE;
  try {
    const configured = Number(window.ByoseStoreSettings?.delivery?.pricing?.fixedFee);
    if (Number.isFinite(configured) && configured >= 0) {
      fee = configured;
    } else if (typeof window.ByoseShippingApi?.resolveDefaultFee === 'function') {
      const resolved = Number(window.ByoseShippingApi.resolveDefaultFee());
      if (Number.isFinite(resolved) && resolved >= 0) fee = resolved;
    }
  } catch (_error) {
    fee = DELIVERY_FEE;
  }
  runtimeDeliveryFee = Math.max(0, fee);
  recalcTotals();
}

function normalizeProduct(item) {
  if (!item || typeof item !== 'object') return null;
  const qty = Math.max(1, Number(item.qty || item.quantity) || 1);
  const price = Number(item.price) || 0;
  const comparePrice = Number(item.comparePrice || item.oldPrice) || 0;
  const colorId = String(item.colorId || item.variantSelection?.colorId || item.attributes?.Color || '').trim();
  const sizeValue = String(item.sizeValue || item.variantSelection?.sizeValue || item.attributes?.Size || '').trim();
  let sizeLabel = String(item.sizeLabel || item.size || item.variantSelection?.size || '').trim();
  // Display helpers sometimes prefix "Size "; stock matching must keep the raw size.
  if (/^size\s+/i.test(sizeLabel)) {
    sizeLabel = sizeLabel.replace(/^size\s+/i, '').trim();
  }
  return {
    ...item,
    id: String(item.id || item.productId || ''),
    productId: String(item.productId || item.id || ''),
    name: String(item.name || 'Product'),
    price,
    comparePrice: comparePrice > price ? comparePrice : 0,
    oldPrice: comparePrice > price ? comparePrice : 0,
    qty,
    quantity: qty,
    image: item.image || item.img || item.productImage || '',
    colorImage: item.colorImage || item.variantSelection?.colorImage || '',
    productImage: item.productImage || item.image || '',
    color: item.color || item.colorName || '',
    colorName: item.colorName || item.color || '',
    colorId,
    size: sizeLabel || sizeValue,
    sizeLabel: sizeLabel || sizeValue,
    sizeValue: sizeValue || sizeLabel,
    variantKey: String(item.variantKey || ''),
    slug: String(item.slug || ''),
    category: String(item.category || ''),
    sku: String(item.variantSku || item.sku || ''),
    variantSku: String(item.variantSku || item.sku || ''),
    total: price * qty
  };
}

function loadProducts() {
  // Explicit cart checkout selection always beats a leftover Buy Now payload.
  const checkoutActive = readStorage(STORAGE_KEYS.checkoutActive, []);
  if (Array.isArray(checkoutActive) && checkoutActive.length) {
    const items = checkoutActive.map(normalizeProduct).filter(Boolean);
    if (items.length) {
      state.source = 'cart';
      state.products = items;
      return;
    }
  }

  const direct = readDirectCheckout() || readPersistedDirectCheckout();
  if (direct) {
    const list = Array.isArray(direct) ? direct : [direct];
    const items = list.map(normalizeProduct).filter(Boolean);
    if (items.length) {
      state.source = 'direct';
      state.products = items;
      return;
    }
  }

  const cart = readStorage(STORAGE_KEYS.cart, []).map(normalizeProduct).filter(Boolean);
  if (cart.length) {
    state.source = 'cart';
    state.products = cart;
    return;
  }

  const draft = readPersistedDraft() || readStorage(STORAGE_KEYS.draft, null);
  if (draft?.products?.length) {
    state.source = draft.source || 'cart';
    state.products = draft.products.map(normalizeProduct).filter(Boolean);
  }

  const handoff = readHandoff();
  if ((!state.products.length || !draft) && handoff?.products?.length) {
    applyHandoff();
  }
}

function loadCustomer() {
  const user = readCurrentUser();
  if (!user) return;
  state.customer = {
    id: String(user.id || user._id || ''),
    name: String(user.name || user.fullName || '').trim(),
    email: String(user.email || '').trim(),
    phone: normalizePhone(user.phone || ''),
    avatar: String(user.avatar || user.image || '').trim()
  };
}

function loadShipping() {
  const draft = readActiveDraft();
  const fromDraft = draft?.shipping || draft?.shippingAddress;
  const user = readCurrentUser();
  const saved = getUserAddress(user);
  const savedFullName = [saved.firstName, saved.lastName].filter(Boolean).join(' ').trim();
  const baseline = {
    ...clone(DEFAULT_ADDRESS),
    fullName: savedFullName || String(user?.name || '').trim(),
    phone: normalizePhone(saved.phone || user?.phone || ''),
    provinceCity: saved.city || '',
    district: saved.district || '',
    sector: saved.sector || '',
    cell: saved.cell || '',
    village: saved.village || '',
    note: saved.street || ''
  };
  const current = state.shipping && typeof state.shipping === 'object' ? state.shipping : {};
  // Prefer already-applied handoff values over stale drafts/profile defaults.
  state.shipping = mergeShippingPreferFilled(
    mergeShippingPreferFilled(baseline, fromDraft || {}),
    current
  );
  if (state.customer.name && !state.shipping.fullName) {
    state.shipping.fullName = state.customer.name;
  }
  if (draft?.deliveryMethodKey) {
    state.deliveryMethodKey = String(draft.deliveryMethodKey);
  }
  if (!state.shipping.deliveryMethodKey) {
    state.shipping.deliveryMethodKey = state.deliveryMethodKey || 'homeDelivery';
  }
}

function loadPayment() {
  const draft = readActiveDraft();
  if (draft?.payment) {
    state.payment = { method: 'dpo', phone: '', ...draft.payment };
  }
  if (!state.payment.phone) {
    state.payment.phone = state.shipping.phone || state.customer.phone;
  }
}

function readSelectedCouponFromAccount() {
  try {
    const raw = window.localStorage.getItem('byose_selected_coupon_v1');
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

function loadCoupon() {
  const draft = readActiveDraft();
  if (draft?.coupon?.code) {
    state.coupon = {
      code: String(draft.coupon.code || '').toUpperCase(),
      title: String(draft.coupon.title || ''),
      discountAmount: Number(draft.coupon.discountAmount || 0),
      status: String(draft.coupon.status || '')
    };
    return;
  }

  const selected = readSelectedCouponFromAccount();
  if (selected?.code) {
    state.coupon = {
      code: String(selected.code || '').toUpperCase(),
      title: String(selected.title || ''),
      discountAmount: 0,
      status: 'pending'
    };
  }
}

export async function applyCheckoutCoupon(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) {
    return { ok: false, message: 'Enter a coupon code.' };
  }

  const token = window.authService?.getToken?.() || window.localStorage?.getItem('bm_auth_token') || '';
  if (!token) {
    return { ok: false, message: 'Sign in to use a coupon.' };
  }

  recalcTotals();
  const subtotal = Number(state.totals.subtotal || 0);
  const items = state.products.map((product) => ({
    productId: product.productId || product.id,
    id: product.id,
    category: product.category || '',
    quantity: product.qty || product.quantity || 1,
    price: product.price
  }));

  try {
    const response = await (window.authService?.authFetch
      ? window.authService.authFetch(`${resolveApiOrigin()}/api/coupons/validate`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ code: normalized, orderAmount: subtotal, subtotal, items })
        })
      : fetch(`${resolveApiOrigin()}/api/coupons/validate`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ code: normalized, orderAmount: subtotal, subtotal, items })
        }));
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
      return { ok: false, message: payload?.message || 'This coupon cannot be applied.' };
    }

    state.coupon = {
      code: String(payload.coupon?.code || normalized).toUpperCase(),
      title: String(payload.coupon?.title || ''),
      discountAmount: Number(payload.discountAmount || 0),
      status: 'applied'
    };
    try {
      window.localStorage.setItem('byose_selected_coupon_v1', JSON.stringify({
        code: state.coupon.code,
        title: state.coupon.title,
        savedAt: new Date().toISOString()
      }));
    } catch (_error) {}

    recalcTotals();
    persistDraft();
    emit('coupon-changed');
    return { ok: true, coupon: state.coupon, totals: getState().totals };
  } catch (_error) {
    return { ok: false, message: 'Unable to validate coupon right now.' };
  }
}

export function clearCheckoutCoupon() {
  state.coupon = { code: '', title: '', discountAmount: 0, status: '' };
  try {
    window.localStorage.removeItem('byose_selected_coupon_v1');
  } catch (_error) {}
  recalcTotals();
  persistDraft();
  emit('coupon-changed');
}

export async function initCheckout(preferredStep) {
  const wantsReviewOrPayment = preferredStep === 'review' || preferredStep === 'payment';

  // Authoritative Step 1 payload wins before any profile/draft merges.
  if (wantsReviewOrPayment) {
    applyStep1Commit();
  }

  loadProducts();
  applyHandoff();

  // If handoff/products still empty, re-apply commit (covers session-only handoff loss).
  if (wantsReviewOrPayment && !state.products.length) {
    applyStep1Commit();
  }

  loadCustomer();

  const commitLocked = wantsReviewOrPayment && hasValidStep1Commit();
  if (commitLocked) {
    // Re-apply so loadCustomer cannot leave empties that later merges misuse.
    applyStep1Commit();
  } else {
    loadShipping();
  }

  loadPayment();
  loadCoupon();
  if (preferredStep && STEPS.some((s) => s.id === preferredStep)) {
    state.step = preferredStep;
  }
  applyConfiguredDeliveryFee();
  state.initialized = true;
  emit('init');

  // Always revalidate applied/selected coupons against the current cart totals.
  if (state.coupon?.code) {
    void applyCheckoutCoupon(state.coupon.code).then((result) => {
      if (!result?.ok) {
        clearCheckoutCoupon();
      }
      emit('coupon-changed');
    });
  }

  // Hydrate from server in background — never block step navigation on network I/O.
  // Never let remote/draft merges wipe a valid Step 1 commit.
  void hydrateStorefrontState().then((remote) => {
    if (!remote) return;

    const checkoutActive = readStorage(STORAGE_KEYS.checkoutActive, []);
    const hasCartCheckout = Array.isArray(checkoutActive) && checkoutActive.length > 0;
    // Keep cart checkout selection stable if a stale remote Buy Now payload arrives.
    if (hasCartCheckout) {
      removeStorage(STORAGE_KEYS.directCheckout);
    }

    const previousSource = state.source;
    const previousProducts = state.products.slice();
    const lockedCommit = hasValidStep1Commit();
    const lockedShipping = lockedCommit ? clone(state.shipping) : null;
    const lockedDelivery = lockedCommit ? state.deliveryMethodKey : null;
    const lockedStep = lockedCommit ? state.step : null;

    loadProducts();

    if (
      hasCartCheckout
      && previousSource === 'cart'
      && previousProducts.length
      && state.source === 'direct'
    ) {
      state.source = previousSource;
      state.products = previousProducts;
    }

    loadCustomer();
    if (lockedCommit) {
      applyStep1Commit();
      if (lockedShipping) state.shipping = lockedShipping;
      if (lockedDelivery) state.deliveryMethodKey = lockedDelivery;
      if (lockedStep) state.step = lockedStep;
    } else {
      loadShipping();
    }
    loadPayment();
    loadCoupon();
    recalcTotals();
    if (state.coupon?.code) {
      void applyCheckoutCoupon(state.coupon.code).then((result) => {
        if (!result?.ok) clearCheckoutCoupon();
        emit('coupon-changed');
      });
    }
    emit('hydrated');
  }).catch(() => null);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return clone(state);
}

export function getStepIndex(stepId) {
  return STEPS.findIndex((s) => s.id === stepId);
}

export function getStepUrl(stepId) {
  const step = STEPS.find((s) => s.id === stepId);
  return step ? step.file : 'shipping.html';
}

export function setStep(stepId) {
  if (STEPS.some((s) => s.id === stepId)) {
    state.step = stepId;
    persistDraft();
    emit('step-changed');
  }
}

export function guardStep(stepId) {
  // Prefer the authoritative Step 1 commit for Review/Payment — never bounce
  // a just-validated Continue if that payload is intact.
  if (stepId === 'review' || stepId === 'payment') {
    const applied = applyStep1Commit();
    if (applied.applied) {
      const productsCheck = validateProducts(state.products);
      if (!productsCheck.valid) {
        console.warn('REDIRECT_REASON', 'CHECKOUT_STATE_MISSING', productsCheck.message);
        return {
          ok: false,
          redirect: '../cart.html',
          code: 'CHECKOUT_STATE_MISSING',
          message: productsCheck.message
        };
      }
      const shippingCheck = validateShipping(shippingForValidation(state.shipping));
      if (shippingCheck.valid) {
        state.step = stepId === 'payment' ? 'payment' : 'review';
        return { ok: true, code: 'OK' };
      }
      console.warn('REDIRECT_REASON', 'VALIDATION_FAILED', shippingCheck.errors);
    }
  }

  const hadHandoff = applyHandoff();

  const productsCheck = validateProducts(state.products);
  if (!productsCheck.valid) {
    console.warn('REDIRECT_REASON', 'CHECKOUT_STATE_MISSING', productsCheck.message);
    return {
      ok: false,
      redirect: '../cart.html',
      code: 'CHECKOUT_STATE_MISSING',
      message: productsCheck.message
    };
  }

  if (stepId === 'shipping') return { ok: true, code: 'OK' };

  const draft = readActiveDraft();
  const fromDraft = draft?.shipping || draft?.shippingAddress;
  if (fromDraft && typeof fromDraft === 'object') {
    // Never let a stale/partial draft wipe a complete handoff address.
    state.shipping = mergeShippingPreferFilled(state.shipping, fromDraft);
  }

  if (hadHandoff && (state.step === 'review' || state.step === 'payment')) {
    if (stepId === 'review' || stepId === 'payment') {
      const shippingCheck = validateShipping(shippingForValidation(state.shipping));
      if (shippingCheck.valid) {
        return { ok: true, code: 'OK' };
      }
    }
  }

  if (stepId === 'review' && (draft?.step === 'review' || draft?.step === 'payment')) {
    const shippingCheck = validateShipping(shippingForValidation(state.shipping));
    if (shippingCheck.valid) return { ok: true, code: 'OK' };
  }

  if (stepId === 'payment' && (draft?.step === 'payment' || draft?.step === 'review')) {
    const shippingCheck = validateShipping(shippingForValidation(state.shipping));
    if (shippingCheck.valid) return { ok: true, code: 'OK' };
  }

  if (state.step === 'review' && stepId === 'review' && validateShipping(shippingForValidation(state.shipping)).valid) {
    return { ok: true, code: 'OK' };
  }

  if (state.step === 'payment' && stepId === 'payment' && validateShipping(shippingForValidation(state.shipping)).valid) {
    return { ok: true, code: 'OK' };
  }

  const shippingCheck = validateShipping(shippingForValidation(state.shipping));
  if (!shippingCheck.valid) {
    console.warn('REDIRECT_REASON', 'VALIDATION_FAILED', shippingCheck.errors);
    return {
      ok: false,
      redirect: 'shipping.html',
      code: 'VALIDATION_FAILED',
      errors: shippingCheck.errors
    };
  }

  return { ok: true, code: 'OK' };
}

export function updateShipping(patch) {
  state.shipping = { ...state.shipping, ...patch };
  if (patch.phone) state.shipping.phone = normalizePhone(patch.phone);
  persistDraft();
  emit('shipping-changed');
}

/**
 * Single authoritative Step 1 → Step 2 commit.
 * Validates, persists a dual-written commit payload, verifies read-back, then
 * returns a redirect URL. Does not navigate — caller must assign location.
 */
export function continueToReview(formData = {}) {
  const data = { ...(formData || {}) };

  const check = validateShipping(data);
  if (!check.valid) {
    return {
      ok: false,
      valid: false,
      code: 'VALIDATION_FAILED',
      errors: check.errors
    };
  }

  const productsCheck = validateProducts(state.products);
  if (!productsCheck.valid) {
    return {
      ok: false,
      valid: false,
      code: 'CHECKOUT_STATE_MISSING',
      message: productsCheck.message || 'Your cart is empty. Add a product first.',
      errors: {}
    };
  }

  // Preserve optional GPS only — never required for navigation.
  const gpsFields = {
    latitude: state.shipping.latitude || '',
    longitude: state.shipping.longitude || '',
    mapLink: state.shipping.mapLink || '',
    locationAccuracy: state.shipping.locationAccuracy || '',
    locationCapturedAt: state.shipping.locationCapturedAt || ''
  };

  applyConfiguredDeliveryFee();

  // Latest typed values win completely (no merge with stale empties).
  state.shipping = {
    ...clone(DEFAULT_ADDRESS),
    fullName: String(data.fullName || '').trim(),
    phone: normalizePhone(data.phone),
    provinceCity: String(data.provinceCity || '').trim(),
    district: String(data.district || '').trim(),
    sector: String(data.sector || '').trim(),
    cell: String(data.cell || '').trim(),
    village: String(data.village || '').trim(),
    note: String(data.note == null ? '' : data.note).trim(),
    ...gpsFields
  };
  state.deliveryMethodKey = 'homeDelivery';
  state.step = 'review';

  const payload = buildStep1CommitPayload();
  const saved = writeStep1Commit(payload);
  if (!saved.ok) {
    return {
      ok: false,
      valid: false,
      code: 'STATE_SAVE_FAILED',
      message: 'Could not save checkout state in this browser.',
      errors: {}
    };
  }

  const verified = readStep1Commit();
  if (!verified || !validateShipping(shippingForValidation(verified.shipping)).valid) {
    return {
      ok: false,
      valid: false,
      code: 'STATE_SAVE_FAILED',
      message: 'Checkout state could not be verified after save.',
      errors: {}
    };
  }

  persistUserAddress(state.shipping);
  persistDraft();
  writeHandoff();
  emit('shipping-changed');

  return {
    ok: true,
    valid: true,
    code: 'OK',
    shipping: clone(state.shipping),
    step: state.step,
    redirectUrl: `./checkout.html?from=shipping&t=${Date.now()}`
  };
}

/** @deprecated Use continueToReview — kept for callers/tests that still import commitShipping. */
export function commitShipping(formData) {
  const result = continueToReview(formData);
  if (!result.ok) {
    return { valid: false, errors: result.errors || {}, code: result.code, message: result.message };
  }
  return { valid: true, shipping: result.shipping, step: result.step, code: 'OK' };
}

export function updateProductQty(productId, variantKey, qty) {
  const nextRaw = Math.max(0, Number(qty) || 0);
  if (nextRaw === 0) {
    state.products = state.products.filter(
      (p) => !(String(p.id) === String(productId) && String(p.variantKey || '') === String(variantKey || ''))
    );
  } else {
    state.products = state.products.map((p) => {
      if (String(p.id) === String(productId) && String(p.variantKey || '') === String(variantKey || '')) {
        const stockCandidates = [p.availableStock, p.stock, p.inventorySnapshot?.available];
        let max = Number.POSITIVE_INFINITY;
        for (const candidate of stockCandidates) {
          const n = Number(candidate);
          if (Number.isFinite(n) && n >= 0) {
            max = n;
            break;
          }
        }
        const next = Math.min(nextRaw, Number.isFinite(max) ? Math.max(1, max) : nextRaw);
        const item = { ...p, qty: next, quantity: next, total: (Number(p.price) || 0) * next };
        return item;
      }
      return p;
    });
  }
  recalcTotals();
  persistDraft();

  // Keep cart checkout selection in sync when quantities change on Review.
  const checkoutActive = readStorage(STORAGE_KEYS.checkoutActive, []);
  if (Array.isArray(checkoutActive) && checkoutActive.length) {
    writeStorage(STORAGE_KEYS.checkoutActive, state.products);
  }

  emit('products-changed');
}

export function setSubmitting(value) {
  state.isSubmitting = Boolean(value);
  emit('submitting-changed');
}

export function setPaymentMethod(method) {
  state.payment.method = String(method || '').toLowerCase();
  recalcTotals();
  persistDraft();
  emit('payment-changed');
}

export function setPaymentPhone(phone) {
  state.payment.phone = normalizePhone(phone);
  persistDraft();
  emit('payment-changed');
}

export function isCodAvailable() {
  const city = String(state.shipping.provinceCity || '').toLowerCase();
  return city.includes('kigali');
}

export async function loadGatewayPaymentConfig() {
  try {
    const base = resolveApiOrigin();
    if (!base) {
      state.gateway = { dpoEnabled: false, dpoLabel: 'Pay Online (DPO)', loaded: true };
      return state.gateway;
    }
    const endpoint = base.endsWith('/api')
      ? `${base}/payments/dpo/config`
      : `${base}/api/payments/dpo/config`;
    const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => null);
    const enabled = Boolean(response.ok && payload?.success && payload?.dpo?.enabled);
    state.gateway = {
      dpoEnabled: enabled,
      dpoLabel: String(payload?.dpo?.label || 'Pay Online (DPO)'),
      loaded: true
    };
    if (!enabled && state.payment.method === 'dpo') {
      state.payment.method = 'mtn';
    }
    emit('gateway-config');
    return state.gateway;
  } catch (_error) {
    state.gateway = { dpoEnabled: false, dpoLabel: 'Pay Online (DPO)', loaded: true };
    if (state.payment.method === 'dpo') {
      state.payment.method = 'mtn';
    }
    return state.gateway;
  }
}

export function getPaymentMethods() {
  return PAYMENT_METHODS.filter((m) => {
    if (!m.enabled) return false;
    if (m.id === 'cod' && !isCodAvailable()) return false;
    if (m.id === 'dpo' && !state.gateway?.dpoEnabled) return false;
    return true;
  }).map((method) => {
    if (method.id !== 'dpo') return method;
    return {
      ...method,
      label: state.gateway?.dpoLabel || method.label
    };
  });
}

export function getConfirmation() {
  return readCheckoutConfirmation();
}

export { formatCurrency, STEPS, PAYMENT_METHODS };
