import {
  buildUploadUrl,
  ensureUploadCapableApiBaseUrl,
  resolveApiBaseUrl
} from "./api-origin.js";

export const PRODUCTS_BUCKET = "products";
export const HERO_BUCKET = "hero";

const DEFAULT_UPLOAD_RETRY_COUNT = 2;

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function getAdminToken() {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return String(window.localStorage.getItem("adminToken") || "").trim();
  } catch (_error) {
    return "";
  }
}

function reportProgress(onProgress, message, extra = {}) {
  if (typeof onProgress === "function") {
    onProgress({ message, ...extra });
  }
}

function dataUrlToBlob(dataUrl) {
  const matches = String(dataUrl || "").match(/^data:(.+);base64,(.*)$/);
  if (!matches) {
    throw new Error("Invalid data URL");
  }

  const mime = matches[1];
  const bstr = atob(matches[2]);
  const u8arr = new Uint8Array(bstr.length);
  for (let index = 0; index < bstr.length; index += 1) {
    u8arr[index] = bstr.charCodeAt(index);
  }

  return new Blob([u8arr], { type: mime });
}

function buildUploadPromise(file, bucket, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest();
      const url = buildUploadUrl(bucket);
      const token = getAdminToken();
      if (!token) {
        reject(new Error("Admin session expired. Please sign in again and retry the upload."));
        return;
      }

      const form = new FormData();
      form.append("file", file, file.name || "upload");

      if (Array.isArray(options.cleanupPaths) && options.cleanupPaths.length) {
        form.append("cleanupPaths", JSON.stringify(options.cleanupPaths));
      }

      if (Array.isArray(options.previousPaths) && options.previousPaths.length) {
        form.append("previousPaths", JSON.stringify(options.previousPaths));
      }

      xhr.open("POST", url, true);

      if (token) {
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      }

      xhr.upload.onprogress = function onUploadProgress(event) {
        const pct = event.lengthComputable ? Math.round((event.loaded / event.total) * 100) : null;
        reportProgress(
          options.onProgress,
          options.progressLabel || `Uploading ${file.name || "file"}...`,
          { phase: "upload", percent: pct }
        );
      };

      xhr.onerror = function onUploadError() {
        reject(new Error("Network error during upload."));
      };

      xhr.onload = function onUploadComplete() {
        try {
          const status = xhr.status || 0;
          let parsed = null;

          try {
            parsed = JSON.parse(xhr.responseText);
          } catch (_error) {
            parsed = null;
          }

          if (status === 401 || status === 403) {
            if (window.AdminSecurity && typeof window.AdminSecurity.handleUnauthorized === "function") {
              window.AdminSecurity.handleUnauthorized();
            }
          }

          if (status >= 200 && status < 300 && parsed && parsed.success && Array.isArray(parsed.files) && parsed.files.length) {
            resolve(parsed.files[0]);
            return;
          }

          const message = parsed?.message || parsed?.error || `Upload failed with status ${status} at ${url}`;
          const err = new Error(message || "Upload failed.");
          err.status = status;
          reject(err);
        } catch (error) {
          reject(error);
        }
      };

      xhr.send(form);
    } catch (error) {
      reject(error);
    }
  });
}

async function uploadSingleAsset(source, options = {}) {
  if (typeof File !== "undefined" && source instanceof File) {
    return buildUploadPromise(source, options.bucket || PRODUCTS_BUCKET, options);
  }

  if (typeof Blob !== "undefined" && source instanceof Blob) {
    const file = new File([source], options.filename || "upload", {
      type: source.type || "application/octet-stream"
    });
    return buildUploadPromise(file, options.bucket || PRODUCTS_BUCKET, options);
  }

  const normalized = normalizeText(source);

  if (/^data:/i.test(normalized)) {
    const blob = dataUrlToBlob(normalized);
    const ext = (blob.type || "image/png").split("/").pop().split("+")[0];
    const file = new File([blob], `upload.${ext}`, { type: blob.type });
    return buildUploadPromise(file, options.bucket || PRODUCTS_BUCKET, options);
  }

  if (/^blob:/i.test(normalized)) {
    throw new Error("Local preview images must be uploaded as files before saving.");
  }

  if (/^(?:https?:|\/|\.)/i.test(normalized) || /^(?:products|categories|users|reviews|hero|temp)\//i.test(normalized)) {
    reportProgress(options.onProgress, options.progressLabel || "Using existing asset reference", { phase: "reference" });
    const publicUrl = normalized.startsWith("/") ? normalized : `/uploads/${normalized.replace(/^\/+/, "")}`;
    return {
      path: normalized.startsWith("/uploads/") ? normalized.replace(/^\/uploads\//, "") : normalized,
      storagePath: normalized.startsWith("/uploads/") ? normalized.replace(/^\/uploads\//, "") : normalized,
      url: publicUrl,
      publicUrl
    };
  }

  throw new Error("Unsupported asset source for upload");
}

export async function uploadWithRetry(source, options = {}) {
  await ensureUploadCapableApiBaseUrl(options);
  const retryCount = Math.max(0, Number(options.retryCount ?? DEFAULT_UPLOAD_RETRY_COUNT));
  let lastError = null;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await uploadSingleAsset(source, options);
    } catch (error) {
      lastError = error;
      if (attempt < retryCount) {
        await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error("Asset upload failed.");
}

export async function uploadProductGallery(sources = [], options = {}) {
  const results = [];
  const files = Array.isArray(sources) ? sources : [];

  for (let index = 0; index < files.length; index += 1) {
    const source = files[index];
    const result = await uploadWithRetry(source, {
      ...options,
      index,
      total: files.length,
      progressLabel: options.progressLabel || `Uploading gallery image ${index + 1} of ${files.length}...`
    });
    results.push(result);
  }

  return results;
}

export async function removeStoredAssets(paths = []) {
  const normalizedPaths = Array.isArray(paths) ? paths.filter(Boolean) : [];
  if (!normalizedPaths.length) {
    return undefined;
  }

  await ensureUploadCapableApiBaseUrl();
  const apiBase = resolveApiBaseUrl();
  const token = getAdminToken();

  try {
    await fetch(`${apiBase}/uploads`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ paths: normalizedPaths })
    });
  } catch (_error) {
    // Ignore cleanup failures.
  }

  return undefined;
}

export default {
  PRODUCTS_BUCKET,
  HERO_BUCKET,
  uploadWithRetry,
  uploadProductGallery,
  removeStoredAssets
};
