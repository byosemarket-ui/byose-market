import { REQUIRED_SHIPPING_FIELDS, FIELD_LABELS } from './constants.js';
import { isValidPhone, normalizePhone } from '../utils.js';

export function validateShipping(address = {}) {
  const errors = {};

  REQUIRED_SHIPPING_FIELDS.forEach((field) => {
    if (!String(address[field] || '').trim()) {
      errors[field] = `Please enter your ${FIELD_LABELS[field].toLowerCase()}.`;
    }
  });

  const rawPhone = String(address.phone || '').trim();
  if (rawPhone && !isValidPhone(normalizePhone(rawPhone))) {
    errors.phone = 'Please enter a valid Rwanda phone number (07XXXXXXXX).';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors
  };
}

export function validatePayment(payment = {}, shippingAddress = {}) {
  const errors = {};
  const method = String(payment.method || '').trim().toLowerCase();

  if (!method) {
    errors.method = 'Select a payment method.';
    return { valid: false, errors };
  }

  if (method === 'cod') {
    const city = String(shippingAddress.provinceCity || shippingAddress.city || '').toLowerCase();
    if (!city.includes('kigali')) {
      errors.method = 'Cash on Delivery is only available in Kigali.';
    }
    return { valid: Object.keys(errors).length === 0, errors };
  }

  // Gateway checkout (DPO) collects payment on the hosted page — phone optional.
  if (method === 'dpo') {
    return { valid: true, errors };
  }

  const phone = normalizePhone(payment.phone || shippingAddress.phone);
  if (!isValidPhone(phone)) {
    errors.phone = 'Enter a valid payment phone number.';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateProducts(products = []) {
  if (!Array.isArray(products) || products.length === 0) {
    return { valid: false, message: 'Your cart is empty. Add a product first.' };
  }
  return { valid: true };
}
