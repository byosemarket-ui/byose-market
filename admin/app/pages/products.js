import { formatCurrency } from "../components/ui.js";
import { getProducts } from "../services/admin-data.service.js";
import {
  CAMPAIGN_GROUP_OPTIONS,
  CAMPAIGN_SLOT_OPTIONS,
  CATEGORY_OPTIONS,
  CATEGORY_INHERITANCE_OPTIONS,
  CATEGORY_RELATIONSHIP_OPTIONS,
  COLLECTION_GROUP_OPTIONS,
  CURRENCY_OPTIONS,
  DEFAULT_IMAGE,
  FEATURED_PLACEMENT_OPTIONS,
  FEATURED_TAG_OPTIONS,
  FILTER_PRIORITY_OPTIONS,
  getCategorySubcategoryOptions,
  HOMEPAGE_GROUP_OPTIONS,
  HOMEPAGE_PLACEMENT_OPTIONS,
  LABEL_SUGGESTIONS,
  ORDERING_MODE_OPTIONS,
  POSITION_OPTIONS,
  RECOMMENDATION_GROUP_OPTIONS,
  RECOMMENDATION_FLOW_OPTIONS,
  SEARCH_BOOST_OPTIONS,
  SEASONAL_GROUP_OPTIONS,
  SHOP_PLACEMENT_OPTIONS,
  SORTING_STRATEGY_OPTIONS,
  STATUS_OPTIONS,
  TAG_SUGGESTIONS,
  addDraftToken,
  buildProductFoundation,
  createDefaultProductDraft,
  getActivePrice,
  getCompareAtPrice,
  getDraftBadgeLabel,
  getDraftPositionLabel,
  getDraftStatusLabel,
  getDraftValue,
  getDraftVisibilityLabel,
  getPrimaryImage,
  removeDraftToken,
  resolveAdminImage,
  setDraftValue,
  updateMerchandisingSurface,
  updateMerchandisingVisibilityPreset
} from "./products/product-draft.js";
import {
  MEDIA_ACCEPTED_TYPES,
  MEDIA_MAX_FILE_SIZE_BYTES,
  MEDIA_MAX_GALLERY_ITEMS,
  applyMediaSelection,
  buildMediaCompatibilitySummary,
  getMediaMetrics,
  moveGalleryAsset,
  promoteMediaAssetToMain,
  removeMediaAsset
} from "./products/product-media.js";
import { validateProductDraft } from "./products/product-validation.js";

let draftState = createDefaultProductDraft();
let latestProducts = [];
let latestProductsError = "";
let uiNotice = {
  tone: "neutral",
  message: "STEP 3G turns the Add Product workspace into an enterprise category, classification, and product-organization architecture while backend persistence remains deferred."
};
let mediaUiState = createDefaultMediaUiState();
let validationState = validateProductDraft(draftState, { existingProducts: [] });

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugToLabel(value) {
  return String(value || "general")
    .replace(/[-_]+/g, " ")
    .replace(/(^\w|\s\w)/g, (match) => match.toUpperCase());
}

function parseHashParams() {
  const hash = String(window.location.hash || "");
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return new URLSearchParams(query);
}

function getProductsView() {
  return parseHashParams().get("view") === "create" ? "create" : "overview";
}

function formatBytes(size) {
  const bytes = Number(size || 0);
  if (!bytes) {
    return "0 KB";
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function createDefaultMediaUiState() {
  return {
    phase: "idle",
    target: "",
    tone: "neutral",
    message: `Supports ${MEDIA_ACCEPTED_TYPES.map((type) => type.replace("image/", "").toUpperCase()).join(", ")} up to ${formatBytes(MEDIA_MAX_FILE_SIZE_BYTES)} each.`,
    issues: []
  };
}

function setUiNotice(message, tone = "neutral") {
  uiNotice = { tone, message };
}

function setMediaUiState(nextState) {
  mediaUiState = {
    ...createDefaultMediaUiState(),
    ...mediaUiState,
    ...nextState
  };
}

function recomputeValidation() {
  validationState = validateProductDraft(draftState, { existingProducts: latestProducts });
}

function getFieldIssue(path) {
  if (validationState.errors[path]) {
    return { tone: "error", message: validationState.errors[path] };
  }

  if (validationState.warnings[path]) {
    return { tone: "warning", message: validationState.warnings[path] };
  }

  return { tone: "default", message: "" };
}

function getFieldHint(path, fallbackMessage) {
  const issue = getFieldIssue(path);
  return issue.message || fallbackMessage;
}

function getFieldClass(path, baseClass = "editor-field") {
  const issue = getFieldIssue(path);
  if (issue.tone === "error") {
    return `${baseClass} is-invalid`;
  }

  if (issue.tone === "warning") {
    return `${baseClass} is-warning`;
  }

  const value = getDraftValue(draftState, path);
  const hasValue = Array.isArray(value) ? value.length > 0 : Boolean(String(value || "").trim());
  return hasValue ? `${baseClass} is-valid` : baseClass;
}

function buildChoiceCards(field, selectedValue, options) {
  return options.map((option) => `
    <label class="editor-choice-card${option.value === selectedValue ? " is-selected" : ""}">
      <input type="radio" name="${field}" value="${option.value}" data-field="${field}" ${option.value === selectedValue ? "checked" : ""}>
      <strong>${escapeHtml(option.label)}</strong>
      <span>${escapeHtml(option.description)}</span>
    </label>
  `).join("");
}

const VARIANT_GROUP_TYPE_OPTIONS = [
  { value: "color", label: "Color", description: "Visual palette and swatch-first option rendering." },
  { value: "size", label: "Size", description: "Size scale, fit groups, and sizing buttons." },
  { value: "text", label: "Text", description: "Plain textual option buttons for general attributes." },
  { value: "image", label: "Image", description: "Image-led option cards for future gallery-linked variants." }
];

function buildVariantGroupMarkup(groupKey, groupTitle, groupDescription, suggestionValues = []) {
  const groupPath = `variants.groups.${groupKey}`;
  const enabled = Boolean(getDraftValue(draftState, `${groupPath}.enabled`));
  const labelValue = getDraftValue(draftState, `${groupPath}.label`) || groupTitle;
  const typeValue = getDraftValue(draftState, `${groupPath}.type`) || (groupKey === "color" ? "color" : groupKey === "size" ? "size" : "text");
  const requiredValue = Boolean(getDraftValue(draftState, `${groupPath}.required`) ?? true);

  return `
    <article class="editor-subsection editor-variant-group${enabled ? " is-active" : ""}">
      <div class="editor-subsection-heading editor-subsection-heading--split">
        <div>
          <h4>${escapeHtml(groupTitle)}</h4>
          <p>${escapeHtml(groupDescription)}</p>
        </div>
        <label class="editor-toggle-pill">
          <input type="checkbox" data-field="${groupPath}.enabled" ${enabled ? "checked" : ""}>
          <span>Enable</span>
        </label>
      </div>
      <div class="products-form-grid products-form-grid--compact">
        <label class="${getFieldClass(`${groupPath}.label`)}">
          <span>Group Label</span>
          <input type="text" data-field="${groupPath}.label" value="${escapeHtml(labelValue)}" placeholder="${escapeHtml(groupTitle)}">
        </label>
        <label class="${getFieldClass(`${groupPath}.type`)}">
          <span>Option Type</span>
          <select data-field="${groupPath}.type">
            ${VARIANT_GROUP_TYPE_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${String(typeValue) === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
          </select>
        </label>
        <label class="editor-toggle-pill ${getFieldClass(`${groupPath}.required`, "editor-field editor-field--checkbox")}">
          <input type="checkbox" data-field="${groupPath}.required" ${requiredValue ? "checked" : ""}>
          <span>Required selection</span>
        </label>
      </div>
      <div class="editor-tag-input-row">
        <input type="text" data-token-input="${groupPath}.optionTokens" placeholder="Label|value|#hex or Label|value">
        <button type="button" class="products-secondary-link" data-add-token="${groupPath}.optionTokens">Add option</button>
      </div>
      <div class="editor-suggestion-list">
        ${suggestionValues.map((token) => `<button type="button" class="editor-suggestion-chip" data-token-suggestion="${groupPath}.optionTokens" data-token-value="${escapeHtml(token)}">${escapeHtml(splitVariantTokenPreview(token))}</button>`).join("")}
      </div>
      <div class="editor-tag-list" data-token-list="${groupPath}.optionTokens">${buildTokenMarkup(`${groupPath}.optionTokens`, `No ${groupTitle.toLowerCase()} options staged yet. Add structured options to prepare the storefront foundation.`)}</div>
      <small class="editor-field-message" data-field-message="${groupPath}.optionTokens">${escapeHtml(getFieldHint(`${groupPath}.optionTokens`, `Use structured token values so the storefront can derive labels, values, swatches, and future inventory-compatible option data.`))}</small>
    </article>
  `;
}

function splitVariantTokenPreview(token) {
  const parts = String(token || "").split("|").map((entry) => String(entry || "").trim()).filter(Boolean);
  return parts[0] || token;
}

function buildVariantFoundationMarkup() {
  const foundation = validationState.foundation;
  const variants = foundation.variants || {};
  const enabled = Boolean(variants.enabled);
  const variantGroups = variants.groups || {};
  const activeGroupCount = Object.values(variantGroups).filter((group) => Boolean(group?.enabled)).length;
  const activeOptionCount = (foundation.futurePayload.attributes || []).reduce((sum, attribute) => sum + (Array.isArray(attribute.options) ? attribute.options.length : 0), 0);

  return `
    <section class="editor-section-card">
      <div class="editor-section-heading editor-section-heading--split">
        <div>
          <h3>Product Variant Foundation</h3>
          <p>Build color, size, and future option-group scaffolding with clean rendering tokens that can later power inventory, SKU, and availability layers.</p>
        </div>
        <label class="editor-toggle-pill">
          <input type="checkbox" data-field="variants.enabled" ${enabled ? "checked" : ""}>
          <span>Enable variant foundation</span>
        </label>
      </div>
      <div class="editor-variant-summary-grid">
        <article class="editor-variant-summary-card">
          <span>Enabled groups</span>
          <strong>${escapeHtml(String(activeGroupCount))}</strong>
          <small>Structured groups prepared for future selection UI.</small>
        </article>
        <article class="editor-variant-summary-card">
          <span>Rendered attributes</span>
          <strong>${escapeHtml(String(activeOptionCount))}</strong>
          <small>Normalized option records ready for the storefront contract.</small>
        </article>
        <article class="editor-variant-summary-card">
          <span>Variant readiness</span>
          <strong>${escapeHtml(foundation.readiness.supportsVariants ? "Prepared" : "Pending")}</strong>
          <small>Future inventory and pricing hooks remain intentionally deferred.</small>
        </article>
      </div>
      ${buildVariantGroupMarkup("color", "Color Variants", "Premium swatch-led color rendering for detail pages, cards, and future image-per-color switching.", ["Black|black|#111111", "White|white|#f7f7f7", "Emerald|emerald|#00b894", "Sand|sand|#e9dcc8"])}
      ${buildVariantGroupMarkup("size", "Size Variants", "Scalable size buttons for apparel, footwear, and future custom sizing systems.", ["XS|xs", "S|s", "M|m", "L|l", "XL|xl"])}
      ${buildVariantGroupMarkup("style", "Style / Material Variants", "An expandable text-based option group for materials, fits, or future style families.", ["Classic|classic", "Regular|regular", "Premium|premium", "Relaxed|relaxed"])}
    </section>
  `;
}

function buildVisibilityPresetMarkup() {
  const visibility = validationState.foundation.merchandising.visibility;
  const presets = [
    { value: "both", label: "Show Everywhere", description: "Render on Home and Shop." },
    { value: "home", label: "Home only", description: "Keep the product exclusive to homepage storytelling." },
    { value: "shop", label: "Shop only", description: "Limit the product to catalog and category browsing." },
    { value: "hidden", label: "Hide all surfaces", description: "Reserve the product for hidden or pre-publish workflows." }
  ];

  return presets.map((preset) => `
    <label class="editor-segmented-option${preset.value === visibility ? " is-active" : ""}" data-visibility-preset-option data-preset-value="${preset.value}">
      <input type="radio" name="merchandising-visibility" value="${preset.value}" data-field="merchandising.visibility" ${preset.value === visibility ? "checked" : ""}>
      <strong>${escapeHtml(preset.label)}</strong>
      <span>${escapeHtml(preset.description)}</span>
    </label>
  `).join("");
}

function buildSurfaceToggleMarkup() {
  const foundation = validationState.foundation;
  const surfaces = foundation.merchandising.surfaces || { home: true, shop: true };
  const items = [
    {
      path: "merchandising.surfaces.home",
      label: "Show in Home",
      description: "Homepage spotlight rows, featured storytelling, and premium hero merchandising.",
      enabled: Boolean(surfaces.home)
    },
    {
      path: "merchandising.surfaces.shop",
      label: "Show in Shop",
      description: "Shop grid cards, category pages, filter results, and browsing discovery.",
      enabled: Boolean(surfaces.shop)
    }
  ];

  return items.map((item) => `
    <label class="editor-surface-toggle${item.enabled ? " is-active" : ""}">
      <input type="checkbox" data-field="${item.path}" ${item.enabled ? "checked" : ""}>
      <div>
        <strong>${escapeHtml(item.label)}</strong>
        <span>${escapeHtml(item.description)}</span>
      </div>
    </label>
  `).join("");
}

function buildMerchandisingSummaryMarkup() {
  const foundation = validationState.foundation;
  const merchandising = foundation.merchandising;
  const cards = [
    {
      label: "Publishing",
      value: merchandising.labels.status,
      detail: foundation.workflow.isScheduled
        ? merchandising.scheduleAt || "Waiting for schedule"
        : foundation.workflow.isPublished
          ? "Ready for storefront release"
          : foundation.workflow.isHidden
            ? "Storefront hidden"
            : "Internal draft"
    },
    {
      label: "Surface scope",
      value: merchandising.labels.visibility,
      detail: foundation.rendering.showEverywhere
        ? "Home, Shop, category, and search ready"
        : foundation.rendering.showInHome
          ? "Homepage-focused placement"
          : foundation.rendering.showInShop
            ? "Shop and browse-focused placement"
            : "Hidden until visibility is restored"
    },
    {
      label: "Featured treatment",
      value: merchandising.labels.featuredTag,
      detail: foundation.rendering.featuredPlacement
        ? "Prepared for spotlight and promoted sections"
        : "Standard catalog treatment"
    },
    {
      label: "Ordering",
      value: `${merchandising.labels.position} / ${merchandising.labels.orderingMode}`,
      detail: `Derived order index ${foundation.futurePayload.orderIndex} • score ${foundation.rendering.merchandisingScore || 0}`
    }
  ];

  return `
    <div class="editor-merch-summary-grid">
      ${cards.map((card) => `
        <article class="editor-merch-summary-card">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(card.value)}</strong>
          <small>${escapeHtml(card.detail)}</small>
        </article>
      `).join("")}
    </div>
  `;
}

function formatOrderIndicator(value, fallbackLabel = "Auto") {
  const sequence = Number(value || 0);
  return sequence > 0 ? `#${sequence}` : fallbackLabel;
}

function buildPositioningEngineMarkup() {
  const foundation = validationState.foundation;
  const positioning = foundation.merchandising.positioning;
  const cards = [
    {
      label: "Merchandising score",
      value: String(positioning.ranking.merchandisingScore || 0),
      detail: `${positioning.labels.sortStrategy} priority foundation`
    },
    {
      label: "Homepage sequence",
      value: `${positioning.labels.homePlacement} ${formatOrderIndicator(positioning.homeOrder, "Auto")}`,
      detail: `Weight ${positioning.ranking.homeWeight}`
    },
    {
      label: "Shop sequence",
      value: `${positioning.labels.shopPlacement} ${formatOrderIndicator(positioning.shopOrder, "Auto")}`,
      detail: `Weight ${positioning.ranking.shopWeight}`
    },
    {
      label: "Featured sequence",
      value: `${positioning.labels.featuredPlacement} ${formatOrderIndicator(positioning.featuredOrder, "Off")}`,
      detail: `Weight ${positioning.ranking.featuredWeight}`
    },
    {
      label: "Category order",
      value: formatOrderIndicator(positioning.categoryOrder, "Auto"),
      detail: `Weight ${positioning.ranking.categoryWeight}`
    },
    {
      label: "Recommendation flow",
      value: positioning.labels.recommendationFlow,
      detail: `${formatOrderIndicator(positioning.recommendationOrder, "Auto")} • weight ${positioning.ranking.recommendationWeight}`
    }
  ];

  return `
    <div class="editor-positioning-grid">
      ${cards.map((card) => `
        <article class="editor-positioning-card">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(card.value)}</strong>
          <small>${escapeHtml(card.detail)}</small>
        </article>
      `).join("")}
    </div>
  `;
}

