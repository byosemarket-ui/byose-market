import { getProductById, updateProductAndSync } from "../../services/admin-data.service.js";
import {
  CATEGORY_OPTIONS,
  COUNTRY_OF_ORIGIN_OPTIONS,
  FALLBACK_IMAGE,
  PLACEMENT_OPTIONS,
  POSITION_MODE_OPTIONS,
  PRIORITY_SCORE_PRESETS,
  PRODUCT_CONDITION_OPTIONS,
  PRODUCT_STATUS_OPTIONS,
  PRODUCT_TYPE_OPTIONS,
  VISIBILITY_OPTIONS,
  WARRANTY_OPTIONS
} from "./constants.js";
import {
  collectOriginalImagesForDisplay,
  getSizeOptionsForCategory,
  hydrateDraftFromProduct,
  inferStockStatus,
  sanitizeDraft,
  snapshotCanonicalMedia
} from "./draft.js";
import { verifyReloadedProductUpdate } from "./edit-integrity.js";
import { buildAutoSeo, buildProductPayload, validateAllSteps } from "./payload.js";
import { computeProductDiscount, renderAdminStorefrontPreview } from "./pricing.js";
import {
  removeColorVariantImage,
  removeGalleryItem,
  removeMainImage,
  resolveColorVariantImages,
  resolveDraftMedia,
  uploadColorVariantImage
} from "./upload.js";
import {
  collectColorVariantsFromForm,
  createColorClientKey,
  renderColorInventorySection
} from "./inventory-ui.js";
import { computeProductTotalStock } from "../../../../js/color-variant-inventory.js";
import { resolveApiOrigin } from "../../../../services/api-origin.js";
import {
  buildCreateHash,
  buildEditHash,
  escapeHtml,
  isPersistableAssetUrl,
  toLabel,
  toNumber,
  validateImageFile
} from "./utils.js";

const CATEGORY_ATTRIBUTE_CONFIG = {
  shoes: ["material", "gender"],
  fashion: ["gender", "fabric", "material"],
  bags: ["material", "height", "width", "length"],
  phones: ["storage", "ram", "battery", "camera", "color"],
  watches: ["dialSize", "strapType", "color"],
  electronics: ["model", "power", "voltage", "storage"]
};

const INVENTORY_ATTRIBUTE_LABELS = {
  material: ["Ibikoresho", "Material"],
  fabric: ["Umutako", "Fabric"],
  gender: ["Igitsina", "Gender"],
  height: ["Uburebure", "Height"],
  width: ["Ubugari", "Width"],
  length: ["Uburebure bw'Ikintu", "Length"],
  storage: ["Ububiko", "Storage"],
  ram: ["RAM", "RAM"],
  battery: ["Bateri", "Battery"],
  camera: ["Kamera", "Camera"],
  color: ["Ibara", "Color"],
  dialSize: ["Ingano ya Dial", "Dial Size"],
  strapType: ["Ubwoko bw'Umukandara", "Strap Type"],
  model: ["Moderi", "Model"],
  power: ["Ingufu", "Power"],
  voltage: ["Voltage", "Voltage"]
};

let activeDraft = sanitizeDraft({});
let loadedProduct = null;
let mediaSnapshot = snapshotCanonicalMedia(activeDraft);
let pendingMainFile = null;
let pendingMainPreviewUrl = "";
let pendingGalleryEntries = [];
let mediaTouched = false;
let saveSuccess = null;
let isSaving = false;
let uploadProgress = { message: "", percent: null };
let workflowFeedback = { tone: "", message: "" };

function resetEditorState() {
  loadedProduct = null;
  pendingMainFile = null;
  if (pendingMainPreviewUrl) {
    URL.revokeObjectURL(pendingMainPreviewUrl);
  }
  pendingMainPreviewUrl = "";
  pendingGalleryEntries.forEach((entry) => {
    if (entry?.previewUrl) {
      URL.revokeObjectURL(entry.previewUrl);
    }
  });
  pendingGalleryEntries = [];
  mediaTouched = false;
  saveSuccess = null;
  isSaving = false;
  uploadProgress = { message: "", percent: null };
  workflowFeedback = { tone: "", message: "" };
}

function markMediaTouched() {
  mediaTouched = true;
}

function setFeedback(tone, message) {
  workflowFeedback = { tone, message };
}

function buildStorefrontProductUrl(catalogId) {
  const origin = String(resolveApiOrigin() || "https://byosemarket.com").replace(/\/+$/, "");
  return `${origin}/details/product-details1.html?id=${encodeURIComponent(String(catalogId || ""))}`;
}

function buildPublicProductApiUrl(catalogId) {
  const origin = String(resolveApiOrigin() || "https://byosemarket.com").replace(/\/+$/, "");
  return `${origin}/api/products/${encodeURIComponent(String(catalogId || ""))}`;
}

function renderBilingualField(labelRw, labelEn, inputHtml, hint = "", extraClass = "") {
  return `
    <label class="pm-field ${extraClass}">
      <span class="pm-field-label pm-field-label--bilingual">
        <span class="pm-field-label-rw">${escapeHtml(labelRw)}</span>
        <span class="pm-field-label-sep">/</span>
        <span class="pm-field-label-en">${escapeHtml(labelEn)}</span>
      </span>
      ${inputHtml}
      ${hint ? `<small class="pm-field-hint">${escapeHtml(hint)}</small>` : ""}
    </label>
  `;
}

function renderFormSection(titleRw, titleEn, subtitle, contentHtml, fullWidthHtml = "") {
  return `
    <section class="pm-form-section">
      <header class="pm-form-section-head">
        <h3 class="pm-form-section-title">
          <span class="pm-section-rw">${escapeHtml(titleRw)}</span>
          <span class="pm-section-sep">/</span>
          <span class="pm-section-en">${escapeHtml(titleEn)}</span>
        </h3>
        ${subtitle ? `<p class="pm-form-section-subtitle">${escapeHtml(subtitle)}</p>` : ""}
      </header>
      <div class="pm-form-grid">${contentHtml}</div>
      ${fullWidthHtml || ""}
    </section>
  `;
}

