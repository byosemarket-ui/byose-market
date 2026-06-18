export const PRODUCTION_SITE_ORIGIN = "https://byosemarket.com";

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function resolveStorefrontOrigin() {
  if (typeof window !== "undefined") {
    const protocol = String(window.location?.protocol || "").toLowerCase();
    const origin = normalizeBaseUrl(window.location?.origin || "");
    if ((protocol === "http:" || protocol === "https:") && origin) {
      return origin;
    }
  }

  return PRODUCTION_SITE_ORIGIN;
}

export function normalizeStorefrontAssetUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  if (/^(?:https?:|data:|blob:)/i.test(normalized)) {
    return normalized;
  }

  const origin = resolveStorefrontOrigin();

  if (normalized.startsWith("/uploads/") || normalized.startsWith("/img/")) {
    return `${origin}${normalized}`;
  }

  if (normalized.startsWith("uploads/")) {
    return `${origin}/${normalized.replace(/^\/+/, "")}`;
  }

  if (/^(?:products|categories|users|reviews|temp)\//i.test(normalized)) {
    return `${origin}/uploads/${normalized.replace(/^\/+/, "")}`;
  }

  if (normalized.startsWith("img/")) {
    return `${origin}/${normalized}`;
  }

  if (normalized.startsWith("/")) {
    return `${origin}${normalized}`;
  }

  return normalized;
}

export function normalizeStorefrontAssetList(values = []) {
  const seen = new Set();
  const output = [];

  for (const entry of values) {
    const normalized = normalizeStorefrontAssetUrl(entry);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

export default {
  PRODUCTION_SITE_ORIGIN,
  normalizeStorefrontAssetUrl,
  normalizeStorefrontAssetList,
  resolveStorefrontOrigin
};
