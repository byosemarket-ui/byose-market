import { chartContainer, emptyState, escapeHtml, formatDate, panel, statCard, table } from "../components/ui.js";
import {
  getNotificationAnalytics,
  getNotificationAnalyticsReport
} from "../services/admin-data.service.js";
import { downloadCsvFile, openPrintableReport } from "../services/enterprise-intelligence.service.js";

const PRESETS = [
  { value: "today", label: "Daily (Today)" },
  { value: "this_week", label: "Weekly" },
  { value: "this_month", label: "Monthly" },
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "custom", label: "Custom range" }
];

const EVENT_OPTIONS = [
  { value: "", label: "All events" },
  { value: "ORDER_CREATED", label: "New Orders" },
  { value: "PAYMENT_PENDING", label: "Payment Pending" },
  { value: "PAYMENT_RECEIVED", label: "Payment Successful" },
  { value: "PAYMENT_FAILED", label: "Payment Failed" },
  { value: "PAYMENT_CANCELLED", label: "Payment Cancelled" },
  { value: "ORDER_PROCESSING", label: "Order Processing" },
  { value: "ORDER_SHIPPED", label: "Shipments" },
  { value: "ORDER_DELIVERED", label: "Deliveries" },
  { value: "ORDER_CANCELLED", label: "Cancellations" },
  { value: "REFUND_REQUESTED", label: "Refunds" },
  { value: "REFUND_APPROVED", label: "Refunds Completed" },
  { value: "CUSTOMER_REGISTERED", label: "Customer Registrations" },
  { value: "LOW_STOCK", label: "Low Stock Alerts" },
  { value: "OUT_OF_STOCK", label: "Out of Stock" }
];

function attr(value) {
  return escapeHtml(String(value ?? ""));
}

function num(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString() : "0";
}

function formatDuration(ms) {
  const value = Number(ms || 0);
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60000) return `${(value / 1000).toFixed(1)} s`;
  return `${(value / 60000).toFixed(1)} min`;
}

function selected(current, value) {
  return String(current || "") === String(value || "") ? "selected" : "";
}

function buildQuery(state) {
  const query = {
    preset: state.preset === "custom" ? "custom" : state.preset,
    type: state.type || undefined,
    status: state.status || undefined,
    eventKey: state.eventKey || undefined,
    emailStatus: state.emailStatus || undefined
  };
  if (state.preset === "custom") {
    query.from = state.from || undefined;
    query.to = state.to || undefined;
  }
  return query;
}

function exportRows(rows = []) {
  return rows.map((row) => ({
    id: row.id,
    date: row.createdDate || "",
    createdAt: row.createdAt || "",
    event: row.eventLabel || row.eventKey || "",
    eventKey: row.eventKey || "",
    type: row.type || "",
    title: row.title || "",
    status: row.status || "",
    priority: row.priority || "",
    orderId: row.relatedOrderId || "",
    emailStatus: row.emailStatus || "",
    emailAttempts: row.emailAttempts || 0,
    emailSentAt: row.emailSentAt || "",
    emailError: row.emailError || ""
  }));
}

function buildPdfTable(rows = []) {
  const limited = rows.slice(0, 250);
  const body = limited.map((row) => `
    <tr>
      <td>${escapeHtml(row.createdDate || "")}</td>
      <td>${escapeHtml(row.eventLabel || row.eventKey || row.type || "")}</td>
      <td>${escapeHtml(row.title || "")}</td>
      <td>${escapeHtml(row.status || "")}</td>
      <td>${escapeHtml(row.emailStatus || "")}</td>
      <td>${escapeHtml(String(row.emailAttempts || 0))}</td>
    </tr>
  `).join("");

  return `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Event</th>
          <th>Title</th>
          <th>Status</th>
          <th>Email</th>
          <th>Attempts</th>
        </tr>
      </thead>
      <tbody>${body || `<tr><td colspan="6">No rows in range.</td></tr>`}</tbody>
    </table>
    ${rows.length > 250 ? `<p>Showing first 250 of ${rows.length} rows.</p>` : ""}
  `;
}

function channelRows(channels = {}) {
  return Object.entries(channels).map(([channel, stats]) => [
    channel,
    String(stats.total || 0),
    String(stats.sent || stats.delivered || 0),
    String(stats.failed || 0),
    String(stats.pending || stats.retrying || 0)
  ]);
}