function renderOptionSelect(name, options, selectedValue, bilingual = false) {
  return `
    <select name="${escapeHtml(name)}">
      ${options.map((option) => {
        const value = option.value ?? option;
        const selected = value === selectedValue ? "selected" : "";
        if (bilingual && option.labelRw) {
          return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(option.labelRw)} / ${escapeHtml(option.labelEn)}</option>`;
        }
        if (option.labelRw && option.labelEn) {
          return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(option.labelRw)} / ${escapeHtml(option.labelEn)}</option>`;
        }
        const label = option.label || option.labelEn || String(option);
        return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(label)}</option>`;
      }).join("")}
    </select>
  `;
}

function renderCategorySelect(name, selectedValue) {
  const selected = String(selectedValue || "").trim();
  const hasSelected = CATEGORY_OPTIONS.some((option) => option.value === selected);
  return `
    <select name="${escapeHtml(name)}">
      ${!hasSelected && selected ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(toLabel(selected))}</option>` : ""}
      ${CATEGORY_OPTIONS.map((option) => {
        const isSelected = option.value === selected ? "selected" : "";
        return `<option value="${escapeHtml(option.value)}" ${isSelected}>${escapeHtml(option.labelRw)} / ${escapeHtml(option.labelEn)}</option>`;
      }).join("")}
    </select>
  `;
}

function renderPlacementCheckboxes(selectedValues = []) {
  const selected = new Set(Array.isArray(selectedValues) ? selectedValues : []);
  return `
    <div class="pm-checkbox-grid pm-checkbox-grid--placement">
      ${PLACEMENT_OPTIONS.map((option) => {
        const checked = selected.has(option.value) ? "checked" : "";
        return `
          <label class="pm-check-card">
            <input type="checkbox" name="placement" value="${escapeHtml(option.value)}" ${checked} />
            <span class="pm-check-card-copy">
              <strong>${escapeHtml(option.labelRw)} / ${escapeHtml(option.labelEn)}</strong>
            </span>
          </label>
        `;
      }).join("")}
    </div>
  `;
}

function deriveInventoryStatus(quantity) {
  const value = Math.max(0, Math.floor(toNumber(quantity, 0)));
  if (value <= 0) return { key: "out_of_stock", rw: "Nta Stock Irimo", en: "Out of Stock" };
  if (value <= 5) return { key: "low_stock", rw: "Stock Nkeya", en: "Low Stock" };
  if (value <= 20) return { key: "limited_stock", rw: "Stock Nto Ihari", en: "Limited Stock" };
  return { key: "in_stock", rw: "Ihari", en: "In Stock" };
}

function collectDraftFromForm(form, draft) {
  const nextDraft = sanitizeDraft({ ...draft });
  const formData = new FormData(form);

  nextDraft.info = {
    ...nextDraft.info,
    name: String(formData.get("name") || nextDraft.info.name || ""),
    shortName: String(formData.get("shortName") ?? nextDraft.info.shortName ?? ""),
    category: String(formData.get("category") || nextDraft.info.category || "general"),
    productType: String(formData.get("productType") || nextDraft.info.productType || "simple"),
    condition: String(formData.get("condition") || nextDraft.info.condition || "new"),
    brand: String(formData.get("brand") ?? nextDraft.info.brand ?? ""),
    manufacturer: String(formData.get("manufacturer") ?? nextDraft.info.manufacturer ?? ""),
    countryOfOrigin: String(formData.get("countryOfOrigin") ?? nextDraft.info.countryOfOrigin ?? ""),
    tags: String(formData.get("tags") ?? nextDraft.info.tags ?? ""),
    highlights: String(formData.get("highlights") ?? nextDraft.info.highlights ?? ""),
    warranty: String(formData.get("warranty") || nextDraft.info.warranty || "none"),
    warrantyCustom: String(formData.get("warrantyCustom") ?? nextDraft.info.warrantyCustom ?? ""),
    featuredProduct: formData.get("featuredProduct") === "on",
    visibility: String(formData.get("visibility") || nextDraft.info.visibility || "both"),
    placement: formData.getAll("placement").map((entry) => String(entry || "").trim()).filter(Boolean),
    positionMode: String(formData.get("positionMode") || nextDraft.info.positionMode || "automatic"),
    priorityScore: String(formData.get("priorityScore") ?? nextDraft.info.priorityScore ?? "50"),
    publishStatus: String(formData.get("publishStatus") || nextDraft.info.publishStatus || "active")
  };

  const longDescription = String(formData.get("longDescription") ?? nextDraft.description?.longDescription ?? "");
  nextDraft.description = {
    shortDescription: String(formData.get("shortDescription") ?? nextDraft.description?.shortDescription ?? ""),
    longDescription,
    description: longDescription
  };

  nextDraft.pricing = {
    ...nextDraft.pricing,
    costPrice: String(formData.get("costPrice") ?? nextDraft.pricing.costPrice ?? ""),
    originalPrice: String(formData.get("originalPrice") ?? nextDraft.pricing.originalPrice ?? ""),
    sellingPrice: String(formData.get("sellingPrice") ?? nextDraft.pricing.sellingPrice ?? "")
  };

  const variantsEnabled = formData.get("variantsEnabled") === "on";
  const colorVariantEntries = collectColorVariantsFromForm(form);
  const variantTotal = computeProductTotalStock(colorVariantEntries, 0);
  const quantity = variantsEnabled && colorVariantEntries.length
    ? String(variantTotal)
    : String(Math.max(0, Math.floor(toNumber(formData.get("quantity"), toNumber(nextDraft.inventory.quantity, 0)))));
  const category = String(nextDraft.info?.category || "general").toLowerCase();
  const attributeKeys = CATEGORY_ATTRIBUTE_CONFIG[category] || [];
  const attributes = {};
  attributeKeys.forEach((key) => {
    attributes[key] = String(formData.get(`attr_${key}`) ?? nextDraft.inventory.attributes?.[key] ?? "").trim();
  });
  nextDraft.inventory = {
    ...nextDraft.inventory,
    sku: String(formData.get("sku") ?? nextDraft.inventory.sku ?? ""),
    quantity,
    stockStatus: inferStockStatus(quantity),
    variantsEnabled,
    sizes: [],
    customSizes: nextDraft.inventory.customSizes || [],
    attributes,
    variants: [],
    colorVariants: colorVariantEntries
  };

  nextDraft.seo = {
    ...nextDraft.seo,
    metaTitle: String(formData.get("metaTitle") ?? nextDraft.seo.metaTitle ?? ""),
    metaDescription: String(formData.get("metaDescription") ?? nextDraft.seo.metaDescription ?? ""),
    slug: String(formData.get("slug") ?? nextDraft.seo.slug ?? ""),
    slugManual: true
  };

  nextDraft.media.pendingMainFile = Boolean(pendingMainFile);
  nextDraft.media.pendingGalleryCount = pendingGalleryEntries.length;
  return sanitizeDraft(nextDraft);
}

