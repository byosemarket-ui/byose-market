import {
  STORAGE_KEYS,
  clone,
  createOrderId,
  emitCartUpdated,
  normalizePhone,
  removeStorage,
  resolveApiOrigin,
  resolveOrderItemImage,
  resolveProductUrl,
  saveCheckoutConfirmation,
  writeStorage
} from '../utils.js';
import {
  COD_PAYMENT_METHOD_LABEL,
  COD_PAYMENT_STATUS,
  COD_PAYMENT_STATUS_LABEL
} from './constants.js';
import { clearCheckoutHandoff, getState } from './state.js';
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

  return {
    productId: String(product.id || product.productId || ''),
    productName: String(product.name || 'Product'),
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
  const paymentStatus = usesCod ? COD_PAYMENT_STATUS : 'pending';
  const paymentStatusLabel = usesCod ? COD_PAYMENT_STATUS_LABEL : 'Pending';
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
      note: usesCod ? 'Pay on delivery' : ''
    },
    statusHistory: [{
      status: 'pending',
      label: usesCod ? 'COD order received' : 'Order received',
      timestamp: createdAt
    }]
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
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    codFee: order.codFee,
    total: order.totalAmount,
    items: order.items,
    shippingAddress: order.shippingAddress,
    gpsLocation: order.gpsLocation,
    payment: order.payment,
    paymentMethod: order.paymentMethod,
    paymentMethodLabel: order.paymentMethodLabel,
    paymentStatus: order.paymentStatus,
    paymentStatusLabel: order.paymentStatusLabel,
    deliveryMethod: order.deliveryMethod,
    deliveryLabel: order.deliveryLabel,
    createdAt: order.createdAt
  };
  saveCheckoutConfirmation(confirmation);

  return { valid: true, orderId: confirmation.orderId, confirmation };
}
