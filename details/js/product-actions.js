import { buildVariantKey, normalizeProductAttributes } from './product-attributes.js';
import { createProductModal } from './product-modal.js';
import { renderProductOptionPreview } from './product-ui-renderer.js';

const DIRECT_CHECKOUT_KEY = 'byose_direct_checkout';
const CHECKOUT_DRAFT_KEY = 'byose_checkout_draft_v1';
const CHECKOUT_CONFIRMATION_KEY = 'byose_checkout_confirmation_v1';

function getLegacyAttribute(attributes, name) {
  const target = String(name || '').toLowerCase();

  return Object.entries(attributes || {}).find(([key]) => String(key).toLowerCase() === target)?.[1] || '';
}

function createCartPayload(product, quantity, attributes = {}) {
  const normalizedAttributes = Object.fromEntries(
    Object.entries(attributes || {}).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
  const image = product.image || product.mainImage || '';
  const attributeSummary = Object.values(normalizedAttributes).join(' • ');
  const variantKey = buildVariantKey(normalizedAttributes);

  return {
    id: String(product.id),
    productId: Number(product.id),
    name: product.name,
    price: Number(product.price || 0),
    image,
    img: image,
    qty: Math.max(1, Number(quantity) || 1),
    total: Number(product.price || 0) * Math.max(1, Number(quantity) || 1),
    attributes: normalizedAttributes,
    attributeSummary,
    variantKey,
    variantType: Object.keys(normalizedAttributes).length ? 'variant' : 'simple',
    variantSelection: {
      key: variantKey,
      type: Object.keys(normalizedAttributes).length ? 'variant' : 'simple',
      attributes: normalizedAttributes,
      attributeSummary,
      color: getLegacyAttribute(normalizedAttributes, 'color'),
      size: getLegacyAttribute(normalizedAttributes, 'size')
    },
    color: getLegacyAttribute(normalizedAttributes, 'color'),
    size: getLegacyAttribute(normalizedAttributes, 'size')
  };
}

function dispatchCartEvents() {
  window.dispatchEvent(new Event('kcart:updated'));
  window.dispatchEvent(new Event('cart:updated'));
}

function fallbackAddItemsToCart(items) {
  const count = Array.isArray(items) ? items.length : 0;
  window.dispatchEvent(new CustomEvent('byose:storefront-cart-error', {
    detail: {
      action: 'add',
      itemCount: count,
      message: 'Centralized cart service is unavailable. Please refresh and try again.'
    }
  }));
  throw new Error('Centralized cart service is unavailable.');
}

function addItemsToCart(items) {
  const payloads = items.filter(Boolean);
  if (!payloads.length) {
    return;
  }

  if (window.KCart && typeof window.KCart.add === 'function') {
    payloads.forEach(item => {
      window.KCart.add(item);
    });
    return;
  }

  fallbackAddItemsToCart(payloads);
}

function resolveAvailableQuantity(product, attributes = {}) {
  const baseAvailable = Number(product?.inventory?.available ?? product?.availableStock ?? product?.stock);
  if (Number.isFinite(baseAvailable) && baseAvailable >= 0) {
    return baseAvailable;
  }

  const variants = Array.isArray(product?.inventory?.variants) ? product.inventory.variants : [];
  if (variants.length) {
    const variantKey = buildVariantKey(attributes || {});
    const matched = variants.find((entry) => String(entry?.key || '').trim() === variantKey);
    const variantAvailable = Number(matched?.available);
    if (Number.isFinite(variantAvailable) && variantAvailable >= 0) {
      return variantAvailable;
    }
  }

  return Number.POSITIVE_INFINITY;
}

function validateRequestedQuantity(product, quantity, attributes = {}) {
  const requested = Math.max(1, Number(quantity) || 1);
  const available = resolveAvailableQuantity(product, attributes);

  if (!Number.isFinite(available)) {
    return {
      valid: true,
      acceptedQuantity: requested
    };
  }

  if (available <= 0) {
    return {
      valid: false,
      acceptedQuantity: 0,
      message: 'This item is currently out of stock.'
    };
  }

  if (requested > available) {
    return {
      valid: true,
      acceptedQuantity: available,
      message: `Quantity adjusted to ${available} based on current stock.`
    };
  }

  return {
    valid: true,
    acceptedQuantity: requested
  };
}

function startDirectCheckout(item) {
  if (!item) {
    return;
  }

  try {
    window.ByoseStorefrontSync?.writeStateByKey?.(DIRECT_CHECKOUT_KEY, item);
    window.ByoseStorefrontSync?.removeStateByKey?.(CHECKOUT_DRAFT_KEY);
    window.ByoseStorefrontSync?.removeStateByKey?.(CHECKOUT_CONFIRMATION_KEY);
    window.ByoseStorefrontSync?.syncPatch?.({
      directCheckout: item,
      checkoutDraft: null,
      checkoutConfirmation: null
    });
  } catch (error) {
    console.error('Unable to start direct checkout', error);
  }

  window.location.href = '../orders/shipping.html';
}

export function initProductActions(options) {
  const {
    product,
    quantityInput,
    decreaseButton,
    increaseButton,
    addToCartButton,
    buyNowButton,
    showToast,
    purchaseCaption,
    optionsPreviewRoot
  } = options;

  if (!product || !quantityInput) {
    return;
  }

  const attributes = normalizeProductAttributes(product);
  const modal = createProductModal({
    product,
    attributes,
    showToast,
    onSubmit(action, variants) {
      const items = variants
        .map((variant) => {
          const quantityCheck = validateRequestedQuantity(product, variant.qty, variant.attributes);
          if (!quantityCheck.valid || quantityCheck.acceptedQuantity <= 0) {
            showToast?.(quantityCheck.message || 'This selection is currently unavailable.');
            return null;
          }

          if (quantityCheck.message) {
            showToast?.(quantityCheck.message);
          }

          return createCartPayload(product, quantityCheck.acceptedQuantity, variant.attributes);
        })
        .filter(Boolean);

      if (!items.length) {
        return;
      }

      if (action === 'buy') {
        startDirectCheckout(items[0]);
        return;
      }

      addItemsToCart(items);
      showToast?.(
        action === 'buy'
          ? 'Selection added. Redirecting to checkout.'
          : `${product.name} added to cart`
      );
    }
  });

  renderProductOptionPreview(optionsPreviewRoot, attributes);

  if (purchaseCaption) {
    purchaseCaption.textContent = attributes.length
      ? 'Select options and set quantities inside the purchase popup.'
      : 'Adjust quantity before adding to cart.';
  }

  function readQuantity() {
    const quantity = Number(quantityInput.value || 1);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  }

  function syncQuantity(value) {
    quantityInput.value = String(Math.max(1, Number(value) || 1));
  }

  function handleSimpleAction(action) {
    const qty = readQuantity();

    if (attributes.length) {
      modal.open({ action, initialQuantity: qty });
      return;
    }

    const quantityCheck = validateRequestedQuantity(product, qty);
    if (!quantityCheck.valid || quantityCheck.acceptedQuantity <= 0) {
      showToast?.(quantityCheck.message || 'This product is currently unavailable.');
      return;
    }

    if (quantityCheck.message) {
      showToast?.(quantityCheck.message);
    }

    const payload = createCartPayload(product, quantityCheck.acceptedQuantity);
    if (action === 'buy') {
      showToast?.('Selection captured. Redirecting to shipping.');
      startDirectCheckout(payload);
      return;
    }

    addItemsToCart([payload]);
    showToast?.(
      action === 'buy'
        ? 'Selection added. Redirecting to checkout.'
        : `${product.name} added to cart`
    );
  }

  decreaseButton?.addEventListener('click', () => {
    syncQuantity(readQuantity() - 1);
  });

  increaseButton?.addEventListener('click', () => {
    syncQuantity(readQuantity() + 1);
  });

  quantityInput.addEventListener('change', () => {
    syncQuantity(readQuantity());
  });

  addToCartButton?.addEventListener('click', () => handleSimpleAction('add'));
  buyNowButton?.addEventListener('click', () => handleSimpleAction('buy'));
}