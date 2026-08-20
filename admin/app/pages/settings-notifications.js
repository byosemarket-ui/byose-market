import { escapeHtml } from "../components/ui.js";
import {
  getNotificationSettings,
  getNotificationAutomationStatus,
  sendNotificationTestEmail,
  updateNotificationSettings
} from "../services/admin-data.service.js";
import {
  playNotificationSound,
  requestBrowserNotificationPermission,
  setCachedNotificationPrefs
} from "../utils/notification-prefs.js";

function attr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim().toLowerCase());
}

const EMAIL_EVENT_LABELS = {
  ORDER_CREATED: "New Order",
  PAYMENT_PENDING: "Payment Pending",
  PAYMENT_RECEIVED: "Payment Successful",
  PAYMENT_FAILED: "Payment Failed",
  PAYMENT_CANCELLED: "Payment Cancelled",
  ORDER_CONFIRMED: "Order Confirmed",
  ORDER_PROCESSING: "Order Processing",
  ORDER_PACKED: "Order Packed",
  ORDER_SHIPPED: "Order Shipped",
  ORDER_DELIVERED: "Order Delivered",
  ORDER_CANCELLED: "Order Cancelled",
  REFUND_REQUESTED: "Refund Requested",
  REFUND_APPROVED: "Refund Completed",
  REFUND_REJECTED: "Refund Rejected",
  CUSTOMER_REGISTERED: "New Customer Registration",
  LOW_STOCK: "Low Stock Alert",
  OUT_OF_STOCK: "Out of Stock Alert"
};

const CHANNEL_COLUMNS = [
  { id: "in_app", label: "Dashboard", planned: false },
  { id: "email", label: "Email", planned: false },
  { id: "browser", label: "Browser", planned: false },
  { id: "sound", label: "Sound", planned: false }
];

function defaultChannelsForEvent(settings, eventKey) {
  const matrix = settings?.eventChannelPreferences?.[eventKey];
  if (matrix && typeof matrix === "object") return matrix;
  return {
    in_app: true,
    email: settings?.emailEventPreferences?.[eventKey] !== false,
    browser: settings?.browserNotificationsEnabled !== false,
    sound: Boolean(settings?.soundNotificationsEnabled)
  };
}

function emailEventTogglesMarkup(settings) {
  const items = Object.keys(EMAIL_EVENT_LABELS).map((eventKey) => {
    const enabled = settings?.emailEventPreferences?.[eventKey] !== false;
    return switchField(
      `emailEvent.${eventKey}`,
      EMAIL_EVENT_LABELS[eventKey],
      enabled,
      enabled ? "ON" : "OFF"
    );
  }).join("");

  return `
    <div class="ns-event-toolbar">
      <button type="button" class="btn btn-ghost" data-ns-events="enable-all">Enable all events</button>
      <button type="button" class="btn btn-ghost" data-ns-events="disable-all">Disable all events</button>
    </div>
    <div class="ns-event-grid">${items}</div>
    <p class="admin-profile-help">These switches control which order, payment, and delivery events generate admin emails. Recipients above still apply. New events default to ON so existing New Order emails stay active.</p>
  `;
}

