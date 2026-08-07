import { emptyState, escapeHtml, panel, table } from "../components/ui.js";
import {
  changeAdminPassword,
  getAdminPasswordStatus,
  validateAdminPasswordStrength
} from "../services/admin-data.service.js";
import { evaluatePasswordStrength } from "../utils/password-strength.js";

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

function strengthTone(label) {
  const value = String(label || "").toLowerCase();
  if (value === "very strong") return "success";
  if (value === "strong") return "info";
  if (value === "medium") return "warn";
  return "danger";
}

function passwordField({ id, name, label, autocomplete }) {
  return `
    <label class="admin-password-field">
      <span>${escapeHtml(label)}</span>
      <div class="admin-password-input-wrap">
        <input
          id="${attr(id)}"
          name="${attr(name)}"
          type="password"
          autocomplete="${attr(autocomplete)}"
          required
        />
        <button class="btn btn-ghost admin-password-toggle" type="button" data-toggle-password="${attr(id)}" aria-label="Show ${attr(label)}">Show</button>
      </div>
      <small class="field-error" data-error-for="${attr(name)}"></small>
    </label>
  `;
}

function statusMarkup(password) {
  const expiration = password?.expiration || {};
  return `
    <div class="admin-profile-account-grid">
      <div class="admin-profile-meta-item"><span>Last Password Changed</span><strong>${escapeHtml(formatDateTime(password?.lastPasswordChangedAt))}</strong></div>
      <div class="admin-profile-meta-item"><span>Password Age</span><strong>${escapeHtml(password?.passwordAgeDays == null ? "—" : `${password.passwordAgeDays} day(s)`)}</strong></div>
      <div class="admin-profile-meta-item"><span>Password Version</span><strong>${escapeHtml(password?.passwordVersion || 1)}</strong></div>
      <div class="admin-profile-meta-item"><span>Expiration Status</span><strong>${escapeHtml(expiration.status || "ok")}</strong></div>
      <div class="admin-profile-meta-item"><span>Expires</span><strong>${escapeHtml(formatDateTime(expiration.expiresAt))}</strong></div>
      <div class="admin-profile-meta-item"><span>Days Until Expiration</span><strong>${escapeHtml(expiration.daysUntilExpiration == null ? "—" : String(expiration.daysUntilExpiration))}</strong></div>
    </div>
    <p class="admin-profile-help">${escapeHtml(expiration.message || "Password expiration monitoring is prepared.")}</p>
  `;
}

function historyMarkup(history = []) {
  if (!history.length) {
    return emptyState("No password change history recorded yet.");
  }

  return table(
    ["Changed At", "Version", "Source"],
    history.map((item) => [
      formatDateTime(item.changedAt),
      String(item.passwordVersion || "—"),
      item.source || "admin_settings"
    ])
  );
}

function strengthMarkup(strength) {
  const checks = strength?.checks || {};
  const items = [
    ["length", "Length 10+"],
    ["uppercase", "Uppercase"],
    ["lowercase", "Lowercase"],
    ["number", "Number"],
    ["special", "Special character"],
    ["notCommon", "Not blacklisted"],
    ["noRepeat", "No repeated runs"],
    ["noSequential", "No sequences"],
    ["differentFromCurrent", "Different from current"]
  ];

  return `
    <div class="admin-password-strength" id="passwordStrengthPanel">
      <div class="admin-password-strength-head">
        <strong>Password Strength</strong>
        <span class="admin-profile-chip admin-profile-chip-${strengthTone(strength?.label)}" id="passwordStrengthLabel">${escapeHtml(strength?.label || "Weak")}</span>
      </div>
      <div class="admin-password-strength-meter" aria-hidden="true">
        <span id="passwordStrengthBar" style="width:${attr(strength?.percent || 8)}%"></span>
      </div>
      <ul class="admin-password-check-list" id="passwordStrengthChecks">
        ${items.map(([key, label]) => `
          <li class="${checks[key] ? "is-valid" : "is-invalid"}" data-check="${attr(key)}">${escapeHtml(label)}</li>
        `).join("")}
      </ul>
      <p class="admin-profile-help" id="passwordStrengthHint">${escapeHtml((strength?.errors && strength.errors[0]) || "Enter a strong password to enable saving.")}</p>
    </div>
  `;
}

function passwordPageMarkup(password) {
  const initialStrength = evaluatePasswordStrength("");
  return `
    <div class="admin-profile-page admin-password-page" id="adminPasswordPage">
      <section class="admin-profile-hero">
        <div class="admin-profile-hero-copy">
          <p class="admin-profile-kicker">Administrator credentials</p>
          <h3>Password management</h3>
          <p class="admin-profile-username">Change your password with live strength checks and secure history tracking.</p>
        </div>
      </section>

      <div class="admin-profile-grid admin-password-grid">
        <section class="admin-profile-card">
          <header class="admin-profile-card-header">
            <div>
              <h4>Change Password</h4>
              <p>Current password verification is required before credentials can be updated.</p>
            </div>
          </header>
          <form class="settings-form admin-password-form" id="adminPasswordForm" novalidate autocomplete="off">
            ${passwordField({ id: "currentPassword", name: "currentPassword", label: "Current Password", autocomplete: "current-password" })}
            ${passwordField({ id: "newPassword", name: "newPassword", label: "New Password", autocomplete: "new-password" })}
            ${passwordField({ id: "confirmPassword", name: "confirmPassword", label: "Confirm New Password", autocomplete: "new-password" })}
            <div class="admin-password-form-side">
              ${strengthMarkup(initialStrength)}
            </div>
            <div class="admin-profile-form-actions">
              <button class="btn btn-primary" type="submit" id="adminPasswordSubmit" disabled>Update Password</button>
              <p id="adminPasswordFeedback" class="form-feedback"></p>
            </div>
          </form>
        </section>

        <section class="admin-profile-card">
          <header class="admin-profile-card-header">
            <div>
              <h4>Password Status</h4>
              <p>Age, version, and expiration monitoring from the database.</p>
            </div>
          </header>
          <div id="adminPasswordStatusPanel">${statusMarkup(password)}</div>
        </section>

        <section class="admin-profile-card admin-profile-card-wide">
          <header class="admin-profile-card-header">
            <div>
              <h4>Password Change History</h4>
              <p>Metadata only — previous password values are never displayed.</p>
            </div>
          </header>
          <div id="adminPasswordHistoryPanel">${historyMarkup(password?.history || [])}</div>
        </section>
      </div>
    </div>
  `;
}

