import { isValidPhone, normalizePhone } from './utils.js';

export const PAYMENT_STATE_META = {
  pending: { id: 'pending', label: 'Pending', tone: 'pending' },
  authorized: { id: 'authorized', label: 'Authorized', tone: 'authorized' },
  paid: { id: 'paid', label: 'Paid', tone: 'paid' },
  failed: { id: 'failed', label: 'Failed', tone: 'failed' },
  refunded: { id: 'refunded', label: 'Refunded', tone: 'refunded' },
  cancelled: { id: 'cancelled', label: 'Cancelled', tone: 'cancelled' }
};

const PAYMENT_STATE_ORDER = ['pending', 'authorized', 'paid', 'failed', 'refunded', 'cancelled'];

const METHOD_CATALOG = [
  {
    id: 'mtn',
    label: 'MTN Mobile Money',
    category: 'mobile_money',
    enabled: true,
    requiresPayerPhone: true,
    supportsDeferredGateway: true,
    futureGatewayTargets: ['mobile_money', 'flutterwave', 'paystack']
  },
  {
    id: 'airtel',
    label: 'Airtel Money',
    category: 'mobile_money',
    enabled: true,
    requiresPayerPhone: true,
    supportsDeferredGateway: true,
    futureGatewayTargets: ['mobile_money', 'flutterwave', 'paystack']
  },
  {
    id: 'bank',
    label: 'Bank Transfer',
    category: 'bank_transfer',
    enabled: true,
    requiresPayerPhone: false,
    supportsDeferredGateway: true,
    futureGatewayTargets: ['bank_api', 'flutterwave', 'paystack']
  },
  {
    id: 'card',
    label: 'Card Payment',
    category: 'card',
    enabled: true,
    requiresPayerPhone: false,
    supportsDeferredGateway: true,
    futureGatewayTargets: ['stripe', 'paypal', 'flutterwave', 'paystack']
  },
  {
    id: 'cod',
    label: 'Cash on Delivery',
    category: 'cash_on_delivery',
    enabled: true,
    requiresPayerPhone: false,
    supportsDeferredGateway: false,
    futureGatewayTargets: []
  },
  {
    id: 'wallet',
    label: 'Wallet',
    category: 'wallet',
    enabled: false,
    requiresPayerPhone: false,
    supportsDeferredGateway: true,
    futureGatewayTargets: ['wallet', 'paypal']
  }
];

export function normalizePaymentState(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return PAYMENT_STATE_ORDER.includes(normalized) ? normalized : 'pending';
}

export function getPaymentStateMeta(value) {
  const normalized = normalizePaymentState(value);
  return PAYMENT_STATE_META[normalized] || PAYMENT_STATE_META.pending;
}

export function normalizePaymentMethod(value) {
  return String(value || '').trim().toLowerCase();
}

export function getPaymentMethodCatalog(options = {}) {
  const includeFuture = options.includeFuture !== false;
  return METHOD_CATALOG
    .filter((method) => includeFuture || method.enabled)
    .map((method) => ({ ...method }));
}

export function getPaymentMethodById(methodId) {
  const normalizedMethod = normalizePaymentMethod(methodId);
  return METHOD_CATALOG.find((method) => method.id === normalizedMethod) || null;
}

export function isPaymentMethodEnabled(methodId, shippingAddress = {}) {
  const method = getPaymentMethodById(methodId);
  if (!method || !method.enabled) {
    return false;
  }

  if (method.id === 'cod') {
    const provinceCity = String(shippingAddress.provinceCity || shippingAddress.city || '').trim().toLowerCase();
    return provinceCity.includes('kigali');
  }

  return true;
}

