/**
 * STEP 3N: Product Details Inventory Integration
 * Displays availability, stock levels, and low-stock warnings on product detail page
 */

import {
  buildAvailabilityBadge,
  buildStockDisplay,
  buildLowStockWarning,
  buildOutOfStockOverlay,
  buildInventoryInfoPanel,
  buildStockAwareQuantityStepper
} from './availability-renderer.js';

/**
 * Initialize inventory display on product detail page
 */
export function initProductInventoryDisplay(product, options = {}) {
  const defaults = {
    stockRoot: null,
    badgeRoot: null,
    warningRoot: null,
    quantityRoot: null,
    showDetails: true
  };
  
  const opts = { ...defaults, ...options };
  const inventory = product.inventory || {};
  
  // Render availability badge
  if (opts.badgeRoot) {
    renderAvailabilityBadge(opts.badgeRoot, inventory, opts);
  }
  
  // Render stock display
  if (opts.stockRoot) {
    renderStockDisplay(opts.stockRoot, inventory, opts);
  }
  
  // Render low-stock warning if needed
  if (opts.warningRoot && isLowStock(inventory)) {
    renderLowStockWarning(opts.warningRoot, inventory, opts);
  }
  
  // Setup quantity stepper with stock validation
  if (opts.quantityRoot) {
    renderQuantityStepper(opts.quantityRoot, inventory, opts);
  }
  
  // Render detailed inventory info if requested
  if (opts.showDetails) {
    renderInventoryDetails(product, options);
  }
}

/**
 * Render availability badge
 */
function renderAvailabilityBadge(root, inventory, options) {
  if (!root) return;
  
  const status = inventory.status || 'in_stock';
  const available = inventory.available || 0;
  const showQty = options.showQuantity !== false && available > 0;
  
  root.innerHTML = buildAvailabilityBadge(status, available, {
    showQuantity: showQty,
    showIcon: true,
    className: 'product-detail-badge'
  });
}

/**
 * Render stock display text
 */
function renderStockDisplay(root, inventory, options) {
  if (!root) return;
  
  const available = inventory.available || 0;
  root.innerHTML = buildStockDisplay(available, {
    lowThreshold: inventory.lowStockThreshold || 5,
    highThreshold: 50
  });
}

/**
 * Render low-stock warning
 */
function renderLowStockWarning(root, inventory, options) {
  if (!root) return;
  
  const available = inventory.available || 0;
  const threshold = inventory.lowStockThreshold || 5;
  
  if (available > 0 && available <= threshold) {
    root.innerHTML = buildLowStockWarning(available, threshold, {
      showIcon: true
    });
  }
}

/**
 * Render quantity stepper with max from inventory
 */
function renderQuantityStepper(root, inventory, options) {
  if (!root) return;
  
  const available = inventory.available || 1;
  const maxQty = Math.min(available, options.maxPerOrder || 10);
  
  root.innerHTML = buildStockAwareQuantityStepper(maxQty, {
    initialQty: 1,
    minQty: 1,
    containerClass: 'product-detail-stepper'
  });
  
  // Setup event listeners
  setupQuantityEvents(root, maxQty);
}

/**
 * Setup quantity stepper events
 */
