/**
 * STEP 3N: Availability Rendering System
 * Enterprise-grade inventory UI components for products
 * 
 * Provides:
 * - Availability badges
 * - Stock indicators
 * - Low-stock warnings
 * - Responsive inventory display
 */

/**
 * Build availability badge markup
 */
export function buildAvailabilityBadge(status = 'in_stock', quantity = 0, options = {}) {
  const defaults = {
    showQuantity: false,
    showIcon: true,
    compact: false,
    className: ''
  };
  
  const opts = { ...defaults, ...options };
  const icons = {
    'in_stock': '<i class="fa-solid fa-check-circle" aria-hidden="true"></i>',
    'low_stock': '<i class="fa-solid fa-exclamation-circle" aria-hidden="true"></i>',
    'out_of_stock': '<i class="fa-solid fa-times-circle" aria-hidden="true"></i>',
    'backorder': '<i class="fa-solid fa-hourglass-end" aria-hidden="true"></i>',
    'discontinued': '<i class="fa-solid fa-ban" aria-hidden="true"></i>'
  };
  
  const labels = {
    'in_stock': 'In Stock',
    'low_stock': 'Low Stock',
    'out_of_stock': 'Out of Stock',
    'backorder': 'Backorder',
    'discontinued': 'Discontinued'
  };
  
  const classes = {
    'in_stock': 'inventory-badge inventory-badge--in-stock',
    'low_stock': 'inventory-badge inventory-badge--low-stock',
    'out_of_stock': 'inventory-badge inventory-badge--out-of-stock',
    'backorder': 'inventory-badge inventory-badge--backorder',
    'discontinued': 'inventory-badge inventory-badge--discontinued'
  };
  
  const normalizedStatus = String(status || 'in_stock').toLowerCase();
  const label = labels[normalizedStatus] || 'Unknown';
  const icon = opts.showIcon ? (icons[normalizedStatus] || '') : '';
  const badgeClass = classes[normalizedStatus] || 'inventory-badge';
  const finalClass = opts.className ? `${badgeClass} ${opts.className}` : badgeClass;
  
  let display = label;
  if (opts.showQuantity && quantity > 0) {
    display = `${label} (${quantity} available)`;
  } else if (opts.showQuantity && status === 'low_stock' && quantity > 0) {
    display = `Only ${quantity} left`;
  }
  
  const compact = opts.compact ? ' inventory-badge--compact' : '';
  
  return `
    <span class="${finalClass}${compact}" role="status" aria-live="polite">
      ${icon ? icon + ' ' : ''}${display}
    </span>
  `;
}

/**
 * Build stock quantity display
 */
export function buildStockDisplay(quantity = 0, options = {}) {
  const defaults = {
    lowThreshold: 5,
    highThreshold: 50,
    detailed: false
  };
  
  const opts = { ...defaults, ...options };
  const qty = Number(quantity) || 0;
  const low = Number(opts.lowThreshold) || 5;
  const high = Number(opts.highThreshold) || 50;
  
  let text = '';
  let className = 'stock-display';
  
  if (qty <= 0) {
    text = 'Out of stock';
    className += ' stock-display--unavailable';
  } else if (qty <= 3) {
    text = `Only ${qty} left`;
    className += ' stock-display--urgent';
  } else if (qty <= low) {
    text = `Limited stock (${qty} available)`;
    className += ' stock-display--low';
  } else if (qty >= high) {
    text = 'Plenty in stock';
    className += ' stock-display--plenty';
  } else {
    text = `${qty} available`;
    className += ' stock-display--moderate';
  }
  
  if (opts.detailed) {
    return {
      text,
      className,
      quantity: qty,
      urgency: qty <= 3 ? 'urgent' : qty <= low ? 'low' : 'normal'
    };
  }
  
  return `<span class="${className}">${text}</span>`;
}

/**
 * Build low stock warning
 */
export function buildLowStockWarning(quantity = 0, threshold = 5, options = {}) {
  const qty = Number(quantity) || 0;
  const t = Number(threshold) || 5;
  
  if (qty <= 0 || qty > t) {
    return '';
  }
  
  const opts = options || {};
  const icon = opts.showIcon !== false ? '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>' : '';
  const className = opts.className || '';
  
  return `
    <div class="low-stock-warning ${className}" role="alert" aria-live="polite">
      ${icon ? icon + ' ' : ''}
      <strong>Low in stock:</strong> Only ${qty} available – order soon!
    </div>
  `;
}

/**
 * Build out-of-stock overlay
 */