function buildSubcategorySelectMarkup(primaryCategory, selectedSubcategory) {
  const options = getCategorySubcategoryOptions(primaryCategory);
  if (!options.length) {
    return `<option value="">No mapped subcategories yet</option>`;
  }

  return [`<option value="">Select subcategory</option>`, ...options.map((option) => (
    `<option value="${escapeHtml(option.value)}" ${option.value === selectedSubcategory ? "selected" : ""}>${escapeHtml(option.label)}</option>`
  ))].join("");
}

function buildClassificationArchitectureMarkup() {
  const classification = validationState.foundation.classification;
  const cards = [
    {
      label: "Primary category",
      value: classification.optionLabels.primaryCategory,
      detail: classification.subcategory
        ? `Subcategory ${slugToLabel(classification.subcategory)}`
        : "Subcategory not selected"
    },
    {
      label: "Relationship",
      value: classification.labels.relationship,
      detail: `${classification.categoryTree.secondary.length} secondary categor${classification.categoryTree.secondary.length === 1 ? "y" : "ies"}`
    },
    {
      label: "Inheritance",
      value: classification.labels.inheritance,
      detail: `${classification.search.filterTokens.length} derived filter tokens`
    },
    {
      label: "Collection architecture",
      value: classification.labels.collectionGroup,
      detail: `${classification.labels.seasonalGroup} / ${classification.labels.campaignGroup}`
    }
  ];

  return `
    <div class="editor-classification-grid">
      ${cards.map((card) => `
        <article class="editor-classification-card">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(card.value)}</strong>
          <small>${escapeHtml(card.detail)}</small>
        </article>
      `).join("")}
    </div>
  `;
}

function buildOrganizationArchitectureMarkup() {
  const classification = validationState.foundation.classification;
  const cards = [
    {
      label: "Homepage group",
      value: classification.labels.homepageGroup,
      detail: classification.rendering.homeCategory
    },
    {
      label: "Recommendation group",
      value: classification.labels.recommendationGroup,
      detail: classification.grouping.recommendationGroup
    },
    {
      label: "Search weighting",
      value: classification.labels.searchBoost,
      detail: classification.labels.filterPriority
    },
    {
      label: "Category path",
      value: classification.rendering.categoryPagePath,
      detail: `${classification.categoryTree.all.length} navigable category token${classification.categoryTree.all.length === 1 ? "" : "s"}`
    }
  ];

  return `
    <div class="editor-classification-grid editor-classification-grid--tight">
      ${cards.map((card) => `
        <article class="editor-classification-card">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(slugToLabel(card.value))}</strong>
          <small>${escapeHtml(slugToLabel(card.detail))}</small>
        </article>
      `).join("")}
    </div>
  `;
}

function buildTokenMarkup(path, emptyMessage) {
  const values = Array.isArray(getDraftValue(draftState, path)) ? getDraftValue(draftState, path) : [];
  if (!values.length) {
    return `<div class="editor-tags-empty">${escapeHtml(emptyMessage)}</div>`;
  }

  return values.map((value) => `
    <span class="editor-tag-chip">
      ${escapeHtml(value)}
      <button type="button" data-remove-token="${escapeHtml(path)}" data-token-value="${escapeHtml(value)}" aria-label="Remove ${escapeHtml(value)}">×</button>
    </span>
  `).join("");
}

function buildMediaIssuesMarkup() {
  if (!mediaUiState.issues.length) {
    return `
      <div class="editor-media-feedback editor-media-feedback--${escapeHtml(mediaUiState.tone)}">
        <strong>Media workspace status</strong>
        <p>${escapeHtml(mediaUiState.message)}</p>
      </div>
    `;
  }

  return `
    <div class="editor-media-feedback editor-media-feedback--${escapeHtml(mediaUiState.tone)}">
      <strong>${escapeHtml(mediaUiState.message)}</strong>
      <ul class="editor-media-issue-list">
        ${mediaUiState.issues.map((issue) => `
          <li class="editor-media-issue editor-media-issue--${escapeHtml(issue.tone || "error")}">
            <span class="editor-media-issue__tone">${escapeHtml(issue.tone === "warning" ? "Advisory" : "Blocked")}</span>
            <div>
              <strong>${escapeHtml(issue.fileName || "Media file")}</strong>
              <p>${escapeHtml(issue.message || "This file could not be staged.")}</p>
            </div>
          </li>
        `).join("")}
      </ul>
    </div>
  `;
}

function buildMediaManagementMarkup() {
  const metrics = getMediaMetrics(draftState);
  const compatibility = buildMediaCompatibilitySummary(draftState);

  return `
    <div class="editor-media-management-grid">
      <article class="editor-media-stat-card">
        <span>Featured image</span>
        <strong>${metrics.hasMainImage ? "Ready" : "Required"}</strong>
        <small>${metrics.hasMainImage ? "Prepared for cards, search, and detail hero rendering." : "Stage one featured image to unlock storefront-safe rendering."}</small>
      </article>
      <article class="editor-media-stat-card">
        <span>Gallery staged</span>
        <strong>${escapeHtml(String(metrics.galleryCount))} / ${escapeHtml(String(MEDIA_MAX_GALLERY_ITEMS))}</strong>
        <small>${escapeHtml(String(metrics.remainingGallerySlots))} additional gallery slot${metrics.remainingGallerySlots === 1 ? "" : "s"} available.</small>
      </article>
      <article class="editor-media-stat-card">
        <span>Total media weight</span>
        <strong>${escapeHtml(formatBytes(metrics.totalBytes))}</strong>
        <small>Local preview footprint only. Cloud optimization is intentionally deferred.</small>
      </article>
      <article class="editor-media-stat-card">
        <span>Compatibility</span>
        <strong>${compatibility.detailReady ? "Ready" : "In progress"}</strong>
        <small>${compatibility.galleryReady ? "Prepared for future detail galleries and thumbnails." : "Gallery foundations remain optional until additional images are staged."}</small>
      </article>
    </div>
  `;
}

function buildGalleryFoundationPreviewMarkup() {
  const images = [draftState.media.mainImage, ...(draftState.media.gallery || [])].filter(Boolean);
  if (!images.length) {
    return `
      <article class="product-preview-card product-preview-card--detail">
        <p class="product-preview-eyebrow">Gallery Foundation Preview</p>
        <div class="products-empty-card">Stage a featured image or gallery images to preview future detail-gallery behavior.</div>
      </article>
    `;
  }

  return `
    <article class="product-preview-card product-preview-card--detail">
      <p class="product-preview-eyebrow">Gallery Foundation Preview</p>
      <div class="editor-gallery-foundation-stage">
        <img src="${escapeHtml(resolveAdminImage(images[0].src))}" alt="Gallery foundation primary image">
      </div>
      <div class="editor-gallery-foundation-strip">
        ${images.slice(0, 4).map((image, index) => `
          <div class="editor-gallery-foundation-thumb${index === 0 ? " is-active" : ""}">
            <img src="${escapeHtml(resolveAdminImage(image.src))}" alt="Gallery foundation thumbnail ${index + 1}">
          </div>
        `).join("")}
      </div>
    </article>
  `;
}

