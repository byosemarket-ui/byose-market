import { emptyState, escapeHtml, panel } from "../components/ui.js";
import {
  getAdminBranding,
  removeAdminBrandingAsset,
  setAdminBrandingAsset,
  updateAdminBranding
} from "../services/admin-data.service.js";
import { BRANDING_BUCKET, uploadWithRetry } from "../../../services/uploadService.js";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const COMPRESSED_QUALITY = 0.86;

const LOGO_FIELDS = [
  ["mainLogo", "Main Logo", "Primary storefront logo"],
  ["whiteLogo", "White Logo", "For dark backgrounds"],
  ["darkLogo", "Dark Logo", "For light backgrounds"],
  ["footerLogo", "Footer Logo", "Footer and compact surfaces"],
  ["mobileLogo", "Mobile Logo", "Mobile header / compact mark"],
  ["adminLogo", "Admin Dashboard Logo", "Admin sidebar brand mark"],
  ["loginLogo", "Login Page Logo", "Admin and customer login"],
  ["emailLogo", "Email Logo", "Transactional email header"]
];

const ICON_FIELDS = [
  ["favicon", "Website Favicon", "Browser tab favicon"],
  ["pwaIcon", "PWA Icon", "Progressive web app icon"],
  ["appleTouchIcon", "Apple Touch Icon", "iOS home screen icon"],
  ["androidIcon", "Android Icon", "Android launcher icon"],
  ["browserTabIcon", "Browser Tab Icon", "Alternate tab icon"]
];

const ASSET_FIELDS = [
  ["placeholderImage", "Default Placeholder Image", "Generic media placeholder"],
  ["defaultProductImage", "Default Product Image", "Fallback product image"],
  ["defaultCategoryImage", "Default Category Image", "Fallback category image"],
  ["defaultAvatar", "Default Avatar", "Fallback user avatar"],
  ["emailBanner", "Email Banner", "Email campaign / notice banner"],
  ["loadingLogo", "Loading Logo", "Loading state brand mark"],
  ["loadingAnimation", "Loading Animation", "Optional animated loader asset"]
];

const COLOR_FIELDS = [
  ["primary", "Primary Color"],
  ["secondary", "Secondary Color"],
  ["accent", "Accent Color"],
  ["success", "Success Color"],
  ["warning", "Warning Color"],
  ["error", "Error Color"],
  ["text", "Text Color"],
  ["textMuted", "Muted Text Color"],
  ["background", "Background Color"],
  ["backgroundAlt", "Alt Background Color"]
];

function attr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function assetUrl(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  return String(entry.url || entry.path || "");
}

function assetPath(entry) {
  if (!entry) return "";
  if (typeof entry === "string") {
    return entry.split("?")[0];
  }
  return String(entry.path || "").split("?")[0];
}

function sectionCard(title, subtitle, body, wide = false) {
  return `
    <section class="admin-profile-card${wide ? " admin-profile-card-wide" : ""}">
      <header class="admin-profile-card-header">
        <div>
          <h4>${escapeHtml(title)}</h4>
          <p>${escapeHtml(subtitle)}</p>
        </div>
      </header>
      ${body}
    </section>
  `;
}

function previewImage(url, label) {
  if (!url) {
    return `<div class="admin-branding-preview-empty">${escapeHtml(label)}</div>`;
  }
  return `<img src="${attr(url)}" alt="${attr(label)}" loading="lazy" />`;
}

