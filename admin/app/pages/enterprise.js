import { badge, emptyState, escapeHtml, formatDate, table } from "../components/ui.js";
import * as api from "../core/api.js";
import {
  getActivityLogs,
  getAdminSecurityEvents,
  getCustomers,
  getDashboard,
  getMessages,
  getNotificationCenter,
  getNotificationMonitoringHealth,
  getNotificationOpsLogs,
  getOrders,
  getProducts,
  bulkDeleteMessages,
  bulkDeleteOrders,
  bulkUpdateMessageStatus,
  bulkUpdateOrderStatus
} from "../services/admin-data.service.js";
import {
  buildEnterpriseSearchIndex,
  buildReportRows,
  downloadCsvFile,
  downloadJsonFile,
  openPrintableReport,
  searchEnterpriseRecords
} from "../services/enterprise-intelligence.service.js";
import {
  bindEnterpriseConsoleActions,
  buildEnterpriseConsoleMarkup,
  buildEnterpriseConsoleModel,
  renderEnterpriseConsoleLoading
} from "./enterprise-console.js";

function readEnterpriseSearchQuery() {
  const hash = String(window.location.hash || "");
  const queryStart = hash.indexOf("?");
  if (queryStart < 0) {
    return "";
  }

  const params = new URLSearchParams(hash.slice(queryStart + 1));
  return String(params.get("q") || params.get("search") || "").trim();
}

function settledValue(result, fallback = null) {
  return result?.status === "fulfilled" ? result.value : fallback;
}

function settledError(result) {
  return result?.status === "rejected" ? String(result.reason?.message || "Request failed") : "";
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function readConsoleSession() {
  try {
    const security = window.AdminSecurity;
    const snapshot = security && typeof security.getSessionSnapshot === "function"
      ? security.getSessionSnapshot()
      : null;
    const authenticated = Boolean(
      (security && typeof security.isAuthenticated === "function" && security.isAuthenticated())
      || snapshot?.authenticated
    );
    const hasToken = Boolean(String(snapshot?.token || "").trim());
    const jwtProtected = authenticated && hasToken;
    const online = typeof navigator === "undefined" ? null : navigator.onLine !== false;

    return {
      checked: true,
      authenticated,
      jwtProtected,
      online,
      label: jwtProtected ? "Secure session" : (authenticated ? "Session active" : "Session unavailable"),
      detail: jwtProtected ? "JWT validation is active." : (authenticated ? "A session is present but a JWT token is not available." : "Sign-in is required.")
    };
  } catch (_error) {
    return {
      checked: false,
      authenticated: false,
      jwtProtected: false,
      online: typeof navigator === "undefined" ? null : navigator.onLine !== false,
      label: "Session unavailable",
      detail: "Session status could not be read."
    };
  }
}

async function probeRealtimePing() {
  const checkedAt = new Date().toISOString();
  const payload = await api.get("realtime/ping");
  return {
    ok: payload?.success === true,
    timestamp: payload?.timestamp || checkedAt,
    checkedAt
  };
}

function healthzCandidates() {
  const apiBase = String(window.AdminConfig?.apiBaseUrl || "").replace(/\/+$/, "");
  const origin = apiBase.replace(/\/api$/i, "");
  return [...new Set(["/healthz", origin ? `${origin}/healthz` : ""].filter(Boolean))];
}

async function probeHealthz() {
  const checkedAt = new Date().toISOString();
  let lastError = "";

  for (const url of healthzCandidates()) {
    try {
      const response = await fetch(url, { cache: "no-store", credentials: "omit" });
      const payload = await response.json().catch(() => null);
      if (!payload || typeof payload !== "object") {
        lastError = `Health endpoint at ${url} did not return JSON.`;
        continue;
      }
      if (payload.status || typeof payload.dbConnected === "boolean") {
        return {
          checked: true,
          ok: response.ok,
          status: String(payload.status || ""),
          dbConnected: typeof payload.dbConnected === "boolean" ? payload.dbConnected : null,
          checkedAt
        };
      }
    } catch (error) {
      lastError = String(error?.message || "Health endpoint is not available.");
    }
  }

  const error = new Error(lastError || "Backend health endpoint is not available.");
  error.code = "HEALTHZ_UNAVAILABLE";
  throw error;
}

function toneForValue(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("deliver") || normalized.includes("complete") || normalized.includes("paid") || normalized.includes("resolved")) return "success";
  if (normalized.includes("cancel") || normalized.includes("return") || normalized.includes("error") || normalized.includes("blocked")) return "danger";
  if (normalized.includes("pending") || normalized.includes("review") || normalized.includes("warn") || normalized.includes("low")) return "warn";
  return "neutral";
}

