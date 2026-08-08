import { badge, chartContainer, emptyState, formatCurrency, formatDate, panel, statCard, table } from "../components/ui.js";

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asPercent(value) {
  return `${asNumber(value).toFixed(2)}%`;
}

function statusTone(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("deliver") || value.includes("complete")) return "success";
  if (value.includes("cancel") || value.includes("return")) return "danger";
  if (value.includes("pending") || value.includes("review")) return "warn";
  return "neutral";
}

function deriveTopCustomers(customers) {
  return asList(customers)
    .map((customer) => ({
      name: String(customer?.name || "Customer"),
      totalSpent: asNumber(customer?.totalSpent),
      totalOrders: asNumber(customer?.totalOrders)
    }))
    .sort((left, right) => right.totalSpent - left.totalSpent || right.totalOrders - left.totalOrders)
    .slice(0, 5);
}

function deriveBestSellers(orders) {
  const lookup = new Map();

  asList(orders).forEach((order) => {
    const items = asList(order?.products);
    items.forEach((item) => {
      const key = String(item?.id || item?.productId || item?.name || item?.productName || "").trim();
      if (!key) {
        return;
      }

      const current = lookup.get(key) || {
        name: String(item?.name || item?.productName || "Product"),
        quantity: 0,
        revenue: 0
      };

      const quantity = Math.max(1, asNumber(item?.qty || item?.quantity || 1, 1));
      const price = asNumber(item?.price);
      current.quantity += quantity;
      current.revenue += quantity * price;
      lookup.set(key, current);
    });
  });

  return Array.from(lookup.values())
    .sort((left, right) => right.revenue - left.revenue)
    .slice(0, 5);
}

function buildNotifications({ alerts, failedSources, cartsCount, pendingOrders, lowStock }) {
  const notifications = [];

  asList(alerts).forEach((alert) => {
    notifications.push({
      tone: alert.tone || "neutral",
      title: alert.title || "System alert",
      detail: alert.detail || ""
    });
  });

  if (failedSources.length) {
    notifications.unshift({
      tone: "danger",
      title: "Backend feed issues",
      detail: `${failedSources.length} dashboard data source(s) failed to sync.`
    });
  }

  if (cartsCount > 0) {
    notifications.push({
      tone: "neutral",
      title: "Global cart activity",
      detail: `${cartsCount} active customer carts are currently tracked.`
    });
  }

  if (pendingOrders > 0 || lowStock > 0) {
    notifications.push({
      tone: "warn",
      title: "Operational attention",
      detail: `${pendingOrders} pending orders and ${lowStock} low-stock products need follow-up.`
    });
  }

  return notifications.slice(0, 8);
}

