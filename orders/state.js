import {
  STORAGE_KEYS,
  clone,
  createOrderId,
  delay,
  emitCartUpdated,
  formatCurrency,
  getUserAddress,
  isValidPhone,
  normalizePhone,
  persistUserAddress,
  readCartItems,
  readCheckoutConfirmation,
  readCurrentUser,
  readOrderById,
  readDirectCheckout,
  readStorage,
  removeStorage,
  resolveOrderItemImage,
  saveCheckoutConfirmation,
  saveOrder,
  writeCartItems,
  writeDirectCheckout,
  writeStorage
} from './utils.js';

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
  phone: '',
  payerPhone: '',
  transactionId: ''
};

const SUPPORTED_PAY_NOW_METHODS = ['mtn', 'airtel', 'bank', 'card'];
const COD_FEE = 2000;
const SUBMISSION_DELAY_MS = 900;
const INACTIVE_PAYMENT_MESSAGE = 'This payment method is not available yet. Ubu buryo bwo kwishyura ntiburakora.';
const listeners = new Set();
const PRODUCTION_API_ORIGIN = 'https://byosemarket-admin-api.onrender.com';

function normalizeBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
}

function shouldUseProductionApi(hostname) {
  return /(^|\.)(github\.io|byosemarket\.com)$/i.test(String(hostname || ''));
}

function resolveApiOrigin() {
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

async function persistOrderToServer(order) {
  const endpoint = getOrdersApiUrl();
  if (!endpoint) {
    return { skipped: true };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(order)
    });

    if (!response.ok) {
      throw new Error(`Order API request failed with status ${response.status}`);
    }

    return await response.json().catch(() => ({ success: true }));
  } catch (error) {
    console.warn('Unable to persist order to the API. Falling back to local checkout storage.', error);
    return { success: false, error };
  }
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
  const method = String(merged.method || '').trim();
  const paymentType = isCodMethod(method) ? 'cod' : 'pay_now';

  return {
    ...clone(DEFAULT_PAYMENT),
    ...merged,
    paymentType,
    method,
    phone,
    payerPhone: phone,
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
    shippingAddress: state.shippingAddress,
    delivery: { id: state.delivery.id },
    payment: state.payment,
    products: state.source === 'direct' ? state.products : []
  });
}

