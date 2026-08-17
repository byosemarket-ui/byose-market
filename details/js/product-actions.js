import { buildVariantKey, getPrimarySelectionImage, getSelectionStock, normalizeProductAttributes } from './product-attributes.js';
import {
  COLOR_ATTR_NAME,
  SIZE_ATTR_NAME,
  describeColorSizeChoices,
  enrichProductColorVariants,
  hasPurchasableVariant,
  isColorSizeInventory,
  resolveMatrixStock,
  resolveSmartColorSizeSelection
} from '../../js/color-variant-inventory.js';
import {
  buildVariantCartPayload,
  resolvePurchaseSelection,
  resolveVariantUnitPrice,
  validateVariantSelection
} from '../../js/variant-cart-payload.js';
import { normalizeStorefrontAssetUrl } from '../../services/storefront-asset-url.js';
import { startBuyNowSession } from '../../orders/checkout-session.js';
import { createProductModal } from './product-modal.js';
import { renderProductOptionPreview } from './product-ui-renderer.js';
import { formatPrice } from './product-data-loader.js';

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

function setPurchaseButtonAvailability(button, enabled, outOfStockLabel) {
  if (!button) {
    return;
  }

  button.disabled = !enabled;
  button.classList.toggle('btn-disabled', !enabled);
  button.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  if (!enabled) {
    button.setAttribute('title', 'This product is currently out of stock.');
    const label = button.querySelector('span');
    if (label) {
      label.textContent = outOfStockLabel;
    } else {
      button.textContent = outOfStockLabel;
    }
  }
}

