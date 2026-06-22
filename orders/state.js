import {
  STORAGE_KEYS,
  clone,
  createOrderId,
  clearPendingOrderSubmission,
  delay,
  emitCartUpdated,
  formatCurrency,
  getUserAddress,
  hydrateStorefrontState,
  isValidPhone,
  normalizePhone,
  persistUserAddress,
  readCartItems,
  readCheckoutConfirmation,
  readCurrentUser,
  readDirectCheckout,
  readPendingOrderSubmission,
  readStorage,
  removeStorage,
  resolveApiOrigin,
  resolveOrderItemImage,
  savePendingOrderSubmission,
  saveCheckoutConfirmation,
  writeCartItems,
  writeDirectCheckout,
  writeStorage
} from './utils.js';
import {
  CHECKOUT_FOUNDATION_VERSION,
  buildOrderPreparationArtifacts,
  validateCheckoutInventory
} from './checkout-foundation.js';
import {
  buildTransactionPreparation,
  getGatewayPreparationBlueprint,
  getPaymentMethodById,
  getPaymentStateMeta,
  normalizePaymentMethod,
  normalizePaymentState,
  resolvePaymentMethodLabel,
  validateTransactionPreparation
} from './payment-foundation.js';

const DELIVERY_OPTIONS = [
  {
    id: 'delivery',
    label: 'Delivery to address',
    description: 'Ship the full order to the address confirmed in the shipping stage.',
    fee: 5000
  },
  {
    id: 'pickup',
    label: 'Store pickup',
    description: 'Pick up the order directly from the store with no delivery fee.',
    fee: 0
  }
];

const STAGES = ['shipping', 'checkout', 'payment'];
const FIELD_LABELS = {
  fullName: 'Amazina / Full Name',
  phone: 'Telefoni / Phone Number',
  provinceCity: 'Intara cyangwa Umujyi / Province or City',
  district: 'Akarere / District',
  sector: 'Umurenge / Sector',
  cell: 'Akagari / Cell',
  village: 'Umudugudu / Village'
};
const REQUIRED_SHIPPING_FIELDS = ['fullName', 'phone', 'provinceCity', 'district', 'sector', 'cell', 'village'];

const DEFAULT_ADDRESS = {
  fullName: '',
  firstName: '',
  lastName: '',
  phone: '',
  provinceCity: '',
  city: '',
  district: '',
  sector: '',
  cell: '',
  village: '',
  street: '',
  note: '',
  latitude: '',
  longitude: '',
  mapLink: '',
  locationAccuracy: '',
  locationCapturedAt: ''
};

const DEFAULT_PAYMENT = {
  paymentType: 'pay_now',
  method: '',
  state: 'pending',
  phone: '',
  payerPhone: '',
  transactionId: ''
};

const COD_FEE = 2000;
const SUBMISSION_DELAY_MS = 900;
const ORDER_REQUEST_TIMEOUT_MS = 12000;
const ORDER_REQUEST_MAX_ATTEMPTS = 2;
const PENDING_ORDER_MAX_AGE_MS = 15 * 60 * 1000;
const listeners = new Set();
let activeSubmissionNonce = 0;

const state = {
  initialized: false,
  isSubmitting: false,
  currentStep: 0,
  currentStage: 'shipping',
  source: 'cart',
  products: [],
  customer: {
    id: '',
    name: '',
    email: '',
    phone: '',
    avatar: ''
  },
  shippingAddress: clone(DEFAULT_ADDRESS),
  delivery: clone(DELIVERY_OPTIONS[0]),
  payment: clone(DEFAULT_PAYMENT),
  confirmation: null,
  totals: {
    subtotal: 0,
    shippingFee: DELIVERY_OPTIONS[0].fee,
    codFee: 0,
    total: DELIVERY_OPTIONS[0].fee
  },
  foundation: {
    version: CHECKOUT_FOUNDATION_VERSION,
    reason: 'boot',
    updatedAt: '',
    inventoryValid: true,
    inventoryErrors: 0,
    cartLineCount: 0,
    cartQuantity: 0
  }
};

function getOrdersApiUrl() {
  const configuredBase = resolveApiOrigin();
  if (configuredBase) {
    return configuredBase.endsWith('/api') ? `${configuredBase}/orders` : `${configuredBase}/api/orders`;
  }

  if (/^https?:$/i.test(String(window.location.protocol || ''))) {
    return `${window.location.origin}/api/orders`;
  }

  return '';
}

