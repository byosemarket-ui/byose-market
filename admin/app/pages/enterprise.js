import { badge, emptyState, formatCurrency, formatDate, loadingState, panel, statCard, table, openModal } from "../components/ui.js";
import { getActivityLogs, getAnalytics, getCarts, getCustomers, getDashboard, getInventory, getMessages, getOrders, getProducts, getRealtimeIntelligence, bulkDeleteMessages, bulkDeleteOrders, bulkUpdateMessageStatus, bulkUpdateOrderStatus } from "../services/admin-data.service.js";
import { buildBestSellingProducts, buildBehaviorInsights, buildEnterpriseSearchIndex, buildExecutiveSummary, buildGroupedActivity, buildOperationalAlerts, buildReportRows, buildRevenueForecast, buildTopCustomers, downloadCsvFile, downloadJsonFile, openPrintableReport, searchEnterpriseRecords } from "../services/enterprise-intelligence.service.js";

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
            <input type="checkbox" data-record-id="${record.id}" data-record-type="${record.type}" ${isSelected ? "checked" : ""} />
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

function buildFeedRows(groupedActivity) {
  return groupedActivity.flatMap((group) => group.latest.map((entry) => [
    group.type,
    entry?.path || entry?.event || entry?.type || "-",
    entry?.device || entry?.level || "info",
    formatDate(entry?.createdAt || entry?.timestamp)
  ]));
}

function buildReportModal(summary, alerts, topCustomers, bestSellers, groupedActivity) {
  return `
    <div class="enterprise-report-preview">
      <div class="enterprise-report-pill-row">
        ${summary.map((item) => `<span class="enterprise-report-pill"><strong>${item.label}:</strong> ${item.value}</span>`).join("")}
      </div>
      <div class="enterprise-report-columns">
        <div>
          <h4>Alerts</h4>
          <ul class="bullet-list">${alerts.map((alert) => `<li>${alert.title}: ${alert.detail}</li>`).join("")}</ul>
        </div>
        <div>
          <h4>Top Customers</h4>
          <ul class="bullet-list">${topCustomers.slice(0, 5).map((customer) => `<li>${customer.name} • ${formatCurrency(customer.totalSpent)}</li>`).join("")}</ul>
        </div>
        <div>
          <h4>Best Sellers</h4>
          <ul class="bullet-list">${bestSellers.slice(0, 5).map((product) => `<li>${product.name} • ${formatCurrency(product.revenue)}</li>`).join("")}</ul>
        </div>
        <div>
          <h4>Activity Groups</h4>
          <ul class="bullet-list">${groupedActivity.slice(0, 5).map((group) => `<li>${group.type} • ${group.count}</li>`).join("")}</ul>
        </div>
      </div>
    </div>
  `;
}