export async function renderNotificationAnalytics(container) {
  const state = {
    loading: true,
    generating: false,
    exporting: false,
    notice: "",
    noticeTone: "success",
    preset: "this_month",
    from: "",
    to: "",
    type: "",
    status: "",
    eventKey: "",
    emailStatus: "",
    dashboard: null,
    report: null
  };

  async function loadDashboard() {
    state.loading = true;
    state.notice = "";
    paint();
    try {
      state.dashboard = await getNotificationAnalytics(buildQuery(state));
      const range = state.dashboard?.range || {};
      if (!state.from && range.from) state.from = range.from;
      if (!state.to && range.to) state.to = range.to;
      state.notice = "";
    } catch (error) {
      state.dashboard = null;
      state.notice = String(error?.message || error || "Failed to load analytics.");
      state.noticeTone = "danger";
    } finally {
      state.loading = false;
      paint();
    }
  }

  async function generateReport() {
    state.generating = true;
    state.notice = "";
    paint();
    try {
      state.report = await getNotificationAnalyticsReport({
        ...buildQuery(state),
        limit: 2000
      });
      state.dashboard = state.report;
      state.notice = `Report ready · ${num(state.report?.rows?.length)} rows (${state.report?.range?.from} → ${state.report?.range?.to})`;
      state.noticeTone = "success";
    } catch (error) {
      state.notice = String(error?.message || error || "Failed to generate report.");
      state.noticeTone = "danger";
    } finally {
      state.generating = false;
      paint();
    }
  }

  async function ensureReportRows() {
    if (Array.isArray(state.report?.rows) && state.report.rows.length) {
      return state.report;
    }
    const report = await getNotificationAnalyticsReport({
      ...buildQuery(state),
      limit: 2000
    });
    state.report = report;
    state.dashboard = report;
    return report;
  }

  async function exportReport(format) {
    state.exporting = true;
    state.notice = "";
    paint();
    try {
      const report = await ensureReportRows();
      const rows = exportRows(report.rows || []);
      const stamp = `${report.range?.from || "from"}_${report.range?.to || "to"}`;
      const overview = report.overview || {};
      const delivery = report.delivery || {};

      if (format === "pdf") {
        const opened = openPrintableReport(`Notification Analytics Report (${stamp})`, [
          {
            title: "Overview",
            subtitle: `Range ${report.range?.from || "—"} → ${report.range?.to || "—"}`,
            content: `
              <span class="pill">Total ${num(overview.totalNotifications)}</span>
              <span class="pill">Today ${num(overview.notificationsSentToday)}</span>
              <span class="pill">Week ${num(overview.notificationsSentThisWeek)}</span>
              <span class="pill">Month ${num(overview.notificationsSentThisMonth)}</span>
              <span class="pill">Emails sent ${num(overview.emailsSuccessfullySent)}</span>
              <span class="pill">Failed emails ${num(overview.failedEmails)}</span>
              <span class="pill">Unread ${num(overview.unreadNotifications)}</span>
              <span class="pill">Retries ${num(overview.retryAttempts)}</span>
            `
          },
          {
            title: "Delivery performance",
            content: `
              <span class="pill">Delivered ${num(delivery.successfullyDelivered)}</span>
              <span class="pill">Failed ${num(delivery.failed)}</span>
              <span class="pill">Retried ${num(delivery.retried)}</span>
              <span class="pill">Avg ${formatDuration(delivery.averageDeliveryTimeMs)}</span>
            `
          },
          {
            title: "Notification detail",
            subtitle: `${num(rows.length)} rows`,
            content: buildPdfTable(report.rows || [])
          }
        ]);
        state.notice = opened ? "PDF print dialog opened." : "Pop-up blocked. Allow pop-ups to export PDF.";
        state.noticeTone = opened ? "success" : "danger";
      } else {
        const filename = format === "excel"
          ? `byose-notification-report-${stamp}.xls`
          : `byose-notification-report-${stamp}.csv`;
        downloadCsvFile(filename, rows);
        state.notice = `${format === "excel" ? "Excel" : "CSV"} export downloaded (${num(rows.length)} rows).`;
        state.noticeTone = "success";
      }
    } catch (error) {
      state.notice = String(error?.message || error || "Export failed.");
      state.noticeTone = "danger";
    } finally {
      state.exporting = false;
      paint();
    }
  }

  function readFiltersFromDom() {
    state.preset = container.querySelector("#naPreset")?.value || "this_month";
    state.from = container.querySelector("#naFrom")?.value || "";
    state.to = container.querySelector("#naTo")?.value || "";
    state.type = container.querySelector("#naType")?.value || "";
    state.status = container.querySelector("#naStatus")?.value || "";
    state.eventKey = container.querySelector("#naEvent")?.value || "";
    state.emailStatus = container.querySelector("#naEmailStatus")?.value || "";
  }

  function bind() {
    container.querySelector("#naApplyBtn")?.addEventListener("click", async () => {
      readFiltersFromDom();
      state.report = null;
      await loadDashboard();
    });

    container.querySelector("#naPreset")?.addEventListener("change", () => {
      readFiltersFromDom();
      paint();
    });

    container.querySelector("#naGenerateBtn")?.addEventListener("click", async () => {
      readFiltersFromDom();
      await generateReport();
    });

    container.querySelector("#naExportCsvBtn")?.addEventListener("click", async () => {
      readFiltersFromDom();
      await exportReport("csv");
    });

    container.querySelector("#naExportExcelBtn")?.addEventListener("click", async () => {
      readFiltersFromDom();
      await exportReport("excel");
    });

    container.querySelector("#naExportPdfBtn")?.addEventListener("click", async () => {
      readFiltersFromDom();
      await exportReport("pdf");
    });

    container.querySelector("#naRetryBtn")?.addEventListener("click", () => {
      loadDashboard();
    });
  }

  function paint() {
    const data = state.dashboard || {};
    const overview = data.overview || {};
    const delivery = data.delivery || {};
    const events = Array.isArray(data.events) ? data.events : [];
    const range = data.range || {};
    const customVisible = state.preset === "custom";
    const busy = state.loading || state.generating || state.exporting;
    const reportRows = Array.isArray(state.report?.rows) ? state.report.rows : [];

    const eventTableRows = events.slice(0, 16).map((item) => [
      item.label || item.eventKey,
      item.eventKey || "—",
      num(item.total)
    ]);

    const reportTableRows = reportRows.slice(0, 40).map((row) => [
      formatDate(row.createdAt || row.createdDate),
      row.eventLabel || row.eventKey || row.type || "—",
      row.title || "—",
      row.status || "—",
      row.emailStatus || "n/a",
      String(row.emailAttempts || 0)
    ]);

    container.innerHTML = `
      <div class="na-page">
        <header class="na-hero">
          <div>
            <p class="dashboard-eyebrow">Notifications</p>
            <h2>Analytics &amp; Reports</h2>
            <p>Volume, event mix, delivery performance, and exportable operational reports.</p>
          </div>
          <div class="na-hero-actions">
            <a class="btn btn-ghost" href="#/notifications">History</a>
            <a class="btn btn-ghost" href="#/notificationmonitoring">Monitoring</a>
            <a class="btn btn-ghost" href="#/settings?panel=notifications">Settings</a>
          </div>
        </header>

        ${state.notice
          ? `<div class="notification-center-notice notification-center-notice--${escapeHtml(state.noticeTone)}" role="status">
              ${escapeHtml(state.notice)}
              ${state.noticeTone === "danger"
                ? `<button type="button" class="btn btn-ghost" id="naRetryBtn">Retry</button>`
                : ""}
            </div>`
          : ""}

        <section class="admin-profile-card na-filters">
          <div class="na-filters-grid">
            <label class="admin-field">
              <span>Report period</span>
              <select id="naPreset" class="input">
                ${PRESETS.map((item) => `<option value="${attr(item.value)}" ${selected(state.preset, item.value)}>${escapeHtml(item.label)}</option>`).join("")}
              </select>
            </label>
            <label class="admin-field ${customVisible ? "" : "na-hidden"}">
              <span>From</span>
              <input id="naFrom" class="input" type="date" value="${attr(state.from)}" />
            </label>
            <label class="admin-field ${customVisible ? "" : "na-hidden"}">
              <span>To</span>
              <input id="naTo" class="input" type="date" value="${attr(state.to)}" />
            </label>
            <label class="admin-field">
              <span>Notification type</span>
              <select id="naType" class="input">
                <option value="" ${selected(state.type, "")}>All types</option>
                <option value="order" ${selected(state.type, "order")}>Order</option>
                <option value="payment" ${selected(state.type, "payment")}>Payment</option>
                <option value="inventory" ${selected(state.type, "inventory")}>Inventory</option>
                <option value="customer" ${selected(state.type, "customer")}>Customer</option>
                <option value="product" ${selected(state.type, "product")}>Product</option>
                <option value="system" ${selected(state.type, "system")}>System</option>
              </select>
            </label>
            <label class="admin-field">
              <span>Delivery status</span>
              <select id="naStatus" class="input">
                <option value="" ${selected(state.status, "")}>All statuses</option>
                <option value="unread" ${selected(state.status, "unread")}>Unread</option>
                <option value="read" ${selected(state.status, "read")}>Read</option>
                <option value="archived" ${selected(state.status, "archived")}>Archived</option>
              </select>
            </label>
            <label class="admin-field">
              <span>Event type</span>
              <select id="naEvent" class="input">
                ${EVENT_OPTIONS.map((item) => `<option value="${attr(item.value)}" ${selected(state.eventKey, item.value)}>${escapeHtml(item.label)}</option>`).join("")}
              </select>
            </label>
            <label class="admin-field">
              <span>Email status</span>
              <select id="naEmailStatus" class="input">
                <option value="" ${selected(state.emailStatus, "")}>All email statuses</option>
                <option value="sent" ${selected(state.emailStatus, "sent")}>Sent</option>
                <option value="failed" ${selected(state.emailStatus, "failed")}>Failed</option>
                <option value="pending" ${selected(state.emailStatus, "pending")}>Pending</option>
                <option value="skipped" ${selected(state.emailStatus, "skipped")}>Skipped</option>
              </select>
            </label>
          </div>
          <div class="na-filter-actions">
            <button type="button" class="btn btn-primary" id="naApplyBtn" ${busy ? "disabled" : ""}>
              ${state.loading ? "Loading…" : "Apply filters"}
            </button>
            <button type="button" class="btn btn-ghost" id="naGenerateBtn" ${busy ? "disabled" : ""}>
              ${state.generating ? "Generating…" : "Generate report"}
            </button>
            <button type="button" class="btn btn-ghost" id="naExportCsvBtn" ${busy ? "disabled" : ""}>Export CSV</button>
            <button type="button" class="btn btn-ghost" id="naExportExcelBtn" ${busy ? "disabled" : ""}>Export Excel</button>
            <button type="button" class="btn btn-ghost" id="naExportPdfBtn" ${busy ? "disabled" : ""}>Export PDF</button>
          </div>
          <p class="na-range-meta">
            Active range: <strong>${escapeHtml(range.from || state.from || "—")}</strong>
            → <strong>${escapeHtml(range.to || state.to || "—")}</strong>
            · Updated ${escapeHtml(formatDate(data.generatedAt))}
          </p>
        </section>

        <section class="stats-grid na-stats">
          ${statCard("Total Notifications", num(overview.totalNotifications), "All-time platform volume")}
          ${statCard("Sent Today", num(overview.notificationsSentToday), "UTC calendar day")}
          ${statCard("Sent This Week", num(overview.notificationsSentThisWeek), "Monday–today (UTC)")}
          ${statCard("Sent This Month", num(overview.notificationsSentThisMonth), "Month-to-date (UTC)")}
          ${statCard("Emails Successfully Sent", num(overview.emailsSuccessfullySent), "Delivery ledger")}
          ${statCard("Failed Emails", num(overview.failedEmails), "Requires attention")}
          ${statCard("Pending Notifications", num(overview.pendingNotifications), "Queue + retryable email")}
          ${statCard("Unread Notifications", num(overview.unreadNotifications), "Admin inbox")}
          ${statCard("Read Notifications", num(overview.readNotifications), "Acknowledged alerts")}
          ${statCard("Retry Attempts", num(overview.retryAttempts), "Extra email attempts")}
        </section>

        <section class="na-charts">
          ${chartContainer("Notification Volume Trend", `Daily volume for ${range.from || "—"} → ${range.to || "—"}`, data.trends?.notificationSeries || [])}
          ${chartContainer("Email Delivery Trend", "Successfully sent emails by day", data.trends?.emailSeries || [])}
          ${chartContainer("Event Analytics", "Counts by notification event type", data.eventSeries || [])}
          ${chartContainer("Delivery Analytics", "Email outcome mix in selected range", data.deliverySeries || [])}
        </section>

        <section class="na-two-col">
          ${panel(
            "Event analytics",
            "Notification counts grouped by business event",
            eventTableRows.length
              ? table(["Event", "Key", "Count"], eventTableRows)
              : emptyState("No events in this range.")
          )}
          ${panel(
            "Delivery performance",
            "Email and multi-channel outcomes",
            `
              <div class="na-delivery-metrics">
                <article><span>Successfully delivered</span><strong>${num(delivery.successfullyDelivered)}</strong></article>
                <article><span>Failed</span><strong>${num(delivery.failed)}</strong></article>
                <article><span>Retried</span><strong>${num(delivery.retried)}</strong></article>
                <article><span>Pending</span><strong>${num(delivery.pending)}</strong></article>
                <article><span>Average delivery time</span><strong>${escapeHtml(formatDuration(delivery.averageDeliveryTimeMs))}</strong></article>
              </div>
              ${Object.keys(delivery.channels || {}).length
                ? table(["Channel", "Total", "Sent", "Failed", "Pending"], channelRows(delivery.channels))
                : `<p class="na-muted">Channel delivery ledger will appear once multi-channel dispatches are recorded.</p>`}
            `
          )}
        </section>

        ${panel(
          "Generated report preview",
          reportRows.length
            ? `Showing ${Math.min(40, reportRows.length)} of ${reportRows.length} rows · export for full file`
            : "Generate a report to preview filtered notification rows",
          reportTableRows.length
            ? table(["Created", "Event", "Title", "Status", "Email", "Attempts"], reportTableRows)
            : emptyState(state.loading ? "Loading analytics…" : "No report rows yet. Adjust filters and click Generate report.")
        )}
      </div>
    `;

    bind();
  }

  paint();
  await loadDashboard();
}