function buildRows(model) {
  const recentOrdersRows = model.orders.slice(0, 8).map((order) => [
    String(order?.id || order?.orderId || "-"),
    String(order?.customerName || order?.customer || "Guest"),
    formatCurrency(order?.total || order?.amount || 0),
    { html: badge(String(order?.status || "Pending"), statusTone(order?.status)) },
    formatDate(order?.date || order?.createdAt)
  ]);

  const recentCustomersRows = model.customers.slice(0, 8).map((customer) => [
    String(customer?.name || "Unnamed"),
    String(customer?.email || "-"),
    String(customer?.phone || "-"),
    String(customer?.status || "active"),
    formatDate(customer?.joinedAt || customer?.createdAt)
  ]);

  const productsRows = model.products.slice(0, 8).map((product) => {
    const stock = asNumber(product?.stock);
    return [
      String(product?.name || product?.title || "-"),
      String(product?.category || "general"),
      formatCurrency(product?.price || 0),
      { html: badge(String(stock), stock <= 5 ? "danger" : "success") },
      String(product?.sku || product?.id || "-")
    ];
  });

  const inventoryRows = model.products
    .filter((product) => asNumber(product?.stock) <= 10)
    .slice(0, 8)
    .map((product) => [
      String(product?.name || product?.title || "-"),
      String(product?.sku || product?.id || "-"),
      String(product?.stock || 0),
      { html: badge(asNumber(product?.stock) <= 5 ? "Low Stock" : "Watch", asNumber(product?.stock) <= 5 ? "danger" : "warn") }
    ]);

  const paymentRows = model.orders
    .filter((order) => asNumber(order?.total || order?.amount) > 0)
    .slice(0, 8)
    .map((order, index) => [
      String(order?.id || order?.orderId || `PAY-${index + 1}`),
      formatCurrency(order?.total || order?.amount || 0),
      { html: badge(String(order?.paymentStatus || order?.status || "Paid"), statusTone(order?.paymentStatus || order?.status)) }
    ]);

  const activityRows = model.activityLogs.slice(0, 8).map((log) => [
    String(log?.event || log?.type || "event"),
    String(log?.level || "info"),
    formatDate(log?.timestamp || log?.createdAt),
    String(log?.detail?.scope || log?.scope || "admin")
  ]);

  const cartsRows = model.carts.slice(0, 8).map((cart) => [
    String(cart?.id || "-"),
    String(cart?.userName || "Customer"),
    String(cart?.itemCount || 0),
    formatCurrency(cart?.estimatedTotal || 0),
    formatDate(cart?.updatedAt || cart?.createdAt)
  ]);

  const feedRows = model.activityFeed.slice(0, 8).map((item) => [
    item?.source || item?.type || "-",
    item?.reference || item?.id || "-",
    item?.status || item?.statusLabel || "-",
    item?.detail || item?.details || "-"
  ]);

  return {
    recentOrdersRows,
    recentCustomersRows,
    productsRows,
    inventoryRows,
    paymentRows,
    activityRows,
    cartsRows,
    feedRows
  };
}

function buildAlerts(model) {
  const alerts = [];
  if (model.lowStock > 0) alerts.push({ tone: "warn", title: "Low inventory risk", detail: `${model.lowStock} products are below threshold.` });
  if (model.pendingOrders > 15) alerts.push({ tone: "warn", title: "Order backlog", detail: `${model.pendingOrders} orders are pending fulfillment.` });
  if (model.conversionRate > 0 && model.conversionRate < 1) alerts.push({ tone: "warn", title: "Low conversion", detail: `Current conversion is ${model.conversionRate.toFixed(2)}%.` });
  if (model.fulfillmentRate > 0 && model.fulfillmentRate < 80) alerts.push({ tone: "warn", title: "Fulfillment risk", detail: `Fulfillment is ${model.fulfillmentRate.toFixed(2)}%.` });
  if (String(model.staleLabel || "").includes("h")) alerts.push({ tone: "warn", title: "Data freshness lag", detail: `Realtime data age: ${model.staleLabel}.` });
  if (!alerts.length) alerts.push({ tone: "success", title: "Operationally healthy", detail: "No high-priority risks detected." });
  return alerts;
}

