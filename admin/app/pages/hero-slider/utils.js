import { MAX_IMAGE_FILE_SIZE_BYTES } from "../products/utils.js";

export const HERO_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const HERO_IMAGE_ACCEPT = "image/jpeg,image/jpg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
export const HERO_MAX_IMAGE_LABEL = "5 MB";

export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function getSlideId(slide) {
  return String(slide?.id || slide?.slideId || "").trim();
}

export function resolveImageUrl(slide) {
  const imageUrl = String(slide?.imageUrl || "").trim();
  if (imageUrl) {
    return imageUrl;
  }

  const imagePath = String(slide?.imagePath || "").trim();
  if (!imagePath) {
    return "";
  }

  if (/^https?:\/\//i.test(imagePath) || imagePath.startsWith("/")) {
    return imagePath;
  }

  return `/uploads/${imagePath.replace(/^\/+/, "")}`;
}

export function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function validateHeroImageFile(file) {
  if (!file) {
    return "No image file selected.";
  }

  const mimeType = String(file.type || "").trim().toLowerCase();
  const fileName = String(file.name || "").trim().toLowerCase();
  const hasAllowedExtension = /\.(jpe?g|png|webp)$/i.test(fileName);

  if (!HERO_IMAGE_MIME_TYPES.includes(mimeType) && !hasAllowedExtension) {
    return "Only JPG, JPEG, PNG, and WEBP images are allowed.";
  }

  if (Number(file.size || 0) > MAX_IMAGE_FILE_SIZE_BYTES) {
    return `Each image must be ${HERO_MAX_IMAGE_LABEL} or smaller.`;
  }

  return "";
}

export function isValidButtonLink(value) {
  const link = String(value || "").trim();
  if (!link) {
    return true;
  }

  if (/^(javascript|data|vbscript):/i.test(link)) {
    return false;
  }

  if (/^https?:\/\//i.test(link)) {
    try {
      const parsed = new URL(link);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (_error) {
      return false;
    }
  }

  if (link.startsWith("/") || link.startsWith("./") || link.startsWith("../")) {
    return true;
  }

  if (/^[a-z0-9][a-z0-9._\-/?&=#]*$/i.test(link)) {
    return true;
  }

  return false;
}

export function findDisplayOrderConflict(slides, displayOrder, excludeSlideId = "") {
  if (!Number.isFinite(displayOrder)) {
    return null;
  }

  const excluded = String(excludeSlideId || "").trim();
  return (Array.isArray(slides) ? slides : []).find((slide) => {
    const id = getSlideId(slide);
    if (excluded && id === excluded) {
      return false;
    }
    return Number(slide.displayOrder) === Number(displayOrder);
  }) || null;
}

export function buildSlideFormValues(slide = null) {
  return {
    title: slide?.title || "",
    subtitle: slide?.subtitle || "",
    buttonText: slide?.buttonText || "",
    buttonLink: slide?.buttonLink || "",
    displayOrder: slide?.displayOrder ?? "",
    status: String(slide?.status || "active").toLowerCase() === "inactive" ? "inactive" : "active",
    imageUrl: resolveImageUrl(slide || {}),
    imagePath: String(slide?.imagePath || "").trim()
  };
}