function clearFieldErrors(form) {
  form.querySelectorAll("[data-error-for]").forEach((node) => {
    node.textContent = "";
  });
}

function setFieldError(form, field, message) {
  const node = form.querySelector(`[data-error-for="${field}"]`);
  if (node) node.textContent = message || "";
}

function updateStrengthUi(strength) {
  const label = document.getElementById("passwordStrengthLabel");
  const bar = document.getElementById("passwordStrengthBar");
  const hint = document.getElementById("passwordStrengthHint");
  if (label) {
    label.textContent = strength.label;
    label.className = `admin-profile-chip admin-profile-chip-${strengthTone(strength.label)}`;
  }
  if (bar) bar.style.width = `${strength.percent || 8}%`;
  if (hint) hint.textContent = strength.errors[0] || (strength.meetsPolicy ? "Password meets enterprise policy." : "Keep improving password strength.");

  Object.entries(strength.checks || {}).forEach(([key, valid]) => {
    const item = document.querySelector(`[data-check="${key}"]`);
    if (!item) return;
    item.classList.toggle("is-valid", Boolean(valid));
    item.classList.toggle("is-invalid", !valid);
  });
}

export async function renderAdminPasswordPanel(container) {
  let password;
  try {
    password = await getAdminPasswordStatus({ force: true });
  } catch (error) {
    container.innerHTML = panel(
      "Password",
      "Password and credential management",
      emptyState(error?.message || "Unable to load password settings.")
    );
    return;
  }

  container.innerHTML = panel(
    "Password",
    "Secure administrator password management",
    passwordPageMarkup(password)
  );

  const form = document.getElementById("adminPasswordForm");
  const submit = document.getElementById("adminPasswordSubmit");
  const feedback = document.getElementById("adminPasswordFeedback");
  const currentInput = document.getElementById("currentPassword");
  const newInput = document.getElementById("newPassword");
  const confirmInput = document.getElementById("confirmPassword");

  if (!form || !submit || !currentInput || !newInput || !confirmInput) {
    return;
  }

  const syncFormState = () => {
    clearFieldErrors(form);
    const strength = evaluatePasswordStrength(newInput.value, { currentPassword: currentInput.value });
    updateStrengthUi(strength);

    let canSubmit = true;
    if (!currentInput.value) {
      canSubmit = false;
    }
    if (!strength.meetsPolicy) {
      canSubmit = false;
    }
    if (newInput.value !== confirmInput.value) {
      canSubmit = false;
      if (confirmInput.value) {
        setFieldError(form, "confirmPassword", "Confirmation does not match the new password.");
      }
    }

    submit.disabled = !canSubmit;
    return { strength, canSubmit };
  };

  container.querySelectorAll("[data-toggle-password]").forEach((button) => {
    button.addEventListener("click", () => {
      const inputId = button.getAttribute("data-toggle-password");
      const input = document.getElementById(inputId);
      if (!input) return;
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      button.textContent = showing ? "Show" : "Hide";
      button.setAttribute("aria-label", `${showing ? "Show" : "Hide"} password`);
    });
  });

  [currentInput, newInput, confirmInput].forEach((input) => {
    input.addEventListener("input", () => {
      syncFormState();
      if (input === newInput && newInput.value.length >= 4) {
        validateAdminPasswordStrength(newInput.value, currentInput.value).catch(() => {});
      }
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const state = syncFormState();
    if (!state.canSubmit) {
      feedback.textContent = "Fix validation issues before saving.";
      return;
    }

    feedback.textContent = "Updating password...";
    submit.disabled = true;

    try {
      const result = await changeAdminPassword({
        currentPassword: currentInput.value,
        newPassword: newInput.value,
        confirmPassword: confirmInput.value
      });

      form.reset();
      updateStrengthUi(evaluatePasswordStrength(""));
      submit.disabled = true;
      feedback.textContent = result?.message || "Password updated successfully.";

      const statusPanel = document.getElementById("adminPasswordStatusPanel");
      const historyPanel = document.getElementById("adminPasswordHistoryPanel");
      if (statusPanel) statusPanel.innerHTML = statusMarkup(result);
      if (historyPanel) historyPanel.innerHTML = historyMarkup(result?.history || []);
    } catch (error) {
      const details = error?.payload?.details || {};
      if (details.currentPassword) setFieldError(form, "currentPassword", details.currentPassword);
      if (details.newPassword) setFieldError(form, "newPassword", details.newPassword);
      if (details.confirmPassword) setFieldError(form, "confirmPassword", details.confirmPassword);
      if (Array.isArray(details.errors) && details.errors[0]) {
        setFieldError(form, "newPassword", details.errors[0]);
      }
      feedback.textContent = error?.message || "Unable to update password.";
      syncFormState();
    }
  });

  syncFormState();
}
