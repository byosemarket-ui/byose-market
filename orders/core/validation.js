import { REQUIRED_SHIPPING_FIELDS, FIELD_LABELS, isCodPaymentMethod, isGatewayPaymentMethod } from './constants.js';
import { isKigaliDeliveryLocation } from './location.js';
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

  if (!isCodPaymentMethod(method) && !isGatewayPaymentMethod(method)) {
    errors.method = 'Choose Online Payment or Cash on Delivery.';
    return { valid: false, errors };
  }

  if (isCodPaymentMethod(method)) {
    if (!isKigaliDeliveryLocation(shippingAddress)) {
      errors.method = 'Cash on Delivery is only available in Kigali.';
    }
    return { valid: Object.keys(errors).length === 0, errors };
  }

  // MTN MoMo uses the number entered on Payment. Card reuses the shipping phone.
  const phone = normalizePhone(
    method === 'mtn'
      ? (payment.phone || shippingAddress.phone)
      : (shippingAddress.phone || payment.phone)
  );
  if (!isValidPhone(phone)) {
    errors.phone = method === 'mtn'
      ? 'Enter a valid MTN Mobile Number (7XXXXXXXX).'
      : 'A valid shipping phone number is required for payment.';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateProducts(products = []) {
  if (!Array.isArray(products) || products.length === 0) {
    return { valid: false, message: 'Your cart is empty. Add a product first.' };
  }
  const invalidQty = products.find((product) => {
    const qty = Number(product?.qty ?? product?.quantity);
    return !Number.isFinite(qty) || qty < 1;
  });
  if (invalidQty) {
    return { valid: false, message: 'Quantity must be at least 1.' };
  }
  return { valid: true };
}
