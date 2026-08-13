import { emptyState, escapeHtml, panel } from "../components/ui.js";
import {
  getAdminPayment,
  updateAdminPayment
} from "../services/admin-data.service.js";

const LIVE_SERVICE_TYPE_ID = "112815";
const TEST_SERVICE_TYPE_ID = "54841";
const LIVE_SERVICE_TYPE_LABEL = "112815 — Shoes";

function attr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function money(value, currency = "RWF") {
  return `${Number(value || 0).toLocaleString("en-US")} ${escapeHtml(currency || "RWF")}`;
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

function formatLiveServiceType(value) {
  const id = String(value || "").trim();
  if (id === LIVE_SERVICE_TYPE_ID) return LIVE_SERVICE_TYPE_LABEL;
  return id || "Not set";
}

function statusChip(payment) {
  const code = String(payment?.connection?.code || payment?.statusSummary?.code || "disabled");
  const tone = code === "connected" || code === "ready"
    ? "success"
    : (code === "configured_disabled" || code === "incomplete" || code === "credentials_incomplete" || code === "live_stored_inactive" ? "warn" : "danger");
  const label = payment?.connection?.label || payment?.statusSummary?.label || "Not configured";
  return `<span class="admin-profile-chip admin-profile-chip-${tone}">${escapeHtml(label)}</span>`;
}

function credentialFieldMarkup(provider, field) {
  const status = provider?.credentials?.live?.fields?.[field.key] || {};
  const configured = Boolean(status.configured);
  const hint = status.hint || "";
  const liveServiceType = field.key === "serviceType";
  const shownValue = liveServiceType
    ? String(status.value || LIVE_SERVICE_TYPE_ID)
    : (!field.secret && status.value ? String(status.value) : "");
  const placeholder = field.secret
    ? (configured
      ? `Configured ${hint || "••••"} — leave blank to keep`
      : "Enter official DPO LIVE Company Token")
    : LIVE_SERVICE_TYPE_ID;
  const help = liveServiceType
    ? "Official LIVE Service Type ID is 112815 (112815 — Shoes). Do not enter TEST Service Type 54841."
    : "Official DPO LIVE Company Token. Stored encrypted server-side only. Leave blank to keep the existing secret.";

  return `
    <label class="admin-payment-cred-field">
      <span>
        ${escapeHtml(liveServiceType ? "Service Type ID" : "LIVE Company ID / Company Token")}
        ${field.required ? '<em class="admin-payment-required">required</em>' : ""}
        ${configured
          ? `<small class="admin-payment-configured">Saved${status.source === "environment" ? " (env)" : ""}</small>`
          : '<small class="admin-payment-missing">Not set</small>'}
      </span>
      <input
        type="${attr(field.inputType || (field.secret ? "password" : "text"))}"
        name="${attr(`live.${field.key}`)}"
        data-payment-cred="live.${attr(field.key)}"
        autocomplete="${attr(field.autocomplete || "off")}"
        spellcheck="false"
        ${field.secret ? 'value=""' : `value="${attr(shownValue)}"`}
        placeholder="${attr(placeholder)}"
      />
      <small class="admin-payment-help">${escapeHtml(help)}</small>
      <small class="field-error" data-error-for="${attr(`live.${field.key}`)}"></small>
    </label>
  `;
}

function providerOptions(payment) {
  return (payment?.providers || []).map((provider) => `
    <option value="${attr(provider.id)}" ${payment.activeProvider === provider.id ? "selected" : ""}>
      ${escapeHtml(provider.label || provider.id)}
    </option>
  `).join("");
}

function activityRows(activity = []) {
  if (!activity.length) {
                return emptyState("No LIVE gateway payment activity yet. Completed DPO LIVE checkouts will appear here.");
  }

  return `
    <div class="admin-payment-activity-table-wrap">
      <table class="admin-payment-activity-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Method</th>
            <th>Amount</th>
            <th>Payment status</th>
            <th>Mode</th>
            <th>Reference</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          ${activity.map((row) => {
            const status = String(row.paymentStatus || "").toLowerCase();
            const statusTone = status.includes("unpaid") || status.includes("awaiting") || status.includes("pending")
              ? "warn"
              : (status === "paid" || status === "success" || status === "successful"
                ? "success"
                : (status.includes("fail") || status.includes("cancel") || status.includes("decline") ? "danger" : "warn"));
            const mode = String(row.mode || "").toLowerCase() === "live" ? "live" : "test";
            const methodLabel = row.paymentMethodLabel || row.paymentMethod || "—";
            const reference = row.transRef || row.paymentReference || "—";
            return `
            <tr>
              <td><strong>${escapeHtml(row.orderId || "—")}</strong></td>
              <td>${escapeHtml(row.customerName || "—")}</td>
              <td>${escapeHtml(methodLabel)}</td>
              <td>${money(row.amount, row.currency)}</td>
              <td>
                <span class="admin-profile-chip admin-profile-chip-${statusTone}">
                  ${escapeHtml(row.paymentStatusLabel || row.paymentStatus || "—")}
                </span>
              </td>
              <td>
                <span class="admin-profile-chip ${mode === "live" ? "admin-profile-chip-success" : ""}">
                  ${escapeHtml(mode.toUpperCase())}
                </span>
              </td>
              <td>${escapeHtml(reference)}</td>
              <td>${escapeHtml(row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "—")}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function paymentMarkup(payment) {
  const active = (payment?.providers || []).find((entry) => entry.id === payment.activeProvider)
    || (payment?.providers || [])[0]
    || null;
  const encryption = payment?.encryption || {};
  const connection = payment?.connection || {};
  const stats = payment?.activityStats || {};
  const liveConfigured = Boolean(payment?.capabilities?.liveCredentialsStored || payment?.capabilities?.liveCredentialsConfigured);
  const liveConfigurationComplete = Boolean(payment?.capabilities?.liveConfigurationComplete);
  const liveServiceType = String(payment?.capabilities?.liveServiceType || "").trim();
  const liveApiEndpoint = String(payment?.capabilities?.liveApiEndpoint || active?.endpoints?.live?.apiBaseUrl || "").trim();
  const livePaymentPageUrl = String(payment?.capabilities?.livePaymentPageUrl || active?.endpoints?.live?.paymentPageUrl || "").trim();
  const liveCheckoutActive = Boolean(payment?.capabilities?.liveCheckoutActive);
  const liveConnectionVerified = Boolean(payment?.capabilities?.liveConnectionVerified);
  const liveBlockedReason = String(payment?.capabilities?.liveActivationBlockedReason || "").trim();
  const liveTokenHint = active?.credentials?.live?.fields?.companyToken?.hint || "";
  const liveApiConfigured = Boolean(payment?.capabilities?.liveApiEndpointConfigured || liveApiEndpoint);
  const livePaymentUrlConfigured = Boolean(payment?.capabilities?.livePaymentPageConfigured || livePaymentPageUrl);
  const checkoutChipClass = liveCheckoutActive ? "admin-profile-chip-success" : "admin-profile-chip-warn";

  return `
    <div class="admin-profile-page admin-payment-page" id="adminPaymentPage">
      <section class="admin-profile-hero">
        <div class="admin-profile-hero-main">
          <div class="admin-profile-hero-copy">
            <p class="admin-profile-kicker">Payment management</p>
            <h3>LIVE Payment Control Center</h3>
            <p class="admin-profile-username">Production DPO payment configuration for encrypted LIVE credentials and customer checkout</p>
            <div class="admin-profile-chip-row">
              ${statusChip(payment)}
              <span class="admin-profile-chip admin-profile-chip-success">LIVE operating</span>
              <span class="admin-profile-chip ${checkoutChipClass}">
                LIVE checkout ${liveCheckoutActive ? "active" : "inactive"}
              </span>
              <span class="admin-profile-chip ${liveConfigured ? "admin-profile-chip-success" : "admin-profile-chip-warn"}">
                LIVE credentials ${liveConfigured ? "stored" : "not stored"}
              </span>
              <span class="admin-profile-chip ${liveConfigurationComplete ? "admin-profile-chip-success" : "admin-profile-chip-warn"}">
                LIVE configuration ${liveConfigurationComplete ? "ready" : "incomplete"}
              </span>
              <span class="admin-profile-chip">${escapeHtml(active?.label || payment?.activeProvider || "DPO Pay")}</span>
              <span class="admin-profile-chip ${active?.enabled === false ? "admin-profile-chip-danger" : "admin-profile-chip-success"}">
                Provider ${active?.enabled === false ? "disabled" : "enabled"}
              </span>
              <span class="admin-profile-chip ${payment?.enabled ? "admin-profile-chip-success" : "admin-profile-chip-warn"}">
                Online payments ${payment?.enabled ? "enabled" : "disabled"}
              </span>
            </div>
          </div>
        </div>
        <div class="admin-profile-hero-meta">
          <div class="admin-profile-meta-item"><span>Gateway</span><strong>${escapeHtml(active?.label || "DPO Pay")}</strong></div>
          <div class="admin-profile-meta-item"><span>Operating mode</span><strong>LIVE</strong></div>
          <div class="admin-profile-meta-item"><span>LIVE credentials</span><strong>${liveConfigured ? `Stored${liveTokenHint ? ` ${liveTokenHint}` : ""}` : "Not stored"}</strong></div>
          <div class="admin-profile-meta-item"><span>LIVE configuration</span><strong>${liveConfigurationComplete ? "Ready" : "Incomplete"}</strong></div>
          <div class="admin-profile-meta-item"><span>LIVE Service Type</span><strong>${escapeHtml(formatLiveServiceType(liveServiceType))}</strong></div>
          <div class="admin-profile-meta-item"><span>LIVE checkout</span><strong>${liveCheckoutActive ? "Active" : "Inactive"}</strong></div>
          <div class="admin-profile-meta-item"><span>Online Payments</span><strong>${payment?.enabled ? "Enabled" : "Disabled"}</strong></div>
          <div class="admin-profile-meta-item"><span>Provider</span><strong>${active?.enabled === false ? "Disabled" : "Enabled"}</strong></div>
        </div>
      </section>

      <div class="admin-profile-grid">
        ${sectionCard(
          "LIVE connection status",
          connection.detail || "Live view of encryption, credentials, and production checkout readiness.",
          `
            <div class="admin-delivery-coverage">
              <div class="admin-profile-meta-item"><span>Operating mode</span><strong>LIVE</strong></div>
              <div class="admin-profile-meta-item"><span>LIVE credentials</span><strong>${liveConfigured ? `Stored${liveTokenHint ? ` ${liveTokenHint}` : ""}` : "Not stored"}</strong></div>
              <div class="admin-profile-meta-item"><span>LIVE configuration</span><strong>${liveConfigurationComplete ? "Ready" : "Incomplete"}</strong></div>
              <div class="admin-profile-meta-item"><span>LIVE Service Type</span><strong>${escapeHtml(formatLiveServiceType(liveServiceType))}</strong></div>
              <div class="admin-profile-meta-item"><span>LIVE API</span><strong>${liveApiConfigured ? escapeHtml(liveApiEndpoint || "Configured") : "Not set"}</strong></div>
              <div class="admin-profile-meta-item"><span>LIVE Payment URL</span><strong>${livePaymentUrlConfigured ? escapeHtml(livePaymentPageUrl || "Configured") : "Not set"}</strong></div>
              <div class="admin-profile-meta-item"><span>LIVE connection</span><strong>${liveConnectionVerified ? "Verified" : "Not yet verified"}</strong></div>
              <div class="admin-profile-meta-item"><span>LIVE checkout</span><strong>${liveCheckoutActive ? "Active" : "Inactive"}</strong></div>
              <div class="admin-profile-meta-item"><span>Encryption</span><strong>${encryption.configured ? "Ready" : "Missing"}</strong></div>
              <div class="admin-profile-meta-item"><span>Online Payments</span><strong>${payment?.enabled ? "Enabled" : "Disabled"}</strong></div>
              <div class="admin-profile-meta-item"><span>Provider</span><strong>${active?.enabled === false ? "Disabled" : "Enabled"}</strong></div>
            </div>
            ${!liveCheckoutActive && liveBlockedReason
              ? `<p class="admin-profile-help is-error">${escapeHtml(liveBlockedReason)}</p>`
              : ""}
          `,
          true
        )}

        ${sectionCard(
          "Provider controls",
          "Enable or disable online payments and the selected production gateway. Customer checkout uses this LIVE configuration only.",
          `
            <form class="settings-form admin-payment-form" id="adminPaymentConfigForm" novalidate>
              <input type="hidden" name="mode" id="paymentMode" value="live" />

              <label class="admin-general-toggle admin-delivery-span-2">
                <span>
                  <strong>Enable online payments</strong>
                  <small>Master switch for checkout gateway payments. Saves immediately when toggled.</small>
                </span>
                <input type="checkbox" name="enabled" id="paymentEnabled" ${payment?.enabled ? "checked" : ""} />
              </label>

              <label class="admin-general-toggle admin-delivery-span-2">
                <span>
                  <strong>Enable selected provider</strong>
                  <small>Turn ${escapeHtml(active?.label || "this provider")} on or off without removing credentials. Saves immediately when toggled.</small>
                </span>
                <input type="checkbox" name="providerEnabled" id="paymentProviderEnabled" ${active?.enabled === false ? "" : "checked"} />
              </label>

              <label>
                <span>Payment provider</span>
                <select name="activeProvider" id="paymentActiveProvider" required>
                  ${providerOptions(payment)}
                </select>
                <small class="field-error" data-error-for="activeProvider"></small>
              </label>

              <label>
                <span>Operating mode</span>
                <input type="text" value="LIVE" readonly aria-readonly="true" />
                <small class="admin-payment-help">Production checkout uses LIVE only. Incomplete LIVE configuration keeps online payment inactive. Cash on Delivery remains available.</small>
              </label>
            </form>
          `,
          true
        )}

        ${sectionCard(
          "LIVE credentials",
          "Encrypted server-side storage for the official DPO LIVE Company Token and Service Type.",
          `
            <form class="settings-form admin-payment-creds-form" id="adminPaymentCredsForm" novalidate>
              <div class="admin-payment-cred-grid" data-payment-cred-panel="live">
                ${(active?.credentialFields || []).map((field) => credentialFieldMarkup(active, field)).join("")}
                <div class="admin-payment-endpoint-note admin-delivery-span-2">
                  <strong>LIVE endpoints</strong>
                  <p>API: ${escapeHtml(liveApiEndpoint || "https://secure.3gdirectpay.com/API/v6/")}</p>
                  <p>Payment page: ${escapeHtml(livePaymentPageUrl || "https://secure.3gdirectpay.com/payv3.php?ID=token")}</p>
                  <p>Official LIVE API from DPO: https://secure.3gdirectpay.com/API/v6/</p>
                  <p>Official LIVE payment URL from DPO: https://secure.3gdirectpay.com/payv3.php?ID=token</p>
                  <p>Leave the Company Token blank to keep the stored secret. Service Type must be 112815.</p>
                </div>
              </div>
            </form>
          `,
          true
        )}

        ${sectionCard(
          "Recent payment activity",
          "Latest LIVE gateway payment attempts. TEST sandbox history is excluded from this production dataset.",
          `
            <div class="admin-delivery-coverage">
              <div class="admin-profile-meta-item"><span>Tracked</span><strong>${escapeHtml(stats.total || 0)}</strong></div>
              <div class="admin-profile-meta-item"><span>Paid</span><strong>${escapeHtml(stats.paid || 0)}</strong></div>
              <div class="admin-profile-meta-item"><span>Awaiting</span><strong>${escapeHtml(stats.awaiting || 0)}</strong></div>
              <div class="admin-profile-meta-item"><span>Failed / cancelled</span><strong>${escapeHtml((stats.failed || 0) + (stats.cancelled || 0))}</strong></div>
            </div>
            ${activityRows(payment?.activity || [])}
          `,
          true
        )}

        ${sectionCard(
          "Security posture",
          "How credentials are protected on this server.",
          `
            <div class="admin-delivery-coverage">
              <div class="admin-profile-meta-item">
                <span>Encryption</span>
                <strong>${encryption.configured ? "Ready" : "Missing"}</strong>
              </div>
              <div class="admin-profile-meta-item">
                <span>Secret store</span>
                <strong>${encryption.storeConfigured || encryption.configured ? "Configured" : "Not configured"}</strong>
              </div>
              <div class="admin-profile-meta-item">
                <span>Active endpoint</span>
                <strong>LIVE endpoint</strong>
              </div>
            </div>
            <p class="admin-profile-help">
              Set <code>PAYMENT_ENCRYPTION_KEY</code> in the server <code>.env</code> (never commit it). The key value is never displayed.
              Company Tokens are never returned by the API — only configured/hint status.
              LIVE Service Type must be <code>112815</code>.
              Official LIVE payment URL is <code>payv3.php</code>.
            </p>
            ${!encryption.configured
              ? '<p class="admin-profile-help is-error">PAYMENT_ENCRYPTION_KEY is required before credentials can be saved.</p>'
              : ""}
          `,
          true
        )}
      </div>

      <div class="admin-profile-actions">
        <button class="btn btn-primary" type="button" id="adminPaymentSaveBtn">Save LIVE payment settings</button>
        <button class="btn btn-ghost" type="button" id="adminPaymentReloadBtn">Reload</button>
        <p class="admin-profile-feedback" id="adminPaymentFeedback" role="status" aria-live="polite"></p>
      </div>
    </div>
  `;
}

function clearFieldErrors(container) {
  container.querySelectorAll(".field-error").forEach((node) => {
    node.textContent = "";
  });
}

function showFieldErrors(container, details = {}) {
  Object.entries(details || {}).forEach(([key, message]) => {
    const node = container.querySelector(`[data-error-for="${CSS.escape(key)}"]`);
    if (node) node.textContent = String(message || "");
  });
}

function normalizeLiveServiceType(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,12})(?:\s*[-–].*)?$/);
  return match ? match[1] : text;
}

