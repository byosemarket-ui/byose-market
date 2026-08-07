import { emptyState, escapeHtml, formatDate, panel, table } from "../components/ui.js";
import {
  getAdminProfile,
  removeAdminProfilePhoto,
  updateAdminProfile,
  uploadAdminProfilePhoto
} from "../services/admin-data.service.js";
import { uploadWithRetry, removeStoredAssets, USERS_BUCKET } from "../../../services/uploadService.js";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const COMPRESSED_MAX_EDGE = 720;
const COMPRESSED_QUALITY = 0.82;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/jpg"]);

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
  { value: "rw", label: "Kinyarwanda" },
  { value: "sw", label: "Swahili" }
];

const TIMEZONE_OPTIONS = [
  "Africa/Kigali",
  "Africa/Nairobi",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Europe/London",
  "Europe/Paris",
  "UTC",
  "America/New_York"
];

function attr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function statusTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "active") return "success";
  if (normalized === "locked" || normalized === "suspended") return "danger";
  return "info";
}

function resolveAvatarSrc(profile) {
  const url = String(profile?.avatarUrl || "").trim();
  if (url) {
    const bust = encodeURIComponent(String(profile?.updatedAt || Date.now()));
    return url.includes("?") ? `${url}&v=${bust}` : `${url}?v=${bust}`;
  }

  const path = String(profile?.avatar || "").trim();
  if (!path) return "";
  if (/^https?:\/\//i.test(path) || path.startsWith("/")) {
    return `${path}${path.includes("?") ? "&" : "?"}v=${Date.now()}`;
  }
  return `/uploads/${path.replace(/^\/+/, "")}?v=${Date.now()}`;
}

function initialsFromName(name) {
  const parts = String(name || "Admin").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "AD";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
}

