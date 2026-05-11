/**
 * STEP 3N: Inventory Controller
 * Enterprise-grade inventory management, stock tracking, and availability logic
 * 
 * Handles:
 * - Inventory CRUD operations
 * - Stock deduction on purchase
 * - Low-stock alerts
 * - Transaction logging
 * - Inventory synchronization
 */

const { ProductInventory, InventoryTransaction } = require('../models/inventory');
const Product = require('../models/product');
const {
  generateBaseSku,
  generateVariantSku,
  getAvailabilityStatus,
  calculateAvailableQuantity,
  validateInventoryEntry
} = require('../utils/inventory-helpers');

/**
 * Initialize or sync inventory for a product
 */
async function syncProductInventory(product) {
  try {
    const catalogId = product.catalogId || product.id;
    const productId = product._id;
    
    // Check if inventory already exists
    let inventory = await ProductInventory.findOne({ productId });
    
    if (!inventory) {
      // Create new inventory record
      const baseSku = generateBaseSku(catalogId);
      
      inventory = new ProductInventory({
        productId,
        catalogId,
        baseSku,
        baseStock: product.stock || 0,
        baseReserved: 0,
        hasVariants: Array.isArray(product.attributes) && product.attributes.length > 0,
        trackingEnabled: true
      });
      
      await inventory.save();
    }
    
    return inventory;
  } catch (error) {
    console.error('Error syncing product inventory:', error);
    throw error;
  }
}

/**
 * Get inventory for a product
 */
async function getProductInventory(productId) {
  try {
    return await ProductInventory.findOne({ productId });
  } catch (error) {
    console.error('Error fetching product inventory:', error);
    return null;
  }
}

/**
 * Get inventory by catalog ID
 */
async function getInventoryByCatalogId(catalogId) {
  try {
    return await ProductInventory.findOne({ catalogId });
  } catch (error) {
    console.error('Error fetching inventory by catalog ID:', error);
    return null;
  }
}

/**
 * Update base stock
 */
async function updateBaseStock(productId, newQuantity, reason = 'adjustment', performedBy = 'system') {
  try {
    const inventory = await ProductInventory.findOne({ productId });
    if (!inventory) {
      throw new Error('Inventory not found');
    }
    
    const oldQuantity = inventory.baseStock;
    inventory.baseStock = Math.max(0, Number(newQuantity) || 0);
    inventory.lastStockAdjustment = new Date();
    inventory.lastStockAdjustmentBy = performedBy;
    
    // Update availability
    inventory.overallStatus = getAvailabilityStatus(
      inventory.baseStock,
      inventory.baseLowStockThreshold
    );
    
    await inventory.save();
    
    // Log transaction
    await logInventoryTransaction({
      productId,
      catalogId: inventory.catalogId,
      sku: inventory.baseSku,
      transactionType: 'adjustment',
      quantityBefore: oldQuantity,
      quantityChange: inventory.baseStock - oldQuantity,
      quantityAfter: inventory.baseStock,
      reason,
      performedBy
    });
    
    return inventory;
  } catch (error) {
    console.error('Error updating base stock:', error);
    throw error;
  }
}

/**
 * Update variant stock
 */
