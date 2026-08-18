import { isProductCardImageUrl, productImagesMatch } from "../../../../services/storefront-asset-url.js";
import { collectOriginalImagesForDisplay, hydrateDraftFromProduct, snapshotCanonicalMedia } from "./draft.js";
import { isPersistableAssetUrl, normalizeAssetUrl } from "./utils.js";

function imageStem(value) {
  const normalized = String(value || "").trim().replace(/\\/g, "/").split("?")[0].split("#")[0];
  if (!normalized || isProductCardImageUrl(normalized)) {
    return "";
  }
  const base = normalized.split("/").pop() || "";
  return base.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
}

export function collectCanonicalImageStems(source = {}) {
  const media = source.media && typeof source.media === "object" ? source.media : source;
  const values = [
    source.originalImage,
    source.mainImage,
    source.image,
    media.mainImage,
    ...(Array.isArray(source.gallery) ? source.gallery : []),
    ...(Array.isArray(media.gallery) ? media.gallery : [])
  ];
  const stems = [];
  const seen = new Set();
  values.forEach((entry) => {
    const stem = imageStem(entry);
    if (!stem || seen.has(stem)) {
      return;
    }
    seen.add(stem);
    stems.push(stem);
  });
  return stems;
}

export function expectedImageStemsFromSnapshot(snapshot = {}) {
  return collectCanonicalImageStems({
    mainImage: snapshot.mainImage,
    gallery: snapshot.gallery
  });
}

function sameCatalogId(left, right) {
  return Number(left) > 0 && Number(left) === Number(right);
}

function includesImage(actualUrls, expectedUrl) {
  const expected = normalizeAssetUrl(expectedUrl);
  if (!expected || !isPersistableAssetUrl(expected)) {
    return false;
  }
  return actualUrls.some((entry) => (
    productImagesMatch(entry, expected)
    || imageStem(entry) === imageStem(expected)
  ));
}

function collapseText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function visibleDescriptionText(source = {}) {
  const draft = hydrateDraftFromProduct(source);
  const description = draft?.description || {};
  const fromDraft = collapseText(
    description.longDescription
    || description.description
    || description.shortDescription
  );
  if (fromDraft) {
    return fromDraft;
  }

  const long = source.longDescription;
  const longText = Array.isArray(long)
    ? long.map((entry) => collapseText(entry)).filter(Boolean).join(" ")
    : collapseText(long);
  return collapseText(longText || source.description || source.shortDescription);
}

function descriptionsMatch(expected, actual) {
  if (!expected) {
    return true;
  }
  if (!actual) {
    return false;
  }
  if (actual === expected) {
    return true;
  }
  return actual.includes(expected.slice(0, 24)) || expected.includes(actual.slice(0, 24));
}

export function verifyReloadedProductUpdate({
  productId,
  beforeProduct,
  reloadedProduct,
  expectedPayload,
  preserveExistingImages,
  expectedMedia
} = {}) {
  const reloaded = reloadedProduct && typeof reloadedProduct === "object" ? reloadedProduct : null;
  if (!reloaded) {
    throw new Error("The updated product could not be reloaded after save.");
  }

  const reloadedId = String(reloaded.id || reloaded.catalogId || "").trim();
  if (!sameCatalogId(productId, reloadedId)) {
    throw new Error("Save did not update the original product. Reload and try again.");
  }

  if (expectedPayload && Number.isFinite(Number(expectedPayload.stock))) {
    if (Number(reloaded.stock) !== Number(expectedPayload.stock)) {
      throw new Error("The saved stock value could not be verified.");
    }
  }

  if (expectedPayload && Number.isFinite(Number(expectedPayload.price))) {
    if (Number(reloaded.price) !== Number(expectedPayload.price)) {
      throw new Error("The saved price value could not be verified.");
    }
  }

  if (expectedPayload && collapseText(expectedPayload.description)) {
    const expected = collapseText(expectedPayload.description);
    const saved = visibleDescriptionText(reloaded);
    if (!descriptionsMatch(expected, saved)) {
      throw new Error("The saved description could not be verified.");
    }
  }

  const reloadedDraft = hydrateDraftFromProduct(reloaded);
  const actualUrls = collectOriginalImagesForDisplay(reloadedDraft).map((entry) => entry.url);
  const actualStems = collectCanonicalImageStems(reloaded).concat(collectCanonicalImageStems(reloadedDraft));
  const uniqueActual = [...new Set(actualStems)];

  if (preserveExistingImages) {
    const expectedStems = expectedImageStemsFromSnapshot(expectedMedia || snapshotCanonicalMedia(hydrateDraftFromProduct(beforeProduct)));
    const missing = expectedStems.filter((stem) => !uniqueActual.includes(stem));
    if (missing.length) {
      throw new Error("Existing original images were missing after save. The update was not kept.");
    }
    if (actualUrls.some((entry) => isProductCardImageUrl(entry)) && !actualUrls.some((entry) => isPersistableAssetUrl(entry))) {
      throw new Error("The saved product only has card thumbnails. Original images must remain.");
    }
    return reloaded;
  }

  const expected = expectedMedia || {};
  const expectedUrls = [expected.mainImage, ...(Array.isArray(expected.gallery) ? expected.gallery : [])]
    .filter((entry) => isPersistableAssetUrl(entry));
  const missingUrls = expectedUrls.filter((entry) => !includesImage(actualUrls, entry));
  if (missingUrls.length) {
    throw new Error("The saved image set does not match the images that should have remained on this product.");
  }

  return reloaded;
}

export { imageStem };
