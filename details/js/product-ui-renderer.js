import { buildAttributeSummary, getPrimarySelectionImage, isSelectionComplete } from './product-attributes.js';
import {
  COLOR_ATTR_NAME,
  SIZE_ATTR_NAME,
  describeColorSizeChoices,
  enrichProductColorVariants,
  extractColorVariantsFromProduct,
  getColorVariantMatrix,
  getSizesForColor,
  hasPurchasableVariant,
  isColorSizeInventory
} from '../../js/color-variant-inventory.js';
import { resolveVariantUnitPrice } from '../../js/variant-cart-payload.js';
import { normalizeStorefrontAssetUrl, toProductCardImageUrl } from '../../services/storefront-asset-url.js';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPrice(value) {
  return `RWF ${Number(value || 0).toLocaleString('en-US')}`;
}

function formatSelectionStockLabel(stock, complete) {
  if (!complete) {
    return 'Select options to see stock';
  }

  const value = Number(stock);
  if (!Number.isFinite(value) || value <= 0) {
    return 'Out of stock';
  }
  if (value === 1) {
    return 'Only 1 item left';
  }
  if (value <= 5) {
    return `Only ${value} items left`;
  }
  if (value <= 20) {
    return `${value} items left`;
  }
  return 'In stock';
}

function resolveDiscountMeta(product, unitPrice) {
  const price = Number(unitPrice || 0);
  const oldPrice = Number(product?.oldPrice || product?.compareAtPrice || product?.originalPrice || 0);
  const hasDiscount = oldPrice > price && price > 0;
  const storedPercent = Number(product?.discountPercent || product?.discount || 0);
  const discountPercent = hasDiscount
    ? (storedPercent > 0 ? Math.round(storedPercent) : Math.round(((oldPrice - price) / oldPrice) * 100))
    : 0;

  return { oldPrice: hasDiscount ? oldPrice : 0, hasDiscount, discountPercent };
}

function resolveModalImage(url, fallback = '') {
  const normalized = normalizeStorefrontAssetUrl(url);
  return normalized || normalizeStorefrontAssetUrl(fallback) || fallback;
}

function getColorLabel(product, colorId, attributes, selectedAttributes) {
  const colorAttr = attributes.find((entry) => entry.name === COLOR_ATTR_NAME);
  const option = colorAttr?.options?.find((entry) => String(entry.value) === String(colorId));
  if (option?.label) {
    return option.label;
  }

  const variant = extractColorVariantsFromProduct(product).find((entry) => entry.id === colorId);
  return variant?.colorName || colorId || '';
}

function getSizeLabel(sizeValue, sizeOptions = [], product = null) {
  const match = sizeOptions.find((entry) => String(entry.value) === String(sizeValue));
  if (match?.label) {
    return match.label;
  }

  if (product && sizeValue) {
    const matrixMatch = getColorVariantMatrix(product).find((entry) => (
      String(entry.sizeValue) === String(sizeValue) || String(entry.size) === String(sizeValue)
    ));
    if (matrixMatch?.size) {
      return matrixMatch.size;
    }
  }

  return sizeValue || '';
}

