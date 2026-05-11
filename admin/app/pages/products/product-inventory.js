/**
 * STEP 3N: Admin Product Inventory Module
 * Handles inventory assignment, SKU generation, and stock configuration in add-product
 */

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;
export const DEFAULT_BACKORDER_THRESHOLD = 0;

export function createDefaultInventoryState() {
  return {
    enabled: false,
    trackingEnabled: true,
    autoDeductOnOrder: true,
    baseSku: '',
    baseStock: 0,
    hasVariants: false,
    variantInventories: {},
    lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
    lowStockAlertEnabled: true,
    allowBackorder: false,
    backorderThreshold: DEFAULT_BACKORDER_THRESHOLD,
    incomingStock: 0,
    incomingDate: null
  };
}

export function normalizeInventoryState(source = {}) {
  const fallback = createDefaultInventoryState();
  
  return {
    enabled: Boolean(source?.enabled ?? fallback.enabled),
    trackingEnabled: Boolean(source?.trackingEnabled ?? fallback.trackingEnabled),
    autoDeductOnOrder: Boolean(source?.autoDeductOnOrder ?? fallback.autoDeductOnOrder),
    baseSku: String(source?.baseSku || fallback.baseSku).trim().toUpperCase(),
    baseStock: Math.max(0, Number(source?.baseStock) || 0),
    hasVariants: Boolean(source?.hasVariants ?? fallback.hasVariants),
    variantInventories: source?.variantInventories && typeof source.variantInventories === 'object' 
      ? source.variantInventories 
      : {},
    lowStockThreshold: Math.max(0, Number(source?.lowStockThreshold) || fallback.lowStockThreshold),
    lowStockAlertEnabled: Boolean(source?.lowStockAlertEnabled ?? fallback.lowStockAlertEnabled),
    allowBackorder: Boolean(source?.allowBackorder ?? fallback.allowBackorder),
    backorderThreshold: Math.max(0, Number(source?.backorderThreshold) || fallback.backorderThreshold),
    incomingStock: Math.max(0, Number(source?.incomingStock) || 0),
    incomingDate: source?.incomingDate ? new Date(source.incomingDate) : null
  };
}

export function generateSkuForProduct(catalogId, name = '') {
  const baseId = String(catalogId).padStart(5, '0');
  return `BM-${baseId}`;
}

