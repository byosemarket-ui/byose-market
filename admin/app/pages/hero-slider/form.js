import { HERO_BUCKET, removeStoredAssets, uploadWithRetry } from "../../../../services/uploadService.js";
import {
  HERO_IMAGE_ACCEPT,
  HERO_MAX_IMAGE_LABEL,
  buildSlideFormValues,
  escapeHtml,
  findDisplayOrderConflict,
  formatFileSize,
  getSlideId,
  isValidButtonLink,
  validateHeroImageFile
} from "./utils.js";

function closeModal() {
  const modal = document.getElementById("appModal");
  if (modal) {
    modal.hidden = true;
  }
}

function setFieldError(form, fieldName, message) {
  const errorNode = form.querySelector(`[data-hs-error="${fieldName}"]`);
  const field = form.querySelector(`[name="${fieldName}"]`);
  if (errorNode) {
    errorNode.textContent = message || "";
    errorNode.hidden = !message;
  }
  if (field) {
    field.classList.toggle("hs-field-invalid", Boolean(message));
  }
}

function clearFieldErrors(form) {
  form.querySelectorAll("[data-hs-error]").forEach((node) => {
    node.textContent = "";
    node.hidden = true;
  });
  form.querySelectorAll(".hs-field-invalid").forEach((node) => {
    node.classList.remove("hs-field-invalid");
  });
}

function setFormNote(form, message, tone = "warn") {
  const note = form.querySelector("[data-hs-form-note]");
  if (!note) {
    return;
  }

  note.hidden = !message;
  note.textContent = message || "";
  note.classList.remove("hs-form-note-error", "hs-form-note-success", "hs-form-note-warn");
  if (message) {
    note.classList.add(`hs-form-note-${tone === "error" ? "error" : tone === "success" ? "success" : "warn"}`);
  }
}

function setBusy(form, busy) {
  form.querySelectorAll("button").forEach((button) => {
    button.disabled = Boolean(busy);
  });
  form.classList.toggle("hs-form-busy", Boolean(busy));
}

function renderImagePanel(previewUrl, metaText) {
  if (!previewUrl) {
    return `
      <div class="hs-upload-empty" data-hs-upload-empty>
        <strong>No image selected</strong>
        <span>JPG, JPEG, PNG, or WEBP up to ${HERO_MAX_IMAGE_LABEL}.</span>
      </div>
    `;
  }

  return `
    <div class="hs-upload-preview" data-hs-upload-preview>
      <img src="${escapeHtml(previewUrl)}" alt="Hero slide preview" data-hs-preview-image />
      <p class="hs-upload-meta" data-hs-upload-meta>${escapeHtml(metaText || "Current hero image")}</p>
    </div>
  `;
}