function buildInlineColorSizeMarkup(product, attributes, selectedAttributes = {}) {
  const enrichedProduct = enrichProductColorVariants(product, normalizeStorefrontAssetUrl);
  const colorVariants = extractColorVariantsFromProduct(enrichedProduct);
  let selectedColorId = selectedAttributes?.[COLOR_ATTR_NAME] || '';
  if (!selectedColorId && colorVariants.length === 1) {
    selectedColorId = String(colorVariants[0].id || '');
  }
  let selectedSizeValue = selectedAttributes?.[SIZE_ATTR_NAME] || '';
  const selectedColorLabel = getColorLabel(enrichedProduct, selectedColorId, attributes, selectedAttributes);
  const sizeOptions = selectedColorId ? getSizesForColor(enrichedProduct, selectedColorId) : [];
  if (!selectedSizeValue && sizeOptions.length === 1) {
    selectedSizeValue = String(sizeOptions[0].value || '');
  }
  const selectedSizeLabel = getSizeLabel(selectedSizeValue, sizeOptions, enrichedProduct);
  const fallbackImage = enrichedProduct?.mainImage || enrichedProduct?.image || '../img/logo.png';

  const colorTiles = colorVariants.map((color) => {
    const isActive = String(selectedColorId) === String(color.id);
    const isDisabled = Number(color.totalStock) <= 0;
    const originalImage = resolveModalImage(color.image, fallbackImage);
    const previewImage = toProductCardImageUrl(originalImage) || originalImage;

    return `
      <button
        type="button"
        class="pd-color-swatch${isActive ? ' is-active' : ''}${isDisabled ? ' is-disabled' : ''}"
        data-attribute-name="${escapeHtml(COLOR_ATTR_NAME)}"
        data-attribute-value="${escapeHtml(color.id)}"
        aria-pressed="${isActive ? 'true' : 'false'}"
        aria-label="${escapeHtml(color.colorName)}"
        ${isDisabled ? 'disabled' : ''}
      >
        <img src="${escapeHtml(previewImage)}" data-full="${escapeHtml(originalImage)}" alt="${escapeHtml(color.colorName)}" width="56" height="56" loading="lazy" decoding="async" fetchpriority="low" onerror="if(this.dataset.full&&this.src!==this.dataset.full){this.src=this.dataset.full;}else{this.onerror=null;this.src='../img/logo.png';}">
      </button>
    `;
  }).join('');

  const sizeChips = sizeOptions.length
    ? sizeOptions.map((option) => {
        const isActive = String(selectedSizeValue) === String(option.value);
        const stock = Number(option.stock) || 0;
        const isDisabled = stock <= 0;

        return `
          <button
            type="button"
            class="pd-size-chip${isActive ? ' is-active' : ''}${isDisabled ? ' is-disabled' : ''}"
            data-attribute-name="${escapeHtml(SIZE_ATTR_NAME)}"
            data-attribute-value="${escapeHtml(option.value)}"
            aria-pressed="${isActive ? 'true' : 'false'}"
            ${isDisabled ? 'disabled' : ''}
          >
            ${escapeHtml(option.label)}
          </button>
        `;
      }).join('')
    : `<p class="pd-variant-empty">${selectedColorId ? 'No sizes for this color.' : 'Pick a color first.'}</p>`;

  return `
    <div class="pd-variants">
      <div class="pd-variant-group">
        <div class="pd-variant-head">
          <span>Color: <strong>${escapeHtml(selectedColorLabel || 'Select color')}</strong></span>
        </div>
        <div class="pd-color-grid">
          ${colorTiles || `<p class="pd-variant-empty">No colors available.</p>`}
        </div>
      </div>
      <div class="pd-variant-group">
        <div class="pd-variant-head">
          <span>Size: <strong>${escapeHtml(selectedSizeLabel || 'Select size')}</strong></span>
        </div>
        <div class="pd-size-grid">
          ${sizeChips}
        </div>
      </div>
    </div>
  `;
}

