import { escapeHtml, toNumber } from "./utils.js";
import {
  computeColorTotalStock,
  computeProductTotalStock,
  normalizeColorVariant
} from "../../../../js/color-variant-inventory.js";

function renderSizeRow(colorIndex, sizeIndex, row = {}) {
  return `
    <div class="pm-color-size-row" data-color-index="${colorIndex}" data-size-index="${sizeIndex}">
      <input
        type="text"
        name="colorSize"
        value="${escapeHtml(row.size || "")}"
        placeholder="Size / Ingano (e.g. 40)"
        aria-label="Size"
      />
      <input
        type="number"
        min="0"
        step="1"
        name="colorSizeStock"
        value="${escapeHtml(String(row.stock ?? "0"))}"
        placeholder="Stock"
        aria-label="Stock for size"
      />
      <button type="button" class="pm-btn pm-btn-ghost pm-btn-icon" data-remove-size="${colorIndex}:${sizeIndex}" aria-label="Remove size">
        ×
      </button>
    </div>
  `;
}

export function renderColorVariantCard(color = {}, colorIndex = 0, sizePresets = []) {
  const normalized = normalizeColorVariant(color, colorIndex);
  const sizes = normalized.sizes.length
    ? normalized.sizes
    : [{ size: "", stock: 0 }];
  const hasImage = Boolean(normalized.image);
  const presetButtons = sizePresets.length
    ? `
      <div class="pm-color-size-presets">
        <span class="pm-color-size-presets__label">Quick add:</span>
        ${sizePresets.map((size) => `
          <button type="button" class="pm-btn pm-btn-ghost pm-btn-xs" data-add-preset-size="${colorIndex}" data-preset-size="${escapeHtml(size)}">
            ${escapeHtml(size)}
          </button>
        `).join("")}
      </div>
    `
    : "";

  return `
    <article class="pm-color-variant-card" data-color-index="${colorIndex}">
      <header class="pm-color-variant-card__head">
        <strong>Color Variant ${colorIndex + 1}</strong>
        <button type="button" class="pm-btn pm-btn-danger pm-btn-sm" data-remove-color="${colorIndex}">
          Kuraho / Remove
        </button>
      </header>

      <div class="pm-color-variant-card__grid">
        <div class="pm-color-variant-card__image">
          <div class="pm-color-upload-card ${hasImage ? "has-file" : ""}" data-color-drop="${colorIndex}">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
              hidden
              data-color-input="${colorIndex}"
            />
            <input type="hidden" name="colorClientKey" value="${escapeHtml(normalized.clientKey || normalized.id)}" />
            <input type="hidden" name="colorImage" value="${escapeHtml(normalized.image || "")}" />
            <input type="hidden" name="colorImageStoragePath" value="${escapeHtml(normalized.imageStoragePath || "")}" />

            <div class="pm-color-upload-preview-wrap">
              ${hasImage
                ? `<img src="${escapeHtml(normalized.image)}" alt="${escapeHtml(normalized.colorName)}" class="pm-color-variant-preview" data-color-preview="${colorIndex}" loading="lazy" />`
                : `<div class="pm-color-variant-preview pm-color-variant-preview--empty" data-color-preview-placeholder="${colorIndex}">No image</div>`}
            </div>

            <div class="pm-color-upload-copy">
              <strong>Kurura cyangwa ukande / Drag & drop or click</strong>
              <span>JPG, PNG, WEBP, GIF, AVIF — up to 5MB</span>
            </div>

            <div class="pm-color-upload-actions">
              <button type="button" class="pm-btn pm-btn-ghost pm-btn-sm" data-replace-color-image="${colorIndex}">
                ${hasImage ? "Replace / Hindura" : "Upload / Ohereza"}
              </button>
              ${hasImage ? `<button type="button" class="pm-btn pm-btn-danger pm-btn-sm" data-remove-color-image="${colorIndex}">Remove / Kuraho</button>` : ""}
            </div>

            <p class="pm-color-upload-status" data-color-upload-status="${colorIndex}" aria-live="polite"></p>
          </div>
        </div>

        <div class="pm-color-variant-card__meta">
          <label class="pm-field">
            <span class="pm-field-label">Color Name / Izina ry'Ibara</span>
            <input type="text" name="colorName" value="${escapeHtml(normalized.colorName || "")}" placeholder="White, Black, Blue..." required />
          </label>

          <label class="pm-field">
            <span class="pm-field-label">Total Color Stock / Stock y'Ibara</span>
            <input
              type="number"
              min="0"
              step="1"
              name="colorTotalStock"
              value="${escapeHtml(String(computeColorTotalStock(normalized)))}"
              readonly
              data-color-total-stock="${colorIndex}"
            />
            <small class="pm-field-hint">Bibarwa mu buryo bwikora uhereye ku sizes.</small>
          </label>
        </div>
      </div>

      <section class="pm-color-variant-card__sizes">
        <div class="pm-color-variant-card__sizes-head">
          <div>
            <h4>Sizes & Stock / Ingano n'Umubare</h4>
            <p>Ongeramo ingano n'umubare w'ibyo bihari kuri iri bara.</p>
          </div>
          <button type="button" class="pm-btn pm-btn-ghost pm-btn-sm" data-add-size="${colorIndex}">
            + Ongeramo Size
          </button>
        </div>
        ${presetButtons}
        <div class="pm-color-size-list" data-color-size-list="${colorIndex}">
          ${sizes.map((row, sizeIndex) => renderSizeRow(colorIndex, sizeIndex, row)).join("")}
        </div>
      </section>
    </article>
  `;
}

