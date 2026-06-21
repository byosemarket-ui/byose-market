import {
  applyColorSizeSelection,
  buildAttributesFromColorVariants,
  extractColorVariantsFromProduct,
  isColorSizeInventory,
  resolveMatrixStock
} from '../../js/color-variant-inventory.js';
import { normalizeStorefrontAssetUrl } from '../../services/storefront-asset-url.js';

function resolveAssetPath(path) {
  const value = String(path || '').trim();
  const normalized = normalizeStorefrontAssetUrl(value);
  if (normalized) {
    return normalized;
  }

  if (!value || /^(?:[a-z]+:|\/|\.\.\/|\.\/)/i.test(value)) {
    return value;
  }

  return `../${value}`;
}

function splitVariantToken(value) {
  return String(value || '')
    .split('|')
    .map(entry => String(entry || '').trim())
    .filter(Boolean);
}

function normalizeOption(option, fallbackStock) {
  if (typeof option === 'string' || typeof option === 'number') {
    const [labelPart, valuePart, swatchPart, imagePart] = splitVariantToken(option);
    const label = labelPart || valuePart || String(option);
    const value = valuePart || labelPart || String(option);

    return {
      value,
      label,
      stock: Number.isFinite(Number(fallbackStock)) ? Math.max(0, Number(fallbackStock)) : Infinity,
      image: resolveAssetPath(imagePart || ''),
      swatch: String(swatchPart || '').trim(),
      sku: '',
      code: '',
      availability: 'future',
      isDefault: false,
      priceDelta: 0
    };
  }

  const value = String(option?.value ?? option?.label ?? '').trim();
  const stock = Number(option?.stock);

  return {
    value,
    label: String(option?.label ?? value),
    stock: Number.isFinite(stock)
      ? Math.max(0, stock)
      : Number.isFinite(Number(fallbackStock))
        ? Math.max(0, Number(fallbackStock))
        : Infinity,
    image: resolveAssetPath(option?.image || option?.thumbnail || ''),
    swatch: String(option?.swatch || option?.hex || option?.color || '').trim(),
    sku: String(option?.sku || '').trim(),
    code: String(option?.code || '').trim(),
    availability: String(option?.availability || option?.status || 'future').trim().toLowerCase(),
    isDefault: Boolean(option?.isDefault),
    priceDelta: Number(option?.priceDelta || 0)
  };
}

function inferAttributeType(attribute, options) {
  const explicitType = String(attribute?.type || attribute?.axis || '').trim().toLowerCase();
  if (['color', 'size', 'image', 'text'].includes(explicitType)) {
    return explicitType;
  }

  const attributeName = String(attribute?.name || '').toLowerCase();
  if (/color|swatch|shade|tone/.test(attributeName)) {
    return 'color';
  }
  if (/size|fit|waist|shoe|length|width/.test(attributeName)) {
    return 'size';
  }

  return options.some(option => option.image || option.swatch) ? 'color' : 'text';
}

function normalizeVariantFoundationAttributes(variants) {
  const groups = variants && typeof variants === 'object' && variants.groups ? variants.groups : {};

  return Object.entries(groups)
    .map(([key, group]) => {
      if (!group || !group.enabled) {
        return null;
      }

      const rawOptions = Array.isArray(group.optionTokens)
        ? group.optionTokens
        : Array.isArray(group.options)
          ? group.options
          : [];
      const options = rawOptions
        .map(option => normalizeOption(option, Number.POSITIVE_INFINITY))
        .filter(option => option.value);

      if (!group.label || !options.length) {
        return null;
      }

      return {
        name: String(group.label || key).trim(),
        key,
        axis: inferAttributeType(group, options),
        type: inferAttributeType(group, options),
        required: group.required !== false,
        options
      };
    })
    .filter(Boolean);
}