export function renderProductOptionPreview(root, attributes, product = null, selectedAttributes = {}) {
  if (!root) {
    return;
  }

  const enrichedProduct = product ? enrichProductColorVariants(product, normalizeStorefrontAssetUrl) : null;

  if (!Array.isArray(attributes) || !attributes.length) {
    root.innerHTML = '';
    return;
  }

  if (isColorSizeInventory(enrichedProduct)) {
    root.innerHTML = buildInlineColorSizeMarkup(enrichedProduct, attributes, selectedAttributes);
    return;
  }

  const purchasable = hasPurchasableVariant(enrichedProduct || product);

  if (!purchasable) {
    root.innerHTML = `
      <div class="purchase-option-banner purchase-option-banner--oos">
        <div class="purchase-option-banner__lead">
          <span class="purchase-option-banner__eyebrow">Unavailable</span>
          <strong>Out of stock</strong>
          <p>No purchasable color or size is available right now.</p>
        </div>
      </div>
    `;
    return;
  }

  const colorCount = attributes.find((entry) => entry.name === COLOR_ATTR_NAME)?.options?.filter((option) => Number(option.stock) > 0).length || 0;

  root.innerHTML = `
    <div class="purchase-option-banner purchase-option-banner--inventory">
      <div class="purchase-option-banner__lead">
        <span class="purchase-option-banner__eyebrow">Configure your order</span>
        <strong>Select options to continue</strong>
        <p>${colorCount ? `${colorCount} color${colorCount === 1 ? '' : 's'} available · ` : ''}Stock updates live per selection</p>
      </div>
      <button type="button" class="purchase-option-banner__cta" data-open-config-modal>
        Select Options
      </button>
    </div>
  `;
}

