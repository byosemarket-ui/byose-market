import { buildVariantKey, normalizeProductAttributes } from './product-attributes.js';
import { enrichProductColorVariants, resolveMatrixStock } from '../../js/color-variant-inventory.js';
import { buildVariantCartPayload, validateVariantSelection } from '../../js/variant-cart-payload.js';
import { normalizeStorefrontAssetUrl } from '../../services/storefront-asset-url.js';
import { startBuyNowSession } from '../../orders/checkout-session.js';
import { createProductModal } from './product-modal.js';
import { renderProductOptionPreview } from './product-ui-renderer.js';

function createCartPayload(product, quantity, attributes = {}) {
  return buildVariantCartPayload(product, quantity, attributes);
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
    return { ok: true, added: 0 };
  }

  const cart = (window.ByoseCart && typeof window.ByoseCart.add === 'function')
    ? window.ByoseCart
    : (window.KCart && typeof window.KCart.add === 'function' ? window.KCart : null);

  if (!cart) {
    fallbackAddItemsToCart(payloads);
    return { ok: false, added: 0 };
  }

  let added = 0;
  for (const item of payloads) {
    try {
      cart.add(item);
      added += 1;
    } catch (error) {
      const message = String(error?.message || 'Unable to add item to cart.');
      window.dispatchEvent(new CustomEvent('byose:storefront-cart-error', {
        detail: { action: 'add', message, item }
      }));
      throw error;
    }
  }

  return { ok: true, added };
}

function resolveAvailableQuantity(product, attributes = {}) {
  const enrichedProduct = enrichProductColorVariants(product, normalizeStorefrontAssetUrl);
  const matrixStock = resolveMatrixStock(enrichedProduct, attributes);
  if (Number.isFinite(matrixStock)) {
    return matrixStock;
  }

  const baseAvailable = Number(enrichedProduct?.inventory?.available ?? enrichedProduct?.availableStock ?? enrichedProduct?.stock);
  if (Number.isFinite(baseAvailable) && baseAvailable >= 0) {
    return baseAvailable;
  }

  const variants = Array.isArray(enrichedProduct?.inventory?.variants) ? enrichedProduct.inventory.variants : [];
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
  const variantCheck = validateVariantSelection(product, attributes);
  if (!variantCheck.valid) {
    return {
      valid: false,
      acceptedQuantity: 0,
      message: variantCheck.message
    };
  }

  const requested = Math.max(1, Number(quantity) || 1);
  const available = Number.isFinite(variantCheck.stock)
    ? variantCheck.stock
    : resolveAvailableQuantity(product, attributes);

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

function startDirectCheckout(itemsInput) {
  const items = (Array.isArray(itemsInput) ? itemsInput : [itemsInput]).filter(Boolean);
  if (!items.length) {
    return;
  }

  try {
    startBuyNowSession(items);
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
        startDirectCheckout(items);
        return;
      }

      try {
        addItemsToCart(items);
        showToast?.(`${product.name} added to cart`);
      } catch (error) {
        showToast?.(error?.message || 'Unable to add item to cart.');
      }
    }
  });

  renderProductOptionPreview(optionsPreviewRoot, attributes, product);

  if (purchaseCaption) {
    purchaseCaption.textContent = attributes.length
      ? 'Choose your color and size in the purchase modal. Stock updates automatically.'
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

    try {
      addItemsToCart([payload]);
      showToast?.(`${product.name} added to cart`);
    } catch (error) {
      showToast?.(error?.message || 'Unable to add item to cart.');
    }
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

  optionsPreviewRoot?.querySelector('[data-open-config-modal]')?.addEventListener('click', () => {
    modal.open({ action: 'add', initialQuantity: readQuantity() });
  });
}