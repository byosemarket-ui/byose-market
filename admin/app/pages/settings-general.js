import { emptyState, escapeHtml, panel } from "../components/ui.js";
import { getSettings, updateSettings } from "../services/admin-data.service.js";

function attr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function selectOptions(options, selected) {
  const current = String(selected || "");
  return options
    .map(([value, label]) => {
      const isSelected = String(value) === current ? " selected" : "";
      return `<option value="${attr(value)}"${isSelected}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function field(name, label, { type = "text", value = "", placeholder = "", required = false, maxlength } = {}) {
  const maxAttr = maxlength ? ` maxlength="${attr(maxlength)}"` : "";
  const reqAttr = required ? " required" : "";
  return `
    <label>
      <span>${escapeHtml(label)}</span>
      <input
        name="${attr(name)}"
        type="${attr(type)}"
        value="${attr(value)}"
        placeholder="${attr(placeholder)}"
        ${maxAttr}${reqAttr}
      />
      <small class="field-error" data-error-for="${attr(name)}"></small>
    </label>
  `;
}

function selectField(name, label, options, value) {
  return `
    <label>
      <span>${escapeHtml(label)}</span>
      <select name="${attr(name)}">${selectOptions(options, value)}</select>
      <small class="field-error" data-error-for="${attr(name)}"></small>
    </label>
  `;
}

function toggleField(name, label, checked, help = "") {
  return `
    <label class="admin-general-toggle">
      <span>
        <strong>${escapeHtml(label)}</strong>
        ${help ? `<small>${escapeHtml(help)}</small>` : ""}
      </span>
      <input type="checkbox" name="${attr(name)}" ${checked ? "checked" : ""} />
    </label>
  `;
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

function generalMarkup(settings) {
  const notifications = settings?.notifications || {};
  return `
    <div class="admin-profile-page admin-general-page" id="adminGeneralPage">
      <section class="admin-profile-hero">
        <div class="admin-profile-hero-main">
          <div class="admin-profile-hero-copy">
            <p class="admin-profile-kicker">Platform configuration</p>
            <h3>General Settings</h3>
            <p class="admin-profile-username">Store identity, regional defaults, system behavior, and notifications</p>
            <div class="admin-profile-chip-row">
              <span class="admin-profile-chip">${escapeHtml(settings?.currency || "RWF")}</span>
              <span class="admin-profile-chip admin-profile-chip-${settings?.storeStatus === "open" ? "success" : "danger"}">
                Store ${escapeHtml(settings?.storeStatus || "open")}
              </span>
              <span class="admin-profile-chip admin-profile-chip-${settings?.maintenanceMode ? "warn" : "success"}">
                ${settings?.maintenanceMode ? "Maintenance on" : "Live"}
              </span>
            </div>
          </div>
        </div>
        <div class="admin-profile-hero-meta">
          <div class="admin-profile-meta-item"><span>Store</span><strong>${escapeHtml(settings?.storeName || "BYOSE Market")}</strong></div>
          <div class="admin-profile-meta-item"><span>Support</span><strong>${escapeHtml(settings?.supportEmail || "—")}</strong></div>
          <div class="admin-profile-meta-item"><span>Timezone</span><strong>${escapeHtml(settings?.timeZone || "—")}</strong></div>
          <div class="admin-profile-meta-item"><span>Last Updated</span><strong>${escapeHtml(formatDateTime(settings?.updatedAt))}</strong></div>
        </div>
      </section>

      <form class="settings-form admin-general-form" id="adminGeneralForm" novalidate>
        <div class="admin-profile-grid">
          ${sectionCard(
            "Store Information",
            "Core identity used across the website and admin workspace.",
            `
              <div class="admin-general-fields">
                ${field("storeName", "Store Name", { value: settings?.storeName || "", required: true, maxlength: 120 })}
                ${field("companyName", "Company Name", { value: settings?.companyName || "", maxlength: 120 })}
                ${field("companyEmail", "Company Email", { type: "email", value: settings?.companyEmail || "", maxlength: 160 })}
                ${field("supportEmail", "Customer Support Email", { type: "email", value: settings?.supportEmail || "", maxlength: 160 })}
                ${field("supportPhone", "Company Phone Number", { type: "tel", value: settings?.supportPhone || "", placeholder: "+2507...", maxlength: 40 })}
                ${field("whatsappNumber", "WhatsApp Number", { type: "tel", value: settings?.whatsappNumber || "", placeholder: "+2507...", maxlength: 40 })}
                ${field("companyAddress", "Company Address", { value: settings?.companyAddress || "", maxlength: 240 })}
                ${field("country", "Country", { value: settings?.country || "", maxlength: 80 })}
                ${field("provinceCity", "Province / City", { value: settings?.provinceCity || "", maxlength: 120 })}
                ${field("websiteUrl", "Website URL", { type: "url", value: settings?.websiteUrl || "", maxlength: 240 })}
              </div>
            `,
            true
          )}

          ${sectionCard(
            "Regional Settings",
            "Defaults that drive currency, language, and formatting on the storefront.",
            `
              <div class="admin-general-fields">
                ${field("defaultCountry", "Default Country", { value: settings?.defaultCountry || settings?.country || "", maxlength: 80 })}
                ${selectField("currency", "Default Currency", [
                  ["RWF", "RWF — Rwandan Franc"],
                  ["USD", "USD — US Dollar"],
                  ["EUR", "EUR — Euro"],
                  ["KES", "KES — Kenyan Shilling"],
                  ["UGX", "UGX — Ugandan Shilling"],
                  ["TZS", "TZS — Tanzanian Shilling"]
                ], settings?.currency || "RWF")}
                ${field("currencySymbol", "Currency Symbol", { value: settings?.currencySymbol || settings?.currency || "RWF", maxlength: 12 })}
                ${selectField("language", "Language", [
                  ["en", "English"],
                  ["fr", "French"],
                  ["rw", "Kinyarwanda"],
                  ["sw", "Swahili"]
                ], settings?.language || "en")}
                ${selectField("timeZone", "Time Zone", [
                  ["Africa/Kigali", "Africa/Kigali"],
                  ["Africa/Nairobi", "Africa/Nairobi"],
                  ["UTC", "UTC"],
                  ["Europe/Paris", "Europe/Paris"]
                ], settings?.timeZone || "Africa/Kigali")}
                ${selectField("dateFormat", "Date Format", [
                  ["DD/MM/YYYY", "DD/MM/YYYY"],
                  ["MM/DD/YYYY", "MM/DD/YYYY"],
                  ["YYYY-MM-DD", "YYYY-MM-DD"]
                ], settings?.dateFormat || "DD/MM/YYYY")}
                ${selectField("timeFormat", "Time Format", [
                  ["24h", "24-hour"],
                  ["12h", "12-hour"]
                ], settings?.timeFormat || "24h")}
                ${selectField("numberFormat", "Number Format", [
                  ["en-US", "1,234.56 (en-US)"],
                  ["fr-FR", "1 234,56 (fr-FR)"],
                  ["de-DE", "1.234,56 (de-DE)"]
                ], settings?.numberFormat || "en-US")}
              </div>
            `,
            true
          )}

          ${sectionCard(
            "System Settings",
            "Operational switches that affect checkout, registration, and availability.",
            `
              <div class="admin-general-toggles">
                ${toggleField("maintenanceMode", "Maintenance Mode", Boolean(settings?.maintenanceMode), "Blocks ordering while maintenance is active.")}
                ${toggleField("allowCustomerRegistration", "Allow Customer Registration", settings?.allowCustomerRegistration !== false, "Disable to stop new customer signups.")}
                ${toggleField("allowGuestCheckout", "Allow Guest Checkout", settings?.allowGuestCheckout !== false, "Require sign-in before placing an order when off.")}
              </div>
              <div class="admin-general-fields">
                ${selectField("storeStatus", "Store Status", [
                  ["open", "Open"],
                  ["closed", "Closed"]
                ], settings?.storeStatus || "open")}
                ${selectField("defaultCustomerRole", "Default Customer Role", [
                  ["user", "User"]
                ], settings?.defaultCustomerRole || "user")}
                ${selectField("defaultOrderStatus", "Default Order Status", [
                  ["Pending", "Pending"],
                  ["Processing", "Processing"],
                  ["Confirmed", "Confirmed"]
                ], settings?.defaultOrderStatus || "Pending")}
                ${selectField("defaultPaymentStatus", "Default Payment Status", [
                  ["pending", "Pending"],
                  ["paid", "Paid"],
                  ["unpaid", "Unpaid"]
                ], settings?.defaultPaymentStatus || "pending")}
              </div>
            `,
            true
          )}

          ${sectionCard(
            "Communication Settings",
            "Contact channels reused across the website and support surfaces.",
            `
              <div class="admin-general-fields">
                ${field("defaultSupportEmail", "Default Support Email", { type: "email", value: settings?.defaultSupportEmail || settings?.supportEmail || "", maxlength: 160 })}
                ${field("customerServicePhone", "Customer Service Phone", { type: "tel", value: settings?.customerServicePhone || settings?.supportPhone || "", maxlength: 40 })}
                ${field("whatsappContact", "WhatsApp Contact", { type: "tel", value: settings?.whatsappContact || settings?.whatsappNumber || "", maxlength: 40 })}
                ${field("businessHours", "Business Hours", { value: settings?.businessHours || "", maxlength: 160 })}
                ${field("emergencyContact", "Emergency Contact", { value: settings?.emergencyContact || "", maxlength: 80 })}
              </div>
            `,
            true
          )}

          ${sectionCard(
            "Notifications",
            "Preferences stored for email and system alerting. Delivery channels can consume these later.",
            `
              <div class="admin-general-toggles">
                ${toggleField("notifications.emailNotifications", "Email Notifications", notifications.emailNotifications !== false)}
                ${toggleField("notifications.orderNotifications", "Order Notifications", notifications.orderNotifications !== false)}
                ${toggleField("notifications.customerRegistrationNotifications", "Customer Registration Notifications", notifications.customerRegistrationNotifications !== false)}
                ${toggleField("notifications.contactFormNotifications", "Contact Form Notifications", notifications.contactFormNotifications !== false)}
                ${toggleField("notifications.lowStockNotifications", "Low Stock Notifications", notifications.lowStockNotifications !== false)}
                ${toggleField("notifications.systemNotifications", "System Notifications", notifications.systemNotifications !== false)}
              </div>
            `,
            true
          )}
        </div>

        <div class="admin-profile-form-actions admin-general-actions">
          <button class="btn btn-primary" type="submit" id="adminGeneralSaveBtn">Save Configuration</button>
          <button class="btn btn-ghost" type="button" id="adminGeneralReloadBtn">Reload</button>
          <p id="adminGeneralFeedback" class="form-feedback" role="status"></p>
        </div>
      </form>
    </div>
  `;
}

function clearFieldErrors(form) {
  form.querySelectorAll("[data-error-for]").forEach((node) => {
    node.textContent = "";
  });
}

function showFieldErrors(form, details = {}) {
  Object.entries(details || {}).forEach(([key, message]) => {
    const node = form.querySelector(`[data-error-for="${key}"]`);
    if (node) {
      node.textContent = String(message || "");
    }
  });
}

function readBoolean(form, name) {
  const input = form.querySelector(`[name="${name}"]`);
  return Boolean(input?.checked);
}

function readValue(form, name) {
  const input = form.elements.namedItem(name);
  if (!input) return "";
  return String(input.value || "").trim();
}

function collectPayload(form) {
  return {
    storeName: readValue(form, "storeName"),
    companyName: readValue(form, "companyName"),
    companyEmail: readValue(form, "companyEmail"),
    supportEmail: readValue(form, "supportEmail"),
    supportPhone: readValue(form, "supportPhone"),
    whatsappNumber: readValue(form, "whatsappNumber"),
    companyAddress: readValue(form, "companyAddress"),
    country: readValue(form, "country"),
    provinceCity: readValue(form, "provinceCity"),
    websiteUrl: readValue(form, "websiteUrl"),

    defaultCountry: readValue(form, "defaultCountry"),
    currency: readValue(form, "currency"),
    currencySymbol: readValue(form, "currencySymbol"),
    language: readValue(form, "language"),
    timeZone: readValue(form, "timeZone"),
    dateFormat: readValue(form, "dateFormat"),
    timeFormat: readValue(form, "timeFormat"),
    numberFormat: readValue(form, "numberFormat"),

    maintenanceMode: readBoolean(form, "maintenanceMode"),
    storeStatus: readValue(form, "storeStatus"),
    allowCustomerRegistration: readBoolean(form, "allowCustomerRegistration"),
    allowGuestCheckout: readBoolean(form, "allowGuestCheckout"),
    defaultCustomerRole: readValue(form, "defaultCustomerRole"),
    defaultOrderStatus: readValue(form, "defaultOrderStatus"),
    defaultPaymentStatus: readValue(form, "defaultPaymentStatus"),

    defaultSupportEmail: readValue(form, "defaultSupportEmail"),
    customerServicePhone: readValue(form, "customerServicePhone"),
    whatsappContact: readValue(form, "whatsappContact"),
    businessHours: readValue(form, "businessHours"),
    emergencyContact: readValue(form, "emergencyContact"),

    notifications: {
      emailNotifications: readBoolean(form, "notifications.emailNotifications"),
      orderNotifications: readBoolean(form, "notifications.orderNotifications"),
      customerRegistrationNotifications: readBoolean(form, "notifications.customerRegistrationNotifications"),
      contactFormNotifications: readBoolean(form, "notifications.contactFormNotifications"),
      lowStockNotifications: readBoolean(form, "notifications.lowStockNotifications"),
      systemNotifications: readBoolean(form, "notifications.systemNotifications")
    }
  };
}

function bindGeneralForm(container) {
  const form = container.querySelector("#adminGeneralForm");
  const feedback = container.querySelector("#adminGeneralFeedback");
  const saveBtn = container.querySelector("#adminGeneralSaveBtn");
  const reloadBtn = container.querySelector("#adminGeneralReloadBtn");

  if (!form || !feedback) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    feedback.textContent = "Saving configuration...";
    feedback.classList.remove("is-error", "is-success");
    if (saveBtn) saveBtn.disabled = true;

    try {
      const payload = collectPayload(form);
      const settings = await updateSettings(payload);
      feedback.textContent = "General settings saved successfully.";
      feedback.classList.add("is-success");
      container.innerHTML = panel(
        "Admin Settings",
        "Platform store, regional, system, and communication configuration",
        generalMarkup(settings)
      );
      bindGeneralForm(container);
    } catch (error) {
        const details = error?.payload?.details || error?.details || {};
      showFieldErrors(form, details);
      feedback.textContent = error?.message || "Unable to save general settings.";
      feedback.classList.add("is-error");
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });

  reloadBtn?.addEventListener("click", async () => {
    feedback.textContent = "Reloading...";
    try {
      await renderAdminGeneralPanel(container);
    } catch (error) {
      feedback.textContent = error?.message || "Unable to reload settings.";
      feedback.classList.add("is-error");
    }
  });
}

export async function renderAdminGeneralPanel(container) {
  container.innerHTML = panel(
    "Admin Settings",
    "Loading general settings...",
    `<p class="admin-profile-help">Fetching platform configuration…</p>`
  );

  try {
    const settings = await getSettings({ force: true });
    container.innerHTML = panel(
      "Admin Settings",
      "Platform store, regional, system, and communication configuration",
      generalMarkup(settings)
    );
    bindGeneralForm(container);
  } catch (error) {
    container.innerHTML = panel(
      "Admin Settings",
      "Platform configuration",
      emptyState(error?.message || "Unable to load general settings.")
    );
  }
}
