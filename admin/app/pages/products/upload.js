import { uploadProductGallery, uploadWithRetry, removeStoredAssets } from "../../../../services/uploadService.js";
import {
  isBlobUrl,
  isPersistableAssetUrl,
  normalizeAssetUrl,
  normalizeStoragePath,
  sanitizePersistedGallery
} from "./utils.js";

export async function uploadMainImage(file, previousPath = "", onProgress) {
  const cleanupPaths = previousPath ? [normalizeStoragePath(previousPath)] : [];
  const result = await uploadWithRetry(file, {
    onProgress,
    progressLabel: "Uploading main image...",
    cleanupPaths: cleanupPaths.filter(Boolean)
  });

  const mainImage = normalizeAssetUrl(result.publicUrl || result.url || result.path);
  const mainImageStoragePath = normalizeStoragePath(result.storagePath || result.path || result.publicUrl);

  if (!isPersistableAssetUrl(mainImage)) {
    throw new Error("Main image upload did not return a valid storage path.");
  }

  return { mainImage, mainImageStoragePath };
}

export async function uploadGalleryFiles(files = [], onProgress) {
  const uploaded = await uploadProductGallery(files, {
    onProgress,
    progressLabel: "Uploading gallery image..."
  });

  return uploaded.map((entry) => {
    const url = normalizeAssetUrl(entry.publicUrl || entry.url || entry.path);
    const storagePath = normalizeStoragePath(entry.storagePath || entry.path || entry.publicUrl);
    if (!isPersistableAssetUrl(url)) {
      throw new Error("Gallery image upload did not return a valid storage path.");
    }
    return { url, storagePath };
  });
}

export async function resolveDraftMedia(draft, pendingMainFile, pendingGalleryFiles = [], onProgress) {
  const media = sanitizePersistedGallery(
    draft?.media?.gallery || [],
    draft?.media?.galleryStoragePaths || []
  );

  media.mainImage = isPersistableAssetUrl(draft?.media?.mainImage)
    ? normalizeAssetUrl(draft.media.mainImage)
    : "";
  media.mainImageStoragePath = normalizeStoragePath(
    draft?.media?.mainImageStoragePath || media.mainImage
  );

  const removedPaths = [];

  if (pendingMainFile) {
    if (media.mainImageStoragePath) {
      removedPaths.push(media.mainImageStoragePath);
    }
    const uploaded = await uploadMainImage(pendingMainFile, media.mainImageStoragePath, onProgress);
    media.mainImage = uploaded.mainImage;
    media.mainImageStoragePath = uploaded.mainImageStoragePath;
  } else if (isBlobUrl(draft?.media?.mainImage)) {
    throw new Error("Main image preview expired. Return to the Media step and select the image again.");
  }

  if (!media.mainImage) {
    throw new Error("Main product image is required.");
  }

  if (pendingGalleryFiles.length) {
    const uploadedGallery = await uploadGalleryFiles(pendingGalleryFiles, onProgress);
    media.gallery = [...media.gallery, ...uploadedGallery.map((entry) => entry.url)];
    media.galleryStoragePaths = [...media.galleryStoragePaths, ...uploadedGallery.map((entry) => entry.storagePath)];
  }

  media.gallery = media.gallery.filter((entry) => isPersistableAssetUrl(entry));
  media.galleryStoragePaths = media.galleryStoragePaths.slice(0, media.gallery.length);

  if (removedPaths.length) {
    await removeStoredAssets(removedPaths.filter(Boolean));
  }

  return media;
}

export function removeGalleryItem(draft, index) {
  const sanitized = sanitizePersistedGallery(
    draft?.media?.gallery || [],
    draft?.media?.galleryStoragePaths || []
  );
  const removedStorage = sanitized.galleryStoragePaths[index] || normalizeStoragePath(sanitized.gallery[index]);
  sanitized.gallery.splice(index, 1);
  sanitized.galleryStoragePaths.splice(index, 1);

  if (removedStorage) {
    void removeStoredAssets([removedStorage]);
  }

  return {
    ...(draft.media || {}),
    ...sanitized
  };
}

export function removeMainImage(draft) {
  const media = { ...(draft.media || {}) };
  const removedStorage = media.mainImageStoragePath || normalizeStoragePath(media.mainImage);
  media.mainImage = "";
  media.mainImageStoragePath = "";

  if (removedStorage && isPersistableAssetUrl(removedStorage)) {
    void removeStoredAssets([removedStorage]);
  }

  return media;
}
