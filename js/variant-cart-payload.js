import {
  COLOR_ATTR_NAME,
  SIZE_ATTR_NAME,
  enrichProductColorVariants,
  extractColorVariantsFromProduct,
  getColorVariantMatrix,
  getSizesForColor,
  getStockForColorSize,
  isColorSizeInventory,
  resolveSmartColorSizeSelection,
  slugify
} from './color-variant-inventory.js';
import { normalizeStorefrontAssetUrl } from '../services/storefront-asset-url.js';

function buildVariantKey(attributes = {}) {
  return Object.entries(attributes)
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([key, value]) => `${key}:${value}`)
    .join('|');
}

function readActualNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function findSizeRow(color, sizeValue) {
  const sizeKey = String(sizeValue || '').trim();
  if (!color || !sizeKey) {
    return null;
  }

  return (Array.isArray(color.sizes) ? color.sizes : []).find((row) => {
    const value = String(row?.value || '').trim() || slugify(row?.size);
    return value === sizeKey || String(row?.size || '').trim() === sizeKey;
  }) || null;
}

export function resolveMatchedVariant(product, selectedAttributes = {}) {
  const enriched = enrichProductColorVariants(product, normalizeStorefrontAssetUrl);
  const colorId = String(selectedAttributes?.[COLOR_ATTR_NAME] || '').trim();
  const sizeValue = String(selectedAttributes?.[SIZE_ATTR_NAME] || '').trim();
  if (!colorId || !sizeValue) {
    return null;
  }

  const matrix = getColorVariantMatrix(enriched);
  return matrix.find((entry) => (
    String(entry.colorId) === colorId
    && (String(entry.sizeValue) === sizeValue || String(entry.size) === sizeValue)
  )) || null;
}

export function resolveVariantUnitPrice(product, selectedAttributes = {}) {
  const enriched = enrichProductColorVariants(product, normalizeStorefrontAssetUrl);
  const basePrice = Math.max(0, Number(enriched.price || 0));
  const colorId = String(selectedAttributes?.[COLOR_ATTR_NAME] || '').trim();
  const sizeValue = String(selectedAttributes?.[SIZE_ATTR_NAME] || '').trim();
  if (!colorId || !sizeValue) {
    return basePrice;
  }

  const color = extractColorVariantsFromProduct(enriched).find((entry) => String(entry.id) === colorId);
  const sizeRow = findSizeRow(color, sizeValue);
  const variantPrice = readActualNumber(
    sizeRow?.price,
    sizeRow?.salePrice,
    color?.price,
    color?.salePrice
  );
  if (variantPrice != null && variantPrice >= 0) {
    return variantPrice;
  }

  const delta = readActualNumber(sizeRow?.priceDelta, color?.priceDelta) || 0;
  return Math.max(0, basePrice + delta);
}

export function resolveVariantDisplay(product, selectedAttributes = {}) {
  const enriched = enrichProductColorVariants(product, normalizeStorefrontAssetUrl);
  const colorId = String(selectedAttributes?.[COLOR_ATTR_NAME] || '').trim();
  const sizeValue = String(selectedAttributes?.[SIZE_ATTR_NAME] || '').trim();
  const colorVariants = extractColorVariantsFromProduct(enriched);
  const color = colorVariants.find((entry) => String(entry.id) === colorId);
  const sizeOptions = colorId ? getSizesForColor(enriched, colorId) : [];
  const sizeOption = sizeOptions.find((entry) => String(entry.value) === sizeValue);
  const matched = resolveMatchedVariant(enriched, selectedAttributes);
  const availableStock = colorId && sizeValue
    ? getStockForColorSize(enriched, colorId, sizeValue)
    : null;
  const unitPrice = resolveVariantUnitPrice(enriched, selectedAttributes);
  const variantId = matched?.id || (colorId && sizeValue ? `${colorId}-${sizeValue}` : '');

  return {
    colorId,
    colorName: color?.colorName || '',
    colorImage: normalizeStorefrontAssetUrl(color?.image || matched?.image || ''),
    sizeValue,
    sizeLabel: sizeOption?.label || sizeValue || '',
    availableStock: Number.isFinite(availableStock) ? Math.max(0, availableStock) : null,
    unitPrice,
    variantId,
    variantKey: matched?.key || '',
    matchedVariant: matched
  };
}

export function buildVariantAttributeSummary(display = {}) {
  const parts = [];
  if (display.colorName) {
    parts.push(display.colorName);
  }
  if (display.sizeLabel) {
    parts.push(`Size ${display.sizeLabel}`);
  }
  return parts.join(' · ');
}

export function formatVariantLineMeta(item = {}) {
  const summary = buildVariantAttributeSummary({
    colorName: item.colorName || item.color || item.variantSelection?.color || '',
    sizeLabel: item.sizeLabel || item.size || item.variantSelection?.size || ''
  });

  if (summary) {
    return summary;
  }

  return String(item.attributeSummary || '').trim();
}

