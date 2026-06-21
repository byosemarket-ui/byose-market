import {
  CATEGORY_OPTIONS,
  PLACEMENT_OPTIONS,
  POSITION_MODE_OPTIONS,
  PRODUCT_CONDITION_OPTIONS,
  PRODUCT_STATUS_OPTIONS,
  PRODUCT_TYPE_OPTIONS,
  VISIBILITY_OPTIONS,
  WARRANTY_OPTIONS,
  WIZARD_STEPS
} from "./constants.js";
import { buildAutoSeo, buildProductPayload, validateStep } from "./payload.js";
import { renderColorVariantReviewCards } from "./inventory-ui.js";
import { isPersistableAssetUrl, slugify, toLabel, toNumber } from "./utils.js";

const REVIEWABLE_STEPS = WIZARD_STEPS.filter((entry) => entry.id !== "review");

const PUBLISH_FIELD_KEYS = new Set([
  "visibility",
  "placement",
  "positionMode",
  "priorityScore",
  "featuredProduct",
  "publishStatus"
]);

const SKIP_FIELD_KEYS = new Set([
  "pendingMainFile",
  "pendingGalleryCount",
  "galleryStoragePaths",
  "mainImageStoragePath",
  "description",
  "clientKey",
  "variants",
  "customSizes",
  "sizes",
  "stockStatus"
]);

const COMPLEX_FIELD_KEYS = new Set(["colorVariants", "gallery", "mainImage", "attributes", "placement"]);

function isEmptyValue(value) {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "boolean") {
    return false;
  }
  if (typeof value === "number") {
    return !Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length === 0;
  }
  return !String(value).trim();
}

function humanizeFieldKey(key) {
  return toLabel(String(key || "").replace(/([A-Z])/g, " $1"));
}

function resolveOptionLabel(options, value) {
  const match = options.find((entry) => String(entry.value) === String(value));
  if (!match) {
    return String(value || "");
  }
  return `${match.labelRw} / ${match.labelEn}`;
}

function formatFieldValue(key, value, draft, payload) {
  if (typeof value === "boolean") {
    return value ? "Yes / Yego" : "No / Oya";
  }

  if (key === "category") {
    return resolveOptionLabel(CATEGORY_OPTIONS, value);
  }
  if (key === "productType") {
    return resolveOptionLabel(PRODUCT_TYPE_OPTIONS, value);
  }
  if (key === "condition") {
    return resolveOptionLabel(PRODUCT_CONDITION_OPTIONS, value);
  }
  if (key === "warranty") {
    const base = resolveOptionLabel(WARRANTY_OPTIONS, value);
    const custom = String(draft?.info?.warrantyCustom || "").trim();
    return custom ? `${base} (${custom})` : base;
  }
  if (key === "visibility") {
    return resolveOptionLabel(VISIBILITY_OPTIONS, value);
  }
  if (key === "positionMode") {
    return resolveOptionLabel(POSITION_MODE_OPTIONS, value);
  }
  if (key === "publishStatus") {
    return resolveOptionLabel(PRODUCT_STATUS_OPTIONS, value);
  }
  if (key === "placement" && Array.isArray(value)) {
    if (!value.length) {
      return "None selected / Nta gice cyatoranyijwe";
    }
    return value
      .map((entry) => {
        const match = PLACEMENT_OPTIONS.find((option) => option.value === entry);
        return match ? `${match.labelRw} / ${match.labelEn}` : String(entry);
      })
      .join(" · ");
  }
  if (key === "tags" || key === "highlights") {
    const list = Array.isArray(value) ? value : String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
    return list.length ? list.join(", ") : "";
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const entries = Object.entries(value).filter(([, entryValue]) => !isEmptyValue(entryValue));
    if (!entries.length) {
      return "";
    }
    return entries.map(([entryKey, entryValue]) => `${humanizeFieldKey(entryKey)}: ${entryValue}`).join(" · ");
  }
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? "").trim()).filter(Boolean).join(", ");
  }

  if (["costPrice", "originalPrice", "sellingPrice", "price"].includes(key)) {
    const currency = draft?.pricing?.currency || "RWF";
    const amount = toNumber(value, NaN);
    if (!Number.isFinite(amount)) {
      return String(value || "");
    }
    return `${currency} ${amount.toLocaleString("en-US")}`;
  }

  if (key === "quantity" || key === "stock" || key === "priorityScore") {
    return String(value ?? "");
  }

  if (key === "slug" || key === "metaTitle" || key === "metaDescription") {
    return String(value || "");
  }

  return String(value ?? "").trim();
}

