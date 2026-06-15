import { formatCurrency } from "../components/ui.js";
import { createProductAndSync, deleteProductAndSync, getProducts, updateProductAndSync } from "../services/admin-data.service.js";
import { uploadWithRetry, uploadProductGallery, PRODUCTS_BUCKET } from "../../../services/uploadService.js";

const FALLBACK_IMAGE = "../img/logo.png";
const DRAFT_STORAGE_KEY = "byose-admin-product-draft-v2";
const PROGRESS_STORAGE_KEY = "byose-admin-product-progress-v2";
const LOW_STOCK_THRESHOLD = 5;
const WORKFLOW_RESET_DELAY_MS = 900;
const PRODUCT_SAVE_TIMEOUT_MS = 120000;
const CATEGORY_OPTIONS = ["fashion", "electronics", "shoes", "bags", "watches", "phones"];
const VISIBILITY_OPTIONS = [
  {
    value: "home",
    label: "Home",
    description: "Show only in homepage merchandising sections."
  },
  {
    value: "shop",
    label: "Shop",
    description: "Render only in the shop storefront catalog."
  },
  {
    value: "all",
    label: "All",
    description: "Publish to both homepage and shop surfaces."
  }
];
const POSITION_OPTIONS = [
  {
    value: "top",
    label: "Top",
    description: "Prioritize this product above the rest."
  },
  {
    value: "middle",
    label: "Middle",
    description: "Place this product between top and lower items."
  },
  {
    value: "bottom",
    label: "Bottom",
    description: "Keep this product lower in the storefront stack."
  }
];

function normalizeAssetUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  if (/^(?:https?:|data:|blob:)/i.test(text)) {
    return text;
  }

  if (text.startsWith("/uploads/")) {
    return text;
  }

  if (text.startsWith("uploads/")) {
    return `/${text.replace(/^\/+/, "")}`;
  }

  if (text.startsWith("/") || text.startsWith("../") || text.startsWith("./")) {
    return text;
  }

  return `/uploads/${text.replace(/^\/+/, "")}`;
}