function assetCard(group, key, label, help, branding) {
  const entry = branding?.[group]?.[key];
  const url = assetUrl(entry);
  return `
    <article class="admin-branding-asset" data-asset-group="${attr(group)}" data-asset-key="${attr(key)}">
      <div class="admin-branding-asset-preview" data-asset-preview>
        ${previewImage(url, label)}
      </div>
      <div class="admin-branding-asset-copy">
        <strong>${escapeHtml(label)}</strong>
        <p>${escapeHtml(help)}</p>
        <div class="admin-branding-asset-actions">
          <label class="btn btn-ghost admin-branding-upload-label">
            ${url ? "Replace" : "Upload"}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden data-branding-upload />
          </label>
          <button class="btn btn-ghost" type="button" data-branding-crop ${url ? "" : "disabled"}>Crop</button>
          <button class="btn btn-ghost" type="button" data-branding-remove ${url ? "" : "disabled"}>Remove</button>
        </div>
        <small class="field-error" data-error-for="${attr(key)}"></small>
        <p class="admin-branding-asset-status" data-asset-status></p>
      </div>
    </article>
  `;
}

function colorField(key, label, value) {
  const color = String(value || "#00B894");
  return `
    <label class="admin-branding-color-field">
      <span>${escapeHtml(label)}</span>
      <div class="admin-branding-color-controls">
        <input type="color" name="color_${attr(key)}" value="${attr(color)}" data-color-key="${attr(key)}" />
        <input type="text" name="color_text_${attr(key)}" value="${attr(color)}" maxlength="9" data-color-text="${attr(key)}" />
      </div>
      <small class="field-error" data-error-for="colors.${attr(key)}"></small>
    </label>
  `;
}