function renderExistingImages(draft) {
  const originals = collectOriginalImagesForDisplay(draft);
  if (!originals.length) {
    return `
      <div class="pm-edit-originals pm-edit-originals--empty">
        <p>No original product images were found on this product.</p>
      </div>
    `;
  }

  return `
    <div class="pm-edit-originals" data-original-images>
      <header>
        <h3>Existing original images</h3>
        <p>${originals.length} original image${originals.length === 1 ? "" : "s"} loaded from this product. They stay unless you remove or replace them.</p>
      </header>
      <div class="pm-edit-originals-grid">
        ${originals.map((entry, index) => `
          <figure class="pm-edit-original-item ${entry.role === "main" ? "is-main" : ""}">
            <img src="${escapeHtml(entry.url)}" alt="${entry.role === "main" ? "Main product image" : `Gallery image ${index}`}" loading="lazy" />
            <figcaption>${entry.role === "main" ? "Main image" : `Extra image ${index}`}</figcaption>
          </figure>
        `).join("")}
      </div>
    </div>
  `;
}

function renderMediaSection(draft) {
  const media = draft.media || {};
  const mainPreview = pendingMainPreviewUrl || media.mainImage || FALLBACK_IMAGE;
  const savedGallery = (media.gallery || []).map((url, index) => ({
    url,
    removeKey: `saved:${index}`
  }));
  const pendingGallery = pendingGalleryEntries.map((entry, index) => ({
    url: entry.previewUrl,
    removeKey: `pending:${index}`
  }));
  const galleryItems = [...savedGallery, ...pendingGallery];
  const hasMain = Boolean(pendingMainFile || media.mainImage);

  return `
    <section class="pm-form-section pm-edit-media">
      <header class="pm-form-section-head">
        <h3 class="pm-form-section-title">
          <span class="pm-section-rw">Amafoto</span>
          <span class="pm-section-sep">/</span>
          <span class="pm-section-en">Product Images</span>
        </h3>
        <p class="pm-form-section-subtitle">Original images are shown first. Leave them untouched to keep them exactly as they are.</p>
      </header>
      ${renderExistingImages(draft)}
      <div class="pm-media-layout">
        <section class="pm-upload-card">
          <h3>Replace main image</h3>
          <div class="pm-dropzone ${hasMain ? "has-file" : ""}" data-drop-main>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden data-main-input />
            <img src="${escapeHtml(mainPreview)}" alt="Main product preview" class="pm-main-preview" data-main-preview />
            <div class="pm-dropzone-copy">
              <strong>Replace only if you want a new main image</strong>
              <span>JPG, PNG, WEBP, GIF, AVIF — up to 5MB</span>
            </div>
            ${hasMain ? `<button type="button" class="pm-btn pm-btn-danger" data-remove-main>Remove / Kuraho</button>` : ""}
          </div>
        </section>
        <section class="pm-upload-card">
          <h3>Add or remove extra images</h3>
          <div class="pm-dropzone" data-drop-gallery>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple hidden data-gallery-input />
            <div class="pm-dropzone-copy">
              <strong>Drop additional original images here</strong>
              <span>Existing extras stay unless you remove them</span>
            </div>
          </div>
          <div class="pm-gallery-grid" data-gallery-grid>
            ${galleryItems.map((item, index) => `
              <figure class="pm-gallery-item">
                <img src="${escapeHtml(item.url)}" alt="Gallery image ${index + 1}" loading="lazy" />
                <div class="pm-gallery-item-actions">
                  <button type="button" class="pm-gallery-replace" data-replace-gallery="${escapeHtml(item.removeKey)}" aria-label="Replace image">Replace</button>
                  <button type="button" class="pm-gallery-remove" data-remove-gallery="${escapeHtml(item.removeKey)}" aria-label="Remove image">&times;</button>
                </div>
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden data-replace-gallery-input="${escapeHtml(item.removeKey)}" />
              </figure>
            `).join("")}
          </div>
        </section>
      </div>
      <div class="pm-upload-progress ${uploadProgress.message ? "is-visible" : ""}" data-upload-progress>
        <div class="pm-upload-progress-bar" style="width: ${uploadProgress.percent ?? 0}%"></div>
        <span>${escapeHtml(uploadProgress.message || "Images locked until you change them")}</span>
      </div>
    </section>
  `;
}