export async function renderEnterprise(container) {
  container.innerHTML = loadingState("Loading enterprise command center...");

  try {
    const [intelligence, dashboard, analytics, inventory, orders, customers, products, messages, activity, carts] = await Promise.all([
      getRealtimeIntelligence(),
      getDashboard(),
      getAnalytics(),
      getInventory(),
      getOrders(),
      getCustomers(),
      getProducts(),
      getMessages(),
      getActivityLogs(),
      getCarts()
    ]);

    const feeds = intelligence?.feeds || {};
    const orderList = Array.isArray(feeds.orders) && feeds.orders.length ? feeds.orders : orders;
    const customerList = Array.isArray(feeds.customers) && feeds.customers.length ? feeds.customers : customers;
    const productList = Array.isArray(feeds.products) && feeds.products.length ? feeds.products : products;
    const messageList = Array.isArray(feeds.messages) && feeds.messages.length ? feeds.messages : messages;
    const activityList = Array.isArray(feeds.activity) && feeds.activity.length ? feeds.activity : activity;
    const cartList = Array.isArray(feeds.carts) && feeds.carts.length ? feeds.carts : carts;
    const searchIndex = buildEnterpriseSearchIndex({ orders: orderList, customers: customerList, products: productList, messages: messageList, activity: activityList, carts: cartList });

    const topCustomers = buildTopCustomers(customerList);
    const bestSellers = buildBestSellingProducts(analytics, orderList);
    const forecast = buildRevenueForecast(analytics);
    const behavior = buildBehaviorInsights({ customers: customerList, activity: activityList, messages: messageList });
    const groupedActivity = buildGroupedActivity(activityList);
    const alerts = buildOperationalAlerts({ intelligence, analytics, inventory, dashboard, orders: orderList, customers: customerList, products: productList, messages: messageList, activity: activityList, carts: cartList });
    const summary = buildExecutiveSummary({ dashboard, analytics, intelligence, inventory, alerts, forecast, behavior });
    const reportRows = buildReportRows({ orders: orderList, customers: customerList, products: productList, messages: messageList, activity: activityList, carts: cartList });

    const state = {
      query: "",
      type: "all",
      status: "all",
      sort: "relevance",
      selectedOrderIds: new Set(),
      selectedMessageIds: new Set(),
      selectedRecordIds: new Set()
    };

    const data = {
      intelligence,
      dashboard,
      analytics,
      inventory,
      orders: orderList,
      customers: customerList,
      products: productList,
      messages: messageList,
      activity: activityList,
      carts: cartList,
      searchIndex,
      topCustomers,
      bestSellers,
      forecast,
      behavior,
      groupedActivity,
      alerts,
      summary,
      reportRows
    };

    function visibleRecords() {
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

    async function reload() {
      container.innerHTML = loadingState("Refreshing enterprise command center...");
      try {
        const [nextIntelligence, nextDashboard, nextAnalytics, nextInventory, nextOrders, nextCustomers, nextProducts, nextMessages, nextActivity, nextCarts] = await Promise.all([
          getRealtimeIntelligence(),
          getDashboard(),
          getAnalytics(),
          getInventory(),
          getOrders(),
          getCustomers(),
          getProducts(),
          getMessages(),
          getActivityLogs(),
          getCarts()
        ]);

        const nextFeeds = nextIntelligence?.feeds || {};
        data.intelligence = nextIntelligence;
        data.dashboard = nextDashboard;
        data.analytics = nextAnalytics;
        data.inventory = nextInventory;
        data.orders = Array.isArray(nextFeeds.orders) && nextFeeds.orders.length ? nextFeeds.orders : nextOrders;
        data.customers = Array.isArray(nextFeeds.customers) && nextFeeds.customers.length ? nextFeeds.customers : nextCustomers;
        data.products = Array.isArray(nextFeeds.products) && nextFeeds.products.length ? nextFeeds.products : nextProducts;
        data.messages = Array.isArray(nextFeeds.messages) && nextFeeds.messages.length ? nextFeeds.messages : nextMessages;
        data.activity = Array.isArray(nextFeeds.activity) && nextFeeds.activity.length ? nextFeeds.activity : nextActivity;
        data.carts = Array.isArray(nextFeeds.carts) && nextFeeds.carts.length ? nextFeeds.carts : nextCarts;
        data.searchIndex = buildEnterpriseSearchIndex({ orders: data.orders, customers: data.customers, products: data.products, messages: data.messages, activity: data.activity, carts: data.carts });
        data.topCustomers = buildTopCustomers(data.customers);
        data.bestSellers = buildBestSellingProducts(data.analytics, data.orders);
        data.forecast = buildRevenueForecast(data.analytics);
        data.behavior = buildBehaviorInsights({ customers: data.customers, activity: data.activity, messages: data.messages });
        data.groupedActivity = buildGroupedActivity(data.activity);
        data.alerts = buildOperationalAlerts({ intelligence: data.intelligence, analytics: data.analytics, inventory: data.inventory, dashboard: data.dashboard, orders: data.orders, customers: data.customers, products: data.products, messages: data.messages, activity: data.activity, carts: data.carts });
        data.summary = buildExecutiveSummary({ dashboard: data.dashboard, analytics: data.analytics, intelligence: data.intelligence, inventory: data.inventory, alerts: data.alerts, forecast: data.forecast, behavior: data.behavior });
        data.reportRows = buildReportRows({ orders: data.orders, customers: data.customers, products: data.products, messages: data.messages, activity: data.activity, carts: data.carts });
        render();
      } catch (error) {
        container.innerHTML = panel("Enterprise Operations", "Command center", emptyState(error?.message || "Unable to refresh enterprise data right now."));
      }
    }

    function updateSelectionFromDom() {
      state.selectedOrderIds = new Set();
      state.selectedMessageIds = new Set();
      state.selectedRecordIds = new Set();

      container.querySelectorAll('[data-record-id]:checked').forEach((node) => {
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

    function render() {
      const records = visibleRecords();
      const selectedSummary = `Selected ${state.selectedOrderIds.size} orders and ${state.selectedMessageIds.size} messages`;
      const searchRows = buildSearchRows(records, state.selectedRecordIds);
      const alertsMarkup = data.alerts.map((alert) => `<article class="enterprise-alert enterprise-alert--${alert.tone}"><strong>${alert.title}</strong><p>${alert.detail}</p></article>`).join("");
      const shortcutsMarkup = [
        ["Orders", "#/orders", "Review queues"],
        ["Inventory", "#/inventory", "Stock and replenishment"],
        ["Analytics", "#/analytics", "Revenue and conversion"],
        ["Activity", "#/activity", "Monitoring logs"],
        ["Dashboard", "#/dashboard", "Overview and KPIs"],
        ["Settings", "#/settings", "Admin preferences"]
      ].map(([label, href, note]) => `<a class="enterprise-shortcut" href="${href}"><strong>${label}</strong><span>${note}</span></a>`).join("");

      const orderRows = data.orders.slice(0, 12).map((order) => [
        order?.id || order?.orderId || "-",
        order?.customerName || "Guest",
        formatCurrency(order?.total || order?.totalAmount || order?.totalPrice || 0),
        { html: badge(order?.status || "Pending", toneForValue(order?.status)) },
        formatDate(order?.date || order?.createdAt)
      ]);

      const customerRows = data.customers.slice(0, 10).map((customer) => [
        customer?.name || "Unnamed",
        customer?.email || "-",
        String(customer?.totalOrders || 0),
        formatCurrency(customer?.totalSpent || 0),
        formatDate(customer?.joinedAt || customer?.createdAt)
      ]);

      const reportButtons = `
        <div class="enterprise-report-actions">
          <button class="btn btn-secondary" type="button" data-export="summary-csv">Export Executive CSV</button>
          <button class="btn btn-secondary" type="button" data-export="orders-csv">Export Orders CSV</button>
          <button class="btn btn-secondary" type="button" data-export="customers-csv">Export Customers CSV</button>
          <button class="btn btn-secondary" type="button" data-export="products-csv">Export Inventory CSV</button>
          <button class="btn btn-secondary" type="button" data-export="activity-csv">Export Activity CSV</button>
          <button class="btn btn-primary" type="button" data-export="print-report">Export PDF / Print</button>
        </div>
      `;

      const bulkActions = `
        <div class="enterprise-bulk-actions">
          <div>
            <strong>${selectedSummary}</strong>
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
      `;

      container.innerHTML = `
        <section class="enterprise-hero card">
          <div>
            <p class="hero-eyebrow">Enterprise Operations Center</p>
            <h1>Global search, reporting, alerts, and bulk administration in one control surface.</h1>
            <p>Search the live store, export executive reports, respond to suspicious activity, and run enterprise workflow actions without leaving the current admin architecture.</p>
          </div>
          <div class="enterprise-hero-actions">
            <a class="btn btn-primary" href="#/orders">Open Orders</a>
            <a class="btn btn-secondary" href="#/inventory">Open Inventory</a>
            <a class="btn btn-secondary" href="#/analytics">Open Analytics</a>
          </div>
        </section>

        <section class="enterprise-shortcuts card">
          <header class="panel-header">
            <h2>Dashboard Shortcuts</h2>
            <p>Fast navigation for the most common enterprise workflows.</p>
          </header>
          <div class="enterprise-shortcut-grid">${shortcutsMarkup}</div>
        </section>

        <section class="stats-grid enterprise-stats">
          ${summary.map((item) => statCard(item.label, String(item.value), "Enterprise intelligence snapshot")).join("")}
        </section>

        <section class="enterprise-toolbar card">
          <div class="enterprise-toolbar-fields">
            <label><span>Global Search</span><input id="enterpriseSearchInput" type="search" value="${state.query.replace(/\"/g, "&quot;")}" placeholder="Search orders, customers, products, messages, activity" /></label>
            <label><span>Type</span><select id="enterpriseTypeFilter"><option value="all">All records</option><option value="Order">Orders</option><option value="Customer">Customers</option><option value="Product">Products</option><option value="Message">Messages</option><option value="Activity">Activity</option><option value="Cart">Carts</option></select></label>
            <label><span>Status</span><select id="enterpriseStatusFilter"><option value="all">All statuses</option><option value="Pending">Pending</option><option value="Confirmed">Confirmed</option><option value="Shipping">Shipping</option><option value="Delivered">Delivered</option><option value="Cancelled">Cancelled</option><option value="Resolved">Resolved</option><option value="Reviewed">Reviewed</option><option value="New">New</option></select></label>
            <label><span>Sort</span><select id="enterpriseSortFilter"><option value="relevance">Best match</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="value">Highest value</option></select></label>
          </div>
          ${reportButtons}
        </section>

        <section class="enterprise-alert-grid">${alertsMarkup}</section>

        <section class="enterprise-operations-grid">
          ${panel("Live Search Results", "Filtered enterprise records", records.length ? table(["Select", "Type", "Record", "Status", "Date", "ID"], searchRows) : emptyState("No records match the current filters."))}
          ${panel("Bulk Actions", "Selected order and message actions", bulkActions)}
          ${panel("Recent Orders", "Live order updates", orderRows.length ? table(["Order", "Customer", "Total", "Status", "Date"], orderRows) : emptyState("No recent orders."))}
          ${panel("Top Customers", "Customer lifetime value ranking", topCustomers.length ? table(["Customer", "Email", "Orders", "Spent", "Joined"], customerRows) : emptyState("No customer intelligence available."))}
        </section>

        <section class="enterprise-insight-grid">
          ${panel("Best-Selling Products", "Revenue concentration and product demand", bestSellers.length ? table(["Product", "Quantity", "Revenue"], bestSellers.map((product) => [product.name, String(product.quantity), formatCurrency(product.revenue)])) : emptyState("No product intelligence available."))}
          ${panel("Revenue Forecast Preparation", "Short-term trend modeling", `<ul class="bullet-list"><li>Projected 30-day revenue: ${formatCurrency(forecast.projected30DayRevenue || 0)}</li><li>Daily average revenue: ${formatCurrency(forecast.dailyAverage || 0)}</li><li>Momentum: ${forecast.momentum}</li><li>${forecast.note}</li></ul>`) }
          ${panel("Customer Behavior Insights", "Loyalty and engagement signals", `<ul class="bullet-list"><li>${behavior.insight}</li><li>Returning customers: ${behavior.returningCustomers}</li><li>Engagement signals: ${behavior.engagementSignals}</li><li>Open conversations: ${behavior.openConversations}</li><li>Loyalty rate: ${Number(behavior.loyaltyRate || 0).toFixed(1)}%</li></ul>`) }
          ${panel("Smart Activity Grouping", "Grouped operational feed", buildFeedRows(groupedActivity).length ? table(["Group", "Reference", "Signal", "Date"], buildFeedRows(groupedActivity)) : emptyState("No grouped activity available."))}
          ${panel("Inventory Intelligence", "Live inventory changes and low-stock prep", table(["Product", "SKU", "Stock", "Visibility"], data.products.slice(0, 10).map((product) => [product?.name || "-", product?.sku || product?.id || "-", String(product?.stock || 0), product?.visibility || "both"]))) }
          ${panel("Enterprise Integration Report", "Downloadable report bundle", `<div class="enterprise-report-note"><p>CSV exports are available per dataset. The PDF flow opens a print-ready report preview that can be saved to PDF from the browser.</p><button class="btn btn-secondary" type="button" data-open-report>Preview Report</button><button class="btn btn-secondary" type="button" data-export-json>Download JSON Snapshot</button></div>`) }
        </section>
      `;

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
        render();
      };

      searchInput?.addEventListener("input", updateFromControls);
      typeFilter?.addEventListener("change", updateFromControls);
      statusFilter?.addEventListener("change", updateFromControls);
      sortFilter?.addEventListener("change", updateFromControls);

      container.querySelectorAll("[data-record-id]").forEach((checkbox) => {
        checkbox.addEventListener("change", () => {
          updateSelectionFromDom();
        });
      });

      container.querySelectorAll("[data-export]").forEach((button) => {
        button.addEventListener("click", () => {
          const action = String(button.dataset.export || "");
          if (action === "summary-csv") {
            downloadCsvFile("enterprise-summary.csv", data.summary.map((item) => ({ Metric: item.label, Value: item.value })));
          }
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
            openPrintableReport("Enterprise Ecommerce Report", [
              {
                title: "Executive Summary",
                content: `<div class="enterprise-report-pill-row">${data.summary.map((item) => `<span class="pill">${item.label}: ${item.value}</span>`).join("")}</div>`
              },
              {
                title: "Operational Alerts",
                content: `<ul class="bullet-list">${data.alerts.map((alert) => `<li>${alert.title}: ${alert.detail}</li>`).join("")}</ul>`
              },
              {
                title: "Top Customers",
                content: `<ul class="bullet-list">${data.topCustomers.map((customer) => `<li>${customer.name} • ${formatCurrency(customer.totalSpent)}</li>`).join("")}</ul>`
              },
              {
                title: "Best-Selling Products",
                content: `<ul class="bullet-list">${data.bestSellers.map((product) => `<li>${product.name} • ${formatCurrency(product.revenue)}</li>`).join("")}</ul>`
              },
              {
                title: "Activity Groups",
                content: `<ul class="bullet-list">${data.groupedActivity.map((group) => `<li>${group.type} • ${group.count}</li>`).join("")}</ul>`
              }
            ]);
          }
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
            await reload();
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
            await reload();
          } catch (error) {
            window.alert(error?.message || "Unable to update selected messages right now.");
          }
        });
      });

      const deleteOrdersButton = container.querySelector("[data-bulk-delete-orders]");
      deleteOrdersButton?.addEventListener("click", async () => {
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
          await reload();
        } catch (error) {
          window.alert(error?.message || "Unable to delete selected orders right now.");
        }
      });

      const deleteMessagesButton = container.querySelector("[data-bulk-delete-messages]");
      deleteMessagesButton?.addEventListener("click", async () => {
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
          await reload();
        } catch (error) {
          window.alert(error?.message || "Unable to delete selected messages right now.");
        }
      });

      const previewButton = container.querySelector("[data-open-report]");
      previewButton?.addEventListener("click", () => {
        openModal("Enterprise Integration Report", buildReportModal(data.summary, data.alerts, data.topCustomers, data.bestSellers, data.groupedActivity));
      });

      const jsonButton = container.querySelector("[data-export-json]");
      jsonButton?.addEventListener("click", () => {
        downloadJsonFile("enterprise-snapshot.json", {
          summary: data.summary,
          alerts: data.alerts,
          forecast: data.forecast,
          behavior: data.behavior,
          topCustomers: data.topCustomers,
          bestSellers: data.bestSellers,
          groupedActivity: data.groupedActivity,
          intelligence: data.intelligence,
          dashboard: data.dashboard
        });
      });
    }

    render();
  } catch (error) {
    container.innerHTML = panel("Enterprise Operations", "Command center", emptyState(error?.message || "Unable to load enterprise operations right now."));
  }
}