export function buildOutOfStockOverlay(options = {}) {
  const opts = options || {};
  const message = opts.message || 'Out of Stock';
  const action = opts.action || 'Notify Me';
  const className = opts.className || '';
  
  return `
    <div class="out-of-stock-overlay ${className}" aria-label="${message}">
      <div class="out-of-stock-content">
        <i class="fa-solid fa-times-circle" aria-hidden="true"></i>
        <p>${message}</p>
        ${action ? `<button type="button" class="out-of-stock-action">${action}</button>` : ''}
      </div>
    </div>
  `;
}

/**
 * Build variant stock selector
 */
export function buildVariantStockSelector(variants = [], options = {}) {
  const defaults = {
    selectedKey: '',
    showQuantity: true,
    showStatus: true
  };
  
  const opts = { ...defaults, ...options };
  
  if (!Array.isArray(variants) || variants.length === 0) {
    return '';
  }
  
  const items = variants.map(v => {
    const statusClass = `variant-stock--${v.status || 'in_stock'}`;
    const selected = v.key === opts.selectedKey ? ' variant-stock--selected' : '';
    const qty = opts.showQuantity ? ` (${v.available || 0})` : '';
    const status = opts.showStatus ? ` - <span class="variant-status">${v.status || 'Available'}</span>` : '';
    
    return `
      <button type="button" class="variant-stock-item ${statusClass}${selected}" data-variant="${v.key}">
        <span>${v.label}${qty}</span>${status}
      </button>
    `;
  }).join('');
  
  return `<div class="variant-stock-selector">${items}</div>`;
}

/**
 * Build inventory info panel
 */
export function buildInventoryInfoPanel(inventory = {}, options = {}) {
  const defaults = {
    showSku: true,
    showRestockDate: false,
    detailed: false
  };
  
  const opts = { ...defaults, ...options };
  const inv = inventory || {};
  
  let html = '<div class="inventory-info-panel">';
  
  if (opts.showSku && inv.sku) {
    html += `<div class="inventory-info-row">
      <span class="label">SKU:</span>
      <span class="value">${inv.sku}</span>
    </div>`;
  }
  
  if (inv.status) {
    html += `<div class="inventory-info-row">
      <span class="label">Status:</span>
      <span class="value">${buildAvailabilityBadge(inv.status, inv.available)}</span>
    </div>`;
  }
  
  if (opts.showRestockDate && inv.restockDate) {
    html += `<div class="inventory-info-row">
      <span class="label">Expected Restock:</span>
      <span class="value">${new Date(inv.restockDate).toLocaleDateString()}</span>
    </div>`;
  }
  
  if (opts.detailed) {
    if (inv.total !== undefined) {
      html += `<div class="inventory-info-row">
        <span class="label">Total Available:</span>
        <span class="value">${inv.total}</span>
      </div>`;
    }
    
    if (inv.reserved !== undefined) {
      html += `<div class="inventory-info-row">
        <span class="label">Reserved:</span>
        <span class="value">${inv.reserved}</span>
      </div>`;
    }
  }
  
  html += '</div>';
  return html;
}

/**
 * Get CSS class for quantity indicator
 */
export function getQuantityClass(quantity, low = 5, high = 50) {
  const q = Number(quantity) || 0;
  
  if (q <= 0) return 'quantity-indicator--none';
  if (q <= 3) return 'quantity-indicator--critical';
  if (q <= low) return 'quantity-indicator--low';
  if (q >= high) return 'quantity-indicator--plenty';
  return 'quantity-indicator--moderate';
}

/**
 * Build quantity stepper with stock validation
 */
export function buildStockAwareQuantityStepper(maxQuantity = 10, options = {}) {
  const defaults = {
    initialQty: 1,
    step: 1,
    minQty: 1,
    containerClass: ''
  };
  
  const opts = { ...defaults, ...options };
  const max = Math.max(1, Number(maxQuantity) || 10);
  const initial = Math.min(opts.initialQty, max);
  
  return `
    <div class="quantity-stepper ${opts.containerClass}" data-max="${max}">
      <button type="button" class="qty-btn qty-btn--decrease" aria-label="Decrease quantity" ${initial <= opts.minQty ? 'disabled' : ''}>
        <i class="fa-solid fa-minus" aria-hidden="true"></i>
      </button>
      <input type="number" min="${opts.minQty}" max="${max}" value="${initial}" class="qty-input" aria-label="Quantity">
      <button type="button" class="qty-btn qty-btn--increase" aria-label="Increase quantity" ${initial >= max ? 'disabled' : ''}>
        <i class="fa-solid fa-plus" aria-hidden="true"></i>
      </button>
      <span class="qty-max-label">(Max: ${max})</span>
    </div>
  `;
}

/**
 * Export all rendering utilities
 */
export default {
  buildAvailabilityBadge,
  buildStockDisplay,
  buildLowStockWarning,
  buildOutOfStockOverlay,
  buildVariantStockSelector,
  buildInventoryInfoPanel,
  getQuantityClass,
  buildStockAwareQuantityStepper
};
