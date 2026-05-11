import { validateCartInventory, buildInventoryReservation, prepareStockDeductionPayload } from './inventory-cart-logic.js';

export const CHECKOUT_FOUNDATION_VERSION = '3P';

export const ORDER_STEPS = [
  { id: 'shipping', label: 'Shipping' },
  { id: 'checkout', label: 'Checkout' },
  { id: 'payment', label: 'Payment' }
];

export function normalizeProductId(product = {}) {
  return String(product.productId || product.id || '').trim();
}

function resolveAvailableStock(product = {}) {
  const candidates = [
    product.availableStock,
    product.available,
    product.stock,
    product.inventorySnapshot?.available,
    product.inventory?.available,
    product.inventory?.quantity
  ];

  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return numeric;
    }
  }

  return Number.POSITIVE_INFINITY;
}

export function buildInventoryMapFromProducts(products = []) {
  return (Array.isArray(products) ? products : []).reduce((inventoryMap, product) => {
    const productId = normalizeProductId(product);
    if (!productId) {
      return inventoryMap;
    }

    inventoryMap[productId] = {
      productId,
      available: resolveAvailableStock(product),
      lowStockThreshold: Number(product.lowStockThreshold || product.inventorySnapshot?.lowStockThreshold || 5) || 5
    };

    return inventoryMap;
  }, {});
}

export function validateCheckoutInventory(products = []) {
  const normalizedProducts = (Array.isArray(products) ? products : []).map((product) => ({
    productId: normalizeProductId(product),
    qty: Math.max(1, Number(product.qty || 1) || 1),
    sku: String(product.sku || product.inventorySnapshot?.sku || '').trim(),
    variantKey: String(product.variantKey || '').trim()
  }));

  const inventoryMap = buildInventoryMapFromProducts(products);
  const inventoryValidation = validateCartInventory(normalizedProducts, inventoryMap);

  const hasUnknownInventory = normalizedProducts.some((item) => !Object.prototype.hasOwnProperty.call(inventoryMap, item.productId));

  return {
    valid: Boolean(inventoryValidation.valid) && !hasUnknownInventory,
    inventoryMap,
    normalizedProducts,
    errors: Array.isArray(inventoryValidation.errors) ? inventoryValidation.errors : [],
    adjustments: Array.isArray(inventoryValidation.adjustments) ? inventoryValidation.adjustments : []
  };
}

export function buildOrderPreparationArtifacts({ orderId = '', customerId = '', products = [] } = {}) {
  const normalizedProducts = (Array.isArray(products) ? products : []).map((product) => ({
    productId: normalizeProductId(product),
    qty: Math.max(1, Number(product.qty || 1) || 1),
    sku: String(product.sku || product.inventorySnapshot?.sku || '').trim(),
    variantKey: String(product.variantKey || '').trim()
  }));

  return {
    reservation: buildInventoryReservation(normalizedProducts, {
      orderId,
      customerId,
      reservationReason: 'checkout_preparation'
    }),
    deduction: prepareStockDeductionPayload(normalizedProducts, orderId)
  };
}
