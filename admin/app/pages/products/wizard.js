import { createProductAndSync, updateProductAndSync } from "../../services/admin-data.service.js";
import {
  CATEGORY_OPTIONS,
  COUNTRY_OF_ORIGIN_OPTIONS,
  FALLBACK_IMAGE,
  PRODUCT_CONDITION_OPTIONS,
  PRODUCT_STATUS_OPTIONS,
  PRODUCT_TYPE_OPTIONS,
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
import { buildAutoSeo, buildProductPayload, validateAllSteps, validateStep } from "./payload.js";
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
              <strong>${escapeHtml(step.labelRw)} / ${escapeHtml(step.labelEn)}</strong>
              <small>${escapeHtml(step.shortRw)} / ${escapeHtml(step.shortEn)}</small>
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
  return `
    <select name="${escapeHtml(name)}">
      ${CATEGORY_OPTIONS.map((option) => {
        const selected = option.value === selectedValue ? "selected" : "";
        return `<option value="${escapeHtml(option.value)}" ${selected}>${escapeHtml(option.labelRw)} / ${escapeHtml(option.labelEn)}</option>`;
      }).join("")}
    </select>
  `;
}

function renderInfoStep(draft) {
  const info = draft.info || {};

  const basicFields = `
    ${renderBilingualField("Izina rya Product", "Product Name", `<input type="text" name="name" value="${escapeHtml(info.name)}" placeholder="Urugero: Inkweto za Premium" required />`, "Izina ryuzuye rikoreshwa mu bubiko n'ahantu product igaragara.", "pm-field--span-2")}
    ${renderBilingualField("Izina Rigufi rya Product", "Short Product Name", `<input type="text" name="shortName" value="${escapeHtml(info.shortName)}" placeholder="Urugero: Inkweto za Premium" />`, "Ikoreshwa ku makarita, muri cart no mu gushakisha.")}
    ${renderBilingualField("Icyiciro", "Category", renderCategorySelect("category", info.category), "Hitamo icyiciro cy'ingenzi.", "pm-field--required")}
    ${renderBilingualField("Ikirango", "Brand", `<input type="text" name="brand" value="${escapeHtml(info.brand)}" placeholder="Izina ry'ikirango" />`)}
    ${renderBilingualField("Ubwoko bwa Product", "Product Type", renderOptionSelect("productType", PRODUCT_TYPE_OPTIONS, info.productType, true))}
    ${renderBilingualField("Imiterere ya Product", "Product Condition", renderOptionSelect("condition", PRODUCT_CONDITION_OPTIONS, info.condition, true))}
    ${renderBilingualField("Uruganda", "Manufacturer", `<input type="text" name="manufacturer" value="${escapeHtml(info.manufacturer)}" placeholder="Izina ry'uruganda" />`, "Bishobora gutandukana n'ikirango.")}
    ${renderBilingualField("Igihugu Yakorewemo", "Country of Origin", `
      <select name="countryOfOrigin">
        <option value="">Hitamo igihugu / Select country</option>
        ${COUNTRY_OF_ORIGIN_OPTIONS.map((country) => `<option value="${escapeHtml(country)}" ${country === info.countryOfOrigin ? "selected" : ""}>${escapeHtml(country)}</option>`).join("")}
      </select>
    `)}
  `;

  const optionalFields = `
    ${renderBilingualField("Tags", "Tags", `<input type="text" name="tags" value="${escapeHtml(info.tags)}" placeholder="itunda, sale, featured" />`, "Tandukanya tags ukoresheje akanya.")}
    ${renderBilingualField("Iby'ingenzi bya Product", "Product Highlights", `<input type="text" name="highlights" value="${escapeHtml(info.highlights)}" placeholder="Product y'umwimerere, Waterproof, Fast Charging" />`, "Tandukanya iby'ingenzi ukoresheje akanya.")}
    ${renderBilingualField("Garanti", "Warranty", renderOptionSelect("warranty", WARRANTY_OPTIONS, info.warranty, true))}
    ${renderBilingualField("Garanti Yihariye", "Custom Warranty", `<input type="text" name="warrantyCustom" value="${escapeHtml(info.warrantyCustom)}" placeholder="Urugero: Garanti y'amezi 18" ${info.warranty === "custom" ? "" : "disabled"} />`, "Byakenewe gusa iyo garanti ari Custom.", info.warranty === "custom" ? "" : "pm-field--conditional is-hidden")}
  `;

  return `
    <div class="pm-step-panel pm-step-panel--info">
      <header class="pm-step-header">
        <h2><span class="pm-section-rw">Amakuru y'ibanze</span> <span class="pm-section-sep">/</span> <span class="pm-section-en">Basic Information</span></h2>
        <p>Andika amakuru y'ingenzi ya product: izina, icyiciro, ikirango n'imiterere.</p>
      </header>
      ${renderFormSection("Amakuru y'ibanze", "Basic Information", "Izina, icyiciro, ikirango, ubwoko n'imiterere ya product.", basicFields)}
      ${renderFormSection("Ibindi Bisobanura", "Additional Details", "Tags, iby'ingenzi na garanti — byongera agaciro ka product.", optionalFields)}
    </div>
  `;
}

