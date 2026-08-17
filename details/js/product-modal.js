import {
  findMissingRequiredAttributes,
  getEffectiveAttributes,
  getSelectionStock,
  isColorSizeInventory
} from './product-attributes.js';
import { COLOR_ATTR_NAME, SIZE_ATTR_NAME, enrichProductColorVariants, resolveSmartColorSizeSelection } from '../../js/color-variant-inventory.js';
import { normalizeStorefrontAssetUrl } from '../../services/storefront-asset-url.js';
import { buildModalMarkup } from './product-ui-renderer.js';

function clampQuantity(value, max, min = 0) {
  const nextValue = Math.max(min, Number(value) || 0);
  if (!Number.isFinite(max)) {
    return nextValue;
  }

  return Math.min(nextValue, Math.max(min, Number(max) || 0));
}

function formatList(values) {
  if (!values.length) {
    return '';
  }

  if (values.length === 1) {
    return values[0];
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function chooseVisualAttribute(attributes) {
  return attributes.find(attribute => attribute.type === 'color')
    || attributes.find(attribute => attribute.axis === 'color')
    || attributes.find(attribute => attribute.type === 'image')
    || null;
}

function chooseQuantityAttribute(attributes, visualAttribute) {
  const candidates = attributes.filter(attribute => attribute !== visualAttribute);
  const textCandidates = candidates.filter(attribute => attribute.type === 'size' || attribute.axis === 'size' || attribute.type === 'text');
  const pool = textCandidates.length ? textCandidates : [];

  if (!pool.length) {
    return null;
  }

  const ranked = pool
    .map(attribute => {
      const label = String(attribute.name || '').toLowerCase();
      let score = 100;

      if (/\b(size|storage|capacity|memory|ram|screen size|band size|waist|shoe)\b/.test(label)) {
        score += 50;
      }

      if (/color|finish|material|bundle/.test(label)) {
        score -= 10;
      }

      score += Math.min(attribute.options.length, 10);

      return { attribute, score };
    })
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.attribute || null;
}

function createLayout(attributes, product, selectedAttributes = {}) {
  const effectiveAttributes = getEffectiveAttributes(product, attributes, selectedAttributes);
  const visualAttribute = chooseVisualAttribute(effectiveAttributes);

  if (isColorSizeInventory(product)) {
    const sizeAttribute = effectiveAttributes.find((attribute) => (
      attribute.name === SIZE_ATTR_NAME || attribute.type === 'size' || attribute.axis === 'size'
    )) || null;

    return {
      visualAttribute,
      quantityAttribute: null,
      supportingAttributes: sizeAttribute ? [sizeAttribute] : [],
      effectiveAttributes
    };
  }

  const quantityAttribute = chooseQuantityAttribute(effectiveAttributes, visualAttribute);
  const supportingAttributes = effectiveAttributes.filter(attribute => (
    attribute !== visualAttribute && attribute !== quantityAttribute
  ));

  return {
    visualAttribute,
    quantityAttribute,
    supportingAttributes,
    effectiveAttributes
  };
}

function getRequiredAttributes(layout, includeQuantityAttribute = true) {
  return [layout.visualAttribute, ...layout.supportingAttributes, includeQuantityAttribute ? layout.quantityAttribute : null]
    .filter(attribute => attribute && attribute.required !== false);
}

function createSelection(state, quantityAttribute, optionValue) {
  if (!quantityAttribute) {
    return { ...state.selectedAttributes };
  }

  return {
    ...state.selectedAttributes,
    [quantityAttribute.name]: optionValue
  };
}

function hasValidColorSizeSelection(product, attributes, selectedAttributes, quantity) {
  const colorId = selectedAttributes?.[COLOR_ATTR_NAME];
  const sizeValue = selectedAttributes?.[SIZE_ATTR_NAME];
  if (!colorId || !sizeValue) {
    return false;
  }

  const stock = getSelectionStock(product, attributes, selectedAttributes);
  const qty = Math.max(1, Number(quantity) || 1);
  return Number.isFinite(stock) && stock > 0 && qty >= 1 && qty <= stock;
}

export function createProductModal({ product, attributes, onSubmit, onSelectionChange, showToast }) {
  const modalRoot = document.getElementById('productConfigModal');
  const modalBody = document.getElementById('productConfigModalBody');
  const enrichedProduct = enrichProductColorVariants(product, normalizeStorefrontAssetUrl);
  let layout = createLayout(attributes, enrichedProduct, {});
  let pageScrollY = 0;
  const usesColorSizeInventory = isColorSizeInventory(enrichedProduct);

  if (!modalRoot || !modalBody) {
    return {
      open() {},
      close() {},
      isOpen() {
        return false;
      }
    };
  }

  const state = {
    action: 'add',
    selectedAttributes: {},
    quantityByOption: {},
    currentQuantity: 1,
    initialQuantity: 1,
    validationMessage: '',
    scrollTop: 0,
    committing: false,
    isOpen: false
  };

  function lockPageScroll() {
    pageScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.classList.add('details-config-open');
    document.body.style.top = `-${pageScrollY}px`;
    document.body.style.position = 'fixed';
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
  }

  function unlockPageScroll() {
    const nextScrollY = Math.abs(parseInt(document.body.style.top || '0', 10)) || pageScrollY;
    document.body.classList.remove('details-config-open');
    document.body.style.removeProperty('top');
    document.body.style.removeProperty('position');
    document.body.style.removeProperty('left');
    document.body.style.removeProperty('right');
    document.body.style.removeProperty('width');
    window.scrollTo({ top: nextScrollY, left: 0, behavior: 'auto' });
    pageScrollY = 0;
  }

  function readScrollPosition() {
    const scrollBody = modalBody.querySelector('.pcm-body');
    state.scrollTop = scrollBody ? scrollBody.scrollTop : 0;
  }

  function restoreScrollPosition() {
    const scrollBody = modalBody.querySelector('.pcm-body');
    if (scrollBody) {
      scrollBody.scrollTop = state.scrollTop;
    }
  }

  function getMissingRequired(includeQuantityAttribute = true) {
    const requiredAttributes = getRequiredAttributes(layout, includeQuantityAttribute);
    return findMissingRequiredAttributes(requiredAttributes, state.selectedAttributes);
  }

  function refreshLayout() {
    layout = createLayout(attributes, enrichedProduct, state.selectedAttributes);
  }

  function getQuantityRows() {
    refreshLayout();
    if (!layout.quantityAttribute) {
      return [];
    }

    return layout.quantityAttribute.options.map(option => {
      const selection = createSelection(state, layout.quantityAttribute, option.value);
      const maxQty = getSelectionStock(enrichedProduct, attributes, selection);
      const qty = clampQuantity(state.quantityByOption[option.value], maxQty);

      return {
        option,
        qty,
        maxQty,
        attributes: selection
      };
    });
  }

  function getVariants() {
    if (usesColorSizeInventory) {
      if (!hasValidColorSizeSelection(enrichedProduct, attributes, state.selectedAttributes, state.currentQuantity)) {
        return [];
      }

      return [{
        qty: clampQuantity(
          state.currentQuantity,
          getSelectionStock(enrichedProduct, attributes, state.selectedAttributes),
          1
        ),
        attributes: { ...state.selectedAttributes },
        maxQty: getSelectionStock(enrichedProduct, attributes, state.selectedAttributes)
      }];
    }

    if (layout.quantityAttribute) {
      return getQuantityRows()
        .filter(row => row.qty > 0)
        .map(row => ({
          qty: row.qty,
          attributes: row.attributes,
          maxQty: row.maxQty
        }));
    }

    return [{
      qty: clampQuantity(state.currentQuantity, getSelectionStock(enrichedProduct, attributes, state.selectedAttributes), 1),
      attributes: { ...state.selectedAttributes }
    }];
  }

  function syncCurrentQuantity(preferredQuantity = state.currentQuantity) {
    const maxQty = getSelectionStock(enrichedProduct, attributes, state.selectedAttributes);
    const minQty = usesColorSizeInventory && state.selectedAttributes?.[COLOR_ATTR_NAME] && state.selectedAttributes?.[SIZE_ATTR_NAME]
      ? 1
      : 0;
    state.currentQuantity = clampQuantity(preferredQuantity, maxQty, minQty || 1);
  }

  function syncOptionQuantity(optionValue, preferredQuantity) {
    const quantityAttribute = layout.quantityAttribute;
    if (!quantityAttribute) {
      return;
    }

    const selection = createSelection(state, quantityAttribute, optionValue);
    const maxQty = getSelectionStock(enrichedProduct, attributes, selection);
    state.quantityByOption = {
      ...state.quantityByOption,
      [optionValue]: clampQuantity(preferredQuantity, maxQty)
    };
  }

  function canSubmitSelection() {
    if (usesColorSizeInventory) {
      return hasValidColorSizeSelection(
        enrichedProduct,
        attributes,
        state.selectedAttributes,
        state.currentQuantity
      );
    }

    const missingRequired = getMissingRequired(!layout.quantityAttribute);
    const variants = getVariants().filter(variant => variant.qty > 0);
    return variants.length > 0 && missingRequired.length === 0;
  }

  function validate(action) {
    refreshLayout();

    if (usesColorSizeInventory) {
      const colorId = state.selectedAttributes?.[COLOR_ATTR_NAME];
      const sizeValue = state.selectedAttributes?.[SIZE_ATTR_NAME];

      if (!colorId) {
        const message = 'Please select a color to continue.';
        state.validationMessage = message;
        render();
        showToast?.(message);
        return false;
      }

      if (!sizeValue) {
        const message = 'Please select a size for your chosen color.';
        state.validationMessage = message;
        render();
        showToast?.(message);
        return false;
      }

      const stock = getSelectionStock(enrichedProduct, attributes, state.selectedAttributes);
      if (!Number.isFinite(stock) || stock <= 0) {
        const message = 'This color and size combination is currently out of stock.';
        state.validationMessage = message;
        render();
        showToast?.(message);
        return false;
      }

      if (state.currentQuantity > stock) {
        syncCurrentQuantity(stock);
        const message = `Quantity adjusted to ${stock} based on available stock.`;
        state.validationMessage = message;
        render();
        showToast?.(message);
        return state.currentQuantity > 0;
      }

      if (state.currentQuantity < 1) {
        const message = 'Choose a quantity of at least 1.';
        state.validationMessage = message;
        render();
        showToast?.(message);
        return false;
      }

      state.validationMessage = '';
      return true;
    }

    const missingRequired = getMissingRequired(!layout.quantityAttribute);
    if (missingRequired.length) {
      const message = `Please select ${formatList(missingRequired)}`;
      state.validationMessage = message;
      render();
      showToast?.(message);
      return false;
    }

    const variants = getVariants().filter(variant => variant.qty > 0);
    if (!variants.length) {
      const label = layout.quantityAttribute?.name || 'quantity';
      const message = `Add at least one ${label.toLowerCase()} quantity before ${action === 'buy' ? 'buying' : 'adding to cart'}`;
      state.validationMessage = message;
      render();
      showToast?.(message);
      return false;
    }

    return true;
  }

  function applySmartSelection() {
    if (!usesColorSizeInventory) {
      return;
    }

    state.selectedAttributes = resolveSmartColorSizeSelection(enrichedProduct, state.selectedAttributes);
    syncCurrentQuantity(state.currentQuantity);
    onSelectionChange?.({ ...state.selectedAttributes });
  }

  function close() {
    if (!state.isOpen && modalRoot.hidden) {
      return;
    }

    state.isOpen = false;
    modalRoot.hidden = true;
    modalRoot.classList.remove('is-open');
    unlockPageScroll();
    modalRoot.setAttribute('aria-hidden', 'true');
    state.scrollTop = 0;
  }

  function commit(action) {
    if (state.committing) {
      return;
    }

    if (!validate(action)) {
      return;
    }

    state.committing = true;
    const submitButton = modalBody.querySelector('[data-config-submit-action]');
    if (submitButton) {
      submitButton.classList.add('is-loading');
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
    }

    const variants = getVariants().filter(variant => variant.qty > 0);
    try {
      onSubmit?.(action, variants);
    } catch (error) {
      state.committing = false;
      if (submitButton) {
        submitButton.classList.remove('is-loading');
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
      }
      showToast?.(error?.message || 'Unable to complete this action.');
      return;
    }

    if (action === 'buy') {
      return;
    }

    close();
    window.setTimeout(() => {
      state.committing = false;
    }, 450);
  }

  function handleModalClick(event) {
    const closeTrigger = event.target.closest('[data-config-close]');
    if (closeTrigger) {
      close();
      return;
    }

    const optionButton = event.target.closest('[data-attribute-name][data-attribute-value]');
    if (optionButton) {
      if (optionButton.disabled || optionButton.getAttribute('aria-disabled') === 'true') {
        return;
      }
      readScrollPosition();
      const attributeName = optionButton.getAttribute('data-attribute-name');
      const attributeValue = optionButton.getAttribute('data-attribute-value');
      const nextSelection = {
        ...state.selectedAttributes,
        [attributeName]: attributeValue
      };

      if (
        usesColorSizeInventory
        && attributeName === COLOR_ATTR_NAME
        && state.selectedAttributes?.[COLOR_ATTR_NAME] !== attributeValue
      ) {
        delete nextSelection[SIZE_ATTR_NAME];
        state.quantityByOption = {};
        state.currentQuantity = 1;
      }

      if (
        usesColorSizeInventory
        && attributeName === SIZE_ATTR_NAME
        && state.selectedAttributes?.[SIZE_ATTR_NAME] !== attributeValue
      ) {
        state.currentQuantity = 1;
      }

      state.selectedAttributes = nextSelection;
      applySmartSelection();
      state.validationMessage = '';
      render();
      return;
    }

    const submitButton = event.target.closest('[data-config-submit-action]');
    if (submitButton) {
      commit(submitButton.getAttribute('data-config-submit-action'));
      return;
    }

    const qtyButton = event.target.closest('[data-config-base-qty]');
    if (qtyButton) {
      readScrollPosition();
      const direction = qtyButton.getAttribute('data-config-base-qty');
      const delta = direction === 'increase' ? 1 : -1;
      syncCurrentQuantity(state.currentQuantity + delta);
      render();
      return;
    }

    const rowQtyButton = event.target.closest('[data-config-row-qty]');
    if (rowQtyButton) {
      readScrollPosition();
      const optionValue = rowQtyButton.getAttribute('data-row-option');
      const direction = rowQtyButton.getAttribute('data-config-row-qty');
      const delta = direction === 'increase' ? 1 : -1;
      syncOptionQuantity(optionValue, Number(state.quantityByOption[optionValue] || 0) + delta);
      state.validationMessage = '';
      render();
    }
  }

  function handleModalInput(event) {
    const currentQtyInput = event.target.closest('[data-config-base-qty-input]');
    if (currentQtyInput) {
      readScrollPosition();
      syncCurrentQuantity(currentQtyInput.value);
      state.validationMessage = '';
      render();
      return;
    }

    const rowQtyInput = event.target.closest('[data-config-row-input]');
    if (rowQtyInput) {
      readScrollPosition();
      syncOptionQuantity(rowQtyInput.getAttribute('data-row-option'), rowQtyInput.value);
      state.validationMessage = '';
      render();
    }
  }

  function handleKeydown(event) {
    if (!modalRoot.classList.contains('is-open')) {
      return;
    }

    if (event.key === 'Escape') {
      close();
    }
  }

  function render() {
    refreshLayout();
    const effectiveAttributes = layout.effectiveAttributes || attributes;
    const missingRequired = getMissingRequired(false);
    const quantityRows = getQuantityRows();
    const variants = getVariants().filter(variant => variant.qty > 0);
    const totalItems = variants.reduce((sum, variant) => sum + Number(variant.qty || 0), 0);
    const total = variants.reduce((sum, variant) => sum + (Number(enrichedProduct?.price || 0) * Number(variant.qty || 0)), 0);
    const quantityBlocked = Boolean(layout.quantityAttribute && missingRequired.length);
    const blockerMessage = quantityBlocked
      ? `Select ${formatList(missingRequired)} to enable ${layout.quantityAttribute.name.toLowerCase()} quantities.`
      : '';
    const selectionStock = getSelectionStock(enrichedProduct, attributes, state.selectedAttributes);

    modalBody.innerHTML = buildModalMarkup({
      product: enrichedProduct,
      attributes: effectiveAttributes,
      layout,
      selectedAttributes: state.selectedAttributes,
      quantityRows,
      currentQuantity: state.currentQuantity,
      validationMessage: state.validationMessage,
      total,
      totalItems,
      quantityBlocked,
      blockerMessage,
      canSubmit: canSubmitSelection(),
      preferredAction: state.action,
      selectionStock
    });
    restoreScrollPosition();
  }

  function open({ action = 'add', initialQuantity = 1, selectedAttributes = null } = {}) {
    if (state.isOpen || modalRoot.classList.contains('is-open')) {
      return;
    }

    state.isOpen = true;
    state.action = action;
    state.initialQuantity = Math.max(1, Number(initialQuantity) || 1);
    state.currentQuantity = state.initialQuantity;
    state.selectedAttributes = selectedAttributes && typeof selectedAttributes === 'object'
      ? { ...selectedAttributes }
      : {};
    state.quantityByOption = {};
    state.validationMessage = '';
    state.scrollTop = 0;
    applySmartSelection();
    render();
    modalRoot.hidden = false;
    modalRoot.classList.add('is-open');
    lockPageScroll();
    modalRoot.setAttribute('aria-hidden', 'false');
    window.requestAnimationFrame(() => {
      const selectedColor = modalBody.querySelector('.pcm-color-grid [aria-checked="true"]');
      const selectedSize = modalBody.querySelector('.pcm-size-grid [aria-checked="true"]');
      const firstColor = modalBody.querySelector('.pcm-color-grid [role="radio"]:not([disabled])');
      const firstSize = modalBody.querySelector('.pcm-size-grid [role="radio"]:not([disabled])');
      const submit = modalBody.querySelector('[data-config-submit-action]:not([disabled])');
      const closeBtn = modalBody.querySelector('[data-config-close]');
      const target = (!selectedColor && firstColor)
        || (!selectedSize && firstSize)
        || submit
        || closeBtn;
      if (target && typeof target.focus === 'function') {
        target.focus({ preventScroll: true });
      }
    });
  }

  modalRoot.addEventListener('click', handleModalClick);
  modalRoot.addEventListener('input', handleModalInput);
  document.addEventListener('keydown', handleKeydown);

  return {
    open,
    close,
    isOpen() {
      return Boolean(state.isOpen) || modalRoot.classList.contains('is-open');
    }
  };
}
