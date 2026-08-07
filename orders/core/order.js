import {
  STORAGE_KEYS,
  clone,
  clearPendingOrderSubmission,
  createOrderId,
  emitCartUpdated,
  normalizePhone,
  readPendingOrderSubmission,
  readStorage,
  removeStorage,
  resolveApiOrigin,
  resolveOrderItemImage,
  resolveProductUrl,
  saveCheckoutConfirmation,
  savePendingOrderSubmission,
  writeStorage
} from '../utils.js';
import {
  COD_PAYMENT_METHOD_LABEL,
  COD_PAYMENT_STATUS,
  COD_PAYMENT_STATUS_LABEL
} from './constants.js';
import { clearCheckoutHandoff, getState, setSubmitting } from './state.js';
import { validatePayment, validateProducts, validateShipping } from './validation.js';

function getOrdersApiUrl() {
  const base = resolveApiOrigin();
  if (!base) return '';
  return base.endsWith('/api') ? `${base}/orders` : `${base}/api/orders`;
}

function buildOrderLineItem(product) {
  const image = resolveOrderItemImage(product);
  const colorImage = String(product.colorImage || '').trim();
  const qty = Math.max(1, Number(product.qty || product.quantity) || 1);
  const price = Number(product.price) || 0;
  const productUrl = resolveProductUrl(product);
  const sku = String(product.variantSku || product.sku || '').trim();
  const category = String(product.category || '').trim();
  const colorName = String(product.colorName || product.color || '');
  const sizeLabel = String(product.sizeLabel || product.size || '');
  const name = String(product.name || product.productName || 'Product');

  return {
    productId: String(product.id || product.productId || ''),
    productName: name,
    name,
    quantity: qty,
    qty,
    price,
    image,
    colorImage,
    color: colorName,
    colorName,
    size: sizeLabel,
    sizeLabel,
    variantKey: String(product.variantKey || ''),
    sku,
    variantSku: sku,
    category,
    productUrl,
    productLink: productUrl,
    slug: String(product.slug || ''),
    attributeSummary: [colorName, sizeLabel].filter(Boolean).join(' · '),
    attributes: {
      Color: colorName,
      Size: sizeLabel,
      SKU: sku,
      Category: category,
      productUrl,
      productLink: productUrl,
      colorImage
    }
  };
}

function resolveReusableOrderId() {
  const pending = readPendingOrderSubmission();
  const pendingId = String(pending?.order?.orderId || pending?.orderId || '').trim();
  const pendingAt = Number(pending?.at || 0);
  const stillFresh = pendingAt && (Date.now() - pendingAt) < (30 * 60 * 1000);
  if (pendingId && stillFresh) {
    return pendingId;
  }
  return createOrderId();
}

export function buildOrderPayload(options = {}) {
  const state = getState();

  const productsCheck = validateProducts(state.products);
  if (!productsCheck.valid) return productsCheck;

  const shippingCheck = validateShipping(state.shipping);
  if (!shippingCheck.valid) return { valid: false, errors: shippingCheck.errors };

  const paymentCheck = validatePayment(state.payment, state.shipping);
  if (!paymentCheck.valid) return { valid: false, errors: paymentCheck.errors };

  const orderId = String(options.orderId || resolveReusableOrderId()).trim() || createOrderId();
  const createdAt = new Date().toISOString();
  const customerName = String(state.shipping.fullName || state.customer.name || 'Guest Customer').trim();
  const customerPhone = normalizePhone(state.shipping.phone || state.customer.phone);
  const payerPhone = normalizePhone(state.payment.phone || customerPhone);
  const hasAccount = Boolean(state.customer.id);
  const usesCod = state.payment.method === 'cod';
  const paymentStatus = usesCod ? COD_PAYMENT_STATUS : 'awaiting_payment';
  const paymentStatusLabel = usesCod ? COD_PAYMENT_STATUS_LABEL : 'Awaiting Payment';
  const paymentMethodLabel = usesCod ? COD_PAYMENT_METHOD_LABEL : String(state.payment.method || '').toUpperCase();
  const items = state.products.map(buildOrderLineItem);

  const order = {
    id: orderId,
    orderId,
    userId: hasAccount ? state.customer.id : '',
    customerId: hasAccount ? state.customer.id : '',
    isGuest: !hasAccount,
    customerName,
    customerEmail: state.customer.email,
    customerPhone,
    phoneNumber: customerPhone,
    customerImage: state.customer.avatar,
    date: createdAt,
    createdAt,
    status: 'Pending',
    orderStatus: 'pending',
    paymentStatus,
    paymentStatusLabel,
    paymentMethod: usesCod ? 'cod' : state.payment.method,
    paymentMethodLabel,
    paymentType: usesCod ? 'cod' : 'pay_now',
    subtotal: state.totals.subtotal,
    deliveryFee: state.totals.deliveryFee,
    shippingFee: state.totals.deliveryFee,
    codFee: state.totals.codFee,
    total: state.totals.total,
    totalAmount: state.totals.total,
    deliveryMethod: 'delivery',
    deliveryLabel: 'Delivery to address',
    items,
    products: items,
    shippingAddress: {
      ...clone(state.shipping),
      phone: customerPhone,
      city: state.shipping.provinceCity,
      provinceCity: state.shipping.provinceCity,
      district: state.shipping.district,
      sector: state.shipping.sector,
      cell: state.shipping.cell,
      village: state.shipping.village,
      note: state.shipping.note,
      latitude: state.shipping.latitude,
      longitude: state.shipping.longitude,
      mapLink: state.shipping.mapLink
    },
    fullAddress: {
      province: state.shipping.provinceCity,
      district: state.shipping.district,
      sector: state.shipping.sector,
      cell: state.shipping.cell,
      village: state.shipping.village,
      note: state.shipping.note
    },
    gpsLocation: {
      latitude: state.shipping.latitude,
      longitude: state.shipping.longitude,
      googleMapsLink: state.shipping.mapLink,
      mapLink: state.shipping.mapLink,
      accuracy: state.shipping.locationAccuracy,
      capturedAt: state.shipping.locationCapturedAt
    },
    customer: {
      id: hasAccount ? state.customer.id : '',
      name: customerName,
      email: state.customer.email,
      phone: customerPhone,
      avatar: state.customer.avatar,
      isGuest: !hasAccount
    },
    payment: {
      type: usesCod ? 'cod' : 'pay_now',
      method: usesCod ? 'cod' : state.payment.method,
      methodLabel: paymentMethodLabel,
      status: paymentStatus,
      statusLabel: paymentStatusLabel,
      payerPhone: usesCod ? customerPhone : payerPhone,
      note: usesCod ? 'Pay on delivery' : 'Transfer payment using the instructions shown at checkout'
    },
    statusHistory: [{
      status: 'pending',
      label: usesCod ? 'COD order received' : 'Order received — awaiting payment',
      timestamp: createdAt
    }]
  };

  return { valid: true, order };
}