function channelMatrixMarkup(settings) {
  const rows = Object.keys(EMAIL_EVENT_LABELS).map((eventKey) => {
    const channels = defaultChannelsForEvent(settings, eventKey);
    return `
      <tr>
        <th scope="row">${escapeHtml(EMAIL_EVENT_LABELS[eventKey])}</th>
        ${CHANNEL_COLUMNS.map((channel) => {
          const checked = Boolean(channels[channel.id]);
          const disabled = channel.planned ? "disabled" : "";
          const title = channel.planned ? "Future channel — architecture ready" : channel.label;
          return `
            <td>
              <label class="ns-channel-check" title="${attr(title)}">
                <input
                  type="checkbox"
                  name="channel.${attr(eventKey)}.${attr(channel.id)}"
                  ${checked && !channel.planned ? "checked" : ""}
                  ${disabled}
                />
                <span class="ns-channel-check__box" aria-hidden="true"></span>
                <span class="visually-hidden">${escapeHtml(channel.label)}</span>
              </label>
            </td>
          `;
        }).join("")}
      </tr>
    `;
  }).join("");

  return `
    <div class="ns-channel-toolbar">
      <button type="button" class="btn btn-ghost" data-ns-channels="enable-core">Enable Dashboard + Email</button>
      <button type="button" class="btn btn-ghost" data-ns-channels="enable-email">Enable all Email</button>
      <button type="button" class="btn btn-ghost" data-ns-channels="disable-email">Disable all Email</button>
    </div>
    <div class="ns-channel-table-wrap">
      <table class="ns-channel-table">
        <thead>
          <tr>
            <th scope="col">Event</th>
            ${CHANNEL_COLUMNS.map((channel) => `
              <th scope="col">
                ${escapeHtml(channel.label)}
                ${channel.planned ? "<small>Soon</small>" : ""}
              </th>
            `).join("")}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="admin-profile-help">Each event can target Email independently. Admin order notifications are email-only.</p>
  `;
}

function sectionCard(title, subtitle, body, options = {}) {
  const wide = options.wide ? " admin-profile-card-wide" : "";
  const extra = options.className ? ` ${options.className}` : "";
  return `
    <section class="admin-profile-card${wide}${extra}">
      <header class="admin-profile-card-header">
        <div>
          <h4>${escapeHtml(title)}</h4>
          <p>${escapeHtml(subtitle)}</p>
        </div>
        ${options.headerAction || ""}
      </header>
      ${body}
    </section>
  `;
}

function switchField(name, label, checked, help = "") {
  return `
    <label class="ns-switch">
      <span class="ns-switch__copy">
        <strong>${escapeHtml(label)}</strong>
        ${help ? `<small>${escapeHtml(help)}</small>` : ""}
      </span>
      <span class="ns-switch__control">
        <input type="checkbox" name="${attr(name)}" ${checked ? "checked" : ""} />
        <span class="ns-switch__track" aria-hidden="true"></span>
      </span>
    </label>
  `;
}

function recipientSlot(settings, slot) {
  const list = Array.isArray(settings.emailRecipients) ? settings.emailRecipients : [];
  const found = list.find((item) => Number(item.slot) === slot);
  if (found) return found;
  if (slot === 1) {
    return {
      slot: 1,
      email: settings.adminNotificationEmail || "",
      enabled: settings.adminNotificationEmailEnabled !== false,
      active: Boolean(settings.adminNotificationEmailEnabled !== false && (settings.adminNotificationEmail || settings.effectiveAdminNotificationEmail)),
      effectiveEmail: settings.effectiveAdminNotificationEmail || ""
    };
  }
  return {
    slot: 2,
    email: settings.adminNotificationEmail2 || "",
    enabled: settings.adminNotificationEmail2Enabled !== false,
    active: Boolean(settings.adminNotificationEmail2Enabled !== false && settings.adminNotificationEmail2),
    effectiveEmail: ""
  };
}

function recipientStatusBadge(slotInfo) {
  if (slotInfo.active) {
    return `<span class="ns-status-badge ns-status-badge--connected">Enabled</span>`;
  }
  if (slotInfo.enabled) {
    return `<span class="ns-status-badge ns-status-badge--not_connected">Enabled · No email</span>`;
  }
  return `<span class="ns-status-badge ns-status-badge--disabled">Disabled</span>`;
}