function statusLabel(record) {
  return String(record?.status || record?.orderStatus || record?.paymentStatus || "Open").trim() || "Open";
}

function buildSearchRows(records, selectedIds) {
  return records.map((record) => {
    const isSelected = selectedIds.has(record.id);
    return [
      {
        html: `
          <label class="enterprise-checkbox">
            <input type="checkbox" data-record-id="${escapeHtml(record.id)}" data-record-type="${escapeHtml(record.type)}" ${isSelected ? "checked" : ""} />
            <span></span>
          </label>
        `
      },
      record.type,
      `${record.title} | ${record.subtitle || ""}`,
      { html: badge(statusLabel(record), toneForValue(record.status)) },
      formatDate(record.date),
      record.source?.id || record.id
    ];
  });
}

function visibleRecords(data, state) {
  let records = searchEnterpriseRecords(data.searchIndex, state.query, { type: state.type, status: state.status });

  if (state.sort === "newest") {
    records = records.sort((left, right) => new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime());
  } else if (state.sort === "oldest") {
    records = records.sort((left, right) => new Date(left.date || 0).getTime() - new Date(right.date || 0).getTime());
  } else if (state.sort === "value") {
    records = records.sort((left, right) => {
      const rightValue = Number(right?.source?.totalSpent || right?.source?.total || right?.source?.price || right?.source?.revenue || 0);
      const leftValue = Number(left?.source?.totalSpent || left?.source?.total || left?.source?.price || left?.source?.revenue || 0);
      return rightValue - leftValue;
    });
  }

  return records.slice(0, 80);
}

function buildLookupMarkup(data, state) {
  const records = visibleRecords(data, state);
  const searchRows = buildSearchRows(records, state.selectedRecordIds);
  const selectedSummary = `Selected ${state.selectedOrderIds.size} orders and ${state.selectedMessageIds.size} messages`;

  return `
    <section class="ecc-panel ecc-lookup" aria-labelledby="ecc-lookup-title">
      <header class="ecc-panel-head">
        <div>
          <h2 id="ecc-lookup-title">Record lookup</h2>
          <p>Search live orders, customers, products, and messages. Bulk actions apply to checked records.</p>
        </div>
      </header>
      <div class="enterprise-toolbar-fields">
        <label><span>Global Search</span><input id="enterpriseSearchInput" type="search" value="${escapeHtml(state.query)}" placeholder="Search orders, customers, products, messages, activity" /></label>
        <label><span>Type</span><select id="enterpriseTypeFilter">
          <option value="all">All records</option>
          <option value="Order">Orders</option>
          <option value="Customer">Customers</option>
          <option value="Product">Products</option>
          <option value="Message">Messages</option>
          <option value="Activity">Activity</option>
        </select></label>
        <label><span>Status</span><select id="enterpriseStatusFilter">
          <option value="all">All statuses</option>
          <option value="Pending">Pending</option>
          <option value="Confirmed">Confirmed</option>
          <option value="Shipping">Shipping</option>
          <option value="Delivered">Delivered</option>
          <option value="Cancelled">Cancelled</option>
          <option value="Resolved">Resolved</option>
          <option value="Reviewed">Reviewed</option>
          <option value="New">New</option>
        </select></label>
        <label><span>Sort</span><select id="enterpriseSortFilter">
          <option value="relevance">Best match</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="value">Highest value</option>
        </select></label>
      </div>
      <div class="enterprise-report-actions">
        <button class="btn btn-secondary" type="button" data-export="orders-csv">Export Orders CSV</button>
        <button class="btn btn-secondary" type="button" data-export="customers-csv">Export Customers CSV</button>
        <button class="btn btn-secondary" type="button" data-export="products-csv">Export Products CSV</button>
        <button class="btn btn-secondary" type="button" data-export="activity-csv">Export Activity CSV</button>
        <button class="btn btn-secondary" type="button" data-export-json>Download JSON Snapshot</button>
        <button class="btn btn-primary" type="button" data-export="print-report">Print report</button>
      </div>
      <div class="enterprise-bulk-actions">
        <div>
          <strong>${escapeHtml(selectedSummary)}</strong>
          <p>Bulk actions apply to checked orders and messages from the search results.</p>
        </div>
        <div class="enterprise-bulk-buttons">
          <button class="btn btn-secondary" type="button" data-bulk-order="Confirmed">Mark Orders Confirmed</button>
          <button class="btn btn-secondary" type="button" data-bulk-order="Shipping">Mark Orders Shipping</button>
          <button class="btn btn-secondary" type="button" data-bulk-order="Delivered">Mark Orders Delivered</button>
          <button class="btn btn-secondary" type="button" data-bulk-message="Reviewed">Mark Messages Reviewed</button>
          <button class="btn btn-secondary" type="button" data-bulk-message="Resolved">Mark Messages Resolved</button>
          <button class="btn btn-secondary" type="button" data-bulk-delete-orders>Delete Selected Orders</button>
          <button class="btn btn-secondary" type="button" data-bulk-delete-messages>Delete Selected Messages</button>
        </div>
      </div>
      ${records.length ? table(["Select", "Type", "Record", "Status", "Date", "ID"], searchRows) : emptyState("No records match the current filters.")}
    </section>
  `;
}