export function validateVariantSelection(product, selectedAttributes = {}) {
  const enriched = enrichProductColorVariants(product, normalizeStorefrontAssetUrl);

  if (!isColorSizeInventory(enriched)) {
    return { valid: true, display: resolveVariantDisplay(enriched, selectedAttributes) };
  }

  const colorId = String(selectedAttributes?.[COLOR_ATTR_NAME] || '').trim();
  const sizeValue = String(selectedAttributes?.[SIZE_ATTR_NAME] || '').trim();

  if (!colorId) {
    return { valid: false, message: 'Please select a color to continue.' };
  }

  if (!sizeValue) {
    return { valid: false, message: 'Please select a size for your chosen color.' };
  }

  const colorVariants = extractColorVariantsFromProduct(enriched);
  const color = colorVariants.find((entry) => String(entry.id) === colorId);
  if (!color) {
    return { valid: false, message: 'Selected color is no longer available.' };
  }

  const sizeOptions = getSizesForColor(enriched, colorId);
  const sizeOption = sizeOptions.find((entry) => String(entry.value) === sizeValue);
  if (!sizeOption) {
    return { valid: false, message: 'Selected size is not available for this color.' };
  }

  const stock = getStockForColorSize(enriched, colorId, sizeValue);
  if (!Number.isFinite(stock) || stock <= 0) {
    return { valid: false, message: 'This color and size combination is currently out of stock.' };
  }

  const display = resolveVariantDisplay(enriched, selectedAttributes);
  if (!display.variantId) {
    return { valid: false, message: 'This product variant could not be resolved. Please choose another option.' };
  }

  return {
    valid: true,
    display,
    stock,
    variant: display.matchedVariant || null
  };
}

/**
 * Shared purchase-resolution path for Add to Cart and Buy Now.
 * Applies smart auto-selection, then validates the exact purchasable variant.
 */
export function resolvePurchaseSelection(product, selectedAttributes = {}) {
  const enriched = enrichProductColorVariants(product, normalizeStorefrontAssetUrl);
  if (!isColorSizeInventory(enriched)) {
    return {
      product: enriched,
      selection: { ...(selectedAttributes || {}) },
      validation: { valid: true, display: resolveVariantDisplay(enriched, selectedAttributes) },
      resolved: true,
      colorSize: false
    };
  }

  const selection = resolveSmartColorSizeSelection(enriched, selectedAttributes);
  const validation = validateVariantSelection(enriched, selection);
  return {
    product: enriched,
    selection,
    validation,
    resolved: Boolean(validation.valid),
    colorSize: true
  };
}

export function buildVariantCartPayload(product, quantity, selectedAttributes = {}) {
  const enriched = enrichProductColorVariants(product, normalizeStorefrontAssetUrl);
  const attributes = Object.fromEntries(
    Object.entries(selectedAttributes || {}).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
  const display = resolveVariantDisplay(enriched, attributes);
  const variantKey = display.variantKey || buildVariantKey(attributes);
  const variantId = display.variantId || variantKey;
  const availableStock = Number.isFinite(display.availableStock)
    ? display.availableStock
    : Math.max(0, Math.floor(Number(enriched.stock || enriched.availableStock || 0)));
  let qty = Math.max(1, Number(quantity) || 1);
  if (Number.isFinite(availableStock) && availableStock > 0) {
    qty = Math.min(qty, availableStock);
  }
  const price = Number.isFinite(Number(display.unitPrice))
    ? Number(display.unitPrice)
    : Number(enriched.price || 0);
  const comparePrice = Number(enriched.oldPrice || enriched.compareAtPrice || enriched.originalPrice || 0);
  const resolvedComparePrice = comparePrice > price ? comparePrice : 0;
  const discountPercent = resolvedComparePrice > 0
    ? Math.round(((resolvedComparePrice - price) / resolvedComparePrice) * 100)
    : Math.max(0, Math.floor(Number(enriched.discountPercent || 0)));
  const productImage = normalizeStorefrontAssetUrl(enriched.mainImage || enriched.image || '');
  const lineImage = display.colorImage || productImage;
  const attributeSummary = buildVariantAttributeSummary(display)
    || Object.values(attributes).filter(Boolean).join(' · ')
    || '';
  const baseSku = String(enriched.sku || enriched.metadata?.sku || '').trim();
  const variantSku = baseSku && display.colorId && display.sizeValue
    ? `${baseSku}-${display.colorId}-${display.sizeValue}`
    : baseSku;

  return {
    id: String(enriched.id || enriched.catalogId || ''),
    productId: Number(enriched.id || enriched.catalogId || 0),
    slug: String(enriched.slug || enriched.metadata?.slug || '').trim(),
    name: enriched.name || enriched.title || 'Product',
    price,
    comparePrice: resolvedComparePrice,
    oldPrice: resolvedComparePrice,
    discountPrice: price,
    discountPercent,
    discountAmount: resolvedComparePrice > price ? (resolvedComparePrice - price) * qty : 0,
    image: lineImage,
    img: lineImage,
    colorImage: display.colorImage,
    productImage,
    qty,
    quantity: qty,
    total: price * qty,
    attributes,
    attributeSummary,
    color: display.colorName || display.colorId || '',
    colorName: display.colorName || '',
    colorId: display.colorId || '',
    size: display.sizeLabel || display.sizeValue || '',
    sizeLabel: display.sizeLabel || '',
    sizeValue: display.sizeValue || '',
    sku: baseSku,
    variantSku,
    variantId,
    variantKey,
    variantType: Object.keys(attributes).length ? 'variant' : 'simple',
    variantSelection: {
      id: variantId,
      key: variantKey,
      type: Object.keys(attributes).length ? 'variant' : 'simple',
      attributes,
      attributeSummary,
      color: display.colorName || '',
      colorId: display.colorId || '',
      colorImage: display.colorImage || '',
      size: display.sizeLabel || '',
      sizeValue: display.sizeValue || '',
      stock: availableStock,
      price
    },
    availableStock,
    stock: availableStock,
    inventorySnapshot: {
      sku: variantSku || baseSku,
      available: availableStock,
      status: availableStock <= 0
        ? 'out_of_stock'
        : availableStock <= 5
          ? 'low_stock'
          : 'in_stock',
      lowStockThreshold: 5
    },
    availability: availableStock > 0 ? 'in_stock' : 'out_of_stock',
    category: String(enriched.category || '').trim()
  };
}

export { buildVariantKey };
