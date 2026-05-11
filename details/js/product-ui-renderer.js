import { buildAttributeSummary, getPrimarySelectionImage, isSelectionComplete } from './product-attributes.js';

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

export function renderProductOptionPreview(root, attributes) {
  if (!root) {
    return;
  }

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

  root.innerHTML = `
    <div class="purchase-option-banner">
      <div>
        <span class="purchase-option-banner__eyebrow">Configuration required</span>
        <strong>Select options in the purchase popup</strong>
      </div>
      <div class="purchase-option-banner__chips">
        ${attributes.map(attribute => `
          <span class="purchase-option-banner__chip">
            ${escapeHtml(attribute.name)}
            <small>${attribute.options.length} choices</small>
          </span>
        `).join('')}
      </div>
    </div>
  `;
}

export function buildModalMarkup({
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
  preferredAction
}) {
  const selectionSummary = buildAttributeSummary(
    attributes.filter(attribute => attribute !== layout.quantityAttribute),
    selectedAttributes
  );
  const primaryImage = getPrimarySelectionImage(product, attributes, selectedAttributes) || product.mainImage || product.image;
  const selectedLabel = selectionSummary || 'Select options to continue';
  const summaryCountLabel = totalItems === 1 ? '1 item selected' : `${totalItems} items selected`;
  const supportingAttributes = layout.supportingAttributes || [];
  const quantityAttribute = layout.quantityAttribute;
  const currentSelectionReady = isSelectionComplete(
    [layout.visualAttribute, ...supportingAttributes].filter(Boolean),
    selectedAttributes
  );

  return `
    <div class="pcm-shell">
      <header class="pcm-header">
        <img class="pcm-header__image" src="${escapeHtml(primaryImage)}" alt="${escapeHtml(product.name)}">
        <div class="pcm-header__content">
          <p class="pcm-header__eyebrow">${escapeHtml(product.categoryLabel || product.badge || 'Product options')}</p>
          <h2 class="pcm-header__title">${escapeHtml(product.name)}</h2>
          <strong class="pcm-header__price">${formatPrice(product.price)}</strong>
          <p class="pcm-header__summary">${escapeHtml(selectedLabel)}</p>
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
            <div class="pcm-group__options ${layout.visualAttribute.type === 'color' ? 'pcm-group__options--swatch' : 'pcm-group__options--image'}">
              ${layout.visualAttribute.options.map(option => {
                const isActive = String(selectedAttributes?.[layout.visualAttribute.name] || '') === String(option.value);
                const meta = Number.isFinite(Number(option.stock)) ? `${Math.max(0, Number(option.stock))} left` : 'Available';

                if (layout.visualAttribute.type === 'color') {
                  const swatchValue = option.swatch || '#cfd8d6';
                  const swatchStyle = `background:${escapeHtml(swatchValue)};`;

                  return `
                    <button
                      type="button"
                      class="pcm-option-chip pcm-option-chip--swatch${isActive ? ' is-active' : ''}"
                      data-attribute-name="${escapeHtml(layout.visualAttribute.name)}"
                      data-attribute-value="${escapeHtml(option.value)}"
                      aria-pressed="${isActive ? 'true' : 'false'}"
                    >
                      <span class="pcm-option-chip__swatch" style="${swatchStyle}"></span>
                      <strong>${escapeHtml(option.label)}</strong>
                      <small>${escapeHtml(meta)}</small>
                    </button>
                  `;
                }

                return `
                  <button
                    type="button"
                    class="pcm-option-card pcm-option-card--image${isActive ? ' is-active' : ''}"
                    data-attribute-name="${escapeHtml(layout.visualAttribute.name)}"
                    data-attribute-value="${escapeHtml(option.value)}"
                    aria-pressed="${isActive ? 'true' : 'false'}"
                  >
                    <span class="pcm-option-card__media">
                      <img src="${escapeHtml(option.image || product.mainImage || product.image)}" alt="${escapeHtml(option.label)}">
                    </span>
                    <span class="pcm-option-card__copy">
                      <strong>${escapeHtml(option.label)}</strong>
                      <small>${escapeHtml(meta)}</small>
                    </span>
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
                <p>${escapeHtml(blockerMessage || `Select one or more ${quantityAttribute.name.toLowerCase()} options and set the quantity for each.`)}</p>
              </div>
              <span>${escapeHtml(summaryCountLabel)}</span>
            </div>
            <div class="pcm-size-list" role="list" aria-label="${escapeHtml(quantityAttribute.name)} quantities">
              ${quantityRows.map(row => {
                const option = row.option;
                const stockLabel = row.maxQty > 0 ? `${row.maxQty} left` : 'Out of stock';

                return `
                  <article class="pcm-size-row${row.qty > 0 ? ' is-active' : ''}${row.maxQty <= 0 ? ' is-disabled' : ''}" role="listitem">
                    <div class="pcm-size-row__copy">
                      <strong>${escapeHtml(option.label)}</strong>
                      <small>${escapeHtml(stockLabel)}</small>
                    </div>
                    <div class="pcm-mini-qty${quantityBlocked ? ' is-disabled' : ''}" aria-label="${escapeHtml(option.label)} quantity selector">
                      <button type="button" data-config-row-qty="decrease" data-row-option="${escapeHtml(option.value)}" aria-label="Decrease ${escapeHtml(option.label)} quantity" ${quantityBlocked || row.maxQty <= 0 ? 'disabled' : ''}>-</button>
                      <input type="number" min="0" max="${Math.max(0, Number(row.maxQty) || 0)}" value="${Math.max(0, Number(row.qty) || 0)}" data-config-row-input data-row-option="${escapeHtml(option.value)}" aria-label="${escapeHtml(option.label)} quantity" ${quantityBlocked || row.maxQty <= 0 ? 'disabled' : ''}>
                      <button type="button" data-config-row-qty="increase" data-row-option="${escapeHtml(option.value)}" aria-label="Increase ${escapeHtml(option.label)} quantity" ${quantityBlocked || row.maxQty <= 0 ? 'disabled' : ''}>+</button>
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

            <div class="pcm-qty" aria-label="Current quantity selector">
              <button type="button" data-config-base-qty="decrease" aria-label="Decrease quantity">-</button>
              <input type="number" min="1" value="${Math.max(1, Number(currentQuantity) || 1)}" data-config-base-qty-input aria-label="Current quantity">
              <button type="button" data-config-base-qty="increase" aria-label="Increase quantity">+</button>
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