function collectPayload(container, payment) {
  const configForm = container.querySelector("#adminPaymentConfigForm");
  const credsForm = container.querySelector("#adminPaymentCredsForm");
  const enabled = Boolean(configForm?.querySelector('[name="enabled"]')?.checked);
  const providerEnabled = Boolean(configForm?.querySelector('[name="providerEnabled"]')?.checked);
  const activeProvider = String(configForm?.querySelector('[name="activeProvider"]')?.value || payment.activeProvider || "dpo").trim();

  const credentials = { live: {} };
  (payment.providers || [])
    .find((entry) => entry.id === activeProvider)
    ?.credentialFields
    ?.forEach((field) => {
      const input = credsForm?.querySelector(`[data-payment-cred="live.${field.key}"]`);
      if (!input) return;
      const value = String(input.value || "").trim();
      if (field.secret && !value) return;
      if (!field.secret && !value) return;
      credentials.live[field.key] = value;
    });

  if (credentials.live.companyToken && !credentials.live.serviceType) {
    const serviceInput = credsForm?.querySelector('[data-payment-cred="live.serviceType"]');
    const serviceValue = String(serviceInput?.value || "").trim();
    if (serviceValue) {
      credentials.live.serviceType = serviceValue;
    }
  }

  return {
    enabled,
    providerEnabled,
    activeProvider,
    mode: "live",
    credentials
  };
}