export function buildDashboardModel(payload) {
  const snapshot = payload.snapshot || {};
  const analytics = payload.analytics || {};
  const stats = snapshot?.stats || {};
  const monitoring = analytics?.monitoring || {};
  const monitoringKpi = monitoring?.kpi || {};

  const orders = asList(payload.orders);
  const customers = asList(payload.customers);
  const products = asList(payload.products);
  const carts = asList(payload.carts);
  const activityLogs = asList(payload.activityLogs);
  const activityFeed = asList(snapshot?.activity);

  const weeklySalesSeries = asList(analytics?.weeklySales);
  const monthlyRevenueSeries = asList(analytics?.monthlyRevenue);
  const customerGrowthSeries = asList(analytics?.customerGrowth)
    .map((entry) => ({ label: entry.label, value: asNumber(entry.cumulative || entry.joined || 0) }));
  const visitorSeries = asList(analytics?.visitorActivity);
  const statusBreakdown = analytics?.orderStatusBreakdown && typeof analytics.orderStatusBreakdown === "object"
    ? Object.entries(analytics.orderStatusBreakdown).map(([label, value]) => ({ label, value: asNumber(value) }))
    : [];

  const revenue = asNumber(stats.revenue || stats.totalSales);
  const ordersCount = asNumber(stats.orders || stats.ordersCount || orders.length);
  const customersCount = asNumber(stats.customers || stats.customersCount || customers.length);
  const productsCount = asNumber(stats.products || stats.productsCount || products.length);
  const visitors = asNumber(stats.visitors || stats.visitsCount || snapshot?.raw?.visits?.length);
  const pendingOrders = Number.isFinite(Number(stats.pendingOrders))
    ? asNumber(stats.pendingOrders)
    : orders.filter((order) => String(order?.status || "").toLowerCase().includes("pending")).length;
  const completedOrders = Number.isFinite(Number(stats.completedOrders))
    ? asNumber(stats.completedOrders)
    : orders.filter((order) => {
      const value = String(order?.status || "").toLowerCase();
      return value.includes("deliver") || value.includes("complete");
    }).length;
  const lowStock = Number.isFinite(Number(stats.lowStock))
    ? asNumber(stats.lowStock)
    : products.filter((product) => asNumber(product?.stock) <= 5).length;
  const conversionRate = asNumber(monitoringKpi?.conversionRate);
  const fulfillmentRate = asNumber(monitoringKpi?.fulfillmentRate);
  const activeCarts = asNumber(stats.cartsWithItems || monitoringKpi?.activeCarts || carts.filter((cart) => asNumber(cart?.itemCount) > 0).length);
  const cartItemsCount = asNumber(stats.totalCartItems || monitoringKpi?.totalCartItems || carts.reduce((sum, cart) => sum + asNumber(cart?.itemCount), 0));

  const topCustomers = deriveTopCustomers(customers);
  const bestSellers = deriveBestSellers(orders);
  const forecastTotal = weeklySalesSeries.reduce((sum, entry) => sum + asNumber(entry?.total || entry?.value), 0);
  const forecast = { projected30DayRevenue: weeklySalesSeries.length ? (forecastTotal / weeklySalesSeries.length) * 30 : 0 };
  const returningCustomers = customers.filter((customer) => asNumber(customer?.totalOrders) >= 2).length;
  const behavior = { loyaltyRate: customers.length ? (returningCustomers / customers.length) * 100 : 0 };

  const alerts = buildAlerts({ pendingOrders, lowStock, conversionRate, fulfillmentRate, staleLabel: String(monitoring?.staleLabel || "just now") });
  const notifications = buildNotifications({
    alerts,
    failedSources: asList(payload.failedSources),
    cartsCount: activeCarts,
    pendingOrders,
    lowStock
  });

  return {
    orders,
    customers,
    products,
    carts,
    activityLogs,
    activityFeed,
    weeklySalesSeries,
    monthlyRevenueSeries,
    customerGrowthSeries,
    visitorSeries,
    statusBreakdown,
    revenue,
    ordersCount,
    customersCount,
    productsCount,
    visitors,
    pendingOrders,
    completedOrders,
    lowStock,
    conversionRate,
    fulfillmentRate,
    activeCarts,
    cartItemsCount,
    staleLabel: String(monitoring?.staleLabel || "just now"),
    intelligenceSource: String(monitoring?.source || "api").toUpperCase(),
    dataQuality: String(monitoring?.dataQuality || "live"),
    topCustomers,
    bestSellers,
    forecast,
    behavior,
    alerts,
    notifications
  };
}