function recipientCard(slot, settings, fieldError = "") {
  const info = recipientSlot(settings, slot);
  const name = slot === 1 ? "adminNotificationEmail" : "adminNotificationEmail2";
  const enabledName = slot === 1 ? "adminNotificationEmailEnabled" : "adminNotificationEmail2Enabled";
  const invalid = Boolean(fieldError && (slot === 1 || String(fieldError).toLowerCase().includes("second")));
  return `
    <article class="ns-recipient-card">
      <header class="ns-recipient-card__head">
        <div>
          <h5>Recipient ${slot}</h5>
          <p>Receives automatic BYOSE Market order and payment emails.</p>
        </div>
        ${recipientStatusBadge(info)}
      </header>
      <label class="admin-field">
        <span>Email address</span>
        <input
          class="input ${invalid ? "is-invalid" : ""}"
          type="email"
          name="${attr(name)}"
          value="${attr(info.email || "")}"
          placeholder="${slot === 1 ? "ops@yourdomain.com" : "manager@yourdomain.com"}"
          autocomplete="email"
          inputmode="email"
          aria-label="Email Recipient ${slot}"
        />
        <small>${info.effectiveEmail && info.effectiveEmail !== info.email
          ? `Currently sending to ${escapeHtml(info.effectiveEmail)} until you save a replacement.`
          : "Leave empty to remove this recipient."}</small>
      </label>
      <div class="ns-recipient-card__actions">
        ${switchField(
          enabledName,
          "Enabled",
          info.enabled !== false,
          slot === 1
            ? "When disabled, Recipient 1 does not receive notifications."
            : "When disabled, Recipient 2 does not receive notifications."
        )}
        <button type="button" class="btn btn-ghost" data-ns-clear="${slot}">Clear email</button>
      </div>
    </article>
  `;
}

function connectionBadge(transport = {}) {
  const code = String(transport.connectionStatus || (transport.configured ? "not_connected" : "configuration_required"));
  const label = transport.connectionLabel
    || (code === "connected" ? "Connected" : code === "configuration_required" ? "Configuration Required" : "Not Connected");
  return `<span class="ns-status-badge ns-status-badge--${escapeHtml(code)}">${escapeHtml(label)}</span>`;
}

function readFormSettings(form) {
  const data = new FormData(form);
  const emailEventPreferences = {};
  const eventChannelPreferences = {};
  Object.keys(EMAIL_EVENT_LABELS).forEach((key) => {
    const channels = {};
    CHANNEL_COLUMNS.forEach((channel) => {
      if (channel.planned) {
        channels[channel.id] = false;
        return;
      }
      channels[channel.id] = Boolean(data.get(`channel.${key}.${channel.id}`));
    });
    const hasDedicated = Boolean(form.querySelector(`[name="emailEvent.${key}"]`));
    const emailOn = hasDedicated
      ? Boolean(data.get(`emailEvent.${key}`))
      : Boolean(channels.email);
    channels.email = emailOn;
    eventChannelPreferences[key] = channels;
    emailEventPreferences[key] = emailOn;
  });
  return {
    adminNotificationEmail: String(data.get("adminNotificationEmail") || "").trim().toLowerCase(),
    adminNotificationEmail2: String(data.get("adminNotificationEmail2") || "").trim().toLowerCase(),
    adminNotificationEmailEnabled: Boolean(data.get("adminNotificationEmailEnabled")),
    adminNotificationEmail2Enabled: Boolean(data.get("adminNotificationEmail2Enabled")),
    emailNotificationsEnabled: Boolean(data.get("emailNotificationsEnabled")),
    browserNotificationsEnabled: Boolean(data.get("browserNotificationsEnabled")),
    soundNotificationsEnabled: Boolean(data.get("soundNotificationsEnabled")),
    notificationSoundId: String(data.get("notificationSoundId") || "soft").trim().toLowerCase() || "soft",
    emailEventPreferences,
    eventChannelPreferences
  };
}