async function updateVariantStock(productId, variantKey, newQuantity, reason = 'adjustment', performedBy = 'system') {
  try {
    const inventory = await ProductInventory.findOne({ productId });
    if (!inventory) {
      throw new Error('Inventory not found');
    }
    
    // Find or create variant stock entry
    let variantStock = inventory.variantStocks.find(v => v.variantKey === variantKey);
    
    if (!variantStock) {
      const sku = generateVariantSku(inventory.catalogId, variantKey);
      variantStock = {
        variantKey,
        sku,
        quantity: 0,
        reserved: 0,
        status: 'out_of_stock'
      };
      inventory.variantStocks.push(variantStock);
    }
    
    const oldQuantity = variantStock.quantity;
    variantStock.quantity = Math.max(0, Number(newQuantity) || 0);
    variantStock.status = getAvailabilityStatus(variantStock.quantity, variantStock.lowStockThreshold);
    variantStock.lastUpdated = new Date();
    
    await inventory.save();
    
    // Log transaction
    await logInventoryTransaction({
      productId,
      catalogId: inventory.catalogId,
      sku: variantStock.sku,
      variantKey,
      transactionType: 'adjustment',
      quantityBefore: oldQuantity,
      quantityChange: variantStock.quantity - oldQuantity,
      quantityAfter: variantStock.quantity,
      reason,
      performedBy
    });
    
    return variantStock;
  } catch (error) {
    console.error('Error updating variant stock:', error);
    throw error;
  }
}

/**
 * Deduct stock on purchase (reserve quantity)
 */
async function reserveStock(productId, variantKey, quantity, orderId = '', reason = 'sale') {
  try {
    const inventory = await ProductInventory.findOne({ productId });
    if (!inventory) {
      throw new Error('Inventory not found');
    }
    
    const qty = Math.max(1, Number(quantity) || 1);
    let source = null;
    
    if (variantKey) {
      // Reserve from variant stock
      source = inventory.variantStocks.find(v => v.variantKey === variantKey);
      if (!source) {
        throw new Error(`Variant stock not found: ${variantKey}`);
      }
      
      const available = calculateAvailableQuantity(source.quantity, source.reserved);
      if (available < qty) {
        throw new Error(`Insufficient stock for variant: ${variantKey}`);
      }
      
      source.reserved += qty;
    } else {
      // Reserve from base stock
      const available = calculateAvailableQuantity(inventory.baseStock, inventory.baseReserved);
      if (available < qty) {
        throw new Error('Insufficient base stock');
      }
      
      inventory.baseReserved += qty;
      source = { sku: inventory.baseSku, quantity: inventory.baseStock, reserved: inventory.baseReserved };
    }
    
    await inventory.save();
    
    // Log transaction
    await logInventoryTransaction({
      productId,
      catalogId: inventory.catalogId,
      sku: source.sku,
      variantKey: variantKey || '',
      transactionType: 'sale',
      quantityBefore: source.quantity,
      quantityChange: -qty,
      quantityAfter: source.quantity - qty,
      reason,
      orderId,
      performedBy: 'system'
    });
    
    return {
      success: true,
      reserved: qty,
      remaining: calculateAvailableQuantity(source.quantity, source.reserved)
    };
  } catch (error) {
    console.error('Error reserving stock:', error);
    throw error;
  }
}

/**
 * Complete stock deduction (convert reservation to sale)
 */
async function completeStockDeduction(productId, variantKey, quantity, orderId = '') {
  try {
    const inventory = await ProductInventory.findOne({ productId });
    if (!inventory) {
      throw new Error('Inventory not found');
    }
    
    const qty = Math.max(1, Number(quantity) || 1);
    
    if (variantKey) {
      const source = inventory.variantStocks.find(v => v.variantKey === variantKey);
      if (!source) {
        throw new Error(`Variant stock not found: ${variantKey}`);
      }
      
      source.reserved = Math.max(0, source.reserved - qty);
      source.quantity = Math.max(0, source.quantity - qty);
      source.status = getAvailabilityStatus(source.quantity, source.lowStockThreshold);
      source.lastSoldAt = new Date();
    } else {
      inventory.baseReserved = Math.max(0, inventory.baseReserved - qty);
      inventory.baseStock = Math.max(0, inventory.baseStock - qty);
    }
    
    inventory.overallStatus = getAvailabilityStatus(
      calculateAvailableQuantity(inventory.baseStock, inventory.baseReserved),
      inventory.baseLowStockThreshold
    );
    inventory.lastStockAdjustment = new Date();
    
    await inventory.save();
    
    return {
      success: true,
      deducted: qty
    };
  } catch (error) {
    console.error('Error completing stock deduction:', error);
    throw error;
  }
}

