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
  saveCheckoutConfirmation,
  writeCartItems,
  writeStorage
} from '../utils.js';
import { COD_FEE, DELIVERY_FEE, PAYMENT_METHODS, STEPS } from './constants.js';
import { validateProducts, validateShipping } from './validation.js';

const listeners = new Set();
const HANDOFF_KEY = 'byose_checkout_handoff_v1';
const HANDOFF_TTL_MS = 30 * 60 * 1000;

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
  delivery: 'delivery',
  payment: { method: 'mtn', phone: '' },
  totals: { subtotal: 0, deliveryFee: DELIVERY_FEE, codFee: 0, total: DELIVERY_FEE }
};

function emit(event) {
  listeners.forEach((fn) => {
    try { fn(event, getState()); } catch (e) { console.error(e); }
  });
}

function writeHandoff() {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({
      step: state.step,
      source: state.source,
      products: state.products,
      shipping: state.shipping,
      delivery: state.delivery,
      payment: state.payment,
      at: Date.now()
    }));
  } catch (_) { /* sessionStorage may be unavailable */ }
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
    state.shipping = {
      ...state.shipping,
      ...handoff.shipping,
      phone: normalizePhone(handoff.shipping.phone || state.shipping.phone)
    };
  }

  if (handoff.delivery) {
    state.delivery = handoff.delivery;
  }

  if (handoff.payment) {
    state.payment = { method: 'mtn', phone: '', ...handoff.payment };
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
    delivery: state.delivery,
    payment: state.payment
  });
  writeHandoff();
}

function recalcTotals() {
  const subtotal = state.products.reduce(
    (sum, p) => sum + (Number(p.price) || 0) * Math.max(1, Number(p.qty || p.quantity) || 1),
    0
  );
  const deliveryFee = state.delivery === 'pickup' ? 0 : DELIVERY_FEE;
  const codFee = state.payment.method === 'cod' ? COD_FEE : 0;
  state.totals = { subtotal, deliveryFee, codFee, total: subtotal + deliveryFee + codFee };
}

function normalizeProduct(item) {
  if (!item || typeof item !== 'object') return null;
  const qty = Math.max(1, Number(item.qty || item.quantity) || 1);
  const price = Number(item.price) || 0;
  return {
    ...item,
    id: String(item.id || item.productId || ''),
    productId: String(item.productId || item.id || ''),
    name: String(item.name || 'Product'),
    price,
    qty,
    quantity: qty,
    image: item.image || item.img || item.productImage || '',
    colorImage: item.colorImage || item.variantSelection?.colorImage || '',
    productImage: item.productImage || item.image || '',
    color: item.color || item.colorName || '',
    colorName: item.colorName || item.color || '',
    size: item.size || item.sizeLabel || '',
    sizeLabel: item.sizeLabel || item.size || '',
    variantKey: String(item.variantKey || ''),
    total: price * qty
  };
}

function loadProducts() {
  const direct = readDirectCheckout() || readPersistedDirectCheckout();
  if (direct) {
    const item = normalizeProduct(direct);
    if (item) {
      state.source = 'direct';
      state.products = [item];
      return;
    }
  }

  const cart = readCartItems().map(normalizeProduct).filter(Boolean);
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
  state.shipping = {
    ...clone(DEFAULT_ADDRESS),
    fullName: savedFullName || String(user?.name || '').trim(),
    phone: normalizePhone(saved.phone || user?.phone || ''),
    provinceCity: saved.city || '',
    district: saved.district || '',
    sector: saved.sector || '',
    cell: saved.cell || '',
    village: saved.village || '',
    note: saved.street || '',
    ...(fromDraft || {}),
    phone: normalizePhone(fromDraft?.phone || saved.phone || user?.phone || state.customer.phone || '')
  };
  if (state.customer.name && !state.shipping.fullName) {
    state.shipping.fullName = state.customer.name;
  }
}