export function renderHeroSlideFormMarkup(slide = null, mode = "create") {
  const isEdit = mode === "edit" && slide;
  const values = buildSlideFormValues(slide);

  return `
    <form class="hs-form" data-hs-form="${mode}" novalidate ${isEdit ? `data-slide-id="${escapeHtml(getSlideId(slide))}"` : ""}>
      <div class="hs-form-grid">
        <div class="hs-form-span hs-upload-block">
          <div class="hs-upload-head">
            <div>
              <strong>Hero Image Upload</strong>
              <p>Select an image, preview it, replace it, or remove it before saving.</p>
            </div>
            <div class="hs-upload-actions">
              <button type="button" class="pm-btn pm-btn-secondary pm-btn-sm" data-hs-image-pick>Choose Image</button>
              <button type="button" class="pm-btn pm-btn-ghost pm-btn-sm" data-hs-image-replace ${values.imageUrl ? "" : "hidden"}>Replace</button>
              <button type="button" class="pm-btn pm-btn-danger pm-btn-sm" data-hs-image-remove ${values.imageUrl ? "" : "hidden"}>Remove</button>
            </div>
          </div>
          <input type="file" name="imageFile" accept="${HERO_IMAGE_ACCEPT}" hidden data-hs-image-input />
          <div class="hs-upload-stage" data-hs-upload-stage>
            ${renderImagePanel(values.imageUrl, values.imageUrl ? "Current saved image" : "")}
          </div>
          <p class="hs-field-error" data-hs-error="imageFile" hidden></p>
        </div>

        <label>
          <span>Slide Title <em>*</em></span>
          <input class="input" name="title" maxlength="160" value="${escapeHtml(values.title)}" placeholder="Seasonal collection headline" autocomplete="off" />
          <p class="hs-field-error" data-hs-error="title" hidden></p>
        </label>

        <label>
          <span>Subtitle / Description</span>
          <textarea class="input" name="subtitle" rows="3" maxlength="400" placeholder="Supporting text shown on the homepage hero">${escapeHtml(values.subtitle)}</textarea>
          <p class="hs-field-error" data-hs-error="subtitle" hidden></p>
        </label>

        <label>
          <span>Button Text</span>
          <input class="input" name="buttonText" maxlength="80" value="${escapeHtml(values.buttonText)}" placeholder="Shop now" autocomplete="off" />
          <p class="hs-field-error" data-hs-error="buttonText" hidden></p>
        </label>

        <label>
          <span>Button Link</span>
          <input class="input" name="buttonLink" maxlength="300" value="${escapeHtml(values.buttonLink)}" placeholder="/shop.html or https://example.com" autocomplete="off" />
          <small class="hs-field-hint">Use an internal path (e.g. /shop.html) or a full https:// URL.</small>
          <p class="hs-field-error" data-hs-error="buttonLink" hidden></p>
        </label>

        <label>
          <span>Display Order</span>
          <input class="input" name="displayOrder" type="number" min="0" step="1" value="${escapeHtml(values.displayOrder)}" placeholder="Auto-assigned if empty" />
          <small class="hs-field-hint">Must be unique across hero slides.</small>
          <p class="hs-field-error" data-hs-error="displayOrder" hidden></p>
        </label>

        <label>
          <span>Status</span>
          <select class="input" name="status">
            <option value="active"${values.status === "active" ? " selected" : ""}>Active</option>
            <option value="inactive"${values.status === "inactive" ? " selected" : ""}>Inactive</option>
          </select>
          <p class="hs-field-error" data-hs-error="status" hidden></p>
        </label>
      </div>

      <div class="hs-form-actions">
        <button type="button" class="pm-btn pm-btn-ghost" data-hs-form-cancel>Cancel</button>
        <button type="button" class="pm-btn pm-btn-secondary" data-hs-form-reset>Reset Form</button>
        <button type="submit" class="pm-btn pm-btn-secondary" data-hs-save-mode="continue">Save &amp; Continue Editing</button>
        <button type="submit" class="pm-btn pm-btn-primary" data-hs-save-mode="close">Save</button>
      </div>
      <p class="hs-form-note" data-hs-form-note hidden></p>
    </form>
  `;
}

async function uploadSlideImage(file) {
  const uploaded = await uploadWithRetry(file, {
    bucket: HERO_BUCKET,
    // Do not cleanup previous images here — only after DB save succeeds.
    cleanupPaths: [],
    progressLabel: "Uploading hero slide image..."
  });

  return {
    imageUrl: uploaded.publicUrl || uploaded.url || "",
    imagePath: uploaded.storagePath || uploaded.path || ""
  };
}

function readFormFields(form) {
  const formData = new FormData(form);
  const displayOrderRaw = String(formData.get("displayOrder") || "").trim();
  const payload = {
    title: String(formData.get("title") || "").trim(),
    subtitle: String(formData.get("subtitle") || "").trim(),
    buttonText: String(formData.get("buttonText") || "").trim(),
    buttonLink: String(formData.get("buttonLink") || "").trim(),
    status: String(formData.get("status") || "active").trim().toLowerCase() === "inactive" ? "inactive" : "active"
  };

  if (displayOrderRaw !== "") {
    payload.displayOrder = Number(displayOrderRaw);
  }

  return payload;
}