function collectSectionFields(sectionData = {}, stepId, options = {}) {
  const fields = [];

  Object.entries(sectionData || {}).forEach(([key, value]) => {
    if (SKIP_FIELD_KEYS.has(key) || COMPLEX_FIELD_KEYS.has(key)) {
      return;
    }

    const displayValue = formatFieldValue(key, value, options.draft, options.payload);
    const missing = isEmptyValue(value) && isEmptyValue(displayValue);

    fields.push({
      key,
      stepId,
      label: humanizeFieldKey(key),
      value: displayValue,
      rawValue: value,
      status: missing ? "missing" : "complete",
      statusLabel: missing ? "Missing / Not Completed" : "Complete"
    });
  });

  return fields.sort((left, right) => left.label.localeCompare(right.label));
}

function buildInventorySectionFields(draft, payload, options) {
  const inventory = draft?.inventory || {};
  const inventorySkip = new Set([...SKIP_FIELD_KEYS, "colorVariants", "attributes"]);
  const scalarFields = collectSectionFields(
    Object.fromEntries(Object.entries(inventory).filter(([key]) => !inventorySkip.has(key))),
    "inventory",
    { draft, payload }
  );
  const complexFields = buildInventoryComplexFields(draft, payload, options);
  const merged = [...scalarFields];

  complexFields.forEach((field) => {
    const existingIndex = merged.findIndex((entry) => entry.key === field.key);
    if (existingIndex >= 0) {
      merged[existingIndex] = field;
      return;
    }
    merged.push(field);
  });

  return merged;
}

function buildInventoryComplexFields(draft, payload, options) {
  const inventory = draft?.inventory || {};
  const colorVariants = Array.isArray(inventory.colorVariants) ? inventory.colorVariants : [];
  const fields = [];

  fields.push({
    key: "variantsEnabled",
    stepId: "inventory",
    label: "Color Variants Enabled",
    value: inventory.variantsEnabled ? "Yes / Yego" : "No / Oya",
    status: "complete",
    statusLabel: "Complete"
  });

  fields.push({
    key: "totalStock",
    stepId: "inventory",
    label: "Total Stock",
    value: String(payload?.stock ?? 0),
    status: Number(payload?.stock || 0) > 0 ? "complete" : "missing",
    statusLabel: Number(payload?.stock || 0) > 0 ? "Complete" : "Requires Attention"
  });

  if (inventory.variantsEnabled) {
    fields.push({
      key: "colorVariants",
      stepId: "inventory",
      label: "Color Variants",
      value: `${colorVariants.length} color(s)`,
      status: colorVariants.length ? "complete" : "missing",
      statusLabel: colorVariants.length ? "Complete" : "Missing",
      complex: "colorVariants",
      colorVariants
    });

    const missingImages = colorVariants.filter((entry) => !isPersistableAssetUrl(entry?.image));
    if (missingImages.length) {
      fields.push({
        key: "colorVariantImages",
        stepId: "inventory",
        label: "Color Variant Images",
        value: `${colorVariants.length - missingImages.length}/${colorVariants.length} uploaded`,
        status: "missing",
        statusLabel: "Requires Attention"
      });
    }
  }

  const attributes = inventory.attributes && typeof inventory.attributes === "object" ? inventory.attributes : {};
  const attributeEntries = Object.entries(attributes).filter(([, value]) => !isEmptyValue(value));
  fields.push({
    key: "attributes",
    stepId: "inventory",
    label: "Category Attributes",
    value: attributeEntries.length
      ? attributeEntries.map(([key, value]) => `${humanizeFieldKey(key)}: ${value}`).join(" · ")
      : "",
    status: attributeEntries.length ? "complete" : "optional",
    statusLabel: attributeEntries.length ? "Complete" : "Optional"
  });

  return fields;
}