function loadPayment() {
  const draft = readActiveDraft();
  if (draft?.payment) {
    state.payment = { method: 'mtn', phone: '', ...draft.payment };
  }
  if (!state.payment.phone) {
    state.payment.phone = state.shipping.phone || state.customer.phone;
  }
  if (draft?.delivery) {
    state.delivery = draft.delivery;
  }
}

export async function initCheckout(preferredStep) {
  loadProducts();
  applyHandoff();
  loadCustomer();
  loadShipping();
  loadPayment();
  if (preferredStep && STEPS.some((s) => s.id === preferredStep)) {
    state.step = preferredStep;
  }
  recalcTotals();
  state.initialized = true;
  emit('init');

  // Hydrate from server in background — never block step navigation on network I/O.
  void hydrateStorefrontState().then((remote) => {
    if (!remote) return;
    loadProducts();
    loadCustomer();
    loadShipping();
    loadPayment();
    recalcTotals();
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
  applyHandoff();

  const productsCheck = validateProducts(state.products);
  if (!productsCheck.valid) {
    return { ok: false, redirect: '../cart.html', message: productsCheck.message };
  }

  if (stepId === 'shipping') return { ok: true };

  const draft = readActiveDraft();
  if (draft?.shipping || draft?.shippingAddress) {
    const fromDraft = draft.shipping || draft.shippingAddress;
    state.shipping = {
      ...state.shipping,
      ...fromDraft,
      phone: normalizePhone(fromDraft.phone || state.shipping.phone)
    };
  }

  if (stepId === 'review' && (draft?.step === 'review' || draft?.step === 'payment')) {
    return { ok: true };
  }

  if (stepId === 'payment' && (draft?.step === 'payment' || draft?.step === 'review')) {
    return { ok: true };
  }

  if (state.step === 'review' && stepId === 'review' && validateShipping(state.shipping).valid) {
    return { ok: true };
  }

  if (state.step === 'payment' && stepId === 'payment' && validateShipping(state.shipping).valid) {
    return { ok: true };
  }

  const shippingCheck = validateShipping(state.shipping);
  if (!shippingCheck.valid) {
    return { ok: false, redirect: 'shipping.html', errors: shippingCheck.errors };
  }

  return { ok: true };
}

export function updateShipping(patch) {
  state.shipping = { ...state.shipping, ...patch };
  if (patch.phone) state.shipping.phone = normalizePhone(patch.phone);
  persistDraft();
  emit('shipping-changed');
}

export function commitShipping(formData) {
  const check = validateShipping(formData);
  if (!check.valid) return check;
  state.shipping = { ...state.shipping, ...formData };
  state.shipping.phone = normalizePhone(formData.phone);
  state.step = 'review';
  persistUserAddress(state.shipping);
  persistDraft();
  emit('shipping-changed');
  return { valid: true };
}

export function updateProductQty(productId, variantKey, qty) {
  const next = Math.max(0, Number(qty) || 0);
  if (next === 0) {
    state.products = state.products.filter(
      (p) => !(String(p.id) === String(productId) && String(p.variantKey || '') === String(variantKey || ''))
    );
  } else {
    state.products = state.products.map((p) => {
      if (String(p.id) === String(productId) && String(p.variantKey || '') === String(variantKey || '')) {
        const item = { ...p, qty: next, quantity: next, total: (Number(p.price) || 0) * next };
        return item;
      }
      return p;
    });
  }
  recalcTotals();
  persistDraft();
  emit('products-changed');
}

export function setDelivery(method) {
  state.delivery = method === 'pickup' ? 'pickup' : 'delivery';
  recalcTotals();
  persistDraft();
  emit('delivery-changed');
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

export function getPaymentMethods() {
  return PAYMENT_METHODS.filter((m) => m.enabled && (m.id !== 'cod' || isCodAvailable()));
}

export function getConfirmation() {
  return readCheckoutConfirmation();
}

export { formatCurrency, STEPS, PAYMENT_METHODS };