function validateForm(form, imageState, options = {}) {
  clearFieldErrors(form);
  const payload = readFormFields(form);
  const mode = form.getAttribute("data-hs-form");
  const slideId = form.getAttribute("data-slide-id") || "";
  const errors = {};

  if (!payload.title) {
    errors.title = "Slide title is required.";
  }

  if (payload.buttonText && !payload.buttonLink) {
    errors.buttonLink = "Add a button link when button text is set.";
  }

  if (payload.buttonLink && !payload.buttonText) {
    errors.buttonText = "Add button text when a button link is set.";
  }

  if (payload.buttonLink && !isValidButtonLink(payload.buttonLink)) {
    errors.buttonLink = "Enter a valid internal path or http(s) URL.";
  }

  if (Object.prototype.hasOwnProperty.call(payload, "displayOrder")) {
    if (!Number.isFinite(payload.displayOrder) || payload.displayOrder < 0 || !Number.isInteger(payload.displayOrder)) {
      errors.displayOrder = "Display order must be a whole number of 0 or greater.";
    } else {
      const conflict = findDisplayOrderConflict(options.existingSlides || [], payload.displayOrder, slideId);
      if (conflict) {
        errors.displayOrder = `Display order ${payload.displayOrder} is already used by "${conflict.title || getSlideId(conflict)}".`;
      }
    }
  }

  const hasExistingImage = Boolean(imageState.existingImageUrl) && !imageState.removedExisting;
  const hasPendingImage = Boolean(imageState.pendingFile);

  if (mode === "create" && !hasPendingImage) {
    errors.imageFile = "Please choose a hero image before saving.";
  }

  if (mode === "edit" && !hasExistingImage && !hasPendingImage) {
    errors.imageFile = "A hero image is required. Choose a replacement image or reset the form.";
  }

  if (imageState.pendingFile) {
    const imageError = validateHeroImageFile(imageState.pendingFile);
    if (imageError) {
      errors.imageFile = imageError;
    }
  }

  Object.entries(errors).forEach(([field, message]) => setFieldError(form, field, message));
  return {
    valid: Object.keys(errors).length === 0,
    payload,
    errors
  };
}