function renderEditorMarkup(draft) {
  const info = draft.info || {};
  const description = draft.description || {};
  const pricing = draft.pricing || {};
  const inventory = draft.inventory || {};
  const seo = draft.seo || {};
  const productId = String(draft.productId || draft.savedProductId || "").trim();
  const category = String(info.category || "general").toLowerCase();
  const sizePresets = getSizeOptionsForCategory(category);
  const colorVariants = Array.isArray(inventory.colorVariants) ? inventory.colorVariants : [];
  const totalStock = computeProductTotalStock(
    colorVariants,
    Math.max(0, Math.floor(toNumber(inventory.quantity, 0)))
  );
  const hasColorVariants = Boolean(inventory.variantsEnabled && colorVariants.length);
  const quantityValue = hasColorVariants ? totalStock : Math.max(0, Math.floor(toNumber(inventory.quantity, 0)));
  const status = deriveInventoryStatus(quantityValue);
  const activeAttributes = CATEGORY_ATTRIBUTE_CONFIG[category] || [];
  const summary = computeProductDiscount(pricing);
  const autoSeo = buildAutoSeo(info, description, info.brand);
  const feedbackHtml = workflowFeedback.message
    ? `<div class="pm-alert pm-alert-${escapeHtml(workflowFeedback.tone || "neutral")}">${escapeHtml(workflowFeedback.message)}</div>`
    : "";

  const attributeFields = activeAttributes.map((key) => {
    const [rw, en] = INVENTORY_ATTRIBUTE_LABELS[key] || [toLabel(key), toLabel(key)];
    return renderBilingualField(
      rw,
      en,
      `<input type="text" name="attr_${escapeHtml(key)}" value="${escapeHtml(inventory.attributes?.[key] || "")}" placeholder="${escapeHtml(en)}" />`
    );
  }).join("");

  return `
    <div class="pm-shell pm-edit-shell" data-product-editor>
      <section class="pm-hero card pm-hero-compact">
        <div class="pm-hero-copy">
          <p class="pm-kicker">Hindura Product / Edit Product</p>
          <h1>${escapeHtml(info.name || "Edit Product")}</h1>
          <p>Update this existing product. Fields you do not change, including original images, stay as they are.</p>
        </div>
        <div class="pm-hero-actions">
          <a class="pm-btn pm-btn-secondary" href="#/products">Back to Products</a>
          ${productId ? `<a class="pm-btn pm-btn-ghost" href="${buildStorefrontProductUrl(productId)}" target="_blank" rel="noopener">View Product</a>` : ""}
        </div>
      </section>
      ${feedbackHtml}
      <form class="pm-edit-form" data-product-edit-form novalidate>
        ${renderFormSection(
          "Amakuru y'ibanze",
          "Basic Information",
          "Change only the fields you need. Everything else stays on this product.",
          `
            ${renderBilingualField("Izina rya Product", "Product Name", `<input type="text" name="name" value="${escapeHtml(info.name)}" required />`, "", "pm-field--span-2")}
            ${renderBilingualField("Izina Rigufi", "Short Product Name", `<input type="text" name="shortName" value="${escapeHtml(info.shortName)}" />`)}
            ${renderBilingualField("Icyiciro", "Category", renderCategorySelect("category", info.category), "", "pm-field--required")}
            ${renderBilingualField("Ikirango", "Brand", `<input type="text" name="brand" value="${escapeHtml(info.brand)}" />`)}
            ${renderBilingualField("Ubwoko", "Product Type", renderOptionSelect("productType", PRODUCT_TYPE_OPTIONS, info.productType, true))}
            ${renderBilingualField("Imiterere", "Condition", renderOptionSelect("condition", PRODUCT_CONDITION_OPTIONS, info.condition, true))}
            ${renderBilingualField("Uruganda", "Manufacturer", `<input type="text" name="manufacturer" value="${escapeHtml(info.manufacturer)}" />`)}
            ${renderBilingualField("Igihugu", "Country of Origin", `
              <select name="countryOfOrigin">
                <option value="">Select country</option>
                ${!COUNTRY_OF_ORIGIN_OPTIONS.includes(info.countryOfOrigin) && info.countryOfOrigin
                  ? `<option value="${escapeHtml(info.countryOfOrigin)}" selected>${escapeHtml(info.countryOfOrigin)}</option>`
                  : ""}
                ${COUNTRY_OF_ORIGIN_OPTIONS.map((country) => `<option value="${escapeHtml(country)}" ${country === info.countryOfOrigin ? "selected" : ""}>${escapeHtml(country)}</option>`).join("")}
              </select>
            `)}
            ${renderBilingualField("Tags", "Tags", `<input type="text" name="tags" value="${escapeHtml(info.tags)}" />`)}
            ${renderBilingualField("Iby'ingenzi", "Highlights", `<input type="text" name="highlights" value="${escapeHtml(info.highlights)}" />`)}
            ${renderBilingualField("Garanti", "Warranty", renderOptionSelect("warranty", WARRANTY_OPTIONS, info.warranty, true))}
            ${renderBilingualField("Garanti Yihariye", "Custom Warranty", `<input type="text" name="warrantyCustom" value="${escapeHtml(info.warrantyCustom)}" ${info.warranty === "custom" ? "" : "disabled"} />`, "", info.warranty === "custom" ? "" : "pm-field--conditional is-hidden")}
          `
        )}

        ${renderFormSection(
          "Ibiciro",
          "Pricing",
          "Changing price only will not touch images, stock, or other fields.",
          `
            ${renderBilingualField("Igiciro cyo Kugura", "Cost Price", `<input type="number" min="0" step="1" name="costPrice" value="${escapeHtml(pricing.costPrice)}" />`)}
            ${renderBilingualField("Igiciro cy'Imbere", "Original Price", `<input type="number" min="0" step="1" name="originalPrice" value="${escapeHtml(pricing.originalPrice)}" data-pricing-original />`)}
            ${renderBilingualField("Igiciro cyo Kugurisha", "Selling Price", `<input type="number" min="0" step="1" name="sellingPrice" value="${escapeHtml(pricing.sellingPrice)}" required data-pricing-selling />`, "", "pm-field--required")}
          `,
          `<aside class="pm-pricing-preview card" data-pricing-preview>
            <div class="pm-pricing-preview-stage" data-pricing-preview-stage>
              ${renderAdminStorefrontPreview(summary, pricing.currency || "RWF", info.shortName || info.name || "Product")}
            </div>
          </aside>`
        )}

        <section class="pm-form-section">
          <header class="pm-form-section-head">
            <h3 class="pm-form-section-title">
              <span class="pm-section-rw">Ububiko</span>
              <span class="pm-section-sep">/</span>
              <span class="pm-section-en">Inventory</span>
            </h3>
            <p class="pm-form-section-subtitle">Changing stock only keeps images, price, and description unchanged.</p>
          </header>
          <div class="pm-form-grid">
            ${renderBilingualField("SKU", "SKU", `<input type="text" name="sku" value="${escapeHtml(inventory.sku || "")}" />`)}
            ${renderBilingualField("Umubare wa Stock", "Stock Quantity", `<input type="number" min="0" step="1" name="quantity" value="${escapeHtml(String(quantityValue))}" ${hasColorVariants ? "readonly" : ""} required />`, hasColorVariants ? "Calculated from color sizes." : "", "pm-field--required")}
            <div class="pm-field">
              <span class="pm-field-label pm-field-label--bilingual"><span class="pm-field-label-rw">Imiterere ya Stock</span><span class="pm-field-label-sep">/</span><span class="pm-field-label-en">Stock Status</span></span>
              <div class="pm-stock-badge pm-stock-badge--${escapeHtml(status.key)}" data-stock-status-badge>${escapeHtml(status.rw)} / ${escapeHtml(status.en)}</div>
            </div>
          </div>
          ${renderColorInventorySection({ ...inventory, colorVariants }, sizePresets)}
          ${activeAttributes.length ? `
            <div class="pm-form-grid">
              ${attributeFields}
            </div>
          ` : ""}
        </section>

        ${renderFormSection(
          "Ibisobanuro",
          "Description",
          "Changing description only will not remove images or other product data.",
          `
            ${renderBilingualField("Ibisobanuro Bigufi", "Short Description", `<textarea name="shortDescription" rows="4" required>${escapeHtml(description.shortDescription)}</textarea>`, "", "pm-field--span-2 pm-field--required")}
            ${renderBilingualField("Ibisobanuro Birambuye", "Long Description", `<textarea name="longDescription" rows="8">${escapeHtml(description.longDescription || description.description)}</textarea>`, "", "pm-field--span-2")}
          `
        )}

        ${renderMediaSection(draft)}

        ${renderFormSection(
          "Gusohora",
          "Publishing",
          "Visibility, placement, and status for this existing product.",
          `
            ${renderBilingualField("Aho Igaragara", "Visibility", renderOptionSelect("visibility", VISIBILITY_OPTIONS, info.visibility, true), "", "pm-field--required")}
            ${renderBilingualField("Ibice", "Product Placement", renderPlacementCheckboxes(Array.isArray(info.placement) ? info.placement : []), "", "pm-field--span-2")}
            ${renderBilingualField("Aho Ihagaze", "Product Position", renderOptionSelect("positionMode", POSITION_MODE_OPTIONS, info.positionMode || "automatic", true))}
            ${renderBilingualField("Priority Score", "Priority Score", `
              <div class="pm-priority-field">
                <input type="number" min="0" max="100" step="1" name="priorityScore" value="${escapeHtml(String(info.priorityScore ?? "50"))}" required />
                <div class="pm-priority-presets">
                  ${PRIORITY_SCORE_PRESETS.map((preset) => `
                    <button type="button" class="pm-priority-preset" data-priority-preset="${preset.value}">${escapeHtml(String(preset.value))}</button>
                  `).join("")}
                </div>
              </div>
            `)}
            ${renderBilingualField("Product Yihariye", "Featured Product", `
              <label class="pm-check pm-check-inline">
                <input type="checkbox" name="featuredProduct" ${info.featuredProduct ? "checked" : ""} />
                <span>Show as featured product</span>
              </label>
            `)}
            ${renderBilingualField("Imiterere", "Product Status", renderOptionSelect("publishStatus", PRODUCT_STATUS_OPTIONS, info.publishStatus || "active", true))}
            ${renderBilingualField("Meta Title", "Meta Title", `<input type="text" name="metaTitle" value="${escapeHtml(seo.metaTitle || autoSeo.metaTitle)}" />`)}
            ${renderBilingualField("Meta Description", "Meta Description", `<textarea name="metaDescription" rows="3">${escapeHtml(seo.metaDescription || autoSeo.metaDescription)}</textarea>`, "", "pm-field--span-2")}
            ${renderBilingualField("Slug", "Slug", `<input type="text" name="slug" value="${escapeHtml(seo.slug || autoSeo.slug)}" />`)}
          `
        )}

        <div class="pm-edit-actions">
          <button type="submit" class="pm-btn pm-btn-primary" data-save-product ${isSaving ? "disabled" : ""}>
            ${isSaving ? "Saving..." : "Save Product Update"}
          </button>
          <a class="pm-btn pm-btn-ghost" href="#/products">Cancel</a>
        </div>
      </form>
    </div>
  `;
}

