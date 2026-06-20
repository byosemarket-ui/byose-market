import { createProductAndSync, updateProductAndSync } from "../../services/admin-data.service.js";
import {
  CATEGORY_OPTIONS,
  COUNTRY_OF_ORIGIN_OPTIONS,
  FALLBACK_IMAGE,
  FEATURED_FLAG_OPTIONS,
  PLACEMENT_OPTIONS,
  POSITION_MODE_OPTIONS,
  PRODUCT_CONDITION_OPTIONS,
  PRODUCT_TYPE_OPTIONS,
  SEO_SEARCH_VISIBILITY_OPTIONS,
  STOCK_STATUS_OPTIONS,
  VISIBILITY_OPTIONS,
  WARRANTY_OPTIONS,
  WIZARD_STEPS
} from "./constants.js";
import {
  clearDraft,
  createDefaultDraft,
  getSizeOptionsForCategory,
  hydrateDraftFromProduct,
  sanitizeDraft,
  writeDraft
} from "./draft.js";
import { buildProductPayload, validateAllSteps, validateStep } from "./payload.js";
import { removeGalleryItem, removeMainImage, resolveDraftMedia } from "./upload.js";
import {
  buildCreateHash,
  buildProductViewUrl,
  escapeHtml,
  formatCurrency,
  getWizardStep,
  slugify,
  toLabel,
  toNumber,
  validateImageFile
} from "./utils.js";

let activeDraft = createDefaultDraft();
let pendingMainFile = null;
let pendingMainPreviewUrl = "";
let pendingGalleryEntries = [];
let uploadProgress = { message: "", percent: null };
let workflowFeedback = { tone: "", message: "" };
let saveSuccess = null;
let isSaving = false;

function clearPendingMedia() {
  if (pendingMainPreviewUrl) {
    URL.revokeObjectURL(pendingMainPreviewUrl);
  }
  pendingGalleryEntries.forEach((entry) => {
    if (entry.previewUrl) {
      URL.revokeObjectURL(entry.previewUrl);
    }
  });
  pendingMainFile = null;
  pendingMainPreviewUrl = "";
  pendingGalleryEntries = [];
}

function setPendingMainFile(file) {
  if (pendingMainPreviewUrl) {
    URL.revokeObjectURL(pendingMainPreviewUrl);
  }
  pendingMainFile = file || null;
  pendingMainPreviewUrl = file ? URL.createObjectURL(file) : "";
}

function addPendingGalleryFiles(files = []) {
  files.forEach((file) => {
    pendingGalleryEntries.push({
      file,
      previewUrl: URL.createObjectURL(file)
    });
  });
}

function getPendingGalleryFiles() {
  return pendingGalleryEntries.map((entry) => entry.file).filter(Boolean);
}

function hasMainImageSelection(draft) {
  return Boolean(
    pendingMainFile
    || pendingMainPreviewUrl
    || draft?.media?.mainImage
  );
}

function getMainImageValidationOptions(draft) {
  return { hasPendingMainImage: hasMainImageSelection(draft) };
}

function traceWizard(stage, detail = {}) {
  console.debug("[ProductWizard]", stage, detail);
}

function warnWizardValidation(stage, detail = {}) {
  console.warn("[ProductWizard] Validation blocked", { stage, ...detail });
}

function setFeedback(tone, message) {
  workflowFeedback = { tone, message };
}

function getStepIndex(step) {
  return WIZARD_STEPS.findIndex((entry) => entry.id === step);
}

function renderStepNav(currentStep) {
  const currentIndex = getStepIndex(currentStep);
  return `
    <nav class="pm-steps" aria-label="Product creation steps">
      ${WIZARD_STEPS.map((step, index) => {
        const state = index < currentIndex ? "complete" : index === currentIndex ? "active" : "";
        return `
          <button type="button" class="pm-step ${state}" data-step-nav="${step.id}">
            <span class="pm-step-index">${index + 1}</span>
            <span class="pm-step-copy">
              <strong>${escapeHtml(step.label)}</strong>
              <small>${escapeHtml(step.short)}</small>
            </span>
          </button>
        `;
      }).join("")}
    </nav>
  `;
}

function renderField(label, inputHtml, hint = "") {
  return `
    <label class="pm-field">
      <span class="pm-field-label">${escapeHtml(label)}</span>
      ${inputHtml}
      ${hint ? `<small class="pm-field-hint">${escapeHtml(hint)}</small>` : ""}
    </label>
  `;
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
      ${fullWidthHtml}
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
        const label = option.label || option.labelEn || String(option);
        return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(label)}</option>`;
      }).join("")}
    </select>
  `;
}

function renderCheckboxGroup(name, options, selectedMap = {}) {
  return `
    <div class="pm-checkbox-grid">
      ${options.map((option) => {
        const checked = selectedMap[option.value] ? "checked" : "";
        return `
          <label class="pm-check pm-check-card">
            <input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(option.value)}" ${checked} />
            <span class="pm-check-card-copy">
              <strong>${escapeHtml(option.labelRw)} / ${escapeHtml(option.labelEn)}</strong>
            </span>
          </label>
        `;
      }).join("")}
    </div>
  `;
}