function renderPricingStep(draft) {
  const pricing = draft.pricing || {};
  return `
    <div class="pm-step-panel">
      <header class="pm-step-header">
        <h2><span class="pm-section-rw">Ibiciro</span> <span class="pm-section-sep">/</span> <span class="pm-section-en">Pricing</span></h2>
        <p>Shyiraho igiciro cyo kugura, cyo kugurisha n'igabanywa rishobora kuba.</p>
      </header>
      <div class="pm-form-grid">
        ${renderBilingualField("Igiciro cyo Kugura", "Cost Price", `<input type="number" min="0" step="1" name="costPrice" value="${escapeHtml(pricing.costPrice)}" placeholder="0" />`, "Igiciro waguze product — byifashishwa mu raporo.")}
        ${renderBilingualField("Igiciro cyo Kugurisha", "Selling Price", `<input type="number" min="0" step="1" name="sellingPrice" value="${escapeHtml(pricing.sellingPrice)}" placeholder="0" required />`, "Igiciro abakiriya babona ku rubuga.", "pm-field--required")}
        ${renderBilingualField("Igiciro cyo Kugabanywa", "Discount Price", `<input type="number" min="0" step="1" name="discountPrice" value="${escapeHtml(pricing.discountPrice)}" placeholder="Igiciro cy'imbere y'igabanywa" />`, "Shyiraho igiciro kinini kugira ngo igabanywa rigaragare.")}
        ${renderBilingualField("Umusoro (%)", "Tax Rate (%)", `<input type="number" min="0" max="100" step="0.1" name="taxRate" value="${escapeHtml(pricing.taxRate)}" placeholder="18" />`)}
      </div>
      <label class="pm-check">
        <input type="checkbox" name="taxIncluded" ${pricing.taxIncluded ? "checked" : ""} />
        <span>Igiciro kirimo umusoro / Price includes tax</span>
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
        <h2><span class="pm-section-rw">Ububiko</span> <span class="pm-section-sep">/</span> <span class="pm-section-en">Inventory</span></h2>
        <p>Genzura stock, SKU, ingano n'amoko ya product.</p>
      </header>

      <section class="pm-form-section">
        <header class="pm-form-section-head">
          <h3 class="pm-form-section-title"><span class="pm-section-rw">Stock</span><span class="pm-section-sep">/</span><span class="pm-section-en">Stock Management</span></h3>
        </header>
        <div class="pm-form-grid">
          ${renderBilingualField("SKU", "SKU", `<input type="text" name="sku" value="${escapeHtml(inventory.sku || "")}" placeholder="Kode y'ububiko" />`, "Kode yihariye yo gucunga stock.")}
          ${renderBilingualField("Umubare wa Stock", "Stock Quantity", `<input type="number" min="0" step="1" name="quantity" value="${escapeHtml(String(quantityValue))}" ${variants.length ? "readonly" : ""} required />`, variants.length ? "Bibarwa mu buryo bwikora uhereye ku variants." : "Andika umubare uri mu bubiko.", "pm-field--required")}
          <div class="pm-field">
            <span class="pm-field-label pm-field-label--bilingual"><span class="pm-field-label-rw">Imiterere ya Stock</span><span class="pm-field-label-sep">/</span><span class="pm-field-label-en">Stock Status</span></span>
            <div class="pm-stock-badge pm-stock-badge--${escapeHtml(status.key)}" data-stock-status-badge>${escapeHtml(status.rw)} / ${escapeHtml(status.en)}</div>
            <small class="pm-field-hint">Imiterere igena mu buryo bwikora uhereye ku mubare wa stock.</small>
          </div>
        </div>
      </section>

      <section class="pm-form-section">
        <header class="pm-form-section-head">
          <h3 class="pm-form-section-title"><span class="pm-section-rw">Ingano n'Ibiranga</span><span class="pm-section-sep">/</span><span class="pm-section-en">Sizes & Attributes</span></h3>
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
              <button type="button" class="pm-btn pm-btn-ghost" data-add-custom-size>Ongeramo Ingano / Add Custom Size</button>
            </div>
          </div>
          ${attributeFields || `<div class="pm-field pm-field--span-2"><small class="pm-field-hint">Nta biranga by'icyiciro byongewe kuri iri cyiciro.</small></div>`}
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
              <span>Koresha Variants / Enable Variants</span>
            </label>
            <button type="button" class="pm-btn pm-btn-ghost" data-add-variant ${inventory.variantsEnabled ? "" : "disabled"}>Ongeramo Variant / Add Variant</button>
          </div>
          <div class="pm-variant-cards ${inventory.variantsEnabled ? "" : "is-disabled"}">
            ${variants.map((variant, index) => `
              <article class="pm-variant-item" data-variant-index="${index}">
                <input type="text" name="variantLabel" value="${escapeHtml(variant.label || "")}" placeholder="Izina rya Variant / Variant Label" />
                <input type="text" name="variantColor" value="${escapeHtml(variant.colorName || "")}" placeholder="Ibara / Color" />
                <input type="url" name="variantImage" value="${escapeHtml(variant.image || "")}" placeholder="URL y'ifoto" />
                <input type="number" min="0" step="1" name="variantStock" value="${escapeHtml(String(variant.stock || "0"))}" placeholder="Stock" />
                <button type="button" class="pm-btn pm-btn-danger" data-remove-variant="${index}">Kuraho / Remove</button>
              </article>
            `).join("")}
          </div>
          <div class="pm-stock-total">Stock Yose / Total Stock: <strong data-total-variant-stock>${escapeHtml(String(quantityValue))}</strong></div>
        </div>
      </section>
    </div>
  `;
}

function renderDescriptionStep(draft) {
  const description = draft.description || {};
  const descriptionFields = `
    ${renderBilingualField("Ibisobanuro Bigufi", "Short Description", `<textarea name="shortDescription" rows="4" placeholder="Ibisobanuro bigufi bigaragara ku makarita no mu gushakisha." required>${escapeHtml(description.shortDescription)}</textarea>`, "Garagara ku makarta, mu gushakisha no kuri homepage.", "pm-field--span-2 pm-field--required")}
    ${renderBilingualField("Ibisobanuro Birambuye", "Long Description", `<textarea name="longDescription" rows="8" placeholder="Ibisobanuro birambuye: ibiranga, ibikoresho, inyungu n'uko ikoreshwa.">${escapeHtml(description.longDescription || description.description)}</textarea>`, "Garagara ku rupapuro rw'ibisobanuro bya product.", "pm-field--span-2")}
  `;

  return `
    <div class="pm-step-panel pm-step-panel--description">
      <header class="pm-step-header">
        <h2><span class="pm-section-rw">Ibisobanuro</span> <span class="pm-section-sep">/</span> <span class="pm-section-en">Product Description</span></h2>
        <p>Andika ibisobanuro bigufi n'ibirambuye bya product.</p>
      </header>
      ${renderFormSection("Ibisobanuro bya Product", "Product Description", "Ibisobanuro bigufi n'ibirambuye.", descriptionFields)}
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
        <h2><span class="pm-section-rw">Amafoto</span> <span class="pm-section-sep">/</span> <span class="pm-section-en">Media</span></h2>
        <p>Shyiraho ifoto nyamukuru n'amafoto y'inyongera ya product.</p>
      </header>
      <div class="pm-media-layout">
        <section class="pm-upload-card">
          <h3>Amafoto ya Product / Product Images</h3>
          <div class="pm-dropzone ${hasMainImageSelection(draft) ? "has-file" : ""}" data-drop-main>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden data-main-input />
            <img src="${escapeHtml(mainPreview)}" alt="Main product preview" class="pm-main-preview" data-main-preview />
            <div class="pm-dropzone-copy">
              <strong>Kurura cyangwa ukande kugira ngo wohereze / Drag & drop or click to upload</strong>
              <span>JPG, PNG, WEBP, GIF, AVIF — kugeza kuri 5MB</span>
            </div>
            ${hasMainImageSelection(draft) ? `<button type="button" class="pm-btn pm-btn-danger" data-remove-main>Kuraho / Remove</button>` : ""}
          </div>
        </section>
        <section class="pm-upload-card">
          <h3>Gallery y'Amafoto / Product Gallery</h3>
          <div class="pm-dropzone" data-drop-gallery>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple hidden data-gallery-input />
            <div class="pm-dropzone-copy">
              <strong>Kurura amafoto menshi hano / Drop multiple images here</strong>
              <span>Ongeramo amafoto y'inyongera ya product</span>
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

function renderPublishStep(draft) {
  const info = draft.info || {};
  const autoSeo = buildAutoSeo(info, draft.description || {}, info.brand);

  const publishFields = `
    ${renderBilingualField("Product Yihariye", "Featured Product", `
      <label class="pm-check pm-check-inline">
        <input type="checkbox" name="featuredProduct" ${info.featuredProduct ? "checked" : ""} />
        <span>Erekana nk'igicuruzwa cy'ingenzi / Show as featured product</span>
      </label>
    `, "Product yihariye igaragara ku homepage no mu byiciro by'ingenzi.")}
    ${renderBilingualField("Aho Product Igaragara", "Visibility", renderOptionSelect("visibility", VISIBILITY_OPTIONS, info.visibility, true), "Hitamo aho product igaragara ku rubuga.")}
    ${renderBilingualField("Imiterere ya Product", "Product Status", renderOptionSelect("publishStatus", PRODUCT_STATUS_OPTIONS, info.publishStatus || "active", true), "Active = iragurishwa. Draft = ntirasohorwa. Inactive = iraboneka gusa.", "pm-field--required")}
  `;

  return `
    <div class="pm-step-panel pm-step-panel--publish">
      <header class="pm-step-header">
        <h2><span class="pm-section-rw">Gusohora Product</span> <span class="pm-section-sep">/</span> <span class="pm-section-en">Publishing</span></h2>
        <p>Hitamo uko product igaragara no gusohora ku rubuga.</p>
      </header>
      ${renderFormSection("Gusohora", "Publishing Options", "Featured, visibility na status ya product.", publishFields)}
      <aside class="pm-auto-note card">
        <h3>Gushakishwa no Kumenyekana / Discovery & Search</h3>
        <p>Sisitemu ikora mu buryo bwikora: gushakisha, SEO, ranking, Best Sellers, Recommended na Trending — ntacyo ugomba guhitamo wewe.</p>
        <dl class="pm-review-dl pm-review-dl--compact">
          ${renderReviewRow("Umutwe wa Meta", "Auto Meta Title", escapeHtml(autoSeo.metaTitle || "-"))}
          ${renderReviewRow("URL ya Product", "Auto Slug", escapeHtml(autoSeo.slug || "-"))}
        </dl>
      </aside>
    </div>
  `;
}

function renderReviewStep(draft) {
  const payload = buildProductPayload(draft);
  const inventory = draft.inventory || {};
  const info = draft.info || {};
  const description = draft.description || {};
  const pricing = draft.pricing || {};
  const media = draft.media || {};
  const validationOptions = getMainImageValidationOptions(draft);
  const health = computeProductHealth(draft, validationOptions);
  const pricingSummary = computePricingSummary(pricing);
  const currency = pricing.currency || "RWF";
  const mainImageUrl = pendingMainPreviewUrl || media.mainImage || "";
  const galleryItems = getReviewGalleryItems(draft);
  const variantItems = Array.isArray(inventory.variants) ? inventory.variants : [];
  const variantImages = variantItems.filter((entry) => String(entry?.image || "").trim());
  const autoSeo = buildAutoSeo(info, description, info.brand);
  const productUrl = `https://byosemarket.com/product/${payload.slug || slugify(info.name)}`;
  const visibilityLabel = VISIBILITY_OPTIONS.find((entry) => entry.value === info.visibility);
  const statusLabel = PRODUCT_STATUS_OPTIONS.find((entry) => entry.value === info.publishStatus);
  const productTypeLabel = PRODUCT_TYPE_OPTIONS.find((entry) => entry.value === info.productType);
  const conditionLabel = PRODUCT_CONDITION_OPTIONS.find((entry) => entry.value === info.condition);
  const warrantyLabel = WARRANTY_OPTIONS.find((entry) => entry.value === info.warranty);
  const categoryLabel = CATEGORY_OPTIONS.find((entry) => entry.value === info.category);
  const allSizes = [...new Set([...(inventory.sizes || []), ...(inventory.customSizes || [])])];
  const displayPrice = pricingSummary.current || payload.price;
  const previewName = info.shortName || info.name || "Product Name";
  const previewDesc = description.shortDescription || autoSeo.metaDescription || description.longDescription || "";

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
    renderReviewRow("Icyiciro", "Category", escapeHtml(categoryLabel ? `${categoryLabel.labelRw} / ${categoryLabel.labelEn}` : toLabel(info.category))),
    renderReviewRow("Ubwoko bwa Product", "Product Type", escapeHtml(productTypeLabel ? `${productTypeLabel.labelRw} / ${productTypeLabel.labelEn}` : "-")),
    renderReviewRow("Ikirango", "Brand", escapeHtml(info.brand || "-")),
    renderReviewRow("Uruganda", "Manufacturer", escapeHtml(info.manufacturer || "-")),
    renderReviewRow("Imiterere ya Product", "Product Condition", escapeHtml(conditionLabel ? `${conditionLabel.labelRw} / ${conditionLabel.labelEn}` : "-")),
    renderReviewRow("Igihugu Yakorewemo", "Country of Origin", escapeHtml(info.countryOfOrigin || "-")),
    renderReviewRow("Tags", "Tags", escapeHtml(formatReviewList(payload.tags))),
    renderReviewRow("Iby'ingenzi", "Product Highlights", escapeHtml(formatReviewList(payload.highlights))),
    renderReviewRow("Garanti", "Warranty", escapeHtml(warrantyLabel ? `${warrantyLabel.labelRw} / ${warrantyLabel.labelEn}${info.warrantyCustom ? ` (${info.warrantyCustom})` : ""}` : "-"))
  ].join("");

  const pricingRows = [
    renderReviewRow("Igiciro cyo Kugura", "Cost Price", escapeHtml(pricing.costPrice ? formatReviewCurrency(payload.costPrice, currency) : "-")),
    renderReviewRow("Igiciro cyo Kugurisha", "Selling Price", escapeHtml(pricing.sellingPrice ? formatReviewCurrency(pricingSummary.selling, currency) : "-")),
    renderReviewRow("Igiciro cyo Kugabanywa", "Discount Price", escapeHtml(pricing.discountPrice ? formatReviewCurrency(pricingSummary.discountField, currency) : "-")),
    renderReviewRow("Umusoro", "Tax Rate", escapeHtml(pricing.taxRate ? `${payload.taxRate}% ${payload.taxIncluded ? "(kirimo / included)" : "(ntikirimo / excluded)"}` : "-"))
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
    renderReviewRow("SKU", "SKU", escapeHtml(inventory.sku || "-")),
    renderReviewRow("Stock Yose", "Total Quantity", escapeHtml(String(payload.stock))),
    renderReviewRow("Imiterere ya Stock", "Stock Status", `<span class="pm-stock-badge pm-stock-badge--${escapeHtml(inventory.stockStatus || "out_of_stock")}">${escapeHtml(getStockStatusLabel(inventory.stockStatus))}</span>`),
    renderReviewRow("Amoko", "Total Variants", escapeHtml(String(variantItems.length))),
    renderReviewRow("Ingano Zihari", "Available Sizes", escapeHtml(formatReviewList(allSizes))),
    renderReviewRow("Amoko ya Product", "Variants Enabled", escapeHtml(inventory.variantsEnabled ? "Yego / Yes" : "Oya / No")),
    renderReviewRow("Ibiranga", "Category Attributes", escapeHtml(formatInventoryAttributes(inventory.attributes)))
  ].join("");

  const descriptionRows = [
    renderReviewRow("Ibisobanuro Bigufi", "Short Description", escapeHtml(description.shortDescription || "-")),
    renderReviewRow("Ibisobanuro Birambuye", "Long Description", escapeHtml(description.longDescription || description.description || "-"))
  ].join("");

  const publishRows = [
    renderReviewRow("Product Yihariye", "Featured Product", escapeHtml(info.featuredProduct ? "Yego / Yes" : "Oya / No")),
    renderReviewRow("Aho Product Igaragara", "Visibility", escapeHtml(visibilityLabel ? `${visibilityLabel.labelRw} / ${visibilityLabel.labelEn}` : "-")),
    renderReviewRow("Imiterere", "Product Status", escapeHtml(statusLabel ? `${statusLabel.labelRw} / ${statusLabel.labelEn}` : "-"))
  ].join("");

  const seoRows = [
    renderReviewRow("Umutwe wa Meta", "Auto Meta Title", escapeHtml(payload.metaTitle || "-")),
    renderReviewRow("Ibisobanuro bya Meta", "Auto Meta Description", escapeHtml(payload.metaDescription || "-")),
    renderReviewRow("URL ya Product", "Auto Slug", escapeHtml(payload.slug || "-"))
  ].join("");

  return `
    <div class="pm-step-panel pm-step-panel--review">
      <header class="pm-step-header">
        <h2><span class="pm-section-rw">Gusuzuma no Kubika</span> <span class="pm-section-sep">/</span> <span class="pm-section-en">Review & Save</span></h2>
        <p>Reba byose ushyireho mbere yo gusohora product ku rubuga.</p>
      </header>

      <section class="pm-review-dashboard">
        <article class="pm-review-health card">
          <div class="pm-review-health-head">
            <div>
              <h3>Product Health Check</h3>
              <p>Urwego rwo Kurangiza / Completion Score</p>
            </div>
            <strong class="pm-review-completion">${health.percent}% Complete</strong>
          </div>
          <ul class="pm-review-health-list">${healthChecks}</ul>
          ${warningCards ? `<div class="pm-review-warnings">${warningCards}</div>` : ""}
        </article>
      </section>

      <div class="pm-review-sections">
        ${renderReviewSection("Amakuru y'ibanze", "Basic Information", infoRows)}
        ${renderReviewSection("Ibiciro", "Pricing Summary", pricingRows, pricingDiscountBlock)}
        ${renderReviewSection("Ububiko", "Inventory Summary", inventoryRows)}
        ${renderReviewSection("Ibisobanuro", "Description", descriptionRows)}
        ${renderReviewSection("Amoko ya Product", "Variant Summary", renderReviewRow("Amoko", "Total Variants", escapeHtml(String(variantItems.length))), `<div class="pm-variant-review-grid">${variantCards}</div>`)}
        ${renderReviewSection("Amafoto", "Media Summary", "", mediaGallery)}
        ${renderReviewSection("Gusohora", "Publishing", publishRows)}
        ${renderReviewSection("Gushakishwa", "Auto Search & SEO", seoRows, `
          <div class="pm-seo-preview pm-seo-preview--google pm-review-google-preview">
            <div class="pm-seo-preview-title">${escapeHtml(payload.metaTitle || info.name || "Product Title")}</div>
            <div class="pm-seo-preview-url">${escapeHtml(productUrl)}</div>
            <div class="pm-seo-preview-desc">${escapeHtml(payload.metaDescription || previewDesc || "Product description preview.")}</div>
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
    : currentStep === "description" ? renderDescriptionStep(draft)
    : currentStep === "media" ? renderMediaStep(draft)
    : currentStep === "publish" ? renderPublishStep(draft)
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
          <p class="pm-kicker">${isEditing ? "Hindura Product / Edit Product" : "Product Nshya / New Product"}</p>
          <h1>Product Manager</h1>
          <p>Kurikiza intambwe zose kugira ngo usohore product ku rubuga rwa BYOSE Market.</p>
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
  const description = draft?.description || {};
  const pricing = draft?.pricing || {};
  const inventory = draft?.inventory || {};
  const hasImage = Boolean(options.hasPendingMainImage || draft?.media?.mainImage);
  const variantStock = (inventory.variants || []).reduce((sum, entry) => sum + toNumber(entry?.stock, 0), 0);
  const totalStock = inventory.variants?.length ? variantStock : toNumber(inventory.quantity, 0);
  const validationErrors = validateAllSteps(draft, options);

  const checks = [
    { ok: Boolean(String(info.name || "").trim()), label: "Product Name / Izina rya Product" },
    { ok: Boolean(String(info.category || "").trim()), label: "Category / Icyiciro" },
    { ok: toNumber(pricing.sellingPrice, 0) > 0, label: "Price / Igiciro" },
    { ok: hasImage, label: "Images / Amafoto" },
    { ok: totalStock > 0, label: "Inventory / Ububiko" },
    { ok: Boolean(String(description.shortDescription || "").trim()), label: "Description / Ibisobanuro" },
    { ok: !inventory.variantsEnabled || (inventory.variants || []).length > 0, label: "Variants / Amoko" }
  ];

  const passed = checks.filter((entry) => entry.ok).length;
  const percent = Math.round((passed / checks.length) * 100);
  const warnings = [];
  if (!hasImage) warnings.push("Product image missing");
  if (totalStock <= 0) warnings.push("Stock quantity missing");
  if (toNumber(pricing.sellingPrice, 0) <= 0) warnings.push("Price missing");
  if (!String(description.shortDescription || "").trim()) warnings.push("Short description missing");
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
    canPublish: validationErrors.length === 0 && hasImage && toNumber(pricing.sellingPrice, 0) > 0
  };
}