function buildMediaFields(draft, options) {
  const media = draft?.media || {};
  const mainImageUrl = options.mainImageUrl || media.mainImage || "";
  const gallery = Array.isArray(media.gallery) ? media.gallery : [];
  const hasMain = Boolean(options.hasPendingMainImage || isPersistableAssetUrl(media.mainImage));

  return [
    {
      key: "mainImage",
      stepId: "media",
      label: "Main Product Image",
      value: hasMain ? "Uploaded / Yoherejwe" : "",
      status: hasMain ? "complete" : "missing",
      statusLabel: hasMain ? "Complete" : "Requires Attention",
      complex: "mainImage",
      imageUrl: mainImageUrl
    },
    {
      key: "gallery",
      stepId: "media",
      label: "Gallery Images",
      value: gallery.length ? `${gallery.length} image(s)` : "None / Nta foto",
      status: gallery.length ? "complete" : "optional",
      statusLabel: gallery.length ? "Complete" : "Optional",
      complex: "gallery",
      galleryUrls: gallery
    }
  ];
}

function buildSeoFields(draft, payload) {
  const autoSeo = buildAutoSeo(draft?.info || {}, draft?.description || {}, draft?.info?.brand);
  const seo = draft?.seo || {};

  return [
    {
      key: "metaTitle",
      stepId: "publish",
      label: "Meta Title",
      value: payload.metaTitle || autoSeo.metaTitle || "",
      status: !isEmptyValue(payload.metaTitle || autoSeo.metaTitle) ? "complete" : "missing",
      statusLabel: !isEmptyValue(payload.metaTitle || autoSeo.metaTitle) ? "Complete" : "Missing"
    },
    {
      key: "metaDescription",
      stepId: "publish",
      label: "Meta Description",
      value: payload.metaDescription || autoSeo.metaDescription || "",
      status: !isEmptyValue(payload.metaDescription || autoSeo.metaDescription) ? "complete" : "missing",
      statusLabel: !isEmptyValue(payload.metaDescription || autoSeo.metaDescription) ? "Complete" : "Missing"
    },
    {
      key: "slug",
      stepId: "publish",
      label: "Product URL Slug",
      value: payload.slug || autoSeo.slug || slugify(draft?.info?.name),
      status: !isEmptyValue(payload.slug || autoSeo.slug) ? "complete" : "missing",
      statusLabel: !isEmptyValue(payload.slug || autoSeo.slug) ? "Complete" : "Missing"
    },
    {
      key: "slugManual",
      stepId: "publish",
      label: "Manual Slug Override",
      value: seo.slugManual ? "Yes / Yego" : "Automatic / Mu buryo bwikora",
      status: "complete",
      statusLabel: "Complete"
    }
  ];
}

