import { emptyState, escapeHtml, formatDate } from "../components/ui.js";
import {
  getNotificationMonitoring,
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

  function paint() {
    const health = data?.health || {};
    const components = health.components || {};
    const metrics = data?.metrics || {};
    const logs = Array.isArray(data?.recentLogs) ? data.recentLogs : [];
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
            ${metricCard("Notifications processed", metrics.totalNotificationsProcessed)}
            ${metricCard("Emails sent", metrics.emailsSent)}
            ${metricCard("Failed emails", metrics.failedEmails)}
            ${metricCard("Retry count", metrics.retryCount)}
            ${metricCard("Queue pending", metrics.queuePending)}
            ${metricCard("Queue failed", metrics.queueFailed)}
            ${metricCard("Unread in-app", metrics.unreadNotifications)}
            ${metricCard("Failed jobs (24h)", metrics.failedJobsLast24h)}
          </div>
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
                ["Sound", data?.channels?.sound],
                ["SMS", data?.channels?.sms],
                ["WhatsApp", data?.channels?.whatsapp],
                ["Push", data?.channels?.push]
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