function buildColorSizeModalMarkup({
  product,
  attributes,
  selectedAttributes,
  currentQuantity,
  validationMessage,
  preferredAction,
  canSubmit,
  selectionStock
}) {
  const enrichedProduct = enrichProductColorVariants(product, normalizeStorefrontAssetUrl);
  const colorVariants = extractColorVariantsFromProduct(enrichedProduct);
  const selectedColorId = selectedAttributes?.[COLOR_ATTR_NAME] || '';
  const selectedSizeValue = selectedAttributes?.[SIZE_ATTR_NAME] || '';
  const selectedColorLabel = getColorLabel(enrichedProduct, selectedColorId, attributes, selectedAttributes);
  const sizeOptions = selectedColorId ? getSizesForColor(enrichedProduct, selectedColorId) : [];
  const selectedSizeLabel = getSizeLabel(selectedSizeValue, sizeOptions, enrichedProduct);
  const unitPrice = resolveVariantUnitPrice(enrichedProduct, selectedAttributes);
  const discount = resolveDiscountMeta(enrichedProduct, unitPrice);
  const previewSource = resolveModalImage(
    getPrimarySelectionImage(enrichedProduct, attributes, selectedAttributes),
    enrichedProduct?.mainImage || enrichedProduct?.image
  );
  const previewImage = toProductCardImageUrl(previewSource) || previewSource;
  const hasCompleteSelection = Boolean(selectedColorId && selectedSizeValue && Number(selectionStock) > 0);
  const stockValue = Number.isFinite(Number(selectionStock)) ? Math.max(0, Number(selectionStock)) : 0;
  const stockLabel = formatSelectionStockLabel(selectionStock, hasCompleteSelection);
  const stockState = !hasCompleteSelection
    ? 'pending'
    : (stockValue <= 0 ? 'oos' : (stockValue <= 5 ? 'low' : 'ok'));
  const choices = describeColorSizeChoices(enrichedProduct, selectedAttributes);
  const showColorPicker = choices.needsColorChoice;
  const sizeRows = selectedColorId ? getSizesForColor(enrichedProduct, selectedColorId) : [];
  const showSizePicker = choices.needsSizeChoice
    || (!selectedSizeValue && Boolean(selectedColorId))
    || sizeRows.length > 1;
  const action = preferredAction === 'buy' ? 'buy' : 'add';
  const actionLabel = action === 'buy' ? 'Buy Now' : 'Add to Cart';
  const actionHint = !canSubmit
    ? (!selectedColorId
      ? 'Select a color to continue.'
      : (!selectedSizeValue
        ? 'Select an available size.'
        : 'This combination is currently unavailable.'))
    : '';
  const quantity = Math.max(1, Number(currentQuantity) || 1);

  const colorCards = colorVariants.map((color) => {
    const isActive = String(selectedColorId) === String(color.id);
    const isDisabled = Number(color.totalStock) <= 0;
    const originalImage = resolveModalImage(color.image, enrichedProduct?.mainImage || enrichedProduct?.image);
    const image = toProductCardImageUrl(originalImage) || originalImage;
    const stateLabel = isDisabled ? 'out of stock' : (isActive ? 'selected' : 'available');

    return `
      <button
        type="button"
        class="pcm-color-tile${isActive ? ' is-active' : ''}${isDisabled ? ' is-disabled' : ''}"
        data-attribute-name="${escapeHtml(COLOR_ATTR_NAME)}"
        data-attribute-value="${escapeHtml(color.id)}"
        role="radio"
        aria-checked="${isActive ? 'true' : 'false'}"
        aria-label="${escapeHtml(`${color.colorName}, ${stateLabel}`)}"
        ${isDisabled ? 'disabled aria-disabled="true"' : ''}
      >
        <span class="pcm-color-tile__media">
          <img src="${escapeHtml(image)}" alt="" width="72" height="72" loading="lazy" decoding="async" />
        </span>
        <span class="pcm-color-tile__info">
          <strong>${escapeHtml(color.colorName)}</strong>
        </span>
        ${isActive ? '<span class="pcm-color-tile__check" aria-hidden="true"><i class="fa-solid fa-check"></i></span>' : ''}
      </button>
    `;
  }).join('');

  const sizePills = sizeOptions.length
    ? sizeOptions.map((option) => {
        const isActive = String(selectedSizeValue) === String(option.value);
        const stock = Number(option.stock) || 0;
        const isDisabled = stock <= 0;
        const stateLabel = isDisabled ? 'out of stock' : (isActive ? 'selected' : 'available');

        return `
          <button
            type="button"
            class="pcm-size-chip${isActive ? ' is-active' : ''}${isDisabled ? ' is-disabled' : ''}"
            data-attribute-name="${escapeHtml(SIZE_ATTR_NAME)}"
            data-attribute-value="${escapeHtml(option.value)}"
            role="radio"
            aria-checked="${isActive ? 'true' : 'false'}"
            aria-label="${escapeHtml(`Size ${option.label}, ${stateLabel}`)}"
            ${isDisabled ? 'disabled aria-disabled="true"' : ''}
          >
            <span class="pcm-size-chip__label">${escapeHtml(option.label)}</span>
          </button>
        `;
      }).join('')
    : `<p class="pcm-section__empty">${selectedColorId ? 'No sizes for this color.' : 'Select a color to see sizes.'}</p>`;

  return `
    <div class="pcm-shell pcm-shell--inventory">
      <div class="pcm-handle" aria-hidden="true"></div>

      <header class="pcm-summary">
        <span class="pcm-summary__preview">
          <img class="pcm-summary__image" src="${escapeHtml(previewImage)}" alt="" width="64" height="64" loading="lazy" decoding="async" />
        </span>
        <div class="pcm-summary__content">
          <h2 class="pcm-summary__title" id="pcmProductTitle">${escapeHtml(enrichedProduct.name)}</h2>
          <div class="pcm-summary__price">
            <strong>${formatPrice(unitPrice)}</strong>
            ${discount.hasDiscount ? `<span class="pcm-summary__old">${formatPrice(discount.oldPrice)}</span>` : ''}
            ${discount.discountPercent > 0 ? `<span class="pcm-summary__save">-${discount.discountPercent}%</span>` : ''}
          </div>
        </div>
        <button type="button" class="pcm-close" data-config-close aria-label="Close options">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </header>

      <div class="pcm-body pcm-body--sheet">
        ${validationMessage ? `<div class="pcm-validation" role="alert">${escapeHtml(validationMessage)}</div>` : ''}

        <section class="pcm-section${showColorPicker ? '' : ' pcm-section--resolved'}">
          <div class="pcm-section__head">
            <h3 class="pcm-section__title">Color</h3>
            <span class="pcm-section__meta">${showColorPicker ? 'Choose one' : 'Selected'}</span>
          </div>
          ${showColorPicker ? `
          <div class="pcm-color-grid" role="radiogroup" aria-label="Color">
            ${colorCards || `<p class="pcm-section__empty">No colors available.</p>`}
          </div>
          ` : `
          <div class="pcm-resolved" aria-live="polite">
            <span class="pcm-resolved__copy">
              <span class="pcm-resolved__label">Color</span>
              <strong>${escapeHtml(selectedColorLabel || 'Unavailable')}</strong>
            </span>
            <span class="pcm-resolved__ok"><i class="fa-solid fa-check" aria-hidden="true"></i> Selected</span>
          </div>
          `}
        </section>

        <section class="pcm-section pcm-section--sizes${selectedColorId || !choices.needsColorChoice ? ' is-ready' : ''}${showSizePicker ? '' : ' pcm-section--resolved'}">
          <div class="pcm-section__head">
            <h3 class="pcm-section__title">Size</h3>
            <span class="pcm-section__meta">${showSizePicker ? (selectedColorId ? escapeHtml(selectedColorLabel) : 'Choose one') : 'Selected'}</span>
          </div>
          ${showSizePicker ? `
          <div class="pcm-size-grid" role="radiogroup" aria-label="Size">
            ${sizePills}
          </div>
          ` : `
          <div class="pcm-resolved" aria-live="polite">
            <span class="pcm-resolved__copy">
              <span class="pcm-resolved__label">Size</span>
              <strong>${escapeHtml(selectedSizeLabel || 'Unavailable')}</strong>
            </span>
            <span class="pcm-resolved__ok"><i class="fa-solid fa-check" aria-hidden="true"></i> Selected</span>
          </div>
          `}
        </section>

        <section class="pcm-section pcm-section--qty">
          <div class="pcm-section__head">
            <h3 class="pcm-section__title">Quantity</h3>
          </div>
          <div class="pcm-qty-row">
            <div class="pcm-qty-stepper" aria-label="Quantity">
              <button type="button" data-config-base-qty="decrease" aria-label="Decrease quantity" ${!hasCompleteSelection || quantity <= 1 ? 'disabled' : ''}>−</button>
              <input
                type="number"
                min="1"
                max="${Math.max(1, stockValue)}"
                value="${quantity}"
                data-config-base-qty-input
                aria-label="Quantity"
                inputmode="numeric"
                ${!hasCompleteSelection ? 'disabled' : ''}
              />
              <button type="button" data-config-base-qty="increase" aria-label="Increase quantity" ${!hasCompleteSelection || quantity >= stockValue ? 'disabled' : ''}>+</button>
            </div>
            <p class="pcm-stock pcm-stock--${stockState}">${escapeHtml(stockLabel)}</p>
          </div>
        </section>
      </div>

      <footer class="pcm-footer pcm-footer--action">
        ${actionHint ? `<p class="pcm-footer__hint">${escapeHtml(actionHint)}</p>` : ''}
        <button
          type="button"
          class="pcm-primary"
          data-config-submit-action="${action}"
          ${canSubmit ? '' : 'disabled'}
        >
          ${escapeHtml(actionLabel)}
        </button>
      </footer>
    </div>
  `;
}

