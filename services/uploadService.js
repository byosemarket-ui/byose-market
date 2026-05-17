import supabase from "../config/supabase.js";

export const PRODUCTS_BUCKET = "products";

const DEFAULT_UPLOAD_RETRY_COUNT = 2;
const DEFAULT_UPLOAD_TIMEOUT_MS = 60000;

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function sanitizePathSegment(value, fallback = "file") {
  return normalizeText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function isDataUrl(value) {
  return /^data:/i.test(normalizeText(value));
}

function isRemoteUrl(value) {
  return /^(?:https?:|\/|\.\/|\.\.\/)/i.test(normalizeText(value));
}

function inferExtension(contentType = "", fallback = "jpg") {
  const normalized = normalizeText(contentType).toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("svg")) return "svg";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  return fallback;
}

function createTimeoutError(label, timeoutMs) {
  const error = new Error(`${label} timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
  error.code = "OPERATION_TIMEOUT";
  return error;
}

async function withTimeout(label, promise, timeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS) {
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

function reportProgress(onProgress, message, extra = {}) {
  if (typeof onProgress === "function") {
    onProgress({
      message,
      ...extra
    });
  }
}

async function sourceToBlob(source) {
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    return source;
  }

  if (typeof File !== "undefined" && source instanceof File) {
    return source;
  }

  const normalized = normalizeText(source);
  if (isDataUrl(normalized)) {
    const response = await fetch(normalized);
    return response.blob();
  }

  throw new Error("Only new image files or staged image data can be uploaded.");
}

function buildStoragePath({ productId, kind, index, blob }) {
  const extension = inferExtension(blob?.type, "jpg");
  const safeProductId = sanitizePathSegment(productId, "product");
  const safeKind = sanitizePathSegment(kind, "asset");
  const uniquePart = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${safeProductId}/${safeKind}-${index + 1}-${uniquePart}.${extension}`;
}

function buildPublicUrl(path) {
  const { data } = supabase.storage.from(PRODUCTS_BUCKET).getPublicUrl(path);
  return normalizeText(data?.publicUrl);
}

function mapUploadError(error) {
  const message = String(error?.message || error || "Upload failed.").trim();

  if (/bucket/i.test(message) && /not found|does not exist/i.test(message)) {
    const normalized = new Error("Supabase storage bucket 'products' is missing. Create it before uploading product images.");
    normalized.code = "SUPABASE_BUCKET_MISSING";
    return normalized;
  }

  if (/row-level security|policy/i.test(message)) {
    const normalized = new Error("Supabase storage write access is blocked by policy. Update the products bucket policies before uploading images.");
    normalized.code = "SUPABASE_STORAGE_POLICY_BLOCKED";
    return normalized;
  }

  return error instanceof Error ? error : new Error(message);
}

async function uploadSingleAsset(source, options = {}) {
  if (isRemoteUrl(source) && !isDataUrl(source)) {
    return {
      url: normalizeText(source),
      path: normalizeText(options.existingPath)
    };
  }

  const blob = await sourceToBlob(source);
  const path = buildStoragePath({
    productId: options.productId,
    kind: options.kind,
    index: Number(options.index || 0),
    blob
  });

  reportProgress(options.onProgress, options.progressLabel || "Uploading product image to Supabase...", {
    phase: "uploading",
    path,
    index: Number(options.index || 0),
    total: Number(options.total || 1)
  });

  const { error } = await withTimeout(`Supabase upload for ${path}`, supabase.storage.from(PRODUCTS_BUCKET).upload(path, blob, {
    contentType: blob.type || "image/jpeg",
    upsert: true,
    cacheControl: "3600"
  }), options.timeoutMs || DEFAULT_UPLOAD_TIMEOUT_MS);

  if (error) {
    throw mapUploadError(error);
  }

  return {
    path,
    url: buildPublicUrl(path)
  };
}

export async function uploadWithRetry(source, options = {}) {
  const retryCount = Math.max(0, Number(options.retryCount ?? DEFAULT_UPLOAD_RETRY_COUNT));
  let lastError = null;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      if (attempt > 0) {
        reportProgress(options.onProgress, `Retrying image upload (${attempt + 1}/${retryCount + 1})...`, {
          phase: "retrying",
          attempt: attempt + 1
        });
      }

      return await uploadSingleAsset(source, options);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Upload failed.");
}

export async function uploadProductGallery(sources = [], options = {}) {
  const results = [];
  const total = Array.isArray(sources) ? sources.length : 0;

  for (let index = 0; index < total; index += 1) {
    const source = sources[index];
    results.push(await uploadWithRetry(source, {
      ...options,
      kind: options.kind || "gallery",
      index,
      total,
      progressLabel: `Uploading gallery image ${index + 1} of ${total}...`
    }));
  }

  return results;
}

export async function removeStoredAssets(paths = []) {
  const removablePaths = Array.isArray(paths)
    ? paths.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];

  if (!removablePaths.length) {
    return;
  }

  const { error } = await supabase.storage.from(PRODUCTS_BUCKET).remove(removablePaths);
  if (error && !/not found/i.test(String(error.message || ""))) {
    throw mapUploadError(error);
  }
}

export default {
  PRODUCTS_BUCKET,
  uploadWithRetry,
  uploadProductGallery,
  removeStoredAssets
};