export function renderColorInventorySection(inventory = {}, sizePresets = []) {
  const colorVariants = Array.isArray(inventory.colorVariants) ? inventory.colorVariants : [];
  const variantsEnabled = Boolean(inventory.variantsEnabled || colorVariants.length);
  const totalStock = computeProductTotalStock(
    colorVariants,
    Math.max(0, Math.floor(toNumber(inventory.quantity, 0)))
  );

  return `
    <section class="pm-form-section pm-form-section--color-inventory">
      <header class="pm-form-section-head">
        <h3 class="pm-form-section-title">
          <span class="pm-section-rw">Amabara n'Ububiko</span>
          <span class="pm-section-sep">/</span>
          <span class="pm-section-en">Color Variants & Inventory</span>
        </h3>
        <p>Each color has its own uploaded image, name, sizes, and stock quantities.</p>
      </header>

      <div class="pm-form-section-block pm-form-section-block--full">
        <div class="pm-color-inventory-head">
          <label class="pm-check">
            <input type="checkbox" name="variantsEnabled" ${variantsEnabled ? "checked" : ""} />
            <span>Koresha Amabara / Enable Color Variants</span>
          </label>
          <button type="button" class="pm-btn pm-btn-primary" data-add-color ${variantsEnabled ? "" : "disabled"}>
            + Ongeramo Ibara / Add Color
          </button>
        </div>

        <div class="pm-color-variant-stack ${variantsEnabled ? "" : "is-disabled"}" data-color-variant-stack>
          ${colorVariants.length
            ? colorVariants.map((color, index) => renderColorVariantCard(color, index, sizePresets)).join("")
            : `<div class="pm-color-inventory-empty">
                <p>No color variants yet. Add colors to manage per-color images, sizes, and stock.</p>
              </div>`}
        </div>

        <div class="pm-stock-total pm-stock-total--product">
          <span>Product Total Stock / Stock Yose:</span>
          <strong data-total-product-stock>${escapeHtml(String(totalStock))}</strong>
        </div>
      </div>
    </section>
  `;
}

export function collectColorVariantsFromForm(form) {
  const enabled = form.querySelector('[name="variantsEnabled"]')?.checked;
  if (!enabled) {
    return [];
  }

  const cards = Array.from(form.querySelectorAll("[data-color-index]"))
    .filter((node) => node.classList.contains("pm-color-variant-card"));

  return cards.map((card, index) => {
    const colorName = String(card.querySelector('[name="colorName"]')?.value || "").trim();
    const clientKey = String(card.querySelector('[name="colorClientKey"]')?.value || "").trim();
    const image = String(card.querySelector('[name="colorImage"]')?.value || "").trim();
    const imageStoragePath = String(card.querySelector('[name="colorImageStoragePath"]')?.value || "").trim();
    const sizeRows = Array.from(card.querySelectorAll(".pm-color-size-row"));
    const sizes = sizeRows
      .map((row) => ({
        size: String(row.querySelector('[name="colorSize"]')?.value || "").trim(),
        stock: String(Math.max(0, Math.floor(toNumber(row.querySelector('[name="colorSizeStock"]')?.value, 0))))
      }))
      .filter((row) => row.size);

    const normalized = normalizeColorVariant({ clientKey, colorName, image, imageStoragePath, sizes }, index);
    return {
      id: normalized.id,
      clientKey: normalized.clientKey,
      colorName: normalized.colorName,
      image: normalized.image,
      imageStoragePath: normalized.imageStoragePath,
      sizes: normalized.sizes.map((row) => ({
        size: row.size,
        stock: String(row.stock)
      }))
    };
  }).filter((entry) => entry.colorName);
}

export function renderColorVariantReviewCards(colorVariants = []) {
  if (!Array.isArray(colorVariants) || !colorVariants.length) {
    return `<p class="pm-review-empty">No color variants configured.</p>`;
  }

  return colorVariants.map((color, index) => {
    const normalized = normalizeColorVariant(color, index);
    const sizeSummary = normalized.sizes.length
      ? normalized.sizes.map((row) => `${row.size} → ${row.stock}`).join(", ")
      : "No sizes";

    return `
      <article class="pm-color-review-card">
        ${normalized.image
          ? `<button type="button" class="pm-review-thumb-btn" data-review-image="${escapeHtml(normalized.image)}">
              <img src="${escapeHtml(normalized.image)}" alt="${escapeHtml(normalized.colorName)}" loading="lazy" />
            </button>`
          : `<div class="pm-review-thumb-empty">No Image</div>`}
        <div class="pm-color-review-card__copy">
          <strong>${escapeHtml(normalized.colorName)}</strong>
          <span>Total: ${escapeHtml(String(normalized.totalStock))}</span>
          <span>Sizes: ${escapeHtml(sizeSummary)}</span>
        </div>
      </article>
    `;
  }).join("");
}

export function createColorClientKey() {
  return `color-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
