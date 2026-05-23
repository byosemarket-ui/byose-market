export const PRODUCTS_BUCKET = "products";

const DEFAULT_UPLOAD_RETRY_COUNT = 2;

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function reportProgress(onProgress, message, extra = {}) {
  if (typeof onProgress === "function") {
    onProgress({
      message,
      ...extra
    });
  }
}

function dataUrlToBlob(dataUrl) {
  const matches = String(dataUrl || "").match(/^data:(.+);base64,(.*)$/);
  if (!matches) throw new Error("Invalid data URL");
  const mime = matches[1];
  const bstr = atob(matches[2]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

function buildUploadPromise(file, bucket, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest();
      const url = `/api/uploads/${encodeURIComponent(String(bucket || PRODUCTS_BUCKET))}`;
      const form = new FormData();
      form.append("file", file, file.name || "upload");

      if (Array.isArray(options.cleanupPaths) && options.cleanupPaths.length) {
        form.append("cleanupPaths", JSON.stringify(options.cleanupPaths));
      }
      if (Array.isArray(options.previousPaths) && options.previousPaths.length) {
        form.append("previousPaths", JSON.stringify(options.previousPaths));
      }

      xhr.open("POST", url, true);
      xhr.withCredentials = true;

      xhr.upload.onprogress = function (event) {
        const pct = event.lengthComputable ? Math.round((event.loaded / event.total) * 100) : null;
        reportProgress(options.onProgress, options.progressLabel || `Uploading ${file.name || 'file'}...`, { phase: 'upload', percent: pct });
      };

      xhr.onerror = function () {
        reject(new Error("Network error during upload."));
      };

      xhr.onload = function () {
        try {
          const status = xhr.status || 0;
          let parsed = null;
          try { parsed = JSON.parse(xhr.responseText); } catch (_e) { parsed = null; }
          if (status >= 200 && status < 300 && parsed && parsed.success && Array.isArray(parsed.files) && parsed.files.length) {
            resolve(parsed.files[0]);
            return;
          }

          const message = parsed?.message || parsed?.error || `Upload failed with status ${status}`;
          const err = new Error(message || "Upload failed.");
          err.status = status;
          reject(err);
        } catch (e) {
          reject(e);
        }
      };

      xhr.send(form);
    } catch (e) {
      reject(e);
    }
  });
}

async function uploadSingleAsset(source, options = {}) {
  // If source is a File already, upload directly.
  if (typeof File !== 'undefined' && source instanceof File) {
    return await buildUploadPromise(source, options.bucket || PRODUCTS_BUCKET, options);
  }

  // If source is a Blob, wrap as File
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    const file = new File([source], options.filename || 'upload', { type: source.type || 'application/octet-stream' });
    return await buildUploadPromise(file, options.bucket || PRODUCTS_BUCKET, options);
  }

  const normalized = normalizeText(source);
  // If it's a data URL, convert and upload
  if (/^data:/i.test(normalized)) {
    const blob = dataUrlToBlob(normalized);
    const ext = (blob.type || 'image/png').split('/').pop().split('+')[0];
    const file = new File([blob], `upload.${ext}`, { type: blob.type });
    return await buildUploadPromise(file, options.bucket || PRODUCTS_BUCKET, options);
  }

  // If it's already a URL/path, do not re-upload — return as-is for compatibility
  if (/^(?:https?:|\/|\.|blob:)/i.test(normalized)) {
    reportProgress(options.onProgress, options.progressLabel || 'Using existing asset reference', { phase: 'reference' });
    return {
      path: "",
      url: normalized,
      publicUrl: normalized
    };
  }

  throw new Error('Unsupported asset source for upload');
}

export async function uploadWithRetry(source, options = {}) {
  const retryCount = Math.max(0, Number(options.retryCount ?? DEFAULT_UPLOAD_RETRY_COUNT));
  let lastError = null;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await uploadSingleAsset(source, options);
    } catch (error) {
      lastError = error;
      // small backoff
      if (attempt < retryCount) await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }

  throw lastError || new Error("Asset upload failed.");
}

export async function uploadProductGallery(sources = [], options = {}) {
  const results = [];
  const files = Array.isArray(sources) ? sources : [];
  for (let i = 0; i < files.length; i += 1) {
    const src = files[i];
    const res = await uploadWithRetry(src, {
      ...options,
      index: i,
      total: files.length,
      progressLabel: options.progressLabel || `Uploading gallery image ${i + 1} of ${files.length}...`
    });
    results.push(res);
  }

  return results;
}

export async function removeStoredAssets(_paths = []) {
  try {
    await fetch('/api/uploads', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: Array.isArray(_paths) ? _paths : [] })
    });
  } catch (_e) {
    // ignore
  }
  return undefined;
}

export default {
  PRODUCTS_BUCKET,
  uploadWithRetry,
  uploadProductGallery,
  removeStoredAssets
};