function buildMainImageStage() {
  const mainImage = draftState.media.mainImage;
  const metrics = getMediaMetrics(draftState);
  if (!mainImage) {
    return `
      <div class="editor-main-image-empty">
        <strong>Main image preview</strong>
        <span>${escapeHtml(getFieldHint("media.mainImage", "Drop a hero image here to validate crop safety across admin, home, shop, and detail previews."))}</span>
        <small>${escapeHtml(metrics.galleryCount ? `A gallery is already staged. Promote the best image to featured if needed.` : `Use one high-quality image for cards and add gallery assets for future detail experiences.`)}</small>
      </div>
    `;
  }

  return `
    <div class="editor-main-image-preview-card">
      <img src="${escapeHtml(resolveAdminImage(mainImage.src))}" alt="Main product preview">
      <div class="editor-main-image-preview-meta">
        <div>
          <strong>${escapeHtml(mainImage.name || "Featured image")}</strong>
          <small>Used for Home, Shop, Search, Featured rows, and detail hero rendering.</small>
        </div>
        <div class="editor-media-pill-row">
          <span class="editor-media-pill editor-media-pill--success">Ready</span>
          <span class="editor-media-pill">${escapeHtml(formatBytes(mainImage.size))}</span>
        </div>
      </div>
    </div>
  `;
}

function buildGalleryMarkup() {
  if (!draftState.media.gallery.length) {
    return `<div class="editor-gallery-empty">${escapeHtml(getFieldHint("media.gallery", "Gallery images will appear here as responsive preview cards. Gallery persistence remains deferred after STEP 3D."))}</div>`;
  }

  return draftState.media.gallery.map((image, index) => `
    <article class="editor-gallery-card">
      <div class="editor-gallery-card__media">
        <img src="${escapeHtml(resolveAdminImage(image.src))}" alt="${escapeHtml(image.name || "Gallery image")}">
        <span class="editor-gallery-card__index">${escapeHtml(String(index + 1))}</span>
      </div>
      <div class="editor-gallery-card__body">
        <div class="editor-gallery-card__meta">
          <div>
            <strong>${escapeHtml(image.name || "Image")}</strong>
            <small>${escapeHtml(formatBytes(image.size))}</small>
          </div>
          <span class="editor-media-pill">${escapeHtml(image.status || "ready")}</span>
        </div>
        <div class="editor-gallery-card__actions">
          <button type="button" class="products-secondary-link" data-set-main-image="${escapeHtml(image.id)}">Use as main</button>
          <button type="button" class="products-secondary-link" data-move-image="${escapeHtml(image.id)}" data-direction="up" ${index === 0 ? "disabled" : ""}>Move earlier</button>
          <button type="button" class="products-secondary-link" data-move-image="${escapeHtml(image.id)}" data-direction="down" ${index === draftState.media.gallery.length - 1 ? "disabled" : ""}>Move later</button>
          <button type="button" class="products-danger-button" data-remove-image="${escapeHtml(image.id)}">Remove</button>
        </div>
      </div>
    </article>
  `).join("");
}

function buildPreviewSurfaceMarkup() {
  const foundation = validationState.foundation;
  return `
    <article class="preview-surface-item${foundation.rendering.showInHome ? " is-active" : ""}">
      <strong>Home Rendering</strong>
      <small>${foundation.rendering.showInHome ? `Eligible for homepage spotlight and curated merchandising. Sequence ${formatOrderIndicator(foundation.merchandising.positioning.homeOrder, "auto")} in ${foundation.merchandising.positioning.labels.homePlacement}.` : "Currently excluded from homepage rendering."}</small>
    </article>
    <article class="preview-surface-item${foundation.rendering.showInShop ? " is-active" : ""}">
      <strong>Shop Rendering</strong>
      <small>${foundation.rendering.showInShop ? `Eligible for shop grid cards, collections, and filtering. Sequence ${formatOrderIndicator(foundation.merchandising.positioning.shopOrder, "auto")} in ${foundation.merchandising.positioning.labels.shopPlacement}.` : "Currently excluded from shop rendering."}</small>
    </article>
    <article class="preview-surface-item${foundation.rendering.featuredPlacement ? " is-active" : ""}">
      <strong>Featured Placement</strong>
      <small>${foundation.rendering.featuredPlacement ? `Prepared for featured rows, spotlight sections, and highlighted merchandising. Sequence ${formatOrderIndicator(foundation.merchandising.positioning.featuredOrder, "auto")}.` : "Standard placement only until a featured treatment is selected."}</small>
    </article>
    <article class="preview-surface-item${foundation.rendering.showInShop ? " is-active" : ""}">
      <strong>Category & Search</strong>
      <small>${foundation.rendering.showInShop ? `Prepared for category pages, filters, and search result inclusion. Path ${slugToLabel(foundation.classification.rendering.categoryPagePath)} with category order ${formatOrderIndicator(foundation.merchandising.positioning.categoryOrder, "auto")}.` : "Category and search discovery stay suppressed while Shop visibility is off."}</small>
    </article>
    <article class="preview-surface-item is-active">
      <strong>Recommendations</strong>
      <small>${escapeHtml(`${foundation.merchandising.positioning.labels.recommendationFlow} flow with ${formatOrderIndicator(foundation.merchandising.positioning.recommendationOrder, "auto")} sequencing foundation.`)}</small>
    </article>
    <article class="preview-surface-item is-active">
      <strong>Detail Layout</strong>
      <small>Prepared for detail-page summary, long-form content, badges, and structured merchandising fields.</small>
    </article>
  `;
}

function buildStorefrontPreview() {
  const foundation = validationState.foundation;
  const name = foundation.basic.name || "New Product Title";
  const category = slugToLabel(foundation.classification.category);
  const shortDescription = foundation.basic.shortDescription || "Short storefront copy will appear here to validate card density and hierarchy.";
  const activePrice = getActivePrice(draftState);
  const compareAtPrice = getCompareAtPrice(draftState);

  return `
    <article class="product-preview-card product-preview-card--storefront">
      <p class="product-preview-eyebrow">Storefront Card Preview</p>
      <div class="storefront-card-preview">
        <div class="storefront-card-preview__media">
          <img src="${escapeHtml(getPrimaryImage(draftState))}" alt="${escapeHtml(name)} preview">
          <span class="storefront-card-preview__badge">${escapeHtml(getDraftBadgeLabel(draftState))}</span>
        </div>
        <div class="storefront-card-preview__body">
          <span class="storefront-card-preview__category">${escapeHtml(category)}</span>
          <h3>${escapeHtml(name)}</h3>
          <p>${escapeHtml(shortDescription)}</p>
          <div class="product-preview-price-group">
            <strong>${escapeHtml(formatCurrency(activePrice))}</strong>
            ${compareAtPrice ? `<span class="product-preview-old-price">${escapeHtml(formatCurrency(compareAtPrice))}</span>` : ""}
          </div>
          <div class="storefront-card-preview__meta">
            <span class="product-preview-badge">${escapeHtml(getDraftVisibilityLabel(draftState))}</span>
            <span class="view-link-pill">${escapeHtml(`Score ${foundation.rendering.merchandisingScore || 0}`)}</span>
          </div>
        </div>
      </div>
    </article>
  `;
}

function buildDetailPreview() {
  const foundation = validationState.foundation;
  const name = foundation.basic.name || "New Product Title";
  const activePrice = getActivePrice(draftState);
  const compareAtPrice = getCompareAtPrice(draftState);

  return `
    <article class="product-preview-card product-preview-card--detail">
      <p class="product-preview-eyebrow">Product Detail Foundation</p>
      <img src="${escapeHtml(getPrimaryImage(draftState))}" alt="Detail preview image">
      <div class="product-preview-stack">
        <div class="product-preview-meta">
          <span class="product-preview-badge">${escapeHtml(getDraftStatusLabel(draftState))}</span>
          <span class="view-link-pill">${escapeHtml(slugToLabel(foundation.classification.category))}</span>
        </div>
        <h3>${escapeHtml(name)}</h3>
        <div class="product-preview-price-group">
          <strong>${escapeHtml(formatCurrency(activePrice))}</strong>
          ${compareAtPrice ? `<span class="product-preview-old-price">${escapeHtml(formatCurrency(compareAtPrice))}</span>` : ""}
        </div>
        <p>${escapeHtml(foundation.basic.summary || foundation.basic.fullDescription || "Long-form detail content will appear here once connected to future detail data systems.")}</p>
        <ul class="product-preview-detail-list">
          <li><span>Brand</span><strong>${escapeHtml(foundation.basic.brand || "Brand pending")}</strong></li>
          <li><span>SKU</span><strong>${escapeHtml(foundation.basic.sku || "SKU pending")}</strong></li>
          <li><span>Product Code</span><strong>${escapeHtml(foundation.basic.productCode || "Code pending")}</strong></li>
          <li><span>Visibility</span><strong>${escapeHtml(getDraftVisibilityLabel(draftState))}</strong></li>
        </ul>
      </div>
    </article>
  `;
}

function buildValidationSummaryMarkup() {
  const summaryTone = validationState.errorCount ? "danger" : validationState.warningCount ? "warn" : "success";
  const primaryMessage = validationState.errorCount
    ? `${validationState.errorCount} validation issue${validationState.errorCount === 1 ? "" : "s"} must be resolved before future publishing.`
    : validationState.warningCount
      ? `${validationState.warningCount} advisory issue${validationState.warningCount === 1 ? "" : "s"} should be reviewed before publication.`
      : "All structured product information fields are currently valid for the STEP 3G category, organization, and positioning foundation.";
  const issueList = [
    ...Object.entries(validationState.errors).slice(0, 3).map(([, message]) => message),
    ...Object.entries(validationState.warnings).slice(0, Math.max(0, 3 - Math.min(3, Object.keys(validationState.errors).length))).map(([, message]) => message)
  ];

  return `
    <article class="editor-validation-summary editor-validation-summary--${summaryTone}" data-validation-summary>
      <div class="editor-validation-summary__header">
        <div>
          <span class="editor-validation-summary__eyebrow">Validation status</span>
          <strong>${escapeHtml(primaryMessage)}</strong>
        </div>
        <div class="editor-validation-summary__meta">
          <span>${escapeHtml(String(validationState.completion))}% complete</span>
          <span>${escapeHtml(String(validationState.errorCount))} errors</span>
          <span>${escapeHtml(String(validationState.warningCount))} warnings</span>
        </div>
      </div>
      <div class="editor-validation-summary__body">
        <div class="editor-validation-summary__progress"><span style="width:${Math.max(6, validationState.completion)}%"></span></div>
        <ul class="editor-validation-summary__list">
          ${issueList.length ? issueList.map((message) => `<li>${escapeHtml(message)}</li>`).join("") : "<li>Required product information, pricing logic, identifiers, visibility, and positioning are all aligned.</li>"}
        </ul>
      </div>
    </article>
  `;
}

function buildFoundationPreviewMarkup() {
  const foundation = validationState.foundation;
  const payload = JSON.stringify(foundation.futurePayload, null, 2);
  return `
    <article class="product-preview-card product-preview-card--detail">
      <p class="product-preview-eyebrow">Structured Product Data Foundation</p>
      <div class="products-foundation-grid">
        <div class="products-foundation-stat">
          <span>Priority strategy</span>
          <strong>${escapeHtml(foundation.merchandising.positioning.labels.sortStrategy)}</strong>
        </div>
        <div class="products-foundation-stat">
          <span>Merch score</span>
          <strong>${escapeHtml(String(foundation.rendering.merchandisingScore || 0))}</strong>
        </div>
        <div class="products-foundation-stat">
          <span>Primary category</span>
          <strong>${escapeHtml(foundation.classification.labels.primaryCategory)}</strong>
        </div>
        <div class="products-foundation-stat">
          <span>Category path</span>
          <strong>${escapeHtml(slugToLabel(foundation.classification.rendering.categoryPagePath))}</strong>
        </div>
        <div class="products-foundation-stat">
          <span>Homepage order</span>
          <strong>${escapeHtml(formatOrderIndicator(foundation.merchandising.positioning.homeOrder, "Auto"))}</strong>
        </div>
        <div class="products-foundation-stat">
          <span>Derived order index</span>
          <strong>${escapeHtml(String(foundation.futurePayload.orderIndex))}</strong>
        </div>
      </div>
      <pre class="products-foundation-code" data-foundation-code>${escapeHtml(payload)}</pre>
    </article>
  `;
}

