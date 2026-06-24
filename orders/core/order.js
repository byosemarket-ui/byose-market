import {
  STORAGE_KEYS,
  clone,
  createOrderId,
  emitCartUpdated,
  normalizePhone,
  removeStorage,
  resolveApiOrigin,
  resolveOrderItemImage,
  saveCheckoutConfirmation,
  writeStorage
} from '../utils.js';
import { clearCheckoutHandoff, getState } from './state.js';
import { validatePayment, validateProducts, validateShipping } from './validation.js';

function getOrdersApiUrl() {
  const base = resolveApiOrigin();
  if (!base) return '';
  return base.endsWith('/api') ? `${base}/orders` : `${base}/api/orders`;
}

export function buildOrderPayload() {
  const state = getState();

  const productsCheck = validateProducts(state.products);
  if (!productsCheck.valid) return productsCheck;

  const shippingCheck = validateShipping(state.shipping);
  if (!shippingCheck.valid) return { valid: false, errors: shippingCheck.errors };

  const paymentCheck = validatePayment(state.payment, state.shipping);
  if (!paymentCheck.valid) return { valid: false, errors: paymentCheck.errors };

  const orderId = createOrderId();
  const createdAt = new Date().toISOString();
  const customerName = String(state.shipping.fullName || state.customer.name || 'Guest Customer').trim();
  const customerPhone = normalizePhone(state.shipping.phone || state.customer.phone);
  const payerPhone = normalizePhone(state.payment.phone || customerPhone);
  const hasAccount = Boolean(state.customer.id);
  const usesCod = state.payment.method === 'cod';

  const items = state.products.map((product) => {
    const image = resolveOrderItemImage(product);
    const qty = Math.max(1, Number(product.qty) || 1);
    return {
      productId: String(product.id || product.productId || ''),
      productName: String(product.name || 'Product'),
      quantity: qty,
      price: Number(product.price) || 0,
      image,
      color: String(product.colorName || product.color || ''),
      colorName: String(product.colorName || product.color || ''),
      colorImage: String(product.colorImage || ''),
      size: String(product.sizeLabel || product.size || ''),
      sizeLabel: String(product.sizeLabel || product.size || ''),
      variantKey: String(product.variantKey || ''),
      attributeSummary: [product.colorName || product.color, product.sizeLabel || product.size].filter(Boolean).join(' · ')
    };
  });

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
    paymentStatus: 'pending',
    paymentStatusLabel: 'Pending',
    paymentMethod: usesCod ? 'cod' : state.payment.method,
    paymentType: usesCod ? 'cod' : 'pay_now',
    subtotal: state.totals.subtotal,
    deliveryFee: state.totals.deliveryFee,
    shippingFee: state.totals.deliveryFee,
    codFee: state.totals.codFee,
    total: state.totals.total,
    totalAmount: state.totals.total,
    deliveryMethod: state.delivery,
    deliveryLabel: state.delivery === 'pickup' ? 'Store pickup' : 'Delivery to address',
    items,
    products: items,
    shippingAddress: {
      ...clone(state.shipping),
      phone: customerPhone,
      city: state.shipping.provinceCity
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
      googleMapsLink: state.shipping.mapLink
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
      status: 'pending',
      statusLabel: 'Pending',
      payerPhone,
      note: usesCod ? 'Pay on delivery' : ''
    },
    statusHistory: [{ status: 'pending', label: 'Order received', timestamp: createdAt }]
  };

  return { valid: true, order };
}

async function postOrder(order) {
  const endpoint = getOrdersApiUrl();
  if (!endpoint) return { skipped: true, order };

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
  const prepared = buildOrderPayload();
  if (!prepared.valid) return prepared;

  const { order } = prepared;
  const result = await postOrder(order);

  if (result.success === false && !result.skipped) {
    return { valid: false, message: result.message || 'Unable to place order.' };
  }

  const state = getState();
  const persisted = result.order || order;

  if (state.source === 'cart') {
    writeStorage(STORAGE_KEYS.cart, []);
  } else {
    removeStorage(STORAGE_KEYS.directCheckout);
  }
  removeStorage(STORAGE_KEYS.draft);
  clearCheckoutHandoff();
  emitCartUpdated();

  const confirmation = {
    orderId: persisted.orderId || persisted.id,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    total: order.totalAmount,
    items: order.items,
    shippingAddress: order.shippingAddress,
    gpsLocation: order.gpsLocation,
    payment: order.payment,
    createdAt: order.createdAt
  };
  saveCheckoutConfirmation(confirmation);

  return { valid: true, orderId: confirmation.orderId, confirmation };
}