async function loadEnterprisePayload(force = false) {
  const fetchOptions = force ? { force: true, emit: false } : { emit: false };
  const [
    pingResult,
    healthzResult,
    dashboardResult,
    ordersResult,
    productsResult,
    customersResult,
    activityResult,
    messagesResult,
    notificationsResult,
    notificationHealthResult,
    securityEventsResult,
    opsLogsResult
  ] = await Promise.allSettled([
    probeRealtimePing(),
    probeHealthz(),
    getDashboard({ ...fetchOptions, silent: true }),
    getOrders(fetchOptions),
    getProducts(fetchOptions),
    getCustomers(fetchOptions),
    getActivityLogs(fetchOptions),
    getMessages(fetchOptions),
    getNotificationCenter({ force: Boolean(force), limit: 8 }),
    getNotificationMonitoringHealth(),
    getAdminSecurityEvents({ limit: 40 }),
    getNotificationOpsLogs({ limit: 20 })
  ]);

  return {
    session: readConsoleSession(),
    ping: settledValue(pingResult),
    pingFailed: pingResult.status === "rejected" || settledValue(pingResult)?.ok === false,
    pingError: pingResult.status === "rejected"
      ? settledError(pingResult)
      : (settledValue(pingResult)?.ok === false ? "Realtime ping did not report success." : ""),
    healthz: settledValue(healthzResult),
    healthzFailed: healthzResult.status === "rejected",
    dashboard: settledValue(dashboardResult),
    dashboardFailed: dashboardResult.status === "rejected",
    orders: asList(settledValue(ordersResult)),
    ordersFailed: ordersResult.status === "rejected",
    ordersError: settledError(ordersResult) || "Unable to retrieve order operational status.",
    products: asList(settledValue(productsResult)),
    productsFailed: productsResult.status === "rejected",
    productsError: settledError(productsResult) || "Unable to retrieve inventory operational status.",
    customers: asList(settledValue(customersResult)),
    customersFailed: customersResult.status === "rejected",
    activity: asList(settledValue(activityResult)),
    activityFailed: activityResult.status === "rejected",
    activityError: settledError(activityResult) || "Unable to retrieve activity logs.",
    messages: asList(settledValue(messagesResult)),
    messagesFailed: messagesResult.status === "rejected",
    notifications: settledValue(notificationsResult),
    notificationsFailed: notificationsResult.status === "rejected",
    notificationsError: settledError(notificationsResult) || "Unable to retrieve notifications.",
    notificationHealth: settledValue(notificationHealthResult),
    notificationHealthFailed: notificationHealthResult.status === "rejected",
    notificationHealthError: settledError(notificationHealthResult) || "Unable to retrieve notification health status.",
    securityEvents: asObject(settledValue(securityEventsResult)),
    securityEventsFailed: securityEventsResult.status === "rejected",
    securityEventsError: settledError(securityEventsResult) || "Unable to retrieve admin activity.",
    opsLogs: settledValue(opsLogsResult),
    opsLogsFailed: opsLogsResult.status === "rejected",
    opsLogsError: settledError(opsLogsResult) || "Unable to retrieve system events.",
    refreshedAt: new Date().toISOString()
  };
}

function ensureLookupState(container) {
  if (!container._enterpriseLookupState) {
    container._enterpriseLookupState = {
      query: readEnterpriseSearchQuery(),
      type: "all",
      status: "all",
      sort: "relevance",
      selectedOrderIds: new Set(),
      selectedMessageIds: new Set(),
      selectedRecordIds: new Set()
    };
  } else if (!container._enterpriseLookupState.query) {
    const fromHash = readEnterpriseSearchQuery();
    if (fromHash) {
      container._enterpriseLookupState.query = fromHash;
    }
  }
  return container._enterpriseLookupState;
}