function normalizeStoragePath(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  if (text.startsWith("/uploads/")) {
    return text.replace(/^\/uploads\//, "");
  }

  if (text.startsWith("uploads/")) {
    return text.replace(/^uploads\//, "");
  }

  return text;
}

function normalizeGalleryDraft(galleryValues, storageValues = []) {
  const urls = Array.isArray(galleryValues)
    ? galleryValues.map((entry) => normalizeAssetUrl(entry)).filter(Boolean)
    : [];
  const storage = Array.isArray(storageValues)
    ? storageValues.map((entry) => normalizeStoragePath(entry))
    : [];
  const seen = new Set();
  const normalizedUrls = [];
  const normalizedStorage = [];

    urls.forEach((url, index) => {
    if (!url || url.startsWith("data:")) {
      return;
    }

    if (seen.has(url)) {
      return;
    }

    seen.add(url);

    normalizedUrls.push(url);
    normalizedStorage.push(storage[index] || normalizeStoragePath(url));
  });

  return {
    urls: normalizedUrls,
    storage: normalizedStorage
  };
}

function getCurrentGalleryEntries() {
  const urls = Array.isArray(productDraft?.details?.gallery) ? productDraft.details.gallery : [];
  const storage = Array.isArray(productDraft?.details?.galleryStoragePaths) ? productDraft.details.galleryStoragePaths : [];
  return urls.map((url, index) => ({
    url,
    storagePath: storage[index] || ""
  }));
}

function setGalleryEntries(entries) {
  const normalized = normalizeGalleryDraft(
    entries.map((entry) => entry.url),
    entries.map((entry) => entry.storagePath)
  );
  productDraft.details.gallery = normalized.urls;
  productDraft.details.galleryStoragePaths = normalized.storage;
}

function appendGalleryUploadsToDraft(uploads = []) {
  const entries = getCurrentGalleryEntries();
  uploads.forEach((upload) => {
    const url = normalizeAssetUrl(upload?.publicUrl || upload?.url || upload?.path || "");
    if (!url) {
      return;
    }

    entries.push({
      url,
      storagePath: normalizeStoragePath(upload?.storagePath || upload?.path || url)
    });
  });
  setGalleryEntries(entries);
}

function removeGalleryEntryAt(index) {
  const entries = getCurrentGalleryEntries();
  if (index < 0 || index >= entries.length) {
    return;
  }
  entries.splice(index, 1);
  setGalleryEntries(entries);
}

function deriveCleanupCandidates(...values) {
  const seen = new Set();
  return values
    .flat()
    .map((entry) => normalizeAssetUrl(entry))
    .filter((entry) => {
      if (!entry || seen.has(entry)) {
        return false;
      }
      seen.add(entry);
      return true;
    });
}


let latestProducts = [];

let latestProductsError = "";
let productDraft = readDraft();
let page1SaveInFlight = false;
let workflowFeedback = {
  tone: "neutral",
  message: "Create the product foundation, then continue to Product Details to finish the ecommerce listing."
};
let saveSuccessState = null;

function createTimeoutError(label, timeoutMs) {
  const error = new Error(`${label} timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
  error.code = "OPERATION_TIMEOUT";
  return error;
}

async function withTimeout(label, promise, timeoutMs) {
  let timerId = null;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timerId = window.setTimeout(() => reject(createTimeoutError(label, timeoutMs)), timeoutMs);
      })
    ]);
  } finally {
    if (timerId) {
      window.clearTimeout(timerId);
    }
  }
}

function readJsonStorage(key) {
  try {
    const rawValue = window.sessionStorage.getItem(key) || window.localStorage.getItem(key);
    return rawValue ? JSON.parse(rawValue) : null;
  } catch (_error) {
    return null;
  }
}

function writeJsonStorage(key, value) {
  const serialized = JSON.stringify(value);
  try {
    window.sessionStorage.setItem(key, serialized);
  } catch (_error) {
    // Ignore storage errors.
  }
  try {
    window.localStorage.setItem(key, serialized);
  } catch (_error) {
    // Ignore storage errors.
  }
}

function clearJsonStorage(key) {
  try {
    window.sessionStorage.removeItem(key);
  } catch (_error) {
    // Ignore storage errors.
  }
  try {
    window.localStorage.removeItem(key);
  } catch (_error) {
    // Ignore storage errors.
  }
}

function getProductType(category) {
  const normalized = String(category || "").toLowerCase();
  if (normalized === "shoes") {
    return "shoes";
  }
  if (["phones", "electronics", "watches"].includes(normalized)) {
    return "electronics";
  }
  return "fashion";
}

function getAdaptiveSizeOptions(category) {
  const productType = getProductType(category);
  if (productType === "shoes") {
    return ["38", "39", "40", "41", "42", "43", "44", "45"];
  }
  if (productType === "fashion") {
    return ["XS", "S", "M", "L", "XL", "XXL"];
  }
  return [];
}

function getAdaptiveSpecTemplate(category) {
  const productType = getProductType(category);
  if (productType === "shoes") {
    return [
      { label: "Upper Material", value: "" },
      { label: "Sole", value: "" },
      { label: "Closure", value: "" }
    ];
  }
  if (productType === "electronics") {
    return [
      { label: "Model", value: "" },
      { label: "Storage", value: "" },
      { label: "Battery", value: "" }
    ];
  }
  return [
    { label: "Material", value: "" },
    { label: "Fit", value: "" },
    { label: "Care", value: "" }
  ];
}

function inferColorHex(colorName) {
  const normalized = String(colorName || "").trim().toLowerCase();
  const lookup = {
    black: "#111111",
    white: "#f5f5f5",
    red: "#d92d20",
    blue: "#1d4ed8",
    green: "#15803d",
    yellow: "#eab308",
    pink: "#ec4899",
    purple: "#7c3aed",
    brown: "#7c4a21",
    beige: "#d6c3a5",
    grey: "#6b7280",
    gray: "#6b7280",
    silver: "#c0c0c0",
    gold: "#d4a017"
  };
  return lookup[normalized] || "#111111";
}

function createDefaultDraft() {
  return {
    productId: "",
    page1: {
      image: "",
      imageStoragePath: "",
      productName: "",
      currentPrice: "",
      oldPrice: "",
      stock: "0",
      category: "fashion",
      visibility: "all",
      positioning: "middle"
    },
    details: {
      description: "",
      gallery: [],
      galleryStoragePaths: [],
      colors: [],
      selectedSizes: [],
      specRows: getAdaptiveSpecTemplate("fashion"),
      extraInfo: {
        warranty: "",
        delivery: "",
        material: "",
        usage: "",
        extraSpecifications: ""
      }
    }
  };
}


function sanitizeDraft(input) {
  const defaults = createDefaultDraft();
  const draft = input && typeof input === "object" ? input : {};
  const page1 = draft.page1 && typeof draft.page1 === "object" ? draft.page1 : {};
  const details = draft.details && typeof draft.details === "object" ? draft.details : {};
  const extraInfo = details.extraInfo && typeof details.extraInfo === "object" ? details.extraInfo : {};
  const category = CATEGORY_OPTIONS.includes(String(page1.category || "").toLowerCase())
    ? String(page1.category).toLowerCase()
    : defaults.page1.category;
  const visibility = ["home", "shop", "all"].includes(String(page1.visibility || "").toLowerCase())
    ? String(page1.visibility).toLowerCase()
    : defaults.page1.visibility;
  const positioning = ["top", "middle", "bottom"].includes(String(page1.positioning || "").toLowerCase())
    ? String(page1.positioning).toLowerCase()
    : defaults.page1.positioning;
  const sizeOptions = getAdaptiveSizeOptions(category);
  const specRows = Array.isArray(details.specRows) && details.specRows.length
    ? details.specRows.map((entry) => ({
        label: String(entry?.label || ""),
        value: String(entry?.value || "")
      }))
    : getAdaptiveSpecTemplate(category);
  const normalizedHeroImage = normalizeAssetUrl(page1.image || "");
  const normalizedHeroStoragePath = normalizeStoragePath(page1.imageStoragePath || page1.imageStorage || normalizedHeroImage);
  const galleryNormalization = normalizeGalleryDraft(details.gallery, details.galleryStoragePaths);

  const colors = Array.isArray(details.colors)
    ? details.colors
        .map((entry) => ({
          name: String(entry?.name || "").trim(),
          hex: String(entry?.hex || inferColorHex(entry?.name)).trim() || inferColorHex(entry?.name)
        }))
        .filter((entry) => entry.name)
    : [];

  const selectedSizes = Array.isArray(details.selectedSizes)
    ? details.selectedSizes
        .map((entry) => String(entry || ""))
        .filter((entry, index, array) => entry && (!sizeOptions.length || sizeOptions.includes(entry)) && array.indexOf(entry) === index)
    : [];

  return {
    productId: String(draft.productId || ""),
    page1: {
      image: normalizedHeroImage,
      imageStoragePath: normalizedHeroStoragePath,
      productName: String(page1.productName || ""),
      currentPrice: String(page1.currentPrice || ""),
      oldPrice: String(page1.oldPrice || ""),
      stock: String(Math.max(0, Math.floor(toNumber(page1.stock)))) || "0",
      category,
      visibility,
      positioning
    },
    details: {
      description: String(details.description || ""),
      gallery: galleryNormalization.urls,
      galleryStoragePaths: galleryNormalization.storage,
      colors,
      selectedSizes,
      specRows,
      extraInfo: {
        warranty: String(extraInfo.warranty || ""),
        delivery: String(extraInfo.delivery || ""),
        material: String(extraInfo.material || ""),
        usage: String(extraInfo.usage || ""),
        extraSpecifications: String(extraInfo.extraSpecifications || "")
      }
    }
  };
}


function readDraft() {
  return sanitizeDraft(readJsonStorage(DRAFT_STORAGE_KEY));
}

function writeDraft(draft) {
  writeJsonStorage(DRAFT_STORAGE_KEY, sanitizeDraft(draft));
}

function writeProgress(progress) {
  writeJsonStorage(PROGRESS_STORAGE_KEY, progress || {});
}

function clearProgress() {
  clearJsonStorage(PROGRESS_STORAGE_KEY);
}

function buildPage1Payload(draft) {
  const safeDraft = sanitizeDraft(draft);
  const price = Number(safeDraft.page1.currentPrice) || 0;
  const oldPrice = Number(safeDraft.page1.oldPrice) || 0;
  const stock = Math.max(0, Math.floor(toNumber(safeDraft.page1.stock)));
    const inventoryStatus = getStockPresentation(stock).status;
  const positioning = safeDraft.page1.positioning;
  const heroPublicUrl = normalizeAssetUrl(safeDraft.page1.image || "");
  const heroStoragePath = normalizeStoragePath(
    safeDraft.page1.imageStoragePath || safeDraft.page1.imageStorage || heroPublicUrl
  );
  const heroReference = heroPublicUrl || heroStoragePath;

  return {
    name: safeDraft.page1.productName.trim(),
    title: safeDraft.page1.productName.trim(),
    price,
    oldPrice: oldPrice > price ? oldPrice : 0,
    stock,
    availableStock: stock,
    availability: inventoryStatus,
    inventory: {
      available: stock,
      totalAvailable: stock,
      status: inventoryStatus,
      lowStockThreshold: LOW_STOCK_THRESHOLD
    },
    category: safeDraft.page1.category,
    visibility: safeDraft.page1.visibility === "all" ? "both" : safeDraft.page1.visibility,
    priority: positioning === "top" ? 1 : 0,
    orderIndex: positioning === "top" ? 300 : positioning === "bottom" ? 100 : 200,
    mainImage: heroReference || undefined,
    image: heroReference || undefined,
    mainImageStoragePath: heroStoragePath || undefined,
    imageStoragePath: heroStoragePath || undefined,
    status: "active"
  };
}


function buildLongDescription(description, extraInfo) {
  const paragraphs = String(description || "")
    .split(/\n{2,}/)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

  const supplemental = [
    extraInfo?.material ? `Material: ${String(extraInfo.material).trim()}` : "",
    extraInfo?.usage ? `Usage: ${String(extraInfo.usage).trim()}` : "",
    extraInfo?.extraSpecifications ? String(extraInfo.extraSpecifications).trim() : ""
  ].filter(Boolean);

  const merged = [...paragraphs, ...supplemental];
  return merged.length ? merged : ["Product details will appear here after the admin adds the detailed description."];
}

function buildHighlights(extraInfo, activeSpecs) {
  const highlights = [
    extraInfo?.material ? `Material: ${String(extraInfo.material).trim()}` : "",
    extraInfo?.usage ? `Usage: ${String(extraInfo.usage).trim()}` : "",
    ...activeSpecs.slice(0, 2).map((entry) => `${String(entry.label || "").trim()}: ${String(entry.value || "").trim()}`)
  ].filter(Boolean);

  return highlights.slice(0, 4);
}

function buildTrust(extraInfo) {
  const trust = [
    extraInfo?.delivery ? `Delivery: ${String(extraInfo.delivery).trim()}` : "",
    extraInfo?.warranty ? `Warranty: ${String(extraInfo.warranty).trim()}` : ""
  ].filter(Boolean);

  return trust;
}

function buildAttributesFromDraft(draft) {
  const safeDraft = sanitizeDraft(draft);
  const stock = Math.max(0, Math.floor(toNumber(safeDraft.page1.stock)));
  const attributes = [];

  if (safeDraft.details.colors.length) {
    attributes.push({
      name: "Color",
      key: "color",
      axis: "color",
      type: "color",
      required: true,
      options: safeDraft.details.colors.map((color, index) => ({
        label: color.name,
        value: color.name,
        stock,
        image: index === 0 ? safeDraft.page1.image || safeDraft.details.gallery[0] || "" : "",
        swatch: color.hex,
        availability: stock > 0 ? "available" : "out_of_stock",
        isDefault: index === 0,
        priceDelta: 0
      }))
    });
  }

  if (safeDraft.details.selectedSizes.length) {
    attributes.push({
      name: "Size",
      key: "size",
      axis: "size",
      type: "size",
      required: true,
      options: safeDraft.details.selectedSizes.map((size, index) => ({
        label: size,
        value: size,
        stock,
        availability: stock > 0 ? "available" : "out_of_stock",
        isDefault: index === 0,
        priceDelta: 0
      }))
    });
  }

  return attributes;
}

function normalizeSpecRows(value, category = productDraft.page1.category) {
  if (!Array.isArray(value) || !value.length) {
    return getAdaptiveSpecTemplate(category);
  }

  return value
    .map((entry) => {
      if (Array.isArray(entry) && entry.length >= 2) {
        return {
          label: String(entry[0] || ""),
          value: String(entry[1] || "")
        };
      }

      if (entry && typeof entry === "object") {
        return {
          label: String(entry.label || entry.name || ""),
          value: String(entry.value || "")
        };
      }

      return null;
    })
    .filter(Boolean);
}

function extractDraftColors(product) {
  const attributes = Array.isArray(product?.attributes) ? product.attributes : [];
  const colorAttribute = attributes.find((attribute) => {
    const key = String(attribute?.key || attribute?.name || attribute?.axis || "").toLowerCase();
    const type = String(attribute?.type || attribute?.axis || "").toLowerCase();
    return key === "color" || type === "color";
  });

  if (!colorAttribute || !Array.isArray(colorAttribute.options)) {
    return [];
  }

  return colorAttribute.options
    .map((option) => ({
      name: String(option?.label || option?.value || "").trim(),
      hex: String(option?.swatch || option?.hex || inferColorHex(option?.label || option?.value)).trim() || inferColorHex(option?.label || option?.value)
    }))
    .filter((entry) => entry.name);
}

function extractDraftSizes(product) {
  const attributes = Array.isArray(product?.attributes) ? product.attributes : [];
  const sizeAttribute = attributes.find((attribute) => {
    const key = String(attribute?.key || attribute?.name || attribute?.axis || "").toLowerCase();
    const type = String(attribute?.type || attribute?.axis || "").toLowerCase();
    return key === "size" || type === "size";
  });

  if (!sizeAttribute || !Array.isArray(sizeAttribute.options)) {
    return [];
  }

  return sizeAttribute.options
    .map((option) => String(option?.value || option?.label || "").trim())
    .filter(Boolean);
}

function normalizePriorityCode(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.floor(value);
    return normalized === 2 ? 2 : normalized === 1 ? 1 : 0;
  }

  const normalizedText = String(value || "").trim().toLowerCase();
  if (!normalizedText || normalizedText === "normal") {
    return 0;
  }

  if (normalizedText === "top") {
    return 1;
  }

  if (normalizedText === "featured") {
    return 2;
  }

  const parsed = Number(normalizedText);
  if (Number.isFinite(parsed)) {
    const normalized = Math.floor(parsed);
    return normalized === 2 ? 2 : normalized === 1 ? 1 : 0;
  }

  return 0;
}

function getPositioningValue(product) {
  if (normalizePriorityCode(product?.priority) >= 1) {
    return "top";
  }

  const orderIndex = toNumber(product?.orderIndex);
  if (orderIndex > 0 && orderIndex <= 100) {
    return "bottom";
  }

  return "middle";
}

function hydrateDraftFromProduct(product) {
  if (!product || typeof product !== "object") {
    return productDraft;
  }

    const currentDraft = sanitizeDraft(productDraft);
  const activeSpecs = normalizeSpecRows(product.specs, product.category || currentDraft.page1.category);
  const heroImage = normalizeAssetUrl(product.mainImage || product.image || currentDraft.page1.image || "");
  const heroStoragePath = normalizeStoragePath(product.mainImageStoragePath || product.imageStoragePath || heroImage);
  const rawGallery = Array.isArray(product.gallery) ? product.gallery : [];
  const rawGalleryStorage = Array.isArray(product.galleryStoragePaths) ? product.galleryStoragePaths : [];
  const filteredGalleryEntries = rawGallery
    .map((image, index) => ({
      url: normalizeAssetUrl(image),
      storagePath: normalizeStoragePath(rawGalleryStorage[index] || image)
    }))
    .filter((entry) => entry.url && entry.url !== heroImage);
  const galleryNormalization = normalizeGalleryDraft(
    filteredGalleryEntries.map((entry) => entry.url),
    filteredGalleryEntries.map((entry) => entry.storagePath)
  );

  return sanitizeDraft({

    ...currentDraft,
    productId: String(product.id || product.catalogId || currentDraft.productId || ""),
        page1: {
      ...currentDraft.page1,
      image: heroImage,
      imageStoragePath: heroStoragePath,
      productName: String(product.name || product.title || currentDraft.page1.productName || ""),
      currentPrice: String(toNumber(product.price || currentDraft.page1.currentPrice)),
      oldPrice: String(toNumber(product.oldPrice || currentDraft.page1.oldPrice)),
      stock: String(Math.max(0, Math.floor(toNumber(product.stock ?? currentDraft.page1.stock)))),
      category: String(product.category || currentDraft.page1.category || "fashion").toLowerCase(),
      visibility: String(product.visibility || currentDraft.page1.visibility || "all").toLowerCase() === "both"
        ? "all"
        : String(product.visibility || currentDraft.page1.visibility || "all").toLowerCase(),
      positioning: getPositioningValue(product)
    },
    details: {
      ...currentDraft.details,
      description: String(product.description || product.shortDescription || currentDraft.details.description || ""),
      gallery: galleryNormalization.urls,
      galleryStoragePaths: galleryNormalization.storage,

      colors: extractDraftColors(product),
      selectedSizes: extractDraftSizes(product),
      specRows: activeSpecs,
      extraInfo: {
        ...currentDraft.details.extraInfo,
        ...(product.extraInfo && typeof product.extraInfo === "object" ? product.extraInfo : {})
      }
    }
  });
}

function buildDetailsPayload(draft) {
  const safeDraft = sanitizeDraft(draft);
  const page1Payload = buildPage1Payload(safeDraft);
  const activeSpecs = safeDraft.details.specRows.filter((entry) => String(entry.label || "").trim() && String(entry.value || "").trim());
    const attributes = buildAttributesFromDraft(safeDraft);
  const longDescription = buildLongDescription(safeDraft.details.description, safeDraft.details.extraInfo);
  const highlights = buildHighlights(safeDraft.details.extraInfo, activeSpecs);
  const trust = buildTrust(safeDraft.details.extraInfo);
  const galleryReferences = safeDraft.details.gallery.map((url, index) => {
    const publicUrl = normalizeAssetUrl(url);
    const storageRef = normalizeStoragePath(safeDraft.details.galleryStoragePaths?.[index] || publicUrl);
    return publicUrl || storageRef;
  }).filter(Boolean);
  const galleryStoragePaths = safeDraft.details.gallery.map((url, index) => {
    return normalizeStoragePath(safeDraft.details.galleryStoragePaths?.[index] || normalizeAssetUrl(url));
  }).filter(Boolean);

  return {
    ...page1Payload,
    description: safeDraft.details.description.trim(),
    shortDescription: safeDraft.details.description.trim(),
    longDescription,
    gallery: galleryReferences,
    galleryStoragePaths,
    highlights,
    trust,
    specs: activeSpecs,

    attributes,
    variants: {
      enabled: attributes.length > 0,
      optionMode: attributes.length > 0 ? "structured" : "simple",
      imagePerColor: attributes.some((attribute) => String(attribute.type || "").toLowerCase() === "color"),
      pricingPerVariant: false,
      inventoryReady: true,
      skuPerVariant: false,
      groups: attributes.reduce((result, attribute) => {
        const key = String(attribute.key || attribute.name || "option").toLowerCase();
        result[key] = {
          enabled: true,
          label: attribute.name,
          type: attribute.type,
          required: attribute.required !== false,
          optionTokens: Array.isArray(attribute.options)
            ? attribute.options.map((option) => [option.label || option.value, option.value, option.swatch, option.image].filter(Boolean).join("|"))
            : []
        };
        return result;
      }, {})
    },
    extraInfo: {
      ...safeDraft.details.extraInfo
    },
    status: "active"
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toLabel(value, fallback = "General") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return fallback;
  }

  return normalized
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

function getCreateStep() {
  return parseHashParams().get("step") === "details" ? "details" : "basics";
}

function getRouteProductId() {
  return String(parseHashParams().get("productId") || productDraft.productId || "").trim();
}

function getProductIdentity(product) {
  return String(product?.id || product?.catalogId || "").trim();
}

function setWorkflowFeedback(tone, message) {
  workflowFeedback = { tone, message };
}

function persistDraft() {
  writeDraft(productDraft);
}

function clearPersistedDraft() {
  clearJsonStorage(DRAFT_STORAGE_KEY);
}

function resetProductCreationState(successMessage) {
  productDraft = createDefaultDraft();
  clearPersistedDraft();
  clearProgress();
  setWorkflowFeedback(
    "success",
    successMessage || "Product saved successfully. The workflow has been reset and Page 1 is ready for a new product."
  );
}

function transitionToFreshProductWorkflow(container, successMessage) {
  clearSaveSuccessState(container);

  if (container) {
    container.classList.add("products-workflow-resetting");
  }

  window.setTimeout(() => {
    resetProductCreationState(successMessage);
    window.location.hash = getCreateBasicsHash();

    if (container && container.isConnected) {
      container.classList.remove("products-workflow-resetting");
      rerenderCreateWorkspace(container);
    }

    if (typeof window.scrollTo === "function") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, WORKFLOW_RESET_DELAY_MS);
}

function syncAdaptiveDetails(previousCategory, nextCategory) {
  if (previousCategory === nextCategory) {
    return;
  }

  const previousType = getProductType(previousCategory);
  const nextType = getProductType(nextCategory);
  const sizeOptions = getAdaptiveSizeOptions(nextCategory);

  productDraft.details.selectedSizes = productDraft.details.selectedSizes.filter((size) => !sizeOptions.length || sizeOptions.includes(size));

  if (previousType !== nextType) {
    productDraft.details.specRows = getAdaptiveSpecTemplate(nextCategory);
    if (!sizeOptions.length) {
      productDraft.details.selectedSizes = [];
    }
  }
}

function resolveProductImage(source) {
  const value = String(source || "").trim();
  if (!value) {
    return FALLBACK_IMAGE;
  }

  if (/^(?:https?:|data:|blob:|\/)/i.test(value)) {
    return value;
  }

  if (value.startsWith("../") || value.startsWith("./")) {
    return value;
  }

  return `../${value.replace(/^\.\//, "")}`;
}

function getCurrentPrice() {
  return toNumber(productDraft.page1.currentPrice);
}

function getOldPrice() {
  return toNumber(productDraft.page1.oldPrice);
}

function getDiscountPercentage() {
  const currentPrice = getCurrentPrice();
  const oldPrice = getOldPrice();
  if (currentPrice <= 0 || oldPrice <= currentPrice) {
    return 0;
  }

  return Math.round(((oldPrice - currentPrice) / oldPrice) * 100);
}

function getStockQuantity(value = productDraft.page1.stock) {
  return Math.max(0, Math.floor(toNumber(value)));
}

function getStockPresentation(quantity = getStockQuantity()) {
  const available = Math.max(0, Math.floor(toNumber(quantity)));

  if (available <= 0) {
    return {
      available,
      status: "out_of_stock",
      tone: "empty",
      label: "Out of Stock",
      detail: "No units available. Storefront cards will disable quick add automatically."
    };
  }

  if (available <= LOW_STOCK_THRESHOLD) {
    return {
      available,
      status: "low_stock",
      tone: "low",
      label: "Low Stock",
      detail: `${available} unit${available === 1 ? "" : "s"} remaining. Storefront cards will surface a low stock warning.`
    };
  }

  return {
    available,
    status: "in_stock",
    tone: "healthy",
    label: "In Stock",
    detail: `${available} units available. Storefront cards will render a healthy inventory state.`
  };
}

function getVisibilityLabel(value = productDraft.page1.visibility) {
  if (value === "home") {
    return "Home";
  }
  if (value === "shop") {
    return "Shop";
  }
  return "All";
}

function getPositioningLabel(value = productDraft.page1.positioning) {
  if (value === "top") {
    return "Top priority";
  }
  if (value === "bottom") {
    return "Bottom priority";
  }
  return "Middle priority";
}

function getDetailsHash(productId) {
  return `#/products?view=create&step=details&productId=${encodeURIComponent(String(productId || ""))}`;
}

function getCreateBasicsHash() {
  return "#/products?view=create";
}

function getStorefrontProductUrl(productId) {
  const catalogId = String(productId || "").trim();
  if (!catalogId) {
    return "";
  }

  const origin = String(window.location?.origin || "").trim();
  const path = `../../details/product-details1.html?id=${encodeURIComponent(catalogId)}`;
  if (!origin || origin === "null") {
    return path;
  }

  return new URL(path, `${origin}/admin/dashboard.html`).toString();
}

function renderSaveSuccessPanel(container) {
  const panel = container?.querySelector("[data-product-save-success]");
  if (!panel) {
    return;
  }

  if (!saveSuccessState?.productId) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }

  const productName = escapeHtml(saveSuccessState.productName || "Product");
  const productId = escapeHtml(saveSuccessState.productId);
  panel.hidden = false;
  panel.innerHTML = `
    <div class="products-save-success__content">
      <div class="products-save-success__icon" aria-hidden="true">✓</div>
      <div>
        <strong>Product saved successfully.</strong>
        <p>${productName} is now stored in the database and synchronized to the storefront.</p>
      </div>
      <div class="products-save-success__actions">
        <button class="products-save-success__button products-save-success__button--primary" type="button" data-product-view-saved>View Product</button>
        <button class="products-save-success__button" type="button" data-product-add-another>Add Another Product</button>
      </div>
    </div>
    <input type="hidden" data-saved-product-id value="${productId}">
  `;
}

function showProductSaveSuccess(container, product) {
  const productId = getProductIdentity(product);
  saveSuccessState = {
    productId,
    productName: String(product?.name || product?.title || productDraft.page1.productName || "Product").trim()
  };
  setWorkflowFeedback("success", "Product saved successfully.");
  renderSaveSuccessPanel(container);
  updateDetailsPreview(container);
}

function clearSaveSuccessState(container) {
  saveSuccessState = null;
  renderSaveSuccessPanel(container);
}

function buildSelectionCards(name, options, currentValue) {
  return options.map((option) => `
    <label class="products-choice-card${option.value === currentValue ? " is-selected" : ""}">
      <input class="products-choice-card__input" type="radio" name="${escapeHtml(name)}" value="${escapeHtml(option.value)}" ${option.value === currentValue ? "checked" : ""}>
      <span class="products-choice-card__content">
        <strong>${escapeHtml(option.label)}</strong>
        <span>${escapeHtml(option.description)}</span>
      </span>
    </label>
  `).join("");
}

function buildGalleryCards() {
  if (!productDraft.details.gallery.length) {
    return `<div class="products-empty-card">Upload additional product images to build the gallery preview.</div>`;
  }

  return productDraft.details.gallery.map((image, index) => `
    <article class="products-gallery-card">
      <div class="products-gallery-card__media">
        <img src="${escapeHtml(resolveProductImage(image))}" alt="Gallery image ${index + 1}">
      </div>
      <div class="products-gallery-card__meta">
        <strong>Gallery image ${index + 1}</strong>
        <button class="products-remove-button products-remove-button--compact" type="button" data-gallery-remove-index="${index}">Remove</button>
      </div>
    </article>
  `).join("");
}

function buildColorChips() {
  if (!productDraft.details.colors.length) {
    return `<div class="products-empty-card">Add colors such as Black, White, Red, Blue, or Green to prepare color-based selling options.</div>`;
  }

  return productDraft.details.colors.map((color, index) => `
    <article class="products-color-chip">
      <span class="products-color-chip__swatch" style="background:${escapeHtml(color.hex)}"></span>
      <strong>${escapeHtml(color.name)}</strong>
      <button type="button" data-color-remove-index="${index}" aria-label="Remove ${escapeHtml(color.name)}">×</button>
    </article>
  `).join("");
}

function buildAdaptiveControls() {
  const sizeOptions = getAdaptiveSizeOptions(productDraft.page1.category);
  const productType = getProductType(productDraft.page1.category);

  return `
    ${sizeOptions.length ? `
      <div class="products-adaptive-block">
        <div class="products-section-head products-section-head--stacked">
          <div>
            <p class="dashboard-eyebrow">Adaptive Sizes</p>
            <h3>${escapeHtml(productType === "shoes" ? "Shoe sizes" : "Clothing sizes")}</h3>
            <p>Choose the available sizes for this product type.</p>
          </div>
        </div>
        <div class="products-toggle-grid">
          ${sizeOptions.map((size) => `
            <button class="products-toggle-chip${productDraft.details.selectedSizes.includes(size) ? " is-selected" : ""}" type="button" data-size-option="${escapeHtml(size)}">${escapeHtml(size)}</button>
          `).join("")}
        </div>
      </div>
    ` : `
      <div class="products-adaptive-note">
        <strong>Electronics attribute mode</strong>
        <span>For phones and electronics, use the specification rows below for RAM, storage, battery, capacity, and other technical details.</span>
      </div>
    `}

    <div class="products-adaptive-block">
      <div class="products-section-head products-section-head--stacked">
        <div>
          <p class="dashboard-eyebrow">Adaptive Specifications</p>
          <h3>Specifications &amp; Attributes</h3>
          <p>The specification table adapts to the selected product type so the storefront detail page stays consistent.</p>
        </div>
      </div>
      <div class="products-spec-list">
        ${productDraft.details.specRows.map((row, index) => `
          <div class="products-spec-row">
            <input class="products-input" type="text" value="${escapeHtml(row.label)}" placeholder="Label" data-spec-label-index="${index}">
            <input class="products-input" type="text" value="${escapeHtml(row.value)}" placeholder="Value" data-spec-value-index="${index}">
            <button class="products-remove-button products-remove-button--compact" type="button" data-spec-remove-index="${index}">Remove</button>
          </div>
        `).join("")}
      </div>
      <button class="products-secondary-link products-secondary-link--button" type="button" data-spec-add>Add Specification</button>
    </div>
  `;
}

function buildDetailsPreviewGallery() {
  const images = [productDraft.page1.image, ...productDraft.details.gallery].filter(Boolean).slice(0, 4);
  if (!images.length) {
    return `<div class="products-preview-gallery-empty">Gallery preview will appear here after uploads.</div>`;
  }

  return images.map((image, index) => `
    <div class="products-preview-thumb${index === 0 ? " is-active" : ""}">
      <img src="${escapeHtml(resolveProductImage(image))}" alt="Preview gallery ${index + 1}">
    </div>
  `).join("");
}

function buildDetailsPreviewColors() {
  if (!productDraft.details.colors.length) {
    return `<span class="products-preview-empty-pill">No colors added</span>`;
  }

  return productDraft.details.colors.map((color) => `
    <span class="products-preview-color-pill"><i style="background:${escapeHtml(color.hex)}"></i>${escapeHtml(color.name)}</span>
  `).join("");
}

function buildDetailsPreviewSpecs() {
  const rows = productDraft.details.specRows.filter((entry) => String(entry?.label || "").trim() || String(entry?.value || "").trim()).slice(0, 4);
  if (!rows.length) {
    return `<div class="products-preview-empty-pill">No specifications added</div>`;
  }

  return rows.map((row) => `
    <div class="products-preview-spec-row">
      <span>${escapeHtml(row.label || "Detail")}</span>
      <strong>${escapeHtml(row.value || "Pending")}</strong>
    </div>
  `).join("");
}

function buildPage1Markup() {
  const previewImage = resolveProductImage(productDraft.page1.image || FALLBACK_IMAGE);
  const productName = productDraft.page1.productName.trim() || "Homepage Feature Product";
  const currentPrice = getCurrentPrice();
  const oldPrice = getOldPrice();
  const discountPercentage = getDiscountPercentage();
  const stockPresentation = getStockPresentation();
  const visibilityLabel = getVisibilityLabel();
  const positionLabel = getPositioningLabel();
  const saveLabel = productDraft.productId ? "SAVE & NEXT" : "CREATE PRODUCT & NEXT";

  return `
    <div class="products-dashboard-grid products-create-grid">
      <section class="dashboard-panel products-create-header">
        <div>
          <p class="dashboard-eyebrow">Admin Product Workflow</p>
          <h2>ADD PRODUCTS</h2>
          <p>Page 1 creates the basic product record, storefront placement, homepage and shop visibility, and ordering priority before the Product Details workflow opens.</p>
        </div>
        <div class="products-create-header__meta">
          <span class="products-inline-pill">Page 1 of 2</span>
          <p>Premium merchandising workspace for the first save that prepares the product to render immediately across the website.</p>
        </div>
      </section>

      ${latestProductsError ? `<section class="dashboard-panel products-load-banner products-load-banner--warn">${escapeHtml(latestProductsError)}</section>` : ""}

      <div class="products-create-shell">
        <form class="products-create-form" data-products-page1-form>
          <section class="dashboard-panel products-create-section">
            <div class="products-section-head products-section-head--stacked">
              <div>
                <p class="dashboard-eyebrow">Section 1</p>
                <h3>Product Image Upload</h3>
                <p>Upload from phone, tablet, or computer. The image stays centered, responsive, and professionally fitted.</p>
              </div>
            </div>

            <div class="products-image-workspace">
              <div class="products-image-stage">
                <div class="products-image-stage__frame">
                  <img data-upload-preview-image src="${escapeHtml(previewImage)}" alt="Product preview image">
                  <div class="products-image-stage__empty${productDraft.page1.image ? " is-hidden" : ""}" data-upload-empty-state>
                    <strong>Ready for storefront preview</strong>
                    <span>Upload a hero product image for homepage cards and shop listings.</span>
                  </div>
                </div>
              </div>

              <div class="products-upload-panel">
                <input class="products-image-input" id="productsCreateImageInput" type="file" accept="image/*" data-products-image-input>
                <label class="products-upload-button" for="productsCreateImageInput">Click to Upload Image</label>
                <p class="products-upload-hint">Supports mobile camera uploads, tablet file picking, and desktop browser uploads.</p>
                <button class="products-remove-button${productDraft.page1.image ? "" : " is-hidden"}" type="button" data-products-remove-image>Remove Image</button>
              </div>
            </div>
          </section>

          <section class="dashboard-panel products-create-section">
            <div class="products-section-head products-section-head--stacked">
              <div>
                <p class="dashboard-eyebrow">Section 2</p>
                <h3>Product Name</h3>
                <p>This storefront-facing name will appear on the homepage, inside the shop, and across product cards.</p>
              </div>
            </div>

            <label class="products-field">
              <span>Product Name</span>
              <input class="products-input" type="text" name="productName" value="${escapeHtml(productDraft.page1.productName)}" placeholder="Enter a clean storefront-facing product name" autocomplete="off">
            </label>
          </section>

          <section class="dashboard-panel products-create-section">
            <div class="products-section-head products-section-head--stacked">
              <div>
                <p class="dashboard-eyebrow">Section 3</p>
                <h3>Product Pricing</h3>
                <p>Use Rwanda franc pricing with optional compare-at pricing to communicate discount value instantly.</p>
              </div>
            </div>

            <div class="products-fields-grid products-fields-grid--pricing">
              <label class="products-field">
                <span>Current Price</span>
                <div class="products-input-wrap">
                  <span class="products-input-prefix">RWF</span>
                  <input class="products-input" type="number" inputmode="numeric" min="0" step="100" name="currentPrice" value="${escapeHtml(productDraft.page1.currentPrice)}" placeholder="35000">
                </div>
              </label>
              <label class="products-field">
                <span>Old Price</span>
                <div class="products-input-wrap">
                  <span class="products-input-prefix">RWF</span>
                  <input class="products-input" type="number" inputmode="numeric" min="0" step="100" name="oldPrice" value="${escapeHtml(productDraft.page1.oldPrice)}" placeholder="50000">
                </div>
              </label>
            </div>

            <div class="products-pricing-note" data-pricing-note>
              ${discountPercentage > 0
                ? `<strong>${escapeHtml(String(discountPercentage))}% discount feel ready</strong><span>The storefront preview will show the current price beside a crossed-out old price.</span>`
                : `<strong>Discount support enabled</strong><span>Add an old price higher than the current price when you want the storefront to show a markdown.</span>`}
            </div>
          </section>

          <section class="dashboard-panel products-create-section">
            <div class="products-section-head products-section-head--stacked">
              <div>
                <p class="dashboard-eyebrow">Section 4</p>
                <h3>Product Stock Management</h3>
                <p>Set the available quantity once so the storefront can switch automatically between In Stock, Low Stock, and Out of Stock states.</p>
              </div>
            </div>

            <div class="products-fields-grid products-fields-grid--stock">
              <label class="products-field">
                <span>Stock Quantity</span>
                <div class="products-input-wrap products-input-wrap--stock">
                  <span class="products-input-prefix products-input-prefix--neutral">Units</span>
                  <input class="products-input" type="number" inputmode="numeric" min="0" step="1" name="stock" value="${escapeHtml(productDraft.page1.stock)}" placeholder="25">
                </div>
                <small class="products-field-hint">0 = Out of Stock, 1-5 = Low Stock, 6+ = In Stock.</small>
              </label>

              <div class="products-stock-note products-stock-note--${escapeHtml(stockPresentation.tone)}" data-stock-note>
                <strong>${escapeHtml(stockPresentation.label)}</strong>
                <span>${escapeHtml(stockPresentation.detail)}</span>
              </div>
            </div>
          </section>

          <section class="dashboard-panel products-create-section">
            <div class="products-section-head products-section-head--stacked">
              <div>
                <p class="dashboard-eyebrow">Section 5</p>
                <h3>Product Category</h3>
                <p>Select the storefront category now so the next details page can adapt intelligently for the product type.</p>
              </div>
            </div>

            <label class="products-field">
              <span>Category</span>
              <select class="products-input products-select" name="category">
                ${CATEGORY_OPTIONS.map((category) => `<option value="${escapeHtml(category)}" ${category === productDraft.page1.category ? "selected" : ""}>${escapeHtml(toLabel(category))}</option>`).join("")}
              </select>
            </label>
          </section>

          <section class="dashboard-panel products-create-section">
            <div class="products-section-head products-section-head--stacked">
              <div>
                <p class="dashboard-eyebrow">Section 6</p>
                <h3>Product Visibility</h3>
                <p>Choose whether the product appears on the homepage, in the shop, or everywhere.</p>
              </div>
            </div>

            <div class="products-choice-grid">
              ${buildSelectionCards("visibility", VISIBILITY_OPTIONS, productDraft.page1.visibility)}
            </div>
          </section>

          <section class="dashboard-panel products-create-section">
            <div class="products-section-head products-section-head--stacked">
              <div>
                <p class="dashboard-eyebrow">Section 7</p>
                <h3>Product Positioning</h3>
                <p>Set the product priority so the storefront sort order is ready before Product Details opens.</p>
              </div>
            </div>

            <div class="products-choice-grid">
              ${buildSelectionCards("positioning", POSITION_OPTIONS, productDraft.page1.positioning)}
            </div>
          </section>

          <section class="dashboard-panel products-create-section products-create-section--submit">
            <div class="products-create-submit-row">
              <div>
                <p class="dashboard-eyebrow">Section 8</p>
                <h3>Save &amp; Next</h3>
                <p>Saving Page 1 stores the product, pushes it into storefront rendering immediately, and opens Product Details without 404 failures.</p>
              </div>
              <button class="products-submit-button" type="submit" data-products-submit>${escapeHtml(saveLabel)}</button>
            </div>
            <div class="products-feedback products-feedback--${escapeHtml(workflowFeedback.tone)}" data-products-feedback>${escapeHtml(workflowFeedback.message)}</div>
          </section>
        </form>

        <aside class="products-preview-column">
          <div class="dashboard-panel products-preview-panel">
            <div class="products-section-head products-section-head--stacked">
              <div>
                <p class="dashboard-eyebrow">Live Preview</p>
                <h3>Storefront product card</h3>
                <p>Preview updates instantly as the admin changes image, title, price, stock, category, visibility, and priority.</p>
              </div>
            </div>

            <article class="products-live-card">
              <div class="products-live-card__media">
                <img data-preview-image src="${escapeHtml(previewImage)}" alt="Storefront card preview image">
              </div>
              <div class="products-live-card__body">
                <div class="products-live-card__meta-row">
                  <span class="products-live-card__category" data-preview-category>${escapeHtml(toLabel(productDraft.page1.category))}</span>
                  <span class="products-live-card__visibility" data-preview-visibility>${escapeHtml(visibilityLabel)}</span>
                </div>
                <h4 data-preview-title>${escapeHtml(productName)}</h4>
                <div class="products-live-card__pricing">
                  <strong data-preview-current-price>${escapeHtml(formatCurrency(currentPrice))}</strong>
                  <span class="products-live-card__old-price${oldPrice > currentPrice && oldPrice > 0 ? "" : " is-hidden"}" data-preview-old-price>${escapeHtml(formatCurrency(oldPrice))}</span>
                  <span class="products-live-card__discount${discountPercentage > 0 ? "" : " is-hidden"}" data-preview-discount>${escapeHtml(`${discountPercentage}% OFF`)}</span>
                </div>
                <div class="products-live-card__stock-row">
                  <span class="stock-pill stock-pill--${escapeHtml(stockPresentation.tone)}" data-preview-stock-status>${escapeHtml(stockPresentation.label)}</span>
                  <span class="products-live-card__stock-count" data-preview-stock-count>${escapeHtml(`${stockPresentation.available} units ready`)}</span>
                </div>
                <div class="products-live-card__footer">
                  <span class="products-live-card__priority" data-preview-priority>${escapeHtml(positionLabel)}</span>
                  <span class="products-live-card__surface">Homepage + Shop ready</span>
                </div>
              </div>
            </article>

            <div class="products-preview-summary">
              <div>
                <span>Storefront routing</span>
                <strong data-preview-routing>${escapeHtml(visibilityLabel === "All" ? "Homepage and Shop" : visibilityLabel === "Home" ? "Homepage only" : "Shop only")}</strong>
              </div>
              <div>
                <span>Display order</span>
                <strong data-preview-order>${escapeHtml(positionLabel)}</strong>
              </div>
              <div>
                <span>Inventory status</span>
                <strong data-preview-stock-summary>${escapeHtml(`${stockPresentation.label} • ${stockPresentation.available} units`)}</strong>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  `;
}

function buildDetailsMarkup() {
  const productId = getRouteProductId();
  if (!productId) {
    return `
      <div class="products-dashboard-grid products-create-grid">
        <section class="dashboard-panel products-create-header">
          <div>
            <p class="dashboard-eyebrow">Product Details Workflow</p>
            <h2>PRODUCT DETAILS</h2>
            <p>Page 2 requires a saved Page 1 product foundation before detailed editing can continue.</p>
          </div>
        </section>
        <section class="dashboard-panel products-reset-state">
          <p class="dashboard-eyebrow">Workflow Guard</p>
          <h3>Start from Page 1 first</h3>
          <p>Create the product foundation, save it, and then the workflow will route here automatically.</p>
          <a class="products-secondary-link products-secondary-link--button" href="#/products?view=create">Back to Page 1</a>
        </section>
      </div>
    `;
  }

  const mainPreviewImage = resolveProductImage(productDraft.page1.image || productDraft.details.gallery[0] || FALLBACK_IMAGE);
  const productName = productDraft.page1.productName.trim() || "Storefront product";
  const currentPrice = getCurrentPrice();
  const oldPrice = getOldPrice();
  const discountPercentage = getDiscountPercentage();
  const visibilityLabel = getVisibilityLabel();
  const positionLabel = getPositioningLabel();

  return `
    <div class="products-dashboard-grid products-create-grid">
      <section class="dashboard-panel products-create-header">
        <div>
          <p class="dashboard-eyebrow">Admin Product Workflow</p>
          <h2>PRODUCT DETAILS</h2>
          <p>Page 2 completes the deeper ecommerce information: gallery, descriptions, variants, specifications, attributes, and extra product information.</p>
        </div>
        <div class="products-create-header__meta">
          <span class="products-inline-pill">Page 2 of 2</span>
          <p>Enterprise product editor designed to finish the listing while keeping homepage and shop rendering synchronized.</p>
        </div>
      </section>

      <div class="products-create-shell products-create-shell--details">
        <form class="products-create-form" data-products-details-form>
          <section class="dashboard-panel products-create-section">
            <div class="products-section-head products-section-head--stacked">
              <div>
                <p class="dashboard-eyebrow">Section 1</p>
                <h3>Product Gallery</h3>
                <p>Upload multiple images, color-based images, and angle shots. Drag and drop is supported and all images stay centered without stretching.</p>
              </div>
            </div>

            <div class="products-dropzone" data-gallery-dropzone>
              <input class="products-image-input" id="productsDetailsGalleryInput" type="file" accept="image/*" multiple data-products-gallery-input>
              <label class="products-upload-button" for="productsDetailsGalleryInput">Upload Gallery Images</label>
              <p class="products-upload-hint">Drag files into this area or use the upload action to add portraits, landscape images, square images, and product angle images.</p>
            </div>

            <div class="products-gallery-grid">
              ${buildGalleryCards()}
            </div>
          </section>

          <section class="dashboard-panel products-create-section">
            <div class="products-section-head products-section-head--stacked">
              <div>
                <p class="dashboard-eyebrow">Section 2</p>
                <h3>Product Name &amp; Pricing</h3>
                <p>These fields are prefilled from Page 1 and remain editable here so the final details page stays aligned with storefront pricing.</p>
              </div>
            </div>

            <div class="products-fields-grid products-fields-grid--details-top">
              <label class="products-field">
                <span>Product Name</span>
                <input class="products-input" type="text" name="productName" value="${escapeHtml(productDraft.page1.productName)}" placeholder="Storefront product name">
              </label>
              <label class="products-field">
                <span>Current Price</span>
                <div class="products-input-wrap">
                  <span class="products-input-prefix">RWF</span>
                  <input class="products-input" type="number" name="currentPrice" value="${escapeHtml(productDraft.page1.currentPrice)}" min="0" step="100" placeholder="35000">
                </div>
              </label>
              <label class="products-field">
                <span>Old Price</span>
                <div class="products-input-wrap">
                  <span class="products-input-prefix">RWF</span>
                  <input class="products-input" type="number" name="oldPrice" value="${escapeHtml(productDraft.page1.oldPrice)}" min="0" step="100" placeholder="50000">
                </div>
              </label>
            </div>
          </section>

          <section class="dashboard-panel products-create-section">
            <div class="products-section-head products-section-head--stacked">
              <div>
                <p class="dashboard-eyebrow">Section 3</p>
                <h3>Product Description</h3>
                <p>Add the detailed selling description, usage guidance, and rich product information that should appear on the detail page.</p>
              </div>
            </div>

            <label class="products-field">
              <span>Detailed Description</span>
              <textarea class="products-textarea" name="description" rows="8" placeholder="Write the full product details, materials, selling points, usage guidance, and customer-facing product information.">${escapeHtml(productDraft.details.description)}</textarea>
            </label>
          </section>

          <section class="dashboard-panel products-create-section">
            <div class="products-section-head products-section-head--stacked">
              <div>
                <p class="dashboard-eyebrow">Section 4</p>
                <h3>Product Colors</h3>
                <p>Add and remove available colors, preview swatches, and prepare the gallery for color-image matching later.</p>
              </div>
            </div>

            <div class="products-color-entry">
              <input class="products-input" type="text" placeholder="Color name e.g. Black" data-color-name>
              <input class="products-color-picker" type="color" value="#111111" data-color-hex>
              <button class="products-submit-button products-submit-button--compact" type="button" data-color-add>Add Color</button>
            </div>

            <div class="products-color-list">
              ${buildColorChips()}
            </div>
          </section>

          <section class="dashboard-panel products-create-section">
            <div class="products-section-head products-section-head--stacked">
              <div>
                <p class="dashboard-eyebrow">Section 5</p>
                <h3>Product Sizes / Attributes</h3>
                <p>The attribute workspace adapts to the selected product type so shoes, fashion, phones, and electronics get the right controls.</p>
              </div>
            </div>
            ${buildAdaptiveControls()}
          </section>

          <section class="dashboard-panel products-create-section">
            <div class="products-section-head products-section-head--stacked">
              <div>
                <p class="dashboard-eyebrow">Section 6</p>
                <h3>Extra Product Information</h3>
                <p>Add warranty information, delivery guidance, materials, usage notes, and extra specifications for the product detail page.</p>
              </div>
            </div>

            <div class="products-fields-grid products-fields-grid--extras">
              <label class="products-field">
                <span>Warranty Info</span>
                <input class="products-input" type="text" name="extraWarranty" value="${escapeHtml(productDraft.details.extraInfo.warranty)}" placeholder="e.g. 12 months manufacturer warranty">
              </label>
              <label class="products-field">
                <span>Delivery Info</span>
                <input class="products-input" type="text" name="extraDelivery" value="${escapeHtml(productDraft.details.extraInfo.delivery)}" placeholder="e.g. Same-day Kigali delivery available">
              </label>
              <label class="products-field">
                <span>Material Info</span>
                <input class="products-input" type="text" name="extraMaterial" value="${escapeHtml(productDraft.details.extraInfo.material)}" placeholder="e.g. Premium leather upper">
              </label>
              <label class="products-field">
                <span>Usage Notes</span>
                <input class="products-input" type="text" name="extraUsage" value="${escapeHtml(productDraft.details.extraInfo.usage)}" placeholder="e.g. Ideal for daily wear or gifting">
              </label>
            </div>

            <label class="products-field">
              <span>Extra Specifications</span>
              <textarea class="products-textarea" name="extraSpecifications" rows="4" placeholder="Add extra specification notes, handling instructions, or technical details.">${escapeHtml(productDraft.details.extraInfo.extraSpecifications)}</textarea>
            </label>
          </section>

          <section class="dashboard-panel products-create-section products-create-section--submit">
            <div class="products-create-submit-row">
              <div>
                <p class="dashboard-eyebrow">Section 8</p>
                <h3>Final Save</h3>
                <p>Saving completes the product, updates storefront rendering instantly, and applies the category, placement, visibility, and ordering rules from Page 1.</p>
              </div>
              <button class="products-submit-button" type="submit" data-products-details-submit>SAVE</button>
            </div>
            <div class="products-feedback products-feedback--${escapeHtml(workflowFeedback.tone)}" data-products-details-feedback>${escapeHtml(workflowFeedback.message)}</div>
            <div class="products-save-success" data-product-save-success hidden></div>
          </section>
        </form>

        <aside class="products-preview-column">
          <div class="dashboard-panel products-preview-panel products-preview-panel--details">
            <div class="products-section-head products-section-head--stacked">
              <div>
                <p class="dashboard-eyebrow">Live Details Preview</p>
                <h3>Storefront product details card</h3>
                <p>The preview reflects gallery, colors, prices, description, specifications, and placement data in real time.</p>
              </div>
            </div>

            <article class="products-live-card products-live-card--details">
              <div class="products-live-card__media products-live-card__media--details">
                <img data-details-preview-image src="${escapeHtml(mainPreviewImage)}" alt="Product details preview image">
              </div>
              <div class="products-preview-gallery-strip" data-details-preview-gallery>
                ${buildDetailsPreviewGallery()}
              </div>
              <div class="products-live-card__body">
                <div class="products-live-card__meta-row">
                  <span class="products-live-card__category" data-details-preview-category>${escapeHtml(toLabel(productDraft.page1.category))}</span>
                  <span class="products-live-card__visibility" data-details-preview-visibility>${escapeHtml(visibilityLabel)}</span>
                </div>
                <h4 data-details-preview-title>${escapeHtml(productName)}</h4>
                <div class="products-live-card__pricing">
                  <strong data-details-preview-price>${escapeHtml(formatCurrency(currentPrice))}</strong>
                  <span class="products-live-card__old-price${oldPrice > currentPrice && oldPrice > 0 ? "" : " is-hidden"}" data-details-preview-old-price>${escapeHtml(formatCurrency(oldPrice))}</span>
                  <span class="products-live-card__discount${discountPercentage > 0 ? "" : " is-hidden"}" data-details-preview-discount>${escapeHtml(`${discountPercentage}% OFF`)}</span>
                </div>
                <p class="products-details-preview-copy" data-details-preview-description>${escapeHtml(productDraft.details.description.trim() || "Detailed description preview will appear here as the admin types.")}</p>
              </div>
            </article>

            <div class="products-preview-summary products-preview-summary--details">
              <div>
                <span>Colors</span>
                <div class="products-preview-chip-group" data-details-preview-colors>${buildDetailsPreviewColors()}</div>
              </div>
              <div>
                <span>Positioning</span>
                <strong data-details-preview-order>${escapeHtml(positionLabel)}</strong>
              </div>
              <div>
                <span>Sizes</span>
                <div class="products-preview-chip-group" data-details-preview-sizes>${productDraft.details.selectedSizes.length ? productDraft.details.selectedSizes.map((size) => `<span class="products-preview-empty-pill">${escapeHtml(size)}</span>`).join("") : `<span class="products-preview-empty-pill">No sizes selected</span>`}</div>
              </div>
              <div>
                <span>Specifications</span>
                <div class="products-preview-spec-list" data-details-preview-specs>${buildDetailsPreviewSpecs()}</div>
              </div>
              <div>
                <span>Storefront routing</span>
                <strong data-details-preview-routing>${escapeHtml(visibilityLabel === "All" ? "Homepage and Shop" : visibilityLabel === "Home" ? "Homepage only" : "Shop only")}</strong>
              </div>
              <div>
                <span>Saved product id</span>
                <strong>${escapeHtml(productId)}</strong>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  `;
}

function buildRecentProductsMarkup() {
  if (!latestProducts.length) {
    return `<div class="products-empty-card">${escapeHtml(latestProductsError || "No catalog products are available yet.")}</div>`;
  }

  return latestProducts.slice(0, 6).map((product) => `
    <article class="product-list-card">
      <div class="product-list-card__media">
        <img src="${escapeHtml(resolveProductImage(product?.mainImage || product?.image))}" alt="${escapeHtml(product?.name || product?.title || "Product")}">
      </div>
      <div class="product-list-card__body">
        <div class="product-list-card__heading">
          <div>
            <p class="product-list-card__category">${escapeHtml(toLabel(product?.category))}</p>
            <h3>${escapeHtml(product?.name || product?.title || "Untitled Product")}</h3>
          </div>
          <span class="stock-pill stock-pill--${Number(product?.stock || 0) > 5 ? "healthy" : Number(product?.stock || 0) > 0 ? "low" : "empty"}">${escapeHtml(String(product?.stock ?? 0))}</span>
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
          <div>
            <p class="product-list-card__label">Visibility</p>
            <strong>${escapeHtml(toLabel(product?.visibility || "both", "Both"))}</strong>
          </div>
        </div>
        <div class="product-list-card__meta">
          <button class="products-secondary-link" type="button" data-product-edit="${escapeHtml(getProductIdentity(product))}">Edit</button>
          <button class="products-secondary-link" type="button" data-product-delete="${escapeHtml(getProductIdentity(product))}">Delete</button>
        </div>
      </div>
    </article>
  `).join("");
}

function buildOverviewMarkup() {
  const totalProducts = latestProducts.length;
  const featuredProducts = latestProducts.filter((product) => Boolean(String(product?.highlightTag || "").trim()) || String(product?.status || "").toLowerCase() === "featured").length;
  const homeVisibleProducts = latestProducts.filter((product) => ["home", "both"].includes(String(product?.visibility || "both").toLowerCase())).length;
  const topPriorityProducts = latestProducts.filter((product) => normalizePriorityCode(product?.priority) >= 1).length;

  return `
    <div class="products-dashboard-grid">
      <section class="dashboard-panel products-hero-card">
        <p class="dashboard-eyebrow">Products Workspace</p>
        <div class="products-hero-intro">
          <div class="products-hero-copy">
            <h2>Products Overview</h2>
            <p>The products overview remains available while the Add Product workflow now runs as a two-step admin editor inside this route.</p>
          </div>
          <div class="products-hero-actions">
            <a class="products-primary-link" href="#/products?view=create">Open Add Product</a>
            <a class="products-secondary-link" href="#/products">Refresh Overview</a>
          </div>
        </div>
        <div class="products-kpi-row">
          <article class="products-kpi-card">
            <span>Catalog records</span>
            <strong>${escapeHtml(String(totalProducts))}</strong>
            <small>Live products currently available to the admin dashboard.</small>
          </article>
          <article class="products-kpi-card">
            <span>Home-ready items</span>
            <strong>${escapeHtml(String(homeVisibleProducts))}</strong>
            <small>Products configured to appear on homepage surfaces.</small>
          </article>
          <article class="products-kpi-card">
            <span>Featured signals</span>
            <strong>${escapeHtml(String(featuredProducts))}</strong>
            <small>Products marked for premium merchandising.</small>
          </article>
          <article class="products-kpi-card">
            <span>Top priority</span>
            <strong>${escapeHtml(String(topPriorityProducts))}</strong>
            <small>Products sorted with top storefront priority.</small>
          </article>
        </div>
      </section>

      ${latestProductsError ? `<section class="dashboard-panel products-load-banner products-load-banner--warn">${escapeHtml(latestProductsError)}</section>` : ""}

      <div class="products-workspace-grid">
        <section class="dashboard-panel products-overview-panel">
          <div class="products-section-head">
            <div>
              <p class="dashboard-eyebrow">Catalog Snapshot</p>
              <h3>Recent products</h3>
              <p>The admin route keeps the live catalog snapshot available while new products are created and detailed.</p>
            </div>
            <span class="products-inline-pill">${escapeHtml(String(totalProducts))} products</span>
          </div>
          <div class="products-recent-grid">
            ${buildRecentProductsMarkup()}
          </div>
        </section>

        <aside class="dashboard-panel products-reset-panel">
          <div class="products-section-head">
            <div>
              <p class="dashboard-eyebrow">Workflow Status</p>
              <h3>Two-step Add Product workflow</h3>
              <p>Page 1 handles the basic product foundation, while Page 2 completes gallery, descriptions, attributes, and final storefront detail content.</p>
            </div>
          </div>
          <ul class="products-reset-checklist">
            <li>Page 1 saves basic product setup</li>
            <li>Page 1 now routes directly to Product Details</li>
            <li>Page 2 manages gallery, attributes, and product information</li>
            <li>Fallback save prevents create-route 404 failures</li>
            <li>Homepage and shop visibility stay synchronized</li>
          </ul>
        </aside>
      </div>
    </div>
  `;
}

function buildProductsMarkup() {
  if (getProductsView() !== "create") {
    return buildOverviewMarkup();
  }

  return getCreateStep() === "details" ? buildDetailsMarkup() : buildPage1Markup();
}

function rerenderCreateWorkspace(container) {
  container.innerHTML = buildProductsMarkup();
  mountCreateWorkspace(container);
}

function updatePage1Preview(container) {
  const previewImage = resolveProductImage(productDraft.page1.image || FALLBACK_IMAGE);
  const currentPrice = getCurrentPrice();
  const oldPrice = getOldPrice();
  const discountPercentage = getDiscountPercentage();
  const stockPresentation = getStockPresentation();
  const visibilityLabel = getVisibilityLabel();
  const positionLabel = getPositioningLabel();
  const title = productDraft.page1.productName.trim() || "Homepage Feature Product";

  const uploadPreviewImage = container.querySelector("[data-upload-preview-image]");
  const previewImageNode = container.querySelector("[data-preview-image]");
  const uploadEmptyState = container.querySelector("[data-upload-empty-state]");
  const removeButton = container.querySelector("[data-products-remove-image]");
  const previewTitle = container.querySelector("[data-preview-title]");
  const previewCurrentPrice = container.querySelector("[data-preview-current-price]");
  const previewOldPrice = container.querySelector("[data-preview-old-price]");
  const previewDiscount = container.querySelector("[data-preview-discount]");
  const previewCategory = container.querySelector("[data-preview-category]");
  const previewVisibility = container.querySelector("[data-preview-visibility]");
  const previewStockStatus = container.querySelector("[data-preview-stock-status]");
  const previewStockCount = container.querySelector("[data-preview-stock-count]");
  const previewStockSummary = container.querySelector("[data-preview-stock-summary]");
  const previewPriority = container.querySelector("[data-preview-priority]");
  const previewRouting = container.querySelector("[data-preview-routing]");
  const previewOrder = container.querySelector("[data-preview-order]");
  const pricingNote = container.querySelector("[data-pricing-note]");
  const stockNote = container.querySelector("[data-stock-note]");
  const feedback = container.querySelector("[data-products-feedback]");
  const submitButton = container.querySelector("[data-products-submit]");

  if (uploadPreviewImage) uploadPreviewImage.src = previewImage;
  if (previewImageNode) previewImageNode.src = previewImage;
  if (uploadEmptyState) uploadEmptyState.classList.toggle("is-hidden", Boolean(productDraft.page1.image));
  if (removeButton) removeButton.classList.toggle("is-hidden", !productDraft.page1.image);
  if (previewTitle) previewTitle.textContent = title;
  if (previewCurrentPrice) previewCurrentPrice.textContent = formatCurrency(currentPrice);
  if (previewOldPrice) {
    previewOldPrice.textContent = formatCurrency(oldPrice);
    previewOldPrice.classList.toggle("is-hidden", !(oldPrice > currentPrice && oldPrice > 0));
  }
  if (previewDiscount) {
    previewDiscount.textContent = `${discountPercentage}% OFF`;
    previewDiscount.classList.toggle("is-hidden", discountPercentage <= 0);
  }
  if (previewCategory) previewCategory.textContent = toLabel(productDraft.page1.category);
  if (previewVisibility) previewVisibility.textContent = visibilityLabel;
  if (previewStockStatus) {
    previewStockStatus.textContent = stockPresentation.label;
    previewStockStatus.className = `stock-pill stock-pill--${stockPresentation.tone}`;
  }
  if (previewStockCount) previewStockCount.textContent = `${stockPresentation.available} units ready`;
  if (previewStockSummary) previewStockSummary.textContent = `${stockPresentation.label} • ${stockPresentation.available} units`;
  if (previewPriority) previewPriority.textContent = positionLabel;
  if (previewRouting) previewRouting.textContent = visibilityLabel === "All" ? "Homepage and Shop" : visibilityLabel === "Home" ? "Homepage only" : "Shop only";
  if (previewOrder) previewOrder.textContent = positionLabel;
  if (pricingNote) {
    pricingNote.innerHTML = discountPercentage > 0
      ? `<strong>${escapeHtml(String(discountPercentage))}% discount feel ready</strong><span>The storefront preview will show the current price beside a crossed-out old price.</span>`
      : `<strong>Discount support enabled</strong><span>Add an old price higher than the current price when you want the storefront to show a markdown.</span>`;
  }
  if (stockNote) {
    stockNote.className = `products-stock-note products-stock-note--${stockPresentation.tone}`;
    stockNote.innerHTML = `<strong>${escapeHtml(stockPresentation.label)}</strong><span>${escapeHtml(stockPresentation.detail)}</span>`;
  }
  if (feedback) {
    feedback.className = `products-feedback products-feedback--${workflowFeedback.tone}`;
    feedback.textContent = workflowFeedback.message;
  }
  if (submitButton) {
    submitButton.textContent = workflowFeedback.tone === "saving"
      ? "Saving Page 1..."
      : productDraft.productId
        ? "SAVE & NEXT"
        : "CREATE PRODUCT & NEXT";
    submitButton.disabled = workflowFeedback.tone === "saving";
  }

  container.querySelectorAll(".products-choice-card").forEach((card) => {
    const input = card.querySelector("input[type='radio']");
    card.classList.toggle("is-selected", Boolean(input?.checked));
  });
}

function updateDetailsPreview(container) {
  const mainImage = resolveProductImage(productDraft.page1.image || productDraft.details.gallery[0] || FALLBACK_IMAGE);
  const currentPrice = getCurrentPrice();
  const oldPrice = getOldPrice();
  const discountPercentage = getDiscountPercentage();
  const previewImage = container.querySelector("[data-details-preview-image]");
  const previewTitle = container.querySelector("[data-details-preview-title]");
  const previewCategory = container.querySelector("[data-details-preview-category]");
  const previewVisibility = container.querySelector("[data-details-preview-visibility]");
  const previewPrice = container.querySelector("[data-details-preview-price]");
  const previewOldPrice = container.querySelector("[data-details-preview-old-price]");
  const previewDiscount = container.querySelector("[data-details-preview-discount]");
  const previewDescription = container.querySelector("[data-details-preview-description]");
  const previewGallery = container.querySelector("[data-details-preview-gallery]");
  const previewColors = container.querySelector("[data-details-preview-colors]");
  const previewSizes = container.querySelector("[data-details-preview-sizes]");
  const previewSpecs = container.querySelector("[data-details-preview-specs]");
  const previewRouting = container.querySelector("[data-details-preview-routing]");
  const previewOrder = container.querySelector("[data-details-preview-order]");
  const feedback = container.querySelector("[data-products-details-feedback]");
  const submitButton = container.querySelector("[data-products-details-submit]");

  if (previewImage) previewImage.src = mainImage;
  if (previewTitle) previewTitle.textContent = productDraft.page1.productName.trim() || "Storefront product";
  if (previewCategory) previewCategory.textContent = toLabel(productDraft.page1.category);
  if (previewVisibility) previewVisibility.textContent = getVisibilityLabel();
  if (previewPrice) previewPrice.textContent = formatCurrency(currentPrice);
  if (previewOldPrice) {
    previewOldPrice.textContent = formatCurrency(oldPrice);
    previewOldPrice.classList.toggle("is-hidden", !(oldPrice > currentPrice && oldPrice > 0));
  }
  if (previewDiscount) {
    previewDiscount.textContent = `${discountPercentage}% OFF`;
    previewDiscount.classList.toggle("is-hidden", discountPercentage <= 0);
  }
  if (previewDescription) {
    previewDescription.textContent = productDraft.details.description.trim() || "Detailed description preview will appear here as the admin types.";
  }
  if (previewGallery) previewGallery.innerHTML = buildDetailsPreviewGallery();
  if (previewColors) previewColors.innerHTML = buildDetailsPreviewColors();
  if (previewSizes) {
    previewSizes.innerHTML = productDraft.details.selectedSizes.length
      ? productDraft.details.selectedSizes.map((size) => `<span class="products-preview-empty-pill">${escapeHtml(size)}</span>`).join("")
      : `<span class="products-preview-empty-pill">No sizes selected</span>`;
  }
  if (previewSpecs) previewSpecs.innerHTML = buildDetailsPreviewSpecs();
  if (previewRouting) previewRouting.textContent = getVisibilityLabel() === "All" ? "Homepage and Shop" : getVisibilityLabel() === "Home" ? "Homepage only" : "Shop only";
  if (previewOrder) previewOrder.textContent = getPositioningLabel();
  if (feedback) {
    feedback.className = `products-feedback products-feedback--${workflowFeedback.tone}`;
    feedback.textContent = workflowFeedback.message;
  }
  if (submitButton) {
    submitButton.textContent = workflowFeedback.tone === "saving"
      ? "Saving product..."
      : (saveSuccessState ? "Saved" : "SAVE");
    submitButton.disabled = workflowFeedback.tone === "saving";
  }

  renderSaveSuccessPanel(container);
}

function validatePage1Draft() {
  if (!productDraft.page1.productName.trim()) {
    return "Enter the product name before continuing to Product Details.";
  }

  if (getCurrentPrice() <= 0) {
    return "Enter a valid current price in RWF before saving Page 1.";
  }

  if (getOldPrice() > 0 && getOldPrice() <= getCurrentPrice()) {
    return "Old price must be higher than the current price to support storefront discount rendering.";
  }

  if (getStockQuantity() < 0) {
    return "Stock quantity cannot be negative.";
  }

  return "";
}

function validateDetailsDraft() {
  if (!productDraft.productId) {
    return "Save Page 1 first so Product Details can attach to a saved product.";
  }

  if (!productDraft.details.description.trim()) {
    return "Add the detailed product description before the final save.";
  }

  const activeSpecs = productDraft.details.specRows.filter((entry) => String(entry?.label || "").trim() && String(entry?.value || "").trim());
  if (!activeSpecs.length) {
    return "Add at least one specification or attribute value before saving the product details.";
  }

  return "";
}

function updatePage1Field(target) {

  const fieldName = String(target?.name || "");
  if (!fieldName) {
    return false;
  }

  if (["productName", "currentPrice", "oldPrice", "stock"].includes(fieldName)) {
    productDraft.page1[fieldName] = String(target.value || "");
    return true;
  }

  if (fieldName === "category") {
    const previousCategory = productDraft.page1.category;
    const nextCategory = String(target.value || "fashion").toLowerCase();
    productDraft.page1.category = nextCategory;
    syncAdaptiveDetails(previousCategory, nextCategory);
    return true;
  }

  if (fieldName === "visibility") {
    productDraft.page1.visibility = String(target.value || "all").toLowerCase();
    return true;
  }

  if (fieldName === "positioning") {
    productDraft.page1.positioning = String(target.value || "middle").toLowerCase();
    return true;
  }

  return false;
}

function updateDetailsField(target) {
  if (updatePage1Field(target)) {
    return true;
  }

  const fieldName = String(target?.name || "");
  if (fieldName === "description") {
    productDraft.details.description = String(target.value || "");
    return true;
  }

  if (fieldName === "extraWarranty") {
    productDraft.details.extraInfo.warranty = String(target.value || "");
    return true;
  }
  if (fieldName === "extraDelivery") {
    productDraft.details.extraInfo.delivery = String(target.value || "");
    return true;
  }
  if (fieldName === "extraMaterial") {
    productDraft.details.extraInfo.material = String(target.value || "");
    return true;
  }
  if (fieldName === "extraUsage") {
    productDraft.details.extraInfo.usage = String(target.value || "");
    return true;
  }
  if (fieldName === "extraSpecifications") {
    productDraft.details.extraInfo.extraSpecifications = String(target.value || "");
    return true;
  }

  const specLabelIndex = target?.dataset?.specLabelIndex;
  if (specLabelIndex !== undefined) {
    productDraft.details.specRows[Number(specLabelIndex)].label = String(target.value || "");
    return true;
  }

  const specValueIndex = target?.dataset?.specValueIndex;
  if (specValueIndex !== undefined) {
    productDraft.details.specRows[Number(specValueIndex)].value = String(target.value || "");
    return true;
  }

  return false;
}

async function handlePage1Submit(container) {
  if (page1SaveInFlight) {
    return;
  }

  const validationMessage = validatePage1Draft();
  if (validationMessage) {
    setWorkflowFeedback("error", validationMessage);
    updatePage1Preview(container);
    return;
  }

  page1SaveInFlight = true;
  setWorkflowFeedback("saving", "Saving Page 1, updating storefront placement, and opening Product Details...");
  persistDraft();
  updatePage1Preview(container);

  try {
    const payload = buildPage1Payload(productDraft);
    const handleProgress = (event) => {
      const message = String(event?.message || "Saving Page 1 to backend...").trim();
      setWorkflowFeedback("saving", message);
      updatePage1Preview(container);
    };
    console.info("[Admin Products] upload started", {
      hasHeroImage: Boolean(productDraft.page1.image),
      category: payload.category,
      visibility: payload.visibility
    });
    const response = productDraft.productId
      ? await withTimeout("Save Page 1 update", updateProductAndSync(productDraft.productId, payload, { onProgress: handleProgress }), PRODUCT_SAVE_TIMEOUT_MS)
      : await withTimeout("Save Page 1 create", createProductAndSync(payload, { onProgress: handleProgress }), PRODUCT_SAVE_TIMEOUT_MS);

    console.info("[Admin Products] upload finished", {
      productId: response?.id || response?.catalogId || productDraft.productId || ""
    });

        productDraft = response ? hydrateDraftFromProduct(response) : sanitizeDraft({
      ...productDraft,
      productId: String(response?.id || response?._id || response?.catalogId || productDraft.productId || "")
    });
    persistDraft();
    writeProgress({ step: "page-1-complete", productId: productDraft.productId, nextStep: "page-2" });
    setWorkflowFeedback("success", "Page 1 saved. Opening Product Details...");
    updatePage1Preview(container);
    console.info("[Admin Products] product save success", { productId: productDraft.productId });
    console.info("[Admin Products] redirecting to page 2", { hash: getDetailsHash(productDraft.productId) });
    window.location.hash = getDetailsHash(productDraft.productId);

  } catch (error) {
    console.error("[Admin Products] Save Page 1 failed:", error);
    const message = String(error?.message || "").trim() || "Page 1 save failed. Check the current environment and try again.";
    setWorkflowFeedback("error", message);
    updatePage1Preview(container);
  } finally {
    page1SaveInFlight = false;
    updatePage1Preview(container);
  }
}

async function handleDetailsSubmit(container) {
  const validationMessage = validateDetailsDraft();
  if (validationMessage) {
    setWorkflowFeedback("error", validationMessage);
    updateDetailsPreview(container);
    return;
  }

  setWorkflowFeedback("saving", "Saving Product Details, syncing storefront rendering, and finalizing the product...");
  updateDetailsPreview(container);

  try {
    const payload = buildDetailsPayload(productDraft);
    const handleProgress = (event) => {
      const message = String(event?.message || "Saving Product Details to backend...").trim();
      setWorkflowFeedback("saving", message);
      updateDetailsPreview(container);
    };
    const response = await withTimeout("Save Product Details", updateProductAndSync(productDraft.productId, payload, { onProgress: handleProgress }), PRODUCT_SAVE_TIMEOUT_MS);
    productDraft = response ? hydrateDraftFromProduct(response) : sanitizeDraft({
      ...productDraft,
      productId: String(response?.id || response?._id || response?.catalogId || productDraft.productId || "")
    });
    persistDraft();
    showProductSaveSuccess(container, response || productDraft);
  } catch (error) {
    const message = String(error?.message || "").trim() || "Final product save failed. Check the current environment and try again.";
    setWorkflowFeedback("error", message);
    updateDetailsPreview(container);
  }
}

function mountPage1(container) {
  const form = container.querySelector("[data-products-page1-form]");
  if (!form) {
    return;
  }

  form.addEventListener("input", (event) => {
    if (!updatePage1Field(event.target)) {
      return;
    }

    setWorkflowFeedback("neutral", "Page 1 saves the product foundation and then routes directly to Product Details.");
    persistDraft();
    updatePage1Preview(container);
  });

  form.addEventListener("change", async (event) => {
    const target = event.target;
        if (target?.matches("[data-products-image-input]")) {
      const file = target.files?.[0];
      if (!file) {
        return;
      }

      try {
        const cleanupPaths = deriveCleanupCandidates(productDraft.page1.imageStoragePath, productDraft.page1.image);
        setWorkflowFeedback("saving", "Uploading hero image...");
        updatePage1Preview(container);
        const uploaded = await uploadWithRetry(file, {
          bucket: PRODUCTS_BUCKET,
          cleanupPaths,
          previousPaths: cleanupPaths,
          onProgress: (ev) => {
            const msg = String(ev?.message || ev?.percent ? `Uploading image ${ev.percent || 0}%` : "Uploading hero image...");
            setWorkflowFeedback("saving", msg);
            updatePage1Preview(container);
          }
        });

        const uploadUrl = normalizeAssetUrl(uploaded?.publicUrl || uploaded?.url || uploaded?.path || "");
        const storagePath = normalizeStoragePath(uploaded?.storagePath || uploaded?.path || uploadUrl);

        productDraft.page1.image = uploadUrl;
        productDraft.page1.imageStoragePath = storagePath;
        setWorkflowFeedback("neutral", "Hero image uploaded and ready.");
        persistDraft();
        updatePage1Preview(container);
      } catch (error) {
        setWorkflowFeedback("error", String(error?.message || "Image upload failed."));
        updatePage1Preview(container);
      }

      target.value = "";
      return;
    }


    if (updatePage1Field(target)) {
      setWorkflowFeedback("neutral", "Page 1 saves the product foundation and then routes directly to Product Details.");
      persistDraft();
      updatePage1Preview(container);
    }
  });

  form.addEventListener("click", (event) => {
    if (!event.target.closest("[data-products-remove-image]")) {
      return;
    }

        productDraft.page1.image = "";
    productDraft.page1.imageStoragePath = "";
    persistDraft();
    setWorkflowFeedback("neutral", "Hero image removed from the Page 1 workspace.");

    updatePage1Preview(container);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handlePage1Submit(container);
  });

  updatePage1Preview(container);
}

function mountDetails(container) {
  const form = container.querySelector("[data-products-details-form]");
  if (!form) {
    return;
  }

  form.addEventListener("input", (event) => {
    if (!updateDetailsField(event.target)) {
      return;
    }

    setWorkflowFeedback("neutral", "Product Details updates are staged live and will sync to the storefront on save.");
    persistDraft();
    updateDetailsPreview(container);
  });

  form.addEventListener("change", async (event) => {
    const target = event.target;
    if (target?.matches("[data-products-gallery-input]")) {
      const files = Array.from(target.files || []);
      if (!files.length) {
        return;
      }

      try {
        setWorkflowFeedback("saving", `Uploading ${files.length} gallery image(s)...`);
        updateDetailsPreview(container);
                const results = await uploadProductGallery(files, {
          bucket: PRODUCTS_BUCKET,
          onProgress: (ev) => {
            const msg = String(ev?.message || ev?.percent ? `Uploading gallery ${ev.percent || 0}%` : "Uploading gallery images...");
            setWorkflowFeedback("saving", msg);
            updateDetailsPreview(container);
          }
        });

        appendGalleryUploadsToDraft(results);
        const uploadedCount = Array.isArray(results) ? results.length : 0;
        setWorkflowFeedback("neutral", `${uploadedCount} gallery image${uploadedCount === 1 ? "" : "s"} uploaded and staged.`);
        persistDraft();
        rerenderCreateWorkspace(container);

      } catch (error) {
        setWorkflowFeedback("error", String(error?.message || "Gallery upload failed."));
        updateDetailsPreview(container);
      }

      target.value = "";
      return;
    }

    if (updateDetailsField(target)) {
      setWorkflowFeedback("neutral", "Product Details updates are staged live and will sync to the storefront on save.");
      persistDraft();
      updateDetailsPreview(container);
    }
  });

  form.addEventListener("dragover", (event) => {
    const dropzone = event.target.closest("[data-gallery-dropzone]");
    if (!dropzone) {
      return;
    }

    event.preventDefault();
    dropzone.classList.add("is-dragover");
  });

  form.addEventListener("dragleave", (event) => {
    const dropzone = event.target.closest("[data-gallery-dropzone]");
    if (!dropzone) {
      return;
    }

    dropzone.classList.remove("is-dragover");
  });

  form.addEventListener("drop", async (event) => {
    const dropzone = event.target.closest("[data-gallery-dropzone]");
    if (!dropzone) {
      return;
    }

    event.preventDefault();
    dropzone.classList.remove("is-dragover");
    const files = Array.from(event.dataTransfer?.files || []).filter((file) => String(file.type || "").startsWith("image/"));
    if (!files.length) {
      return;
    }

        try {
      setWorkflowFeedback("saving", `Uploading ${files.length} gallery image${files.length === 1 ? "" : "s"}...`);
      updateDetailsPreview(container);
      const results = await uploadProductGallery(files, {
        bucket: PRODUCTS_BUCKET,
        onProgress: (ev) => {
          const msg = String(ev?.message || ev?.percent ? `Uploading gallery ${ev.percent || 0}%` : "Uploading gallery images...");
          setWorkflowFeedback("saving", msg);
          updateDetailsPreview(container);
        }
      });

      appendGalleryUploadsToDraft(results);
      const uploadedCount = Array.isArray(results) ? results.length : 0;
      setWorkflowFeedback("neutral", `${uploadedCount} gallery image${uploadedCount === 1 ? "" : "s"} uploaded and staged.`);
      persistDraft();
      rerenderCreateWorkspace(container);
    } catch (error) {
      setWorkflowFeedback("error", String(error?.message || "Gallery upload failed."));
      updateDetailsPreview(container);
    }

  });

  form.addEventListener("click", (event) => {
    const viewSavedButton = event.target.closest("[data-product-view-saved]");
    if (viewSavedButton) {
      const productId = String(saveSuccessState?.productId || form.querySelector("[data-saved-product-id]")?.value || productDraft.productId || "").trim();
      const viewUrl = getStorefrontProductUrl(productId);
      if (viewUrl) {
        window.open(viewUrl, "_blank", "noopener,noreferrer");
      }
      return;
    }

    const addAnotherButton = event.target.closest("[data-product-add-another]");
    if (addAnotherButton) {
      transitionToFreshProductWorkflow(container, "Ready to add another product.");
      return;
    }

    const removeGalleryButton = event.target.closest("[data-gallery-remove-index]");
    if (removeGalleryButton) {
      const index = Number(removeGalleryButton.dataset.galleryRemoveIndex);
      removeGalleryEntryAt(index);
      persistDraft();
      setWorkflowFeedback("neutral", "Gallery image removed from Product Details.");
      rerenderCreateWorkspace(container);
      return;
    }


    const addColorButton = event.target.closest("[data-color-add]");
    if (addColorButton) {
      const colorNameInput = form.querySelector("[data-color-name]");
      const colorHexInput = form.querySelector("[data-color-hex]");
      const colorName = String(colorNameInput?.value || "").trim();
      if (!colorName) {
        setWorkflowFeedback("error", "Enter a color name before adding it.");
        updateDetailsPreview(container);
        return;
      }

      productDraft.details.colors.push({
        name: colorName,
        hex: String(colorHexInput?.value || inferColorHex(colorName)).trim() || inferColorHex(colorName)
      });
      persistDraft();
      setWorkflowFeedback("neutral", `${colorName} added to the product colors.`);
      rerenderCreateWorkspace(container);
      return;
    }

    const removeColorButton = event.target.closest("[data-color-remove-index]");
    if (removeColorButton) {
      const index = Number(removeColorButton.dataset.colorRemoveIndex);
      productDraft.details.colors.splice(index, 1);
      persistDraft();
      setWorkflowFeedback("neutral", "Color removed from the product.");
      rerenderCreateWorkspace(container);
      return;
    }

    const sizeButton = event.target.closest("[data-size-option]");
    if (sizeButton) {
      const size = String(sizeButton.dataset.sizeOption || "");
      if (productDraft.details.selectedSizes.includes(size)) {
        productDraft.details.selectedSizes = productDraft.details.selectedSizes.filter((entry) => entry !== size);
      } else {
        productDraft.details.selectedSizes = [...productDraft.details.selectedSizes, size];
      }
      persistDraft();
      setWorkflowFeedback("neutral", "Available sizes updated for the product.");
      rerenderCreateWorkspace(container);
      return;
    }

    const addSpecButton = event.target.closest("[data-spec-add]");
    if (addSpecButton) {
      productDraft.details.specRows.push({ label: "", value: "" });
      persistDraft();
      rerenderCreateWorkspace(container);
      return;
    }

    const removeSpecButton = event.target.closest("[data-spec-remove-index]");
    if (removeSpecButton) {
      const index = Number(removeSpecButton.dataset.specRemoveIndex);
      productDraft.details.specRows.splice(index, 1);
      if (!productDraft.details.specRows.length) {
        productDraft.details.specRows = getAdaptiveSpecTemplate(productDraft.page1.category);
      }
      persistDraft();
      rerenderCreateWorkspace(container);
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handleDetailsSubmit(container);
  });

  renderSaveSuccessPanel(container);
  updateDetailsPreview(container);
}

function mountCreateWorkspace(container) {
  if (getCreateStep() === "details") {
    mountDetails(container);
    return;
  }

  mountPage1(container);
}

function mountOverviewWorkspace(container) {
  container.addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-product-edit]");
    if (editButton) {
      const productId = String(editButton.dataset.productEdit || "").trim();
      if (!productId) {
        return;
      }

      window.location.hash = `#/products?view=create&productId=${encodeURIComponent(productId)}`;
      return;
    }

    const deleteButton = event.target.closest("[data-product-delete]");
    if (!deleteButton) {
      return;
    }

    const productId = String(deleteButton.dataset.productDelete || "").trim();
    if (!productId) {
      return;
    }

    const matchedProduct = latestProducts.find((product) => getProductIdentity(product) === productId);
    const confirmed = window.confirm(`Delete ${matchedProduct?.name || "this product"} from the live catalog?`);
    if (!confirmed) {
      return;
    }

    try {
      deleteButton.disabled = true;
      await deleteProductAndSync(productId);
      latestProducts = latestProducts.filter((product) => getProductIdentity(product) !== productId);
      container.innerHTML = buildProductsMarkup();
      mountOverviewWorkspace(container);
    } catch (error) {
      deleteButton.disabled = false;
      window.alert(String(error?.message || "Unable to delete the product."));
    }
  });
}

export async function renderProducts(container) {
  latestProducts = [];
  latestProductsError = "";
  productDraft = sanitizeDraft(readDraft());

  const routeProductId = getRouteProductId();
  if (routeProductId) {
    productDraft.productId = routeProductId;
  }

  try {
    latestProducts = await getProducts({ preferCache: true, allowCacheFallback: true });

    if (routeProductId) {
      const matchedProduct = latestProducts.find((product) => getProductIdentity(product) === routeProductId);
      if (matchedProduct) {
        productDraft = hydrateDraftFromProduct(matchedProduct);
        persistDraft();
      }
    }
  } catch (error) {
    const rawMessage = String(error?.message || "").trim();
    latestProductsError = /404|failed|network|fetch|request/i.test(rawMessage)
      ? "Live catalog snapshot is unavailable in this environment. The admin workflow remains stable and local storefront synchronization is still active."
      : rawMessage || "Live catalog data could not be loaded.";
  }

  container.innerHTML = buildProductsMarkup();

  if (getProductsView() === "create") {
    mountCreateWorkspace(container);
    return;
  }

  mountOverviewWorkspace(container);
}
