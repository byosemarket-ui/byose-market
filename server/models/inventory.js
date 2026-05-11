/**
 * STEP 3N: Inventory Foundation Schemas
 * Enterprise-grade stock tracking, SKU systems, and availability infrastructure
 * 
 * Supports:
 * - Base product inventory
 * - Variant-level inventory
 * - Low-stock thresholds
 * - Availability states
 * - SKU management
 * - Future warehouse integration
 */

const mongoose = require('mongoose');

// Stock tracking for individual variant or product
const StockEntrySchema = new mongoose.Schema({
  sku: { type: String, required: true, unique: true, index: true, trim: true },
  quantity: { type: Number, default: 0, min: 0 },
  reserved: { type: Number, default: 0, min: 0 },
  available: { type: Number, default: function() { return Math.max(0, this.quantity - this.reserved); } },
  lowStockThreshold: { type: Number, default: 5, min: 0 },
  status: { 
    type: String, 
    enum: ['in_stock', 'low_stock', 'out_of_stock', 'backorder', 'discontinued'],
    default: 'in_stock'
  },
  lastUpdated: { type: Date, default: Date.now },
  updatedBy: { type: String, default: 'system' }
}, { _id: false });

// Variant inventory mapping
const VariantStockSchema = new mongoose.Schema({
  variantKey: { type: String, required: true, index: true, trim: true },
  variantLabel: { type: String, default: '', trim: true },
  sku: { type: String, required: true, unique: true, index: true, trim: true },
  quantity: { type: Number, default: 0, min: 0 },
  reserved: { type: Number, default: 0, min: 0 },
  available: { type: Number, default: function() { return Math.max(0, this.quantity - this.reserved); } },
  lowStockThreshold: { type: Number, default: 3, min: 0 },
  status: { 
    type: String, 
    enum: ['in_stock', 'low_stock', 'out_of_stock', 'backorder', 'discontinued'],
    default: 'in_stock'
  },
  priceDelta: { type: Number, default: 0 },
  costPerUnit: { type: Number, default: 0, min: 0 },
  marginPercent: { type: Number, default: 0, min: 0, max: 100 },
  trackingEnabled: { type: Boolean, default: true },
  lastUpdated: { type: Date, default: Date.now },
  lastSoldAt: { type: Date, default: null }
}, { _id: false });

// Product-level inventory summary
const ProductInventorySchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Product', unique: true, index: true },
  catalogId: { type: Number, required: true, index: true },
  
  // Base product stock
  baseSku: { type: String, required: true, unique: true, index: true, trim: true },
  baseStock: { type: Number, default: 0, min: 0 },
  baseReserved: { type: Number, default: 0, min: 0 },
  baseAvailable: { type: Number, default: function() { return Math.max(0, this.baseStock - this.baseReserved); } },
  baseLowStockThreshold: { type: Number, default: 5, min: 0 },
  
  // Variant inventory (if product has variants)
  hasVariants: { type: Boolean, default: false },
  variantStocks: { type: [VariantStockSchema], default: [] },
  
  // Aggregated inventory state
  totalStock: { type: Number, default: 0, min: 0 },
  totalReserved: { type: Number, default: 0, min: 0 },
  totalAvailable: { type: Number, default: 0, min: 0 },
  
  // Inventory status (derived from available quantity)
  overallStatus: {
    type: String,
    enum: ['in_stock', 'low_stock', 'out_of_stock', 'backorder', 'discontinued'],
    default: 'in_stock'
  },
  
  // Inventory tracking configuration
  trackingEnabled: { type: Boolean, default: true },
  autoDeductOnOrder: { type: Boolean, default: true },
  allowBackorder: { type: Boolean, default: false },
  backorderThreshold: { type: Number, default: 0, min: 0 },
  
  // Low stock alerts
  lowStockAlertEnabled: { type: Boolean, default: true },
  lowStockAlertThreshold: { type: Number, default: 5, min: 0 },
  lastAlertSentAt: { type: Date, default: null },
  
  // Metadata
  incomingStock: { type: Number, default: 0, min: 0 },
  incomingDate: { type: Date, default: null },
  lastStockAdjustment: { type: Date, default: null },
  lastStockAdjustmentBy: { type: String, default: '' },
  
  timestamps: true
}, { timestamps: true });

// Inventory transaction log (for audit trail)
const InventoryTransactionSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Product', index: true },
  catalogId: { type: Number, required: true, index: true },
  sku: { type: String, required: true, index: true, trim: true },
  variantKey: { type: String, default: '', index: true },
  
  transactionType: {
    type: String,
    enum: ['initial', 'adjustment', 'sale', 'return', 'restock', 'damage', 'transfer', 'count'],
    required: true
  },
  
  quantityBefore: { type: Number, default: 0 },
  quantityChange: { type: Number, default: 0 },
  quantityAfter: { type: Number, default: 0 },
  
  reason: { type: String, default: '', trim: true },
  referenceId: { type: String, default: '', trim: true },
  orderId: { type: String, default: '', trim: true, index: true },
  
  performedBy: { type: String, default: 'system', trim: true },
  performedAt: { type: Date, default: Date.now, index: true },
  
  notes: { type: String, default: '', trim: true }
}, { timestamps: false, collection: 'InventoryTransactions' });

// Create indexes
ProductInventorySchema.index({ catalogId: 1, overallStatus: 1 });
ProductInventorySchema.index({ trackingEnabled: 1, lowStockAlertEnabled: 1 });
InventoryTransactionSchema.index({ productId: 1, transactionType: 1, performedAt: -1 });
InventoryTransactionSchema.index({ catalogId: 1, transactionType: 1, performedAt: -1 });

// Compile models
const ProductInventory = mongoose.model('ProductInventory', ProductInventorySchema, 'ProductInventory');
const InventoryTransaction = mongoose.model('InventoryTransaction', InventoryTransactionSchema);

module.exports = {
  ProductInventory,
  InventoryTransaction,
  StockEntrySchema,
  VariantStockSchema,
  ProductInventorySchema,
  InventoryTransactionSchema
};
