import {
  COLOR_ATTR_NAME,
  SIZE_ATTR_NAME,
  enrichProductColorVariants,
  extractColorVariantsFromProduct,
  getSizesForColor,
  getStockForColorSize,
  isColorSizeInventory
} from './color-variant-inventory.js';
import { normalizeStorefrontAssetUrl } from '../services/storefront-asset-url.js';

function buildVariantKey(attributes = {}) {
  return Object.entries(attributes)
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([key, value]) => `${key}:${value}`)
    .join('|');
}

export function resolveVariantDisplay(product, selectedAttributes = {}) {
  const enriched = enrichProductColorVariants(product, normalizeStorefrontAssetUrl);
  const colorId = String(selectedAttributes?.[COLOR_ATTR_NAME] || '').trim();
  const sizeValue = String(selectedAttributes?.[SIZE_ATTR_NAME] || '').trim();
  const colorVariants = extractColorVariantsFromProduct(enriched);
  const color = colorVariants.find((entry) => String(entry.id) === colorId);
  const sizeOptions = colorId ? getSizesForColor(enriched, colorId) : [];
  const sizeOption = sizeOptions.find((entry) => String(entry.value) === sizeValue);
  const availableStock = colorId && sizeValue
    ? getStockForColorSize(enriched, colorId, sizeValue)
    : null;

  return {
    colorId,
    colorName: color?.colorName || '',
    colorImage: normalizeStorefrontAssetUrl(color?.image || ''),
    sizeValue,
    sizeLabel: sizeOption?.label || sizeValue || '',
    availableStock: Number.isFinite(availableStock) ? Math.max(0, availableStock) : null
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

  return {
    valid: true,
    display: resolveVariantDisplay(enriched, selectedAttributes),
    stock
  };
}

export function buildVariantCartPayload(product, quantity, selectedAttributes = {}) {
  const enriched = enrichProductColorVariants(product, normalizeStorefrontAssetUrl);
  const attributes = Object.fromEntries(
    Object.entries(selectedAttributes || {}).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
  const display = resolveVariantDisplay(enriched, attributes);
  const variantKey = buildVariantKey(attributes);
  const qty = Math.max(1, Number(quantity) || 1);
  const price = Number(enriched.price || 0);
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
  const availableStock = Number.isFinite(display.availableStock)
    ? display.availableStock
    : Math.max(0, Math.floor(Number(enriched.stock || enriched.availableStock || 0)));
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
    variantKey,
    variantType: Object.keys(attributes).length ? 'variant' : 'simple',
    variantSelection: {
      key: variantKey,
      type: Object.keys(attributes).length ? 'variant' : 'simple',
      attributes,
      attributeSummary,
      color: display.colorName || '',
      colorId: display.colorId || '',
      colorImage: display.colorImage || '',
      size: display.sizeLabel || '',
      sizeValue: display.sizeValue || ''
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