function brandingMarkup(branding) {
  const colors = branding?.colors || {};
  const identity = branding?.identity || {};
  const mainLogo = assetUrl(branding?.logos?.mainLogo) || assetUrl(branding?.logos?.adminLogo);
  const darkLogo = assetUrl(branding?.logos?.darkLogo) || mainLogo;
  const whiteLogo = assetUrl(branding?.logos?.whiteLogo) || mainLogo;
  const mobileLogo = assetUrl(branding?.logos?.mobileLogo) || mainLogo;

  return `
    <div class="admin-profile-page admin-branding-page" id="adminBrandingPage">
      <section class="admin-profile-hero">
        <div class="admin-profile-hero-main">
          <div class="admin-profile-hero-copy">
            <p class="admin-profile-kicker">Brand management</p>
            <h3>Branding</h3>
            <p class="admin-profile-username">Logos, icons, colors, and identity for website and admin</p>
            <div class="admin-profile-chip-row">
              <span class="admin-profile-chip">v${escapeHtml(branding?.version || 1)}</span>
              <span class="admin-profile-chip" style="background:${attr(colors.primary || "#00B894")};color:#fff;border-color:transparent;">Primary</span>
              <span class="admin-profile-chip" style="background:${attr(colors.accent || "#00CEC9")};color:#083;border-color:transparent;">Accent</span>
            </div>
          </div>
        </div>
      </section>

      <div class="admin-profile-grid">
        ${sectionCard(
          "Live Preview",
          "Preview updates as you edit colors and logos. Save to publish.",
          `
            <div class="admin-branding-preview-grid" id="brandingLivePreview">
              <article class="admin-branding-preview-card" data-preview="logo">
                <header>Logo</header>
                <div class="admin-branding-preview-stage is-light" data-preview-logo>${previewImage(mainLogo, "Logo")}</div>
              </article>
              <article class="admin-branding-preview-card" data-preview="light">
                <header>Light Theme</header>
                <div class="admin-branding-preview-stage is-light" style="--preview-primary:${attr(colors.primary)};--preview-accent:${attr(colors.accent)};--preview-bg:${attr(colors.background)};--preview-text:${attr(colors.text)};">
                  <div class="admin-branding-preview-chrome">
                    ${previewImage(darkLogo || mainLogo, "Light logo")}
                    <strong data-preview-slogan>${escapeHtml(identity.slogan || "Shop smart. Shop BYOSE.")}</strong>
                  </div>
                  <button type="button" class="admin-branding-preview-cta">Shop now</button>
                </div>
              </article>
              <article class="admin-branding-preview-card" data-preview="dark">
                <header>Dark Theme</header>
                <div class="admin-branding-preview-stage is-dark" style="--preview-primary:${attr(colors.primary)};--preview-accent:${attr(colors.accent)};">
                  <div class="admin-branding-preview-chrome">
                    ${previewImage(whiteLogo || mainLogo, "Dark logo")}
                    <strong data-preview-tagline>${escapeHtml(identity.tagline || "")}</strong>
                  </div>
                  <button type="button" class="admin-branding-preview-cta">Explore</button>
                </div>
              </article>
              <article class="admin-branding-preview-card" data-preview="mobile">
                <header>Mobile</header>
                <div class="admin-branding-preview-stage is-mobile" style="--preview-primary:${attr(colors.primary)};--preview-bg:${attr(colors.backgroundAlt)};">
                  ${previewImage(mobileLogo || mainLogo, "Mobile logo")}
                  <p data-preview-desc>${escapeHtml((identity.brandDescription || "").slice(0, 90))}</p>
                </div>
              </article>
              <article class="admin-branding-preview-card" data-preview="desktop">
                <header>Desktop</header>
                <div class="admin-branding-preview-stage is-desktop" style="--preview-primary:${attr(colors.primary)};--preview-bg:${attr(colors.background)};--preview-text:${attr(colors.text)};">
                  <div class="admin-branding-preview-desktop-bar">
                    ${previewImage(mainLogo, "Desktop logo")}
                    <span>Home</span><span>Shop</span><span>Contact</span>
                  </div>
                  <p data-preview-copyright>${escapeHtml(identity.footerCopyright || identity.copyrightText || "")}</p>
                </div>
              </article>
            </div>
          `,
          true
        )}

        ${sectionCard(
          "Company Logos",
          "Upload, replace, crop, or remove each logo. Images are optimized automatically.",
          `<div class="admin-branding-asset-grid">${LOGO_FIELDS.map(([key, label, help]) => assetCard("logos", key, label, help, branding)).join("")}</div>`,
          true
        )}

        ${sectionCard(
          "Favicon & Application Icons",
          "Browser and device icons used across the public website.",
          `<div class="admin-branding-asset-grid">${ICON_FIELDS.map(([key, label, help]) => assetCard("icons", key, label, help, branding)).join("")}</div>`,
          true
        )}

        ${sectionCard(
          "Brand Colors",
          "Theme colors with live preview. Changes publish after save.",
          `<div class="admin-branding-color-grid" id="brandingColorGrid">${COLOR_FIELDS.map(([key, label]) => colorField(key, label, colors[key])).join("")}</div>`,
          true
        )}

        ${sectionCard(
          "Brand Assets",
          "Fallback and supporting creative assets.",
          `<div class="admin-branding-asset-grid">${ASSET_FIELDS.map(([key, label, help]) => assetCard("assets", key, label, help, branding)).join("")}</div>`,
          true
        )}

        ${sectionCard(
          "Brand Identity",
          "Copy and legal identity used across footers and communications.",
          `
            <form class="settings-form admin-branding-identity-form" id="adminBrandingIdentityForm" novalidate>
              <label>
                <span>Company Tagline</span>
                <input name="tagline" type="text" maxlength="160" required value="${attr(identity.tagline || "")}" />
                <small class="field-error" data-error-for="tagline"></small>
              </label>
              <label>
                <span>Company Slogan</span>
                <input name="slogan" type="text" maxlength="160" value="${attr(identity.slogan || "")}" />
              </label>
              <label class="admin-branding-span-2">
                <span>Brand Description</span>
                <textarea name="brandDescription" rows="3" maxlength="600">${escapeHtml(identity.brandDescription || "")}</textarea>
              </label>
              <label>
                <span>Copyright Text</span>
                <input name="copyrightText" type="text" maxlength="200" value="${attr(identity.copyrightText || "")}" />
              </label>
              <label>
                <span>Footer Copyright</span>
                <input name="footerCopyright" type="text" maxlength="200" value="${attr(identity.footerCopyright || "")}" />
              </label>
              <label>
                <span>Business Registration Number</span>
                <input name="businessRegistrationNumber" type="text" maxlength="80" value="${attr(identity.businessRegistrationNumber || "")}" />
              </label>
              <label>
                <span>VAT Number</span>
                <input name="vatNumber" type="text" maxlength="80" value="${attr(identity.vatNumber || "")}" />
              </label>
            </form>
          `,
          true
        )}
      </div>

      <div class="admin-profile-form-actions admin-branding-actions">
        <button class="btn btn-primary" type="button" id="adminBrandingSaveBtn">Save Branding</button>
        <button class="btn btn-ghost" type="button" id="adminBrandingReloadBtn">Reload</button>
        <p id="adminBrandingFeedback" class="form-feedback" role="status"></p>
      </div>

      <dialog class="admin-branding-crop-dialog" id="adminBrandingCropDialog">
        <form method="dialog" class="admin-branding-crop-panel">
          <header>
            <h4>Crop image</h4>
            <p>Adjust the crop region, then apply. The result is optimized before upload.</p>
          </header>
          <div class="admin-branding-crop-stage">
            <canvas id="adminBrandingCropCanvas" width="480" height="480"></canvas>
          </div>
          <label>
            <span>Zoom</span>
            <input type="range" id="adminBrandingCropZoom" min="1" max="3" step="0.01" value="1" />
          </label>
          <label>
            <span>Aspect</span>
            <select id="adminBrandingCropAspect">
              <option value="1">1:1 Square</option>
              <option value="1.777">16:9 Wide</option>
              <option value="0.8">4:5 Portrait</option>
              <option value="0">Free</option>
            </select>
          </label>
          <div class="admin-branding-crop-actions">
            <button class="btn btn-ghost" type="button" id="adminBrandingCropCancel" value="cancel">Cancel</button>
            <button class="btn btn-primary" type="button" id="adminBrandingCropApply">Apply Crop</button>
          </div>
        </form>
      </dialog>
    </div>
  `;
}

