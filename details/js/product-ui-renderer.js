import { buildAttributeSummary, getPrimarySelectionImage, isSelectionComplete } from './product-attributes.js';
import {
  COLOR_ATTR_NAME,
  SIZE_ATTR_NAME,
  enrichProductColorVariants,
  extractColorVariantsFromProduct,
  getSizesForColor,
  isColorSizeInventory
} from '../../js/color-variant-inventory.js';
import { normalizeStorefrontAssetUrl } from '../../services/storefront-asset-url.js';

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

function getSizeLabel(sizeValue, sizeOptions = []) {
  const match = sizeOptions.find((entry) => String(entry.value) === String(sizeValue));
  return match?.label || sizeValue || '';
}

export function renderProductOptionPreview(root, attributes, product = null) {
  if (!root) {
    return;
  }

  const enrichedProduct = product ? enrichProductColorVariants(product, normalizeStorefrontAssetUrl) : null;

  if (!Array.isArray(attributes) || !attributes.length) {
    root.innerHTML = `
      <div class="purchase-option-banner purchase-option-banner--plain">
        <div>
          <span class="purchase-option-banner__eyebrow">Ready to order</span>
          <strong>No required configuration</strong>
        </div>
        <p>Add to cart or buy now directly. Quantity can still be adjusted before checkout.</p>
      </div>
    `;
    return;
  }

  const colorCount = isColorSizeInventory(enrichedProduct)
    ? extractColorVariantsFromProduct(enrichedProduct).length
    : (attributes.find((entry) => entry.name === COLOR_ATTR_NAME)?.options?.length || 0);

  root.innerHTML = `
    <div class="purchase-option-banner purchase-option-banner--inventory">
      <div class="purchase-option-banner__lead">
        <span class="purchase-option-banner__eyebrow">Configure your order</span>
        <strong>Select color, then size</strong>
        <p>${colorCount} color${colorCount === 1 ? '' : 's'} available · Stock updates live per selection</p>
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
  total,
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
  const selectedSizeLabel = getSizeLabel(selectedSizeValue, sizeOptions);
  const unitPrice = Number(enrichedProduct?.price || 0);
  const lineTotal = unitPrice * Math.max(0, Number(currentQuantity) || 0);
  const previewImage = resolveModalImage(
    getPrimarySelectionImage(enrichedProduct, attributes, selectedAttributes),
    enrichedProduct?.mainImage || enrichedProduct?.image
  );
  const hasCompleteSelection = Boolean(selectedColorId && selectedSizeValue && Number(selectionStock) > 0);
  const stockValue = Number.isFinite(Number(selectionStock)) ? Math.max(0, Number(selectionStock)) : 0;

  const colorCards = colorVariants.map((color) => {
    const isActive = String(selectedColorId) === String(color.id);
    const isDisabled = color.totalStock <= 0;
    const image = resolveModalImage(color.image, enrichedProduct?.mainImage || enrichedProduct?.image);

    return `
      <button
        type="button"
        class="pcm-color-card${isActive ? ' is-active' : ''}${isDisabled ? ' is-disabled' : ''}"
        data-attribute-name="${escapeHtml(COLOR_ATTR_NAME)}"
        data-attribute-value="${escapeHtml(color.id)}"
        aria-pressed="${isActive ? 'true' : 'false'}"
        ${isDisabled ? 'disabled' : ''}
      >
        <span class="pcm-color-card__media">
          <img src="${escapeHtml(image)}" alt="${escapeHtml(color.colorName)}" loading="lazy" decoding="async" />
        </span>
        <span class="pcm-color-card__body">
          <strong>${escapeHtml(color.colorName)}</strong>
          <span class="pcm-color-card__stock">${color.totalStock > 0 ? `${color.totalStock} Available` : 'Out of stock'}</span>
        </span>
      </button>
    `;
  }).join('');

  const sizePills = sizeOptions.length
    ? sizeOptions.map((option) => {
        const isActive = String(selectedSizeValue) === String(option.value);
        const stock = Number(option.stock) || 0;
        const isDisabled = stock <= 0;

        return `
          <button
            type="button"
            class="pcm-size-pill${isActive ? ' is-active' : ''}${isDisabled ? ' is-disabled' : ''}"
            data-attribute-name="${escapeHtml(SIZE_ATTR_NAME)}"
            data-attribute-value="${escapeHtml(option.value)}"
            aria-pressed="${isActive ? 'true' : 'false'}"
            ${isDisabled ? 'disabled' : ''}
          >
            <strong>${escapeHtml(option.label)}</strong>
            <small>${isDisabled ? 'Out of stock' : `${stock} left`}</small>
          </button>
        `;
      }).join('')
    : `<p class="pcm-step__empty">${selectedColorId ? 'No sizes in stock for this color.' : 'Select a color to view available sizes.'}</p>`;

  return `
    <div class="pcm-shell pcm-shell--inventory">
      <header class="pcm-header pcm-header--inventory">
        <div class="pcm-header__preview">
          <img class="pcm-header__image" src="${escapeHtml(previewImage)}" alt="${escapeHtml(enrichedProduct.name)}" loading="lazy" decoding="async" />
        </div>
        <div class="pcm-header__content">
          <p class="pcm-header__eyebrow">${escapeHtml(enrichedProduct.categoryLabel || enrichedProduct.badge || 'Configure order')}</p>
          <h2 class="pcm-header__title">${escapeHtml(enrichedProduct.name)}</h2>
          <div class="pcm-header__price-row">
            <strong class="pcm-header__price">${formatPrice(unitPrice)}</strong>
            ${hasCompleteSelection ? `<span class="pcm-header__line-total">${formatPrice(lineTotal)} total</span>` : ''}
          </div>
          <p class="pcm-header__summary">${escapeHtml(
            hasCompleteSelection
              ? `${selectedColorLabel} · Size ${selectedSizeLabel}`
              : selectedColorId
                ? `${selectedColorLabel} · Choose a size`
                : 'Select color and size to continue'
          )}</p>
        </div>
        <button type="button" class="pcm-close" data-config-close aria-label="Close configuration modal">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </header>

      <div class="pcm-body pcm-body--inventory">
        ${validationMessage ? `<div class="pcm-validation" role="alert">${escapeHtml(validationMessage)}</div>` : ''}

        <section class="pcm-step pcm-step--colors">
          <div class="pcm-step__head">
            <span class="pcm-step__badge">Step 1</span>
            <div>
              <h3>Select Color</h3>
              <p>Choose the color you want. Each option shows live stock for that color.</p>
            </div>
          </div>
          <div class="pcm-color-grid">
            ${colorCards || `<p class="pcm-step__empty">No color variants available.</p>`}
          </div>
        </section>

        <section class="pcm-step pcm-step--sizes${selectedColorId ? ' is-visible' : ''}">
          <div class="pcm-step__head">
            <span class="pcm-step__badge">Step 2</span>
            <div>
              <h3>Select Size</h3>
              <p>${selectedColorId ? `Available sizes for ${escapeHtml(selectedColorLabel)}` : 'Pick a color first'}</p>
            </div>
          </div>
          <div class="pcm-size-grid">
            ${sizePills}
          </div>
        </section>

        <section class="pcm-step pcm-step--purchase${hasCompleteSelection ? ' is-visible' : ''}">
          <div class="pcm-step__head">
            <span class="pcm-step__badge">Step 3</span>
            <div>
              <h3>Review & Quantity</h3>
              <p>Confirm your selection and choose how many to order.</p>
            </div>
          </div>

          <article class="pcm-selection-card">
            <div class="pcm-selection-card__copy">
              <strong>${escapeHtml(selectedColorLabel)}</strong>
              <span>Size ${escapeHtml(selectedSizeLabel)}</span>
            </div>
            <div class="pcm-selection-card__stock">
              <span>Available Stock</span>
              <strong>${stockValue}</strong>
            </div>
          </article>

          <div class="pcm-purchase-row">
            <div class="pcm-purchase-row__label">
              <strong>Quantity</strong>
              <span>Max ${stockValue}</span>
            </div>
            <div class="pcm-qty pcm-qty--inventory" aria-label="Quantity selector">
              <button type="button" data-config-base-qty="decrease" aria-label="Decrease quantity" ${!hasCompleteSelection ? 'disabled' : ''}>-</button>
              <input
                type="number"
                min="1"
                max="${Math.max(1, stockValue)}"
                value="${Math.max(1, Number(currentQuantity) || 1)}"
                data-config-base-qty-input
                aria-label="Quantity"
                ${!hasCompleteSelection ? 'disabled' : ''}
              />
              <button type="button" data-config-base-qty="increase" aria-label="Increase quantity" ${!hasCompleteSelection ? 'disabled' : ''}>+</button>
            </div>
          </div>

          <div class="pcm-price-summary">
            <div>
              <span>Unit price</span>
              <strong>${formatPrice(unitPrice)}</strong>
            </div>
            <div>
              <span>Subtotal</span>
              <strong>${formatPrice(lineTotal)}</strong>
            </div>
          </div>
        </section>
      </div>

      <footer class="pcm-footer pcm-footer--inventory">
        <div class="pcm-footer__summary">
          <span class="pcm-footer__eyebrow">${hasCompleteSelection ? 'Ready to checkout' : 'Complete your selection'}</span>
          <strong>${formatPrice(lineTotal)}</strong>
          <p>${hasCompleteSelection ? `${Math.max(1, Number(currentQuantity) || 1)} item(s) · ${selectedColorLabel} · Size ${selectedSizeLabel}` : 'Select color and size to enable actions'}</p>
        </div>
        <div class="pcm-footer__actions">
          <button type="button" class="pcm-footer__cta pcm-footer__cta--ghost${preferredAction === 'add' ? ' is-preferred' : ''}" data-config-submit-action="add" ${canSubmit ? '' : 'disabled'}>
            Add to Cart
          </button>
          <button type="button" class="pcm-footer__cta${preferredAction === 'buy' ? ' is-preferred' : ''}" data-config-submit-action="buy" ${canSubmit ? '' : 'disabled'}>
            Buy Now
          </button>
        </div>
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
          <h2 class="pcm-header__title">${escapeHtml(product.name)}</h2>
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
          <button type="button" class="pcm-footer__cta pcm-footer__cta--ghost${preferredAction === 'add' ? ' is-preferred' : ''}" data-config-submit-action="add" ${canSubmit ? '' : 'disabled'}>
            Add to Cart
          </button>
          <button type="button" class="pcm-footer__cta${preferredAction === 'buy' ? ' is-preferred' : ''}" data-config-submit-action="buy" ${canSubmit ? '' : 'disabled'}>
            Buy Now
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