function buildRecentProductsMarkup() {
  if (!latestProducts.length) {
    const emptyMessage = latestProductsError
      ? latestProductsError
      : "No live products found yet. The STEP 3G product workspace still renders normally for architecture work.";
    return `<div class="products-empty-card">${escapeHtml(emptyMessage)}</div>`;
  }

  return latestProducts.slice(0, 4).map((product) => `
    <article class="product-list-card">
      <div class="product-list-card__media">
        <img src="${escapeHtml(resolveAdminImage(product?.mainImage || product?.image || DEFAULT_IMAGE))}" alt="${escapeHtml(product?.name || product?.title || "Product")}">
      </div>
      <div class="product-list-card__body">
        <div class="product-list-card__heading">
          <div>
            <p class="product-list-card__category">${escapeHtml(slugToLabel(product?.category || "general"))}</p>
            <h3>${escapeHtml(product?.name || product?.title || "Product")}</h3>
          </div>
          <div class="product-list-card__actions">
            <span class="stock-pill stock-pill--${Number(product?.stock || 0) > 5 ? "healthy" : Number(product?.stock || 0) > 0 ? "low" : "empty"}">${escapeHtml(String(product?.stock ?? 0))}</span>
          </div>
        </div>
        <div class="product-list-card__meta">
          <div>
            <p class="product-list-card__label">Price</p>
            <strong>${escapeHtml(formatCurrency(product?.price || 0))}</strong>
          </div>
          <div>
            <p class="product-list-card__label">SKU</p>
            <strong>${escapeHtml(product?.sku || product?.catalogId || "-")}</strong>
          </div>
        </div>
      </div>
    </article>
  `).join("");
}