export function generateSkuForVariant(baseSku = '', variantKey = '') {
  if (!variantKey) {
    return baseSku;
  }
  
  const normalized = String(variantKey || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .substring(0, 15);
  
  return `${baseSku}-${normalized}`;
}

export function validateInventoryInput(state) {
  const errors = [];
  
  if (state.enabled) {
    if (!state.baseSku || state.baseSku.trim() === '') {
      errors.push('Base SKU is required when inventory tracking is enabled');
    }
    
    if (state.baseStock < 0) {
      errors.push('Stock quantity cannot be negative');
    }
    
    if (state.lowStockThreshold < 0) {
      errors.push('Low stock threshold cannot be negative');
    }
    
    if (state.allowBackorder && state.backorderThreshold < 0) {
      errors.push('Backorder threshold cannot be negative');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

export function buildInventoryFieldMarkup(state = {}, options = {}) {
  const inv = normalizeInventoryState(state);
  const defaults = {
    catalogId: 1,
    containerClass: '',
    includeAdvanced: false
  };
  
  const opts = { ...defaults, ...options };
  const baseSku = inv.baseSku || generateSkuForProduct(opts.catalogId);
  
  let html = `
    <fieldset class="editor-fieldset inventory-section ${opts.containerClass}">
      <legend class="editor-legend">Inventory & Stock</legend>
      
      <div class="editor-toggle-row">
        <label class="editor-toggle-label">
          <input type="checkbox" data-field="inventory.enabled" ${inv.enabled ? 'checked' : ''} class="editor-toggle">
          <span>Enable Inventory Tracking</span>
        </label>
        <span class="hint">Track stock levels, low-stock alerts, and availability</span>
      </div>
      
      <div class="inventory-fields" ${!inv.enabled ? 'hidden' : ''}>
        <!-- SKU Section -->
        <div class="editor-field">
          <label class="field-label">
            Product SKU
            <span class="required">*</span>
          </label>
          <div class="sku-input-group">
            <input type="text" data-field="inventory.baseSku" value="${baseSku}" placeholder="BM-00001" class="field-input sku-input" readonly>
            <button type="button" class="sku-regenerate-btn" title="Regenerate SKU">
              <i class="fa-solid fa-sync-alt" aria-hidden="true"></i>
              <span>Regenerate</span>
            </button>
          </div>
          <span class="hint">Unique identifier for this product</span>
        </div>
        
        <!-- Base Stock -->
        <div class="editor-field">
          <label class="field-label">
            Available Stock
            <span class="required">*</span>
          </label>
          <input type="number" data-field="inventory.baseStock" value="${inv.baseStock}" min="0" class="field-input" placeholder="0">
          <span class="hint">Current quantity available for purchase</span>
        </div>
        
        <!-- Low Stock Settings -->
        <div class="editor-field">
          <label class="field-label">
            Low Stock Threshold
          </label>
          <div class="threshold-input-group">
            <input type="number" data-field="inventory.lowStockThreshold" value="${inv.lowStockThreshold}" min="0" max="100" class="field-input" placeholder="5">
            <span class="unit">units</span>
          </div>
          <span class="hint">Alert when stock drops below this amount</span>
        </div>
        
        <div class="editor-toggle-row">
          <label class="editor-toggle-label">
            <input type="checkbox" data-field="inventory.lowStockAlertEnabled" ${inv.lowStockAlertEnabled ? 'checked' : ''} class="editor-toggle">
            <span>Enable Low Stock Alerts</span>
          </label>
          <span class="hint">Get notified when stock is running low</span>
        </div>
        
        <!-- Tracking Options -->
        <div class="editor-toggle-row">
          <label class="editor-toggle-label">
            <input type="checkbox" data-field="inventory.trackingEnabled" ${inv.trackingEnabled ? 'checked' : ''} class="editor-toggle">
            <span>Track Inventory Changes</span>
          </label>
          <span class="hint">Maintain audit trail of all stock adjustments</span>
        </div>
        
        <div class="editor-toggle-row">
          <label class="editor-toggle-label">
            <input type="checkbox" data-field="inventory.autoDeductOnOrder" ${inv.autoDeductOnOrder ? 'checked' : ''} class="editor-toggle">
            <span>Auto-Deduct on Order</span>
          </label>
          <span class="hint">Automatically reduce stock when orders are placed</span>
        </div>
        
        ${opts.includeAdvanced ? `
        <!-- Advanced Options -->
        <div class="inventory-advanced-section">
          <h4 class="advanced-header">Advanced Inventory</h4>
          
          <div class="editor-toggle-row">
            <label class="editor-toggle-label">
              <input type="checkbox" data-field="inventory.allowBackorder" ${inv.allowBackorder ? 'checked' : ''} class="editor-toggle">
              <span>Allow Backorder</span>
            </label>
            <span class="hint">Allow customers to order when stock is zero</span>
          </div>
          
          <div class="editor-field" ${!inv.allowBackorder ? 'hidden' : ''}>
            <label class="field-label">Backorder Threshold</label>
            <div class="threshold-input-group">
              <input type="number" data-field="inventory.backorderThreshold" value="${inv.backorderThreshold}" min="0" class="field-input" placeholder="0">
              <span class="unit">units</span>
            </div>
            <span class="hint">Allow this many backorders</span>
          </div>
          
          <div class="editor-field">
            <label class="field-label">Incoming Stock</label>
            <input type="number" data-field="inventory.incomingStock" value="${inv.incomingStock}" min="0" class="field-input" placeholder="0">
            <span class="hint">Expected stock arriving soon</span>
          </div>
          
          <div class="editor-field">
            <label class="field-label">Expected Restock Date</label>
            <input type="date" data-field="inventory.incomingDate" value="${inv.incomingDate ? inv.incomingDate.toISOString().split('T')[0] : ''}" class="field-input">
            <span class="hint">When incoming stock will arrive</span>
          </div>
        </div>
        ` : ''}
        
        <!-- Inventory Summary -->
        <div class="inventory-summary-card">
          <h4 class="summary-title">Inventory Summary</h4>
          <div class="summary-grid">
            <div class="summary-item">
              <span class="summary-label">Available:</span>
              <span class="summary-value">${inv.baseStock}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Status:</span>
              <span class="summary-value status-badge" data-status="${inv.baseStock <= 0 ? 'out_of_stock' : inv.baseStock <= inv.lowStockThreshold ? 'low_stock' : 'in_stock'}">
                ${inv.baseStock <= 0 ? 'Out of Stock' : inv.baseStock <= inv.lowStockThreshold ? 'Low Stock' : 'In Stock'}
              </span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Threshold:</span>
              <span class="summary-value">${inv.lowStockThreshold}</span>
            </div>
            ${inv.incomingStock > 0 ? `
            <div class="summary-item">
              <span class="summary-label">Incoming:</span>
              <span class="summary-value">${inv.incomingStock}</span>
            </div>
            ` : ''}
          </div>
        </div>
      </div>
    </fieldset>
  `;
  
  return html;
}

export function buildVariantInventoryMarkup(variants = [], baseSku = '', options = {}) {
  if (!Array.isArray(variants) || variants.length === 0) {
    return '';
  }
  
  const items = variants.map(v => {
    const variantSku = generateSkuForVariant(baseSku, v.key);
    const stock = v.stock || 0;
    const status = stock <= 0 ? 'out_of_stock' : stock <= 3 ? 'low_stock' : 'in_stock';
    
    return `
      <div class="variant-inventory-item" data-variant-key="${v.key}">
        <div class="variant-info">
          <span class="variant-label">${v.label}</span>
          <span class="variant-sku">${variantSku}</span>
        </div>
        <div class="variant-stock-input">
          <input type="number" min="0" value="${stock}" class="variant-stock-input" data-variant="${v.key}" placeholder="0">
          <span class="stock-status" data-status="${status}">${stock} available</span>
        </div>
      </div>
    `;
  }).join('');
  
  return `
    <div class="variant-inventory-section">
      <h4>Variant Inventory</h4>
      <div class="variant-inventory-list">
        ${items}
      </div>
    </div>
  `;
}

export default {
  createDefaultInventoryState,
  normalizeInventoryState,
  generateSkuForProduct,
  generateSkuForVariant,
  validateInventoryInput,
  buildInventoryFieldMarkup,
  buildVariantInventoryMarkup
};
