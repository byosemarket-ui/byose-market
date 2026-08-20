import { emptyState, escapeHtml, formatDate } from "../components/ui.js";
import {
  getNotificationMonitoring,
  retryNotificationEmailDelivery,
  runNotificationRecovery
} from "../services/admin-data.service.js";

function healthClass(code) {
  const value = String(code || "").toLowerCase();
  if (value === "healthy") return "healthy";
  if (value === "warning") return "warning";
  return "error";
}

function metricCard(label, value, hint = "") {
  return `
    <article class="nm-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value ?? "—"))}</strong>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ""}
    </article>
  `;
}

function healthCard(name, component = {}) {
  const code = healthClass(component.code);
  return `
    <article class="nm-health-card nm-health-card--${code}">
      <div class="nm-health-card__head">
        <strong>${escapeHtml(name)}</strong>
        <span class="nm-health-badge nm-health-badge--${code}">${escapeHtml(component.label || code)}</span>
      </div>
      <p>${escapeHtml(component.detail || "No detail available.")}</p>
    </article>
  `;
}

function emailSummary(title, entry) {
  if (!entry) {
    return `
      <div class="nm-email-summary">
        <strong>${escapeHtml(title)}</strong>
        <p>No records yet.</p>
      </div>
    `;
  }
  return `
    <div class="nm-email-summary">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(entry.subject || entry.eventKey || "Email event")}</p>
      <small>
        ${escapeHtml(entry.recipient || "recipient hidden/redacted")}
        · ${escapeHtml(formatDate(entry.sentAt || entry.updatedAt))}
        ${entry.error ? ` · ${escapeHtml(entry.error)}` : ""}
      </small>
    </div>
  `;
}

function statusBadge(status) {
  const value = String(status || "pending").toLowerCase();
  return `<span class="nm-status nm-status--${escapeHtml(value)}">${escapeHtml(value)}</span>`;
}