async function persistOrderToServer(order, options = {}) {
  const endpoint = getOrdersApiUrl();
  if (!endpoint) {
    return { skipped: true };
  }

  const latestSubmissionNonce = Number(options?.submissionNonce || 0);
  const isCurrentSubmission = () => latestSubmissionNonce > 0 && latestSubmissionNonce === activeSubmissionNonce;

  for (let attempt = 1; attempt <= ORDER_REQUEST_MAX_ATTEMPTS; attempt += 1) {
    if (latestSubmissionNonce && !isCurrentSubmission()) {
      return { cancelled: true, message: 'A newer checkout submission is already active.' };
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
      ? window.setTimeout(() => controller.abort(new Error('Order request timeout')), ORDER_REQUEST_TIMEOUT_MS)
      : 0;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(order),
        ...(controller ? { signal: controller.signal } : {})
      });

      const payload = await response.json().catch(() => null);

      if (response.ok) {
        return payload && typeof payload === 'object' ? payload : { success: true, order };
      }

      const message = String(payload?.message || '').trim();
      const isDuplicateOrder = response.status === 409 && payload?.order && String(payload.order.orderId || payload.order.id || '') === String(order.orderId || order.id || '');
      if (isDuplicateOrder) {
        return {
          success: true,
          existing: true,
          order: payload.order
        };
      }

      const shouldRetry = (response.status >= 500 || response.status === 429 || response.status === 408)
        && attempt < ORDER_REQUEST_MAX_ATTEMPTS;
      if (shouldRetry) {
        await delay(300 * attempt);
        continue;
      }

      return { success: false, status: response.status, message: message || `Order API request failed with status ${response.status}` };
    } catch (error) {
      const isAbort = error?.name === 'AbortError';
      const shouldRetry = attempt < ORDER_REQUEST_MAX_ATTEMPTS;
      if (shouldRetry) {
        await delay(300 * attempt);
        continue;
      }

      console.warn('Unable to persist order to the API. Centralized checkout state was not updated.', error);
      return {
        success: false,
        timeout: isAbort,
        error,
        message: isAbort ? 'Order request timed out. Please retry.' : 'Unable to reach the order service right now.'
      };
    } finally {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    }
  }

  return { success: false, message: 'Unable to save your order right now.' };
}

function buildOrderFingerprint() {
  return JSON.stringify({
    source: state.source,
    customerId: String(state.customer.id || '').trim(),
    customerEmail: String(state.customer.email || '').trim().toLowerCase(),
    customerPhone: normalizePhone(state.shippingAddress.phone || state.customer.phone),
    deliveryId: state.delivery.id,
    paymentMethod: String(state.payment.method || '').trim().toLowerCase(),
    total: Number(state.totals.total || 0),
    items: state.products.map((product) => ({
      id: String(product?.id || '').trim(),
      variantKey: String(product?.variantKey || '').trim(),
      qty: Math.max(1, Number(product?.qty || 1) || 1),
      price: Number(product?.price || 0) || 0
    }))
  });
}

function getReusablePendingOrder() {
  const pending = readPendingOrderSubmission();
  if (!pending || typeof pending !== 'object') {
    return null;
  }

  const createdAtMs = Number(pending.createdAtMs || 0);
  const isFresh = createdAtMs > 0 && (Date.now() - createdAtMs) <= PENDING_ORDER_MAX_AGE_MS;
  const sameFingerprint = String(pending.fingerprint || '') === buildOrderFingerprint();

  if (!isFresh || !sameFingerprint || !String(pending.orderId || '').trim()) {
    return null;
  }

  return pending;
}

function getStageIndex(stage) {
  const index = STAGES.indexOf(stage);
  return index === -1 ? 0 : index;
}

function splitFullName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ')
  };
}

function normalizeShippingAddress(value = {}) {
  const merged = {
    ...clone(DEFAULT_ADDRESS),
    ...(value || {})
  };
  const fallbackFullName = [merged.firstName, merged.lastName].filter(Boolean).join(' ').trim();
  const fullName = String(merged.fullName || fallbackFullName).trim();
  const nameParts = splitFullName(fullName);
  const provinceCity = String(merged.provinceCity || merged.city || '').trim();
  const street = String(merged.street || '').trim();
  const note = String(merged.note || '').trim();

  return {
    ...clone(DEFAULT_ADDRESS),
    ...merged,
    fullName,
    firstName: String(merged.firstName || nameParts.firstName).trim(),
    lastName: String(merged.lastName || nameParts.lastName).trim(),
    phone: String(merged.phone || '').trim(),
    provinceCity,
    city: provinceCity,
    district: String(merged.district || '').trim(),
    sector: String(merged.sector || '').trim(),
    cell: String(merged.cell || '').trim(),
    village: String(merged.village || '').trim(),
    street,
    note,
    latitude: String(merged.latitude || '').trim(),
    longitude: String(merged.longitude || '').trim(),
    mapLink: String(merged.mapLink || '').trim(),
    locationAccuracy: String(merged.locationAccuracy || '').trim(),
    locationCapturedAt: String(merged.locationCapturedAt || '').trim()
  };
}