export function resolvePaymentMethodLabel(methodId) {
  const method = getPaymentMethodById(methodId);
  return method?.label || 'Payment pending';
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function calculateExpectedTotal({ subtotal, shippingFee, codFee }) {
  return Math.max(0, toNumber(subtotal) + toNumber(shippingFee) + toNumber(codFee));
}

export function buildTransactionPreparation(options = {}) {
  const orderId = String(options.orderId || '').trim();
  const method = normalizePaymentMethod(options.method);
  const state = normalizePaymentState(options.state || 'pending');
  const amount = Math.max(0, toNumber(options.total));
  const nowIso = new Date().toISOString();
  const methodMeta = getPaymentMethodById(method);

  return {
    transactionId: String(options.transactionId || '').trim(),
    transactionRef: orderId ? `${orderId}-tx` : '',
    orderId,
    method,
    methodCategory: methodMeta?.category || 'unknown',
    state,
    stateLabel: getPaymentStateMeta(state).label,
    amount,
    currency: 'RWF',
    attempts: Math.max(0, Number(options.attempts || 0) || 0),
    createdAt: String(options.createdAt || nowIso).trim() || nowIso,
    updatedAt: nowIso,
    payerPhone: normalizePhone(options.payerPhone || ''),
    futureGateway: {
      enabled: false,
      mode: 'deferred',
      providers: Array.isArray(methodMeta?.futureGatewayTargets) ? methodMeta.futureGatewayTargets : [],
      redirectReady: false,
      webhookReady: false,
      reason: 'Gateway integrations are intentionally deferred in STEP 3Q.'
    },
    fraudSystem: {
      enabled: false,
      reason: 'Advanced fraud systems are intentionally deferred in STEP 3Q.'
    },
    financialReporting: {
      enabled: false,
      reason: 'Financial reporting systems are intentionally deferred in STEP 3Q.'
    }
  };
}

export function validateTransactionPreparation(options = {}) {
  const method = normalizePaymentMethod(options.method);
  const totals = options.totals || {};
  const products = Array.isArray(options.products) ? options.products : [];
  const payment = options.payment || {};
  const shippingAddress = options.shippingAddress || {};

  const errors = {};

  if (!products.length) {
    errors.products = 'Your cart is empty. Add products before proceeding to payment.';
  }

  const methodMeta = getPaymentMethodById(method);
  if (!method) {
    errors.method = 'Choose a payment method before placing the order.';
  } else if (!methodMeta) {
    errors.method = 'Unsupported payment method selected.';
  } else if (!isPaymentMethodEnabled(method, shippingAddress)) {
    errors.method = method === 'cod'
      ? 'Cash on Delivery is available only for Kigali delivery addresses.'
      : 'This payment method is not active yet.';
  }

  const normalizedPhone = normalizePhone(payment.phone || payment.payerPhone || options.customerPhone || '');
  if (methodMeta?.requiresPayerPhone && (!normalizedPhone || !isValidPhone(normalizedPhone))) {
    errors.phone = 'Enter a valid Rwanda phone number for this payment method.';
  }

  const subtotal = products.reduce((sum, product) => {
    const qty = Math.max(1, Number(product?.qty || 1) || 1);
    const price = Number(product?.price || 0) || 0;
    return sum + (qty * price);
  }, 0);
  const shippingFee = toNumber(totals.shippingFee);
  const codFee = method === 'cod' ? Math.max(0, toNumber(totals.codFee)) : 0;
  const expectedTotal = calculateExpectedTotal({ subtotal, shippingFee, codFee });
  const providedTotal = Math.max(0, toNumber(totals.total));
  if (Math.abs(expectedTotal - providedTotal) > 0.01) {
    errors.total = 'Order total is inconsistent. Refresh checkout and review your order totals.';
  }

  if (options.foundation && options.foundation.inventoryValid === false) {
    errors.inventory = 'Inventory changed during checkout. Review item availability before payment.';
  }

  if (options.isSubmitting) {
    errors.submission = 'A transaction submission is already in progress.';
  }

  const stage = String(options.currentStage || '').trim().toLowerCase();
  if (!['checkout', 'payment'].includes(stage)) {
    errors.stage = 'Checkout payment state is stale. Return to checkout and try again.';
  }

  const firstError = Object.values(errors).find(Boolean) || '';
  return {
    valid: Object.keys(errors).length === 0,
    errors,
    message: firstError
  };
}

export function getGatewayPreparationBlueprint() {
  return {
    stripe: { ready: true, integrated: false },
    paypal: { ready: true, integrated: false },
    mobileMoney: { ready: true, integrated: false },
    flutterwave: { ready: true, integrated: false },
    paystack: { ready: true, integrated: false },
    bankApi: { ready: true, integrated: false },
    wallet: { ready: true, integrated: false }
  };
}