export function buildDashboardMarkup(model) {
  const rows = buildRows(model);

  const heroMarkup = `
    <section class="hero-overview card">
      <div>
        <p class="hero-eyebrow">Performance Command Center</p>
        <h1>Modern Ecommerce Admin Dashboard</h1>
        <p>Monitor revenue, operations, customer growth, inventory risk, and team activity through one scalable, backend-connected interface.</p>
      </div>
      <div class="hero-chip-grid">
        <span class="hero-chip">${model.intelligenceSource} Sync</span>
        <span class="hero-chip">Data: ${model.dataQuality}</span>
        <span class="hero-chip">Last Refresh ${model.staleLabel}</span>
      </div>
    </section>
  `;

  const statsMarkup = `
    <section class="stats-grid stats-grid-premium">
      ${statCard("Total Revenue", formatCurrency(model.revenue), "Gross ecommerce revenue")}
      ${statCard("Total Orders", String(model.ordersCount), "All captured orders")}
      ${statCard("Total Customers", String(model.customersCount), "Registered customer records")}
      ${statCard("Total Products", String(model.productsCount), "Active catalog items")}
      ${statCard("Total Visitors", String(model.visitors), "Traffic tracking feed")}
      ${statCard("Pending Orders", String(model.pendingOrders), "Operational fulfillment queue")}
      ${statCard("Completed Orders", String(model.completedOrders), "Delivered/completed pipeline")}
      ${statCard("Low Stock Alerts", String(model.lowStock), "Requires replenishment")}
      ${statCard("Active Carts", String(model.activeCarts), "Live carts with active items")}
      ${statCard("Cart Items", String(model.cartItemsCount), "Items currently in customer carts")}
      ${statCard("Conversion Rate", asPercent(model.conversionRate), "Orders vs tracked visits")}
      ${statCard("Fulfillment Rate", asPercent(model.fulfillmentRate), "Completed orders ratio")}
    </section>
  `;

  const shortcutsMarkup = `
    <section class="enterprise-shortcuts card dashboard-shortcuts">
      <header class="panel-header">
        <h2>Fast Workflows</h2>
        <p>Jump directly into the highest-value operational paths.</p>
      </header>
      <div class="enterprise-shortcut-grid">
        <a class="enterprise-shortcut" href="#/enterprise"><strong>Enterprise</strong><span>Search, exports, alerts, bulk ops</span></a>
        <a class="enterprise-shortcut" href="#/orders"><strong>Orders</strong><span>Fulfillment and status work</span></a>
        <a class="enterprise-shortcut" href="#/customers"><strong>Customers</strong><span>Global customer visibility</span></a>
        <a class="enterprise-shortcut" href="#/products"><strong>Products</strong><span>Catalog and pricing management</span></a>
        <a class="enterprise-shortcut" href="#/inventory"><strong>Inventory</strong><span>Stock and replenishment</span></a>
        <a class="enterprise-shortcut" href="#/analytics"><strong>Analytics</strong><span>Revenue and conversion</span></a>
        <a class="enterprise-shortcut" href="#/activity"><strong>Activity</strong><span>Logs and diagnostics</span></a>
        <a class="enterprise-shortcut" href="#/notifications"><strong>Notifications</strong><span>History and alert inbox</span></a>
        <a class="enterprise-shortcut" href="#/notificationanalytics"><strong>Notification Analytics</strong><span>Volume, delivery, reports</span></a>
        <a class="enterprise-shortcut" href="#/notificationmonitoring"><strong>Notification Ops</strong><span>Health, email, recovery</span></a>
      </div>
    </section>
  `;

  const notificationsMarkup = panel(
    "Notifications Center",
    "Live ecommerce and system notifications",
    model.notifications.length
      ? model.notifications.map((item) => `<article class="dashboard-notification dashboard-notification-${item.tone}"><strong>${item.title}</strong><p>${item.detail}</p></article>`).join("")
      : emptyState("No notifications right now.")
  );

  const operationsMarkup = `
    <section class="content-grid enterprise-operations-grid">
      ${panel("Operational Alerts", "Realtime visibility into risks and exceptions", model.alerts.map((alert) => `<article class="enterprise-alert enterprise-alert--${alert.tone}"><strong>${alert.title}</strong><p>${alert.detail}</p></article>`).join(""))}
      ${panel("Enterprise Intelligence", "Top customers, best sellers, behavior signals, and forecasting", `<ul class="bullet-list"><li>Top customers: ${model.topCustomers.slice(0, 3).map((customer) => customer.name).join(", ") || "No data"}</li><li>Best sellers: ${model.bestSellers.slice(0, 3).map((product) => product.name).join(", ") || "No data"}</li><li>Forecast: ${formatCurrency(model.forecast.projected30DayRevenue || 0)}</li><li>Loyalty rate: ${asNumber(model.behavior.loyaltyRate).toFixed(1)}%</li></ul>`) }
      ${notificationsMarkup}
      ${panel("Realtime Operational Feed", "Live activity and system events", rows.feedRows.length ? table(["Source", "Reference", "Status", "Details"], rows.feedRows) : emptyState("No recent events."))}
    </section>
  `;

  const analyticsMarkup = `
    <section class="content-grid analytics-grid">
      ${chartContainer("Weekly Sales Graph", "Daily order conversion and sales pacing", model.weeklySalesSeries)}
      ${chartContainer("Monthly Revenue Graph", "Revenue trends over monthly windows", model.monthlyRevenueSeries)}
      ${chartContainer("Customer Growth Graph", "New customer acquisition trajectory", model.customerGrowthSeries)}
      ${chartContainer("Visitor Activity Graph", "Traffic and engagement rhythm", model.visitorSeries)}
      ${chartContainer("Ecommerce Performance Charts", "Unified operational and commercial performance", model.statusBreakdown)}
    </section>
  `;

  const realtimeMarkup = `
    <section class="content-grid realtime-grid">
      ${panel("Recent Orders", "Realtime-ready order stream", rows.recentOrdersRows.length ? table(["Order", "Customer", "Amount", "Status", "Date"], rows.recentOrdersRows) : emptyState("No recent orders"))}
      ${panel("Recent Customer Activity", "Latest customer lifecycle updates", rows.recentCustomersRows.length ? table(["Customer", "Email", "Phone", "Status", "Joined"], rows.recentCustomersRows) : emptyState("No customer activity"))}
      ${panel("Recent Payments", "Payment capture and settlement feed", rows.paymentRows.length ? table(["Payment", "Amount", "Status"], rows.paymentRows) : emptyState("No recent payments"))}
      ${panel("Global Carts", "Live cart state across all customer devices", rows.cartsRows.length ? table(["Cart", "Customer", "Items", "Value", "Updated"], rows.cartsRows) : emptyState("No active carts"))}
      ${panel("Latest Inventory Updates", "Stock risk and replenishment signals", rows.inventoryRows.length ? table(["Product", "SKU", "Stock", "Alert"], rows.inventoryRows) : emptyState("No inventory alerts"))}
      ${panel("Recent Admin Activity Logs", "Diagnostics and operational logs", rows.activityRows.length ? table(["Event", "Level", "Date", "Scope"], rows.activityRows) : emptyState("No recent admin logs"))}
    </section>
  `;

  const tableSystemMarkup = `
    <section class="content-grid table-stack">
      ${panel("Orders Table", "Professional operational order table", rows.recentOrdersRows.length ? table(["Order", "Customer", "Amount", "Status", "Date"], rows.recentOrdersRows) : emptyState("No orders"))}
      ${panel("Customers Table", "Professional customer intelligence table", rows.recentCustomersRows.length ? table(["Customer", "Email", "Phone", "Status", "Joined"], rows.recentCustomersRows) : emptyState("No customers"))}
      ${panel("Products Table", "Professional catalog management table", rows.productsRows.length ? table(["Product", "Category", "Price", "Stock", "SKU"], rows.productsRows) : emptyState("No products"))}
      ${panel("Carts Table", "Centralized customer cart visibility", rows.cartsRows.length ? table(["Cart", "Customer", "Items", "Value", "Updated"], rows.cartsRows) : emptyState("No carts"))}
    </section>
  `;

  return `
    <section class="dashboard-grid">
      ${heroMarkup}
      ${shortcutsMarkup}
      ${statsMarkup}
      ${analyticsMarkup}
      ${operationsMarkup}
      ${realtimeMarkup}
      ${tableSystemMarkup}
    </section>
  `;
}
