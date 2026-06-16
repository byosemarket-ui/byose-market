import { createProductAndSync, updateProductAndSync } from "../../services/admin-data.service.js";
import {
  CATEGORY_OPTIONS,
  FALLBACK_IMAGE,
  STOCK_STATUS_OPTIONS,
  VISIBILITY_OPTIONS,
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

function renderInfoStep(draft) {
  const info = draft.info || {};
  return `
    <div class="pm-step-panel">
      <header class="pm-step-header">
        <h2>Product Information</h2>
        <p>Core catalog details used across the storefront and admin listings.</p>
      </header>
      <div class="pm-form-grid">
        ${renderField("Product Name *", `<input type="text" name="name" value="${escapeHtml(info.name)}" placeholder="e.g. Premium Leather Sneakers" required />`)}
        ${renderField("Category *", `
          <select name="category">
            ${CATEGORY_OPTIONS.map((category) => `<option value="${escapeHtml(category)}" ${category === info.category ? "selected" : ""}>${escapeHtml(toLabel(category))}</option>`).join("")}
          </select>
        `)}
        ${renderField("Brand", `<input type="text" name="brand" value="${escapeHtml(info.brand)}" placeholder="Brand name" />`)}
        ${renderField("SKU", `<input type="text" name="sku" value="${escapeHtml(info.sku)}" placeholder="Stock keeping unit" />`)}
        ${renderField("Tags", `<input type="text" name="tags" value="${escapeHtml(info.tags)}" placeholder="summer, sale, featured" />`, "Separate tags with commas.")}
        ${renderField("Visibility", `
          <select name="visibility">
            ${VISIBILITY_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === info.visibility ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
          </select>
        `)}
      </div>
      ${renderField("Description", `<textarea name="description" rows="5" placeholder="Describe the product features, materials, and benefits.">${escapeHtml(info.description)}</textarea>`)}
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

function renderInventoryStep(draft) {
  const inventory = draft.inventory || {};
  const sizeOptions = getSizeOptionsForCategory(draft.info?.category);
  return `
    <div class="pm-step-panel">
      <header class="pm-step-header">
        <h2>Inventory</h2>
        <p>Manage stock levels, availability, and product variants.</p>
      </header>
      <div class="pm-form-grid">
        ${renderField("Quantity", `<input type="number" min="0" step="1" name="quantity" value="${escapeHtml(inventory.quantity)}" />`)}
        ${renderField("Stock Status", `
          <select name="stockStatus">
            ${STOCK_STATUS_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === inventory.stockStatus ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
          </select>
        `)}
      </div>
      <label class="pm-check">
        <input type="checkbox" name="variantsEnabled" ${inventory.variantsEnabled ? "checked" : ""} />
        <span>Enable size and color variants</span>
      </label>
      <div class="pm-variant-grid ${inventory.variantsEnabled ? "" : "is-disabled"}">
        <section class="pm-variant-card">
          <h3>Sizes</h3>
          <div class="pm-chip-grid">
            ${sizeOptions.map((size) => `
              <label class="pm-chip">
                <input type="checkbox" name="sizes" value="${escapeHtml(size)}" ${inventory.sizes?.includes(size) ? "checked" : ""} ${inventory.variantsEnabled ? "" : "disabled"} />
                <span>${escapeHtml(size)}</span>
              </label>
            `).join("")}
          </div>
        </section>
        <section class="pm-variant-card">
          <div class="pm-variant-head">
            <h3>Colors</h3>
            <button type="button" class="pm-btn pm-btn-ghost" data-add-color ${inventory.variantsEnabled ? "" : "disabled"}>Add Color</button>
          </div>
          <div class="pm-color-list" data-color-list>
            ${(inventory.colors || []).map((color, index) => `
              <div class="pm-color-row" data-color-index="${index}">
                <input type="color" name="colorHex" value="${escapeHtml(color.hex || "#00b894")}" />
                <input type="text" name="colorName" value="${escapeHtml(color.name)}" placeholder="Color name" />
                <button type="button" class="pm-btn pm-btn-danger" data-remove-color="${index}">Remove</button>
              </div>
            `).join("")}
          </div>
        </section>
      </div>
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

function renderSeoStep(draft) {
  const seo = draft.seo || {};
  const info = draft.info || {};
  return `
    <div class="pm-step-panel">
      <header class="pm-step-header">
        <h2>SEO</h2>
        <p>Optimize search visibility with meta content and a clean product slug.</p>
      </header>
      <div class="pm-form-grid">
        ${renderField("Meta Title *", `<input type="text" name="metaTitle" value="${escapeHtml(seo.metaTitle || info.name)}" placeholder="SEO page title" />`)}
        ${renderField("Product Slug", `<input type="text" name="slug" value="${escapeHtml(seo.slug || slugify(info.name))}" placeholder="premium-leather-sneakers" />`)}
      </div>
      ${renderField("Meta Description", `<textarea name="metaDescription" rows="4" placeholder="Short summary for search engines and social sharing.">${escapeHtml(seo.metaDescription || info.description)}</textarea>`)}
    </div>
  `;
}

function renderReviewStep(draft) {
  const payload = buildProductPayload(draft);
  const inventory = draft.inventory || {};
  const info = draft.info || {};
  const pricing = draft.pricing || {};
  const seo = draft.seo || {};
  const mainImageReady = hasMainImageSelection(draft) || Boolean(payload.mainImage);
  const reviewPreview = pendingMainPreviewUrl || draft.media?.mainImage || "";
  const galleryItems = getReviewGalleryItems(draft);
  const galleryCount = galleryItems.length;
  const stockStatusLabel = STOCK_STATUS_OPTIONS.find((entry) => entry.value === inventory.stockStatus)?.label
    || toLabel(inventory.stockStatus || "in_stock");
  const visibilityLabel = VISIBILITY_OPTIONS.find((entry) => entry.value === info.visibility)?.label
    || toLabel(info.visibility || "both");

  return `
    <div class="pm-step-panel">
      <header class="pm-step-header">
        <h2>Review & Save</h2>
        <p>Confirm all product details before publishing to the live catalog.</p>
      </header>
      <div class="pm-review-grid">
        <article class="pm-review-card">
          <h3>Product Information</h3>
          <dl>
            <div><dt>Name</dt><dd>${escapeHtml(payload.name || "-")}</dd></div>
            <div><dt>Category</dt><dd>${escapeHtml(toLabel(payload.category))}</dd></div>
            <div><dt>Brand</dt><dd>${escapeHtml(payload.brand || "-")}</dd></div>
            <div><dt>SKU</dt><dd>${escapeHtml(payload.sku || "-")}</dd></div>
            <div><dt>Tags</dt><dd>${escapeHtml(formatReviewList(payload.tags))}</dd></div>
            <div><dt>Visibility</dt><dd>${escapeHtml(visibilityLabel)}</dd></div>
            <div><dt>Description</dt><dd>${escapeHtml(info.description || "-")}</dd></div>
          </dl>
        </article>
        <article class="pm-review-card">
          <h3>Pricing</h3>
          <dl>
            <div><dt>Selling Price</dt><dd>${pricing.sellingPrice ? escapeHtml(formatCurrency(payload.price)) : "-"}</dd></div>
            <div><dt>Discount Price</dt><dd>${pricing.discountPrice ? escapeHtml(formatCurrency(toNumber(pricing.discountPrice, 0))) : "-"}</dd></div>
            <div><dt>Cost Price</dt><dd>${pricing.costPrice ? escapeHtml(formatCurrency(payload.costPrice)) : "-"}</dd></div>
            <div><dt>Tax</dt><dd>${pricing.taxRate ? `${escapeHtml(String(payload.taxRate || 0))}% ${payload.taxIncluded ? "(included)" : "(excluded)"}` : "-"}</dd></div>
          </dl>
        </article>
        <article class="pm-review-card">
          <h3>Inventory & Variants</h3>
          <dl>
            <div><dt>Quantity</dt><dd>${escapeHtml(String(payload.stock))}</dd></div>
            <div><dt>Stock Status</dt><dd>${escapeHtml(stockStatusLabel)}</dd></div>
            <div><dt>Variants</dt><dd>${inventory.variantsEnabled ? "Enabled" : "Disabled"}</dd></div>
            <div><dt>Sizes</dt><dd>${escapeHtml(formatReviewList(inventory.sizes))}</dd></div>
            <div><dt>Colors</dt><dd>${escapeHtml(formatReviewColors(inventory.colors))}</dd></div>
          </dl>
        </article>
        <article class="pm-review-card">
          <h3>Media & SEO</h3>
          <dl>
            <div><dt>Main Image</dt><dd>${mainImageReady ? "Ready to upload" : "Missing"}</dd></div>
            <div><dt>Gallery</dt><dd>${escapeHtml(String(galleryCount))} image(s)</dd></div>
            <div><dt>Meta Title</dt><dd>${escapeHtml(payload.metaTitle || "-")}</dd></div>
            <div><dt>Meta Description</dt><dd>${escapeHtml(seo.metaDescription || "-")}</dd></div>
            <div><dt>Slug</dt><dd>${escapeHtml(payload.slug || "-")}</dd></div>
          </dl>
        </article>
      </div>
      ${reviewPreview ? `<img class="pm-review-image" src="${escapeHtml(reviewPreview)}" alt="Product preview" />` : ""}
      ${galleryItems.length ? `
        <div class="pm-review-gallery">
          <h3>Gallery Preview</h3>
          <div class="pm-gallery-grid">
            ${galleryItems.map((item, index) => `
              <figure class="pm-gallery-item">
                <img src="${escapeHtml(item.url)}" alt="Gallery image ${index + 1}" loading="lazy" />
              </figure>
            `).join("")}
          </div>
        </div>
      ` : ""}
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
        <footer class="pm-wizard-footer">
          <button type="button" class="pm-btn pm-btn-secondary" data-prev-step ${getStepIndex(currentStep) === 0 || isSaving ? "disabled" : ""}>Previous</button>
          ${currentStep === "review"
            ? `<button type="submit" class="pm-btn pm-btn-primary" data-save-product ${isSaving ? "disabled" : ""}>${isSaving ? "Saving..." : (isEditing ? "Update Product" : "Save Product")}</button>`
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

function formatReviewColors(colors = []) {
  const items = (Array.isArray(colors) ? colors : [])
    .map((entry) => {
      const name = String(entry?.name || "").trim();
      const hex = String(entry?.hex || "").trim();
      if (!name) {
        return "";
      }
      return hex ? `${name} (${hex})` : name;
    })
    .filter(Boolean);
  return items.length ? items.join(", ") : "-";
}

function collectDraftFromForm(form, draft, step = "") {
  const nextDraft = sanitizeDraft({ ...draft });
  const formData = new FormData(form);
  const activeStep = String(step || "").trim().toLowerCase();

  if (activeStep === "info") {
    nextDraft.info = {
      ...nextDraft.info,
      name: String(formData.get("name") || nextDraft.info.name || ""),
      category: String(formData.get("category") || nextDraft.info.category || "general"),
      brand: String(formData.get("brand") ?? nextDraft.info.brand ?? ""),
      description: String(formData.get("description") ?? nextDraft.info.description ?? ""),
      sku: String(formData.get("sku") ?? nextDraft.info.sku ?? ""),
      tags: String(formData.get("tags") ?? nextDraft.info.tags ?? ""),
      visibility: String(formData.get("visibility") || nextDraft.info.visibility || "both")
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
    const colorRows = Array.from(form.querySelectorAll("[data-color-index]"));
    nextDraft.inventory = {
      ...nextDraft.inventory,
      quantity: String(formData.get("quantity") ?? nextDraft.inventory.quantity ?? "0"),
      stockStatus: String(formData.get("stockStatus") || nextDraft.inventory.stockStatus || "in_stock"),
      variantsEnabled,
      sizes: variantsEnabled
        ? Array.from(form.querySelectorAll('[name="sizes"]:checked'))
            .map((entry) => String(entry.value || "").trim())
            .filter(Boolean)
        : [...(nextDraft.inventory.sizes || [])],
      colors: variantsEnabled
        ? colorRows.map((row, index) => ({
            name: String(row.querySelector('[name="colorName"]')?.value || "").trim() || `Color ${index + 1}`,
            hex: String(row.querySelector('[name="colorHex"]')?.value || "#00b894").trim() || "#00b894"
          }))
        : [...(nextDraft.inventory.colors || [])]
    };
  }

  if (activeStep === "seo") {
    nextDraft.seo = {
      ...nextDraft.seo,
      metaTitle: String(formData.get("metaTitle") || nextDraft.seo.metaTitle || nextDraft.info.name || ""),
      metaDescription: String(formData.get("metaDescription") ?? nextDraft.seo.metaDescription ?? nextDraft.info.description ?? ""),
      slug: slugify(String(formData.get("slug") || nextDraft.seo.slug || nextDraft.info.name || ""))
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

  form.querySelector("[data-add-color]")?.addEventListener("click", () => {
    activeDraft = collectDraftFromForm(form, activeDraft, currentStep);
    const nextIndex = (activeDraft.inventory.colors || []).length + 1;
    activeDraft.inventory.colors = [
      ...(activeDraft.inventory.colors || []),
      { name: `Color ${nextIndex}`, hex: "#00b894" }
    ];
    writeDraft(activeDraft);
    rerenderWizard(container);
  });

  form.querySelectorAll("[data-remove-color]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.getAttribute("data-remove-color"));
      activeDraft = collectDraftFromForm(form, activeDraft, currentStep);
      activeDraft.inventory.colors = (activeDraft.inventory.colors || []).filter((_entry, entryIndex) => entryIndex !== index);
      writeDraft(activeDraft);
      rerenderWizard(container);
    });
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