function buildLegacyModalMarkup({
  product,
  attributes,
  layout,
  selectedAttributes,
  quantityRows,
  currentQuantity,
  validationMessage,
  total,
  totalItems,
  quantityBlocked,
  blockerMessage,
  canSubmit,
  preferredAction,
  selectionStock = null
}) {
  const selectionSummary = buildAttributeSummary(
    attributes.filter(attribute => attribute !== layout.quantityAttribute),
    selectedAttributes
  );
  const primaryImage = resolveModalImage(
    getPrimarySelectionImage(product, attributes, selectedAttributes),
    product.mainImage || product.image
  );
  const summaryCountLabel = totalItems === 1 ? '1 item selected' : `${totalItems} items selected`;
  const supportingAttributes = layout.supportingAttributes || [];
  const quantityAttribute = layout.quantityAttribute;
  const currentSelectionReady = isSelectionComplete(
    [layout.visualAttribute, ...supportingAttributes].filter(Boolean),
    selectedAttributes
  );
  const hasColorAndSize = Boolean(
    selectedAttributes?.Color
    && selectedAttributes?.Size
    && Number.isFinite(Number(selectionStock))
  );
  const stockBanner = hasColorAndSize
    ? `<div class="pcm-stock-banner">Available stock for this selection: <strong>${Math.max(0, Number(selectionStock))}</strong></div>`
    : '';

  return `
    <div class="pcm-shell">
      <header class="pcm-header">
        <img class="pcm-header__image" src="${escapeHtml(primaryImage)}" alt="${escapeHtml(product.name)}">
        <div class="pcm-header__content">
          <p class="pcm-header__eyebrow">${escapeHtml(product.categoryLabel || product.badge || 'Product options')}</p>
          <h2 class="pcm-header__title" id="pcmProductTitle">${escapeHtml(product.name)}</h2>
          <strong class="pcm-header__price">${formatPrice(product.price)}</strong>
          <p class="pcm-header__summary">${escapeHtml(selectionSummary || 'Select options to continue')}</p>
        </div>
        <button type="button" class="pcm-close" data-config-close aria-label="Close configuration modal">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </header>

      <div class="pcm-body">
        ${validationMessage ? `<div class="pcm-validation">${escapeHtml(validationMessage)}</div>` : ''}

        ${layout.visualAttribute ? `
          <section class="pcm-group">
            <div class="pcm-group__head">
              <div>
                <h3>${escapeHtml(layout.visualAttribute.name)}</h3>
                <p>${layout.visualAttribute.required !== false ? 'Choose one option' : 'Optional'}</p>
              </div>
              <span>${escapeHtml(selectedAttributes?.[layout.visualAttribute.name] || 'Not selected')}</span>
            </div>
            <div class="pcm-group__options pcm-group__options--text">
              ${layout.visualAttribute.options.map(option => {
                const isActive = String(selectedAttributes?.[layout.visualAttribute.name] || '') === String(option.value);
                const meta = Number.isFinite(Number(option.stock)) ? `${Math.max(0, Number(option.stock))} left` : 'Available';

                return `
                  <button
                    type="button"
                    class="pcm-option-chip${isActive ? ' is-active' : ''}"
                    data-attribute-name="${escapeHtml(layout.visualAttribute.name)}"
                    data-attribute-value="${escapeHtml(option.value)}"
                    aria-pressed="${isActive ? 'true' : 'false'}"
                  >
                    <strong>${escapeHtml(option.label)}</strong>
                    <small>${escapeHtml(meta)}</small>
                  </button>
                `;
              }).join('')}
            </div>
          </section>
        ` : ''}

        ${supportingAttributes.map(attribute => `
          <section class="pcm-group pcm-group--compact">
            <div class="pcm-group__head">
              <div>
                <h3>${escapeHtml(attribute.name)}</h3>
                <p>${attribute.required !== false ? 'Choose one option' : 'Optional'}</p>
              </div>
              <span>${escapeHtml(selectedAttributes?.[attribute.name] || 'Not selected')}</span>
            </div>
            <div class="pcm-group__options pcm-group__options--text">
              ${attribute.options.map(option => {
                const isActive = String(selectedAttributes?.[attribute.name] || '') === String(option.value);
                const meta = Number.isFinite(Number(option.stock)) ? `${Math.max(0, Number(option.stock))} left` : 'Available';

                return `
                  <button
                    type="button"
                    class="pcm-option-chip${isActive ? ' is-active' : ''}"
                    data-attribute-name="${escapeHtml(attribute.name)}"
                    data-attribute-value="${escapeHtml(option.value)}"
                    aria-pressed="${isActive ? 'true' : 'false'}"
                  >
                    <strong>${escapeHtml(option.label)}</strong>
                    <small>${escapeHtml(meta)}</small>
                  </button>
                `;
              }).join('')}
            </div>
          </section>
        `).join('')}

        ${quantityAttribute ? `
          <section class="pcm-group pcm-group--quantity${!quantityBlocked ? ' is-ready' : ''}">
            <div class="pcm-group__head pcm-group__head--stacked">
              <div>
                <h3>${escapeHtml(quantityAttribute.name)}</h3>
                <p>${escapeHtml(blockerMessage || `Select one ${quantityAttribute.name.toLowerCase()} option and set quantity.`)}</p>
              </div>
              <span>${escapeHtml(summaryCountLabel)}</span>
            </div>
            ${stockBanner}
            <div class="pcm-size-list" role="list">
              ${quantityRows.map(row => {
                const option = row.option;
                const stockLabel = row.maxQty > 0 ? `${row.maxQty} available` : 'Out of stock';

                return `
                  <article class="pcm-size-row${row.qty > 0 ? ' is-active' : ''}${row.maxQty <= 0 ? ' is-disabled' : ''}" role="listitem">
                    <div class="pcm-size-row__copy">
                      <strong>${escapeHtml(option.label)}</strong>
                      <small>${escapeHtml(stockLabel)}</small>
                    </div>
                    <div class="pcm-mini-qty${quantityBlocked ? ' is-disabled' : ''}">
                      <button type="button" data-config-row-qty="decrease" data-row-option="${escapeHtml(option.value)}" ${quantityBlocked || row.maxQty <= 0 ? 'disabled' : ''}>-</button>
                      <input type="number" min="0" max="${Math.max(0, Number(row.maxQty) || 0)}" value="${Math.max(0, Number(row.qty) || 0)}" data-config-row-input data-row-option="${escapeHtml(option.value)}" ${quantityBlocked || row.maxQty <= 0 ? 'disabled' : ''}>
                      <button type="button" data-config-row-qty="increase" data-row-option="${escapeHtml(option.value)}" ${quantityBlocked || row.maxQty <= 0 ? 'disabled' : ''}>+</button>
                    </div>
                  </article>
                `;
              }).join('')}
            </div>
          </section>
        ` : `
          <section class="pcm-current${currentSelectionReady ? ' is-ready' : ''}">
            <div class="pcm-current__head">
              <div>
                <h3>Quantity</h3>
                <p>${escapeHtml(selectionSummary || 'Choose the required options, then adjust the quantity.')}</p>
              </div>
              <span>${escapeHtml(summaryCountLabel)}</span>
            </div>
            ${stockBanner}
            <div class="pcm-qty">
              <button type="button" data-config-base-qty="decrease">-</button>
              <input type="number" min="1" value="${Math.max(1, Number(currentQuantity) || 1)}" data-config-base-qty-input>
              <button type="button" data-config-base-qty="increase">+</button>
            </div>
          </section>
        `}
      </div>

      <footer class="pcm-footer">
        <div class="pcm-footer__total">
          <span class="pcm-footer__eyebrow">Total</span>
          <strong>${formatPrice(total)}</strong>
          <p>${escapeHtml(summaryCountLabel)}</p>
        </div>
        <div class="pcm-footer__actions">
          <button type="button" class="pcm-footer__cta" data-config-submit-action="${preferredAction === 'buy' ? 'buy' : 'add'}" ${canSubmit ? '' : 'disabled'}>
            ${preferredAction === 'buy' ? 'Buy Now' : 'Add to Cart'}
          </button>
        </div>
      </footer>
    </div>
  `;
}

export function buildModalMarkup(options) {
  const { product } = options;
  const enrichedProduct = enrichProductColorVariants(product, normalizeStorefrontAssetUrl);

  if (isColorSizeInventory(enrichedProduct)) {
    return buildColorSizeModalMarkup({ ...options, product: enrichedProduct });
  }

  return buildLegacyModalMarkup({ ...options, product: enrichedProduct });
}
