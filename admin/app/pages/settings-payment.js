import { emptyState, escapeHtml, panel } from "../components/ui.js";
import {
  getAdminPayment,
  testAdminPaymentConnection,
  updateAdminPayment
} from "../services/admin-data.service.js";

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

function statusChip(payment) {
  const code = String(payment?.connection?.code || payment?.statusSummary?.code || "disabled");
  const tone = code === "connected" || code === "ready"
    ? "success"
    : (code === "configured_disabled" || code === "incomplete" || code === "credentials_incomplete" ? "warn" : "danger");
  const label = payment?.connection?.label || payment?.statusSummary?.label || "Not configured";
  return `<span class="admin-profile-chip admin-profile-chip-${tone}">${escapeHtml(label)}</span>`;
}

function credentialFieldMarkup(provider, mode, field) {
  const status = provider?.credentials?.[mode]?.fields?.[field.key] || {};
  const configured = Boolean(status.configured);
  const hint = status.hint || "";
  const shownValue = !field.secret && status.value ? String(status.value) : "";
  const placeholder = field.secret
    ? (configured ? `Configured ${hint || "••••"} — leave blank to keep` : "Enter secret value")
    : (configured ? "Update value or leave as shown" : "Enter value");

  return `
    <label class="admin-payment-cred-field">
      <span>
        ${escapeHtml(field.label)}
        ${field.required ? '<em class="admin-payment-required">required</em>' : ""}
        ${configured
          ? `<small class="admin-payment-configured">Saved${status.source === "environment" ? " (env)" : ""}</small>`
          : '<small class="admin-payment-missing">Not set</small>'}
      </span>
      <input
        type="${attr(field.inputType || (field.secret ? "password" : "text"))}"
        name="${attr(`${mode}.${field.key}`)}"
        data-payment-cred="${attr(mode)}.${attr(field.key)}"
        autocomplete="${attr(field.autocomplete || "off")}"
        spellcheck="false"
        ${field.secret ? 'value=""' : `value="${attr(shownValue)}"`}
        placeholder="${attr(placeholder)}"
      />
      ${field.help ? `<small class="admin-payment-help">${escapeHtml(field.help)}</small>` : ""}
      <small class="field-error" data-error-for="${attr(`${mode}.${field.key}`)}"></small>
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
    return emptyState("No gateway payment activity yet. Completed DPO checkouts will appear here.");
  }

  return `
    <div class="admin-payment-activity-table-wrap">
      <table class="admin-payment-activity-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Mode</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          ${activity.map((row) => `
            <tr>
              <td><strong>${escapeHtml(row.orderId || "—")}</strong></td>
              <td>${escapeHtml(row.customerName || "—")}</td>
              <td>${money(row.amount, row.currency)}</td>
              <td>
                <span class="admin-profile-chip admin-profile-chip-${String(row.paymentStatus || "").includes("paid") ? "success" : (String(row.paymentStatus || "").includes("fail") || String(row.paymentStatus || "").includes("cancel") ? "danger" : "warn")}">
                  ${escapeHtml(row.paymentStatusLabel || row.paymentStatus || "—")}
                </span>
              </td>
              <td>${escapeHtml(String(row.mode || "test").toUpperCase())}</td>
              <td>${escapeHtml(row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "—")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function paymentMarkup(payment) {
  const active = (payment?.providers || []).find((entry) => entry.id === payment.activeProvider)
    || (payment?.providers || [])[0]
    || null;
  const mode = payment?.mode === "live" ? "live" : "test";
  const encryption = payment?.encryption || {};
  const connection = payment?.connection || {};
  const endpoints = active?.endpoints?.[mode] || {};
  const stats = payment?.activityStats || {};
  const lastTest = payment?.lastTest || {};
  const canTest = payment?.capabilities?.canTestConnection !== false && mode === "test";

  return `
    <div class="admin-profile-page admin-payment-page" id="adminPaymentPage">
      <section class="admin-profile-hero">
        <div class="admin-profile-hero-main">
          <div class="admin-profile-hero-copy">
            <p class="admin-profile-kicker">Payment management</p>
            <h3>Payment Settings</h3>
            <p class="admin-profile-username">Provider controls, secure credentials, connection health, and recent gateway activity</p>
            <div class="admin-profile-chip-row">
              ${statusChip(payment)}
              <span class="admin-profile-chip">${escapeHtml(String(mode).toUpperCase())} mode</span>
              <span class="admin-profile-chip">${escapeHtml(active?.label || payment?.activeProvider || "No provider")}</span>
              <span class="admin-profile-chip ${active?.enabled === false ? "admin-profile-chip-danger" : "admin-profile-chip-success"}">
                Provider ${active?.enabled === false ? "disabled" : "enabled"}
              </span>
            </div>
          </div>
        </div>
        <div class="admin-profile-hero-meta">
          <div class="admin-profile-meta-item"><span>Gateway</span><strong>${escapeHtml(active?.label || "—")}</strong></div>
          <div class="admin-profile-meta-item"><span>Mode</span><strong>${escapeHtml(String(mode).toUpperCase())}</strong></div>
          <div class="admin-profile-meta-item"><span>Online Payments</span><strong>${payment?.enabled ? "Enabled" : "Disabled"}</strong></div>
          <div class="admin-profile-meta-item"><span>Checkout Ready</span><strong>${connection.checkoutReady ? "Yes" : "No"}</strong></div>
        </div>
      </section>

      <div class="admin-profile-grid">
        ${sectionCard(
          "Connection status",
          connection.detail || "Live view of encryption, credentials, and checkout readiness.",
          `
            <div class="admin-delivery-coverage">
              <div class="admin-profile-meta-item"><span>Status</span><strong>${escapeHtml(connection.label || "—")}</strong></div>
              <div class="admin-profile-meta-item"><span>Encryption</span><strong>${encryption.configured ? "Ready" : "Missing"}</strong></div>
              <div class="admin-profile-meta-item"><span>${escapeHtml(String(mode).toUpperCase())} credentials</span><strong>${active?.credentials?.[mode]?.ready ? "Complete" : "Incomplete"}</strong></div>
              <div class="admin-profile-meta-item"><span>Last TEST</span><strong>${lastTest.at ? (lastTest.success ? "Passed" : "Failed") : "Not run"}</strong></div>
            </div>
            ${lastTest.at ? `
              <p class="admin-profile-help">
                Last test ${escapeHtml(new Date(lastTest.at).toLocaleString())}
                · ${escapeHtml(lastTest.message || "")}
                ${lastTest.tokenHint ? `· token ${escapeHtml(lastTest.tokenHint)}` : ""}
                ${lastTest.durationMs != null ? `· ${escapeHtml(lastTest.durationMs)}ms` : ""}
              </p>
            ` : ""}
            <div class="admin-payment-test-actions">
              <button class="btn btn-ghost" type="button" id="adminPaymentTestBtn" ${canTest ? "" : "disabled"}>
                Test TEST credentials
              </button>
              <small class="admin-payment-help">
                ${canTest
                  ? "Runs a safe DPO createToken probe in TEST mode. No customer checkout is opened. Secrets are never returned."
                  : "Switch operating mode to TEST to run a safe connection test."}
              </small>
            </div>
          `,
          true
        )}

        ${sectionCard(
          "Provider & Mode",
          "Select the active gateway, enable or disable it, and choose TEST or LIVE credentials.",
          `
            <form class="settings-form admin-payment-form" id="adminPaymentConfigForm" novalidate>
              <label class="admin-general-toggle admin-delivery-span-2">
                <span>
                  <strong>Enable online payments</strong>
                  <small>Master switch for checkout gateway payments.</small>
                </span>
                <input type="checkbox" name="enabled" id="paymentEnabled" ${payment?.enabled ? "checked" : ""} />
              </label>

              <label class="admin-general-toggle admin-delivery-span-2">
                <span>
                  <strong>Enable selected provider</strong>
                  <small>Turn ${escapeHtml(active?.label || "this provider")} on or off without removing credentials.</small>
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
                <select name="mode" id="paymentMode" required>
                  <option value="test" ${mode === "test" ? "selected" : ""}>TEST (sandbox)</option>
                  <option value="live" ${mode === "live" ? "selected" : ""}>LIVE (production)</option>
                </select>
                <small class="field-error" data-error-for="mode"></small>
              </label>

              <p class="admin-profile-help admin-delivery-span-2">
                Secrets stay encrypted on the server. Leave password fields blank to keep existing Company Tokens.
                New providers can be registered in the server provider registry without rebuilding this module.
              </p>
            </form>
          `,
          true
        )}

        ${sectionCard(
          `${escapeHtml(active?.label || "Provider")} credentials`,
          `Encrypted server-side storage for TEST and LIVE. Editor follows the selected credential tab.`,
          `
            <form class="settings-form admin-payment-creds-form" id="adminPaymentCredsForm" novalidate>
              <div class="admin-payment-mode-tabs" role="tablist" aria-label="Credential mode">
                <button type="button" class="btn ${mode === "test" ? "btn-primary" : "btn-ghost"}" data-payment-mode-tab="test">TEST credentials</button>
                <button type="button" class="btn ${mode === "live" ? "btn-primary" : "btn-ghost"}" data-payment-mode-tab="live">LIVE credentials</button>
              </div>

              <div class="admin-payment-cred-grid" data-payment-cred-panel="test" ${mode === "test" ? "" : "hidden"}>
                ${(active?.credentialFields || []).map((field) => credentialFieldMarkup(active, "test", field)).join("")}
                <div class="admin-payment-endpoint-note admin-delivery-span-2">
                  <strong>TEST endpoints</strong>
                  <p>API: ${escapeHtml(active?.endpoints?.test?.apiBaseUrl || "—")}</p>
                  <p>Payment page: ${escapeHtml(active?.endpoints?.test?.paymentPageUrl || "—")}</p>
                </div>
              </div>

              <div class="admin-payment-cred-grid" data-payment-cred-panel="live" ${mode === "live" ? "" : "hidden"}>
                ${(active?.credentialFields || []).map((field) => credentialFieldMarkup(active, "live", field)).join("")}
                <div class="admin-payment-endpoint-note admin-delivery-span-2">
                  <strong>LIVE endpoints</strong>
                  <p>API: ${escapeHtml(active?.endpoints?.live?.apiBaseUrl || "—")}</p>
                  <p>Payment page: ${escapeHtml(active?.endpoints?.live?.paymentPageUrl || "—")}</p>
                </div>
              </div>
            </form>
          `,
          true
        )}

        ${sectionCard(
          "Recent payment activity",
          "Latest gateway payment attempts and settlements from checkout.",
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
                <span>Encryption key</span>
                <strong>${encryption.configured ? escapeHtml(encryption.source || "configured") : "Missing"}</strong>
              </div>
              <div class="admin-profile-meta-item">
                <span>Secret store</span>
                <strong>${escapeHtml(encryption.storePath || "server/secure/payment-credentials.enc")}</strong>
              </div>
              <div class="admin-profile-meta-item">
                <span>Active endpoint</span>
                <strong>${escapeHtml(endpoints.apiBaseUrl || "—")}</strong>
              </div>
            </div>
            <p class="admin-profile-help">
              Set <code>PAYMENT_ENCRYPTION_KEY</code> in the server <code>.env</code> (never commit it).
              Company Tokens are never returned by the API — only configured/hint status.
            </p>
            ${!encryption.configured
              ? '<p class="admin-profile-help is-error">PAYMENT_ENCRYPTION_KEY is required before credentials can be saved.</p>'
              : ""}
          `,
          true
        )}
      </div>

      <div class="admin-profile-actions">
        <button class="btn btn-primary" type="button" id="adminPaymentSaveBtn">Save payment settings</button>
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

function collectPayload(container, payment) {
  const configForm = container.querySelector("#adminPaymentConfigForm");
  const credsForm = container.querySelector("#adminPaymentCredsForm");
  const enabled = Boolean(configForm?.querySelector('[name="enabled"]')?.checked);
  const providerEnabled = Boolean(configForm?.querySelector('[name="providerEnabled"]')?.checked);
  const activeProvider = String(configForm?.querySelector('[name="activeProvider"]')?.value || payment.activeProvider || "dpo").trim();
  const mode = String(configForm?.querySelector('[name="mode"]')?.value || "test").trim().toLowerCase();

  const credentials = { test: {}, live: {} };
  ["test", "live"].forEach((credMode) => {
    (payment.providers || [])
      .find((entry) => entry.id === activeProvider)
      ?.credentialFields
      ?.forEach((field) => {
        const input = credsForm?.querySelector(`[data-payment-cred="${credMode}.${field.key}"]`);
        if (!input) return;
        const value = String(input.value || "").trim();
        if (field.secret && !value) return;
        if (!field.secret && !value) return;
        credentials[credMode][field.key] = value;
      });
  });

  return {
    enabled,
    providerEnabled,
    activeProvider,
    mode,
    credentials
  };
}

function bindPaymentPanel(container, payment) {
  const feedback = container.querySelector("#adminPaymentFeedback");
  let current = payment;

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

  container.querySelectorAll("[data-payment-mode-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextMode = button.getAttribute("data-payment-mode-tab");
      const modeSelect = container.querySelector("#paymentMode");
      if (modeSelect && (nextMode === "test" || nextMode === "live")) {
        modeSelect.value = nextMode;
      }
      container.querySelectorAll("[data-payment-cred-panel]").forEach((panelNode) => {
        panelNode.hidden = panelNode.getAttribute("data-payment-cred-panel") !== nextMode;
      });
      container.querySelectorAll("[data-payment-mode-tab]").forEach((tab) => {
        const active = tab.getAttribute("data-payment-mode-tab") === nextMode;
        tab.classList.toggle("btn-primary", active);
        tab.classList.toggle("btn-ghost", !active);
      });
    });
  });

  container.querySelector("#paymentMode")?.addEventListener("change", (event) => {
    const nextMode = String(event.target.value || "test");
    container.querySelector(`[data-payment-mode-tab="${CSS.escape(nextMode)}"]`)?.click();
  });

  container.querySelector("#adminPaymentSaveBtn")?.addEventListener("click", async () => {
    clearFieldErrors(container);
    feedback.textContent = "Saving payment settings…";
    feedback.classList.remove("is-error", "is-success");
    try {
      const saved = await updateAdminPayment(collectPayload(container, current));
      paint(saved, "Payment settings saved successfully.", "is-success");
    } catch (error) {
      feedback.textContent = error?.message || "Unable to save payment settings.";
      feedback.classList.add("is-error");
      showFieldErrors(container, error?.details || error?.payload?.details || {});
    }
  });

  container.querySelector("#adminPaymentTestBtn")?.addEventListener("click", async () => {
    feedback.textContent = "Testing TEST credentials…";
    feedback.classList.remove("is-error", "is-success");
    try {
      const result = await testAdminPaymentConnection({
        providerId: current.activeProvider || "dpo"
      });
      const nextPayment = result.payment && Object.keys(result.payment).length
        ? result.payment
        : await getAdminPayment({ force: true });
      paint(
        nextPayment,
        result.message || (result.test?.success ? "TEST connection succeeded." : "TEST connection failed."),
        result.test?.success ? "is-success" : "is-error"
      );
    } catch (error) {
      feedback.textContent = error?.message || "Unable to test payment configuration.";
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