function normalizePayment(value = {}) {
  const merged = {
    ...clone(DEFAULT_PAYMENT),
    ...(value || {})
  };
  const phone = String(merged.phone || merged.payerPhone || '').trim();
  const method = normalizePaymentMethod(merged.method);
  const normalizedState = normalizePaymentState(merged.state || merged.status);
  const paymentType = isCodMethod(method) ? 'cod' : 'pay_now';

  return {
    ...clone(DEFAULT_PAYMENT),
    ...merged,
    paymentType,
    method,
    state: normalizedState,
    status: normalizedState,
    phone,
    payerPhone: phone,
    methodLabel: resolvePaymentMethodLabel(method),
    transactionId: String(merged.transactionId || '').trim()
  };
}

function isCodMethod(method) {
  return String(method || '').trim().toLowerCase() === 'cod';
}

function buildCustomerState(user) {
  return {
    id: String(user?.id || '').trim(),
    name: String(user?.name || '').trim(),
    email: String(user?.email || '').trim(),
    phone: normalizePhone(user?.phone || ''),
    avatar: String(user?.avatar || user?.image || '').trim()
  };
}

function emit(reason) {
  const snapshot = getState();
  listeners.forEach((listener) => {
    try {
      listener(snapshot, reason);
    } catch (error) {
      console.error('Checkout listener failed:', error);
    }
  });
}

function calculateTotals() {
  const subtotal = state.products.reduce((sum, item) => sum + ((Number(item.price) || 0) * (Number(item.qty) || 0)), 0);
  const shippingFee = state.products.length ? Number(state.delivery.fee || 0) : 0;
  const codFee = state.payment.paymentType === 'cod' ? COD_FEE : 0;

  state.totals = {
    subtotal,
    shippingFee,
    codFee,
    total: subtotal + shippingFee + codFee
  };
}

function buildFoundationSnapshot(reason = 'updated') {
  const inventoryValidation = validateCheckoutInventory(state.products);
  const paymentValidation = validateTransactionPreparation({
    method: state.payment.method,
    payment: state.payment,
    products: state.products,
    totals: state.totals,
    foundation: state.foundation,
    currentStage: state.currentStage,
    shippingAddress: state.shippingAddress,
    customerPhone: state.customer.phone,
    isSubmitting: state.isSubmitting
  });
  const cartQuantity = state.products.reduce((sum, item) => sum + (Math.max(1, Number(item?.qty || 1) || 1)), 0);

  return {
    version: CHECKOUT_FOUNDATION_VERSION,
    reason,
    updatedAt: new Date().toISOString(),
    inventoryValid: Boolean(inventoryValidation.valid),
    inventoryErrors: Array.isArray(inventoryValidation.errors) ? inventoryValidation.errors.length : 0,
    cartLineCount: state.products.length,
    cartQuantity,
    paymentMethod: String(state.payment.method || '').trim(),
    paymentState: normalizePaymentState(state.payment.state || 'pending'),
    paymentReady: Boolean(paymentValidation.valid)
  };
}

function syncFoundationSnapshot(reason = 'updated') {
  state.foundation = buildFoundationSnapshot(reason);
}

function initializeProducts(draft) {
  const directItem = readDirectCheckout();
  if (directItem) {
    state.source = 'direct';
    state.products = [directItem];
    return;
  }

  const cartItems = readCartItems();
  if (cartItems.length) {
    state.source = 'cart';
    state.products = cartItems;
    return;
  }

  if (draft?.source === 'direct' && Array.isArray(draft.products) && draft.products.length) {
    state.source = 'direct';
    state.products = draft.products;
    return;
  }

  state.source = 'cart';
  state.products = [];
}

function syncProductsToSource() {
  if (state.source === 'direct') {
    const [item] = state.products;
    writeDirectCheckout(item || null);
    return;
  }

  writeCartItems(state.products);
}

function persistDraft() {
  if (!state.products.length) {
    removeStorage(STORAGE_KEYS.draft);
    return;
  }

  writeStorage(STORAGE_KEYS.draft, {
    stage: state.currentStage,
    currentStep: state.currentStep,
    source: state.source,
    foundation: {
      version: state.foundation.version,
      inventoryValid: state.foundation.inventoryValid,
      updatedAt: state.foundation.updatedAt
    },
    shippingAddress: state.shippingAddress,
    delivery: { id: state.delivery.id },
    payment: state.payment,
    products: state.source === 'direct' ? state.products : []
  });
}