function setupQuantityEvents(root, maxQty) {
  const decreaseBtn = root.querySelector('.qty-btn--decrease');
  const increaseBtn = root.querySelector('.qty-btn--increase');
  const input = root.querySelector('.qty-input');
  
  if (!input) return;
  
  const updateButtons = () => {
    const val = Number(input.value) || 1;
    if (decreaseBtn) {
      decreaseBtn.disabled = val <= 1;
    }
    if (increaseBtn) {
      increaseBtn.disabled = val >= maxQty;
    }
  };
  
  if (decreaseBtn) {
    decreaseBtn.addEventListener('click', () => {
      input.value = Math.max(1, Number(input.value) - 1);
      updateButtons();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  
  if (increaseBtn) {
    increaseBtn.addEventListener('click', () => {
      input.value = Math.min(maxQty, Number(input.value) + 1);
      updateButtons();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  
  input.addEventListener('change', () => {
    const val = Math.min(maxQty, Math.max(1, Number(input.value) || 1));
    input.value = val;
    updateButtons();
  });
  
  updateButtons();
}

/**
 * Render detailed inventory info panel
 */
function renderInventoryDetails(product, options) {
  const inventory = product.inventory || {};
  const detailsRoot = options.detailsRoot;
  
  if (!detailsRoot) return;
  
  detailsRoot.innerHTML = buildInventoryInfoPanel(
    {
      sku: inventory.sku || generateProductSku(product),
      status: inventory.status || 'in_stock',
      available: inventory.available || 0,
      total: inventory.total || 0,
      restockDate: inventory.restockDate || null
    },
    {
      showSku: true,
      showRestockDate: inventory.restockDate !== null,
      detailed: options.detailedInventoryInfo === true
    }
  );
}

/**
 * Disable purchase controls if out of stock
 */
export function disablePurchaseIfOutOfStock(product, options = {}) {
  const defaults = {
    addToCartBtn: null,
    buyNowBtn: null,
    quantityRoot: null
  };
  
  const opts = { ...defaults, ...options };
  const inventory = product.inventory || {};
  const isOutOfStock = !inventory.available || inventory.available <= 0;
  
  if (isOutOfStock) {
    if (opts.addToCartBtn) {
      opts.addToCartBtn.disabled = true;
      opts.addToCartBtn.classList.add('btn-disabled');
      opts.addToCartBtn.setAttribute('aria-disabled', 'true');
    }
    
    if (opts.buyNowBtn) {
      opts.buyNowBtn.disabled = true;
      opts.buyNowBtn.classList.add('btn-disabled');
      opts.buyNowBtn.setAttribute('aria-disabled', 'true');
    }
    
    if (opts.quantityRoot) {
      opts.quantityRoot.style.opacity = '0.6';
      opts.quantityRoot.style.pointerEvents = 'none';
    }
  }
}

/**
 * Validate purchase quantity against available stock
 */
export function validatePurchaseQuantity(requestedQty, availableQty) {
  const requested = Number(requestedQty) || 1;
  const available = Number(availableQty) || 0;
  
  if (available <= 0) {
    return {
      valid: false,
      error: 'This product is out of stock',
      maxAllowed: 0
    };
  }
  
  if (requested > available) {
    return {
      valid: false,
      error: `Only ${available} available`,
      maxAllowed: available
    };
  }
  
  return {
    valid: true,
    maxAllowed: available
  };
}

/**
 * Check if product is low stock
 */
export function isLowStock(inventory) {
  const available = inventory.available || 0;
  const threshold = inventory.lowStockThreshold || 5;
  return available > 0 && available <= threshold;
}

/**
 * Check if product is out of stock
 */
export function isOutOfStock(inventory) {
  return !inventory.available || inventory.available <= 0;
}

/**
 * Generate SKU display for product
 */
export function generateProductSku(product) {
  const inventory = product.inventory || {};
  if (inventory.sku) {
    return inventory.sku;
  }
  
  const catalogId = product.catalogId || product.id || 1;
  const padded = String(catalogId).padStart(5, '0');
  return `BM-${padded}`;
}

/**
 * Build variant inventory selector for product with variants
 */
export function buildVariantInventorySelector(variants = [], options = {}) {
  if (!Array.isArray(variants) || variants.length === 0) {
    return '';
  }
  
  const items = variants
    .filter(v => v.inventory)
    .map(v => {
      const available = v.inventory.available || 0;
      const status = available <= 0 ? 'out_of_stock' : available <= 3 ? 'low_stock' : 'in_stock';
      const statusClass = `variant-inventory-badge variant-inventory-badge--${status}`;
      
      return `
        <div class="variant-inventory-item" data-variant-key="${v.key}">
          <span class="variant-name">${v.label}</span>
          <span class="${statusClass}">
            ${available <= 0 ? 'Out of Stock' : available <= 3 ? `Only ${available} left` : `${available} Available`}
          </span>
        </div>
      `;
    })
    .join('');
  
  return `<div class="variant-inventory-selector">${items}</div>`;
}

/**
 * Update inventory display after async fetch
 */
export function updateInventoryDisplay(product, options = {}) {
  const defaults = {
    badgeElement: null,
    stockElement: null,
    warningElement: null,
    quantityElement: null
  };
  
  const opts = { ...defaults, ...options };
  
  if (opts.badgeElement) {
    renderAvailabilityBadge(opts.badgeElement, product.inventory || {}, opts);
  }
  
  if (opts.stockElement) {
    renderStockDisplay(opts.stockElement, product.inventory || {}, opts);
  }
  
  if (opts.warningElement && isLowStock(product.inventory || {})) {
    renderLowStockWarning(opts.warningElement, product.inventory || {}, opts);
  }
}

/**
 * Export all functions
 */
export default {
  initProductInventoryDisplay,
  disablePurchaseIfOutOfStock,
  validatePurchaseQuantity,
  isLowStock,
  isOutOfStock,
  generateProductSku,
  buildVariantInventorySelector,
  updateInventoryDisplay
};