/**
 * Log inventory transaction for audit trail
 */
async function logInventoryTransaction(data) {
  try {
    const transaction = new InventoryTransaction({
      productId: data.productId,
      catalogId: data.catalogId,
      sku: data.sku,
      variantKey: data.variantKey || '',
      transactionType: data.transactionType,
      quantityBefore: data.quantityBefore,
      quantityChange: data.quantityChange,
      quantityAfter: data.quantityAfter,
      reason: data.reason,
      referenceId: data.referenceId || '',
      orderId: data.orderId || '',
      performedBy: data.performedBy,
      performedAt: data.performedAt || new Date(),
      notes: data.notes || ''
    });
    
    await transaction.save();
    return transaction;
  } catch (error) {
    console.warn('Error logging inventory transaction:', error);
    // Don't throw - logging failure shouldn't break operations
  }
}

/**
 * Get inventory history for a product
 */
async function getInventoryHistory(productId, limit = 50) {
  try {
    return await InventoryTransaction.find({ productId })
      .sort({ performedAt: -1 })
      .limit(limit);
  } catch (error) {
    console.error('Error fetching inventory history:', error);
    return [];
  }
}

/**
 * Check low stock status
 */
async function checkLowStockAlerts() {
  try {
    const lowStockItems = await ProductInventory.find({
      trackingEnabled: true,
      lowStockAlertEnabled: true,
      overallStatus: 'low_stock'
    }).limit(100);
    
    return lowStockItems;
  } catch (error) {
    console.error('Error checking low stock alerts:', error);
    return [];
  }
}

/**
 * Get inventory summary for storefront
 */
async function getStorefrontInventorySummary(productId) {
  try {
    const inventory = await getProductInventory(productId);
    if (!inventory) {
      return null;
    }
    
    return {
      status: inventory.overallStatus,
      available: inventory.totalAvailable,
      total: inventory.totalStock,
      hasVariants: inventory.hasVariants,
      variants: inventory.variantStocks.map(v => ({
        key: v.variantKey,
        label: v.variantLabel,
        status: v.status,
        available: calculateAvailableQuantity(v.quantity, v.reserved)
      }))
    };
  } catch (error) {
    console.error('Error getting storefront inventory summary:', error);
    return null;
  }
}

/**
 * Validate inventory before purchase
 */
async function validateInventoryForPurchase(productId, variantKey, quantity) {
  try {
    const inventory = await getProductInventory(productId);
    if (!inventory) {
      return { valid: false, error: 'Product inventory not found' };
    }
    
    if (!inventory.trackingEnabled) {
      return { valid: true }; // Tracking disabled, allow purchase
    }
    
    const qty = Number(quantity) || 1;
    
    if (variantKey) {
      const variant = inventory.variantStocks.find(v => v.variantKey === variantKey);
      if (!variant) {
        return { valid: false, error: 'Variant not found' };
      }
      
      const available = calculateAvailableQuantity(variant.quantity, variant.reserved);
      if (available < qty) {
        return { valid: false, error: `Only ${available} available`, available };
      }
    } else {
      const available = calculateAvailableQuantity(inventory.baseStock, inventory.baseReserved);
      if (available < qty) {
        return { valid: false, error: `Only ${available} available`, available };
      }
    }
    
    return { valid: true };
  } catch (error) {
    console.error('Error validating inventory:', error);
    return { valid: false, error: 'Validation failed' };
  }
}

module.exports = {
  syncProductInventory,
  getProductInventory,
  getInventoryByCatalogId,
  updateBaseStock,
  updateVariantStock,
  reserveStock,
  completeStockDeduction,
  logInventoryTransaction,
  getInventoryHistory,
  checkLowStockAlerts,
  getStorefrontInventorySummary,
  validateInventoryForPurchase
};