function ensureValidPaymentType() {
  const methodMeta = getPaymentMethodById(state.payment.method);
  if (!methodMeta || !methodMeta.enabled) {
    state.payment.method = '';
  }

  if (!isCodAvailable() && isCodMethod(state.payment.method)) {
    state.payment.method = '';
    state.payment.paymentType = 'pay_now';
  }

  if (!isCodMethod(state.payment.method)) {
    state.payment.paymentType = 'pay_now';
  } else {
    state.payment.paymentType = 'cod';
  }

  state.payment.state = normalizePaymentState(state.payment.state || 'pending');
  state.payment.status = state.payment.state;
  state.payment.methodLabel = resolvePaymentMethodLabel(state.payment.method);

  calculateTotals();
}

function initializeBaseState(preferredStage = 'shipping') {
  const user = readCurrentUser();
  const draft = readStorage(STORAGE_KEYS.draft, null);

  initializeProducts(draft);
  state.customer = buildCustomerState(user);

  const userAddress = getUserAddress(user);
  state.shippingAddress = normalizeShippingAddress({
    ...userAddress,
    fullName: [userAddress.firstName, userAddress.lastName].filter(Boolean).join(' ').trim(),
    provinceCity: userAddress.provinceCity || userAddress.city || ''
  });
  state.shippingAddress = normalizeShippingAddress({
    ...state.shippingAddress,
    ...(draft?.shippingAddress || {})
  });

  if (!state.shippingAddress.phone && state.customer.phone) {
    state.shippingAddress.phone = state.customer.phone;
  }

  const requestedDeliveryId = draft?.delivery?.id;
  state.delivery = clone(DELIVERY_OPTIONS.find((option) => option.id === requestedDeliveryId) || DELIVERY_OPTIONS[0]);

  state.payment = normalizePayment({
    payerPhone: state.customer.phone,
    ...(draft?.payment || {})
  });

  const requestedStage = STAGES.includes(draft?.stage)
    ? draft.stage
    : STAGES[getStageIndex(STAGES[Number(draft?.currentStep)] || preferredStage)];

  state.currentStage = STAGES.includes(preferredStage) ? preferredStage : (requestedStage || 'shipping');
  state.currentStep = getStageIndex(state.currentStage);
  state.confirmation = null;
  state.isSubmitting = false;
  state.initialized = true;

  ensureValidPaymentType();
  syncFoundationSnapshot('initialized');
  persistDraft();
  emit('initialized');
}

function getMissingShippingField() {
  return REQUIRED_SHIPPING_FIELDS.find((field) => !String(state.shippingAddress[field] || '').trim()) || '';
}

function buildShippingValidation() {
  const errors = {};

  REQUIRED_SHIPPING_FIELDS.forEach((field) => {
    if (!String(state.shippingAddress[field] || '').trim()) {
      errors[field] = 'This field is required';
    }
  });

  if (state.shippingAddress.phone && !isValidPhone(state.shippingAddress.phone)) {
    errors.phone = 'Enter a valid Rwanda phone number';
  }

  const missingField = getMissingShippingField();
  if (missingField) {
    return {
      valid: false,
      message: `${FIELD_LABELS[missingField] || 'Shipping field'} is required.`,
      errors
    };
  }

  if (errors.phone) {
    return {
      valid: false,
      message: 'Enter a valid Rwanda phone number for delivery updates.',
      errors
    };
  }

  persistUserAddress({
    ...state.shippingAddress,
    phone: normalizePhone(state.shippingAddress.phone)
  });

  return { valid: true, errors: {} };
}

function buildPaymentValidation() {
  if (!state.payment.method) {
    return { valid: false, message: 'Choose a payment method before placing the order.' };
  }

  if (isCodMethod(state.payment.method)) {
    if (!isCodAvailable()) {
      return { valid: false, message: 'Pay When You Receive Your Order is only available for Kigali addresses.' };
    }

    return { valid: true };
  }

  if (!SUPPORTED_PAY_NOW_METHODS.includes(String(state.payment.method || '').trim().toLowerCase())) {
    return { valid: false, message: INACTIVE_PAYMENT_MESSAGE };
  }

  const payerPhone = normalizePhone(
    state.payment.phone || state.payment.payerPhone || state.shippingAddress.phone || state.customer.phone
  );

  if (!payerPhone || !isValidPhone(payerPhone)) {
    return { valid: false, message: 'Enter a valid Rwanda phone number for payment updates.' };
  }

  return { valid: true };
}