function deliveryRow(item, { retry = false, retryingId = "" } = {}) {
  const busy = retryingId && retryingId === item.id;
  return `
    <tr>
      <td><strong>${escapeHtml(item.eventKey || "EVENT")}</strong></td>
      <td>${escapeHtml(String(item.channel || "email").toUpperCase())}</td>
      <td>${escapeHtml(item.orderId ? `#${item.orderId}` : "—")}</td>
      <td>${escapeHtml(item.recipient || "—")}</td>
      <td>${statusBadge(item.status)}</td>
      <td>${escapeHtml(String(item.attempts ?? "—"))}</td>
      <td>${escapeHtml(formatDate(item.lastAttemptAt || item.sentAt || item.createdAt))}</td>
      ${retry ? `
        <td>
          <small>${escapeHtml(item.error || "Delivery failed")}</small>
          ${item.retryable !== false ? `
            <button type="button" class="btn btn-ghost" data-nm-retry="${escapeHtml(item.id)}" data-nm-channel="${escapeHtml(item.channel || "email")}" ${busy ? "disabled" : ""}>
              ${busy ? "Retrying…" : "Retry"}
            </button>
          ` : ""}
        </td>
      ` : ""}
    </tr>
  `;
}

function deliveryTable(rows, { retry = false, retryingId = "", empty = "No records yet." } = {}) {
  if (!rows.length) {
    return emptyState(empty);
  }
  return `
    <div class="nm-table-wrap">
      <table class="nm-table">
        <thead>
          <tr>
            <th>Event</th>
            <th>Channel</th>
            <th>Order</th>
            <th>Recipient</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Time</th>
            ${retry ? "<th>Error / Action</th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => deliveryRow(row, { retry, retryingId })).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function logRow(item) {
  return `
    <article class="nm-log-row nm-log-row--${escapeHtml(String(item.status || "info"))}">
      <div>
        <strong>${escapeHtml(item.eventType || "EVENT")}</strong>
        <span class="notification-pill">${escapeHtml(item.status || "info")}</span>
        <span class="notification-pill">${escapeHtml(item.channel || "system")}</span>
      </div>
      <p>${escapeHtml(item.message || "")}</p>
      <small>${escapeHtml(formatDate(item.createdAt))}</small>
    </article>
  `;
}

export async function renderNotificationMonitoring(container) {
  let data = null;
  let notice = "";
  let noticeTone = "success";
  let loading = true;
  let recovering = false;
  let retryingId = "";

  function paint() {
    const health = data?.health || {};
    const components = health.components || {};
    const metrics = data?.metrics || {};
    const logs = Array.isArray(data?.recentLogs) ? data.recentLogs : [];
    const recent = Array.isArray(data?.recentDeliveries) ? data.recentDeliveries : [];
    const failures = Array.isArray(data?.failedDeliveries) ? data.failedDeliveries : [];
    const overall = healthClass(health.overall?.code);

    container.innerHTML = `
      <div class="nm-page">
        <header class="nm-hero">
          <div>
            <p class="dashboard-eyebrow">Notifications</p>
            <h2>Notification Monitoring</h2>
            <p>System health, delivery metrics, recovery controls, and operational logs.</p>
          </div>
          <div class="nm-hero-actions">
            <a class="btn btn-ghost" href="#/notifications">History</a>
            <a class="btn btn-ghost" href="#/notificationanalytics">Analytics</a>
            <a class="btn btn-ghost" href="#/settings?panel=notifications">Settings</a>
            <button type="button" class="btn btn-primary" id="nmRecoverBtn" ${recovering || loading ? "disabled" : ""}>
              ${recovering ? "Running recovery…" : "Run Recovery Check"}
            </button>
          </div>
        </header>

        ${notice ? `<div class="notification-center-notice notification-center-notice--${escapeHtml(noticeTone)}" role="status">${escapeHtml(notice)}</div>` : ""}

        <section class="admin-profile-card nm-overall nm-overall--${overall}">
          <div>
            <span class="nm-provider-kicker">Overall status</span>
            <h3>${escapeHtml(health.overall?.label || (loading ? "Loading…" : "Unknown"))}</h3>
            <p>Last checked ${escapeHtml(formatDate(health.checkedAt || data?.generatedAt))}</p>
          </div>
          <span class="nm-health-badge nm-health-badge--${overall}">${escapeHtml(health.overall?.label || "—")}</span>
        </section>

        <section class="nm-health-grid">
          ${healthCard("Notification Engine", components.engine)}
          ${healthCard("Email Service", components.email)}
          ${healthCard("Background Processing", components.background)}
          ${healthCard("Notification Database", components.database)}
          ${healthCard("Queue Processing", components.queue)}
        </section>

        <section class="admin-profile-card">
          <header class="admin-profile-card-header">
            <div>
              <h4>Operational Metrics</h4>
              <p>Processed notifications, email outcomes, retries, and queue depth.</p>
            </div>
          </header>
          <div class="nm-metrics-grid">
            ${metricCard("Total emails", Number(metrics.emailsSent || 0) + Number(metrics.failedEmails || 0) + Number(metrics.pendingEmails || 0) + Number(metrics.retryingEmails || 0) + Number(metrics.skippedEmails || 0))}
            ${metricCard("Sent", metrics.emailsSent)}
            ${metricCard("Failed", metrics.failedEmails)}
            ${metricCard("Pending", metrics.pendingEmails)}
            ${metricCard("Retrying", metrics.retryingEmails)}
            ${metricCard("Last successful email", data?.lastSuccessfulEmail?.sentAt ? formatDate(data.lastSuccessfulEmail.sentAt) : "None")}
            ${metricCard("Retry count", metrics.retryCount)}
            ${metricCard("Queue pending", metrics.queuePending)}
            ${metricCard("Unread in-app", metrics.unreadNotifications)}
          </div>
        </section>

        <section class="admin-profile-card">
          <header class="admin-profile-card-header">
            <div>
              <h4>Recent Notifications</h4>
              <p>Latest email delivery attempts, including order ID, recipient, status, and attempt count.</p>
            </div>
          </header>
          ${loading ? `<div class="state-block">Loading monitoring data…</div>` : deliveryTable(recent, { empty: "No email deliveries recorded yet." })}
        </section>

        <section class="admin-profile-card">
          <header class="admin-profile-card-header">
            <div>
              <h4>Failures</h4>
              <p>Failed deliveries stay on this list until they succeed. Retry updates the existing record and does not create a duplicate event.</p>
            </div>
          </header>
          ${loading ? `<div class="state-block">Loading failures…</div>` : deliveryTable(failures, { retry: true, retryingId, empty: "No failed email deliveries." })}
        </section>

        <section class="nm-two-col">
          <article class="admin-profile-card">
            <header class="admin-profile-card-header">
              <div>
                <h4>Email Delivery Snapshot</h4>
                <p>Latest successful and failed outbound admin emails.</p>
              </div>
            </header>
            ${emailSummary("Last successful email", data?.lastSuccessfulEmail)}
            ${emailSummary("Last failed email", data?.lastFailedEmail)}
          </article>

          <article class="admin-profile-card">
            <header class="admin-profile-card-header">
              <div>
                <h4>Event Integration</h4>
                <p>Required business events wired into the notification engine.</p>
              </div>
            </header>
            <div class="nm-channel-list">
              ${(Array.isArray(data?.integration?.coverage) ? data.integration.coverage : []).map((row) => `
                <div>
                  <span>${escapeHtml(row.eventKey)}${Array.isArray(row.modules) && row.modules.length ? ` · ${escapeHtml(row.modules.join(", "))}` : ""}</span>
                  <strong>${row.inCatalog ? "Connected" : "Missing"}</strong>
                </div>
              `).join("") || "<p>Integration map unavailable.</p>"}
            </div>
          </article>

          <article class="admin-profile-card">
            <header class="admin-profile-card-header">
              <div>
                <h4>Communication Channels</h4>
                <p>Live and future-ready delivery adapters.</p>
              </div>
            </header>
            <div class="nm-channel-list">
              ${[
                ["In-app", data?.channels?.inApp],
                ["Email", data?.channels?.email],
                ["Browser", data?.channels?.browser],
                ["Sound", data?.channels?.sound]
              ].map(([label, info]) => {
                const stats = info?.stats;
                const detail = stats
                  ? ` · ${Number(stats.sent || 0) + Number(stats.delivered || 0)} sent / ${Number(stats.failed || 0)} failed`
                  : "";
                return `
                <div>
                  <span>${escapeHtml(label)}${escapeHtml(detail)}</span>
                  <strong>${info?.planned ? "Planned" : (info?.enabled === false ? "Off" : "Ready")}</strong>
                </div>
              `;
              }).join("")}
            </div>
          </article>
        </section>

        <section class="admin-profile-card">
          <header class="admin-profile-card-header">
            <div>
              <h4>Operations Log</h4>
              <p>Notification created, email sent/failed, retries, config changes, and system errors.</p>
            </div>
          </header>
          ${loading
            ? `<div class="state-block">Loading monitoring data…</div>`
            : logs.length
              ? `<div class="nm-log-list">${logs.map(logRow).join("")}</div>`
              : emptyState("No operations logs yet. Activity will appear as notifications are processed.")}
        </section>
      </div>
    `;
  }

  async function load() {
    loading = true;
    paint();
    try {
      data = await getNotificationMonitoring();
      notice = "";
    } catch (error) {
      data = null;
      notice = error?.message || "Unable to load notification monitoring.";
      noticeTone = "danger";
    } finally {
      loading = false;
      paint();
    }
  }

  await load();

  const refreshTimer = window.setInterval(() => {
    if (document.visibilityState === "hidden") return;
    void load();
  }, 45000);

  container.onclick = async (event) => {
    const retryBtn = event.target?.closest?.("[data-nm-retry]");
    if (retryBtn) {
      const deliveryId = retryBtn.getAttribute("data-nm-retry");
      if (!deliveryId || retryingId) return;
      retryingId = deliveryId;
      paint();
      try {
        const result = await retryNotificationEmailDelivery(deliveryId);
        notice = result.message || (result.success ? "Retry sent successfully." : "Retry attempted.");
        noticeTone = result.success ? "success" : (result.retrying ? "warn" : "danger");
        await load();
      } catch (error) {
        notice = error?.message || "Retry failed.";
        noticeTone = "danger";
        paint();
      } finally {
        retryingId = "";
        paint();
      }
      return;
    }

    if (!event.target?.closest?.("#nmRecoverBtn")) return;
    recovering = true;
    paint();
    try {
      await runNotificationRecovery();
      notice = "Recovery check completed.";
      noticeTone = "success";
      await load();
    } catch (error) {
      notice = error?.message || "Recovery check failed.";
      noticeTone = "danger";
      paint();
    } finally {
      recovering = false;
      paint();
    }
  };

  return () => {
    window.clearInterval(refreshTimer);
  };
}