function renderSuccessState(savedProduct) {
  const catalogId = savedProduct?.id || savedProduct?.catalogId || activeDraft.savedProductId;
  return `
    <div class="pm-shell pm-edit-shell" data-product-editor>
      <section class="pm-success card">
        <div class="pm-success-icon" aria-hidden="true">✓</div>
        <h2>Product updated successfully.</h2>
        <p>Only the fields you changed were updated. Untouched product information, including existing original images, was kept.</p>
        <div class="pm-success-actions">
          ${catalogId ? `<a class="pm-btn pm-btn-primary" href="${buildStorefrontProductUrl(catalogId)}" target="_blank" rel="noopener">View Product</a>` : ""}
          <a class="pm-btn pm-btn-secondary" href="#/products">Back to Products</a>
          ${catalogId ? `<a class="pm-btn pm-btn-ghost" href="${buildEditHash(catalogId)}" data-continue-editing>Continue Editing</a>` : ""}
          <a class="pm-btn pm-btn-ghost" href="${buildCreateHash("info")}">Add New Product</a>
        </div>
      </section>
    </div>
  `;
}

function rerenderEditor(container) {
  if (saveSuccess) {
    container.innerHTML = renderSuccessState(saveSuccess);
    bindSuccessActions(container);
    return;
  }
  container.innerHTML = renderEditorMarkup(activeDraft);
  bindEditor(container);
}

function persistFormThenRerender(container, form) {
  if (form) {
    activeDraft = collectDraftFromForm(form, activeDraft);
  }
  rerenderEditor(container);
}

function bindDropzone(dropzone, input, onFiles) {
  if (!dropzone || !input) {
    return;
  }

  dropzone.addEventListener("click", (event) => {
    if (event.target.closest("[data-remove-main], [data-remove-gallery], button")) {
      return;
    }
    input.click();
  });

  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("is-dragover");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("is-dragover");
  });

  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-dragover");
    const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith("image/"));
    if (files.length) {
      onFiles(files);
    }
  });

  input.addEventListener("change", () => {
    const files = Array.from(input.files || []);
    if (files.length) {
      onFiles(files);
    }
    input.value = "";
  });
}

function bindSuccessActions(container) {
  container.querySelector("[data-continue-editing]")?.addEventListener("click", (event) => {
    event.preventDefault();
    const productId = String(saveSuccess?.id || saveSuccess?.catalogId || activeDraft.savedProductId || "").trim();
    saveSuccess = null;
    if (productId) {
      window.location.hash = buildEditHash(productId);
    }
    void (async () => {
      if (!productId) {
        rerenderEditor(container);
        return;
      }
      try {
        const product = await getProductById(productId);
        if (!product) {
          throw new Error("The updated product could not be reloaded.");
        }
        mountProductEditor(container, product);
      } catch (error) {
        setFeedback("danger", error?.message || "The updated product could not be reloaded for editing.");
        rerenderEditor(container);
      }
    })();
  });
}

function bindInfoEnhancements(form) {
  const warranty = form.querySelector('[name="warranty"]');
  const warrantyCustom = form.querySelector('[name="warrantyCustom"]');
  const warrantyField = warrantyCustom?.closest(".pm-field");

  function syncWarrantyCustom() {
    if (!warranty || !warrantyCustom || !warrantyField) {
      return;
    }
    const isCustom = String(warranty.value || "") === "custom";
    warrantyCustom.disabled = !isCustom;
    warrantyField.classList.toggle("is-hidden", !isCustom);
  }

  warranty?.addEventListener("change", syncWarrantyCustom);
  syncWarrantyCustom();
}