export function buildReviewReport(draft, options = {}) {
  const payload = buildProductPayload(draft);
  const info = draft?.info || {};
  const infoFields = collectSectionFields(
    Object.fromEntries(Object.entries(info).filter(([key]) => !PUBLISH_FIELD_KEYS.has(key))),
    "info",
    { draft, payload }
  );
  const publishFields = collectSectionFields(
    Object.fromEntries(Object.entries(info).filter(([key]) => PUBLISH_FIELD_KEYS.has(key))),
    "publish",
    { draft, payload }
  );
  const pricingFields = collectSectionFields(draft?.pricing || {}, "pricing", { draft, payload });
  const descriptionFields = collectSectionFields(draft?.description || {}, "description", { draft, payload });
  const mediaFields = buildMediaFields(draft, options);
  const seoFields = buildSeoFields(draft, payload);

  const sections = REVIEWABLE_STEPS.map((step) => {
    let fields = [];
    if (step.id === "info") {
      fields = infoFields;
    } else if (step.id === "pricing") {
      fields = pricingFields;
    } else if (step.id === "inventory") {
      fields = buildInventorySectionFields(draft, payload, options);
    } else if (step.id === "description") {
      fields = descriptionFields;
    } else if (step.id === "media") {
      fields = mediaFields;
    } else if (step.id === "publish") {
      fields = [...publishFields, ...seoFields];
    }

    const stepErrors = validateStep(step.id, draft, options);

    return {
      stepId: step.id,
      titleRw: step.labelRw,
      titleEn: step.labelEn,
      fields,
      errors: stepErrors,
      complete: stepErrors.length === 0
    };
  });

  const allFields = sections.flatMap((section) => section.fields);
  const trackedFields = allFields.filter((field) => field.status !== "optional");
  const completeFields = trackedFields.filter((field) => field.status === "complete").length;
  const missingFields = trackedFields.filter((field) => field.status === "missing").length;
  const percent = trackedFields.length
    ? Math.round((completeFields / trackedFields.length) * 100)
    : 0;

  const issues = sections
    .flatMap((section) => section.errors.map((message) => ({
      stepId: section.stepId,
      stepLabel: `${section.titleRw} / ${section.titleEn}`,
      message
    })));

  const hasImage = Boolean(options.hasPendingMainImage || isPersistableAssetUrl(draft?.media?.mainImage));
  const hasPrice = toNumber(draft?.pricing?.sellingPrice, 0) > 0;
  const canPublish = issues.length === 0 && hasImage && hasPrice;

  return {
    draft,
    payload,
    sections,
    issues,
    stats: {
      percent,
      completeFields,
      missingFields,
      totalFields: trackedFields.length,
      issueCount: issues.length
    },
    canPublish,
    hasImage,
    hasPrice,
    autoSeo: buildAutoSeo(info, draft?.description || {}, info.brand)
  };
}

function renderFieldRow(field, escapeHtml) {
  const statusClass = field.status === "complete"
    ? "is-complete"
    : field.status === "optional"
      ? "is-optional"
      : "is-missing";

  return `
    <div class="pm-review-field ${statusClass}">
      <div class="pm-review-field__meta">
        <strong>${escapeHtml(field.label)}</strong>
        <span class="pm-review-field__status">${escapeHtml(field.statusLabel)}</span>
      </div>
      <div class="pm-review-field__value">${escapeHtml(field.value || "—")}</div>
    </div>
  `;
}

function renderSectionBlock(section, escapeHtml) {
  const fieldRows = section.fields
    .filter((field) => field.complex !== "colorVariants" && field.complex !== "gallery" && field.complex !== "mainImage")
    .map((field) => renderFieldRow(field, escapeHtml))
    .join("");

  const colorVariantField = section.fields.find((field) => field.complex === "colorVariants");
  const colorVariantHtml = colorVariantField
    ? `<div class="pm-color-review-grid pm-review-complex">${renderColorVariantReviewCards(colorVariantField.colorVariants || [])}</div>`
    : "";

  const galleryField = section.fields.find((field) => field.complex === "gallery");
  const galleryHtml = galleryField && Array.isArray(galleryField.galleryUrls) && galleryField.galleryUrls.length
    ? `<div class="pm-review-media-grid">${galleryField.galleryUrls.map((url, index) => `
        <figure class="pm-review-media-item">
          <button type="button" class="pm-review-thumb-btn" data-review-image="${escapeHtml(url)}">
            <img src="${escapeHtml(url)}" alt="Gallery ${index + 1}" loading="lazy" />
          </button>
          <figcaption>Gallery ${index + 1}</figcaption>
        </figure>
      `).join("")}</div>`
    : "";

  const mainImageField = section.fields.find((field) => field.complex === "mainImage");
  const mainImageHtml = mainImageField?.imageUrl
    ? `<figure class="pm-review-media-item pm-review-media-item--main">
        <button type="button" class="pm-review-thumb-btn" data-review-image="${escapeHtml(mainImageField.imageUrl)}">
          <img src="${escapeHtml(mainImageField.imageUrl)}" alt="Main product image" loading="lazy" />
        </button>
        <figcaption>Main Image</figcaption>
      </figure>`
    : `<div class="pm-review-media-empty">Main image missing / Ifoto nyamukuru irabura</div>`;

  const stepErrors = section.errors.length
    ? `<ul class="pm-review-step-errors">${section.errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>`
    : "";

  return `
    <article class="pm-review-section card ${section.complete ? "is-complete" : "is-attention"}" data-review-step="${escapeHtml(section.stepId)}">
      <header class="pm-review-section-head">
        <div>
          <h3>
            <span class="pm-section-rw">${escapeHtml(section.titleRw)}</span>
            <span class="pm-section-sep">/</span>
            <span class="pm-section-en">${escapeHtml(section.titleEn)}</span>
          </h3>
          <p>${section.complete ? "All required checks passed for this step." : "Some items need attention before publishing."}</p>
        </div>
        <div class="pm-review-section-actions">
          <span class="pm-review-field__status ${section.complete ? "is-complete" : "is-missing"}">${section.complete ? "Ready" : "Requires Attention"}</span>
          <button type="button" class="pm-btn pm-btn-ghost pm-btn-sm" data-step-nav="${escapeHtml(section.stepId)}">Edit Step</button>
        </div>
      </header>
      ${stepErrors}
      <div class="pm-review-field-grid">${fieldRows || `<p class="pm-review-empty">No scalar fields detected for this step.</p>`}</div>
      ${section.stepId === "media" ? `<div class="pm-review-media-grid">${mainImageHtml}${galleryHtml}</div>` : ""}
      ${section.stepId === "inventory" ? colorVariantHtml : ""}
    </article>
  `;
}

