/**
 * STEP 3N: Cart & Order Inventory Logic
 * Foundation for stock validation, reservation, and deduction during checkout
 * 
 * Note: Does NOT finalize stock deduction yet (reserved for STEP 4+)
 * This layer prepares the contracts and foundations
 */

/**
 * Validate cart item quantity against available inventory
 */
export function validateCartItemInventory(item, inventory = {}) {
  const qty = Number(item.qty) || 1;
  const available = Number(inventory.available) || 0;
  
  if (available <= 0) {
    return {
      valid: false,
      error: 'Product is out of stock',
      code: 'OUT_OF_STOCK'
    };
  }
  
  if (qty > available) {
    return {
      valid: false,
      error: `Only ${available} available. Please adjust quantity.`,
      code: 'INSUFFICIENT_STOCK',
      maxAvailable: available
    };
  }
  
  return {
    valid: true,
    maxAvailable: available
  };
}

/**
 * Validate entire cart against inventory
 */
export function validateCartInventory(cartItems = [], inventoryMap = {}) {
  const results = {
    valid: true,
    errors: [],
    adjustments: []
  };
  
  cartItems.forEach((item, index) => {
    const inventory = inventoryMap[item.productId];
    if (!inventory) {
      results.errors.push({
        itemIndex: index,
        productId: item.productId,
        error: 'Inventory not found',
        code: 'INVENTORY_NOT_FOUND'
      });
      results.valid = false;
      return;
    }
    
    const validation = validateCartItemInventory(item, inventory);
    if (!validation.valid) {
      results.errors.push({
        itemIndex: index,
        productId: item.productId,
        ...validation
      });
      results.valid = false;
      
      // Suggest adjustment
      if (validation.maxAvailable && validation.maxAvailable > 0) {
        results.adjustments.push({
          itemIndex: index,
          productId: item.productId,
          suggestedQty: validation.maxAvailable,
          currentQty: item.qty
        });
      }
    }
  });
  
  return results;
}

/**
 * Build inventory reservation from cart
 */
export function buildInventoryReservation(cartItems = [], options = {}) {
  const defaults = {
    orderId: '',
    customerId: '',
    reservationReason: 'cart_checkout'
  };
  
  const opts = { ...defaults, ...options };
  
  return {
    orderId: opts.orderId,
    customerId: opts.customerId,
    reason: opts.reservationReason,
    timestamp: new Date().toISOString(),
    items: cartItems.map(item => ({
      productId: item.productId,
      sku: item.sku || `BM-${item.productId}`,
      variantKey: item.variantKey || '',
      quantity: item.qty,
      requestedAt: new Date().toISOString(),
      status: 'pending_reservation'
    }))
  };
}

/**
 * Prepare stock deduction payload (for order placement)
 */
export function prepareStockDeductionPayload(cartItems = [], orderId = '') {
  return {
    orderId,
    timestamp: new Date().toISOString(),
    deductions: cartItems.map(item => ({
      productId: item.productId,
      sku: item.sku || `BM-${item.productId}`,
      variantKey: item.variantKey || '',
      quantity: item.qty,
      reason: 'order_placed',
      autoDeduct: true
    })),
    totalItems: cartItems.length,
    totalQty: cartItems.reduce((sum, item) => sum + (item.qty || 1), 0)
  };
}

/**
 * Calculate inventory impact of cart
 */
export function calculateInventoryImpact(cartItems = [], currentInventory = {}) {
  const totalQty = cartItems.reduce((sum, item) => sum + (item.qty || 1), 0);
  const currentAvailable = currentInventory.available || 0;
  const remainingAfter = Math.max(0, currentAvailable - totalQty);
  
  return {
    totalQuantity: totalQty,
    currentAvailable,
    remainingAfter,
    percentUsed: currentAvailable > 0 ? Math.round((totalQty / currentAvailable) * 100) : 100,
    willBeLowStock: remainingAfter > 0 && remainingAfter <= (currentInventory.lowStockThreshold || 5),
    willBeOutOfStock: remainingAfter <= 0
  };
}

/**
 * Format inventory impact for display
 */
export function formatInventoryImpact(impact = {}) {
  const messages = [];
  
  if (impact.willBeOutOfStock) {
    messages.push('This order will exhaust inventory');
  } else if (impact.willBeLowStock) {
    messages.push(`This order will bring stock to low levels (${impact.remainingAfter} remaining)`);
  }
  
  if (impact.percentUsed >= 90) {
    messages.push(`This order represents ${impact.percentUsed}% of current inventory`);
  }
  
  return {
    messages,
    severity: impact.willBeOutOfStock ? 'critical' : impact.willBeLowStock ? 'warning' : 'normal',
    impactLevel: impact.percentUsed
  };
}

/**
 * Validate order placement (pre-flight check)
 */
export function validateOrderPlacement(orderData = {}, inventorySummary = {}) {
  const errors = [];
  
  if (!orderData.items || orderData.items.length === 0) {
    errors.push('Order must contain at least one item');
  }
  
  if (inventorySummary.stockErrors && inventorySummary.stockErrors.length > 0) {
    errors.push('One or more items have insufficient inventory');
  }
  
  if (inventorySummary.outOfStockCount > 0) {
    errors.push(`${inventorySummary.outOfStockCount} item(s) are out of stock`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    canRetry: errors.some(e => e.includes('insufficient'))
  };
}

/**
 * Create inventory hold token (for order processing)
 */
export function createInventoryHoldToken(cartItems = {}, duration = 15) {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + duration);
  
  return {
    token: generateRandomToken(),
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
    durationMinutes: duration,
    items: cartItems.map(item => ({
      productId: item.productId,
      variantKey: item.variantKey || '',
      quantity: item.qty
    })),
    status: 'active'
  };
}

/**
 * Generate random token for hold
 */
function generateRandomToken() {
  return `hold_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Build low stock alert payload
 */
export function buildLowStockAlert(inventory = {}, threshold = 5) {
  const available = inventory.available || 0;
  
  if (available <= 0 || available > threshold) {
    return null;
  }
  
  return {
    productId: inventory.productId,
    sku: inventory.sku,
    alertType: available === 0 ? 'out_of_stock' : 'low_stock',
    currentStock: available,
    threshold,
    severity: available === 0 ? 'critical' : available <= 2 ? 'high' : 'medium',
    timestamp: new Date().toISOString(),
    message: available === 0 
      ? 'Product is out of stock' 
      : `Only ${available} unit(s) remaining`
  };
}

/**
 * Check if variant has sufficient stock
 */
export function hasVariantStock(variant = {}, requestedQty = 1) {
  const inventory = variant.inventory || {};
  const available = Number(inventory.available) || 0;
  const requested = Number(requestedQty) || 1;
  
  return {
    hasSufficientStock: available >= requested,
    available,
    requested,
    shortBy: Math.max(0, requested - available)
  };
}

/**
 * Export all cart/order inventory functions
 */
export default {
  validateCartItemInventory,
  validateCartInventory,
  buildInventoryReservation,
  prepareStockDeductionPayload,
  calculateInventoryImpact,
  formatInventoryImpact,
  validateOrderPlacement,
  createInventoryHoldToken,
  buildLowStockAlert,
  hasVariantStock
};