function updateSelectionFromDom(container, state) {
  state.selectedOrderIds = new Set();
  state.selectedMessageIds = new Set();
  state.selectedRecordIds = new Set();

  container.querySelectorAll("[data-record-id]:checked").forEach((node) => {
    const recordId = String(node.dataset.recordId || "").trim();
    const recordType = String(node.dataset.recordType || "").trim();
    if (!recordId) {
      return;
    }

    state.selectedRecordIds.add(recordId);
    if (recordType === "Order") {
      state.selectedOrderIds.add(recordId);
    }
    if (recordType === "Message") {
      state.selectedMessageIds.add(recordId);
    }
  });
}

function paintEnterprise(container) {
  const payload = container._enterprisePayload || {};
  const state = ensureLookupState(container);
  const data = {
    searchIndex: buildEnterpriseSearchIndex({
      orders: payload.orders,
      customers: payload.customers,
      products: payload.products,
      messages: payload.messages,
      activity: payload.activity,
      carts: []
    }),
    reportRows: buildReportRows({
      orders: payload.orders,
      customers: payload.customers,
      products: payload.products,
      messages: payload.messages,
      activity: payload.activity,
      carts: []
    })
  };

  const model = buildEnterpriseConsoleModel(payload, {
    activityFilter: container._enterpriseActivityFilter || "all",
    searchQuery: state.query
  });

  container.innerHTML = buildEnterpriseConsoleMarkup(model, {
    lookupHtml: buildLookupMarkup(data, state)
  });

  bindEnterpriseConsoleActions(container, {
    onRefresh: ({ force } = {}) => {
      void refreshEnterprise(container, { force: force !== false });
    },
    onFilter: (filter) => {
      container._enterpriseActivityFilter = filter;
      paintEnterprise(container);
    }
  });

  const searchInput = document.getElementById("enterpriseSearchInput");
  const typeFilter = document.getElementById("enterpriseTypeFilter");
  const statusFilter = document.getElementById("enterpriseStatusFilter");
  const sortFilter = document.getElementById("enterpriseSortFilter");

  if (searchInput) searchInput.value = state.query;
  if (typeFilter) typeFilter.value = state.type;
  if (statusFilter) statusFilter.value = state.status;
  if (sortFilter) sortFilter.value = state.sort;

  const updateFromControls = () => {
    state.query = String(searchInput?.value || "");
    state.type = String(typeFilter?.value || "all");
    state.status = String(statusFilter?.value || "all");
    state.sort = String(sortFilter?.value || "relevance");
    paintEnterprise(container);
  };

  searchInput?.addEventListener("input", updateFromControls);
  typeFilter?.addEventListener("change", updateFromControls);
  statusFilter?.addEventListener("change", updateFromControls);
  sortFilter?.addEventListener("change", updateFromControls);

  container.querySelectorAll("[data-record-id]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      updateSelectionFromDom(container, state);
    });
  });

  container.querySelectorAll("[data-export]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = String(button.dataset.export || "");
      if (action === "orders-csv") {
        downloadCsvFile("enterprise-orders.csv", data.reportRows.orders);
      }
      if (action === "customers-csv") {
        downloadCsvFile("enterprise-customers.csv", data.reportRows.customers);
      }
      if (action === "products-csv") {
        downloadCsvFile("enterprise-products.csv", data.reportRows.products);
      }
      if (action === "activity-csv") {
        downloadCsvFile("enterprise-activity.csv", data.reportRows.activity);
      }
      if (action === "print-report") {
        openPrintableReport("Enterprise Console Report", [
          {
            title: "System status",
            content: `<p>${escapeHtml(model.summary.label)} — ${escapeHtml(model.summary.detail)}</p>`
          },
          {
            title: "Alerts",
            content: model.alerts.length
              ? `<ul class="bullet-list">${model.alerts.map((alert) => `<li>${escapeHtml(alert.title)}: ${escapeHtml(alert.description)}</li>`).join("")}</ul>`
              : "<p>No active alerts</p>"
          }
        ]);
      }
    });
  });

  container.querySelector("[data-export-json]")?.addEventListener("click", () => {
    downloadJsonFile("enterprise-console-snapshot.json", {
      refreshedAt: payload.refreshedAt,
      summary: model.summary,
      services: model.services,
      operational: model.operational,
      alerts: model.alerts
    });
  });

  container.querySelectorAll("[data-bulk-order]").forEach((button) => {
    button.addEventListener("click", async () => {
      const selectedOrders = Array.from(state.selectedOrderIds);
      if (!selectedOrders.length) {
        window.alert("Select at least one order first.");
        return;
      }

      const nextStatus = String(button.dataset.bulkOrder || "");
      if (!window.confirm(`Update ${selectedOrders.length} selected order(s) to ${nextStatus}?`)) {
        return;
      }

      try {
        await bulkUpdateOrderStatus(selectedOrders, nextStatus);
        state.selectedOrderIds.clear();
        state.selectedRecordIds.clear();
        await refreshEnterprise(container, { force: true });
      } catch (error) {
        window.alert(error?.message || "Unable to update selected orders right now.");
      }
    });
  });

  container.querySelectorAll("[data-bulk-message]").forEach((button) => {
    button.addEventListener("click", async () => {
      const selectedMessages = Array.from(state.selectedMessageIds);
      if (!selectedMessages.length) {
        window.alert("Select at least one message first.");
        return;
      }

      const nextStatus = String(button.dataset.bulkMessage || "");
      if (!window.confirm(`Update ${selectedMessages.length} selected message(s) to ${nextStatus}?`)) {
        return;
      }

      try {
        await bulkUpdateMessageStatus(selectedMessages, nextStatus);
        state.selectedMessageIds.clear();
        state.selectedRecordIds.clear();
        await refreshEnterprise(container, { force: true });
      } catch (error) {
        window.alert(error?.message || "Unable to update selected messages right now.");
      }
    });
  });

  container.querySelector("[data-bulk-delete-orders]")?.addEventListener("click", async () => {
    const selectedOrders = Array.from(state.selectedOrderIds);
    if (!selectedOrders.length) {
      window.alert("Select at least one order first.");
      return;
    }

    if (!window.confirm(`Delete ${selectedOrders.length} selected order(s)?`)) {
      return;
    }

    try {
      await bulkDeleteOrders(selectedOrders);
      state.selectedOrderIds.clear();
      state.selectedRecordIds.clear();
      await refreshEnterprise(container, { force: true });
    } catch (error) {
      window.alert(error?.message || "Unable to delete selected orders right now.");
    }
  });

  container.querySelector("[data-bulk-delete-messages]")?.addEventListener("click", async () => {
    const selectedMessages = Array.from(state.selectedMessageIds);
    if (!selectedMessages.length) {
      window.alert("Select at least one message first.");
      return;
    }

    if (!window.confirm(`Delete ${selectedMessages.length} selected message(s)?`)) {
      return;
    }

    try {
      await bulkDeleteMessages(selectedMessages);
      state.selectedMessageIds.clear();
      state.selectedRecordIds.clear();
      await refreshEnterprise(container, { force: true });
    } catch (error) {
      window.alert(error?.message || "Unable to delete selected messages right now.");
    }
  });

}