export function renderDynamicReviewStep(draft, options = {}, helpers = {}) {
  const mergedOptions = {
    ...options,
    mainImageUrl: helpers.mainImageUrl || draft?.media?.mainImage || ""
  };
  const report = buildReviewReport(draft, mergedOptions);
  const {
    escapeHtml,
    formatReviewCurrency,
    renderAdminStorefrontPreview,
    computePricingSummary,
    mainImageUrl = "",
    galleryItems = []
  } = helpers;

  const info = draft?.info || {};
  const description = draft?.description || {};
  const pricing = draft?.pricing || {};
  const currency = pricing.currency || "RWF";
  const pricingSummary = computePricingSummary ? computePricingSummary(pricing) : { selling: payloadPrice(pricing), current: payloadPrice(pricing) };
  const previewName = info.shortName || info.name || "Product Name";
  const previewDesc = description.shortDescription || report.autoSeo.metaDescription || description.longDescription || "";
  const productUrl = `https://byosemarket.com/product/${report.payload.slug || slugify(info.name)}`;
  const displayPrice = pricingSummary.current || report.payload.price;

  const issueCards = report.issues.map((issue) => `
    <article class="pm-review-issue">
      <div>
        <strong>${escapeHtml(issue.stepLabel)}</strong>
        <p>${escapeHtml(issue.message)}</p>
      </div>
      <button type="button" class="pm-btn pm-btn-ghost pm-btn-sm" data-step-nav="${escapeHtml(issue.stepId)}">Fix in Step</button>
    </article>
  `).join("");

  const sectionBlocks = report.sections.map((section) => renderSectionBlock(section, escapeHtml)).join("");

  const storefrontPreview = renderAdminStorefrontPreview
    ? renderAdminStorefrontPreview(pricingSummary, currency, previewName)
    : "";

  return {
    html: `
      <div class="pm-step-panel pm-step-panel--review">
        <header class="pm-step-header">
          <h2><span class="pm-section-rw">Gusuzuma no Kubika</span> <span class="pm-section-sep">/</span> <span class="pm-section-en">Review & Save</span></h2>
          <p>Dynamic summary of every field entered across Steps 1–6, with live validation before publishing.</p>
        </header>

        <section class="pm-review-dashboard">
          <article class="pm-review-health card">
            <div class="pm-review-health-head">
              <div>
                <h3>Product Verification Engine</h3>
                <p>Automatically scans all previous steps and flags missing or invalid data.</p>
              </div>
              <strong class="pm-review-completion">${report.stats.percent}% Complete</strong>
            </div>
            <div class="pm-review-stats-grid">
              <div><span>Tracked Fields</span><strong>${report.stats.totalFields}</strong></div>
              <div><span>Complete</span><strong>${report.stats.completeFields}</strong></div>
              <div><span>Missing</span><strong>${report.stats.missingFields}</strong></div>
              <div><span>Issues</span><strong>${report.stats.issueCount}</strong></div>
            </div>
            ${report.canPublish
              ? `<div class="pm-review-ready-banner">✓ Final verification passed. Product is ready to publish.</div>`
              : `<div class="pm-review-block-banner">Publishing is blocked until all verification issues are resolved.</div>`}
          </article>
        </section>

        ${report.issues.length ? `
          <section class="pm-review-issues card">
            <header class="pm-review-section-head">
              <h3>Requires Attention Before Publishing</h3>
            </header>
            <div class="pm-review-issue-list">${issueCards}</div>
          </section>
        ` : ""}

        <div class="pm-review-sections">${sectionBlocks}</div>

        <section class="pm-review-live-preview card">
          <header class="pm-review-section-head">
            <h3><span class="pm-section-rw">Reba Product Live</span><span class="pm-section-sep">/</span><span class="pm-section-en">Live Storefront Preview</span></h3>
            <p>Preview built from the exact draft data entered in previous steps.</p>
          </header>
          <div class="pm-live-preview-grid">
            <article class="pm-live-preview-card">
              <span class="pm-live-preview-label">Homepage / Shop Card</span>
              ${storefrontPreview || (mainImageUrl ? `<img src="${escapeHtml(mainImageUrl)}" alt="" loading="lazy" />` : `<div class="pm-live-preview-empty">No image</div>`)}
            </article>
            <article class="pm-live-preview-card pm-live-preview-card--pdp">
              <span class="pm-live-preview-label">Product Details</span>
              ${mainImageUrl ? `<img src="${escapeHtml(mainImageUrl)}" alt="" loading="lazy" />` : `<div class="pm-live-preview-empty">No image</div>`}
              <strong>${escapeHtml(info.name || previewName)}</strong>
              <p>${escapeHtml(previewDesc || "Short description preview")}</p>
              <small>${escapeHtml(formatReviewCurrency ? formatReviewCurrency(displayPrice, currency) : displayPrice)}</small>
            </article>
            <article class="pm-live-preview-card pm-live-preview-card--search">
              <span class="pm-live-preview-label">Search Result</span>
              <div class="pm-seo-preview pm-seo-preview--google pm-review-google-preview">
                <div class="pm-seo-preview-title">${escapeHtml(report.payload.metaTitle || info.name || "Product Title")}</div>
                <div class="pm-seo-preview-url">${escapeHtml(productUrl)}</div>
                <div class="pm-seo-preview-desc">${escapeHtml(report.payload.metaDescription || previewDesc || "Search description preview.")}</div>
              </div>
            </article>
            <article class="pm-live-preview-card pm-live-preview-card--inventory">
              <span class="pm-live-preview-label">Variant Modal</span>
              <p>${escapeHtml(draft?.inventory?.variantsEnabled ? "Color + size selection enabled with live stock." : "Simple product without color variants.")}</p>
              <small>${escapeHtml(`Total stock: ${report.payload.stock || 0}`)}</small>
            </article>
          </div>
          <p class="pm-review-media-counts">Main Image: ${mainImageUrl ? 1 : 0} · Gallery Images: ${galleryItems.length} · Color Variants: ${Array.isArray(draft?.inventory?.colorVariants) ? draft.inventory.colorVariants.length : 0}</p>
        </section>

        <div class="pm-lightbox is-hidden" data-review-lightbox aria-hidden="true">
          <button type="button" class="pm-lightbox-close" data-close-lightbox aria-label="Close preview">&times;</button>
          <img src="" alt="Enlarged product image" data-lightbox-image />
        </div>
      </div>
    `,
    report
  };
}

function payloadPrice(pricing = {}) {
  return toNumber(pricing.sellingPrice, 0);
}

export function computeReviewHealth(draft, options = {}) {
  const report = buildReviewReport(draft, options);
  return {
    percent: report.stats.percent,
    checks: report.sections.map((section) => ({
      ok: section.complete,
      label: `${section.titleEn} / ${section.titleRw}`,
      stepId: section.stepId
    })),
    warnings: report.issues.map((issue) => issue.message),
    canPublish: report.canPublish,
    report
  };
}