function bindPricingEnhancements(form) {
  const originalInput = form.querySelector("[data-pricing-original]");
  const sellingInput = form.querySelector("[data-pricing-selling]");
  const previewStage = form.querySelector("[data-pricing-preview-stage]");
  const productName = activeDraft.info?.shortName || activeDraft.info?.name || "Product";

  function syncDiscountPreview() {
    if (!previewStage) {
      return;
    }
    const summary = computeProductDiscount({
      originalPrice: originalInput?.value || "",
      sellingPrice: sellingInput?.value || ""
    });
    previewStage.innerHTML = renderAdminStorefrontPreview(summary, "RWF", productName);
  }

  originalInput?.addEventListener("input", syncDiscountPreview);
  sellingInput?.addEventListener("input", syncDiscountPreview);
  syncDiscountPreview();
}

function bindInventoryEnhancements(form, container) {
  const quantityInput = form.querySelector('[name="quantity"]');
  const statusBadge = form.querySelector("[data-stock-status-badge]");
  const totalStockLabel = form.querySelector("[data-total-product-stock]");
  const variantsEnabled = form.querySelector('[name="variantsEnabled"]');
  const colorStack = form.querySelector("[data-color-variant-stack]");
  const addColorButton = form.querySelector("[data-add-color]");

  function syncStockUi() {
    const enabled = Boolean(variantsEnabled?.checked);
    const cards = Array.from(form.querySelectorAll(".pm-color-variant-card"));
    const totals = cards.map((card) => {
      const rows = Array.from(card.querySelectorAll('[name="colorSizeStock"]'));
      return rows.reduce((sum, input) => sum + Math.max(0, Math.floor(toNumber(input.value, 0))), 0);
    });
    const hasColors = enabled && totals.length > 0;
    const total = hasColors
      ? totals.reduce((sum, value) => sum + value, 0)
      : Math.max(0, Math.floor(toNumber(quantityInput?.value, 0)));

    cards.forEach((card, index) => {
      const totalField = card.querySelector(`[data-color-total-stock="${index}"]`);
      if (totalField) {
        totalField.value = String(totals[index] || 0);
      }
    });

    if (quantityInput && hasColors) {
      quantityInput.value = String(total);
      quantityInput.readOnly = true;
    } else if (quantityInput) {
      quantityInput.readOnly = false;
    }

    if (statusBadge) {
      const status = deriveInventoryStatus(total);
      statusBadge.className = `pm-stock-badge pm-stock-badge--${status.key}`;
      statusBadge.textContent = `${status.rw} / ${status.en}`;
    }
    if (totalStockLabel) {
      totalStockLabel.textContent = String(total);
    }
  }

  function syncVariantState() {
    const enabled = Boolean(variantsEnabled?.checked);
    colorStack?.classList.toggle("is-disabled", !enabled);
    if (addColorButton) {
      addColorButton.disabled = !enabled;
    }
  }

  quantityInput?.addEventListener("input", syncStockUi);
  form.querySelectorAll('[name="colorSizeStock"], [name="colorSize"]').forEach((input) => {
    input.addEventListener("input", syncStockUi);
  });
  variantsEnabled?.addEventListener("change", () => {
    syncVariantState();
    syncStockUi();
  });
  syncVariantState();
  syncStockUi();

  form.querySelector("[data-add-color]")?.addEventListener("click", () => {
    activeDraft = collectDraftFromForm(form, activeDraft);
    activeDraft.inventory.colorVariants = [
      ...(activeDraft.inventory.colorVariants || []),
      {
        clientKey: createColorClientKey(),
        colorName: "",
        image: "",
        imageStoragePath: "",
        sizes: [{ size: "", stock: "0" }]
      }
    ];
    activeDraft.inventory.variantsEnabled = true;
    rerenderEditor(container);
  });

  form.querySelectorAll("[data-remove-color]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.getAttribute("data-remove-color"));
      activeDraft = collectDraftFromForm(form, activeDraft);
      const colors = [...(activeDraft.inventory.colorVariants || [])];
      const removed = colors[index];
      if (removed?.imageStoragePath || removed?.image) {
        removeColorVariantImage(removed);
      }
      activeDraft.inventory.colorVariants = colors.filter((_entry, entryIndex) => entryIndex !== index);
      rerenderEditor(container);
    });
  });

  form.querySelectorAll("[data-add-size]").forEach((button) => {
    button.addEventListener("click", () => {
      const colorIndex = Number(button.getAttribute("data-add-size"));
      activeDraft = collectDraftFromForm(form, activeDraft);
      const colors = [...(activeDraft.inventory.colorVariants || [])];
      const target = colors[colorIndex];
      if (!target) {
        return;
      }
      target.sizes = [...(target.sizes || []), { size: "", stock: "0" }];
      activeDraft.inventory.colorVariants = colors;
      rerenderEditor(container);
    });
  });

  form.querySelectorAll("[data-add-preset-size]").forEach((button) => {
    button.addEventListener("click", () => {
      const colorIndex = Number(button.getAttribute("data-add-preset-size"));
      const presetSize = String(button.getAttribute("data-preset-size") || "").trim();
      if (!presetSize) {
        return;
      }
      activeDraft = collectDraftFromForm(form, activeDraft);
      const colors = [...(activeDraft.inventory.colorVariants || [])];
      const target = colors[colorIndex];
      if (!target) {
        return;
      }
      const existing = new Set((target.sizes || []).map((row) => String(row.size || "").trim()));
      if (existing.has(presetSize)) {
        return;
      }
      target.sizes = [...(target.sizes || []), { size: presetSize, stock: "0" }];
      activeDraft.inventory.colorVariants = colors;
      rerenderEditor(container);
    });
  });

  form.querySelectorAll("[data-remove-size]").forEach((button) => {
    button.addEventListener("click", () => {
      const [colorIndexRaw, sizeIndexRaw] = String(button.getAttribute("data-remove-size") || "").split(":");
      const colorIndex = Number(colorIndexRaw);
      const sizeIndex = Number(sizeIndexRaw);
      activeDraft = collectDraftFromForm(form, activeDraft);
      const colors = [...(activeDraft.inventory.colorVariants || [])];
      const target = colors[colorIndex];
      if (!target) {
        return;
      }
      target.sizes = (target.sizes || []).filter((_entry, entryIndex) => entryIndex !== sizeIndex);
      activeDraft.inventory.colorVariants = colors;
      rerenderEditor(container);
    });
  });

  bindColorVariantImageUploads(form, container);
}