function applyPurchaseAvailability(product, buttons = []) {
  const purchasable = hasPurchasableVariant(product);
  buttons.forEach((button) => {
    setPurchaseButtonAvailability(button, purchasable, 'Out of Stock');
  });
  return purchasable;
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
    optionsPreviewRoot,
    gallery
  } = options;

  if (!product || !quantityInput) {
    return;
  }

  const attributes = normalizeProductAttributes(product);
  const enrichedProduct = enrichProductColorVariants(product, normalizeStorefrontAssetUrl);
  const usesColorSize = isColorSizeInventory(enrichedProduct);
  const purchasable = applyPurchaseAvailability(product, [
    addToCartButton,
    buyNowButton,
    document.getElementById('stickyAddToCartBtn'),
    document.getElementById('stickyBuyNowBtn')
  ]);

  let selectedAttributes = usesColorSize
    ? resolveSmartColorSizeSelection(enrichedProduct, {})
    : {};
  const catalogPrice = Number(product.price || 0);

  const modal = createProductModal({
    product,
    attributes,
    showToast,
    onSelectionChange(nextSelection) {
      applyCurrentSelection(nextSelection);
    },
    onSubmit(action, variants) {
      const items = variants
        .map((variant) => {
          const resolved = resolvePurchaseSelection(product, variant.attributes);
          if (resolved.colorSize && !resolved.resolved) {
            showToast?.(resolved.validation.message || 'This selection is currently unavailable.');
            return null;
          }

          const quantityCheck = validateRequestedQuantity(
            product,
            variant.qty,
            resolved.selection
          );
          if (!quantityCheck.valid || quantityCheck.acceptedQuantity <= 0) {
            showToast?.(quantityCheck.message || 'This selection is currently unavailable.');
            return null;
          }

          if (quantityCheck.message) {
            showToast?.(quantityCheck.message);
          }

          selectedAttributes = resolved.selection;
          return createCartPayload(product, quantityCheck.acceptedQuantity, resolved.selection);
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
        renderOptions();
        syncGalleryToSelection();
        updateStockHint();
        updatePurchaseCaption();
        syncDisplayedPrice();
      } catch (error) {
        showToast?.(error?.message || 'Unable to add item to cart.');
      }
    }
  });

  function readQuantity() {
    const quantity = Number(quantityInput.value || 1);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  }

  function getSelectionMax() {
    if (usesColorSize && selectedAttributes[COLOR_ATTR_NAME] && selectedAttributes[SIZE_ATTR_NAME]) {
      return getSelectionStock(enrichedProduct, attributes, selectedAttributes);
    }

    return resolveAvailableQuantity(product, selectedAttributes);
  }

  function syncQuantity(value) {
    const max = getSelectionMax();
    let next = Math.max(1, Number(value) || 1);
    if (Number.isFinite(max) && max >= 1) {
      next = Math.min(next, max);
    } else if (Number.isFinite(max) && max <= 0) {
      next = 1;
    }
    quantityInput.value = String(next);
  }

  function updateStockHint() {
    const hint = document.getElementById('purchaseStockHint');
    const stockEl = document.getElementById('productStock');
    const colorId = selectedAttributes[COLOR_ATTR_NAME];
    const sizeValue = selectedAttributes[SIZE_ATTR_NAME];
    let label = product.stockLabel || '';
    let isLow = false;
    let isOos = !purchasable;

    if (usesColorSize && colorId && sizeValue) {
      const stock = getSelectionStock(enrichedProduct, attributes, selectedAttributes);
      if (!Number.isFinite(stock) || stock <= 0) {
        label = 'Out of stock';
        isOos = true;
      } else if (stock <= 5) {
        label = `Only ${stock} items left!`;
        isLow = true;
        isOos = false;
      } else {
        label = `${stock} in stock`;
        isOos = false;
      }
    } else if (!purchasable) {
      label = 'Out of stock';
    }

    if (hint) {
      hint.textContent = label;
      hint.classList.toggle('is-low', isLow);
      hint.classList.toggle('is-oos', isOos);
      hint.hidden = !label;
    }

    if (stockEl) {
      stockEl.textContent = label || product.stockLabel || '';
      stockEl.classList.toggle('is-oos', isOos);
    }
  }

  function syncGalleryToSelection() {
    const image = getPrimarySelectionImage(enrichedProduct, attributes, selectedAttributes);
    gallery?.showImage?.(image);
  }

  function syncDisplayedPrice() {
    const priceEl = document.getElementById('productPrice');
    if (!priceEl) {
      return;
    }

    const unitPrice = usesColorSize
      ? resolveVariantUnitPrice(product, selectedAttributes)
      : catalogPrice;
    if (!Number.isFinite(Number(unitPrice))) {
      return;
    }

    priceEl.textContent = formatPrice(unitPrice);
  }

  function updatePurchaseCaption() {
    if (!purchaseCaption) {
      return;
    }

    if (!purchasable) {
      purchaseCaption.textContent = 'This product is currently out of stock.';
      return;
    }

    if (!usesColorSize) {
      purchaseCaption.textContent = attributes.length
        ? 'Choose your options before adding to cart.'
        : 'Adjust quantity before adding to cart.';
      return;
    }

    const choices = describeColorSizeChoices(enrichedProduct, selectedAttributes);
    if (choices.colorResolved && choices.sizeResolved) {
      purchaseCaption.textContent = 'Ready to add to cart or buy now.';
      return;
    }
    if (!choices.needsColorChoice && choices.needsSizeChoice) {
      purchaseCaption.textContent = 'Select a size to continue.';
      return;
    }
    if (choices.needsColorChoice && !choices.needsSizeChoice) {
      purchaseCaption.textContent = 'Select a color to continue.';
      return;
    }
    if (choices.colorResolved && !choices.sizeResolved) {
      purchaseCaption.textContent = 'Select a size for your chosen color.';
      return;
    }
    purchaseCaption.textContent = 'Select color and size to continue.';
  }

  function renderOptions() {
    renderProductOptionPreview(optionsPreviewRoot, attributes, product, selectedAttributes);
  }

  function applyCurrentSelection(nextSelection) {
    selectedAttributes = resolveSmartColorSizeSelection(enrichedProduct, nextSelection || {});
    renderOptions();
    syncGalleryToSelection();
    updateStockHint();
    syncQuantity(readQuantity());
    updatePurchaseCaption();
    syncDisplayedPrice();
  }

  const addButtons = [addToCartButton, document.getElementById('stickyAddToCartBtn')];
  const buyButtons = [buyNowButton, document.getElementById('stickyBuyNowBtn')];
  let actionUnlockTimer = 0;

  function setBusy(button, busy) {
    if (!button) {
      return;
    }

    button.dataset.busy = busy ? 'true' : 'false';
    button.classList.toggle('is-loading', busy);
    if (busy) {
      button.disabled = true;
      return;
    }

    button.disabled = !purchasable;
  }

  function actionButtons(action) {
    return action === 'buy' ? [...addButtons, ...buyButtons] : addButtons;
  }

  function isAnyPurchaseBusy() {
    return [...addButtons, ...buyButtons].some((button) => button?.dataset.busy === 'true');
  }

  function setActionBusy(action, busy) {
    actionButtons(action).forEach((button) => setBusy(button, busy));
  }

  function unlockActionSoon(action, delay = 450) {
    window.clearTimeout(actionUnlockTimer);
    actionUnlockTimer = window.setTimeout(() => {
      setActionBusy(action, false);
    }, delay);
  }

  function submitSelection(action, qty, selection) {
    const resolved = resolvePurchaseSelection(product, selection);
    if (resolved.colorSize && !resolved.resolved) {
      showToast?.(resolved.validation.message || 'Please complete a valid color and size selection.');
      return false;
    }

    selectedAttributes = resolved.selection;
    const quantityCheck = validateRequestedQuantity(product, qty, resolved.selection);
    if (!quantityCheck.valid || quantityCheck.acceptedQuantity <= 0) {
      showToast?.(quantityCheck.message || 'This selection is currently unavailable.');
      return false;
    }

    if (quantityCheck.message) {
      showToast?.(quantityCheck.message);
    }

    const payload = createCartPayload(product, quantityCheck.acceptedQuantity, resolved.selection);
    if (!payload?.productId && !payload?.id) {
      showToast?.('Unable to resolve this product variant. Please try another option.');
      return false;
    }

    if (resolved.colorSize && !payload?.variantId) {
      showToast?.('Unable to resolve this product variant. Please try another option.');
      return false;
    }

    if (action === 'buy') {
      showToast?.('Selection captured. Redirecting to shipping.');
      startDirectCheckout(payload);
      return true;
    }

    try {
      addItemsToCart([payload]);
      showToast?.(`${product.name} added to cart`);
      return true;
    } catch (error) {
      showToast?.(error?.message || 'Unable to add item to cart.');
      return false;
    }
  }

  function openSelectionModal(action, qty) {
    if (typeof modal.isOpen === 'function' && modal.isOpen()) {
      return;
    }

    modal.open({
      action,
      initialQuantity: qty,
      selectedAttributes
    });
  }

  function handleSimpleAction(action, sourceButton) {
    if (isAnyPurchaseBusy() || sourceButton?.dataset.busy === 'true') {
      return;
    }

    if (typeof modal.isOpen === 'function' && modal.isOpen()) {
      return;
    }

    if (document.getElementById('productDetailsPage')?.classList.contains('is-loading')) {
      showToast?.('Product details are still loading.');
      return;
    }

    if (!purchasable) {
      showToast?.('This product is currently out of stock.');
      return;
    }

    if (usesColorSize) {
      applyCurrentSelection(selectedAttributes);
    }

    const qty = readQuantity();

    if (usesColorSize && attributes.length) {
      const resolved = resolvePurchaseSelection(product, selectedAttributes);
      selectedAttributes = resolved.selection;

      if (resolved.resolved) {
        setActionBusy(action, true);
        try {
          submitSelection(action, qty, selectedAttributes);
        } finally {
          if (action !== 'buy') {
            unlockActionSoon(action);
          }
        }
        return;
      }

      openSelectionModal(action, qty);
      return;
    }

    if (attributes.length) {
      openSelectionModal(action, qty);
      return;
    }

    setActionBusy(action, true);
    try {
      submitSelection(action, qty, {});
    } finally {
      if (action !== 'buy') {
        unlockActionSoon(action);
      }
    }
  }

  applyCurrentSelection(selectedAttributes);

  decreaseButton?.addEventListener('click', () => {
    if (!purchasable) return;
    syncQuantity(readQuantity() - 1);
  });

  increaseButton?.addEventListener('click', () => {
    if (!purchasable) return;
    syncQuantity(readQuantity() + 1);
  });

  quantityInput.addEventListener('change', () => {
    syncQuantity(readQuantity());
  });
  quantityInput.addEventListener('input', () => {
    if (String(quantityInput.value || '').trim() === '') {
      return;
    }
    syncQuantity(readQuantity());
  });
  quantityInput.disabled = !purchasable;
  if (decreaseButton) decreaseButton.disabled = !purchasable;
  if (increaseButton) increaseButton.disabled = !purchasable;

  addToCartButton?.addEventListener('click', () => handleSimpleAction('add', addToCartButton));
  buyNowButton?.addEventListener('click', () => handleSimpleAction('buy', buyNowButton));

  optionsPreviewRoot?.addEventListener('click', (event) => {
    const optionButton = event.target.closest('[data-attribute-name][data-attribute-value]');
    if (optionButton && !optionButton.disabled) {
      const attributeName = optionButton.getAttribute('data-attribute-name');
      const attributeValue = optionButton.getAttribute('data-attribute-value');
      const nextSelection = {
        ...selectedAttributes,
        [attributeName]: attributeValue
      };

      if (attributeName === COLOR_ATTR_NAME && selectedAttributes[COLOR_ATTR_NAME] !== attributeValue) {
        delete nextSelection[SIZE_ATTR_NAME];
        quantityInput.value = '1';
      }

      applyCurrentSelection(nextSelection);
      return;
    }

    if (event.target.closest('[data-open-config-modal]')) {
      if (!purchasable) {
        showToast?.('This product is currently out of stock.');
        return;
      }
      openSelectionModal('add', readQuantity());
    }
  });
}