function selectOptions(options, selected) {
  return options.map((option) => {
    const value = typeof option === "string" ? option : option.value;
    const label = typeof option === "string" ? option : option.label;
    const isSelected = String(selected || "") === String(value);
    return `<option value="${attr(value)}" ${isSelected ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

function metaItem(label, value) {
  return `
    <div class="admin-profile-meta-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || "—")}</strong>
    </div>
  `;
}

function activityRows(items, emptyLabel) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) {
    return emptyState(emptyLabel);
  }

  return table(
    ["When", "Summary", "Details"],
    rows.map((item) => [
      formatDateTime(item.createdAt),
      item.summary || item.eventType || "Update",
      item.ip ? `IP ${item.ip}` : (item.device || item.status || "—")
    ])
  );
}

function loginRows(items) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) {
    return emptyState("No login history recorded yet.");
  }

  return table(
    ["When", "Status", "Device", "IP"],
    rows.map((item) => [
      formatDateTime(item.createdAt),
      item.status || "success",
      item.device || "Web browser",
      item.ip || "—"
    ])
  );
}

function validateClientProfile(payload) {
  const errors = {};
  const name = String(payload.name || "").trim();
  const username = String(payload.username || "").trim().toLowerCase();
  const email = String(payload.email || "").trim().toLowerCase();
  const phone = String(payload.phone || "").trim();

  if (name.length < 2 || name.length > 80) {
    errors.name = "Full name must be between 2 and 80 characters.";
  }
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    errors.username = "Username must be 3–32 characters (letters, numbers, . _ -).";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Enter a valid email address.";
  }
  if (phone && !/^[+]?[\d\s().-]{7,20}$/.test(phone)) {
    errors.phone = "Enter a valid phone number.";
  }

  return errors;
}

function applyFieldErrors(form, errors) {
  form.querySelectorAll("[data-error-for]").forEach((node) => {
    node.textContent = "";
  });

  Object.entries(errors || {}).forEach(([field, message]) => {
    const target = form.querySelector(`[data-error-for="${field}"]`);
    if (target) {
      target.textContent = message;
    }
  });
}

async function compressImageFile(file) {
  if (!file || !ALLOWED_PHOTO_TYPES.has(String(file.type || "").toLowerCase())) {
    throw new Error("Use a JPG, PNG, or WEBP image up to 5 MB.");
  }

  if (Number(file.size || 0) > MAX_PHOTO_BYTES) {
    throw new Error("Profile photo must be 5 MB or smaller.");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Unable to read the selected image."));
      img.src = objectUrl;
    });

    const scale = Math.min(1, COMPRESSED_MAX_EDGE / Math.max(image.width || 1, image.height || 1));
    const width = Math.max(1, Math.round((image.width || 1) * scale));
    const height = Math.max(1, Math.round((image.height || 1) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      throw new Error("Image compression is unavailable in this browser.");
    }
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise((resolve) => {
      canvas.toBlob((result) => resolve(result), "image/jpeg", COMPRESSED_QUALITY);
    });

    if (!blob) {
      return file;
    }

    return new File([blob], `${String(file.name || "avatar").replace(/\.[^.]+$/, "") || "avatar"}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now()
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function profileMarkup(profile) {
  const account = profile?.account || {};
  const activity = profile?.activity || {};
  const avatarSrc = resolveAvatarSrc(profile);
  const initials = initialsFromName(profile?.name);
  const session = account.currentSession || {};

  return `
    <div class="admin-profile-page" id="adminProfilePage">
      <section class="admin-profile-hero">
        <div class="admin-profile-hero-main">
          <div class="admin-profile-avatar-wrap" data-avatar-preview>
            ${avatarSrc
              ? `<img src="${attr(avatarSrc)}" alt="${attr(profile?.name || "Administrator")}" class="admin-profile-avatar-image" id="adminProfileAvatarImage" />`
              : `<span class="admin-profile-avatar-fallback" id="adminProfileAvatarFallback">${escapeHtml(initials)}</span>`}
          </div>
          <div class="admin-profile-hero-copy">
            <p class="admin-profile-kicker">Administrator account</p>
            <h3 id="adminProfileDisplayName">${escapeHtml(profile?.name || "Administrator")}</h3>
            <p class="admin-profile-username">@${escapeHtml(profile?.username || "admin")}</p>
            <div class="admin-profile-chip-row">
              <span class="admin-profile-chip">${escapeHtml(profile?.role || "admin")}</span>
              <span class="admin-profile-chip admin-profile-chip-${statusTone(profile?.status)}">${escapeHtml(profile?.status || "active")}</span>
              <span class="admin-profile-chip admin-profile-chip-${profile?.emailVerified ? "success" : "warn"}">
                ${profile?.emailVerified ? "Email verified" : "Email unverified"}
              </span>
            </div>
          </div>
        </div>
        <div class="admin-profile-hero-meta">
          ${metaItem("Administrator ID", profile?.administratorId || profile?.id)}
          ${metaItem("Date Joined", formatDate(profile?.dateJoined || profile?.createdAt))}
          ${metaItem("Last Login", formatDateTime(profile?.lastLoginAt))}
          ${metaItem("Login Count", String(account.loginCount ?? profile?.loginCount ?? 0))}
        </div>
      </section>

      <div class="admin-profile-grid">
        <section class="admin-profile-card">
          <header class="admin-profile-card-header">
            <div>
              <h4>Personal Information</h4>
              <p>Update the identity details used across the admin workspace.</p>
            </div>
          </header>
          <form class="settings-form admin-profile-form" id="adminProfileForm" novalidate>
            <label>
              <span>Full Name</span>
              <input name="name" type="text" maxlength="80" required value="${attr(profile?.name || "")}" />
              <small class="field-error" data-error-for="name"></small>
            </label>
            <label>
              <span>Username</span>
              <input name="username" type="text" maxlength="32" required value="${attr(profile?.username || "")}" />
              <small class="field-error" data-error-for="username"></small>
            </label>
            <label>
              <span>Email</span>
              <input name="email" type="email" required value="${attr(profile?.email || "")}" />
              <small class="field-error" data-error-for="email"></small>
            </label>
            <label>
              <span>Phone Number</span>
              <input name="phone" type="tel" value="${attr(profile?.phone || "")}" placeholder="+2507..." />
              <small class="field-error" data-error-for="phone"></small>
            </label>
            <label>
              <span>Job Title</span>
              <input name="jobTitle" type="text" maxlength="80" value="${attr(profile?.jobTitle || "")}" />
              <small class="field-error" data-error-for="jobTitle"></small>
            </label>
            <label>
              <span>Department</span>
              <input name="department" type="text" maxlength="80" value="${attr(profile?.department || "")}" />
              <small class="field-error" data-error-for="department"></small>
            </label>
            <label>
              <span>Preferred Language</span>
              <select name="preferredLanguage">${selectOptions(LANGUAGE_OPTIONS, profile?.preferredLanguage || "en")}</select>
              <small class="field-error" data-error-for="preferredLanguage"></small>
            </label>
            <label>
              <span>Time Zone</span>
              <select name="timeZone">${selectOptions(TIMEZONE_OPTIONS, profile?.timeZone || "Africa/Kigali")}</select>
              <small class="field-error" data-error-for="timeZone"></small>
            </label>
            <div class="admin-profile-form-actions">
              <button class="btn btn-primary" type="submit">Save Profile</button>
              <p id="adminProfileFeedback" class="form-feedback"></p>
            </div>
          </form>
        </section>

        <section class="admin-profile-card">
          <header class="admin-profile-card-header">
            <div>
              <h4>Profile Photo</h4>
              <p>Upload, replace, or remove your administrator avatar.</p>
            </div>
          </header>
          <div class="admin-profile-photo-panel">
            <div class="admin-profile-photo-preview" data-photo-preview>
              ${avatarSrc
                ? `<img src="${attr(avatarSrc)}" alt="Profile preview" id="adminProfilePhotoPreview" />`
                : `<span class="admin-profile-avatar-fallback">${escapeHtml(initials)}</span>`}
            </div>
            <div class="admin-profile-photo-actions">
              <label class="btn btn-ghost admin-profile-upload-label">
                <input id="adminProfilePhotoInput" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" hidden />
                ${avatarSrc ? "Replace Photo" : "Upload Photo"}
              </label>
              <button class="btn btn-ghost" type="button" id="adminProfileRemovePhoto" ${avatarSrc ? "" : "disabled"}>Remove Photo</button>
              <p class="admin-profile-help">JPG, PNG, or WEBP up to 5 MB. Images are compressed before secure upload.</p>
              <p id="adminProfilePhotoFeedback" class="form-feedback"></p>
            </div>
          </div>
        </section>

        <section class="admin-profile-card">
          <header class="admin-profile-card-header">
            <div>
              <h4>Account Information</h4>
              <p>Lifecycle and session details loaded from the database.</p>
            </div>
          </header>
          <div class="admin-profile-account-grid">
            ${metaItem("Account Created", formatDateTime(account.createdAt || profile?.createdAt))}
            ${metaItem("Last Updated", formatDateTime(account.updatedAt || profile?.updatedAt))}
            ${metaItem("Last Password Change", formatDateTime(account.lastPasswordChangeAt || profile?.lastPasswordChangeAt))}
            ${metaItem("Last Login", formatDateTime(account.lastLoginAt || profile?.lastLoginAt))}
            ${metaItem("Current Active Session", session.sessionId || "Active browser session")}
            ${metaItem("Session Started", formatDateTime(session.startedAt))}
            ${metaItem("Session IP", session.ip || "—")}
            ${metaItem("Total Login Count", String(account.loginCount ?? profile?.loginCount ?? 0))}
          </div>
        </section>

        <section class="admin-profile-card admin-profile-card-wide">
          <header class="admin-profile-card-header">
            <div>
              <h4>Activity Summary</h4>
              <p>Recent logins, profile updates, and security changes.</p>
            </div>
          </header>
          <div class="admin-profile-activity-grid">
            <article>
              <h5>Recent Login History</h5>
              ${loginRows(activity.recentLogins)}
            </article>
            <article>
              <h5>Recent Profile Updates</h5>
              ${activityRows(activity.recentProfileUpdates, "No profile updates yet.")}
            </article>
            <article>
              <h5>Recent Security Changes</h5>
              ${activityRows(activity.recentSecurityChanges, "No security changes recorded yet.")}
            </article>
          </div>
        </section>
      </div>
    </div>
  `;
}

function refreshHeaderIdentity(profile) {
  const nameNode = document.getElementById("headerProfileName");
  if (nameNode && profile?.name) {
    nameNode.textContent = profile.name;
  }

  const roleNode = document.getElementById("headerProfileRole");
  if (roleNode && profile?.role) {
    roleNode.textContent = profile.role;
  }
}

export async function renderAdminProfilePanel(container) {
  let profile;
  try {
    profile = await getAdminProfile({ force: true });
  } catch (error) {
    container.innerHTML = panel(
      "Admin Profile",
      "Manage your administrator account identity",
      emptyState(error?.message || "Unable to load admin profile.")
    );
    return;
  }

  container.innerHTML = panel(
    "Admin Profile",
    "Manage your administrator account identity, photo, and activity",
    profileMarkup(profile)
  );

  refreshHeaderIdentity(profile);

  const form = document.getElementById("adminProfileForm");
  const feedback = document.getElementById("adminProfileFeedback");
  const photoInput = document.getElementById("adminProfilePhotoInput");
  const photoFeedback = document.getElementById("adminProfilePhotoFeedback");
  const removePhotoButton = document.getElementById("adminProfileRemovePhoto");

  if (!form || !feedback) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = {
      name: String(formData.get("name") || "").trim(),
      username: String(formData.get("username") || "").trim().toLowerCase(),
      email: String(formData.get("email") || "").trim().toLowerCase(),
      phone: String(formData.get("phone") || "").trim(),
      jobTitle: String(formData.get("jobTitle") || "").trim(),
      department: String(formData.get("department") || "").trim(),
      preferredLanguage: String(formData.get("preferredLanguage") || "en").trim(),
      timeZone: String(formData.get("timeZone") || "Africa/Kigali").trim()
    };

    const errors = validateClientProfile(payload);
    applyFieldErrors(form, errors);
    if (Object.keys(errors).length) {
      feedback.textContent = "Please correct the highlighted fields.";
      return;
    }

    feedback.textContent = "Saving profile...";
    form.querySelector("button[type='submit']")?.setAttribute("disabled", "disabled");

    try {
      const updated = await updateAdminProfile(payload);
      refreshHeaderIdentity(updated);
      await renderAdminProfilePanel(container);
    } catch (error) {
      const details = error?.payload?.details || {};
      applyFieldErrors(form, details);
      feedback.textContent = error?.message || "Unable to save profile right now.";
      form.querySelector("button[type='submit']")?.removeAttribute("disabled");
    }
  });

  photoInput?.addEventListener("change", async () => {
    const file = photoInput.files && photoInput.files[0];
    photoInput.value = "";
    if (!file || !photoFeedback) {
      return;
    }

    photoFeedback.textContent = "Compressing and uploading photo...";
    removePhotoButton?.setAttribute("disabled", "disabled");

    try {
      const compressed = await compressImageFile(file);
      const previousPath = String(profile?.avatar || "").trim();
      const uploaded = await uploadWithRetry(compressed, {
        bucket: USERS_BUCKET,
        previousPaths: previousPath ? [previousPath] : [],
        progressLabel: "Uploading profile photo..."
      });
      const storagePath = String(uploaded?.storagePath || uploaded?.path || "").trim();
      if (!storagePath) {
        throw new Error("Upload completed without a storage path.");
      }

      const updated = await uploadAdminProfilePhoto(storagePath);
      refreshHeaderIdentity(updated);
      await renderAdminProfilePanel(container);
    } catch (error) {
      photoFeedback.textContent = error?.message || "Unable to upload profile photo.";
      removePhotoButton?.removeAttribute("disabled");
    }
  });

  removePhotoButton?.addEventListener("click", async () => {
    if (!photoFeedback) return;
    photoFeedback.textContent = "Removing profile photo...";
    removePhotoButton.setAttribute("disabled", "disabled");

    try {
      const previousPath = String(profile?.avatar || "").trim();
      const updated = await removeAdminProfilePhoto();
      if (previousPath) {
        await removeStoredAssets([previousPath]);
      }
      refreshHeaderIdentity(updated);
      await renderAdminProfilePanel(container);
    } catch (error) {
      photoFeedback.textContent = error?.message || "Unable to remove profile photo.";
      removePhotoButton.removeAttribute("disabled");
    }
  });
}
