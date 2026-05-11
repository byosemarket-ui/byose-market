import {
  attachDraftImages,
  clearMainImage,
  cloneDraft,
  createImageAsset,
  promoteGalleryImage,
  removeGalleryImage
} from "./product-draft.js";

export const MEDIA_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const MEDIA_MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
export const MEDIA_MAX_GALLERY_ITEMS = 8;

function toTrimmedString(value) {
  return String(value || "").trim();
}

function normalizeMimeType(value) {
  return toTrimmedString(value).toLowerCase();
}

function createMediaIssue(code, fileName, message, tone = "error") {
  return {
    code,
    fileName: toTrimmedString(fileName),
    message,
    tone
  };
}

function createAssetFingerprint(asset) {
  return [
    toTrimmedString(asset?.name).toLowerCase(),
    Number(asset?.size || 0),
    normalizeMimeType(asset?.type),
    toTrimmedString(asset?.src)
  ].join("::");
}

function decorateMediaAsset(asset, target, orderIndex) {
  return {
    ...asset,
    role: target === "main" ? "featured" : "gallery",
    status: "ready",
    source: "local",
    orderIndex: Number(orderIndex || 0),
    fingerprint: createAssetFingerprint(asset)
  };
}

function getExistingMediaAssets(draft) {
  const items = [];
  if (draft?.media?.mainImage) {
    items.push(draft.media.mainImage);
  }
  if (Array.isArray(draft?.media?.gallery)) {
    items.push(...draft.media.gallery);
  }
  return items.filter(Boolean);
}

function canAcceptType(fileData) {
  return MEDIA_ACCEPTED_TYPES.includes(normalizeMimeType(fileData?.type));
}

export function getMediaMetrics(draft) {
  const mainImage = draft?.media?.mainImage || null;
  const gallery = Array.isArray(draft?.media?.gallery) ? draft.media.gallery : [];
  const allAssets = getExistingMediaAssets(draft);
  const totalBytes = allAssets.reduce((sum, asset) => sum + Number(asset?.size || 0), 0);

  return {
    hasMainImage: Boolean(mainImage),
    galleryCount: gallery.length,
    totalImages: allAssets.length,
    totalBytes,
    remainingGallerySlots: Math.max(0, MEDIA_MAX_GALLERY_ITEMS - gallery.length),
    readyCount: allAssets.filter((asset) => asset?.status === "ready").length,
    localCount: allAssets.filter((asset) => asset?.source === "local").length
  };
}

export function validateMediaSelection(fileDataList, draft, target) {
  const currentAssets = getExistingMediaAssets(draft);
  const existingFingerprints = new Set(currentAssets.map(createAssetFingerprint));
  const existingGalleryCount = Array.isArray(draft?.media?.gallery) ? draft.media.gallery.length : 0;
  const selection = Array.isArray(fileDataList) ? fileDataList : [];
  const accepted = [];
  const issues = [];
  let remainingGallerySlots = Math.max(0, MEDIA_MAX_GALLERY_ITEMS - existingGalleryCount);

  selection.forEach((fileData, index) => {
    const fileName = toTrimmedString(fileData?.name || `Image ${index + 1}`) || `Image ${index + 1}`;

    if (!canAcceptType(fileData)) {
      issues.push(createMediaIssue("unsupported-type", fileName, `${fileName} uses an unsupported file format. Use JPG, PNG, WEBP, or GIF.`));
      return;
    }

    if (Number(fileData?.size || 0) <= 0) {
      issues.push(createMediaIssue("empty-file", fileName, `${fileName} appears to be empty and could not be staged.`));
      return;
    }

    if (Number(fileData?.size || 0) > MEDIA_MAX_FILE_SIZE_BYTES) {
      issues.push(createMediaIssue("file-too-large", fileName, `${fileName} is too large for the current media foundation. Keep files under 8 MB.`));
      return;
    }

    const draftAsset = decorateMediaAsset(createImageAsset(fileData), target, accepted.length + 1);
    if (existingFingerprints.has(draftAsset.fingerprint)) {
      issues.push(createMediaIssue("duplicate-image", fileName, `${fileName} is already staged in this product media set.`, "warning"));
      return;
    }

    if (target === "gallery" && remainingGallerySlots <= 0) {
      issues.push(createMediaIssue("gallery-limit", fileName, `Gallery capacity reached. Remove an existing image before staging ${fileName}.`, "warning"));
      return;
    }

    existingFingerprints.add(draftAsset.fingerprint);
    accepted.push(draftAsset);

    if (target === "gallery") {
      remainingGallerySlots -= 1;
    }
  });

  return {
    accepted,
    issues,
    attemptedCount: selection.length,
    acceptedCount: accepted.length,
    rejectedCount: issues.length,
    hasBlockingIssue: issues.some((issue) => issue.tone === "error"),
    hasAdvisoryIssue: issues.some((issue) => issue.tone === "warning")
  };
}

export function applyMediaSelection(draft, target, fileDataList) {
  const result = validateMediaSelection(fileDataList, draft, target);
  const nextDraft = result.accepted.length ? attachDraftImages(draft, target, result.accepted) : draft;

  return {
    draft: nextDraft,
    result,
    metrics: getMediaMetrics(nextDraft)
  };
}

export function removeMediaAsset(draft, target, imageId) {
  if (target === "main") {
    return clearMainImage(draft);
  }

  return removeGalleryImage(draft, imageId);
}

export function moveGalleryAsset(draft, imageId, direction) {
  const nextDraft = cloneDraft(draft);
  const gallery = Array.isArray(nextDraft?.media?.gallery) ? nextDraft.media.gallery.slice() : [];
  const index = gallery.findIndex((asset) => asset?.id === imageId);
  if (index < 0) {
    return nextDraft;
  }

  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= gallery.length) {
    return nextDraft;
  }

  const [asset] = gallery.splice(index, 1);
  gallery.splice(nextIndex, 0, asset);
  nextDraft.media.gallery = gallery.map((entry, orderIndex) => ({
    ...entry,
    orderIndex: orderIndex + 1,
    role: "gallery"
  }));
  return nextDraft;
}

export function promoteMediaAssetToMain(draft, imageId) {
  const nextDraft = promoteGalleryImage(draft, imageId);
  if (nextDraft?.media?.mainImage) {
    nextDraft.media.mainImage = {
      ...nextDraft.media.mainImage,
      role: "featured",
      orderIndex: 0,
      status: nextDraft.media.mainImage.status || "ready",
      source: nextDraft.media.mainImage.source || "local",
      fingerprint: nextDraft.media.mainImage.fingerprint || createAssetFingerprint(nextDraft.media.mainImage)
    };
  }
  nextDraft.media.gallery = (nextDraft.media.gallery || []).map((entry, orderIndex) => ({
    ...entry,
    role: "gallery",
    orderIndex: orderIndex + 1,
    fingerprint: entry.fingerprint || createAssetFingerprint(entry)
  }));
  return nextDraft;
}

export function buildMediaCompatibilitySummary(draft) {
  const metrics = getMediaMetrics(draft);
  const supportsGallery = metrics.galleryCount > 0;

  return {
    homeCardReady: metrics.hasMainImage,
    shopCardReady: metrics.hasMainImage,
    featuredReady: metrics.hasMainImage,
    detailReady: metrics.hasMainImage,
    galleryReady: supportsGallery,
    recommendationReady: metrics.hasMainImage,
    searchReady: metrics.hasMainImage
  };
}