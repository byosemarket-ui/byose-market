export const STEPS = [
  { id: 'shipping', label: 'Shipping', file: 'shipping.html' },
  { id: 'review', label: 'Review', file: 'checkout.html' },
  { id: 'payment', label: 'Payment', file: 'payment.html' },
  { id: 'success', label: 'Success', file: 'order-success.html' }
];

export const DELIVERY_FEE = 5000;
export const COD_FEE = 2000;

export const PAYMENT_METHODS = [
  { id: 'mtn', label: 'MTN MoMo', icon: '📱', type: 'pay_now', enabled: true },
  { id: 'airtel', label: 'Airtel Money', icon: '📱', type: 'pay_now', enabled: true },
  { id: 'bank', label: 'Bank Transfer', icon: '🏦', type: 'pay_now', enabled: true },
  { id: 'card', label: 'Card', icon: '💳', type: 'pay_now', enabled: true },
  { id: 'cod', label: 'Cash on Delivery', icon: '💵', type: 'cod', enabled: true }
];

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
