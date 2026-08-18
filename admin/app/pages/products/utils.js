import { DETAIL_PAGE_PATH } from "./constants.js";

import { isProductCardImageUrl } from "../../../../services/storefront-asset-url.js";

const PRODUCTION_SITE_ORIGIN = "https://byosemarket.com";

export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toLabel(value, fallback = "General") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return fallback;
  }

  return normalized
    .replace(/[-_]+/g, " ")
    .replace(/(^\w|\s\w)/g, (match) => match.toUpperCase());
}

export function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseTagsInput(value) {
  return String(value || "")
    .split(/[,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function formatCurrency(value) {
  return `RWF ${Number(value || 0).toLocaleString("en-US")}`;
}

export function parseHashParams() {
  const hash = String(window.location.hash || "");
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return new URLSearchParams(query);
}

export function getProductsView() {
  return parseHashParams().get("view") === "create" ? "create" : "overview";
}

export function getWizardStep(fallback = "info") {
  const step = String(parseHashParams().get("step") || fallback).trim().toLowerCase();
  const valid = ["info", "pricing", "inventory", "description", "media", "publish", "review"];
  return valid.includes(step) ? step : fallback;
}

export function getRouteProductId(fallback = "") {
  return String(parseHashParams().get("productId") || fallback || "").trim();
}

export function buildCreateHash(step = "info", productId = "") {
  const params = new URLSearchParams({ view: "create", step });
  if (productId) {
    params.set("productId", productId);
  }
  return `#/products?${params.toString()}`;
}

export function buildProductViewUrl(catalogId) {
  return `${DETAIL_PAGE_PATH}?id=${encodeURIComponent(String(catalogId || ""))}`;
}

export function readJsonStorage(key, fallbackValue = null) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallbackValue;
    }
    return JSON.parse(raw);
  } catch (_error) {
    return fallbackValue;
  }
}

export function writeJsonStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (_error) {
    // Ignore storage failures.
  }
}

export function clearJsonStorage(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (_error) {
    // Ignore storage failures.
  }
}

export function normalizeAssetUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  if (/^(?:https?:|blob:|data:)/i.test(normalized)) {
    return normalized;
  }

  if (normalized.startsWith("/uploads/") || normalized.startsWith("/")) {
    return `${PRODUCTION_SITE_ORIGIN}${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
  }

  if (/^(?:products|categories|users|reviews|temp)\//i.test(normalized)) {
    return `${PRODUCTION_SITE_ORIGIN}/uploads/${normalized.replace(/^\/+/, "")}`;
  }

  return normalized;
}

export function normalizeStoragePath(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  if (normalized.startsWith("/uploads/")) {
    return normalized.slice("/uploads/".length);
  }

  return normalized.replace(/^\/+/, "");
}

export function isBlobUrl(value) {
  return /^blob:/i.test(String(value || "").trim());
}

export function isDataUrl(value) {
  return /^data:/i.test(String(value || "").trim());
}

export function isCompanyLogoUrl(value) {
  const normalized = String(value || "").trim().replace(/\\/g, "/").toLowerCase();
  if (!normalized) {
    return false;
  }

  return /(?:^|\/)img\/logo\.png(?:\?|#|$)/.test(normalized)
    || normalized === "img/logo.png"
    || normalized === "../img/logo.png"
    || normalized.endsWith("/img/logo.png");
}

export function isPersistableAssetUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized || isBlobUrl(normalized) || isDataUrl(normalized) || isCompanyLogoUrl(normalized) || isProductCardImageUrl(normalized)) {
    return false;
  }

  return /^(?:https?:|\/uploads\/|products\/|categories\/|users\/|reviews\/|temp\/)/i.test(normalized);
}

export function preferCanonicalAssetUrl(...values) {
  for (const value of values) {
    const normalized = normalizeAssetUrl(value);
    if (isPersistableAssetUrl(normalized) || isPersistableAssetUrl(value)) {
      return normalized || String(value || "").trim();
    }
  }
  return "";
}

export function preferCanonicalStoragePath(...values) {
  for (const value of values) {
    const path = normalizeStoragePath(value);
    if (!path || /(?:^|\/)products\/cards\//i.test(path)) {
      continue;
    }
    return path;
  }
  return "";
}

export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif"
];

export const MAX_IMAGE_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export function validateImageFile(file) {
  if (!file) {
    return "No image file selected.";
  }

  const mimeType = String(file.type || "").trim().toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(mimeType)) {
    return "Only JPG, PNG, WEBP, GIF, and AVIF images are allowed.";
  }

  if (Number(file.size || 0) > MAX_IMAGE_FILE_SIZE_BYTES) {
    return "Each image must be 5 MB or smaller.";
  }

  return "";
}

export function sanitizePersistedGallery(gallery = [], galleryStoragePaths = []) {
  const urls = [];
  const storage = [];

  (Array.isArray(gallery) ? gallery : []).forEach((entry, index) => {
    const url = normalizeAssetUrl(entry);
    if (!isPersistableAssetUrl(url) || isProductCardImageUrl(url)) {
      return;
    }

    urls.push(url);
    storage.push(
      normalizeStoragePath(galleryStoragePaths[index] || url)
    );
  });

  return { gallery: urls, galleryStoragePaths: storage };
}