async function uploadColorImageForCard(form, container, colorIndex, file) {
  const validationError = validateImageFile(file);
  if (validationError) {
    setFeedback("danger", validationError);
    rerenderEditor(container);
    return;
  }

  activeDraft = collectDraftFromForm(form, activeDraft);
  const colors = [...(activeDraft.inventory.colorVariants || [])];
  const color = colors[colorIndex];
  if (!color) {
    return;
  }

  const card = form.querySelector(`.pm-color-variant-card[data-color-index="${colorIndex}"]`);
  const statusEl = card?.querySelector(`[data-color-upload-status="${colorIndex}"]`);
  if (statusEl) {
    statusEl.textContent = "Uploading to server...";
  }

  try {
    const uploaded = await uploadColorVariantImage(file, color.imageStoragePath || color.image);
    colors[colorIndex] = {
      ...color,
      image: uploaded.image,
      imageStoragePath: uploaded.imageStoragePath
    };
    activeDraft.inventory.colorVariants = colors;
    setFeedback("success", `${color.colorName || "Color"} image uploaded successfully.`);
    rerenderEditor(container);
  } catch (error) {
    setFeedback("danger", error?.message || "Color image upload failed.");
    rerenderEditor(container);
  }
}

function bindColorVariantImageUploads(form, container) {
  form.querySelectorAll("[data-color-drop]").forEach((dropzone) => {
    const colorIndex = Number(dropzone.getAttribute("data-color-drop"));
    const input = dropzone.querySelector(`[data-color-input="${colorIndex}"]`);
    bindDropzone(dropzone, input, (files) => {
      const file = files[0];
      if (file) {
        void uploadColorImageForCard(form, container, colorIndex, file);
      }
    });
  });

  form.querySelectorAll("[data-replace-color-image]").forEach((button) => {
    button.addEventListener("click", () => {
      const colorIndex = Number(button.getAttribute("data-replace-color-image"));
      form.querySelector(`[data-color-input="${colorIndex}"]`)?.click();
    });
  });

  form.querySelectorAll("[data-remove-color-image]").forEach((button) => {
    button.addEventListener("click", () => {
      const colorIndex = Number(button.getAttribute("data-remove-color-image"));
      activeDraft = collectDraftFromForm(form, activeDraft);
      const colors = [...(activeDraft.inventory.colorVariants || [])];
      const color = colors[colorIndex];
      if (!color) {
        return;
      }
      colors[colorIndex] = removeColorVariantImage(color);
      activeDraft.inventory.colorVariants = colors;
      setFeedback("success", "Color image removed.");
      rerenderEditor(container);
    });
  });
}

function bindMediaEnhancements(form, container) {
  const mainInput = form.querySelector("[data-main-input]");
  const mainDropzone = form.querySelector("[data-drop-main]");
  bindDropzone(mainDropzone, mainInput, (files) => {
    const file = files[0];
    const validationError = validateImageFile(file);
    if (validationError) {
      setFeedback("danger", validationError);
      persistFormThenRerender(container, form);
      return;
    }
    if (pendingMainPreviewUrl) {
      URL.revokeObjectURL(pendingMainPreviewUrl);
    }
    pendingMainFile = file;
    pendingMainPreviewUrl = URL.createObjectURL(file);
    markMediaTouched();
    persistFormThenRerender(container, form);
  });

  form.querySelector("[data-remove-main]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (pendingMainPreviewUrl) {
      URL.revokeObjectURL(pendingMainPreviewUrl);
    }
    pendingMainFile = null;
    pendingMainPreviewUrl = "";
    markMediaTouched();
    activeDraft = collectDraftFromForm(form, activeDraft);
    activeDraft.media = removeMainImage(activeDraft);
    rerenderEditor(container);
  });

  const galleryInput = form.querySelector("[data-gallery-input]");
  const galleryDropzone = form.querySelector("[data-drop-gallery]");
  bindDropzone(galleryDropzone, galleryInput, (files) => {
    const accepted = [];
    for (const file of files) {
      const validationError = validateImageFile(file);
      if (validationError) {
        setFeedback("danger", validationError);
        continue;
      }
      accepted.push({
        file,
        previewUrl: URL.createObjectURL(file)
      });
    }
    if (!accepted.length) {
      persistFormThenRerender(container, form);
      return;
    }
    pendingGalleryEntries = [...pendingGalleryEntries, ...accepted];
    markMediaTouched();
    persistFormThenRerender(container, form);
  });

  form.querySelectorAll("[data-remove-gallery]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const key = String(button.getAttribute("data-remove-gallery") || "");
      const [kind, indexRaw] = key.split(":");
      const index = Number(indexRaw);
      markMediaTouched();
      activeDraft = collectDraftFromForm(form, activeDraft);
      if (kind === "pending") {
        const removed = pendingGalleryEntries[index];
        if (removed?.previewUrl) {
          URL.revokeObjectURL(removed.previewUrl);
        }
        pendingGalleryEntries = pendingGalleryEntries.filter((_entry, entryIndex) => entryIndex !== index);
      } else {
        activeDraft.media = removeGalleryItem(activeDraft, index);
      }
      rerenderEditor(container);
    });
  });

  form.querySelectorAll("[data-replace-gallery]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const key = String(button.getAttribute("data-replace-gallery") || "");
      form.querySelector(`[data-replace-gallery-input="${key}"]`)?.click();
    });
  });

  form.querySelectorAll("[data-replace-gallery-input]").forEach((input) => {
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      const key = String(input.getAttribute("data-replace-gallery-input") || "");
      input.value = "";
      if (!file) {
        return;
      }
      const validationError = validateImageFile(file);
      if (validationError) {
        setFeedback("danger", validationError);
        persistFormThenRerender(container, form);
        return;
      }
      const [kind, indexRaw] = key.split(":");
      const index = Number(indexRaw);
      markMediaTouched();
      activeDraft = collectDraftFromForm(form, activeDraft);
      if (kind === "pending") {
        const previous = pendingGalleryEntries[index];
        if (previous?.previewUrl) {
          URL.revokeObjectURL(previous.previewUrl);
        }
        pendingGalleryEntries = pendingGalleryEntries.map((entry, entryIndex) => (
          entryIndex === index
            ? { file, previewUrl: URL.createObjectURL(file) }
            : entry
        ));
      } else {
        activeDraft.media = removeGalleryItem(activeDraft, index);
        pendingGalleryEntries = [
          ...pendingGalleryEntries,
          { file, previewUrl: URL.createObjectURL(file) }
        ];
      }
      rerenderEditor(container);
    });
  });
}