function bindPaymentPanel(container, payment) {
  const feedback = container.querySelector("#adminPaymentFeedback");
  let current = payment;
  let toggleSaveInFlight = false;

  async function reload() {
    await renderAdminPaymentPanel(container);
  }

  function paint(nextPayment, message, tone) {
    current = nextPayment;
    container.innerHTML = panel(
      "Admin Settings",
      "Secure payment provider configuration",
      paymentMarkup(current)
    );
    bindPaymentPanel(container, current);
    const nextFeedback = container.querySelector("#adminPaymentFeedback");
    if (nextFeedback && message) {
      nextFeedback.textContent = message;
      nextFeedback.classList.remove("is-error", "is-success");
      if (tone) nextFeedback.classList.add(tone);
    }
  }

  async function persistMasterToggles({ enabled, providerEnabled }) {
    if (toggleSaveInFlight) return;
    toggleSaveInFlight = true;
    clearFieldErrors(container);
    feedback.textContent = "Saving payment switch…";
    feedback.classList.remove("is-error", "is-success");
    const enabledInput = container.querySelector("#paymentEnabled");
    const providerInput = container.querySelector("#paymentProviderEnabled");
    try {
      const saved = await updateAdminPayment({
        enabled: Boolean(enabled),
        providerEnabled: Boolean(providerEnabled),
        activeProvider: current.activeProvider || "dpo",
        mode: "live"
      });
      paint(
        saved,
        saved.enabled
          ? "Online payments enabled and saved."
          : "Online payments disabled and saved.",
        "is-success"
      );
    } catch (error) {
      if (enabledInput) enabledInput.checked = Boolean(current.enabled);
      if (providerInput) providerInput.checked = current?.providers?.find((entry) => entry.id === (current.activeProvider || "dpo"))?.enabled !== false;
      feedback.textContent = error?.message || "Unable to save payment switch.";
      feedback.classList.add("is-error");
      showFieldErrors(container, error?.details || error?.payload?.details || {});
    } finally {
      toggleSaveInFlight = false;
    }
  }

  container.querySelector("#paymentEnabled")?.addEventListener("change", (event) => {
    const enabledInput = event.currentTarget;
    const providerInput = container.querySelector("#paymentProviderEnabled");
    void persistMasterToggles({
      enabled: Boolean(enabledInput?.checked),
      providerEnabled: Boolean(providerInput?.checked)
    });
  });

  container.querySelector("#paymentProviderEnabled")?.addEventListener("change", (event) => {
    const providerInput = event.currentTarget;
    const enabledInput = container.querySelector("#paymentEnabled");
    void persistMasterToggles({
      enabled: Boolean(enabledInput?.checked),
      providerEnabled: Boolean(providerInput?.checked)
    });
  });

  container.querySelector("#adminPaymentSaveBtn")?.addEventListener("click", async () => {
    clearFieldErrors(container);
    feedback.textContent = "Saving LIVE payment settings…";
    feedback.classList.remove("is-error", "is-success");
    try {
      const payload = collectPayload(container, current);
      const serviceType = normalizeLiveServiceType(payload.credentials?.live?.serviceType);
      if (serviceType === TEST_SERVICE_TYPE_ID) {
        showFieldErrors(container, {
          "live.serviceType": "LIVE Service Type cannot be TEST Service Type 54841. Use 112815."
        });
        feedback.textContent = "LIVE Service Type cannot be TEST Service Type 54841. Use 112815.";
        feedback.classList.add("is-error");
        return;
      }
      if (serviceType && serviceType !== LIVE_SERVICE_TYPE_ID) {
        showFieldErrors(container, {
          "live.serviceType": "LIVE Service Type ID must be 112815."
        });
        feedback.textContent = "LIVE Service Type ID must be 112815.";
        feedback.classList.add("is-error");
        return;
      }
      if (payload.credentials?.live?.companyToken) {
        const confirmed = window.confirm(
          "Save a LIVE Company Token?\n\nThis must be the official DPO LIVE token.\nCustomer MTN MoMo and Card payments will use this LIVE configuration. Incomplete LIVE configuration will not fall back to another environment."
        );
        if (!confirmed) {
          feedback.textContent = "LIVE credentials were not saved.";
          return;
        }
      }
      const saved = await updateAdminPayment(payload);
      const liveReady = Boolean(saved?.capabilities?.liveConfigurationComplete);
      const liveType = String(saved?.capabilities?.liveServiceType || "").trim();
      const liveActive = Boolean(saved?.capabilities?.liveCheckoutActive);
      paint(
        saved,
        liveActive
          ? `LIVE payment settings saved. LIVE checkout is active${liveType ? ` (Service Type ${liveType})` : ""}. Secret values are not shown.`
          : (liveReady
            ? `LIVE payment settings saved. LIVE configuration is stored${liveType ? ` (Service Type ${liveType})` : ""}. LIVE checkout stays inactive until all production requirements are met.`
            : "LIVE payment settings saved. LIVE configuration is incomplete, so LIVE checkout stays inactive."),
        "is-success"
      );
    } catch (error) {
      const enabledInput = container.querySelector("#paymentEnabled");
      const providerInput = container.querySelector("#paymentProviderEnabled");
      if (enabledInput) enabledInput.checked = Boolean(current.enabled);
      if (providerInput) {
        providerInput.checked = current?.providers?.find((entry) => entry.id === (current.activeProvider || "dpo"))?.enabled !== false;
      }
      feedback.textContent = error?.message || "Unable to save payment settings.";
      feedback.classList.add("is-error");
      showFieldErrors(container, error?.details || error?.payload?.details || {});
    }
  });

  container.querySelector("#adminPaymentReloadBtn")?.addEventListener("click", reload);
}

export async function renderAdminPaymentPanel(container) {
  container.innerHTML = panel(
    "Admin Settings",
    "Loading payment settings…",
    `<p class="admin-profile-help">Fetching secure payment configuration…</p>`
  );

  try {
    const payment = await getAdminPayment({ force: true });
    container.innerHTML = panel(
      "Admin Settings",
      "Secure payment provider configuration",
      paymentMarkup(payment)
    );
    bindPaymentPanel(container, payment);
  } catch (error) {
    container.innerHTML = panel(
      "Admin Settings",
      "Payment configuration",
      emptyState(error?.message || "Unable to load payment settings.")
    );
  }
}