export async function renderAdminNotificationsPanel(container) {
  let settings = {};
  let automation = null;
  let notice = "";
  let noticeTone = "success";
  let saving = false;
  let testing = false;
  let fieldError = "";
  let loading = true;
  let browserPermission = (typeof Notification !== "undefined" && Notification.permission) || "default";

  function paint() {
    if (loading) {
      container.innerHTML = `
        <div class="admin-profile-page notification-settings-page">
          <header class="admin-profile-hero ns-hero">
            <div>
              <p class="admin-profile-eyebrow">Admin Settings</p>
              <h2>Notification Settings</h2>
              <p class="admin-profile-username">Loading communication hub configuration…</p>
            </div>
          </header>
          <div class="state-block">Loading notification settings…</div>
        </div>
      `;
      return;
    }

    const transport = settings.emailTransport || {};
    const sounds = Array.isArray(settings.availableNotificationSounds) && settings.availableNotificationSounds.length
      ? settings.availableNotificationSounds
      : [
        { id: "soft", label: "Soft Tone" },
        { id: "chime", label: "Chime" },
        { id: "alert", label: "Alert Pulse" }
      ];
    const soundId = String(settings.notificationSoundId || "soft");
    const hubChannels = CHANNEL_COLUMNS;
    const browserDenied = browserPermission === "denied";

    container.innerHTML = `
      <div class="admin-profile-page notification-settings-page">
        <header class="admin-profile-hero ns-hero">
          <div>
            <p class="admin-profile-eyebrow">Admin Settings</p>
            <h2>Notification Settings</h2>
            <p class="admin-profile-username">Configure email recipients and which order, payment, and delivery events send admin emails. SMTP credentials stay on the VPS.</p>
          </div>
          <div class="ns-hero-actions">
            <a class="btn btn-ghost" href="#/notifications">Notification Center</a>
            <a class="btn btn-ghost" href="#/notificationanalytics">Analytics</a>
            <a class="btn btn-ghost" href="#/notificationmonitoring">Monitoring</a>
            <button type="button" class="btn btn-primary" id="nsSaveTopBtn" ${saving ? "disabled" : ""}>${saving ? "Saving…" : "Save Settings"}</button>
          </div>
        </header>

        ${notice ? `<div class="notification-center-notice notification-center-notice--${escapeHtml(noticeTone)}" role="status">${escapeHtml(notice)}</div>` : ""}
        ${browserDenied
          ? `<div class="notification-center-notice notification-center-notice--warn" role="status">Browser notifications are blocked by this browser. Enable them in site permissions to receive desktop alerts.</div>`
          : ""}

        <form id="notificationSettingsForm" class="ns-layout" novalidate>
          ${sectionCard(
            "Email Notification Recipients",
            "These addresses receive automatic BYOSE Market notifications when customers place orders and when payment status changes. SMTP credentials stay on the server and are not edited here.",
            `
              <div class="ns-recipient-grid">
                ${recipientCard(1, settings, fieldError)}
                ${recipientCard(2, settings, fieldError)}
              </div>
              <div class="ns-effective-row">
                <div>
                  <span>Active recipients</span>
                  <strong>${escapeHtml(
                    (Array.isArray(settings.effectiveAdminNotificationEmails) && settings.effectiveAdminNotificationEmails.length
                      ? settings.effectiveAdminNotificationEmails.join(", ")
                      : "None — emails will not be sent")
                  )}</strong>
                </div>
                <div>
                  <span>Email channel</span>
                  <strong>${settings.emailNotificationsEnabled === false ? "Disabled" : "Enabled"}</strong>
                </div>
              </div>
              ${switchField(
                "emailNotificationsEnabled",
                "Enable Email Notifications",
                settings.emailNotificationsEnabled !== false,
                "Master switch for all admin alert emails. Individual recipients can still be turned off above."
              )}
              <div class="ns-test-row">
                <button type="button" class="btn btn-primary" id="nsTestEmailBtn" ${testing ? "disabled" : ""}>
                  ${testing ? "Sending test…" : "Send Test Email"}
                </button>
                <small>Sends only to currently enabled recipients. Saving settings does not send an email.</small>
              </div>
            `
          )}

          ${sectionCard(
            "Email Notification Events",
            "Choose which order, payment, and delivery events send email to the active recipients. Turning one event off does not affect the others.",
            emailEventTogglesMarkup(settings),
            { wide: true }
          )}

          ${sectionCard(
            "Channel Preferences by Event",
            "Choose which channels deliver each business event. Admin order notifications use Email. Dashboard, browser, and sound alerts remain available in the admin panel.",
            channelMatrixMarkup(settings),
            { wide: true, className: "ns-channel-card" }
          )}

          ${sectionCard(
            "Communication Hub Status",
            "Independent channel adapters used by the background delivery pipeline.",
            `
              <div class="ns-provider-grid">
                ${hubChannels.map((channel) => `
                  <div>
                    <span>${escapeHtml(channel.label || channel.id)}</span>
                    <strong>${channel.planned ? "Planned" : "Ready"}</strong>
                  </div>
                `).join("")}
              </div>
            `
          )}

          ${sectionCard(
            "Browser Notifications",
            "Show desktop notifications when the admin tab is in the background.",
            `
              ${switchField(
                "browserNotificationsEnabled",
                "Enable Browser Notifications",
                settings.browserNotificationsEnabled !== false,
                "Master switch. Per-event Browser columns in the matrix also apply."
              )}
              <p class="admin-profile-help">Browser notifications never receive SMTP secrets and only show notification titles and messages already visible in the admin panel.</p>
            `
          )}

          ${sectionCard(
            "Sound Notifications",
            "Play a short tone when a new unread notification arrives.",
            `
              ${switchField(
                "soundNotificationsEnabled",
                "Enable Sound Notifications",
                Boolean(settings.soundNotificationsEnabled),
                "Plays locally in this browser session when new alerts arrive."
              )}
              <label class="admin-field ns-sound-field">
                <span>Notification Sound</span>
                <div class="ns-sound-row">
                  <select class="input" name="notificationSoundId" aria-label="Notification sound">
                    ${sounds.map((sound) => `
                      <option value="${attr(sound.id)}" ${soundId === sound.id ? "selected" : ""}>${escapeHtml(sound.label || sound.id)}</option>
                    `).join("")}
                  </select>
                  <button type="button" class="btn btn-ghost" id="nsPreviewSoundBtn">Preview</button>
                </div>
              </label>
            `
          )}

          ${sectionCard(
            "Background Automation",
            "Business events are queued and processed independently from checkout and admin UI requests.",
            `
              <div class="ns-provider-grid">
                <div><span>Worker</span><strong>${automation?.workerRunning ? "Running" : "Stopped"}</strong></div>
                <div><span>Pending jobs</span><strong>${escapeHtml(String(automation?.jobs?.pending ?? "—"))}</strong></div>
                <div><span>Completed</span><strong>${escapeHtml(String(automation?.jobs?.completed ?? "—"))}</strong></div>
                <div><span>Failed</span><strong>${escapeHtml(String(automation?.jobs?.failed ?? "—"))}</strong></div>
                <div><span>Batch size</span><strong>${escapeHtml(String(automation?.batchSize ?? "—"))}</strong></div>
                <div><span>Interval</span><strong>${automation?.intervalMs != null ? `${escapeHtml(String(automation.intervalMs))} ms` : "—"}</strong></div>
              </div>
              <p class="admin-profile-help">Failed jobs retry automatically. Duplicate events are skipped. Email delivery uses Notification Settings and environment SMTP configuration. Admin notifications are email-only.</p>
            `
          )}

          ${sectionCard(
            "Email Provider Status",
            "SMTP credentials stay on the VPS. Passwords are never shown in this interface.",
            `
              <div class="ns-provider-status">
                <div class="ns-provider-status__head">
                  <div>
                    <span class="ns-provider-kicker">Provider</span>
                    <strong>${escapeHtml(String(transport.provider || "smtp").toUpperCase())}</strong>
                  </div>
                  ${connectionBadge(transport)}
                </div>
                <p class="ns-provider-detail">${escapeHtml(transport.connectionDetail || "Status unavailable.")}</p>
                <div class="ns-provider-grid">
                  <div><span>Configured</span><strong>${transport.configured ? "Yes" : "No"}</strong></div>
                  <div><span>Host</span><strong>${escapeHtml(transport.host || "—")}</strong></div>
                  <div><span>Port</span><strong>${escapeHtml(transport.port || "—")}</strong></div>
                  <div><span>Secure</span><strong>${transport.secure ? "Yes" : "No"}</strong></div>
                  <div><span>From</span><strong>${escapeHtml([transport.fromName, transport.fromAddress].filter(Boolean).join(" · ") || "—")}</strong></div>
                  <div><span>Ready for delivery</span><strong>${settings.readyForEmailDelivery ? "Yes" : "Not yet"}</strong></div>
                </div>
                <p class="admin-profile-help">SMTP host, username, and password stay on the VPS. This page only controls who receives notifications, not how mail is sent.</p>
              </div>
            `,
            { wide: true }
          )}

          <div class="admin-profile-actions ns-footer-actions">
            <button type="submit" class="btn btn-primary" ${saving ? "disabled" : ""}>${saving ? "Saving…" : "Save Notification Settings"}</button>
          </div>
        </form>
      </div>
    `;
  }

  async function saveSettings() {
    const form = container.querySelector("#notificationSettingsForm");
    if (!form || saving) return;
    const payload = readFormSettings(form);
    fieldError = "";

    if (payload.adminNotificationEmail && !isValidEmail(payload.adminNotificationEmail)) {
      fieldError = "Enter a valid email address for Recipient 1.";
      notice = "Invalid email";
      noticeTone = "danger";
      paint();
      return;
    }

    if (payload.adminNotificationEmail2 && !isValidEmail(payload.adminNotificationEmail2)) {
      fieldError = "Enter a valid email address for Recipient 2.";
      notice = "Invalid email";
      noticeTone = "danger";
      paint();
      return;
    }

    saving = true;
    notice = "";
    paint();

    try {
      settings = await updateNotificationSettings(payload);
      setCachedNotificationPrefs(settings);
      if (settings.browserNotificationsEnabled !== false) {
        browserPermission = await requestBrowserNotificationPermission();
        if (browserPermission === "denied") {
          notice = "Settings saved, but browser notifications are blocked by this browser.";
          noticeTone = "warn";
        } else {
          notice = "Saved successfully. Future order emails will use these recipients.";
          noticeTone = "success";
        }
      } else {
        notice = "Saved successfully. Future order emails will use these recipients.";
        noticeTone = "success";
      }
      fieldError = "";
      window.dispatchEvent(new CustomEvent("admin:notifications-changed"));
    } catch (error) {
      notice = error?.message || "Unable to save";
      noticeTone = "danger";
      if (error?.details && typeof error.details === "object") {
        const first = Object.values(error.details)[0];
        if (first) {
          notice = String(first);
          fieldError = String(first);
        }
      }
    } finally {
      saving = false;
      paint();
    }
  }

  async function sendTestEmail() {
    if (testing) return;
    testing = true;
    notice = "";
    paint();
    try {
      // Persist current form first so the test uses the email shown on screen.
      const form = container.querySelector("#notificationSettingsForm");
      if (form) {
        const payload = readFormSettings(form);
        if (payload.adminNotificationEmail && !isValidEmail(payload.adminNotificationEmail)) {
          throw Object.assign(new Error("Enter a valid notification email before sending a test."), {
            details: { adminNotificationEmail: "Enter a valid notification email address." }
          });
        }
        if (payload.adminNotificationEmail2 && !isValidEmail(payload.adminNotificationEmail2)) {
          throw Object.assign(new Error("Enter a valid second notification email before sending a test."), {
            details: { adminNotificationEmail2: "Enter a valid second notification email address." }
          });
        }
        settings = await updateNotificationSettings({
          ...payload,
          // Keep email enabled for a meaningful test when the form has a destination.
          emailNotificationsEnabled: payload.emailNotificationsEnabled
        });
        setCachedNotificationPrefs(settings);
      }

      const result = await sendNotificationTestEmail({});
      if (result.partial) {
        notice = result.message || "Test email sent to some recipients and failed for others.";
        noticeTone = "warn";
      } else {
        notice = result.message || "Test email sent successfully.";
        noticeTone = "success";
      }
    } catch (error) {
      notice = error?.code === "TEST_EMAIL_SEND_FAILED" || /test email failed/i.test(String(error?.message || ""))
        ? "Test email failed."
        : (error?.message || "Test email failed.");
      noticeTone = "danger";
      if (notice !== "Test email failed." && error?.details && typeof error.details === "object") {
        const first = Object.values(error.details).find((value) => typeof value === "string" && value.trim());
        if (first) notice = String(first);
      }
    } finally {
      testing = false;
      paint();
    }
  }

  paint();
  try {
    settings = await getNotificationSettings();
    setCachedNotificationPrefs(settings);
  } catch (error) {
    notice = error?.message || "Unable to load notification settings.";
    noticeTone = "danger";
  }
  try {
    automation = await getNotificationAutomationStatus();
  } catch (_error) {
    automation = null;
  }
  if (typeof Notification !== "undefined") {
    browserPermission = Notification.permission || "default";
  }
  loading = false;
  paint();

  container.onsubmit = async (event) => {
    if (!event.target?.closest?.("#notificationSettingsForm")) return;
    event.preventDefault();
    await saveSettings();
  };

  container.onclick = async (event) => {
    if (event.target?.closest?.("#nsSaveTopBtn")) {
      event.preventDefault();
      await saveSettings();
      return;
    }

    if (event.target?.closest?.("#nsTestEmailBtn")) {
      event.preventDefault();
      await sendTestEmail();
      return;
    }

    const clearBtn = event.target?.closest?.("[data-ns-clear]");
    if (clearBtn) {
      event.preventDefault();
      const slot = String(clearBtn.getAttribute("data-ns-clear") || "");
      const inputName = slot === "2" ? "adminNotificationEmail2" : "adminNotificationEmail";
      const input = container.querySelector(`[name="${inputName}"]`);
      if (input) input.value = "";
      return;
    }

    if (event.target?.closest?.("#nsPreviewSoundBtn")) {
      event.preventDefault();
      const form = container.querySelector("#notificationSettingsForm");
      const selected = form?.querySelector?.('[name="notificationSoundId"]')?.value
        || settings.notificationSoundId
        || "soft";
      playNotificationSound(selected);
      return;
    }

    const channelsBtn = event.target?.closest?.("[data-ns-channels]");
    if (channelsBtn) {
      event.preventDefault();
      const mode = channelsBtn.getAttribute("data-ns-channels");
      if (mode === "enable-core") {
        container.querySelectorAll('input[type="checkbox"][name^="channel."][name$=".in_app"]').forEach((input) => {
          if (!input.disabled) input.checked = true;
        });
        container.querySelectorAll('input[type="checkbox"][name^="channel."][name$=".email"]').forEach((input) => {
          if (!input.disabled) input.checked = true;
        });
        container.querySelectorAll('input[type="checkbox"][name^="emailEvent."]').forEach((input) => {
          input.checked = true;
        });
      } else if (mode === "enable-email") {
        container.querySelectorAll('input[type="checkbox"][name^="channel."][name$=".email"]').forEach((input) => {
          if (!input.disabled) input.checked = true;
        });
        container.querySelectorAll('input[type="checkbox"][name^="emailEvent."]').forEach((input) => {
          input.checked = true;
        });
      } else if (mode === "disable-email") {
        container.querySelectorAll('input[type="checkbox"][name^="channel."][name$=".email"]').forEach((input) => {
          if (!input.disabled) input.checked = false;
        });
        container.querySelectorAll('input[type="checkbox"][name^="emailEvent."]').forEach((input) => {
          input.checked = false;
        });
      }
    }

    const eventsBtn = event.target?.closest?.("[data-ns-events]");
    if (eventsBtn) {
      event.preventDefault();
      const mode = eventsBtn.getAttribute("data-ns-events");
      const enable = mode === "enable-all";
      container.querySelectorAll('input[type="checkbox"][name^="emailEvent."]').forEach((input) => {
        input.checked = enable;
      });
      container.querySelectorAll('input[type="checkbox"][name^="channel."][name$=".email"]').forEach((input) => {
        if (!input.disabled) input.checked = enable;
      });
    }
  };

  container.onchange = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox" || !target.name) return;
    const eventMatch = target.name.match(/^emailEvent\.(.+)$/);
    if (eventMatch) {
      const other = container.querySelector(`[name="channel.${eventMatch[1]}.email"]`);
      if (other) other.checked = target.checked;
      return;
    }
    const channelMatch = target.name.match(/^channel\.(.+)\.email$/);
    if (channelMatch) {
      const other = container.querySelector(`[name="emailEvent.${channelMatch[1]}"]`);
      if (other) other.checked = target.checked;
    }
  };
}