function collectDraftFromForm(form, draft, step = "") {
  const nextDraft = sanitizeDraft({ ...draft });
  const formData = new FormData(form);
  const activeStep = String(step || "").trim().toLowerCase();

  if (activeStep === "info") {
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
      warrantyCustom: String(formData.get("warrantyCustom") ?? nextDraft.info.warrantyCustom ?? "")
    };
  }

  if (activeStep === "description") {
    const longDescription = String(formData.get("longDescription") ?? nextDraft.description?.longDescription ?? "");
    nextDraft.description = {
      shortDescription: String(formData.get("shortDescription") ?? nextDraft.description?.shortDescription ?? ""),
      longDescription,
      description: longDescription
    };
  }

  if (activeStep === "publish") {
    nextDraft.info = {
      ...nextDraft.info,
      featuredProduct: formData.get("featuredProduct") === "on",
      visibility: String(formData.get("visibility") || nextDraft.info.visibility || "both"),
      publishStatus: String(formData.get("publishStatus") || nextDraft.info.publishStatus || "active")
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
      sku: String(formData.get("sku") ?? nextDraft.inventory.sku ?? ""),
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

  if (activeStep === "review" || activeStep === "publish" || activeStep === "description") {
    // Keep SEO auto-generated from collected draft fields.
    const merged = sanitizeDraft(nextDraft);
    const autoSeo = buildAutoSeo(merged.info, merged.description, merged.info?.brand);
    nextDraft.seo = {
      ...merged.seo,
      metaTitle: autoSeo.metaTitle,
      metaDescription: autoSeo.metaDescription,
      slug: autoSeo.slug
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
  const warranty = form.querySelector("[name=\"warranty\"]");
  const warrantyCustom = form.querySelector("[name=\"warrantyCustom\"]");
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
        name: copyName.endsWith("(Copy)") ? copyName : `${copyName} (Copy)`
      },
      inventory: {
        ...activeDraft.inventory,
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