export function mountHeroSlideForm(form, options = {}) {
  if (!form) {
    return () => {};
  }

  const mode = form.getAttribute("data-hs-form") || "create";
  const initialSlide = options.slide || null;
  const initialValues = buildSlideFormValues(initialSlide);
  let saveMode = "close";
  let objectUrl = "";

  const imageState = {
    existingImageUrl: initialValues.imageUrl,
    existingImagePath: initialValues.imagePath,
    pendingFile: null,
    removedExisting: false
  };

  const imageInput = form.querySelector("[data-hs-image-input]");
  const uploadStage = form.querySelector("[data-hs-upload-stage]");
  const pickButton = form.querySelector("[data-hs-image-pick]");
  const replaceButton = form.querySelector("[data-hs-image-replace]");
  const removeButton = form.querySelector("[data-hs-image-remove]");

  function revokeObjectUrl() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = "";
    }
  }

  function currentPreviewUrl() {
    if (imageState.pendingFile) {
      return objectUrl;
    }
    if (imageState.removedExisting) {
      return "";
    }
    return imageState.existingImageUrl || "";
  }

  function currentMetaText() {
    if (imageState.pendingFile) {
      return `${imageState.pendingFile.name} · ${formatFileSize(imageState.pendingFile.size)} (not saved yet)`;
    }
    if (imageState.existingImageUrl && !imageState.removedExisting) {
      return "Current saved image";
    }
    return "";
  }

  function syncImageUi() {
    const previewUrl = currentPreviewUrl();
    uploadStage.innerHTML = renderImagePanel(previewUrl, currentMetaText());
    const hasImage = Boolean(previewUrl);
    if (replaceButton) replaceButton.hidden = !hasImage;
    if (removeButton) removeButton.hidden = !hasImage;
    if (pickButton) pickButton.textContent = hasImage ? "Choose Another" : "Choose Image";
  }

  function applyImageFile(file) {
    const validationError = validateHeroImageFile(file);
    if (validationError) {
      setFieldError(form, "imageFile", validationError);
      setFormNote(form, validationError, "error");
      if (imageInput) imageInput.value = "";
      return;
    }

    revokeObjectUrl();
    imageState.pendingFile = file;
    imageState.removedExisting = false;
    objectUrl = URL.createObjectURL(file);
    setFieldError(form, "imageFile", "");
    setFormNote(form, "");
    syncImageUi();
  }

  function removeSelectedImage() {
    revokeObjectUrl();
    imageState.pendingFile = null;
    if (imageState.existingImageUrl) {
      imageState.removedExisting = true;
    }
    if (imageInput) imageInput.value = "";
    setFieldError(form, "imageFile", "");
    setFormNote(form, "Image removed. Choose a new image before saving.", "warn");
    syncImageUi();
  }

  function resetForm() {
    clearFieldErrors(form);
    setFormNote(form, "");
    form.querySelector('[name="title"]').value = initialValues.title;
    form.querySelector('[name="subtitle"]').value = initialValues.subtitle;
    form.querySelector('[name="buttonText"]').value = initialValues.buttonText;
    form.querySelector('[name="buttonLink"]').value = initialValues.buttonLink;
    form.querySelector('[name="displayOrder"]').value = initialValues.displayOrder === "" ? "" : String(initialValues.displayOrder);
    form.querySelector('[name="status"]').value = initialValues.status;
    revokeObjectUrl();
    imageState.existingImageUrl = initialValues.imageUrl;
    imageState.existingImagePath = initialValues.imagePath;
    imageState.pendingFile = null;
    imageState.removedExisting = false;
    if (imageInput) imageInput.value = "";
    syncImageUi();
    setFormNote(form, "Form reset to the original values.", "warn");
  }

  function fillFormFromSlide(slide) {
    const values = buildSlideFormValues(slide);
    form.setAttribute("data-hs-form", "edit");
    form.setAttribute("data-slide-id", getSlideId(slide));
    form.querySelector('[name="title"]').value = values.title;
    form.querySelector('[name="subtitle"]').value = values.subtitle;
    form.querySelector('[name="buttonText"]').value = values.buttonText;
    form.querySelector('[name="buttonLink"]').value = values.buttonLink;
    form.querySelector('[name="displayOrder"]').value = values.displayOrder === "" ? "" : String(values.displayOrder);
    form.querySelector('[name="status"]').value = values.status;
    revokeObjectUrl();
    imageState.existingImageUrl = values.imageUrl;
    imageState.existingImagePath = values.imagePath;
    imageState.pendingFile = null;
    imageState.removedExisting = false;
    if (imageInput) imageInput.value = "";
    Object.assign(initialValues, values);
    syncImageUi();
  }

  pickButton?.addEventListener("click", () => imageInput?.click());
  replaceButton?.addEventListener("click", () => imageInput?.click());
  removeButton?.addEventListener("click", () => removeSelectedImage());

  imageInput?.addEventListener("change", () => {
    const file = imageInput.files?.[0] || null;
    if (!file) {
      return;
    }
    applyImageFile(file);
  });

  form.querySelector("[data-hs-form-cancel]")?.addEventListener("click", () => {
    if (typeof options.onCancel === "function") {
      options.onCancel();
    } else {
      closeModal();
    }
  });

  form.querySelector("[data-hs-form-reset]")?.addEventListener("click", () => {
    resetForm();
  });

  form.querySelectorAll("[data-hs-save-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      saveMode = button.getAttribute("data-hs-save-mode") || "close";
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const existingSlides = typeof options.getExistingSlides === "function"
      ? options.getExistingSlides()
      : (options.existingSlides || []);

    const validation = validateForm(form, imageState, { existingSlides });
    if (!validation.valid) {
      setFormNote(form, "Please fix the highlighted fields before saving.", "error");
      return;
    }

    const payload = { ...validation.payload };
    const slideId = form.getAttribute("data-slide-id") || "";
    const continueEditing = saveMode === "continue";
    let uploadedImagePath = "";

    try {
      setBusy(form, true);
      setFormNote(form, imageState.pendingFile ? "Uploading image and saving slide..." : "Saving slide...", "warn");

      if (imageState.pendingFile) {
        const media = await uploadSlideImage(imageState.pendingFile);
        payload.imageUrl = media.imageUrl;
        payload.imagePath = media.imagePath;
        uploadedImagePath = media.imagePath || "";
      }

      let savedSlide = null;
      const currentMode = form.getAttribute("data-hs-form") || mode;
      const activeSlideId = form.getAttribute("data-slide-id") || slideId;

      if (currentMode === "edit" && activeSlideId) {
        savedSlide = await options.onUpdate(activeSlideId, payload);
      } else {
        savedSlide = await options.onCreate(payload);
      }

      if (typeof options.onSuccess === "function") {
        await options.onSuccess(savedSlide, {
          continueEditing,
          mode: currentMode === "edit" || activeSlideId ? "edit" : "create"
        });
      }

      if (continueEditing) {
        fillFormFromSlide(savedSlide || { ...payload, id: activeSlideId, slideId: activeSlideId });
        const titleNode = document.getElementById("appModalTitle");
        if (titleNode) {
          titleNode.textContent = "Edit Hero Slide";
        }
        setFormNote(form, "Slide saved. You can continue editing.", "success");
        setBusy(form, false);
        return;
      }

      revokeObjectUrl();
      closeModal();
    } catch (error) {
      if (uploadedImagePath) {
        await removeStoredAssets([uploadedImagePath]);
      }
      const message = error?.message || "Unable to save the slide.";
      setFormNote(form, message, "error");
      if (typeof options.onError === "function") {
        options.onError(error);
      }
      setBusy(form, false);
    }
  });

  syncImageUi();

  return () => {
    revokeObjectUrl();
  };
}
