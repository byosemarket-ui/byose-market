export const STEPS = [
  { id: 'shipping', label: 'Shipping', file: 'shipping.html' },
  { id: 'review', label: 'Review', file: 'checkout.html' },
  { id: 'payment', label: 'Payment', file: 'payment.html' },
  { id: 'success', label: 'Success', file: 'order-success.html' }
];

export const DELIVERY_FEE = 2000;
// The checkout total is always subtotal + the flat delivery fee.
export const COD_FEE = 0;

export const COD_PAYMENT_STATUS = 'awaiting_delivery_payment';
export const COD_PAYMENT_STATUS_LABEL = 'Awaiting Delivery Payment';
export const COD_PAYMENT_METHOD_LABEL = 'Cash on Delivery';

export const PAYMENT_METHODS = [
  { id: 'mtn', label: 'MTN MoMo', logo: '/img/MTN.jpeg', hint: 'Mobile money', type: 'pay_now', enabled: true },
  { id: 'airtel', label: 'Airtel Money', logo: '/img/airtel.jpeg', hint: 'Mobile money', type: 'pay_now', enabled: true },
  { id: 'bank', label: 'Bank Transfer', logo: '/img/BANK TRANSFER.jpeg', hint: 'Bank deposit', type: 'pay_now', enabled: true },
  { id: 'card', label: 'Card', logo: '/img/VASA  MASTERCARD.jpeg', hint: 'Visa / Mastercard', type: 'pay_now', enabled: true },
  { id: 'cod', label: 'Cash on Delivery', logo: '/img/PAY ON DELIVERY.jpeg', hint: 'Kwishyura ibyo watumye bikugezeho', type: 'cod', enabled: true }
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