function renderPlacementGroup(selected = []) {
  const selectedSet = new Set(Array.isArray(selected) ? selected : []);
  return `
    <div class="pm-checkbox-grid pm-checkbox-grid--placement">
      ${PLACEMENT_OPTIONS.map((option) => {
        const checked = selectedSet.has(option.value) ? "checked" : "";
        return `
          <label class="pm-check pm-check-card">
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

function renderInfoStep(draft) {
  const info = draft.info || {};
  const featuredMap = {
    featuredHomepage: Boolean(info.featuredHomepage),
    featuredProducts: Boolean(info.featuredProducts),
    featuredBestSellers: Boolean(info.featuredBestSellers),
    featuredFreshPicks: Boolean(info.featuredFreshPicks)
  };
  const featuredOptions = FEATURED_FLAG_OPTIONS.map((entry) => ({
    ...entry,
    value: entry.value
  }));

  const identityFields = `
    ${renderBilingualField("Izina rya Product", "Product Name", `<input type="text" name="name" value="${escapeHtml(info.name)}" placeholder="e.g. Premium Leather Sneakers" required />`, "Full catalog name used across admin and product details.", "pm-field--span-2")}
    ${renderBilingualField("Izina Rigufi rya Product", "Short Product Name", `<input type="text" name="shortName" value="${escapeHtml(info.shortName)}" placeholder="e.g. Leather Sneakers" />`, "Used on product cards, cart, search, and mobile layouts.")}
    ${renderBilingualField("Icyiciro", "Category", renderOptionSelect("category", CATEGORY_OPTIONS, info.category), "Required marketplace category.", "pm-field--required")}
    ${renderBilingualField("Ubwoko bwa Product", "Product Type", renderOptionSelect("productType", PRODUCT_TYPE_OPTIONS, info.productType, true))}
    ${renderBilingualField("Imiterere ya Product", "Product Condition", renderOptionSelect("condition", PRODUCT_CONDITION_OPTIONS, info.condition, true))}
    ${renderBilingualField("Ikirango", "Brand", `<input type="text" name="brand" value="${escapeHtml(info.brand)}" placeholder="Brand name" />`)}
    ${renderBilingualField("Uruganda", "Manufacturer", `<input type="text" name="manufacturer" value="${escapeHtml(info.manufacturer)}" placeholder="Manufacturer name" />`, "Separate from brand when applicable.")}
    ${renderBilingualField("SKU", "SKU", `<input type="text" name="sku" value="${escapeHtml(info.sku)}" placeholder="Stock keeping unit" />`)}
    ${renderBilingualField("Igihugu Yakorewemo", "Country Of Origin", `
      <select name="countryOfOrigin">
        <option value="">Hitamo igihugu / Select country</option>
        ${COUNTRY_OF_ORIGIN_OPTIONS.map((country) => `<option value="${escapeHtml(country)}" ${country === info.countryOfOrigin ? "selected" : ""}>${escapeHtml(country)}</option>`).join("")}
      </select>
    `)}
  `;

  const discoveryFields = `
    ${renderBilingualField("Tags", "Tags", `<input type="text" name="tags" value="${escapeHtml(info.tags)}" placeholder="summer, sale, featured" />`, "Separate tags with commas.")}
    ${renderBilingualField("Amagambo yo Gushakisha", "Search Keywords", `<input type="text" name="searchKeywords" value="${escapeHtml(info.searchKeywords)}" placeholder="phone,samsung,android,5g" />`, "Boost search discovery with keyword phrases.")}
    ${renderBilingualField("Iby'ingenzi bya Product", "Product Highlights", `<input type="text" name="highlights" value="${escapeHtml(info.highlights)}" placeholder="Original Product, Waterproof, Fast Charging" />`, "Separate highlights with commas.")}
    ${renderBilingualField("Garanti", "Warranty", renderOptionSelect("warranty", WARRANTY_OPTIONS, info.warranty, true))}
    ${renderBilingualField("Garanti yihariye", "Custom Warranty", `<input type="text" name="warrantyCustom" value="${escapeHtml(info.warrantyCustom)}" placeholder="e.g. 18 months store warranty" ${info.warranty === "custom" ? "" : "disabled"} />`, "Required only when warranty is set to Custom.", info.warranty === "custom" ? "" : "pm-field--conditional is-hidden")}
    ${renderBilingualField("Kugaragara", "Visibility", renderOptionSelect("visibility", VISIBILITY_OPTIONS, info.visibility, true))}
  `;

  const featuredSection = `
    <div class="pm-form-section-block pm-form-section-block--full">
      <span class="pm-field-label pm-field-label--bilingual">
        <span class="pm-field-label-rw">Product Yihariye</span>
        <span class="pm-field-label-sep">/</span>
        <span class="pm-field-label-en">Featured Product</span>
      </span>
      ${renderCheckboxGroup("featuredFlags", featuredOptions.map((entry) => ({
        value: entry.value,
        labelRw: entry.labelRw,
        labelEn: entry.labelEn
      })), featuredMap)}
    </div>
  `;

  const placementSection = `
    <div class="pm-form-section-block pm-form-section-block--full">
      <span class="pm-field-label pm-field-label--bilingual">
        <span class="pm-field-label-rw">Aho Product Igaragara</span>
        <span class="pm-field-label-sep">/</span>
        <span class="pm-field-label-en">Product Placement</span>
      </span>
      ${renderPlacementGroup(info.placement)}
    </div>
  `;

  const positionFields = `
    ${renderBilingualField("Umwanya wa Product", "Product Position", renderOptionSelect("positionMode", POSITION_MODE_OPTIONS, info.positionMode, true), "Choose preset position or use automatic priority score.")}
    ${renderBilingualField("Amanota y'imbere", "Priority Score", `<input type="number" min="0" max="100" step="1" name="priorityScore" value="${escapeHtml(info.priorityScore || "50")}" ${info.positionMode && info.positionMode !== "automatic" ? "readonly" : ""} />`, "100 = Top, 50 = Middle, 10 = Bottom. Used when position is Automatic.")}
  `;

  const descriptionFields = `
    ${renderBilingualField("Ibisobanuro Bigufi", "Short Description", `<textarea name="shortDescription" rows="3" placeholder="Brief summary for cards, search, and homepage.">${escapeHtml(info.shortDescription)}</textarea>`, "Shown on product cards and search results.")}
    ${renderBilingualField("Ibisobanuro Birambuye", "Long Description", `<textarea name="longDescription" rows="6" placeholder="Detailed product story, features, materials, and benefits.">${escapeHtml(info.longDescription || info.description)}</textarea>`, "Shown on the product details page.", "pm-field--span-2")}
  `;

  return `
    <div class="pm-step-panel pm-step-panel--info">
      <header class="pm-step-header">
        <h2>Product Information</h2>
        <p>Amakuru y'ibanze y'igicuruzwa / Core marketplace product details for catalog, search, placement, and storefront display.</p>
      </header>

      ${renderFormSection("Amakuru y'ibanze", "Basic Identity", "Izina, icyiciro, ubwoko, imiterere, brand na SKU.", identityFields)}
      ${renderFormSection("Gushakisha no kumenyekana", "Discovery & Trust", "Tags, keywords, highlights, warranty na visibility.", discoveryFields, featuredSection)}
      ${renderFormSection("Aho product igaragara", "Placement & Ordering", "Hitamo aho product igaragara n'imiterere y'icyiciro.", placementSection + `<div class="pm-form-grid">${positionFields}</div>`)}
      ${renderFormSection("Ibisobanuro", "Descriptions", "Andika ibisobanuro bigufi n'ibirambuye.", descriptionFields)}
    </div>
  `;
}

function renderPricingStep(draft) {
  const pricing = draft.pricing || {};
  return `
    <div class="pm-step-panel">
      <header class="pm-step-header">
        <h2>Pricing</h2>
        <p>Set cost, selling price, discount display, and tax configuration.</p>
      </header>
      <div class="pm-form-grid">
        ${renderField("Cost Price", `<input type="number" min="0" step="1" name="costPrice" value="${escapeHtml(pricing.costPrice)}" placeholder="0" />`)}
        ${renderField("Selling Price *", `<input type="number" min="0" step="1" name="sellingPrice" value="${escapeHtml(pricing.sellingPrice)}" placeholder="0" required />`)}
        ${renderField("Discount Price", `<input type="number" min="0" step="1" name="discountPrice" value="${escapeHtml(pricing.discountPrice)}" placeholder="Original price for strike-through" />`)}
        ${renderField("Tax Rate (%)", `<input type="number" min="0" max="100" step="0.1" name="taxRate" value="${escapeHtml(pricing.taxRate)}" placeholder="18" />`)}
      </div>
      <label class="pm-check">
        <input type="checkbox" name="taxIncluded" ${pricing.taxIncluded ? "checked" : ""} />
        <span>Price includes tax</span>
      </label>
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

const CATEGORY_ATTRIBUTE_CONFIG = {
  shoes: ["material"],
  fashion: ["gender", "material"],
  bags: ["height", "width", "length", "material"],
  phones: ["storage", "ram", "color"],
  watches: ["dialSize", "strapType", "color"],
  electronics: ["model", "power", "voltage"]
};

const INVENTORY_ATTRIBUTE_LABELS = {
  material: ["Ibikoresho", "Material"],
  gender: ["Igitsina", "Gender"],
  height: ["Uburebure", "Height"],
  width: ["Ubugari", "Width"],
  length: ["Uburebure bw'ikintu", "Length"],
  storage: ["Ububiko", "Storage"],
  ram: ["RAM", "RAM"],
  color: ["Ibara", "Color"],
  dialSize: ["Ingano ya Dial", "Dial Size"],
  strapType: ["Ubwoko bw'umukandara", "Strap Type"],
  model: ["Moderi", "Model"],
  power: ["Ingufu", "Power"],
  voltage: ["Voltage", "Voltage"]
};

function renderInventoryStep(draft) {
  const inventory = draft.inventory || {};
  const category = String(draft.info?.category || "general").toLowerCase();
  const baseSizes = getSizeOptionsForCategory(category);
  const customSizes = Array.isArray(inventory.customSizes) ? inventory.customSizes : [];
  const sizeOptions = [...new Set([...baseSizes, ...customSizes])];
  const variants = Array.isArray(inventory.variants) ? inventory.variants : [];
  const totalVariantStock = variants.reduce((sum, entry) => sum + Math.max(0, Math.floor(toNumber(entry?.stock, 0))), 0);
  const quantityValue = variants.length ? totalVariantStock : Math.max(0, Math.floor(toNumber(inventory.quantity, 0)));
  const status = deriveInventoryStatus(quantityValue);
  const activeAttributes = CATEGORY_ATTRIBUTE_CONFIG[category] || [];

  const attributeFields = activeAttributes.map((key) => {
    const [rw, en] = INVENTORY_ATTRIBUTE_LABELS[key] || [toLabel(key), toLabel(key)];
    return renderBilingualField(
      rw,
      en,
      `<input type="text" name="attr_${escapeHtml(key)}" value="${escapeHtml(inventory.attributes?.[key] || "")}" placeholder="${escapeHtml(en)}" />`
    );
  }).join("");

  return `
    <div class="pm-step-panel pm-step-panel--inventory">
      <header class="pm-step-header">
        <h2>Inventory</h2>
        <p>Igenzura rya stock n'amoko ya product / Enterprise inventory and variant management.</p>
      </header>

      <section class="pm-form-section">
        <header class="pm-form-section-head">
          <h3 class="pm-form-section-title"><span class="pm-section-rw">Stock</span><span class="pm-section-sep">/</span><span class="pm-section-en">Stock Management</span></h3>
        </header>
        <div class="pm-form-grid">
          ${renderBilingualField("Ingano ya Stock", "Stock Quantity", `<input type="number" min="0" step="1" name="quantity" value="${escapeHtml(String(quantityValue))}" ${variants.length ? "readonly" : ""} required />`, variants.length ? "Automatically calculated from variant stock." : "Enter available units in stock.")}
          <div class="pm-field">
            <span class="pm-field-label pm-field-label--bilingual"><span class="pm-field-label-rw">Imiterere ya Stock</span><span class="pm-field-label-sep">/</span><span class="pm-field-label-en">Stock Status</span></span>
            <div class="pm-stock-badge pm-stock-badge--${escapeHtml(status.key)}" data-stock-status-badge>${escapeHtml(status.rw)} / ${escapeHtml(status.en)}</div>
            <small class="pm-field-hint">Automatic status based on quantity rules.</small>
          </div>
        </div>
      </section>

      <section class="pm-form-section">
        <header class="pm-form-section-head">
          <h3 class="pm-form-section-title"><span class="pm-section-rw">Ingano na Attributes</span><span class="pm-section-sep">/</span><span class="pm-section-en">Sizes & Category Attributes</span></h3>
        </header>
        <div class="pm-form-grid">
          <div class="pm-field pm-field--span-2">
            <span class="pm-field-label pm-field-label--bilingual"><span class="pm-field-label-rw">Ingano</span><span class="pm-field-label-sep">/</span><span class="pm-field-label-en">Sizes</span></span>
            <div class="pm-chip-grid">
              ${sizeOptions.map((size) => `
                <label class="pm-chip">
                  <input type="checkbox" name="sizes" value="${escapeHtml(size)}" ${inventory.sizes?.includes(size) ? "checked" : ""} />
                  <span>${escapeHtml(size)}</span>
                </label>
              `).join("")}
            </div>
            <div class="pm-inline-add">
              <input type="text" name="customSizeInput" placeholder="46, 47, 48..." />
              <button type="button" class="pm-btn pm-btn-ghost" data-add-custom-size>Ingano Nshya / Add Custom Size</button>
            </div>
          </div>
          ${attributeFields || `<div class="pm-field pm-field--span-2"><small class="pm-field-hint">No extra category attributes for this category.</small></div>`}
        </div>
      </section>

      <section class="pm-form-section">
        <header class="pm-form-section-head">
          <h3 class="pm-form-section-title"><span class="pm-section-rw">Amoko ya Product</span><span class="pm-section-sep">/</span><span class="pm-section-en">Product Variants</span></h3>
        </header>
        <div class="pm-form-section-block pm-form-section-block--full">
          <div class="pm-variant-head">
            <label class="pm-check">
              <input type="checkbox" name="variantsEnabled" ${inventory.variantsEnabled ? "checked" : ""} />
              <span>Gukoresha variants / Enable variants</span>
            </label>
            <button type="button" class="pm-btn pm-btn-ghost" data-add-variant ${inventory.variantsEnabled ? "" : "disabled"}>Add Variant</button>
          </div>
          <div class="pm-variant-cards ${inventory.variantsEnabled ? "" : "is-disabled"}">
            ${variants.map((variant, index) => `
              <article class="pm-variant-item" data-variant-index="${index}">
                <input type="text" name="variantLabel" value="${escapeHtml(variant.label || "")}" placeholder="Variant Label" />
                <input type="text" name="variantColor" value="${escapeHtml(variant.colorName || "")}" placeholder="Color Name" />
                <input type="url" name="variantImage" value="${escapeHtml(variant.image || "")}" placeholder="https://... (image URL)" />
                <input type="number" min="0" step="1" name="variantStock" value="${escapeHtml(String(variant.stock || "0"))}" placeholder="Stock" />
                <button type="button" class="pm-btn pm-btn-danger" data-remove-variant="${index}">Remove</button>
              </article>
            `).join("")}
          </div>
          <div class="pm-stock-total">Stock Yose / Total Stock: <strong data-total-variant-stock>${escapeHtml(String(quantityValue))}</strong></div>
        </div>
      </section>
    </div>
  `;
}

function renderMediaStep(draft) {
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

  return `
    <div class="pm-step-panel">
      <header class="pm-step-header">
        <h2>Media</h2>
        <p>Upload a main image and optional gallery photos with drag-and-drop support.</p>
      </header>
      <div class="pm-media-layout">
        <section class="pm-upload-card">
          <h3>Main Image *</h3>
          <div class="pm-dropzone ${hasMainImageSelection(draft) ? "has-file" : ""}" data-drop-main>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden data-main-input />
            <img src="${escapeHtml(mainPreview)}" alt="Main product preview" class="pm-main-preview" data-main-preview />
            <div class="pm-dropzone-copy">
              <strong>Drag & drop or click to upload</strong>
              <span>JPG, PNG, WEBP, GIF, AVIF up to 5MB</span>
            </div>
            ${hasMainImageSelection(draft) ? `<button type="button" class="pm-btn pm-btn-danger" data-remove-main>Remove</button>` : ""}
          </div>
        </section>
        <section class="pm-upload-card">
          <h3>Gallery Images</h3>
          <div class="pm-dropzone" data-drop-gallery>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple hidden data-gallery-input />
            <div class="pm-dropzone-copy">
              <strong>Drop multiple images here</strong>
              <span>Add supporting product photos</span>
            </div>
          </div>
          <div class="pm-gallery-grid" data-gallery-grid>
            ${galleryItems.map((item, index) => `
              <figure class="pm-gallery-item">
                <img src="${escapeHtml(item.url)}" alt="Gallery image ${index + 1}" loading="lazy" />
                <button type="button" class="pm-gallery-remove" data-remove-gallery="${escapeHtml(item.removeKey)}" aria-label="Remove image">&times;</button>
              </figure>
            `).join("")}
          </div>
        </section>
      </div>
      <div class="pm-upload-progress ${uploadProgress.message ? "is-visible" : ""}" data-upload-progress>
        <div class="pm-upload-progress-bar" style="width: ${uploadProgress.percent ?? 0}%"></div>
        <span>${escapeHtml(uploadProgress.message || "Ready to upload")}</span>
      </div>
    </div>
  `;
}

function buildAutoSeoContent(info = {}) {
  const name = String(info.name || "").trim();
  const brand = String(info.brand || "").trim();
  const category = toLabel(info.category || "general");
  const shortDesc = String(info.shortDescription || info.longDescription || info.description || "").trim();
  const metaTitle = `${brand ? `${brand} | ` : ""}${name}${category ? ` | ${category}` : ""} | BYOSE Market`.replace(/\s+\|\s+\|/g, " | ").trim();
  const metaDescription = (shortDesc || `${name}${brand ? ` by ${brand}` : ""}. Shop quality products on BYOSE Market.`).slice(0, 160);
  return {
    metaTitle,
    metaDescription,
    slug: slugify(name)
  };
}

function getCharCounterState(length, idealMin, idealMax) {
  if (length > idealMax) {
    return "danger";
  }
  if (length < idealMin) {
    return "warn";
  }
  return "good";
}

function computeSeoInsights(draft, hasImage = false) {
  const seo = draft.seo || {};
  const info = draft.info || {};
  const title = String(seo.metaTitle || info.name || "").trim();
  const description = String(seo.metaDescription || info.shortDescription || info.longDescription || info.description || "").trim();
  const slug = String(seo.slug || slugify(info.name)).trim();
  const focusKeyword = `${String(seo.focusKeywordRw || "").trim()} ${String(seo.focusKeywordEn || "").trim()}`.trim().toLowerCase();
  const titleLength = title.length;
  const descLength = description.length;
  const titleOptimized = titleLength >= 30 && titleLength <= 60;
  const descOptimized = descLength >= 120 && descLength <= 160;
  const slugReady = Boolean(slug);
  const focusAdded = Boolean(String(seo.focusKeywordRw || "").trim() || String(seo.focusKeywordEn || "").trim());
  const descLengthGood = descLength >= 80 || String(info.shortDescription || "").trim().length >= 50;

  let score = 0;
  if (focusAdded) score += 15;
  if (titleOptimized) score += 20;
  if (descOptimized) score += 20;
  if (slugReady) score += 15;
  if (hasImage) score += 15;
  if (descLengthGood) score += 15;

  const level = score <= 40 ? "poor" : score <= 70 ? "good" : "excellent";
  const levelLabel = level === "poor" ? "Poor SEO" : level === "good" ? "Good SEO" : "Excellent SEO";

  return {
    score,
    level,
    levelLabel,
    checks: [
      { ok: focusAdded, label: "Focus keyword added" },
      { ok: titleOptimized, label: "Meta title optimized" },
      { ok: descOptimized, label: "Meta description optimized" },
      { ok: slugReady, label: "SEO URL generated" },
      { ok: hasImage, label: "Product image available" },
      { ok: descLengthGood, label: "Description length good" }
    ],
    titleLength,
    descLength,
    titleCounterState: getCharCounterState(titleLength, 30, 60),
    descCounterState: getCharCounterState(descLength, 120, 160),
    title,
    description,
    slug,
    focusKeyword
  };
}

function renderSeoStep(draft) {
  const seo = draft.seo || {};
  const info = draft.info || {};
  const media = draft.media || {};
  const auto = buildAutoSeoContent(info);
  const metaTitle = String(seo.metaTitle || auto.metaTitle || info.name || "");
  const metaDescription = String(seo.metaDescription || auto.metaDescription || info.shortDescription || info.description || "");
  const slug = String(seo.slug || auto.slug || slugify(info.name));
  const previewImage = pendingMainPreviewUrl || media.mainImage || FALLBACK_IMAGE;
  const hasImage = Boolean(previewImage && previewImage !== FALLBACK_IMAGE) || hasMainImageSelection(draft);
  const insights = computeSeoInsights({ ...draft, seo: { ...seo, metaTitle, metaDescription, slug } }, hasImage);
  const productUrl = `https://byosemarket.com/product/${slug || "your-product-slug"}`;

  const checklistHtml = insights.checks.map((check) => `
    <li class="pm-seo-check ${check.ok ? "is-done" : ""}">
      <span class="pm-seo-check-icon">${check.ok ? "✓" : "○"}</span>
      <span>${escapeHtml(check.label)}</span>
    </li>
  `).join("");

  return `
    <div class="pm-step-panel pm-step-panel--seo">
      <header class="pm-step-header">
        <h2>SEO</h2>
        <p>Gushakisha no kumenyekana / Professional marketplace SEO optimization for search, social sharing and discovery.</p>
      </header>

      <div class="pm-seo-layout">
        <div class="pm-seo-main">
          ${renderFormSection(
            "Ijambo Ry'Ingenzi",
            "Focus Keyword",
            "Andika ijambo ry'ingenzi mu Kinyarwanda no mu Cyongereza.",
            `
              ${renderBilingualField("Ijambo Ry'Ingenzi (RW)", "Focus Keyword (Kinyarwanda)", `<input type="text" name="focusKeywordRw" value="${escapeHtml(seo.focusKeywordRw)}" placeholder="Inkweto" data-seo-live />`, "Example: Inkweto, Telefoni, Ikarita.")}
              ${renderBilingualField("Focus Keyword (EN)", "Focus Keyword (English)", `<input type="text" name="focusKeywordEn" value="${escapeHtml(seo.focusKeywordEn)}" placeholder="Shoes" data-seo-live />`, "Example: Shoes, Phone, Laptop.")}
            `
          )}

          ${renderFormSection(
            "Meta Tags",
            "Meta Tags",
            "Meta title, description na slug. Ushobora guhindura nyuma yo gukora automatic.",
            `
              <div class="pm-seo-toolbar pm-field--span-2">
                <button type="button" class="pm-btn pm-btn-ghost" data-auto-seo-generate>Auto SEO Generator / Gukora SEO Automatic</button>
                <input type="hidden" name="slugManual" value="${seo.slugManual ? "1" : "0"}" data-slug-manual-flag />
              </div>
              ${renderBilingualField("Umutwe wa Meta", "Meta Title", `
                <input type="text" name="metaTitle" maxlength="80" value="${escapeHtml(metaTitle)}" placeholder="BYOSE Market | Premium Leather Shoes" data-seo-live required />
                <div class="pm-char-counter pm-char-counter--${escapeHtml(insights.titleCounterState)}" data-title-counter>${insights.titleLength} / 60</div>
              `, "Ideal length: 30–60 characters.", "pm-field--span-2 pm-field--required")}
              ${renderBilingualField("Ibisobanuro bya Meta", "Meta Description", `
                <textarea name="metaDescription" rows="4" maxlength="200" placeholder="Premium leather shoes with modern design..." data-seo-live>${escapeHtml(metaDescription)}</textarea>
                <div class="pm-char-counter pm-char-counter--${escapeHtml(insights.descCounterState)}" data-desc-counter>${insights.descLength} / 160</div>
              `, "Ideal length: 120–160 characters.", "pm-field--span-2")}
              ${renderBilingualField("URL ya Product", "Product Slug", `
                <input type="text" name="slug" value="${escapeHtml(slug)}" placeholder="premium-leather-shoes" data-seo-slug data-seo-live />
              `, "Clean SEO URL. Example: premium-leather-shoes", "pm-field--span-2")}
              ${renderBilingualField("Aho Product Igaragara", "Search Visibility", renderOptionSelect("searchVisibility", SEO_SEARCH_VISIBILITY_OPTIONS, seo.searchVisibility || "homepage_shop", true), "Choose where this product can appear in search and storefront.", "pm-field--span-2")}
            `
          )}
        </div>

        <aside class="pm-seo-aside">
          <section class="pm-seo-card pm-seo-score-card">
            <h3>SEO Score</h3>
            <div class="pm-seo-score-ring pm-seo-score-ring--${escapeHtml(insights.level)}" data-seo-score-ring>
              <strong data-seo-score-value>${insights.score}</strong>
              <span>/100</span>
            </div>
            <p class="pm-seo-score-label" data-seo-score-label>${insights.level === "poor" ? "🔴 Poor" : insights.level === "good" ? "🟡 Good" : "🟢 Excellent"} · ${escapeHtml(insights.levelLabel)}</p>
          </section>

          <section class="pm-seo-card">
            <h3>SEO Recommendations</h3>
            <ul class="pm-seo-checklist" data-seo-checklist>${checklistHtml}</ul>
          </section>

          <section class="pm-seo-card">
            <h3>Google Search Preview</h3>
            <div class="pm-seo-preview pm-seo-preview--google">
              <div class="pm-seo-preview-title" data-google-title>${escapeHtml(metaTitle || "BYOSE Market | Product Title")}</div>
              <div class="pm-seo-preview-url" data-google-url>${escapeHtml(productUrl)}</div>
              <div class="pm-seo-preview-desc" data-google-desc>${escapeHtml(metaDescription || "Product description preview for search engines.")}</div>
            </div>
          </section>

          <section class="pm-seo-card">
            <h3>WhatsApp / Facebook Preview</h3>
            <div class="pm-seo-preview pm-seo-preview--social">
              <img src="${escapeHtml(previewImage)}" alt="Social preview" class="pm-seo-social-image" data-social-image />
              <div class="pm-seo-social-copy">
                <strong data-social-title>${escapeHtml(metaTitle || info.name || "Product Title")}</strong>
                <p data-social-desc>${escapeHtml(metaDescription || info.shortDescription || "Product description for social sharing.")}</p>
                <small data-social-url>${escapeHtml(productUrl)}</small>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  `;
}

function renderReviewStep(draft) {
  const payload = buildProductPayload(draft);
  const inventory = draft.inventory || {};
  const info = draft.info || {};
  const pricing = draft.pricing || {};
  const seo = draft.seo || {};
  const media = draft.media || {};
  const validationOptions = getMainImageValidationOptions(draft);
  const health = computeProductHealth(draft, validationOptions);
  const pricingSummary = computePricingSummary(pricing);
  const currency = pricing.currency || "RWF";
  const mainImageUrl = pendingMainPreviewUrl || media.mainImage || "";
  const galleryItems = getReviewGalleryItems(draft);
  const variantItems = Array.isArray(inventory.variants) ? inventory.variants : [];
  const variantImages = variantItems.filter((entry) => String(entry?.image || "").trim());
  const seoInsights = computeSeoInsights(draft, Boolean(mainImageUrl));
  const productUrl = `https://byosemarket.com/product/${payload.slug || slugify(info.name)}`;
  const visibilityLabel = VISIBILITY_OPTIONS.find((entry) => entry.value === info.visibility);
  const searchVisibilityLabel = SEO_SEARCH_VISIBILITY_OPTIONS.find((entry) => entry.value === seo.searchVisibility);
  const productTypeLabel = PRODUCT_TYPE_OPTIONS.find((entry) => entry.value === info.productType);
  const conditionLabel = PRODUCT_CONDITION_OPTIONS.find((entry) => entry.value === info.condition);
  const warrantyLabel = WARRANTY_OPTIONS.find((entry) => entry.value === info.warranty);
  const allSizes = [...new Set([...(inventory.sizes || []), ...(inventory.customSizes || [])])];
  const displayPrice = pricingSummary.current || payload.price;
  const previewName = info.shortName || info.name || "Product Name";
  const previewDesc = info.shortDescription || seo.metaDescription || info.longDescription || "";

  const warningCards = health.warnings.map((warning) => `
    <div class="pm-review-warning">⚠ ${escapeHtml(warning)}</div>
  `).join("");

  const healthChecks = health.checks.map((check) => `
    <li class="pm-review-health-item ${check.ok ? "is-done" : "is-missing"}">
      <span>${check.ok ? "✅" : "❌"}</span>
      <span>${escapeHtml(check.label)}</span>
    </li>
  `).join("");

  const variantCards = variantItems.length
    ? variantItems.map((variant, index) => `
        <article class="pm-variant-review-card">
          ${variant.image ? `<button type="button" class="pm-review-thumb-btn" data-review-image="${escapeHtml(variant.image)}"><img src="${escapeHtml(variant.image)}" alt="${escapeHtml(variant.label || `Variant ${index + 1}`)}" loading="lazy" /></button>` : `<div class="pm-review-thumb-empty">No Image</div>`}
          <div class="pm-variant-review-copy">
            <strong>${escapeHtml(variant.label || `Variant ${index + 1}`)}</strong>
            <span>${escapeHtml(variant.colorName || "-")}</span>
            <span>Stock: ${escapeHtml(String(variant.stock || "0"))}</span>
            <span>Sizes: ${escapeHtml(formatReviewList(allSizes))}</span>
          </div>
        </article>
      `).join("")
    : `<p class="pm-review-empty">No variants configured.</p>`;

  const mediaGallery = `
    <div class="pm-review-media-grid">
      ${mainImageUrl ? `
        <figure class="pm-review-media-item">
          <button type="button" class="pm-review-thumb-btn" data-review-image="${escapeHtml(mainImageUrl)}">
            <img src="${escapeHtml(mainImageUrl)}" alt="Main product image" loading="lazy" />
          </button>
          <figcaption>Main Image</figcaption>
        </figure>
      ` : `<div class="pm-review-media-empty">Main image missing</div>`}
      ${galleryItems.map((item, index) => `
        <figure class="pm-review-media-item">
          <button type="button" class="pm-review-thumb-btn" data-review-image="${escapeHtml(item.url)}">
            <img src="${escapeHtml(item.url)}" alt="Gallery image ${index + 1}" loading="lazy" />
          </button>
          <figcaption>Gallery ${index + 1}</figcaption>
        </figure>
      `).join("")}
      ${variantImages.map((item, index) => `
        <figure class="pm-review-media-item">
          <button type="button" class="pm-review-thumb-btn" data-review-image="${escapeHtml(item.image)}">
            <img src="${escapeHtml(item.image)}" alt="Variant image ${index + 1}" loading="lazy" />
          </button>
          <figcaption>Variant Image</figcaption>
        </figure>
      `).join("")}
    </div>
    <p class="pm-review-media-counts">Main Image: ${mainImageUrl ? 1 : 0} · Gallery Images: ${galleryItems.length} · Variant Images: ${variantImages.length}</p>
  `;

  const infoRows = [
    renderReviewRow("Izina rya Product", "Product Name", escapeHtml(info.name || "-")),
    renderReviewRow("Izina Rigufi", "Short Product Name", escapeHtml(info.shortName || "-")),
    renderReviewRow("Icyiciro", "Category", escapeHtml(toLabel(info.category))),
    renderReviewRow("Ubwoko", "Subcategory / Product Type", escapeHtml(productTypeLabel ? `${productTypeLabel.labelRw} / ${productTypeLabel.labelEn}` : "-")),
    renderReviewRow("Ikirango", "Brand", escapeHtml(info.brand || "-")),
    renderReviewRow("Uruganda", "Manufacturer", escapeHtml(info.manufacturer || "-")),
    renderReviewRow("SKU", "SKU", escapeHtml(info.sku || "-")),
    renderReviewRow("Tags", "Tags", escapeHtml(formatReviewList(payload.tags))),
    renderReviewRow("Amagambo yo Gushakisha", "Search Keywords", escapeHtml(formatReviewList(payload.keywords))),
    renderReviewRow("Iby'ingenzi", "Product Highlights", escapeHtml(formatReviewList(payload.highlights))),
    renderReviewRow("Imiterere", "Product Condition", escapeHtml(conditionLabel ? `${conditionLabel.labelRw} / ${conditionLabel.labelEn}` : "-")),
    renderReviewRow("Igihugu Yakorewemo", "Country Of Origin", escapeHtml(info.countryOfOrigin || "-")),
    renderReviewRow("Garanti", "Warranty", escapeHtml(warrantyLabel ? `${warrantyLabel.labelRw} / ${warrantyLabel.labelEn}${info.warrantyCustom ? ` (${info.warrantyCustom})` : ""}` : "-")),
    renderReviewRow("Kugaragara", "Visibility", escapeHtml(visibilityLabel ? `${visibilityLabel.labelRw} / ${visibilityLabel.labelEn}` : "-")),
    renderReviewRow("Umwanya wa Product", "Product Position", escapeHtml(getPositionLabel(info.positionMode))),
    renderReviewRow("Amanota y'imbere", "Priority Score", escapeHtml(String(info.priorityScore || "50"))),
    renderReviewRow("Aho Product Igaragara", "Product Placement", escapeHtml(formatPlacementSummary(info.placement))),
    renderReviewRow("Product Yihariye", "Featured Product", escapeHtml(formatFeaturedSummary(info))),
    renderReviewRow("Ibisobanuro Bigufi", "Short Description", escapeHtml(info.shortDescription || "-")),
    renderReviewRow("Ibisobanuro Birambuye", "Long Description", escapeHtml(info.longDescription || info.description || "-"))
  ].join("");

  const pricingRows = [
    renderReviewRow("Ifaranga", "Currency", escapeHtml(currency)),
    renderReviewRow("Igiciro Cyo Kuguriraho", "Cost Price", escapeHtml(pricing.costPrice ? formatReviewCurrency(payload.costPrice, currency) : "-")),
    renderReviewRow("Igiciro Cyo Kugurisha", "Selling Price", escapeHtml(pricing.sellingPrice ? formatReviewCurrency(pricingSummary.selling, currency) : "-")),
    renderReviewRow("Igiciro Cyagabanyijwe", "Discount Price", escapeHtml(pricing.discountPrice ? formatReviewCurrency(pricingSummary.discountField, currency) : "-")),
    renderReviewRow("Umusoro", "Tax Rate", escapeHtml(pricing.taxRate ? `${payload.taxRate}% ${payload.taxIncluded ? "(included)" : "(excluded)"}` : "-")),
    renderReviewRow("Ntarengwa Nto", "Minimum Order Qty", escapeHtml(pricing.minOrderQty || "1")),
    renderReviewRow("Ntarengwa Nini", "Maximum Order Qty", escapeHtml(pricing.maxOrderQty || "-")),
    renderReviewRow("Flash Sale", "Flash Sale", escapeHtml(pricing.flashSaleEnabled ? `Enabled (${pricing.flashSaleStart || "-"} → ${pricing.flashSaleEnd || "-"})` : "Disabled"))
  ].join("");

  const pricingDiscountBlock = pricingSummary.discountAmount > 0 ? `
    <div class="pm-review-highlight">
      <div><strong>Original Price:</strong> ${escapeHtml(formatReviewCurrency(pricingSummary.original, currency))}</div>
      <div><strong>Discount Amount:</strong> ${escapeHtml(formatReviewCurrency(pricingSummary.discountAmount, currency))}</div>
      <div><strong>Discount Percentage:</strong> ${escapeHtml(String(pricingSummary.discountPercent))}%</div>
      <div><strong>Current Price:</strong> ${escapeHtml(formatReviewCurrency(pricingSummary.current, currency))}</div>
    </div>
  ` : `<div class="pm-review-highlight"><div><strong>Final Selling Price:</strong> ${escapeHtml(formatReviewCurrency(displayPrice, currency))}</div></div>`;

  const inventoryRows = [
    renderReviewRow("Stock Yose", "Total Quantity", escapeHtml(String(payload.stock))),
    renderReviewRow("Imiterere ya Stock", "Stock Status", `<span class="pm-stock-badge pm-stock-badge--${escapeHtml(inventory.stockStatus || "out_of_stock")}">${escapeHtml(getStockStatusLabel(inventory.stockStatus))}</span>`),
    renderReviewRow("Amoko", "Total Variants", escapeHtml(String(variantItems.length))),
    renderReviewRow("Ingano Zihari", "Available Sizes", escapeHtml(formatReviewList(allSizes))),
    renderReviewRow("Ingano Nshya", "Custom Sizes", escapeHtml(formatReviewList(inventory.customSizes))),
    renderReviewRow("Amoko ya Product", "Variants Enabled", escapeHtml(inventory.variantsEnabled ? "Yes" : "No")),
    renderReviewRow("Attributes", "Category Attributes", escapeHtml(formatInventoryAttributes(inventory.attributes)))
  ].join("");

  const seoRows = [
    renderReviewRow("Umutwe wa Meta", "Meta Title", escapeHtml(payload.metaTitle || "-")),
    renderReviewRow("Ibisobanuro bya Meta", "Meta Description", escapeHtml(seo.metaDescription || payload.metaDescription || "-")),
    renderReviewRow("URL ya Product", "Product Slug", escapeHtml(payload.slug || "-")),
    renderReviewRow("Ijambo Ry'Ingenzi (RW)", "Focus Keyword (Kinyarwanda)", escapeHtml(seo.focusKeywordRw || "-")),
    renderReviewRow("Focus Keyword (EN)", "Focus Keyword (English)", escapeHtml(seo.focusKeywordEn || "-")),
    renderReviewRow("Aho Product Igaragara", "Search Visibility", escapeHtml(searchVisibilityLabel ? `${searchVisibilityLabel.labelRw} / ${searchVisibilityLabel.labelEn}` : "-")),
    renderReviewRow("SEO Score", "SEO Score", escapeHtml(`${seoInsights.score}/100 (${seoInsights.levelLabel})`))
  ].join("");

  return `
    <div class="pm-step-panel pm-step-panel--review">
      <header class="pm-step-header">
        <h2>Review & Save</h2>
        <p>Reba byose ushyireho mbere yo gutanga product / Complete product validation dashboard before publishing.</p>
      </header>

      <section class="pm-review-dashboard">
        <article class="pm-review-health card">
          <div class="pm-review-health-head">
            <div>
              <h3>Product Health Check</h3>
              <p>Product Completion Score</p>
            </div>
            <strong class="pm-review-completion">${health.percent}% Complete</strong>
          </div>
          <ul class="pm-review-health-list">${healthChecks}</ul>
          ${warningCards ? `<div class="pm-review-warnings">${warningCards}</div>` : ""}
        </article>

        <article class="pm-review-health card pm-review-health--seo">
          <h3>SEO Score</h3>
          <strong>${seoInsights.score}/100</strong>
          <span>${escapeHtml(seoInsights.levelLabel)}</span>
        </article>
      </section>

      <div class="pm-review-sections">
        ${renderReviewSection("Amakuru y'Product", "Product Information", infoRows)}
        ${renderReviewSection("Ibiciro", "Pricing Summary", pricingRows, pricingDiscountBlock)}
        ${renderReviewSection("Stock", "Inventory Summary", inventoryRows)}
        ${renderReviewSection("Amoko ya Product", "Variant Summary", renderReviewRow("Amoko", "Total Variants", escapeHtml(String(variantItems.length))), `<div class="pm-variant-review-grid">${variantCards}</div>`)}
        ${renderReviewSection("Amashusho", "Media Summary", "", mediaGallery)}
        ${renderReviewSection("SEO", "SEO Summary", seoRows, `
          <div class="pm-seo-preview pm-seo-preview--google pm-review-google-preview">
            <div class="pm-seo-preview-title">${escapeHtml(payload.metaTitle || info.name || "Product Title")}</div>
            <div class="pm-seo-preview-url">${escapeHtml(productUrl)}</div>
            <div class="pm-seo-preview-desc">${escapeHtml(seo.metaDescription || payload.metaDescription || previewDesc || "Product description preview.")}</div>
          </div>
        `)}
      </div>

      <section class="pm-review-live-preview card">
        <header class="pm-review-section-head">
          <h3><span class="pm-section-rw">Reba Product Live</span><span class="pm-section-sep">/</span><span class="pm-section-en">Live Product Preview</span></h3>
        </header>
        <div class="pm-live-preview-grid">
          <article class="pm-live-preview-card">
            <span class="pm-live-preview-label">Homepage</span>
            ${mainImageUrl ? `<img src="${escapeHtml(mainImageUrl)}" alt="" loading="lazy" />` : `<div class="pm-live-preview-empty">No image</div>`}
            <strong>${escapeHtml(previewName)}</strong>
            <p>${escapeHtml(formatReviewCurrency(displayPrice, currency))}</p>
          </article>
          <article class="pm-live-preview-card">
            <span class="pm-live-preview-label">Shop Page</span>
            ${mainImageUrl ? `<img src="${escapeHtml(mainImageUrl)}" alt="" loading="lazy" />` : `<div class="pm-live-preview-empty">No image</div>`}
            <strong>${escapeHtml(previewName)}</strong>
            <p>${escapeHtml(formatReviewCurrency(displayPrice, currency))}${pricingSummary.discountPercent ? ` · -${pricingSummary.discountPercent}%` : ""}</p>
          </article>
          <article class="pm-live-preview-card pm-live-preview-card--pdp">
            <span class="pm-live-preview-label">Product Details</span>
            ${mainImageUrl ? `<img src="${escapeHtml(mainImageUrl)}" alt="" loading="lazy" />` : `<div class="pm-live-preview-empty">No image</div>`}
            <strong>${escapeHtml(info.name || previewName)}</strong>
            <p>${escapeHtml(previewDesc || "Product description preview.")}</p>
            <small>${escapeHtml(formatReviewCurrency(displayPrice, currency))}</small>
          </article>
        </div>
      </section>

      <div class="pm-lightbox is-hidden" data-review-lightbox aria-hidden="true">
        <button type="button" class="pm-lightbox-close" data-close-lightbox aria-label="Close preview">&times;</button>
        <img src="" alt="Enlarged product image" data-lightbox-image />
      </div>
    </div>
  `;
}

function renderSuccessState(savedProduct) {
  const catalogId = savedProduct?.id || savedProduct?.catalogId || activeDraft.savedProductId;
  return `
    <section class="pm-success card">
      <div class="pm-success-icon" aria-hidden="true">✓</div>
      <h2>Product saved successfully.</h2>
      <p>Your product is now live across the storefront catalog.</p>
      <div class="pm-success-actions">
        <a class="pm-btn pm-btn-primary" href="${escapeHtml(buildProductViewUrl(catalogId))}" target="_blank" rel="noopener">View Product</a>
        <button type="button" class="pm-btn pm-btn-secondary" data-add-another>Add Another Product</button>
      </div>
    </section>
  `;
}

function renderWizardMarkup(draft, currentStep) {
  const isEditing = Boolean(draft.productId);
  const reviewHealth = currentStep === "review"
    ? computeProductHealth(draft, getMainImageValidationOptions(draft))
    : null;
  const stepContent = currentStep === "info" ? renderInfoStep(draft)
    : currentStep === "pricing" ? renderPricingStep(draft)
    : currentStep === "inventory" ? renderInventoryStep(draft)
    : currentStep === "media" ? renderMediaStep(draft)
    : currentStep === "seo" ? renderSeoStep(draft)
    : renderReviewStep(draft);

  if (saveSuccess) {
    return `
      <div class="pm-shell">
        ${renderSuccessState(saveSuccess)}
      </div>
    `;
  }

  return `
    <div class="pm-shell">
      <section class="pm-hero card pm-hero-compact">
        <div class="pm-hero-copy">
          <p class="pm-kicker">${isEditing ? "Edit Product" : "New Product"}</p>
          <h1>Product Manager</h1>
          <p>Complete all steps to publish a professional product listing to your storefront.</p>
        </div>
        <div class="pm-hero-actions">
          <a class="pm-btn pm-btn-secondary" href="#/products">Back to Catalog</a>
        </div>
      </section>

      ${workflowFeedback.message ? `<div class="pm-alert pm-alert-${escapeHtml(workflowFeedback.tone || "neutral")}">${escapeHtml(workflowFeedback.message)}</div>` : ""}
      ${isSaving ? `<div class="pm-alert pm-alert-neutral">${escapeHtml(uploadProgress.message || "Saving product...")}</div>` : ""}

      ${renderStepNav(currentStep)}

      <form class="card pm-wizard-form" data-product-wizard novalidate>
        ${stepContent}
        <footer class="pm-wizard-footer ${currentStep === "review" ? "pm-wizard-footer--review" : ""}">
          <button type="button" class="pm-btn pm-btn-secondary" data-prev-step ${getStepIndex(currentStep) === 0 || isSaving ? "disabled" : ""}>Previous</button>
          ${currentStep === "review"
            ? `
              <div class="pm-review-action-group">
                <button type="button" class="pm-btn pm-btn-secondary" data-save-draft ${isSaving ? "disabled" : ""}>💾 Save Draft</button>
                <button type="button" class="pm-btn pm-btn-secondary" data-preview-product ${isSaving ? "disabled" : ""}>👁 Preview Product</button>
                <button type="button" class="pm-btn pm-btn-secondary" data-duplicate-product ${isSaving ? "disabled" : ""}>📄 Duplicate Product</button>
                <button type="submit" class="pm-btn pm-btn-primary" data-save-product ${isSaving || !reviewHealth?.canPublish ? "disabled" : ""}>🚀 ${isSaving ? "Publishing..." : (isEditing ? "Update Product" : "Publish Product")}</button>
              </div>
            `
            : `<button type="button" class="pm-btn pm-btn-primary" data-next-step>Continue</button>`
          }
        </footer>
      </form>
    </div>
  `;
}

function getGallerySelectionCount(draft) {
  const savedCount = (draft?.media?.gallery || []).length;
  return savedCount + pendingGalleryEntries.length;
}

function getReviewGalleryItems(draft) {
  const saved = (draft?.media?.gallery || []).map((url) => ({ url, pending: false }));
  const pending = pendingGalleryEntries.map((entry) => ({ url: entry.previewUrl, pending: true }));
  return [...saved, ...pending];
}

function formatReviewList(values = [], fallback = "-") {
  const items = (Array.isArray(values) ? values : [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  return items.length ? items.join(", ") : fallback;
}

function formatReviewCurrency(value, currency = "RWF") {
  const amount = Number(value || 0);
  if (currency === "USD") {
    return `$${amount.toLocaleString("en-US")}`;
  }
  if (currency === "EUR") {
    return `€${amount.toLocaleString("en-US")}`;
  }
  return formatCurrency(amount);
}

function computePricingSummary(pricing = {}) {
  const selling = toNumber(pricing.sellingPrice, 0);
  const discountField = toNumber(pricing.discountPrice, 0);
  let original = 0;
  let current = selling;
  if (discountField > selling) {
    original = discountField;
    current = selling;
  } else if (selling > discountField && discountField > 0) {
    original = selling;
    current = discountField;
  }
  const discountAmount = original > current ? original - current : 0;
  const discountPercent = original > 0 && discountAmount > 0
    ? Math.round((discountAmount / original) * 100)
    : 0;
  return { original, current, discountAmount, discountPercent, selling, discountField };
}

function getStockStatusLabel(status) {
  const map = {
    out_of_stock: "Nta Stock Irimo / Out of Stock",
    low_stock: "Stock Nkeya / Low Stock",
    limited_stock: "Stock Nto Ihari / Limited Stock",
    in_stock: "Ihari / In Stock"
  };
  return map[String(status || "").toLowerCase()] || toLabel(status || "in_stock");
}

function getPositionLabel(mode) {
  const entry = POSITION_MODE_OPTIONS.find((item) => item.value === mode);
  return entry ? `${entry.labelRw} / ${entry.labelEn}` : toLabel(mode || "automatic");
}

function formatPlacementSummary(placement = []) {
  const values = Array.isArray(placement) ? placement : [];
  if (!values.length || values.includes("all")) {
    return "Ahantu hose / All Locations";
  }
  return values.map((value) => {
    const entry = PLACEMENT_OPTIONS.find((item) => item.value === value);
    return entry ? `${entry.labelRw} / ${entry.labelEn}` : toLabel(value);
  }).join(", ");
}

function formatFeaturedSummary(info = {}) {
  const flags = [];
  if (info.featuredHomepage) flags.push("Homepage");
  if (info.featuredProducts) flags.push("Featured Products");
  if (info.featuredBestSellers) flags.push("Best Sellers");
  if (info.featuredFreshPicks) flags.push("Fresh Picks");
  return flags.length ? flags.join(", ") : "-";
}

function formatInventoryAttributes(attributes = {}) {
  const entries = Object.entries(attributes || {}).filter(([, value]) => String(value || "").trim());
  if (!entries.length) {
    return "-";
  }
  return entries.map(([key, value]) => {
    const labels = INVENTORY_ATTRIBUTE_LABELS[key] || [toLabel(key), toLabel(key)];
    return `${labels[0]} / ${labels[1]}: ${value}`;
  }).join(" · ");
}

function renderReviewRow(labelRw, labelEn, valueHtml) {
  return `
    <div class="pm-review-row">
      <dt><span class="pm-field-label-rw">${escapeHtml(labelRw)}</span> / ${escapeHtml(labelEn)}</dt>
      <dd>${valueHtml}</dd>
    </div>
  `;
}

function renderReviewSection(titleRw, titleEn, rowsHtml, extraHtml = "") {
  return `
    <article class="pm-review-section card">
      <header class="pm-review-section-head">
        <h3>
          <span class="pm-section-rw">${escapeHtml(titleRw)}</span>
          <span class="pm-section-sep">/</span>
          <span class="pm-section-en">${escapeHtml(titleEn)}</span>
        </h3>
      </header>
      <dl class="pm-review-dl">${rowsHtml}</dl>
      ${extraHtml}
    </article>
  `;
}

function computeProductHealth(draft, options = {}) {
  const info = draft?.info || {};
  const pricing = draft?.pricing || {};
  const inventory = draft?.inventory || {};
  const seo = draft?.seo || {};
  const hasImage = Boolean(options.hasPendingMainImage || draft?.media?.mainImage);
  const variantStock = (inventory.variants || []).reduce((sum, entry) => sum + toNumber(entry?.stock, 0), 0);
  const totalStock = inventory.variants?.length ? variantStock : toNumber(inventory.quantity, 0);
  const validationErrors = validateAllSteps(draft, options);
  const seoInsights = computeSeoInsights(draft, hasImage);

  const checks = [
    { ok: Boolean(String(info.name || "").trim()), label: "Product Name" },
    { ok: Boolean(String(info.category || "").trim()), label: "Category" },
    { ok: toNumber(pricing.sellingPrice, 0) > 0, label: "Price" },
    { ok: hasImage, label: "Images" },
    { ok: totalStock > 0, label: "Inventory" },
    { ok: !inventory.variantsEnabled || (inventory.variants || []).length > 0, label: "Variants" },
    { ok: Boolean(String(seo.metaTitle || info.name || "").trim()), label: "SEO" }
  ];

  const passed = checks.filter((entry) => entry.ok).length;
  const percent = Math.round((passed / checks.length) * 100);
  const warnings = [];
  if (!hasImage) warnings.push("Product image missing");
  if (totalStock <= 0) warnings.push("Stock quantity missing");
  if (toNumber(pricing.sellingPrice, 0) <= 0) warnings.push("Price missing");
  if (!String(seo.metaTitle || info.name || "").trim()) warnings.push("SEO incomplete");
  if (inventory.variantsEnabled && !(inventory.variants || []).length) warnings.push("Variants missing");
  validationErrors.forEach((error) => {
    if (!warnings.includes(error)) {
      warnings.push(error);
    }
  });

  return {
    percent,
    checks,
    warnings,
    seoScore: seoInsights.score,
    canPublish: validationErrors.length === 0 && hasImage && toNumber(pricing.sellingPrice, 0) > 0
  };
}

function collectDraftFromForm(form, draft, step = "") {
  const nextDraft = sanitizeDraft({ ...draft });
  const formData = new FormData(form);
  const activeStep = String(step || "").trim().toLowerCase();

  if (activeStep === "info") {
    const placement = formData.getAll("placement").map((entry) => String(entry || "").trim()).filter(Boolean);
    const featuredFlags = formData.getAll("featuredFlags").map((entry) => String(entry || "").trim());
    const longDescription = String(formData.get("longDescription") ?? nextDraft.info.longDescription ?? nextDraft.info.description ?? "");

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
      sku: String(formData.get("sku") ?? nextDraft.info.sku ?? ""),
      tags: String(formData.get("tags") ?? nextDraft.info.tags ?? ""),
      searchKeywords: String(formData.get("searchKeywords") ?? nextDraft.info.searchKeywords ?? ""),
      highlights: String(formData.get("highlights") ?? nextDraft.info.highlights ?? ""),
      warranty: String(formData.get("warranty") || nextDraft.info.warranty || "none"),
      warrantyCustom: String(formData.get("warrantyCustom") ?? nextDraft.info.warrantyCustom ?? ""),
      visibility: String(formData.get("visibility") || nextDraft.info.visibility || "both"),
      shortDescription: String(formData.get("shortDescription") ?? nextDraft.info.shortDescription ?? ""),
      longDescription,
      description: longDescription,
      placement: placement.length ? placement : nextDraft.info.placement,
      positionMode: String(formData.get("positionMode") || nextDraft.info.positionMode || "automatic"),
      priorityScore: String(formData.get("priorityScore") ?? nextDraft.info.priorityScore ?? "50"),
      featuredHomepage: featuredFlags.includes("featuredHomepage"),
      featuredProducts: featuredFlags.includes("featuredProducts"),
      featuredBestSellers: featuredFlags.includes("featuredBestSellers"),
      featuredFreshPicks: featuredFlags.includes("featuredFreshPicks")
    };
  }

  if (activeStep === "pricing") {
    nextDraft.pricing = {
      ...nextDraft.pricing,
      costPrice: String(formData.get("costPrice") ?? nextDraft.pricing.costPrice ?? ""),
      sellingPrice: String(formData.get("sellingPrice") ?? nextDraft.pricing.sellingPrice ?? ""),
      discountPrice: String(formData.get("discountPrice") ?? nextDraft.pricing.discountPrice ?? ""),
      taxRate: String(formData.get("taxRate") ?? nextDraft.pricing.taxRate ?? ""),
      taxIncluded: formData.get("taxIncluded") === "on"
    };
  }

  if (activeStep === "inventory") {
    const variantsEnabled = formData.get("variantsEnabled") === "on";
    const variantRows = Array.from(form.querySelectorAll("[data-variant-index]"));
    const variantEntries = variantsEnabled
      ? variantRows.map((row, index) => ({
          label: String(row.querySelector('[name="variantLabel"]')?.value || "").trim() || `Variant ${index + 1}`,
          colorName: String(row.querySelector('[name="variantColor"]')?.value || "").trim(),
          image: String(row.querySelector('[name="variantImage"]')?.value || "").trim(),
          stock: String(Math.max(0, Math.floor(toNumber(row.querySelector('[name="variantStock"]')?.value, 0))))
        }))
      : [];
    const variantTotal = variantEntries.reduce((sum, entry) => sum + toNumber(entry.stock, 0), 0);
    const quantity = variantsEnabled
      ? String(variantTotal)
      : String(Math.max(0, Math.floor(toNumber(formData.get("quantity"), toNumber(nextDraft.inventory.quantity, 0)))));
    const status = deriveInventoryStatus(quantity).key;
    const category = String(nextDraft.info?.category || "general").toLowerCase();
    const attributeKeys = CATEGORY_ATTRIBUTE_CONFIG[category] || [];
    const attributes = {};
    attributeKeys.forEach((key) => {
      attributes[key] = String(formData.get(`attr_${key}`) ?? nextDraft.inventory.attributes?.[key] ?? "").trim();
    });
    nextDraft.inventory = {
      ...nextDraft.inventory,
      quantity,
      stockStatus: status,
      variantsEnabled,
      sizes: Array.from(form.querySelectorAll('[name="sizes"]:checked'))
        .map((entry) => String(entry.value || "").trim())
        .filter(Boolean),
      customSizes: Array.from(new Set([
        ...(nextDraft.inventory.customSizes || []),
        ...Array.from(form.querySelectorAll('[name="sizes"]'))
          .map((entry) => String(entry.value || "").trim())
          .filter((value) => value && !getSizeOptionsForCategory(category).includes(value))
      ])),
      attributes,
      variants: variantEntries
    };
  }

  if (activeStep === "seo") {
    nextDraft.seo = {
      ...nextDraft.seo,
      metaTitle: String(formData.get("metaTitle") || nextDraft.seo.metaTitle || nextDraft.info.name || ""),
      metaDescription: String(formData.get("metaDescription") ?? nextDraft.seo.metaDescription ?? nextDraft.info.shortDescription ?? nextDraft.info.description ?? ""),
      slug: slugify(String(formData.get("slug") || nextDraft.seo.slug || nextDraft.info.name || "")),
      focusKeywordRw: String(formData.get("focusKeywordRw") ?? nextDraft.seo.focusKeywordRw ?? ""),
      focusKeywordEn: String(formData.get("focusKeywordEn") ?? nextDraft.seo.focusKeywordEn ?? ""),
      searchVisibility: String(formData.get("searchVisibility") || nextDraft.seo.searchVisibility || "homepage_shop"),
      slugManual: String(formData.get("slugManual") || "0") === "1"
    };
  }

  if (pendingMainFile || pendingMainPreviewUrl) {
    nextDraft.media.pendingMainFile = !nextDraft.media.mainImage;
  } else if (!nextDraft.media.mainImage) {
    nextDraft.media.pendingMainFile = false;
  }

  if (pendingGalleryEntries.length) {
    nextDraft.media.pendingGalleryCount = pendingGalleryEntries.length;
  } else {
    nextDraft.media.pendingGalleryCount = 0;
  }

  return sanitizeDraft(nextDraft);
}

function rerenderWizard(container) {
  const currentStep = getWizardStep(activeDraft.step || "info");
  activeDraft.step = currentStep;
  container.innerHTML = renderWizardMarkup(activeDraft, currentStep);
  mountWizard(container);
}

function goToStep(container, step) {
  activeDraft.step = step;
  writeDraft(activeDraft);
  window.location.hash = buildCreateHash(step, activeDraft.productId || activeDraft.savedProductId || "");
  rerenderWizard(container);
}

function bindInfoStepEnhancements(form) {
  const positionMode = form.querySelector("[name=\"positionMode\"]");
  const priorityScore = form.querySelector("[name=\"priorityScore\"]");
  const warranty = form.querySelector("[name=\"warranty\"]");
  const warrantyCustom = form.querySelector("[name=\"warrantyCustom\"]");
  const warrantyField = warrantyCustom?.closest(".pm-field");
  const POSITION_SCORES = { top: "100", middle: "50", bottom: "10" };

  function syncPositionPriority() {
    if (!positionMode || !priorityScore) {
      return;
    }
    const mode = String(positionMode.value || "automatic").toLowerCase();
    if (mode === "automatic") {
      priorityScore.removeAttribute("readonly");
      priorityScore.closest(".pm-field")?.classList.remove("is-muted");
      return;
    }
    priorityScore.value = POSITION_SCORES[mode] || priorityScore.value;
    priorityScore.setAttribute("readonly", "readonly");
    priorityScore.closest(".pm-field")?.classList.add("is-muted");
  }

  function syncWarrantyCustom() {
    if (!warranty || !warrantyCustom || !warrantyField) {
      return;
    }
    const isCustom = String(warranty.value || "") === "custom";
    warrantyCustom.disabled = !isCustom;
    warrantyField.classList.toggle("is-hidden", !isCustom);
  }

  positionMode?.addEventListener("change", syncPositionPriority);
  warranty?.addEventListener("change", syncWarrantyCustom);
  syncPositionPriority();
  syncWarrantyCustom();
}

function bindInventoryStepEnhancements(form) {
  const quantityInput = form.querySelector('[name="quantity"]');
  const statusBadge = form.querySelector("[data-stock-status-badge]");
  const variantStockInputs = Array.from(form.querySelectorAll('[name="variantStock"]'));
  const totalStockLabel = form.querySelector("[data-total-variant-stock]");
  const variantsEnabled = form.querySelector('[name="variantsEnabled"]');
  const variantsContainer = form.querySelector(".pm-variant-cards");
  const addVariantButton = form.querySelector("[data-add-variant]");

  function syncStockUi() {
    const hasVariants = variantsEnabled?.checked && variantStockInputs.length;
    const total = hasVariants
      ? variantStockInputs.reduce((sum, input) => sum + Math.max(0, Math.floor(toNumber(input.value, 0))), 0)
      : Math.max(0, Math.floor(toNumber(quantityInput?.value, 0)));
    if (quantityInput && hasVariants) {
      quantityInput.value = String(total);
    }
    if (totalStockLabel) {
      totalStockLabel.textContent = String(total);
    }
    if (statusBadge) {
      const status = deriveInventoryStatus(total);
      statusBadge.className = `pm-stock-badge pm-stock-badge--${status.key}`;
      statusBadge.textContent = `${status.rw} / ${status.en}`;
    }
  }

  function syncVariantState() {
    const enabled = Boolean(variantsEnabled?.checked);
    variantsContainer?.classList.toggle("is-disabled", !enabled);
    if (addVariantButton) {
      addVariantButton.disabled = !enabled;
    }
  }

  quantityInput?.addEventListener("input", syncStockUi);
  variantStockInputs.forEach((input) => input.addEventListener("input", syncStockUi));
  variantsEnabled?.addEventListener("change", () => {
    syncVariantState();
    syncStockUi();
  });
  syncVariantState();
  syncStockUi();
}

function bindSeoStepEnhancements(form, draft) {
  const liveFields = Array.from(form.querySelectorAll("[data-seo-live]"));
  const slugInput = form.querySelector("[data-seo-slug]");
  const slugManualFlag = form.querySelector("[data-slug-manual-flag]");
  const autoButton = form.querySelector("[data-auto-seo-generate]");
  const previewImage = pendingMainPreviewUrl || draft?.media?.mainImage || FALLBACK_IMAGE;
  const hasImage = Boolean(previewImage && previewImage !== FALLBACK_IMAGE) || hasMainImageSelection(draft);

  function readDraftFromForm() {
    const formData = new FormData(form);
    return {
      ...draft,
      seo: {
        ...(draft.seo || {}),
        metaTitle: String(formData.get("metaTitle") || ""),
        metaDescription: String(formData.get("metaDescription") || ""),
        slug: slugify(String(formData.get("slug") || "")),
        focusKeywordRw: String(formData.get("focusKeywordRw") || ""),
        focusKeywordEn: String(formData.get("focusKeywordEn") || ""),
        searchVisibility: String(formData.get("searchVisibility") || "homepage_shop"),
        slugManual: String(formData.get("slugManual") || "0") === "1"
      }
    };
  }

  function syncSeoUi() {
    const currentDraft = readDraftFromForm();
    const insights = computeSeoInsights(currentDraft, hasImage);
    const productUrl = `https://byosemarket.com/product/${insights.slug || "your-product-slug"}`;

    form.querySelector("[data-google-title]")?.replaceChildren(document.createTextNode(insights.title || "BYOSE Market | Product Title"));
    form.querySelector("[data-google-url]")?.replaceChildren(document.createTextNode(productUrl));
    form.querySelector("[data-google-desc]")?.replaceChildren(document.createTextNode(insights.description || "Product description preview for search engines."));
    form.querySelector("[data-social-title]")?.replaceChildren(document.createTextNode(insights.title || currentDraft.info?.name || "Product Title"));
    form.querySelector("[data-social-desc]")?.replaceChildren(document.createTextNode(insights.description || currentDraft.info?.shortDescription || "Product description for social sharing."));
    form.querySelector("[data-social-url]")?.replaceChildren(document.createTextNode(productUrl));

    const titleCounter = form.querySelector("[data-title-counter]");
    if (titleCounter) {
      titleCounter.textContent = `${insights.titleLength} / 60`;
      titleCounter.className = `pm-char-counter pm-char-counter--${insights.titleCounterState}`;
    }
    const descCounter = form.querySelector("[data-desc-counter]");
    if (descCounter) {
      descCounter.textContent = `${insights.descLength} / 160`;
      descCounter.className = `pm-char-counter pm-char-counter--${insights.descCounterState}`;
    }

    const scoreValue = form.querySelector("[data-seo-score-value]");
    if (scoreValue) {
      scoreValue.textContent = String(insights.score);
    }
    const scoreRing = form.querySelector("[data-seo-score-ring]");
    if (scoreRing) {
      scoreRing.className = `pm-seo-score-ring pm-seo-score-ring--${insights.level}`;
    }
    const scoreLabel = form.querySelector("[data-seo-score-label]");
    if (scoreLabel) {
      const emoji = insights.level === "poor" ? "🔴 Poor" : insights.level === "good" ? "🟡 Good" : "🟢 Excellent";
      scoreLabel.textContent = `${emoji} · ${insights.levelLabel}`;
    }

    const checklist = form.querySelector("[data-seo-checklist]");
    if (checklist) {
      checklist.innerHTML = insights.checks.map((check) => `
        <li class="pm-seo-check ${check.ok ? "is-done" : ""}">
          <span class="pm-seo-check-icon">${check.ok ? "✓" : "○"}</span>
          <span>${escapeHtml(check.label)}</span>
        </li>
      `).join("");
    }
  }

  liveFields.forEach((field) => field.addEventListener("input", syncSeoUi));

  slugInput?.addEventListener("input", () => {
    if (slugManualFlag) {
      slugManualFlag.value = "1";
    }
    syncSeoUi();
  });

  autoButton?.addEventListener("click", () => {
    const auto = buildAutoSeoContent(draft.info || {});
    const titleInput = form.querySelector('[name="metaTitle"]');
    const descInput = form.querySelector('[name="metaDescription"]');
    if (titleInput) {
      titleInput.value = auto.metaTitle;
    }
    if (descInput) {
      descInput.value = auto.metaDescription;
    }
    if (slugInput && (!slugManualFlag || slugManualFlag.value !== "1")) {
      slugInput.value = auto.slug;
    }
    if (slugManualFlag) {
      slugManualFlag.value = "0";
    }
    syncSeoUi();
  });

  syncSeoUi();
}

function bindReviewStepEnhancements(form, container) {
  const lightbox = form.querySelector("[data-review-lightbox]");
  const lightboxImage = form.querySelector("[data-lightbox-image]");

  form.querySelectorAll("[data-review-image]").forEach((button) => {
    button.addEventListener("click", () => {
      const src = button.getAttribute("data-review-image");
      if (!src || !lightbox || !lightboxImage) {
        return;
      }
      lightboxImage.src = src;
      lightbox.classList.remove("is-hidden");
      lightbox.setAttribute("aria-hidden", "false");
    });
  });

  form.querySelector("[data-close-lightbox]")?.addEventListener("click", () => {
    lightbox?.classList.add("is-hidden");
    lightbox?.setAttribute("aria-hidden", "true");
    if (lightboxImage) {
      lightboxImage.src = "";
    }
  });

  lightbox?.addEventListener("click", (event) => {
    if (event.target === lightbox) {
      lightbox.classList.add("is-hidden");
      lightbox.setAttribute("aria-hidden", "true");
      if (lightboxImage) {
        lightboxImage.src = "";
      }
    }
  });

  form.querySelector("[data-save-draft]")?.addEventListener("click", () => {
    activeDraft = collectDraftFromForm(form, activeDraft, "review");
    writeDraft(activeDraft);
    setFeedback("success", "Draft saved. You can continue editing or publish when ready.");
    rerenderWizard(container);
  });

  form.querySelector("[data-preview-product]")?.addEventListener("click", () => {
    const previewSection = form.querySelector(".pm-review-live-preview");
    if (previewSection) {
      previewSection.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const catalogId = String(activeDraft.productId || activeDraft.savedProductId || "").trim();
    if (catalogId) {
      window.open(buildProductViewUrl(catalogId), "_blank", "noopener");
    }
  });

  form.querySelector("[data-duplicate-product]")?.addEventListener("click", () => {
    activeDraft = collectDraftFromForm(form, activeDraft, "review");
    const copyName = String(activeDraft.info?.name || "Product").trim();
    activeDraft = sanitizeDraft({
      ...activeDraft,
      productId: "",
      savedProductId: "",
      info: {
        ...activeDraft.info,
        name: copyName.endsWith("(Copy)") ? copyName : `${copyName} (Copy)`,
        sku: ""
      }
    });
    writeDraft(activeDraft);
    setFeedback("success", "Product duplicated as a new draft. Update details before publishing.");
    window.location.hash = buildCreateHash("info");
    rerenderWizard(container);
  });
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

function mountWizard(container) {
  if (saveSuccess) {
    container.querySelector("[data-add-another]")?.addEventListener("click", () => {
      activeDraft = createDefaultDraft();
      clearPendingMedia();
      uploadProgress = { message: "", percent: null };
      saveSuccess = null;
      isSaving = false;
      workflowFeedback = { tone: "", message: "" };
      clearDraft();
      window.location.hash = buildCreateHash("info");
      rerenderWizard(container);
    });
    return;
  }

  const form = container.querySelector("[data-product-wizard]");
  if (!form) {
    return;
  }

  const currentStep = getWizardStep(activeDraft.step || "info");

  if (currentStep === "info") {
    bindInfoStepEnhancements(form);
  }
  if (currentStep === "inventory") {
    bindInventoryStepEnhancements(form);
  }
  if (currentStep === "seo") {
    bindSeoStepEnhancements(form, activeDraft);
  }
  if (currentStep === "review") {
    bindReviewStepEnhancements(form, container);
  }

  form.querySelectorAll("[data-step-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetStep = button.getAttribute("data-step-nav");
      const targetIndex = getStepIndex(targetStep);
      const currentIndex = getStepIndex(currentStep);
      if (targetIndex <= currentIndex) {
        activeDraft = collectDraftFromForm(form, activeDraft, currentStep);
        writeDraft(activeDraft);
        goToStep(container, targetStep);
      }
    });
  });

  form.querySelector("[data-prev-step]")?.addEventListener("click", () => {
    const index = getStepIndex(currentStep);
    if (index <= 0) {
      return;
    }
    activeDraft = collectDraftFromForm(form, activeDraft, currentStep);
    writeDraft(activeDraft);
    goToStep(container, WIZARD_STEPS[index - 1].id);
  });

  form.querySelector("[data-next-step]")?.addEventListener("click", () => {
    activeDraft = collectDraftFromForm(form, activeDraft, currentStep);
    const validationOptions = getMainImageValidationOptions(activeDraft);
    traceWizard("continue:collected-draft", {
      step: currentStep,
      pendingMainFile: Boolean(pendingMainFile),
      pendingMainPreviewUrl: Boolean(pendingMainPreviewUrl),
      draftMainImage: activeDraft?.media?.mainImage || "",
      draftPendingMainFile: Boolean(activeDraft?.media?.pendingMainFile),
      hasMainImageSelection: validationOptions.hasPendingMainImage
    });

    const errors = validateStep(currentStep, activeDraft, validationOptions);
    if (errors.length) {
      warnWizardValidation("continue", {
        step: currentStep,
        errors,
        ...validationOptions,
        pendingMainFile: Boolean(pendingMainFile)
      });
      setFeedback("danger", errors[0]);
      rerenderWizard(container);
      return;
    }

    setFeedback("", "");
    writeDraft(activeDraft);
    const index = getStepIndex(currentStep);
    goToStep(container, WIZARD_STEPS[Math.min(index + 1, WIZARD_STEPS.length - 1)].id);
  });

  form.querySelector("[data-add-variant]")?.addEventListener("click", () => {
    activeDraft = collectDraftFromForm(form, activeDraft, currentStep);
    const nextIndex = (activeDraft.inventory.variants || []).length + 1;
    activeDraft.inventory.variants = [
      ...(activeDraft.inventory.variants || []),
      { label: `Variant ${nextIndex}`, colorName: "", image: "", stock: "0" }
    ];
    activeDraft.inventory.variantsEnabled = true;
    writeDraft(activeDraft);
    rerenderWizard(container);
  });

  form.querySelectorAll("[data-remove-variant]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.getAttribute("data-remove-variant"));
      activeDraft = collectDraftFromForm(form, activeDraft, currentStep);
      activeDraft.inventory.variants = (activeDraft.inventory.variants || []).filter((_entry, entryIndex) => entryIndex !== index);
      writeDraft(activeDraft);
      rerenderWizard(container);
    });
  });

  form.querySelector("[data-add-custom-size]")?.addEventListener("click", () => {
    const input = form.querySelector('[name="customSizeInput"]');
    const value = String(input?.value || "").trim();
    if (!value) {
      return;
    }
    activeDraft = collectDraftFromForm(form, activeDraft, currentStep);
    const existing = new Set([...(activeDraft.inventory.sizes || []), ...(activeDraft.inventory.customSizes || [])]);
    if (!existing.has(value)) {
      activeDraft.inventory.customSizes = [...(activeDraft.inventory.customSizes || []), value];
      activeDraft.inventory.sizes = [...(activeDraft.inventory.sizes || []), value];
    }
    if (input) {
      input.value = "";
    }
    writeDraft(activeDraft);
    rerenderWizard(container);
  });

  const mainInput = form.querySelector("[data-main-input]");
  const mainDropzone = form.querySelector("[data-drop-main]");
  bindDropzone(mainDropzone, mainInput, (files) => {
    const file = files[0];
    const validationError = validateImageFile(file);
    if (validationError) {
      setFeedback("danger", validationError);
      rerenderWizard(container);
      return;
    }

    setPendingMainFile(file);
    activeDraft = collectDraftFromForm(form, activeDraft, currentStep);
    traceWizard("media:main-selected", {
      fileName: file?.name || "",
      fileSize: file?.size || 0,
      pendingMainFile: Boolean(pendingMainFile),
      draftPendingMainFile: Boolean(activeDraft?.media?.pendingMainFile)
    });
    setFeedback("", "");
    writeDraft(activeDraft);
    rerenderWizard(container);
  });

  form.querySelector("[data-remove-main]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    setPendingMainFile(null);
    activeDraft = collectDraftFromForm(form, activeDraft, currentStep);
    activeDraft.media = removeMainImage(activeDraft);
    writeDraft(activeDraft);
    rerenderWizard(container);
  });

  const galleryInput = form.querySelector("[data-gallery-input]");
  const galleryDropzone = form.querySelector("[data-drop-gallery]");
  bindDropzone(galleryDropzone, galleryInput, (files) => {
    const validFiles = [];
    for (const file of files) {
      const validationError = validateImageFile(file);
      if (validationError) {
        setFeedback("danger", validationError);
        rerenderWizard(container);
        return;
      }
      validFiles.push(file);
    }

    addPendingGalleryFiles(validFiles);
    activeDraft = collectDraftFromForm(form, activeDraft, currentStep);
    setFeedback("", "");
    writeDraft(activeDraft);
    rerenderWizard(container);
  });

  form.querySelectorAll("[data-remove-gallery]").forEach((button) => {
    button.addEventListener("click", () => {
      const removeKey = String(button.getAttribute("data-remove-gallery") || "");
      activeDraft = collectDraftFromForm(form, activeDraft, currentStep);

      if (removeKey.startsWith("pending:")) {
        const index = Number(removeKey.split(":")[1]);
        const entry = pendingGalleryEntries[index];
        if (entry?.previewUrl) {
          URL.revokeObjectURL(entry.previewUrl);
        }
        pendingGalleryEntries.splice(index, 1);
      } else if (removeKey.startsWith("saved:")) {
        const index = Number(removeKey.split(":")[1]);
        activeDraft.media = removeGalleryItem(activeDraft, index);
      }

      writeDraft(activeDraft);
      rerenderWizard(container);
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isSaving) {
      return;
    }

    activeDraft = collectDraftFromForm(form, activeDraft, currentStep);
    const validationOptions = getMainImageValidationOptions(activeDraft);
    traceWizard("save:collected-draft", {
      pendingMainFile: Boolean(pendingMainFile),
      pendingGalleryCount: getPendingGalleryFiles().length,
      draftMainImage: activeDraft?.media?.mainImage || "",
      draftPendingMainFile: Boolean(activeDraft?.media?.pendingMainFile),
      hasMainImageSelection: validationOptions.hasPendingMainImage
    });

    const errors = validateAllSteps(activeDraft, validationOptions);
    if (!validationOptions.hasPendingMainImage) {
      errors.push("Main product image is required.");
    }
    if (errors.length) {
      warnWizardValidation("save", {
        errors,
        ...validationOptions,
        pendingMainFile: Boolean(pendingMainFile)
      });
      setFeedback("danger", errors[0]);
      rerenderWizard(container);
      return;
    }

    isSaving = true;
    uploadProgress = { message: "Preparing uploads...", percent: 5 };
    rerenderWizard(container);

    try {
      traceWizard("save:upload-start", {
        pendingMainFile: Boolean(pendingMainFile),
        pendingGalleryCount: getPendingGalleryFiles().length,
        draftMainImage: activeDraft?.media?.mainImage || ""
      });

      const resolvedMedia = await resolveDraftMedia(
        activeDraft,
        pendingMainFile,
        getPendingGalleryFiles(),
        (progress) => {
          uploadProgress = {
            message: progress.message || "Uploading...",
            percent: progress.percent ?? uploadProgress.percent ?? 10
          };
          const statusEl = container.querySelector(".pm-alert-neutral");
          if (statusEl) {
            statusEl.textContent = uploadProgress.message;
          }
        }
      );

      traceWizard("save:upload-complete", {
        mainImage: resolvedMedia.mainImage || "",
        mainImageStoragePath: resolvedMedia.mainImageStoragePath || "",
        galleryCount: (resolvedMedia.gallery || []).length
      });

      activeDraft.media = resolvedMedia;
      clearPendingMedia();
      writeDraft(activeDraft);

      uploadProgress = { message: "Saving product to catalog...", percent: 92 };
      rerenderWizard(container);

      const payload = buildProductPayload(activeDraft, {
        mainImage: resolvedMedia.mainImage,
        mainImageStoragePath: resolvedMedia.mainImageStoragePath,
        gallery: resolvedMedia.gallery,
        galleryStoragePaths: resolvedMedia.galleryStoragePaths
      });

      traceWizard("save:payload-ready", {
        name: payload.name,
        mainImage: payload.mainImage || "",
        mainImageStoragePath: payload.mainImageStoragePath || "",
        galleryCount: (payload.gallery || []).length
      });

      const productId = String(activeDraft.productId || activeDraft.savedProductId || "").trim();
      const savedProduct = productId
        ? await updateProductAndSync(productId, payload, {
            onProgress: (progress) => {
              uploadProgress = { message: progress.message || "Saving product...", percent: progress.percent ?? 95 };
            }
          })
        : await createProductAndSync(payload, {
            onProgress: (progress) => {
              uploadProgress = { message: progress.message || "Saving product...", percent: progress.percent ?? 95 };
            }
          });

      traceWizard("save:complete", {
        productId: String(savedProduct?.id || savedProduct?.catalogId || "")
      });

      activeDraft.savedProductId = String(savedProduct?.id || savedProduct?.catalogId || "");
      activeDraft.productId = activeDraft.savedProductId;
      saveSuccess = savedProduct;
      isSaving = false;
      uploadProgress = { message: "", percent: null };
      workflowFeedback = { tone: "", message: "" };
      writeDraft(activeDraft);
      rerenderWizard(container);
    } catch (error) {
      console.error("[ProductWizard] Save failed", {
        message: error?.message || "Unknown error",
        pendingMainFile: Boolean(pendingMainFile),
        draftMainImage: activeDraft?.media?.mainImage || ""
      });
      isSaving = false;
      setFeedback("danger", String(error?.message || "Unable to save the product."));
      rerenderWizard(container);
    }
  });
}

export function mountProductWizard(container, initialDraft) {
  const preservePendingMedia = Boolean(
    pendingMainFile
    || pendingMainPreviewUrl
    || pendingGalleryEntries.length
    || isSaving
  );
  const preserveSuccessState = Boolean(saveSuccess);

  activeDraft = sanitizeDraft(initialDraft || createDefaultDraft());
  if (!preservePendingMedia) {
    clearPendingMedia();
  }
  if (!isSaving) {
    uploadProgress = { message: "", percent: null };
  }
  if (!preserveSuccessState) {
    saveSuccess = null;
  }
  if (!isSaving && !preserveSuccessState) {
    workflowFeedback = { tone: "", message: "" };
  }
  activeDraft.step = getWizardStep(activeDraft.step || "info");
  container.innerHTML = renderWizardMarkup(activeDraft, activeDraft.step);
  mountWizard(container);
}

export { hydrateDraftFromProduct };