async function postOrder(order) {
  const endpoint = getOrdersApiUrl();
  if (!endpoint) {
    return { success: false, skipped: true, message: 'Checkout API is unavailable. Please refresh and try again.' };
  }

  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  try {
    const token = window.authService?.getToken?.() || window.localStorage?.getItem('bm_auth_token') || '';
    if (token) headers.Authorization = `Bearer ${String(token).trim()}`;
  } catch (_) { /* optional auth */ }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(order)
  });

  const payload = await response.json().catch(() => null);
  if (response.ok) {
    return { success: true, order: payload?.order || order, existing: Boolean(payload?.existing) };
  }

  return {
    success: false,
    message: payload?.message || `Order failed (${response.status})`
  };
}

export async function submitOrder() {
  if (getState().isSubmitting) {
    return { valid: false, message: 'Your order is already being placed. Please wait.' };
  }

  setSubmitting(true);
  let succeeded = false;

  try {
    const prepared = buildOrderPayload();
    if (!prepared.valid) return prepared;

    const { order } = prepared;
    savePendingOrderSubmission({ order, orderId: order.orderId, at: Date.now() });

    const result = await postOrder(order);

    if (!result.success) {
      return { valid: false, message: result.message || 'Unable to place order.' };
    }

    const state = getState();
    const persisted = result.order || order;

    const purchasedKeys = new Set(
      (state.products || []).map((product) => {
        const lineId = String(product.lineId || '').trim();
        if (lineId) return `line:${lineId}`;
        const productId = String(product.id || product.productId || '').trim();
        const variantKey = String(product.variantKey || '').trim();
        return `pv:${productId}|${variantKey}`;
      }).filter(Boolean)
    );

    if (state.source === 'cart' || purchasedKeys.size) {
      const remaining = (readStorage(STORAGE_KEYS.cart, []) || []).filter((item) => {
        const lineId = String(item.lineId || '').trim();
        if (lineId && purchasedKeys.has(`line:${lineId}`)) return false;
        const productId = String(item.productId || item.id || '').trim();
        const variantKey = String(item.variantKey || '').trim();
        return !purchasedKeys.has(`pv:${productId}|${variantKey}`);
      });
      writeStorage(STORAGE_KEYS.cart, remaining);
    }

    removeStorage(STORAGE_KEYS.checkoutActive);
    removeStorage(STORAGE_KEYS.directCheckout);
    removeStorage(STORAGE_KEYS.draft);
    clearPendingOrderSubmission();
    clearCheckoutHandoff();
    emitCartUpdated();

    const confirmation = {
      orderId: persisted.orderId || persisted.id || order.orderId,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      subtotal: Number(persisted.subtotal ?? order.subtotal) || 0,
      deliveryFee: Number(persisted.deliveryFee ?? order.deliveryFee) || 0,
      codFee: Number(persisted.codFee ?? order.codFee) || 0,
      total: Number(persisted.totalAmount ?? persisted.total ?? order.totalAmount) || 0,
      items: Array.isArray(persisted.items) && persisted.items.length ? persisted.items : order.items,
      shippingAddress: order.shippingAddress,
      gpsLocation: order.gpsLocation,
      payment: order.payment,
      paymentMethod: order.paymentMethod,
      paymentMethodLabel: order.paymentMethodLabel,
      paymentStatus: persisted.paymentStatus || order.paymentStatus,
      paymentStatusLabel: persisted.paymentStatusLabel || order.paymentStatusLabel,
      deliveryMethod: order.deliveryMethod,
      deliveryLabel: order.deliveryLabel,
      createdAt: order.createdAt
    };
    saveCheckoutConfirmation(confirmation);
    succeeded = true;

    return { valid: true, orderId: confirmation.orderId, confirmation };
  } finally {
    // Keep the submit lock on success until the browser navigates away.
    if (!succeeded) {
      setSubmitting(false);
    }
  }
}