function buildProductsMarkup() {
  const createMode = getProductsView() === "create";
  const totalProducts = latestProducts.length;
  const featuredProducts = latestProducts.filter((product) => Boolean(String(product?.highlightTag || "").trim()) || String(product?.status || "").toLowerCase() === "featured").length;
  const homeVisibleProducts = latestProducts.filter((product) => ["home", "both"].includes(String(product?.visibility || "both").toLowerCase())).length;
  const topPriorityProducts = latestProducts.filter((product) => String(product?.priority || "").toLowerCase() === "top").length;

  return `
    <div class="products-dashboard-grid" data-products-create-root>
      <section class="dashboard-panel products-hero-card products-hero-card--studio editor-step-banner">
        <p class="dashboard-eyebrow">STEP 3G Category & Organization Engine</p>
        <div class="products-hero-intro">
          <div class="products-hero-copy">
            <h2>${createMode ? "Enterprise Add Product Workspace" : "Products Workspace"}</h2>
            <p>Enterprise category architecture, hierarchy relationships, product organization grouping, rendering/search foundations, and positioning controls layered onto the existing product architecture without introducing backend persistence yet.</p>
          </div>
          <div class="products-hero-actions">
            <a class="products-primary-link" href="#/products?view=create">Open Add Product</a>
            <a class="products-secondary-link" href="#/products">Workspace Overview</a>
          </div>
        </div>
        <div class="products-chip-list">
          <span class="products-hero-chip">Classification engine live</span>
          <span class="products-hero-chip">Category hierarchy active</span>
          <span class="products-hero-chip">Organization grouping ready</span>
          <span class="products-hero-chip">Surface sequencing preserved</span>
        </div>
        <div class="products-kpi-row">
          <article class="products-kpi-card">
            <span>Live catalog records</span>
            <strong>${escapeHtml(String(totalProducts))}</strong>
            <small>Current backend-backed product count visible to the admin app.</small>
          </article>
          <article class="products-kpi-card">
            <span>Home-ready items</span>
            <strong>${escapeHtml(String(homeVisibleProducts))}</strong>
            <small>Products already configured for homepage visibility.</small>
          </article>
          <article class="products-kpi-card">
            <span>Featured signals</span>
            <strong>${escapeHtml(String(featuredProducts))}</strong>
            <small>Existing products marked for premium merchandising.</small>
          </article>
          <article class="products-kpi-card">
            <span>Top priority</span>
            <strong>${escapeHtml(String(topPriorityProducts))}</strong>
            <small>Products currently sorted with top rendering priority.</small>
          </article>
        </div>
      </section>

      ${latestProductsError ? `<section class="dashboard-panel products-load-banner products-load-banner--warn">${escapeHtml(latestProductsError)}</section>` : ""}

      <div class="products-editor-layout">
        <div class="products-create-flow">
          <section class="dashboard-panel products-editor-panel">
            <header class="products-form-header">
              <div>
                <p class="dashboard-eyebrow">Product Entry</p>
                <h2>Structured product information, media, and publishing</h2>
                <p>Build a stable, validated product record with enterprise publishing, visibility, featured placement, and rendering controls that stay compatible with the existing storefront contract.</p>
              </div>
            </header>

            ${buildValidationSummaryMarkup()}

            <form class="products-editor-form" data-products-form novalidate>
              <section class="editor-section-card">
                <div class="editor-section-heading">
                  <div>
                    <h3>Core Product Information</h3>
                    <p>Structured identity, descriptions, and identifiers aligned with future rendering and persistence needs.</p>
                  </div>
                </div>
                <div class="products-form-grid">
                  <label class="${getFieldClass("basic.name", "editor-field editor-field--span-2")}">
                    <span>Product Name</span>
                    <input type="text" data-field="basic.name" value="${escapeHtml(getDraftValue(draftState, "basic.name") || "")}" placeholder="Example: Byose Signature Travel Bag">
                    <small class="editor-field-message" data-field-message="basic.name">${escapeHtml(getFieldHint("basic.name", "Use the customer-facing title that should appear on cards and detail pages."))}</small>
                  </label>
                  <label class="${getFieldClass("basic.brand")}">
                    <span>Brand</span>
                    <input type="text" data-field="basic.brand" value="${escapeHtml(getDraftValue(draftState, "basic.brand") || "")}" placeholder="Byose Studio">
                    <small class="editor-field-message" data-field-message="basic.brand">${escapeHtml(getFieldHint("basic.brand", "Brand metadata supports detail pages, filters, and merchandising."))}</small>
                  </label>
                  <label class="${getFieldClass("basic.sku")}">
                    <span>SKU</span>
                    <input type="text" data-field="basic.sku" value="${escapeHtml(getDraftValue(draftState, "basic.sku") || "")}" placeholder="BM-TRAVEL-001">
                    <small class="editor-field-message" data-field-message="basic.sku">${escapeHtml(getFieldHint("basic.sku", "Use a unique stock keeping unit for inventory and operational tracking."))}</small>
                  </label>
                  <label class="${getFieldClass("basic.productCode")}">
                    <span>Product Code</span>
                    <input type="text" data-field="basic.productCode" value="${escapeHtml(getDraftValue(draftState, "basic.productCode") || "")}" placeholder="PDC-TRAVEL-001">
                    <small class="editor-field-message" data-field-message="basic.productCode">${escapeHtml(getFieldHint("basic.productCode", "Unique merchandising identifier for future integrations and analytics."))}</small>
                  </label>
                  <label class="${getFieldClass("basic.summary")}">
                    <span>Product Summary</span>
                    <textarea rows="3" data-field="basic.summary" placeholder="Short structured summary for detail pages, SEO foundations, and recommendation systems.">${escapeHtml(getDraftValue(draftState, "basic.summary") || "")}</textarea>
                    <small class="editor-field-message" data-field-message="basic.summary">${escapeHtml(getFieldHint("basic.summary", "This powers structured product summaries beyond the storefront card copy."))}</small>
                  </label>
                  <label class="${getFieldClass("basic.shortDescription", "editor-field editor-field--span-2")}">
                    <span>Short Description</span>
                    <textarea rows="3" data-field="basic.shortDescription" placeholder="Compact summary for cards, previews, and quick storefront scanning.">${escapeHtml(getDraftValue(draftState, "basic.shortDescription") || "")}</textarea>
                    <small class="editor-field-message" data-field-message="basic.shortDescription">${escapeHtml(getFieldHint("basic.shortDescription", "Target concise card-ready copy for home and shop surfaces."))}</small>
                  </label>
                  <label class="${getFieldClass("basic.fullDescription", "editor-field editor-field--span-2")}">
                    <span>Full Description</span>
                    <textarea rows="6" data-field="basic.fullDescription" placeholder="Long-form product storytelling, value proposition, care notes, or specification guidance.">${escapeHtml(getDraftValue(draftState, "basic.fullDescription") || "")}</textarea>
                    <small class="editor-field-message" data-field-message="basic.fullDescription">${escapeHtml(getFieldHint("basic.fullDescription", "Prepare the long-form product story for future detail layouts and content modules."))}</small>
                  </label>
                </div>
              </section>

              <section class="editor-section-card">
                <div class="editor-section-heading editor-section-heading--split">
                  <div>
                    <h3>Pricing Information</h3>
                    <p>Professional price validation and merchandising-safe pricing logic.</p>
                  </div>
                  <label class="editor-toggle-pill">
                    <input type="checkbox" data-field="pricing.saleEnabled" ${getDraftValue(draftState, "pricing.saleEnabled") ? "checked" : ""}>
                    <span>Sale status enabled</span>
                  </label>
                </div>
                <div class="products-form-grid">
                  <label class="${getFieldClass("pricing.originalPrice")}">
                    <span>Original Price</span>
                    <input type="number" min="0" step="100" data-field="pricing.originalPrice" value="${escapeHtml(getDraftValue(draftState, "pricing.originalPrice") || "")}" placeholder="25000">
                    <small class="editor-field-message" data-field-message="pricing.originalPrice">${escapeHtml(getFieldHint("pricing.originalPrice", "Base price used for catalog display and analytics foundations."))}</small>
                  </label>
                  <label class="${getFieldClass("pricing.discountPrice")}">
                    <span>Discount Price</span>
                    <input type="number" min="0" step="100" data-field="pricing.discountPrice" value="${escapeHtml(getDraftValue(draftState, "pricing.discountPrice") || "")}" placeholder="19000" ${getDraftValue(draftState, "pricing.saleEnabled") ? "" : "disabled"}>
                    <small class="editor-field-message" data-field-message="pricing.discountPrice">${escapeHtml(getFieldHint("pricing.discountPrice", "Required only when sale status is enabled."))}</small>
                  </label>
                  <label class="${getFieldClass("pricing.currency")}">
                    <span>Currency</span>
                    <select data-field="pricing.currency">
                      ${CURRENCY_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${getDraftValue(draftState, "pricing.currency") === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
                    </select>
                    <small class="editor-field-message" data-field-message="pricing.currency">${escapeHtml(getFieldHint("pricing.currency", "Currency foundation for future publishing and market support."))}</small>
                  </label>
                  <div class="editor-inline-summary">
                    <strong>Rendered price preview</strong>
                    <span>${escapeHtml(formatCurrency(getActivePrice(draftState)))}</span>
                    <small>${getCompareAtPrice(draftState) ? `Compare at ${escapeHtml(formatCurrency(getCompareAtPrice(draftState)))}` : "No compare-at price active."}</small>
                  </div>
                </div>
              </section>

              <section class="editor-section-card">
                <div class="editor-section-heading">
                  <div>
                    <h3>Product Variant Foundation</h3>
                    <p>Build color, size, and future option-group scaffolding with clean rendering tokens that can later power inventory, SKU, and availability layers.</p>
                  </div>
                  <label class="editor-toggle-pill">
                    <input type="checkbox" data-field="variants.enabled" ${getDraftValue(draftState, "variants.enabled") ? "checked" : ""}>
                    <span>Enable variant foundation</span>
                  </label>
                </div>
                <div class="editor-variant-summary-grid">
                  <article class="editor-variant-summary-card">
                    <span>Enabled groups</span>
                    <strong>${escapeHtml(String(Object.values(getDraftValue(draftState, "variants.groups") || {}).filter((group) => Boolean(group?.enabled)).length))}</strong>
                    <small>Structured groups prepared for future selection UI.</small>
                  </article>
                  <article class="editor-variant-summary-card">
                    <span>Rendered attributes</span>
                    <strong>${escapeHtml(String((validationState.foundation.futurePayload.attributes || []).length))}</strong>
                    <small>Normalized option records ready for the storefront contract.</small>
                  </article>
                  <article class="editor-variant-summary-card">
                    <span>Variant readiness</span>
                    <strong>${escapeHtml(validationState.foundation.readiness.supportsVariants ? "Prepared" : "Pending")}</strong>
                    <small>Future inventory and pricing hooks remain intentionally deferred.</small>
                  </article>
                </div>
                ${buildVariantGroupMarkup("color", "Color Variants", "Premium swatch-led color rendering for detail pages, cards, and future image-per-color switching.", ["Black|black|#111111", "White|white|#f7f7f7", "Emerald|emerald|#00b894", "Sand|sand|#e9dcc8"])}
                ${buildVariantGroupMarkup("size", "Size Variants", "Scalable size buttons for apparel, footwear, and future custom sizing systems.", ["XS|xs", "S|s", "M|m", "L|l", "XL|xl"])}
                ${buildVariantGroupMarkup("style", "Style / Material Variants", "An expandable text-based option group for materials, fits, or future style families.", ["Classic|classic", "Regular|regular", "Premium|premium", "Relaxed|relaxed"])}
              </section>

              <section class="editor-section-card">
                <div class="editor-section-heading">
                  <div>
                    <h3>Enterprise Category Architecture</h3>
                    <p>Build complete category systems, hierarchy relationships, inheritance profiles, and product classification foundations while preserving current storefront contracts.</p>
                  </div>
                </div>
                <div class="products-form-grid">
                  <label class="${getFieldClass("classification.category")}">
                    <span>Primary Category (Compatibility)</span>
                    <select data-field="classification.category">
                      ${CATEGORY_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${getDraftValue(draftState, "classification.category") === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
                    </select>
                    <small class="editor-field-message" data-field-message="classification.category">${escapeHtml(getFieldHint("classification.category", "This stays mapped to existing storefront flat category routing and filters."))}</small>
                  </label>
                  <label class="${getFieldClass("classification.taxonomy.primaryCategory")}">
                    <span>Primary Category (Enterprise Taxonomy)</span>
                    <select data-field="classification.taxonomy.primaryCategory">
                      ${CATEGORY_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${getDraftValue(draftState, "classification.taxonomy.primaryCategory") === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
                    </select>
                    <small class="editor-field-message" data-field-message="classification.taxonomy.primaryCategory">${escapeHtml(getFieldHint("classification.taxonomy.primaryCategory", "Canonical taxonomy root for enterprise category management."))}</small>
                  </label>
                  <label class="${getFieldClass("classification.subcategory")}">
                    <span>Subcategory</span>
                    <select data-field="classification.subcategory">
                      ${buildSubcategorySelectMarkup(
                        getDraftValue(draftState, "classification.taxonomy.primaryCategory") || getDraftValue(draftState, "classification.category"),
                        getDraftValue(draftState, "classification.subcategory") || ""
                      )}
                    </select>
                    <small class="editor-field-message" data-field-message="classification.subcategory">${escapeHtml(getFieldHint("classification.subcategory", "Subcategory options are scoped to the selected primary taxonomy category."))}</small>
                  </label>
                  <label class="${getFieldClass("classification.taxonomy.relationship")}">
                    <span>Category Relationship</span>
                    <select data-field="classification.taxonomy.relationship">
                      ${CATEGORY_RELATIONSHIP_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${getDraftValue(draftState, "classification.taxonomy.relationship") === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
                    </select>
                    <small class="editor-field-message" data-field-message="classification.taxonomy.relationship">${escapeHtml(getFieldHint("classification.taxonomy.relationship", "Controls direct, nested, or cross-category assignment behavior."))}</small>
                  </label>
                  <label class="${getFieldClass("classification.taxonomy.inheritance")}">
                    <span>Inheritance Strategy</span>
                    <select data-field="classification.taxonomy.inheritance">
                      ${CATEGORY_INHERITANCE_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${getDraftValue(draftState, "classification.taxonomy.inheritance") === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
                    </select>
                    <small class="editor-field-message" data-field-message="classification.taxonomy.inheritance">${escapeHtml(getFieldHint("classification.taxonomy.inheritance", "Controls inherited keywords and labels in future search and filtering engines."))}</small>
                  </label>
                </div>
                <div class="editor-subsection">
                  <div class="editor-subsection-heading">
                    <div>
                      <h4>Secondary Category Assignments</h4>
                      <p>Assign cross-category coverage without changing the storefront flat category contract yet.</p>
                    </div>
                  </div>
                  <div class="editor-tag-input-row">
                    <input type="text" data-token-input="classification.taxonomy.secondaryCategories" placeholder="Add secondary category slug and press Enter">
                    <button type="button" class="products-secondary-link" data-add-token="classification.taxonomy.secondaryCategories">Add secondary category</button>
                  </div>
                  <div class="editor-suggestion-list">
                    ${CATEGORY_OPTIONS.map((category) => `<button type="button" class="editor-suggestion-chip" data-token-suggestion="classification.taxonomy.secondaryCategories" data-token-value="${escapeHtml(category.value)}">${escapeHtml(category.label)}</button>`).join("")}
                  </div>
                  <div class="editor-tag-list" data-token-list="classification.taxonomy.secondaryCategories">${buildTokenMarkup("classification.taxonomy.secondaryCategories", "No secondary categories assigned. Add optional cross-category coverage as needed.")}</div>
                  <small class="editor-field-message" data-field-message="classification.taxonomy.secondaryCategories">${escapeHtml(getFieldHint("classification.taxonomy.secondaryCategories", "Optional. Use for recommendation overlap, cross-category browse paths, and future campaign grouping."))}</small>
                </div>
                ${buildClassificationArchitectureMarkup()}
                <div class="editor-subsection">
                  <div class="editor-subsection-heading">
                    <div>
                      <h4>Product Tags</h4>
                      <p>Search and filter descriptors normalized for future catalog matching.</p>
                    </div>
                  </div>
                  <div class="editor-tag-input-row">
                    <input type="text" data-token-input="classification.tags" placeholder="Type a tag and press Enter">
                    <button type="button" class="products-secondary-link" data-add-token="classification.tags">Add tag</button>
                  </div>
                  <div class="editor-suggestion-list">
                    ${TAG_SUGGESTIONS.map((tag) => `<button type="button" class="editor-suggestion-chip" data-token-suggestion="classification.tags" data-token-value="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")}
                  </div>
                  <div class="editor-tag-list" data-token-list="classification.tags">${buildTokenMarkup("classification.tags", "No product tags added yet. Use tags to prepare search and filter foundations.")}</div>
                  <small class="editor-field-message" data-field-message="classification.tags">${escapeHtml(getFieldHint("classification.tags", "Optional, but useful for future search and filtering intelligence."))}</small>
                </div>
                <div class="editor-subsection">
                  <div class="editor-subsection-heading">
                    <div>
                      <h4>Product Labels</h4>
                      <p>Merchandising labels for badges, featured blocks, and campaign alignment.</p>
                    </div>
                  </div>
                  <div class="editor-tag-input-row">
                    <input type="text" data-token-input="classification.labels" placeholder="Type a label and press Enter">
                    <button type="button" class="products-secondary-link" data-add-token="classification.labels">Add label</button>
                  </div>
                  <div class="editor-suggestion-list">
                    ${LABEL_SUGGESTIONS.map((label) => `<button type="button" class="editor-suggestion-chip" data-token-suggestion="classification.labels" data-token-value="${escapeHtml(label)}">${escapeHtml(label)}</button>`).join("")}
                  </div>
                  <div class="editor-tag-list" data-token-list="classification.labels">${buildTokenMarkup("classification.labels", "No labels added yet. Labels influence badges and merchandising language.")}</div>
                  <small class="editor-field-message" data-field-message="classification.labels">${escapeHtml(getFieldHint("classification.labels", "Labels later support badges, promotions, and featured merchandising rules."))}</small>
                </div>
              </section>

              <section class="editor-section-card">
                <div class="editor-section-heading">
                  <div>
                    <h3>Product Organization Architecture</h3>
                    <p>Define collection, seasonality, campaign, homepage, recommendation, and search/filter foundations for enterprise product structuring.</p>
                  </div>
                </div>
                <div class="products-form-grid">
                  <label class="${getFieldClass("classification.organization.collectionGroup")}">
                    <span>Collection Group</span>
                    <select data-field="classification.organization.collectionGroup">
                      ${COLLECTION_GROUP_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${getDraftValue(draftState, "classification.organization.collectionGroup") === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
                    </select>
                    <small class="editor-field-message" data-field-message="classification.organization.collectionGroup">${escapeHtml(getFieldHint("classification.organization.collectionGroup", "Groups products into core, editorial, premium, and discovery catalog architectures."))}</small>
                  </label>
                  <label class="${getFieldClass("classification.organization.seasonalGroup")}">
                    <span>Seasonal Group</span>
                    <select data-field="classification.organization.seasonalGroup">
                      ${SEASONAL_GROUP_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${getDraftValue(draftState, "classification.organization.seasonalGroup") === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
                    </select>
                    <small class="editor-field-message" data-field-message="classification.organization.seasonalGroup">${escapeHtml(getFieldHint("classification.organization.seasonalGroup", "Seasonal assignment supports campaign and storefront organization planning."))}</small>
                  </label>
                  <label class="${getFieldClass("classification.organization.campaignGroup")}">
                    <span>Campaign Group</span>
                    <select data-field="classification.organization.campaignGroup">
                      ${CAMPAIGN_GROUP_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${getDraftValue(draftState, "classification.organization.campaignGroup") === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
                    </select>
                    <small class="editor-field-message" data-field-message="classification.organization.campaignGroup">${escapeHtml(getFieldHint("classification.organization.campaignGroup", "Groups product into launch, promotion, and clearance campaign architectures."))}</small>
                  </label>
                  <label class="${getFieldClass("classification.organization.homepageGroup")}">
                    <span>Homepage Group</span>
                    <select data-field="classification.organization.homepageGroup">
                      ${HOMEPAGE_GROUP_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${getDraftValue(draftState, "classification.organization.homepageGroup") === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
                    </select>
                    <small class="editor-field-message" data-field-message="classification.organization.homepageGroup">${escapeHtml(getFieldHint("classification.organization.homepageGroup", "Controls homepage grouping profile for future modules and curated surfaces."))}</small>
                  </label>
                  <label class="${getFieldClass("classification.organization.recommendationGroup")}">
                    <span>Recommendation Group</span>
                    <select data-field="classification.organization.recommendationGroup">
                      ${RECOMMENDATION_GROUP_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${getDraftValue(draftState, "classification.organization.recommendationGroup") === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
                    </select>
                    <small class="editor-field-message" data-field-message="classification.organization.recommendationGroup">${escapeHtml(getFieldHint("classification.organization.recommendationGroup", "Sets recommendation structuring profile for future similarity and upsell engines."))}</small>
                  </label>
                  <label class="${getFieldClass("classification.organization.searchBoost")}">
                    <span>Search Boost Profile</span>
                    <select data-field="classification.organization.searchBoost">
                      ${SEARCH_BOOST_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${getDraftValue(draftState, "classification.organization.searchBoost") === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
                    </select>
                    <small class="editor-field-message" data-field-message="classification.organization.searchBoost">${escapeHtml(getFieldHint("classification.organization.searchBoost", "Prepared search weighting profile for future search ranking layers."))}</small>
                  </label>
                  <label class="${getFieldClass("classification.organization.filterPriority")}">
                    <span>Filter Priority Profile</span>
                    <select data-field="classification.organization.filterPriority">
                      ${FILTER_PRIORITY_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${getDraftValue(draftState, "classification.organization.filterPriority") === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
                    </select>
                    <small class="editor-field-message" data-field-message="classification.organization.filterPriority">${escapeHtml(getFieldHint("classification.organization.filterPriority", "Prepared category filter positioning profile for future layered filtering systems."))}</small>
                  </label>
                </div>
                ${buildOrganizationArchitectureMarkup()}
              </section>

              <section class="editor-section-card">
                <div class="editor-section-heading">
                  <div>
                    <h3>Publishing Workflow</h3>
                    <p>Choose the operational state used for draft, published, hidden, scheduled, and premium featured release paths.</p>
                  </div>
                </div>
                <div class="editor-choice-grid" data-choice-group="merchandising.status">
                  ${buildChoiceCards("merchandising.status", getDraftValue(draftState, "merchandising.status"), STATUS_OPTIONS)}
                </div>
                <div class="products-form-grid products-form-grid--compact">
                  <label class="${getFieldClass("merchandising.scheduleAt")}">
                    <span>Scheduled Publish Foundation</span>
                    <input type="datetime-local" data-field="merchandising.scheduleAt" value="${escapeHtml(getDraftValue(draftState, "merchandising.scheduleAt") || "")}">
                    <small class="editor-field-message" data-field-message="merchandising.scheduleAt">${escapeHtml(getFieldHint("merchandising.scheduleAt", "Optional until scheduled status is selected. This stores the future publishing window foundation only."))}</small>
                  </label>
                </div>
              </section>

              <section class="editor-section-card">
                <div class="editor-section-heading">
                  <div>
                    <h3>Product Visibility Engine</h3>
                    <p>Control homepage and shop surface exposure without breaking the existing home, shop, category, search, and detail rendering contract.</p>
                  </div>
                </div>
                <div class="editor-segmented-grid">
                  ${buildVisibilityPresetMarkup()}
                </div>
                <div class="editor-surface-grid">
                  ${buildSurfaceToggleMarkup()}
                </div>
                <small class="editor-field-message" data-field-message="merchandising.visibility">${escapeHtml(getFieldHint("merchandising.visibility", "Use presets for quick routing, then refine Home and Shop exposure with the individual surface toggles."))}</small>
                ${buildMerchandisingSummaryMarkup()}
              </section>

              <section class="editor-section-card">
                <div class="editor-section-heading">
                  <div>
                    <h3>Featured Product Controls</h3>
                    <p>Define whether the product should stay standard, appear as a featured hero, surface as highlighted, or behave like a promoted launch.</p>
                  </div>
                </div>
                <div class="editor-choice-grid" data-choice-group="merchandising.featuredTag">
                  ${buildChoiceCards("merchandising.featuredTag", getDraftValue(draftState, "merchandising.featuredTag"), FEATURED_TAG_OPTIONS)}
                </div>
                <small class="editor-field-message" data-field-message="merchandising.featuredTag">${escapeHtml(getFieldHint("merchandising.featuredTag", "Featured treatments map directly to existing storefront highlight tags used by home and shop rendering."))}</small>
              </section>

              <section class="editor-section-card">
                <div class="editor-section-heading">
                  <div>
                    <h3>Product Positioning Engine</h3>
                    <p>Set the global merchandising bucket used to anchor homepage priority, shop sequencing, featured display ordering, and future recommendation hierarchy.</p>
                  </div>
                </div>
                <div class="editor-choice-grid" data-choice-group="merchandising.position">
                  ${buildChoiceCards("merchandising.position", getDraftValue(draftState, "merchandising.position"), POSITION_OPTIONS)}
                </div>
                <div class="editor-choice-grid" data-choice-group="merchandising.orderingMode">
                  ${buildChoiceCards("merchandising.orderingMode", getDraftValue(draftState, "merchandising.orderingMode"), ORDERING_MODE_OPTIONS)}
                </div>
                <small class="editor-field-message" data-field-message="merchandising.orderingMode">${escapeHtml(getFieldHint("merchandising.orderingMode", "Automatic mode derives existing backend-compatible priority and orderIndex values. Manual mode reserves a stronger future ordering foundation."))}</small>
                ${buildPositioningEngineMarkup()}
              </section>

              <section class="editor-section-card">
                <div class="editor-section-heading">
                  <div>
                    <h3>Rendering Priority System</h3>
                    <p>Choose the ranking strategy that will later drive weighted ordering, analytics-led sequencing, featured-first merchandising, and manual ranking control.</p>
                  </div>
                </div>
                <div class="editor-choice-grid" data-choice-group="merchandising.positioning.sortStrategy">
                  ${buildChoiceCards("merchandising.positioning.sortStrategy", getDraftValue(draftState, "merchandising.positioning.sortStrategy"), SORTING_STRATEGY_OPTIONS)}
                </div>
                <small class="editor-field-message" data-field-message="merchandising.positioning.sortStrategy">${escapeHtml(getFieldHint("merchandising.positioning.sortStrategy", "This does not change storefront sorting yet. It builds the clean strategy foundation for future manual, featured-first, popularity, sales, and recency-driven ranking."))}</small>
              </section>

              <section class="editor-section-card">
                <div class="editor-section-heading">
                  <div>
                    <h3>Homepage Product Ordering Foundation</h3>
                    <p>Prepare homepage hero, featured-row, standard-grid, and trailing-grid positioning with explicit sequence support for later drag sorting and analytics-driven ordering.</p>
                  </div>
                </div>
                <div class="editor-choice-grid" data-choice-group="merchandising.positioning.homePlacement">
                  ${buildChoiceCards("merchandising.positioning.homePlacement", getDraftValue(draftState, "merchandising.positioning.homePlacement"), HOMEPAGE_PLACEMENT_OPTIONS)}
                </div>
                <div class="products-form-grid products-form-grid--compact">
                  <label class="${getFieldClass("merchandising.positioning.homeOrder")}">
                    <span>Homepage Sequence</span>
                    <input type="number" min="0" step="1" data-field="merchandising.positioning.homeOrder" value="${escapeHtml(String(getDraftValue(draftState, "merchandising.positioning.homeOrder") || 0))}" placeholder="0">
                    <small class="editor-field-message" data-field-message="merchandising.positioning.homeOrder">${escapeHtml(getFieldHint("merchandising.positioning.homeOrder", "Use 0 for automatic weighting. Lower future sequence numbers represent earlier homepage ordering."))}</small>
                  </label>
                </div>
              </section>

              <section class="editor-section-card">
                <div class="editor-section-heading">
                  <div>
                    <h3>Shop Product Ordering Foundation</h3>
                    <p>Prepare clean shop-grid sequencing for featured-first, top-grid, standard-grid, and trailing-grid product flows without changing the stable shop renderer yet.</p>
                  </div>
                </div>
                <div class="editor-choice-grid" data-choice-group="merchandising.positioning.shopPlacement">
                  ${buildChoiceCards("merchandising.positioning.shopPlacement", getDraftValue(draftState, "merchandising.positioning.shopPlacement"), SHOP_PLACEMENT_OPTIONS)}
                </div>
                <div class="products-form-grid products-form-grid--compact">
                  <label class="${getFieldClass("merchandising.positioning.shopOrder")}">
                    <span>Shop Sequence</span>
                    <input type="number" min="0" step="1" data-field="merchandising.positioning.shopOrder" value="${escapeHtml(String(getDraftValue(draftState, "merchandising.positioning.shopOrder") || 0))}" placeholder="0">
                    <small class="editor-field-message" data-field-message="merchandising.positioning.shopOrder">${escapeHtml(getFieldHint("merchandising.positioning.shopOrder", "Use 0 for automatic weighting. Lower future sequence numbers represent earlier shop ordering."))}</small>
                  </label>
                </div>
              </section>

              <section class="editor-section-card">
                <div class="editor-section-heading">
                  <div>
                    <h3>Featured Product Priority System</h3>
                    <p>Prepare featured hero, spotlight, and supporting placement hierarchy with explicit ordering controls for future homepage and shop featured sections.</p>
                  </div>
                </div>
                <div class="editor-choice-grid" data-choice-group="merchandising.positioning.featuredPlacement">
                  ${buildChoiceCards("merchandising.positioning.featuredPlacement", getDraftValue(draftState, "merchandising.positioning.featuredPlacement"), FEATURED_PLACEMENT_OPTIONS)}
                </div>
                <div class="products-form-grid products-form-grid--compact">
                  <label class="${getFieldClass("merchandising.positioning.featuredOrder")}">
                    <span>Featured Sequence</span>
                    <input type="number" min="0" step="1" data-field="merchandising.positioning.featuredOrder" value="${escapeHtml(String(getDraftValue(draftState, "merchandising.positioning.featuredOrder") || 0))}" placeholder="0">
                    <small class="editor-field-message" data-field-message="merchandising.positioning.featuredOrder">${escapeHtml(getFieldHint("merchandising.positioning.featuredOrder", "Use 0 for automatic weighting. Lower future sequence numbers represent earlier featured placement."))}</small>
                  </label>
                </div>
              </section>

              <section class="editor-section-card">
                <div class="editor-section-heading">
                  <div>
                    <h3>Enterprise Merchandising Structure</h3>
                    <p>Prepare campaign slots, category sequence, recommendation flow, and recommendation order foundations for future banners, seasonal campaigns, dynamic merchandising, and personalization.</p>
                  </div>
                </div>
                <div class="editor-choice-grid" data-choice-group="merchandising.positioning.campaignSlot">
                  ${buildChoiceCards("merchandising.positioning.campaignSlot", getDraftValue(draftState, "merchandising.positioning.campaignSlot"), CAMPAIGN_SLOT_OPTIONS)}
                </div>
                <div class="editor-choice-grid" data-choice-group="merchandising.positioning.recommendationFlow">
                  ${buildChoiceCards("merchandising.positioning.recommendationFlow", getDraftValue(draftState, "merchandising.positioning.recommendationFlow"), RECOMMENDATION_FLOW_OPTIONS)}
                </div>
                <div class="products-form-grid products-form-grid--compact products-form-grid--ordering">
                  <label class="${getFieldClass("merchandising.positioning.categoryOrder")}">
                    <span>Category Sequence</span>
                    <input type="number" min="0" step="1" data-field="merchandising.positioning.categoryOrder" value="${escapeHtml(String(getDraftValue(draftState, "merchandising.positioning.categoryOrder") || 0))}" placeholder="0">
                    <small class="editor-field-message" data-field-message="merchandising.positioning.categoryOrder">${escapeHtml(getFieldHint("merchandising.positioning.categoryOrder", "Future category order foundation. Lower sequence numbers represent earlier category-grid placement."))}</small>
                  </label>
                  <label class="${getFieldClass("merchandising.positioning.recommendationOrder")}">
                    <span>Recommendation Sequence</span>
                    <input type="number" min="0" step="1" data-field="merchandising.positioning.recommendationOrder" value="${escapeHtml(String(getDraftValue(draftState, "merchandising.positioning.recommendationOrder") || 0))}" placeholder="0">
                    <small class="editor-field-message" data-field-message="merchandising.positioning.recommendationOrder">${escapeHtml(getFieldHint("merchandising.positioning.recommendationOrder", "Future recommendation order foundation. Lower sequence numbers represent earlier recommendation placement."))}</small>
                  </label>
                </div>
              </section>

              <section class="editor-section-card">
                <div class="editor-section-heading editor-section-heading--split">
                  <div>
                    <h3>Enterprise Media Management</h3>
                    <p>Premium upload staging for featured images, gallery foundations, responsive preview handling, and future-ready product media architecture.</p>
                  </div>
                  <div class="editor-upload-row">
                    <button type="button" class="products-secondary-link" data-upload-browse="main">Browse main image</button>
                    <button type="button" class="products-secondary-link" data-upload-browse="gallery">Add gallery images</button>
                  </div>
                </div>

                <input type="file" accept="${escapeHtml(MEDIA_ACCEPTED_TYPES.join(","))}" data-image-input="main" hidden>
                <input type="file" accept="${escapeHtml(MEDIA_ACCEPTED_TYPES.join(","))}" data-image-input="gallery" hidden multiple>

                ${buildMediaManagementMarkup()}

                <div class="editor-media-grid">
                  <div class="editor-upload-stack ${getFieldClass("media.mainImage", "editor-upload-stack")}">
                    <div class="editor-main-image-stage" data-main-image-stage>
                      ${buildMainImageStage()}
                    </div>
                    <div class="editor-main-image-controls">
                      <div class="upload-dropzone${mediaUiState.phase === "loading" && mediaUiState.target === "main" ? " is-loading" : ""}" data-upload-zone="main" tabindex="0" role="button" aria-label="Upload main image">
                        <div class="upload-dropzone__icon">Main</div>
                        <div class="upload-dropzone__copy">
                          <strong>Hero image drop zone</strong>
                          <p>${mediaUiState.phase === "loading" && mediaUiState.target === "main" ? "Reading featured image selection..." : "Drop one image here or browse from your device. Any dimensions are fitted safely for admin review."}</p>
                        </div>
                        <div class="upload-dropzone__meta">
                          <span>${escapeHtml(MEDIA_ACCEPTED_TYPES.map((type) => type.replace("image/", "").toUpperCase()).join(" / "))}</span>
                          <span>${draftState.media.mainImage ? "Featured image ready" : "Featured image required"}</span>
                        </div>
                      </div>
                      <small class="editor-field-message" data-field-message="media.mainImage">${escapeHtml(getFieldHint("media.mainImage", "A main image is required for safe storefront rendering and validation."))}</small>
                      ${draftState.media.mainImage ? `<button type="button" class="products-danger-button" data-clear-main-image>Remove main image</button>` : ""}
                    </div>
                  </div>

                  <div class="editor-upload-stack">
                    <div class="upload-dropzone upload-dropzone--gallery${mediaUiState.phase === "loading" && mediaUiState.target === "gallery" ? " is-loading" : ""}" data-upload-zone="gallery" tabindex="0" role="button" aria-label="Upload gallery images">
                      <div class="upload-dropzone__icon">Gallery</div>
                      <div class="upload-dropzone__copy">
                        <strong>Drag gallery images here</strong>
                        <p>${mediaUiState.phase === "loading" && mediaUiState.target === "gallery" ? "Reading gallery selection..." : "Create a responsive preview grid for future carousel, detail, and alternate-view rendering."}</p>
                      </div>
                      <div class="upload-dropzone__meta">
                        <span>Multi-select enabled</span>
                        <span>${escapeHtml(String(draftState.media.gallery.length))} / ${escapeHtml(String(MEDIA_MAX_GALLERY_ITEMS))} staged</span>
                      </div>
                    </div>
                    <div class="editor-gallery-grid" data-gallery-grid>${buildGalleryMarkup()}</div>
                    <small class="editor-field-message" data-field-message="media.gallery">${escapeHtml(getFieldHint("media.gallery", "Gallery assets remain optional in STEP 3D but are structured for future detail-page use."))}</small>
                  </div>
                </div>

                ${buildMediaIssuesMarkup()}
              </section>

              <div class="products-form-actions products-form-actions--split">
                <div class="products-form-status" data-form-status data-state="${escapeHtml(uiNotice.tone)}">${escapeHtml(uiNotice.message)}</div>
                <div class="products-action-stack">
                  <button type="button" class="products-secondary-link" data-action="reset">Reset form</button>
                  <button type="button" class="products-secondary-link" data-action="save">Save local draft</button>
                  <button type="button" class="products-primary-button" data-action="prepare">Validate foundation</button>
                </div>
              </div>
            </form>
          </section>

          <section class="dashboard-panel products-table-panel">
            <div class="editor-section-heading editor-section-heading--split">
              <div>
                <h3>Catalog Snapshot</h3>
                <p>Existing live products stay visible here so duplicate checks and information architecture remain grounded in the active catalog.</p>
              </div>
              <span class="products-inline-pill">${escapeHtml(String(latestProducts.length))} products</span>
            </div>
            <div class="products-recent-grid">
              ${buildRecentProductsMarkup()}
            </div>
          </section>
        </div>

        <aside class="dashboard-panel products-preview-panel products-preview-panel--full">
          <div class="products-preview-stack">
            ${buildStorefrontPreview()}
            ${buildDetailPreview()}
            ${buildGalleryFoundationPreviewMarkup()}
            <article class="product-preview-card product-preview-card--detail">
              <p class="product-preview-eyebrow">Visibility & Rendering Readiness</p>
              <div class="preview-surface-grid">
                ${buildPreviewSurfaceMarkup()}
              </div>
            </article>
            ${buildFoundationPreviewMarkup()}
            <article class="product-preview-card product-preview-card--detail">
              <p class="product-preview-eyebrow">Future-Ready Compatibility</p>
              <ul class="product-preview-detail-list">
                <li><span>Gallery systems</span><strong>Prepared</strong></li>
                <li><span>Variants & attributes</span><strong>Prepared</strong></li>
                <li><span>Inventory & analytics</span><strong>Prepared</strong></li>
                <li><span>Search / filters / SEO</span><strong>Prepared</strong></li>
                <li><span>Category taxonomy / grouping</span><strong>Prepared</strong></li>
              </ul>
            </article>
          </div>
        </aside>
      </div>
    </div>
  `;
}

function syncChoiceCards(root) {
  root.querySelectorAll("[data-choice-group]").forEach((group) => {
    group.querySelectorAll(".editor-choice-card").forEach((card) => {
      const input = card.querySelector("input");
      card.classList.toggle("is-selected", Boolean(input?.checked));
    });
  });
}

function syncFieldStates(root) {
  root.querySelectorAll("[data-field]").forEach((input) => {
    const label = input.closest(".editor-field, .editor-toggle-pill");
    if (!label) {
      return;
    }

    const field = input.dataset.field;
    label.classList.remove("is-invalid", "is-warning", "is-valid");
    const issue = getFieldIssue(field);

    if (issue.tone === "error") {
      label.classList.add("is-invalid");
      return;
    }

    if (issue.tone === "warning") {
      label.classList.add("is-warning");
      return;
    }

    const value = getDraftValue(draftState, field);
    const hasValue = Array.isArray(value) ? value.length > 0 : Boolean(String(value || "").trim());
    if (hasValue) {
      label.classList.add("is-valid");
    }
  });

  root.querySelectorAll("[data-field-message]").forEach((messageNode) => {
    const field = messageNode.dataset.fieldMessage;
    messageNode.classList.remove("is-error", "is-warning");
    const issue = getFieldIssue(field);
    if (issue.tone === "error") {
      messageNode.classList.add("is-error");
    }
    if (issue.tone === "warning") {
      messageNode.classList.add("is-warning");
    }
  });
}

function syncUi(root) {
  recomputeValidation();

  const galleryGrid = root.querySelector("[data-gallery-grid]");
  const mainImageStage = root.querySelector("[data-main-image-stage]");
  const formStatus = root.querySelector("[data-form-status]");
  const discountInput = root.querySelector('[data-field="pricing.discountPrice"]');
  const previewStack = root.querySelector(".products-preview-stack");
  const validationSummary = root.querySelector("[data-validation-summary]");
  const foundationCode = root.querySelector("[data-foundation-code]");
  const inlineSummaryValue = root.querySelector(".editor-inline-summary span");
  const inlineSummarySmall = root.querySelector(".editor-inline-summary small");

  ["classification.tags", "classification.labels", "classification.taxonomy.secondaryCategories", "variants.groups.color.optionTokens", "variants.groups.size.optionTokens", "variants.groups.style.optionTokens"].forEach((path) => {
    const tokenList = root.querySelector(`[data-token-list="${path}"]`);
    if (tokenList) {
      tokenList.innerHTML = buildTokenMarkup(
        path,
        path === "classification.tags"
          ? "No product tags added yet. Use tags to prepare search and filter foundations."
          : path === "classification.labels"
            ? "No labels added yet. Labels influence badges and merchandising language."
            : path === "classification.taxonomy.secondaryCategories"
              ? "No secondary categories assigned. Add optional cross-category coverage as needed."
              : path === "variants.groups.color.optionTokens"
                ? "No color options staged yet. Add structured color tokens to prepare swatches and future image switching."
                : path === "variants.groups.size.optionTokens"
                  ? "No size options staged yet. Add structured size tokens to prepare size selectors."
                  : "No style or material options staged yet. Add structured text tokens for expandable option families."
      );
    }
  });

  const variantSummaryCards = root.querySelectorAll(".editor-variant-summary-card strong");
  if (variantSummaryCards[0]) {
    variantSummaryCards[0].textContent = String(Object.values(getDraftValue(draftState, "variants.groups") || {}).filter((group) => Boolean(group?.enabled)).length);
  }
  if (variantSummaryCards[1]) {
    variantSummaryCards[1].textContent = String((validationState.foundation.futurePayload.attributes || []).length);
  }
  if (variantSummaryCards[2]) {
    variantSummaryCards[2].textContent = validationState.foundation.readiness.supportsVariants ? "Prepared" : "Pending";
  }

  if (galleryGrid) {
    galleryGrid.innerHTML = buildGalleryMarkup();
  }

  if (mainImageStage) {
    mainImageStage.innerHTML = buildMainImageStage();
  }

  if (discountInput) {
    discountInput.disabled = !getDraftValue(draftState, "pricing.saleEnabled");
  }

  if (validationSummary) {
    validationSummary.outerHTML = buildValidationSummaryMarkup();
  }

  if (foundationCode) {
    foundationCode.textContent = JSON.stringify(validationState.foundation.futurePayload, null, 2);
  }

  if (inlineSummaryValue) {
    inlineSummaryValue.textContent = formatCurrency(getActivePrice(draftState));
  }

  if (inlineSummarySmall) {
    inlineSummarySmall.textContent = getCompareAtPrice(draftState)
      ? `Compare at ${formatCurrency(getCompareAtPrice(draftState))}`
      : "No compare-at price active.";
  }

  if (formStatus) {
    formStatus.textContent = uiNotice.message;
    formStatus.dataset.state = uiNotice.tone;
  }

  if (previewStack) {
    previewStack.innerHTML = `
      ${buildStorefrontPreview()}
      ${buildDetailPreview()}
      ${buildGalleryFoundationPreviewMarkup()}
      <article class="product-preview-card product-preview-card--detail">
        <p class="product-preview-eyebrow">Visibility & Rendering Readiness</p>
        <div class="preview-surface-grid">
          ${buildPreviewSurfaceMarkup()}
        </div>
      </article>
      ${buildFoundationPreviewMarkup()}
      <article class="product-preview-card product-preview-card--detail">
        <p class="product-preview-eyebrow">Future-Ready Compatibility</p>
        <ul class="product-preview-detail-list">
          <li><span>Gallery systems</span><strong>Prepared</strong></li>
          <li><span>Variants & attributes</span><strong>Prepared</strong></li>
          <li><span>Inventory & analytics</span><strong>Prepared</strong></li>
          <li><span>Search / filters / SEO</span><strong>Prepared</strong></li>
          <li><span>Category taxonomy / grouping</span><strong>Prepared</strong></li>
        </ul>
      </article>
    `;
  }

  syncChoiceCards(root);
  syncFieldStates(root);
}

function readFilesAsDataUrls(fileList) {
  if (window.AdminImagePicker && typeof window.AdminImagePicker.readFilesAsDataUrls === "function") {
    return window.AdminImagePicker.readFilesAsDataUrls(fileList);
  }

  return Promise.all(Array.from(fileList || []).map((file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      size: file.size,
      type: file.type,
      dataUrl: String(reader.result || "")
    });
    reader.onerror = () => reject(reader.error || new Error("Unable to read file."));
    reader.readAsDataURL(file);
  })));
}

function buildMediaWorkspaceMessage(target, result) {
  const targetLabel = target === "main" ? "featured image" : "gallery";
  if (!result.attemptedCount) {
    return "No media files were selected.";
  }

  if (result.acceptedCount && !result.rejectedCount) {
    return `${result.acceptedCount} ${targetLabel} image${result.acceptedCount === 1 ? "" : "s"} staged successfully for responsive preview.`;
  }

  if (result.acceptedCount) {
    return `${result.acceptedCount} ${targetLabel} image${result.acceptedCount === 1 ? "" : "s"} staged, while ${result.rejectedCount} selection${result.rejectedCount === 1 ? " was" : "s were"} blocked or skipped.`;
  }

  return `No ${targetLabel} files were staged. Review the media issues and try again.`;
}

async function stageMediaFiles(container, target, files) {
  const selection = Array.from(files || []);
  if (!selection.length) {
    return;
  }

  setMediaUiState({
    phase: "loading",
    target,
    tone: "neutral",
    message: `Reading ${selection.length} ${target === "main" ? "featured" : "gallery"} image${selection.length === 1 ? "" : "s"}...`,
    issues: []
  });
  mountProductsPage(container);

  try {
    const fileData = await readFilesAsDataUrls(selection);
    const applied = applyMediaSelection(draftState, target, fileData);
    draftState = applied.draft;

    const tone = applied.result.hasBlockingIssue
      ? "error"
      : applied.result.hasAdvisoryIssue
        ? "warn"
        : "success";
    const message = buildMediaWorkspaceMessage(target, applied.result);

    setMediaUiState({
      phase: "ready",
      target,
      tone,
      message,
      issues: applied.result.issues
    });
    setUiNotice(message, tone);
  } catch (error) {
    const message = error?.message || "Unable to stage the selected media files.";
    setMediaUiState({
      phase: "error",
      target,
      tone: "error",
      message,
      issues: [{ tone: "error", fileName: "Upload", message }]
    });
    setUiNotice(message, "error");
  }

  mountProductsPage(container);
}

function mountProductsPage(container) {
  recomputeValidation();
  container.innerHTML = buildProductsMarkup();
  const root = container.querySelector("[data-products-create-root]");
  if (!root) {
    return;
  }

  function applyFieldUpdate(field, nextValue) {
    if (field === "merchandising.surfaces.home") {
      draftState = updateMerchandisingSurface(draftState, "home", nextValue);
    } else if (field === "merchandising.surfaces.shop") {
      draftState = updateMerchandisingSurface(draftState, "shop", nextValue);
    } else if (field === "merchandising.visibility") {
      draftState = updateMerchandisingVisibilityPreset(draftState, nextValue);
    } else {
      draftState = setDraftValue(draftState, field, nextValue);
    }

    if (field === "classification.category") {
      draftState = setDraftValue(draftState, "classification.taxonomy.primaryCategory", nextValue);
    }

    if (field === "classification.taxonomy.primaryCategory") {
      draftState = setDraftValue(draftState, "classification.category", nextValue);
    }

    if (
      field.startsWith("merchandising.")
      || field === "classification.category"
      || field === "classification.subcategory"
      || field.startsWith("classification.taxonomy")
      || field.startsWith("classification.organization")
    ) {
      mountProductsPage(container);
      return;
    }

    syncUi(root);
  }

  root.addEventListener("input", (event) => {
    const field = event.target?.dataset?.field;
    if (!field) {
      return;
    }

    const nextValue = event.target.type === "checkbox"
      ? event.target.checked
      : event.target.value;
    applyFieldUpdate(field, nextValue);
  });

  root.addEventListener("change", async (event) => {
    const imageTarget = event.target?.dataset?.imageInput;
    if (imageTarget) {
      try {
        await stageMediaFiles(container, imageTarget, event.target.files || []);
      } finally {
        event.target.value = "";
      }
      return;
    }

    const field = event.target?.dataset?.field;
    if (!field) {
      return;
    }

    const nextValue = event.target.type === "checkbox"
      ? event.target.checked
      : event.target.value;
    applyFieldUpdate(field, nextValue);
  });

  root.addEventListener("keydown", (event) => {
    const tokenInput = event.target.closest("[data-token-input]");
    if (tokenInput && event.key === "Enter") {
      event.preventDefault();
      const path = tokenInput.dataset.tokenInput;
      const preserveCase = path === "classification.labels";
      const nextDraft = addDraftToken(draftState, path, tokenInput.value, { preserveCase });
      if (nextDraft !== draftState) {
        draftState = nextDraft;
        const tokenLabel = path === "classification.labels"
          ? "Label"
          : path === "classification.taxonomy.secondaryCategories"
            ? "Secondary category"
            : "Tag";
        setUiNotice(`${tokenLabel} added to the product foundation.`, "success");
      }
      tokenInput.value = "";
      syncUi(root);
      return;
    }

    const uploadZone = event.target.closest("[data-upload-zone]");
    if (uploadZone && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      root.querySelector(`[data-image-input="${uploadZone.dataset.uploadZone}"]`)?.click();
    }
  });

  root.querySelectorAll("[data-visibility-preset-option]").forEach((option) => {
    option.addEventListener("click", (event) => {
      event.preventDefault();
      draftState = updateMerchandisingVisibilityPreset(draftState, option.dataset.presetValue);
      setUiNotice("Product visibility routing updated for the merchandising foundation.", "success");
      mountProductsPage(container);
    });
  });

  root.addEventListener("click", (event) => {
    const addTokenTrigger = event.target.closest("[data-add-token]");
    if (addTokenTrigger) {
      const path = addTokenTrigger.dataset.addToken;
      const tokenInput = root.querySelector(`[data-token-input="${path}"]`);
      if (tokenInput) {
        const preserveCase = path === "classification.labels";
        const nextDraft = addDraftToken(draftState, path, tokenInput.value, { preserveCase });
        if (nextDraft !== draftState) {
          draftState = nextDraft;
          const tokenLabel = path === "classification.labels"
            ? "Label"
            : path === "classification.taxonomy.secondaryCategories"
              ? "Secondary category"
              : "Tag";
          setUiNotice(`${tokenLabel} added to the product foundation.`, "success");
        }
        tokenInput.value = "";
        syncUi(root);
      }
      return;
    }

    const tokenSuggestion = event.target.closest("[data-token-suggestion]");
    if (tokenSuggestion) {
      const path = tokenSuggestion.dataset.tokenSuggestion;
      const preserveCase = path === "classification.labels";
      draftState = addDraftToken(draftState, path, tokenSuggestion.dataset.tokenValue || "", { preserveCase });
      const suggestionLabel = path === "classification.labels"
        ? "Suggested label"
        : path === "classification.taxonomy.secondaryCategories"
          ? "Suggested secondary category"
          : "Suggested tag";
      setUiNotice(`${suggestionLabel} added.`, "success");
      syncUi(root);
      return;
    }

    const removeTokenTrigger = event.target.closest("[data-remove-token]");
    if (removeTokenTrigger) {
      draftState = removeDraftToken(draftState, removeTokenTrigger.dataset.removeToken, removeTokenTrigger.dataset.tokenValue);
      setUiNotice("List token removed from the product foundation.", "neutral");
      syncUi(root);
      return;
    }

    const browseTrigger = event.target.closest("[data-upload-browse]");
    if (browseTrigger) {
      root.querySelector(`[data-image-input="${browseTrigger.dataset.uploadBrowse}"]`)?.click();
      return;
    }

    const uploadZone = event.target.closest("[data-upload-zone]");
    if (uploadZone) {
      root.querySelector(`[data-image-input="${uploadZone.dataset.uploadZone}"]`)?.click();
      return;
    }

    const removeImageTrigger = event.target.closest("[data-remove-image]");
    if (removeImageTrigger) {
      draftState = removeMediaAsset(draftState, "gallery", removeImageTrigger.dataset.removeImage);
      setMediaUiState({
        phase: "ready",
        target: "gallery",
        tone: "neutral",
        message: "Gallery image removed from the staged media set.",
        issues: []
      });
      setUiNotice("Gallery image removed from the staged foundation preview.", "neutral");
      mountProductsPage(container);
      return;
    }

    const setMainTrigger = event.target.closest("[data-set-main-image]");
    if (setMainTrigger) {
      draftState = promoteMediaAssetToMain(draftState, setMainTrigger.dataset.setMainImage);
      setMediaUiState({
        phase: "ready",
        target: "main",
        tone: "success",
        message: "Selected gallery image promoted to the featured image slot.",
        issues: []
      });
      setUiNotice("Selected gallery image promoted to the main product image.", "success");
      mountProductsPage(container);
      return;
    }

    const moveImageTrigger = event.target.closest("[data-move-image]");
    if (moveImageTrigger) {
      draftState = moveGalleryAsset(draftState, moveImageTrigger.dataset.moveImage, moveImageTrigger.dataset.direction);
      setMediaUiState({
        phase: "ready",
        target: "gallery",
        tone: "neutral",
        message: "Gallery order updated for future detail-page thumbnails and carousel foundations.",
        issues: []
      });
      setUiNotice("Gallery order updated for the future media foundation.", "success");
      mountProductsPage(container);
      return;
    }

    if (event.target.closest("[data-clear-main-image]")) {
      draftState = removeMediaAsset(draftState, "main");
      setMediaUiState({
        phase: "ready",
        target: "main",
        tone: "neutral",
        message: "Featured image cleared. Stage a replacement to restore storefront-ready rendering.",
        issues: []
      });
      setUiNotice("Main image cleared from the product foundation.", "neutral");
      mountProductsPage(container);
      return;
    }

    const actionTrigger = event.target.closest("[data-action]");
    if (!actionTrigger) {
      return;
    }

    const action = actionTrigger.dataset.action;
    if (action === "reset") {
      draftState = createDefaultProductDraft();
      mediaUiState = createDefaultMediaUiState();
      setUiNotice("The product information draft has been reset. No persisted data was changed.", "neutral");
      mountProductsPage(container);
      return;
    }

    if (action === "save") {
      recomputeValidation();
      setUiNotice(
        validationState.isValid
          ? "Structured product draft captured locally for this session. Publishing, visibility, and ordering foundations remain browser-local until a later API step."
          : `Structured draft captured locally, but ${validationState.errorCount} validation issue${validationState.errorCount === 1 ? "" : "s"} still require attention.`,
        validationState.isValid ? "success" : "warn"
      );
      syncUi(root);
      return;
    }

    if (action === "prepare") {
      recomputeValidation();
      if (!validationState.isValid) {
        setUiNotice(`Resolve ${validationState.errorCount} validation issue${validationState.errorCount === 1 ? "" : "s"} before the product foundation can progress to publishing workflows.`, "error");
      } else {
        setUiNotice("Product information, category organization, media, and merchandising foundations are valid and ready for future publish, sync, and persistence wiring. No API request was executed in STEP 3G.", validationState.warningCount ? "warn" : "success");
      }
      syncUi(root);
    }
  });

  root.querySelectorAll("[data-upload-zone]").forEach((zone) => {
    ["dragenter", "dragover"].forEach((eventName) => {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        zone.classList.add("is-dragover");
      });
    });

    ["dragleave", "dragend", "drop"].forEach((eventName) => {
      zone.addEventListener(eventName, () => {
        zone.classList.remove("is-dragover");
      });
    });

    zone.addEventListener("drop", async (event) => {
      event.preventDefault();
      await stageMediaFiles(container, zone.dataset.uploadZone, event.dataTransfer?.files || []);
    });
  });

  syncUi(root);
}

export async function renderProducts(container) {
  latestProducts = [];
  latestProductsError = "";

  try {
    latestProducts = await getProducts({ preferCache: true, allowCacheFallback: true });
  } catch (error) {
    const rawMessage = String(error?.message || "").trim();
    latestProductsError = /404|failed|network|fetch|request/i.test(rawMessage)
      ? "Live catalog snapshot is unavailable in this environment. The STEP 3G category workspace remains fully usable while backend persistence stays deferred."
      : rawMessage || "Live catalog data could not be loaded. The creation interface remains available.";
  }

  recomputeValidation();
  mountProductsPage(container);
}