export async function initializeCheckoutState() {
  initializeBaseState('shipping');
  const hydrated = await hydrateStorefrontState();
  if (hydrated) {
    initializeBaseState('shipping');
  }
}

export async function initializeOrderFlow(preferredStage) {
  initializeBaseState(preferredStage);
  const hydrated = await hydrateStorefrontState();
  if (hydrated) {
    initializeBaseState(preferredStage);
  }
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState() {
  return clone(state);
}

export function getStageUrl(stage) {
  return `${stage}.html`;
}

export function setStage(stage) {
  state.currentStage = STAGES.includes(stage) ? stage : 'shipping';
  state.currentStep = getStageIndex(state.currentStage);
  syncFoundationSnapshot('stage-changed');
  persistDraft();
  emit('stage-changed');
}

export function resolveStageAccess(stage) {
  const cartValidation = validateCartStep();
  if (!cartValidation.valid) {
    return { valid: false, redirectUrl: '../cart.html' };
  }

  if (stage === 'shipping') {
    return { valid: true };
  }

  const shippingValidation = buildShippingValidation();
  if (!shippingValidation.valid) {
    return { valid: false, redirectUrl: getStageUrl('shipping') };
  }

  return { valid: true };
}

export function getDeliveryOptions() {
  return clone(DELIVERY_OPTIONS);
}

export function isCodAvailable() {
  return String(state.shippingAddress.provinceCity || state.shippingAddress.city || '').trim().toLowerCase().includes('kigali');
}

export function setStep(stepIndex) {
  const nextStage = STAGES[Math.max(0, Math.min(Number(stepIndex) || 0, STAGES.length - 1))] || 'shipping';
  setStage(nextStage);
}

export function nextStep() {
  setStage(STAGES[Math.min(getStageIndex(state.currentStage) + 1, STAGES.length - 1)]);
}

export function previousStep() {
  setStage(STAGES[Math.max(getStageIndex(state.currentStage) - 1, 0)]);
}

export function updateProductQuantity(productId, variantKey, quantity) {
  const nextQuantity = Math.max(0, Number(quantity) || 0);
  state.products = state.products
    .map((item) => {
      if (String(item.id) !== String(productId) || String(item.variantKey || '') !== String(variantKey || '')) {
        return item;
      }

      return {
        ...item,
        qty: Math.max(1, nextQuantity),
        total: (Number(item.price) || 0) * Math.max(1, nextQuantity)
      };
    })
    .filter((item) => !(String(item.id) === String(productId) && String(item.variantKey || '') === String(variantKey || '') && nextQuantity === 0));

  syncProductsToSource();
  calculateTotals();
  syncFoundationSnapshot('products-changed');
  persistDraft();
  emitCartUpdated();
  emit('products-changed');
}

export function removeProduct(productId, variantKey) {
  state.products = state.products.filter(
    (item) => !(String(item.id) === String(productId) && String(item.variantKey || '') === String(variantKey || ''))
  );

  syncProductsToSource();
  calculateTotals();
  syncFoundationSnapshot('products-changed');
  persistDraft();
  emitCartUpdated();
  emit('products-changed');
}

export function updateShippingDetails(patch = {}) {
  state.shippingAddress = normalizeShippingAddress({
    ...state.shippingAddress,
    ...(patch || {})
  });

  if (!state.payment.phone && state.shippingAddress.phone) {
    state.payment = normalizePayment({
      ...state.payment,
      phone: state.shippingAddress.phone
    });
  }

  ensureValidPaymentType();
  syncFoundationSnapshot('shipping-changed');
  persistDraft();
  emit('shipping-changed');
}

export function updateShippingField(field, value) {
  updateShippingDetails({ [field]: value });
}

export function selectDeliveryOption(optionId) {
  state.delivery = clone(DELIVERY_OPTIONS.find((option) => option.id === optionId) || DELIVERY_OPTIONS[0]);
  ensureValidPaymentType();
  syncFoundationSnapshot('delivery-changed');
  persistDraft();
  emit('delivery-changed');
}

export function updatePaymentDetails(patch = {}) {
  const nextMethod = normalizePaymentMethod(patch?.method || state.payment.method);
  const methodChanged = nextMethod !== normalizePaymentMethod(state.payment.method);
  state.payment = normalizePayment({
    ...state.payment,
    ...(patch || {}),
    ...(methodChanged ? { state: 'pending', transactionId: '' } : {})
  });

  ensureValidPaymentType();
  syncFoundationSnapshot('payment-changed');
  persistDraft();
  emit('payment-changed');
}

export function updatePaymentField(field, value) {
  updatePaymentDetails({ [field]: value });
}

export function validateCartStep() {
  if (!state.products.length) {
    return { valid: false, message: 'Your cart is empty. Add products before checking out.' };
  }

  const inventoryValidation = validateCheckoutInventory(state.products);
  if (!inventoryValidation.valid) {
    const firstError = inventoryValidation.errors[0];
    const fallbackMessage = 'One or more items are no longer available in the requested quantity.';
    return {
      valid: false,
      message: String(firstError?.error || firstError?.message || fallbackMessage)
    };
  }

  return { valid: true };
}

export function validateShippingStage() {
  return buildShippingValidation();
}

export function validateShippingStep() {
  return buildShippingValidation();
}

export function validateDeliveryStep() {
  if (!DELIVERY_OPTIONS.some((option) => option.id === state.delivery.id)) {
    return { valid: false, message: 'Select a delivery option before continuing.' };
  }

  return { valid: true };
}

export function validatePaymentStage() {
  return buildPaymentValidation();
}

export function validatePaymentStep() {
  return buildPaymentValidation();
}

export function getResolvedCustomerName() {
  return state.shippingAddress.fullName || state.customer.name || 'Guest Customer';
}

export function getPaymentStateView() {
  return getPaymentStateMeta(state.payment.state || 'pending');
}

export function getPaymentMethodLabel(method) {
  return resolvePaymentMethodLabel(method || state.payment.method);
}

export function buildOrderPayload() {
  const cartValidation = validateCartStep();
  if (!cartValidation.valid) {
    return cartValidation;
  }

  const shippingValidation = buildShippingValidation();
  if (!shippingValidation.valid) {
    return shippingValidation;
  }

  const paymentValidation = buildPaymentValidation();
  if (!paymentValidation.valid) {
    return paymentValidation;
  }

  const customerName = getResolvedCustomerName();
  const normalizedPhone = normalizePhone(state.shippingAddress.phone || state.customer.phone);
  const payerPhone = normalizePhone(state.payment.phone || state.payment.payerPhone || state.shippingAddress.phone || state.customer.phone);
  const usesCod = isCodMethod(state.payment.method);
  const hasAccount = Boolean(String(state.customer.id || '').trim());
  const pendingOrder = getReusablePendingOrder();
  const createdAtMs = Number(pendingOrder?.createdAtMs || Date.now());
  const orderId = String(pendingOrder?.orderId || createOrderId()).trim();
  const createdAtIso = new Date(createdAtMs).toISOString();
  const inventoryValidation = validateCheckoutInventory(state.products);
  const preparationArtifacts = buildOrderPreparationArtifacts({
    orderId,
    customerId: hasAccount ? state.customer.id : '',
    products: state.products
  });
  const normalizedPaymentState = normalizePaymentState(state.payment.state || 'pending');
  const transaction = buildTransactionPreparation({
    orderId,
    method: state.payment.method,
    state: normalizedPaymentState,
    total: state.totals.total,
    payerPhone,
    transactionId: state.payment.transactionId,
    attempts: 0,
    createdAt: createdAtIso
  });
  const paymentStateMeta = getPaymentStateMeta(transaction.state);
  const products = state.products.map((product) => {
    const image = resolveOrderItemImage(product);
    return {
      ...clone(product),
      image,
      img: image,
      imageUrl: image,
      productImage: image,
      mainImage: image,
      thumbnail: image,
      qty: Math.max(1, Number(product?.qty || 1) || 1),
      total: (Number(product?.price || 0) || 0) * Math.max(1, Number(product?.qty || 1) || 1)
    };
  });
  const items = products.map((product) => ({
    productId: String(product?.id || '').trim(),
    productName: String(product?.name || 'Product').trim() || 'Product',
    image: resolveOrderItemImage(product),
    color: String(product?.colorName || product?.color || product?.attributes?.Color || '').trim(),
    colorName: String(product?.colorName || product?.color || '').trim(),
    colorId: String(product?.colorId || product?.variantSelection?.colorId || '').trim(),
    colorImage: String(product?.colorImage || product?.variantSelection?.colorImage || '').trim(),
    size: String(product?.sizeLabel || product?.size || product?.attributes?.Size || '').trim(),
    sizeLabel: String(product?.sizeLabel || product?.size || '').trim(),
    sizeValue: String(product?.sizeValue || product?.variantSelection?.sizeValue || '').trim(),
    quantity: Math.max(1, Number(product?.qty || 1) || 1),
    price: Number(product?.price || 0) || 0,
    comparePrice: Number(product?.comparePrice || product?.oldPrice || 0) || 0,
    discountPercent: Number(product?.discountPercent || 0) || 0,
    sku: String(product?.variantSku || product?.sku || '').trim(),
    variantKey: String(product?.variantKey || '').trim(),
    variantSelection: clone(product?.variantSelection || null),
    attributeSummary: String(product?.attributeSummary || '').trim(),
    availableStock: Math.max(0, Number(product?.availableStock ?? product?.stock ?? 0) || 0)
  }));
  const fullAddress = {
    province: state.shippingAddress.provinceCity,
    district: state.shippingAddress.district,
    sector: state.shippingAddress.sector,
    cell: state.shippingAddress.cell,
    village: state.shippingAddress.village,
    street: state.shippingAddress.street,
    note: state.shippingAddress.note
  };
  const gpsLocation = {
    latitude: state.shippingAddress.latitude,
    longitude: state.shippingAddress.longitude,
    googleMapsLink: state.shippingAddress.mapLink
  };
  const paymentStatus = transaction.state;
  const orderStatus = 'pending';

  const order = {
    id: orderId,
    orderId,
    userId: hasAccount ? state.customer.id : '',
    accountId: hasAccount ? state.customer.id : '',
    isGuest: !hasAccount,
    userEmail: state.customer.email,
    date: createdAtIso,
    createdAt: createdAtIso,
    createdAtMs: Date.now(),
    timestamp: createdAtIso,
    orderStatus,
    status: 'Pending',
    paymentStatus,
    products,
    items,
    customerId: hasAccount ? state.customer.id : '',
    customerName,
    phoneNumber: normalizedPhone,
    customerEmail: state.customer.email,
    customerPhone: normalizedPhone,
    customerImage: state.customer.avatar,
    fullAddress,
    gpsLocation,
    customer: {
      id: hasAccount ? state.customer.id : '',
      name: customerName,
      email: state.customer.email,
      phone: normalizedPhone,
      avatar: state.customer.avatar,
      isGuest: !hasAccount
    },
    shippingAddress: {
      ...clone(state.shippingAddress),
      phone: normalizedPhone,
      city: state.shippingAddress.provinceCity || state.shippingAddress.city,
      line1: state.shippingAddress.street || '',
      province: state.shippingAddress.provinceCity || state.shippingAddress.city,
      firstName: state.shippingAddress.firstName,
      lastName: state.shippingAddress.lastName,
      mapLink: state.shippingAddress.mapLink,
      googleMapsLink: state.shippingAddress.mapLink
    },
    subtotal: state.totals.subtotal,
    deliveryFee: state.totals.shippingFee,
    shippingFee: state.totals.shippingFee,
    codFee: state.totals.codFee,
    totalAmount: state.totals.total,
    total: state.totals.total,
    deliveryMethod: state.delivery.id,
    deliveryLabel: state.delivery.label,
    paymentType: usesCod ? 'cod' : 'pay_now',
    paymentMethod: usesCod ? 'cod' : state.payment.method,
    paymentStatusLabel: paymentStateMeta.label,
    note: usesCod ? 'Pay on delivery' : '',
    payment: {
      type: usesCod ? 'cod' : 'pay_now',
      method: usesCod ? 'cod' : state.payment.method,
      methodLabel: resolvePaymentMethodLabel(state.payment.method),
      status: paymentStatus,
      statusLabel: paymentStateMeta.label,
      note: usesCod ? 'Pay on delivery' : '',
      payerPhone,
      transactionId: String(state.payment.transactionId || '').trim(),
      transaction
    },
    statusHistory: [
      {
        status: orderStatus,
        label: 'Order received',
        timestamp: createdAtIso
      }
    ],
    orderPreparation: {
      version: CHECKOUT_FOUNDATION_VERSION,
      builtAt: createdAtIso,
      inventoryPreflight: {
        valid: inventoryValidation.valid,
        errors: clone(inventoryValidation.errors || []),
        adjustments: clone(inventoryValidation.adjustments || [])
      },
      reservationPlan: preparationArtifacts.reservation,
      stockDeductionPlan: preparationArtifacts.deduction,
      paymentArchitecture: {
        methodCatalogVersion: '3Q',
        stateCatalog: ['pending', 'authorized', 'paid', 'failed', 'refunded', 'cancelled'],
        selectedMethod: state.payment.method,
        selectedState: transaction.state
      },
      transactionInfrastructure: {
        transaction,
        duplicateProtection: {
          fingerprint: buildOrderFingerprint(),
          pendingOrderReuseEnabled: true,
          maxPendingAgeMs: PENDING_ORDER_MAX_AGE_MS
        }
      },
      gatewayPreparation: getGatewayPreparationBlueprint(),
      paymentGateway: {
        status: 'not_enabled',
        reason: 'STEP 3Q defines gateway-ready architecture only; real gateway integrations are deferred.'
      },
      fraudProtection: {
        status: 'not_enabled',
        reason: 'STEP 3Q scope excludes advanced fraud systems.'
      },
      financialReporting: {
        status: 'not_enabled',
        reason: 'STEP 3Q scope excludes financial reporting systems.'
      },
      automation: {
        status: 'not_enabled',
        reason: 'STEP 3Q scope excludes advanced order automation.'
      }
    }
  };

  savePendingOrderSubmission({
    orderId,
    createdAtMs,
    fingerprint: buildOrderFingerprint()
  });

  return { valid: true, order, customerName };
}

export async function submitOrder() {
  if (state.isSubmitting) {
    return { valid: false, message: 'Order submission is already in progress.' };
  }

  try {
    const prepared = buildOrderPayload();
    if (!prepared.valid) {
      return prepared;
    }

    const { order, customerName } = prepared;
    const submissionNonce = Date.now();
    activeSubmissionNonce = submissionNonce;

    state.isSubmitting = true;
    emit('submitting-changed');

    const persistenceResult = await persistOrderToServer(order, { submissionNonce });
    if (submissionNonce !== activeSubmissionNonce) {
      return {
        valid: false,
        message: 'Checkout state changed while submitting. Please review and try again.'
      };
    }

    if (persistenceResult?.cancelled) {
      return {
        valid: false,
        message: persistenceResult?.message || 'Checkout submission was cancelled.'
      };
    }

    if (persistenceResult?.success === false && !persistenceResult?.skipped) {
      return {
        valid: false,
        message: persistenceResult?.message || 'Unable to save your order to the server right now. Please try again.'
      };
    }

    const persistedOrder = persistenceResult?.order && typeof persistenceResult.order === 'object'
      ? { ...order, ...clone(persistenceResult.order) }
      : order;

    persistUserAddress(order.shippingAddress);

    if (state.source === 'cart') {
      writeCartItems([]);
    } else {
      removeStorage(STORAGE_KEYS.directCheckout);
    }

    removeStorage(STORAGE_KEYS.draft);
    emitCartUpdated();

    const confirmation = {
      orderId: persistedOrder.id,
      customerName,
      customerPhone: persistedOrder.customerPhone,
      total: persistedOrder.total,
      subtotal: persistedOrder.subtotal,
      shippingFee: persistedOrder.shippingFee,
      codFee: persistedOrder.codFee,
      placedAt: persistedOrder.date,
      status: persistedOrder.status,
      products: clone(persistedOrder.products),
      shippingAddress: clone(persistedOrder.shippingAddress),
      deliveryLabel: persistedOrder.deliveryLabel,
      paymentLabel: persistedOrder.paymentType === 'cod' || isCodMethod(persistedOrder.paymentMethod)
        ? 'Pay When You Receive Your Order'
        : persistedOrder.paymentMethod === 'mtn'
          ? 'MTN Mobile Money'
          : persistedOrder.paymentMethod === 'airtel'
            ? 'Airtel Money'
            : persistedOrder.paymentMethod === 'bank'
              ? 'Bank Transfer'
              : persistedOrder.paymentMethod === 'card'
                ? 'Visa / Mastercard'
            : 'Payment pending',
      paymentType: persistedOrder.paymentType,
      paymentMethod: persistedOrder.paymentMethod
    };

    saveCheckoutConfirmation(confirmation);
    clearPendingOrderSubmission();
    state.confirmation = confirmation;

    await delay(SUBMISSION_DELAY_MS);

    return {
      valid: true,
      order: persistedOrder,
      confirmation,
      redirectUrl: `../order-success.html?orderId=${encodeURIComponent(persistedOrder.id)}`,
      message: `${customerName} order placed for ${formatCurrency(persistedOrder.total)}.`
    };
  } catch (error) {
    console.error('Checkout submission failed:', error);
    return {
      valid: false,
      message: 'Unable to complete the order right now. Please try again.'
    };
  } finally {
    if (state.isSubmitting) {
      state.isSubmitting = false;
      emit('submitting-changed');
    }
    activeSubmissionNonce = 0;
  }
}

export function getConfirmationState(orderId) {
  const savedConfirmation = state.confirmation || readCheckoutConfirmation();
  if (savedConfirmation && (!orderId || String(savedConfirmation.orderId) === String(orderId))) {
    return clone(savedConfirmation);
  }

  return null;
}