function collectColors(root) {
  const colors = {};
  COLOR_FIELDS.forEach(([key]) => {
    const textInput = root.querySelector(`[data-color-text="${key}"]`);
    const colorInput = root.querySelector(`[data-color-key="${key}"]`);
    colors[key] = String(textInput?.value || colorInput?.value || "").trim().toUpperCase();
  });
  return colors;
}

function collectIdentity(form) {
  if (!form) return {};
  const data = new FormData(form);
  return {
    tagline: String(data.get("tagline") || "").trim(),
    slogan: String(data.get("slogan") || "").trim(),
    brandDescription: String(data.get("brandDescription") || "").trim(),
    copyrightText: String(data.get("copyrightText") || "").trim(),
    footerCopyright: String(data.get("footerCopyright") || "").trim(),
    businessRegistrationNumber: String(data.get("businessRegistrationNumber") || "").trim(),
    vatNumber: String(data.get("vatNumber") || "").trim()
  };
}

function pathMapFromBranding(group) {
  const result = {};
  Object.entries(group || {}).forEach(([key, value]) => {
    result[key] = assetPath(value);
  });
  return result;
}

async function loadImageFromFile(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Unable to read the selected image."));
      img.src = objectUrl;
    });
    return { image, objectUrl };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function optimizeImageFile(file, {
  maxEdge = 1600,
  aspect = 0,
  zoom = 1,
  crop = null
} = {}) {
  if (!file || !ALLOWED_TYPES.has(String(file.type || "").toLowerCase())) {
    throw new Error("Use a JPG, PNG, WEBP, GIF, or AVIF image up to 5 MB.");
  }
  if (Number(file.size || 0) > MAX_BYTES) {
    throw new Error("Image must be 5 MB or smaller.");
  }

  const { image, objectUrl } = await loadImageFromFile(file);
  try {
    const sourceWidth = image.width || 1;
    const sourceHeight = image.height || 1;
    let sx = 0;
    let sy = 0;
    let sw = sourceWidth;
    let sh = sourceHeight;

    if (crop) {
      sx = Math.max(0, crop.sx);
      sy = Math.max(0, crop.sy);
      sw = Math.max(1, crop.sw);
      sh = Math.max(1, crop.sh);
    } else if (aspect > 0) {
      const current = sourceWidth / sourceHeight;
      if (current > aspect) {
        sw = Math.round(sourceHeight * aspect);
        sx = Math.round((sourceWidth - sw) / 2);
      } else if (current < aspect) {
        sh = Math.round(sourceWidth / aspect);
        sy = Math.round((sourceHeight - sh) / 2);
      }
    }

    const zoomFactor = Math.max(1, Number(zoom) || 1);
    if (zoomFactor > 1) {
      const zw = Math.round(sw / zoomFactor);
      const zh = Math.round(sh / zoomFactor);
      sx += Math.round((sw - zw) / 2);
      sy += Math.round((sh - zh) / 2);
      sw = zw;
      sh = zh;
    }

    const scale = Math.min(1, maxEdge / Math.max(sw, sh));
    const width = Math.max(1, Math.round(sw * scale));
    const height = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      return file;
    }
    context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);

    const preferPng = String(file.type || "").includes("png") || String(file.type || "").includes("webp");
    const mime = preferPng ? "image/png" : "image/jpeg";
    const blob = await new Promise((resolve) => {
      canvas.toBlob((result) => resolve(result), mime, COMPRESSED_QUALITY);
    });
    if (!blob) return file;

    const extension = mime === "image/png" ? "png" : "jpg";
    return new File(
      [blob],
      `${String(file.name || "brand").replace(/\.[^.]+$/, "") || "brand"}.${extension}`,
      { type: mime, lastModified: Date.now() }
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function updateLivePreview(root, brandingDraft) {
  const colors = brandingDraft.colors || {};
  const identity = brandingDraft.identity || {};
  const logos = brandingDraft.logos || {};
  const main = assetUrl(logos.mainLogo) || assetUrl(logos.adminLogo);
  const dark = assetUrl(logos.darkLogo) || main;
  const white = assetUrl(logos.whiteLogo) || main;
  const mobile = assetUrl(logos.mobileLogo) || main;

  root.querySelectorAll("[data-preview-slogan]").forEach((node) => {
    node.textContent = identity.slogan || "";
  });
  root.querySelectorAll("[data-preview-tagline]").forEach((node) => {
    node.textContent = identity.tagline || "";
  });
  root.querySelectorAll("[data-preview-desc]").forEach((node) => {
    node.textContent = String(identity.brandDescription || "").slice(0, 90);
  });
  root.querySelectorAll("[data-preview-copyright]").forEach((node) => {
    node.textContent = identity.footerCopyright || identity.copyrightText || "";
  });

  const stages = [
    [".admin-branding-preview-stage.is-light", dark || main],
    [".admin-branding-preview-stage.is-dark", white || main],
    [".admin-branding-preview-stage.is-mobile", mobile || main],
    [".admin-branding-preview-stage.is-desktop img, [data-preview-logo] img, [data-preview-logo]", main]
  ];

  root.querySelectorAll("[data-preview-logo]").forEach((node) => {
    node.innerHTML = previewImage(main, "Logo");
  });
  root.querySelectorAll(".admin-branding-preview-stage.is-light .admin-branding-preview-chrome").forEach((node) => {
    const imgHost = node.querySelector("img, .admin-branding-preview-empty");
    if (imgHost) {
      node.innerHTML = `${previewImage(dark || main, "Light logo")}<strong data-preview-slogan>${escapeHtml(identity.slogan || "")}</strong>`;
    }
  });
  root.querySelectorAll(".admin-branding-preview-stage.is-dark .admin-branding-preview-chrome").forEach((node) => {
    node.innerHTML = `${previewImage(white || main, "Dark logo")}<strong data-preview-tagline>${escapeHtml(identity.tagline || "")}</strong>`;
  });
  root.querySelectorAll(".admin-branding-preview-stage.is-mobile").forEach((node) => {
    node.innerHTML = `${previewImage(mobile || main, "Mobile logo")}<p data-preview-desc>${escapeHtml(String(identity.brandDescription || "").slice(0, 90))}</p>`;
  });
  root.querySelectorAll(".admin-branding-preview-desktop-bar").forEach((node) => {
    node.innerHTML = `${previewImage(main, "Desktop logo")}<span>Home</span><span>Shop</span><span>Contact</span>`;
  });

  root.querySelectorAll(".admin-branding-preview-stage").forEach((stage) => {
    stage.style.setProperty("--preview-primary", colors.primary || "#00B894");
    stage.style.setProperty("--preview-accent", colors.accent || "#00CEC9");
    stage.style.setProperty("--preview-bg", colors.background || "#FFFFFF");
    stage.style.setProperty("--preview-text", colors.text || "#1F2A37");
  });

  void stages;
}

function bindBrandingPanel(container, initialBranding) {
  let brandingState = initialBranding;
  const feedback = container.querySelector("#adminBrandingFeedback");
  const saveBtn = container.querySelector("#adminBrandingSaveBtn");
  const reloadBtn = container.querySelector("#adminBrandingReloadBtn");
  const identityForm = container.querySelector("#adminBrandingIdentityForm");
  const cropDialog = container.querySelector("#adminBrandingCropDialog");
  const cropCanvas = container.querySelector("#adminBrandingCropCanvas");
  const cropZoom = container.querySelector("#adminBrandingCropZoom");
  const cropAspect = container.querySelector("#adminBrandingCropAspect");
  let cropContext = null;

  function draftFromDom() {
    return {
      ...brandingState,
      colors: collectColors(container),
      identity: collectIdentity(identityForm),
      logos: brandingState.logos,
      icons: brandingState.icons,
      assets: brandingState.assets
    };
  }

  function refreshPreview() {
    updateLivePreview(container, draftFromDom());
  }

  container.querySelectorAll("[data-color-key]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.getAttribute("data-color-key");
      const text = container.querySelector(`[data-color-text="${key}"]`);
      if (text) text.value = String(input.value || "").toUpperCase();
      refreshPreview();
    });
  });

  container.querySelectorAll("[data-color-text]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.getAttribute("data-color-text");
      const color = container.querySelector(`[data-color-key="${key}"]`);
      const value = String(input.value || "").trim();
      if (color && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
        color.value = value.length === 4
          ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
          : value;
      }
      refreshPreview();
    });
  });

  identityForm?.addEventListener("input", refreshPreview);

  async function uploadAsset(card, file, optimizeOptions = {}) {
    const key = card.getAttribute("data-asset-key");
    const group = card.getAttribute("data-asset-group");
    const status = card.querySelector("[data-asset-status]");
    const errorNode = card.querySelector(`[data-error-for="${key}"]`);
    if (errorNode) errorNode.textContent = "";
    if (status) status.textContent = "Optimizing image...";

    try {
      const optimized = await optimizeImageFile(file, optimizeOptions);
      if (status) status.textContent = "Uploading...";
      const previous = assetPath(brandingState?.[group]?.[key]);
      const uploaded = await uploadWithRetry(optimized, {
        bucket: BRANDING_BUCKET,
        previousPaths: previous ? [previous] : []
      });
      const path = uploaded?.path || uploaded?.storagePath || uploaded?.file?.path || "";
      if (!path) {
        throw new Error("Upload did not return a storage path.");
      }
      if (status) status.textContent = "Saving...";
      brandingState = await setAdminBrandingAsset(key, path);
      const url = assetUrl(brandingState?.[group]?.[key]);
      const preview = card.querySelector("[data-asset-preview]");
      if (preview) preview.innerHTML = previewImage(url, key);
      card.querySelectorAll("[data-branding-remove], [data-branding-crop]").forEach((btn) => {
        btn.disabled = !url;
      });
      if (status) status.textContent = "Saved.";
      refreshPreview();
    } catch (error) {
      if (errorNode) errorNode.textContent = error?.message || "Upload failed.";
      if (status) status.textContent = "";
      throw error;
    }
  }

  function openCropper(card, file) {
    if (!cropDialog || !cropCanvas) {
      return uploadAsset(card, file, { maxEdge: 1600 });
    }

    return loadImageFromFile(file).then(({ image, objectUrl }) => {
      cropContext = {
        card,
        file,
        image,
        objectUrl,
        zoom: 1,
        aspect: 1
      };

      const draw = () => {
        const ctx = cropCanvas.getContext("2d");
        if (!ctx || !cropContext) return;
        const aspect = Number(cropAspect?.value || 1);
        const zoom = Number(cropZoom?.value || 1);
        cropContext.zoom = zoom;
        cropContext.aspect = aspect;
        const canvasW = cropCanvas.width;
        const canvasH = cropCanvas.height;
        ctx.clearRect(0, 0, canvasW, canvasH);
        ctx.fillStyle = "#0f1f1c";
        ctx.fillRect(0, 0, canvasW, canvasH);

        const imgAspect = (image.width || 1) / (image.height || 1);
        let dw = canvasW;
        let dh = canvasW / imgAspect;
        if (dh > canvasH) {
          dh = canvasH;
          dw = canvasH * imgAspect;
        }
        dw *= zoom;
        dh *= zoom;
        const dx = (canvasW - dw) / 2;
        const dy = (canvasH - dh) / 2;
        ctx.drawImage(image, dx, dy, dw, dh);

        let frameW = canvasW * 0.72;
        let frameH = aspect > 0 ? frameW / aspect : canvasH * 0.72;
        if (frameH > canvasH * 0.72) {
          frameH = canvasH * 0.72;
          frameW = aspect > 0 ? frameH * aspect : frameW;
        }
        const fx = (canvasW - frameW) / 2;
        const fy = (canvasH - frameH) / 2;
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(0, 0, canvasW, canvasH);
        ctx.clearRect(fx, fy, frameW, frameH);
        ctx.drawImage(image, dx, dy, dw, dh);
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 2;
        ctx.strokeRect(fx + 1, fy + 1, frameW - 2, frameH - 2);
        cropContext.frame = { fx, fy, frameW, frameH, dx, dy, dw, dh };
      };

      cropZoom.value = "1";
      cropAspect.value = "1";
      draw();
      cropZoom.oninput = draw;
      cropAspect.onchange = draw;
      if (typeof cropDialog.showModal === "function") {
        cropDialog.showModal();
      } else {
        cropDialog.setAttribute("open", "true");
      }

      const applyBtn = container.querySelector("#adminBrandingCropApply");
      const cancelBtn = container.querySelector("#adminBrandingCropCancel");
      const cleanup = () => {
        if (cropContext?.objectUrl) URL.revokeObjectURL(cropContext.objectUrl);
        cropContext = null;
        cropDialog.close?.();
        cropDialog.removeAttribute("open");
      };

      cancelBtn.onclick = () => cleanup();
      applyBtn.onclick = async () => {
        if (!cropContext?.frame) return;
        const { frame, image: img } = cropContext;
        const scaleX = (img.width || 1) / frame.dw;
        const scaleY = (img.height || 1) / frame.dh;
        const sx = Math.max(0, (frame.fx - frame.dx) * scaleX);
        const sy = Math.max(0, (frame.fy - frame.dy) * scaleY);
        const sw = Math.min(img.width - sx, frame.frameW * scaleX);
        const sh = Math.min(img.height - sy, frame.frameH * scaleY);
        const targetCard = cropContext.card;
        const targetFile = cropContext.file;
        cleanup();
        await uploadAsset(targetCard, targetFile, {
          maxEdge: 1600,
          crop: { sx, sy, sw, sh }
        });
      };
    });
  }

  container.querySelectorAll("[data-branding-upload]").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.value = "";
      if (!file) return;
      const card = input.closest("[data-asset-key]");
      if (!card) return;
      try {
        await openCropper(card, file);
      } catch (error) {
        if (feedback) {
          feedback.textContent = error?.message || "Unable to process image.";
          feedback.classList.add("is-error");
        }
      }
    });
  });

  container.querySelectorAll("[data-branding-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest("[data-asset-key]");
      if (!card) return;
      const key = card.getAttribute("data-asset-key");
      const group = card.getAttribute("data-asset-group");
      const status = card.querySelector("[data-asset-status]");
      try {
        if (status) status.textContent = "Removing...";
        brandingState = await removeAdminBrandingAsset(key);
        const preview = card.querySelector("[data-asset-preview]");
        if (preview) preview.innerHTML = previewImage("", key);
        card.querySelectorAll("[data-branding-remove], [data-branding-crop]").forEach((btn) => {
          btn.disabled = true;
        });
        if (status) status.textContent = "Removed.";
        refreshPreview();
      } catch (error) {
        if (status) status.textContent = error?.message || "Remove failed.";
        void group;
      }
    });
  });

  container.querySelectorAll("[data-branding-crop]").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest("[data-asset-key]");
      if (!card) return;
      const url = assetUrl(brandingState?.[card.getAttribute("data-asset-group")]?.[card.getAttribute("data-asset-key")]);
      if (!url) return;
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const file = new File([blob], "crop-source.png", { type: blob.type || "image/png" });
        await openCropper(card, file);
      } catch (error) {
        if (feedback) {
          feedback.textContent = error?.message || "Unable to open cropper.";
          feedback.classList.add("is-error");
        }
      }
    });
  });

  saveBtn?.addEventListener("click", async () => {
    feedback.textContent = "Saving branding...";
    feedback.classList.remove("is-error", "is-success");
    saveBtn.disabled = true;
    try {
      const draft = draftFromDom();
      brandingState = await updateAdminBranding({
        colors: draft.colors,
        identity: draft.identity,
        logos: pathMapFromBranding(draft.logos),
        icons: pathMapFromBranding(draft.icons),
        assets: pathMapFromBranding(draft.assets)
      });
      feedback.textContent = "Branding saved successfully.";
      feedback.classList.add("is-success");
      container.innerHTML = panel(
        "Admin Settings",
        "Brand logos, icons, colors, and identity",
        brandingMarkup(brandingState)
      );
      bindBrandingPanel(container, brandingState);
    } catch (error) {
      const details = error?.payload?.details || error?.details || {};
      Object.entries(details).forEach(([key, message]) => {
        const node = container.querySelector(`[data-error-for="${key}"]`);
        if (node) node.textContent = String(message || "");
      });
      feedback.textContent = error?.message || "Unable to save branding.";
      feedback.classList.add("is-error");
    } finally {
      saveBtn.disabled = false;
    }
  });

  reloadBtn?.addEventListener("click", async () => {
    feedback.textContent = "Reloading...";
    try {
      await renderAdminBrandingPanel(container);
    } catch (error) {
      feedback.textContent = error?.message || "Unable to reload branding.";
      feedback.classList.add("is-error");
    }
  });
}

export async function renderAdminBrandingPanel(container) {
  container.innerHTML = panel(
    "Admin Settings",
    "Loading branding...",
    `<p class="admin-profile-help">Fetching brand configuration…</p>`
  );

  try {
    const branding = await getAdminBranding({ force: true });
    container.innerHTML = panel(
      "Admin Settings",
      "Brand logos, icons, colors, and identity",
      brandingMarkup(branding)
    );
    bindBrandingPanel(container, branding);
  } catch (error) {
    container.innerHTML = panel(
      "Admin Settings",
      "Brand management",
      emptyState(error?.message || "Unable to load branding settings.")
    );
  }
}
