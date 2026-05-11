/**
 * STEP 3N: SKU System & Inventory Helpers
 * Enterprise-grade SKU generation, normalization, and inventory utilities
 * 
 * Features:
 * - Automatic SKU generation with product ID
 * - Variant SKU generation (base + variant key)
 * - SKU uniqueness validation
 * - Inventory status calculation
 * - Stock availability checking
 */

/**
 * Generate base SKU for a product
 * Format: BM-[CATALOG_ID]-[00000]
 */
export function generateBaseSku(catalogId, productId = null) {
  const id = productId !== null ? productId : catalogId;
  const padded = String(id).padStart(5, '0');
  return `BM-${padded}`;
}

/**
 * Generate variant SKU
 * Format: BM-[CATALOG_ID]-[VARIANT_KEY]-[COLOR]-[SIZE]
 */
export function generateVariantSku(catalogId, variantKey = '') {
  const baseSku = generateBaseSku(catalogId);
  if (!variantKey || variantKey.trim() === '') {
    return baseSku;
  }
  
  const normalized = variantKey
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .substring(0, 20);
  
  return `${baseSku}-${normalized}`;
}

/**
 * Normalize SKU format and ensure consistency
 */
export function normalizeSku(sku) {
  return String(sku || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\-_]/g, '');
}

/**
 * Determine availability status based on stock quantity
 */
export function getAvailabilityStatus(quantity, lowStockThreshold = 5, allowBackorder = false) {
  const q = Number(quantity) || 0;
  const threshold = Number(lowStockThreshold) || 5;
  
  if (q <= 0) {
    return allowBackorder ? 'backorder' : 'out_of_stock';
  }
  
  if (q <= threshold) {
    return 'low_stock';
  }
  
  return 'in_stock';
}

/**
 * Get availability badge text (e.g., "In Stock", "Low Stock", "Out of Stock")
 */
export function getAvailabilityLabel(status) {
  const labels = {
    'in_stock': 'In Stock',
    'low_stock': 'Low Stock',
    'out_of_stock': 'Out of Stock',
    'backorder': 'Backorder',
    'discontinued': 'Discontinued'
  };
  
  return labels[String(status || 'in_stock').toLowerCase()] || 'Unknown';
}

/**
 * Get availability badge styling class
 */
export function getAvailabilityClass(status) {
  const classes = {
    'in_stock': 'inventory-badge--in-stock',
    'low_stock': 'inventory-badge--low-stock',
    'out_of_stock': 'inventory-badge--out-of-stock',
    'backorder': 'inventory-badge--backorder',
    'discontinued': 'inventory-badge--discontinued'
  };
  
  return classes[String(status || 'in_stock').toLowerCase()] || 'inventory-badge--unknown';
}

/**
 * Format stock quantity for display
 */
export function formatStockDisplay(quantity, highThreshold = 50) {
  const q = Number(quantity) || 0;
  const high = Number(highThreshold) || 50;
  
  if (q <= 0) {
    return 'Out of stock';
  }
  
  if (q <= 3) {
    return `Only ${q} left`;
  }
  
  if (q <= 10) {
    return `Limited stock (${q} available)`;
  }
  
  if (q >= high) {
    return 'Plenty in stock';
  }
  
  return `${q} available`;
}

/**
 * Calculate available quantity (total - reserved)
 */
export function calculateAvailableQuantity(total, reserved) {
  const t = Number(total) || 0;
  const r = Number(reserved) || 0;
  return Math.max(0, t - r);
}

/**
 * Check if quantity allows purchase
 */
export function canPurchase(quantity, requestedQty) {
  const available = Number(quantity) || 0;
  const requested = Number(requestedQty) || 1;
  return available >= requested;
}

/**
 * Check if product is low stock
 */
export function isLowStock(quantity, threshold = 5) {
  const q = Number(quantity) || 0;
  const t = Number(threshold) || 5;
  return q > 0 && q <= t;
}

/**
 * Check if product is out of stock
 */
export function isOutOfStock(quantity) {
  return Number(quantity) || 0 <= 0;
}

/**
 * Validate inventory entry (for data consistency)
 */
export function validateInventoryEntry(entry) {
  const errors = [];
  
  if (!entry.sku || !entry.sku.trim()) {
    errors.push('SKU is required');
  }
  
  if (Number(entry.quantity) < 0) {
    errors.push('Quantity cannot be negative');
  }
  
  if (Number(entry.reserved) < 0) {
    errors.push('Reserved quantity cannot be negative');
  }
  
  if (Number(entry.reserved) > Number(entry.quantity)) {
    errors.push('Reserved quantity cannot exceed total quantity');
  }
  
  if (Number(entry.lowStockThreshold) < 0) {
    errors.push('Low stock threshold cannot be negative');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Create inventory summary for product
 */
export function createInventorySummary(baseStock, variantStocks = []) {
  const base = Number(baseStock) || 0;
  const variants = Array.isArray(variantStocks) ? variantStocks : [];
  
  const totalStock = base + variants.reduce((sum, v) => sum + (Number(v.quantity) || 0), 0);
  const totalReserved = variants.reduce((sum, v) => sum + (Number(v.reserved) || 0), 0);
  const totalAvailable = calculateAvailableQuantity(totalStock, totalReserved);
  
  return {
    totalStock,
    totalReserved,
    totalAvailable,
    hasVariants: variants.length > 0,
    variantCount: variants.length,
    status: getAvailabilityStatus(totalAvailable)
  };
}

/**
 * Build availability badge markup
 */
export function buildAvailabilityBadge(status, quantity, opts = {}) {
  const label = getAvailabilityLabel(status);
  const className = getAvailabilityClass(status);
  const icon = opts.icon !== false ? getAvailabilityIcon(status) : '';
  const showQty = opts.showQuantity && quantity > 0;
  
  return {
    label,
    className,
    icon,
    display: showQty ? `${label} (${quantity} available)` : label,
    html: `<span class="inventory-badge ${className}" role="status" aria-live="polite">${icon} ${label}${showQty ? ` (${quantity})` : ''}</span>`
  };
}

/**
 * Get availability icon
 */
export function getAvailabilityIcon(status) {
  const icons = {
    'in_stock': '<i class="fa-solid fa-check-circle" aria-hidden="true"></i>',
    'low_stock': '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>',
    'out_of_stock': '<i class="fa-solid fa-circle-xmark" aria-hidden="true"></i>',
    'backorder': '<i class="fa-solid fa-clock" aria-hidden="true"></i>',
    'discontinued': '<i class="fa-solid fa-ban" aria-hidden="true"></i>'
  };
  
  return icons[String(status || 'in_stock').toLowerCase()] || '';
}

/**
 * Export all utilities
 */
export default {
  generateBaseSku,
  generateVariantSku,
  normalizeSku,
  getAvailabilityStatus,
  getAvailabilityLabel,
  getAvailabilityClass,
  formatStockDisplay,
  calculateAvailableQuantity,
  canPurchase,
  isLowStock,
  isOutOfStock,
  validateInventoryEntry,
  createInventorySummary,
  buildAvailabilityBadge,
  getAvailabilityIcon
};