export function normalizeProductAttributes(product) {
  const fallbackStock = Number(product?.stock ?? product?.stockCount);

  if (isColorSizeInventory(product)) {
    const colorVariants = extractColorVariantsFromProduct(product);
    return buildAttributesFromColorVariants(colorVariants);
  }

  const rawAttributes = Array.isArray(product?.attributes) && product.attributes.length
    ? product.attributes
    : normalizeVariantFoundationAttributes(product?.variants);

  return rawAttributes
    .map(attribute => {
      const name = String(attribute?.name || '').trim();
      const rawOptions = Array.isArray(attribute?.options)
        ? attribute.options
        : Array.isArray(attribute?.values)
          ? attribute.values
          : [];
      const options = rawOptions
        .map(option => normalizeOption(option, fallbackStock))
        .filter(option => option.value);

      if (!name || !options.length) {
        return null;
      }

      return {
        name,
        key: String(attribute?.key || '').trim(),
        axis: inferAttributeType(attribute, options),
        type: inferAttributeType(attribute, options),
        required: attribute?.required !== false,
        options
      };
    })
    .filter(Boolean);
}

export function hasConfigurableAttributes(product) {
  return normalizeProductAttributes(product).length > 0;
}

export function getOptionByValue(attribute, value) {
  return attribute?.options?.find(option => String(option.value) === String(value)) || null;
}

export function findMissingRequiredAttributes(attributes, selectedAttributes) {
  return attributes
    .filter(attribute => attribute.required !== false)
    .filter(attribute => !selectedAttributes?.[attribute.name])
    .map(attribute => attribute.name);
}

export function isSelectionComplete(attributes, selectedAttributes) {
  return findMissingRequiredAttributes(attributes, selectedAttributes).length === 0;
}

export function buildAttributeSummary(attributes, selectedAttributes) {
  return attributes
    .map(attribute => selectedAttributes?.[attribute.name])
    .filter(Boolean)
    .join(' • ');
}

export function buildVariantKey(attributes) {
  return Object.entries(attributes || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join('|');
}

export function getSelectionStock(product, attributes, selectedAttributes) {
  const matrixStock = resolveMatrixStock(product, selectedAttributes);
  if (Number.isFinite(matrixStock)) {
    return matrixStock;
  }

  const productStock = Number(product?.stock ?? product?.stockCount);
  let maxStock = Number.isFinite(productStock) ? Math.max(0, productStock) : Infinity;

  attributes.forEach(attribute => {
    const selectedValue = selectedAttributes?.[attribute.name];
    if (!selectedValue) {
      return;
    }

    const option = getOptionByValue(attribute, selectedValue);
    const optionStock = Number(option?.stock);
    if (Number.isFinite(optionStock)) {
      maxStock = Math.min(maxStock, Math.max(0, optionStock));
    }
  });

  return Number.isFinite(maxStock) ? maxStock : 99;
}

export function createVariantSelection(product, attributes, selectedAttributes, quantity) {
  const normalizedAttributes = Object.fromEntries(
    attributes
      .map(attribute => [attribute.name, selectedAttributes?.[attribute.name]])
      .filter(([, value]) => Boolean(value))
  );
  const variantKey = buildVariantKey(normalizedAttributes);
  const qty = Math.max(0, Number(quantity) || 0);

  return {
    key: variantKey,
    attributes: normalizedAttributes,
    attributeSummary: buildAttributeSummary(attributes, normalizedAttributes),
    qty,
    price: Number(product?.price || 0),
    total: Number(product?.price || 0) * qty,
    maxQty: getSelectionStock(product, attributes, normalizedAttributes)
  };
}

export function getEffectiveAttributes(product, attributes, selectedAttributes) {
  if (!isColorSizeInventory(product)) {
    return attributes;
  }

  return applyColorSizeSelection(attributes, product, selectedAttributes);
}

export function getPrimarySelectionImage(product, attributes, selectedAttributes) {
  for (const attribute of attributes) {
    const selectedValue = selectedAttributes?.[attribute.name];
    if (!selectedValue) {
      continue;
    }

    const option = getOptionByValue(attribute, selectedValue);
    if (option?.image) {
      return option.image;
    }
  }

  return product?.mainImage || product?.image || '';
}

export { isColorSizeInventory, resolveMatrixStock };