async function refreshEnterprise(container, options = {}) {
  if (container._enterpriseRefreshInFlight) {
    return;
  }

  container._enterpriseRefreshInFlight = true;
  container.innerHTML = renderEnterpriseConsoleLoading();

  try {
    container._enterprisePayload = await loadEnterprisePayload(Boolean(options.force));
    paintEnterprise(container);
  } catch (error) {
    container.innerHTML = `
      <section class="ecc-root">
        <header class="ecc-header">
          <div>
            <h1>Enterprise Console</h1>
            <p class="ecc-lede">Operational &amp; System Control Center</p>
          </div>
          <button type="button" class="btn btn-secondary" data-enterprise-refresh>Retry</button>
        </header>
        <div class="ecc-error" role="alert">
          <p>${escapeHtml(error?.message || "Unable to load Enterprise Console right now.")}</p>
        </div>
        <div id="enterpriseSearchInputWrap"><input id="enterpriseSearchInput" type="search" placeholder="Search orders, customers, products, messages, activity" /></div>
      </section>
    `;
    container.querySelector("[data-enterprise-refresh]")?.addEventListener("click", () => {
      void refreshEnterprise(container, { force: true });
    });
  } finally {
    container._enterpriseRefreshInFlight = false;
  }
}

export async function renderEnterprise(container) {
  container._enterpriseActivityFilter = container._enterpriseActivityFilter || "all";
  ensureLookupState(container);
  await refreshEnterprise(container, { force: false });
}