function bindEditor(container) {
  const form = container.querySelector("[data-product-edit-form]");
  if (!form) {
    return;
  }

  form.querySelectorAll("[data-priority-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = form.querySelector('[name="priorityScore"]');
      if (input) {
        input.value = String(button.getAttribute("data-priority-preset") || "50");
      }
    });
  });

  bindInfoEnhancements(form);
  bindPricingEnhancements(form);
  bindInventoryEnhancements(form, container);
  bindMediaEnhancements(form, container);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveProductUpdate(container, form);
  });
}

async function saveProductUpdate(container, form) {
  if (isSaving) {
    return;
  }

  activeDraft = collectDraftFromForm(form, activeDraft);
  const recoveryDraft = sanitizeDraft(activeDraft);
  const preserveExistingImages = !mediaTouched;
  const imagesChanged = mediaTouched;
  if (preserveExistingImages) {
    activeDraft.media = {
      ...activeDraft.media,
      ...mediaSnapshot,
      pendingMainFile: false,
      pendingGalleryCount: 0
    };
  }
  const validationOptions = {
    hasPendingMainImage: Boolean(pendingMainFile) || Boolean(activeDraft.media?.mainImage) || Boolean(mediaSnapshot.mainImage)
  };
  const errors = validateAllSteps(activeDraft, validationOptions);
  if (errors.length && !(preserveExistingImages && errors.every((entry) => /main product image/i.test(entry)))) {
    setFeedback("danger", errors[0]);
    rerenderEditor(container);
    return;
  }

  isSaving = true;
  setFeedback("neutral", preserveExistingImages
    ? "Updating product. Existing original images will be kept."
    : "Uploading image changes, then updating the product...");
  rerenderEditor(container);

  try {
    let resolvedMedia = snapshotCanonicalMedia(activeDraft);
    if (preserveExistingImages) {
      resolvedMedia = { ...mediaSnapshot };
      activeDraft.media = {
        ...activeDraft.media,
        ...mediaSnapshot,
        pendingMainFile: false,
        pendingGalleryCount: 0
      };
    } else {
      uploadProgress = { message: "Uploading image changes...", percent: 20 };
      resolvedMedia = await resolveDraftMedia(
        activeDraft,
        pendingMainFile,
        pendingGalleryEntries.map((entry) => entry.file),
        (progress) => {
          uploadProgress = {
            message: progress.message || "Uploading image...",
            percent: progress.percent ?? uploadProgress.percent ?? 20
          };
        }
      );
      if (!isPersistableAssetUrl(resolvedMedia.mainImage) && mediaSnapshot.mainImage) {
        resolvedMedia.mainImage = mediaSnapshot.mainImage;
        resolvedMedia.mainImageStoragePath = mediaSnapshot.mainImageStoragePath;
      }
    }

    activeDraft.inventory = await resolveColorVariantImages(activeDraft.inventory);
    const payload = buildProductPayload(activeDraft, {
      mainImage: resolvedMedia.mainImage,
      mainImageStoragePath: resolvedMedia.mainImageStoragePath,
      gallery: resolvedMedia.gallery,
      galleryStoragePaths: resolvedMedia.galleryStoragePaths,
      preserveExistingImages,
      imagesChanged
    });

    const productId = String(activeDraft.productId || activeDraft.savedProductId || "").trim();
    if (!productId) {
      throw new Error("This editor can only update an existing product.");
    }

    const savedProduct = await updateProductAndSync(productId, payload, {
      onProgress: (progress) => {
        uploadProgress = { message: progress.message || "Saving product...", percent: progress.percent ?? 95 };
      }
    });

    const savedId = String(savedProduct?.id || savedProduct?.catalogId || "").trim();
    if (savedId && savedId !== productId) {
      throw new Error("Save did not update the original product. Reload and try again.");
    }

    const verified = await getProductById(productId);
    verifyReloadedProductUpdate({
      productId,
      beforeProduct: loadedProduct,
      reloadedProduct: verified,
      expectedPayload: payload,
      preserveExistingImages,
      expectedMedia: resolvedMedia
    });

    try {
      const storefrontResponse = await fetch(buildPublicProductApiUrl(productId), {
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      if (storefrontResponse.ok) {
        const storefrontPayload = await storefrontResponse.json();
        if (storefrontPayload?.product) {
          verifyReloadedProductUpdate({
            productId,
            beforeProduct: loadedProduct,
            reloadedProduct: storefrontPayload.product,
            preserveExistingImages,
            expectedMedia: resolvedMedia
          });
        }
      }
    } catch (_error) {
      // Admin reload is the source of truth if the public catalog is temporarily unavailable.
    }

    const refreshed = hydrateDraftFromProduct(verified);
    refreshed.productId = productId;
    refreshed.savedProductId = productId;
    refreshed.seo = { ...refreshed.seo, slugManual: true };
    activeDraft = refreshed;
    loadedProduct = verified;
    mediaSnapshot = snapshotCanonicalMedia(activeDraft);
    pendingMainFile = null;
    if (pendingMainPreviewUrl) {
      URL.revokeObjectURL(pendingMainPreviewUrl);
    }
    pendingMainPreviewUrl = "";
    pendingGalleryEntries.forEach((entry) => {
      if (entry?.previewUrl) {
        URL.revokeObjectURL(entry.previewUrl);
      }
    });
    pendingGalleryEntries = [];
    mediaTouched = false;
    saveSuccess = verified;
    isSaving = false;
    uploadProgress = { message: "", percent: null };
    workflowFeedback = { tone: "", message: "" };
    rerenderEditor(container);
  } catch (error) {
    isSaving = false;
    uploadProgress = { message: "", percent: null };
    saveSuccess = null;
    activeDraft = sanitizeDraft({
      ...recoveryDraft,
      media: preserveExistingImages ? { ...recoveryDraft.media, ...mediaSnapshot } : recoveryDraft.media
    });
    setFeedback("danger", error?.message || "Product update failed. Existing images were not supposed to change.");
    rerenderEditor(container);
  }
}

export function mountProductEditor(container, product) {
  resetEditorState();
  loadedProduct = product;
  const draft = hydrateDraftFromProduct(product);
  const productId = String(product?.id || product?.catalogId || "").trim();
  draft.productId = productId;
  draft.savedProductId = productId;
  draft.seo = { ...draft.seo, slugManual: true };
  activeDraft = draft;
  mediaSnapshot = snapshotCanonicalMedia(activeDraft);
  container.innerHTML = renderEditorMarkup(activeDraft);
  bindEditor(container);
}

export { collectOriginalImagesForDisplay, snapshotCanonicalMedia };
