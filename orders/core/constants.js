export const STEPS = [
  { id: 'shipping', label: 'Shipping', file: 'shipping.html' },
  { id: 'review', label: 'Review', file: 'checkout.html' },
  { id: 'payment', label: 'Payment', file: 'payment.html' },
  { id: 'success', label: 'Success', file: 'order-success.html' }
];

export const DELIVERY_FEE = 2000;
// Fallback only — live checkout uses Delivery Settings via /api/shipping/calculate.
export const COD_FEE = 0;

export const COD_PAYMENT_STATUS = 'awaiting_delivery_payment';
export const COD_PAYMENT_STATUS_LABEL = 'Awaiting Delivery Payment';
export const COD_PAYMENT_METHOD_LABEL = 'Cash on Delivery';

export const DEFAULT_PAYMENT_METHOD = 'mtn';

export const PAYMENT_METHODS = [
  {
    id: 'mtn',
    label: 'MTN MoMo',
    logo: '/img/MTN.jpeg',
    hint: 'Pay with MTN Mobile Money',
    type: 'gateway',
    enabled: true,
    gateway: 'dpo'
  },
  {
    id: 'card',
    label: 'Card',
    subtitle: 'Visa / Mastercard',
    logo: '/img/VASA  MASTERCARD.jpeg',
    hint: 'Pay securely with Visa / Mastercard',
    type: 'gateway',
    enabled: true,
    gateway: 'dpo'
  },
  {
    id: 'cod',
    label: 'Cash on Delivery',
    logo: '/img/PAY ON DELIVERY.jpeg',
    hint: 'Pay when your order is delivered',
    type: 'cod',
    enabled: true
  }
];

export const PAYMENT_METHOD_LABELS = {
  mtn: 'MTN MoMo',
  card: 'Card',
  cod: COD_PAYMENT_METHOD_LABEL
};

export function isGatewayPaymentMethod(method) {
  const id = String(method || '').trim().toLowerCase();
  return id === 'mtn' || id === 'card';
}

export function isCodPaymentMethod(method) {
  return String(method || '').trim().toLowerCase() === 'cod';
}

export function paymentMethodLabel(method) {
  const id = String(method || '').trim().toLowerCase();
  return PAYMENT_METHOD_LABELS[id] || '';
}

export function paymentCtaLabel(method, formattedTotal = '') {
  const id = String(method || '').trim().toLowerCase();
  if (id === 'mtn') return formattedTotal ? `Pay ${formattedTotal}` : 'Pay with MTN MoMo';
  if (id === 'card') return formattedTotal ? `Pay ${formattedTotal}` : 'Pay with Card';
  if (id === 'cod') return 'Place Order';
  return 'Place Order';
}

export function normalizeCheckoutPaymentMethod(value, fallback = DEFAULT_PAYMENT_METHOD) {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (raw === 'mtn' || raw === 'mtn_momo' || raw === 'momo') return 'mtn';
  if (raw === 'card' || raw === 'visa' || raw === 'mastercard' || raw === 'visa_mastercard') return 'card';
  if (raw === 'cod' || raw === 'cash_on_delivery' || raw === 'cash') return 'cod';
  return fallback;
}

export const REQUIRED_SHIPPING_FIELDS = [
  'fullName', 'phone', 'provinceCity', 'district', 'sector', 'cell', 'village'
];

export const FIELD_LABELS = {
  fullName: 'Full Name',
  phone: 'Phone Number',
  provinceCity: 'Province / City',
  district: 'District',
  sector: 'Sector',
  cell: 'Cell',
  village: 'Village',
  note: 'Landmark / Note'
};