function ensureValidPaymentType() {
  if (!isCodAvailable() && isCodMethod(state.payment.method)) {
    state.payment.method = '';
    state.payment.paymentType = 'pay_now';
  }

  if (!isCodMethod(state.payment.method)) {
    state.payment.paymentType = 'pay_now';
  }

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

export function initializeCheckoutState() {
  initializeBaseState('shipping');
}

export function initializeOrderFlow(preferredStage) {
  initializeBaseState(preferredStage);
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
  persistDraft();
  emit('stage-changed');
}

export function resolveStageAccess(stage) {
  if (!state.products.length) {
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
  persistDraft();
  emit('shipping-changed');
}

export function updateShippingField(field, value) {
  updateShippingDetails({ [field]: value });
}

export function selectDeliveryOption(optionId) {
  state.delivery = clone(DELIVERY_OPTIONS.find((option) => option.id === optionId) || DELIVERY_OPTIONS[0]);
  ensureValidPaymentType();
  persistDraft();
  emit('delivery-changed');
}

export function updatePaymentDetails(patch = {}) {
  state.payment = normalizePayment({
    ...state.payment,
    ...(patch || {})
  });

  ensureValidPaymentType();
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

export function buildOrderPayload() {
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
  const orderId = createOrderId();
  const createdAtIso = new Date().toISOString();
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
    size: String(product?.size || product?.attributes?.Size || '').trim(),
    color: String(product?.color || product?.attributes?.Color || '').trim(),
    quantity: Math.max(1, Number(product?.qty || 1) || 1),
    price: Number(product?.price || 0) || 0
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
  const paymentStatus = usesCod ? 'pending' : 'pending';
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
    paymentMethod: usesCod ? 'COD' : state.payment.method,
    paymentStatusLabel: usesCod ? 'Pending' : 'Pending',
    note: usesCod ? 'Pay on delivery' : '',
    payment: {
      type: usesCod ? 'cod' : 'pay_now',
      method: usesCod ? 'COD' : state.payment.method,
      status: paymentStatus,
      note: usesCod ? 'Pay on delivery' : '',
      payerPhone,
      transactionId: String(state.payment.transactionId || '').trim()
    },
    statusHistory: [
      {
        status: orderStatus,
        label: 'Order received',
        timestamp: createdAtIso
      }
    ]
  };

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

    state.isSubmitting = true;
    emit('submitting-changed');

    saveOrder(order);
    persistUserAddress(order.shippingAddress);

    if (state.source === 'cart') {
      writeCartItems([]);
    } else {
      removeStorage(STORAGE_KEYS.directCheckout);
    }

    removeStorage(STORAGE_KEYS.draft);
    emitCartUpdated();

    const confirmation = {
      orderId: order.id,
      customerName,
      customerPhone: order.customerPhone,
      total: order.total,
      subtotal: order.subtotal,
      shippingFee: order.shippingFee,
      codFee: order.codFee,
      placedAt: order.date,
      status: order.status,
      products: clone(order.products),
      shippingAddress: clone(order.shippingAddress),
      deliveryLabel: order.deliveryLabel,
      paymentLabel: order.paymentType === 'cod' || isCodMethod(order.paymentMethod)
        ? 'Pay When You Receive Your Order'
        : order.paymentMethod === 'mtn'
          ? 'MTN Mobile Money'
          : order.paymentMethod === 'airtel'
            ? 'Airtel Money'
            : order.paymentMethod === 'bank'
              ? 'Bank Transfer'
              : order.paymentMethod === 'card'
                ? 'Visa / Mastercard'
            : 'Payment pending',
      paymentType: order.paymentType,
      paymentMethod: order.paymentMethod
    };

    saveCheckoutConfirmation(confirmation);
    state.confirmation = confirmation;

    await persistOrderToServer(order);

    await delay(SUBMISSION_DELAY_MS);

    return {
      valid: true,
      order,
      confirmation,
      redirectUrl: `../order-success.html?orderId=${encodeURIComponent(order.id)}`,
      message: `${customerName} order placed for ${formatCurrency(order.total)}.`
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
  }
}

export function getConfirmationState(orderId) {
  const savedConfirmation = state.confirmation || readCheckoutConfirmation();
  if (savedConfirmation && (!orderId || String(savedConfirmation.orderId) === String(orderId))) {
    return clone(savedConfirmation);
  }

  const order = readOrderById(orderId);
  if (!order) {
    return null;
  }

  return {
    orderId: order.id,
    customerName: order.customerName || order.customer?.name || 'Customer',
    customerPhone: order.customerPhone || order.customer?.phone || order.shippingAddress?.phone || '',
    total: order.total || 0,
    subtotal: order.subtotal || 0,
    shippingFee: order.shippingFee || 0,
    codFee: order.codFee || 0,
    placedAt: order.date || order.createdAt || new Date().toISOString(),
    status: order.status || 'Pending',
    products: clone(order.products || []),
    shippingAddress: clone(order.shippingAddress || {}),
    deliveryLabel: order.deliveryLabel || order.deliveryMethod || 'Delivery',
    paymentLabel: order.paymentType === 'cod' || isCodMethod(order.paymentMethod)
      ? 'Pay When You Receive Your Order'
      : order.paymentMethod === 'mtn'
        ? 'MTN Mobile Money'
        : order.paymentMethod === 'airtel'
          ? 'Airtel Money'
          : order.paymentMethod === 'bank'
            ? 'Bank Transfer'
            : order.paymentMethod === 'card'
              ? 'Visa / Mastercard'
          : 'Payment pending',
    paymentType: order.paymentType || 'pay_now',
    paymentMethod: order.paymentMethod || ''
  };
}