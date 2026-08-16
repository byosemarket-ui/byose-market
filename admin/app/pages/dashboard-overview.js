import { badge, emptyState, escapeHtml, formatCurrency, formatDate } from "../components/ui.js";
import { downloadCsvFile } from "../services/enterprise-intelligence.service.js";

const LOW_STOCK_THRESHOLD = 5;
const RECENT_ORDERS_LIMIT = 8;
const ACTIVITY_LIMIT = 8;
const TOP_PRODUCTS_LIMIT = 5;

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function localDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function startOfDay(offsetDays = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date;
}

function isActiveCatalogProduct(product) {
  const status = String(product?.status || "active").toLowerCase();
  return status !== "inactive" && status !== "draft" && status !== "archived" && status !== "hidden";
}

function isRevenueEligible(order) {
  const status = String(order?.status || order?.orderStatus || "").toLowerCase();
  const payment = String(order?.paymentStatus || order?.paymentStatusLabel || "").toLowerCase();
  if (status.includes("cancel") || status.includes("return") || status.includes("refund")) {
    return false;
  }
  if (payment.includes("refund")) {
    return false;
  }
  return true;
}

function orderTimestamp(order) {
  const date = new Date(order?.date || order?.createdAt || 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function statusTone(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("deliver") || value.includes("complete")) return "success";
  if (value.includes("cancel") || value.includes("return") || value.includes("refund")) return "danger";
  if (value.includes("pending") || value.includes("review") || value.includes("process") || value.includes("confirm") || value.includes("pack")) return "warn";
  return "neutral";
}

function isPendingFulfillment(order) {
  const value = String(order?.status || order?.orderStatus || "").toLowerCase();
  return value.includes("pending") || value.includes("process") || value.includes("confirm") || value.includes("pack");
}

function formatRelativeTime(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) {
    return "-";
  }

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) {
    return formatDate(value);
  }

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDate(value);
}

function percentChange(current, previous) {
  if (!Number.isFinite(previous) || previous <= 0 || !Number.isFinite(current)) {
    return null;
  }
  return ((current - previous) / previous) * 100;
}

function changeMarkup(change) {
  if (change == null || !Number.isFinite(change)) {
    return "";
  }
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const prefix = change > 0 ? "+" : "";
  return `<span class="overview-kpi-change is-${direction}">${prefix}${change.toFixed(1)}%</span>`;
}

function iconSvg(name) {
  const icons = {
    revenue: "M4 19h16M6 16V9m4 7V5m4 11v-6m4 6v-3",
    orders: "M6 6h15l-1.5 9h-12L6 6Zm0 0L5 3H2M9 21a1 1 0 1 0 .01 0M18 21a1 1 0 1 0 .01 0",
    customers: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m14 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
    products: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z",
    alert: "M12 9v4m0 4h.01M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z",
    activity: "M4 12h4l3-8 4 16 3-8h4"
  };
  return icons[name] || icons.activity;
}

function metricIcon(name) {
  return `
    <span class="overview-kpi-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="${iconSvg(name)}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
    </span>
  `;
}

function failedSet(failedSources) {
  return new Set(asList(failedSources).map((entry) => String(entry).split(":")[0].trim().toLowerCase()));
}

function sumRevenue(orders) {
  return asList(orders).filter(isRevenueEligible).reduce((sum, order) => sum + asNumber(order?.total || order?.amount), 0);
}

function countInRange(items, getTime, fromMs, toMs) {
  return asList(items).filter((item) => {
    const time = getTime(item);
    return time >= fromMs && time < toMs;
  }).length;
}

function buildCustomerGrowthFromCustomers(customers) {
  const map = new Map();
  const now = new Date();

  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    map.set(key, {
      label: date.toLocaleDateString("en-US", { month: "short" }),
      value: 0
    });
  }

  asList(customers).forEach((customer) => {
    const date = new Date(customer?.joinedAt || customer?.createdAt || 0);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) {
      return;
    }
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    if (!map.has(key)) {
      return;
    }
    map.get(key).value += 1;
  });

  return Array.from(map.values());
}

function revenueInRange(orders, fromMs, toMs) {
  return asList(orders).filter((order) => {
    if (!isRevenueEligible(order)) return false;
    const time = orderTimestamp(order);
    return time >= fromMs && time < toMs;
  }).reduce((sum, order) => sum + asNumber(order?.total || order?.amount), 0);
}

function buildRevenueSeries(orders, range, analytics) {
  const now = new Date();

  if (range === "year") {
    const monthly = asList(analytics?.monthlyRevenue);
    if (monthly.some((entry) => asNumber(entry?.total ?? entry?.value) > 0)) {
      return monthly.map((entry) => ({
        label: String(entry?.label || "-"),
        value: asNumber(entry?.total ?? entry?.value)
      }));
    }

    const map = new Map();
    for (let offset = 11; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const key = date.toLocaleDateString("en-US", { month: "short" });
      map.set(`${key}-${date.getFullYear()}`, { label: key, value: 0 });
    }
    asList(orders).forEach((order) => {
      if (!isRevenueEligible(order)) return;
      const date = new Date(orderTimestamp(order));
      if (!Number.isFinite(date.getTime())) return;
      const key = `${date.toLocaleDateString("en-US", { month: "short" })}-${date.getFullYear()}`;
      if (!map.has(key)) return;
      map.get(key).value += asNumber(order?.total || order?.amount);
    });
    return Array.from(map.values());
  }

  if (range === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const days = Math.max(1, now.getDate());
    const map = new Map();
    for (let day = 1; day <= days; day += 1) {
      const date = new Date(now.getFullYear(), now.getMonth(), day);
      map.set(localDayKey(date), {
        label: String(day),
        value: 0
      });
    }
    asList(orders).forEach((order) => {
      if (!isRevenueEligible(order)) return;
      const time = orderTimestamp(order);
      if (time < start.getTime()) return;
      const key = localDayKey(time);
      if (!map.has(key)) return;
      map.get(key).value += asNumber(order?.total || order?.amount);
    });
    return Array.from(map.values());
  }

  const weekly = asList(analytics?.weeklySales);
  if (weekly.some((entry) => asNumber(entry?.total ?? entry?.value) > 0)) {
    return weekly.map((entry) => ({
      label: String(entry?.label || "-"),
      value: asNumber(entry?.total ?? entry?.value)
    }));
  }

  return Array.from({ length: 7 }).map((_, index) => {
    const day = startOfDay(index - 6);
    const next = startOfDay(index - 5);
    return {
      label: day.toLocaleDateString("en-US", { weekday: "short" }),
      value: revenueInRange(orders, day.getTime(), next.getTime())
    };
  });
}

function deriveTopProducts(orders, products, analyticsTop) {
  const catalog = new Map();
  asList(products).forEach((product) => {
    const id = String(product?.id || product?.catalogId || "").trim();
    const name = String(product?.name || product?.title || "").trim().toLowerCase();
    if (id) catalog.set(id, product);
    if (name) catalog.set(name, product);
  });

  const fromAnalytics = asList(analyticsTop)
    .map((item) => {
      const id = String(item?.id || item?.productId || "").trim();
      const name = String(item?.name || item?.productName || "Product").trim();
      const matched = catalog.get(id) || catalog.get(name.toLowerCase()) || {};
      return {
        id: id || matched.id || name,
        name: name || matched.name || "Product",
        quantity: asNumber(item?.quantity),
        revenue: asNumber(item?.revenue),
        image: matched.mainImage || matched.image || "",
        stock: Number.isFinite(Number(matched.stock)) ? asNumber(matched.stock) : null,
        status: matched.status || ""
      };
    })
    .filter((item) => item.quantity > 0 || item.revenue > 0);

  if (fromAnalytics.length) {
    return fromAnalytics.slice(0, TOP_PRODUCTS_LIMIT);
  }

  const lookup = new Map();
  asList(orders).forEach((order) => {
    if (!isRevenueEligible(order)) return;
    asList(order?.products || order?.items).forEach((item) => {
      const id = String(item?.productId || item?.id || "").trim();
      const name = String(item?.productName || item?.name || "Product").trim();
      const key = id || name.toLowerCase();
      if (!key) return;
      const current = lookup.get(key) || {
        id: id || key,
        name,
        quantity: 0,
        revenue: 0,
        image: item?.image || "",
        stock: null,
        status: ""
      };
      const quantity = Math.max(1, asNumber(item?.qty || item?.quantity || 1, 1));
      current.quantity += quantity;
      current.revenue += asNumber(item?.lineTotal) || quantity * asNumber(item?.price);
      lookup.set(key, current);
    });
  });

  return Array.from(lookup.values())
    .map((item) => {
      const matched = catalog.get(String(item.id)) || catalog.get(String(item.name).toLowerCase()) || {};
      return {
        ...item,
        name: item.name || matched.name || "Product",
        image: item.image || matched.mainImage || matched.image || "",
        stock: Number.isFinite(Number(matched.stock)) ? asNumber(matched.stock) : item.stock,
        status: matched.status || item.status
      };
    })
    .sort((left, right) => right.revenue - left.revenue || right.quantity - left.quantity)
    .slice(0, TOP_PRODUCTS_LIMIT);
}

function deriveActivity(snapshotActivity, activityLogs, orders, customers) {
  const snapshotFeed = asList(snapshotActivity)
    .map((item) => ({
      type: String(item?.type || item?.source || "Activity"),
      title: String(item?.statusLabel || item?.status || item?.event || item?.type || "Update"),
      detail: String(item?.details || item?.detail || item?.reference || ""),
      time: item?.date || item?.createdAt || item?.timestamp,
      tone: String(item?.statusTone || "neutral")
    }))
    .filter((item) => item.detail || item.title);

  if (snapshotFeed.length) {
    return snapshotFeed.slice(0, ACTIVITY_LIMIT);
  }

  const logs = asList(activityLogs).map((log) => ({
    type: String(log?.type || log?.event || "Activity"),
    title: String(log?.event || log?.type || "Activity"),
    detail: String(log?.path || log?.city || log?.device || log?.level || ""),
    time: log?.timestamp || log?.createdAt,
    tone: "neutral"
  }));

  if (logs.length) {
    return logs.slice(0, ACTIVITY_LIMIT);
  }

  const fallback = [];
  asList(orders).slice(0, 4).forEach((order) => {
    fallback.push({
      type: "Order",
      title: String(order?.status || "Order"),
      detail: `${order?.orderId || order?.id || "Order"} · ${order?.customerName || "Customer"}`,
      time: order?.createdAt || order?.date,
      tone: statusTone(order?.status)
    });
  });
  asList(customers).slice(0, 3).forEach((customer) => {
    fallback.push({
      type: "Customer",
      title: "Registered",
      detail: customer?.name || customer?.email || "Customer",
      time: customer?.joinedAt || customer?.createdAt,
      tone: "success"
    });
  });

  return fallback
    .sort((left, right) => new Date(right.time || 0).getTime() - new Date(left.time || 0).getTime())
    .slice(0, ACTIVITY_LIMIT);
}

export function buildOverviewModel(payload, range = "week") {
  const snapshot = asObject(payload?.snapshot);
  const analytics = asObject(payload?.analytics);
  const stats = asObject(snapshot.stats);
  const failed = failedSet(payload?.failedSources);
  const orders = asList(payload?.orders);
  const customers = asList(payload?.customers);
  const products = asList(payload?.products);

  const ordersFailed = failed.has("orders");
  const customersFailed = failed.has("customers");
  const productsFailed = failed.has("products");

  const catalogCount = products.length;
  const activeProducts = products.filter(isActiveCatalogProduct).length;
  const revenueFromOrders = sumRevenue(orders);
  const revenue = ordersFailed ? asNumber(stats.totalSales || stats.revenue) : revenueFromOrders;
  const ordersCount = ordersFailed ? asNumber(stats.ordersCount || stats.orders) : orders.length;
  const customersCount = customersFailed ? asNumber(stats.customersCount || stats.customers) : customers.length;
  const productsCount = productsFailed ? asNumber(stats.productsCount || stats.products) : catalogCount;
  const productNote = productsFailed
    ? "From dashboard snapshot"
    : (activeProducts && activeProducts !== catalogCount
      ? `${activeProducts} marked active`
      : "Live catalog items");

  const weekStart = startOfDay(-startOfDay().getDay());
  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const nextWeek = new Date(weekStart);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const revenueThisWeek = revenueInRange(orders, weekStart.getTime(), nextWeek.getTime());
  const revenuePrevWeek = revenueInRange(orders, prevWeekStart.getTime(), weekStart.getTime());
  const ordersThisWeek = countInRange(orders, orderTimestamp, weekStart.getTime(), nextWeek.getTime());
  const ordersPrevWeek = countInRange(orders, orderTimestamp, prevWeekStart.getTime(), weekStart.getTime());

  const weekAgo = startOfDay(-7).getTime();
  const twoWeeksAgo = startOfDay(-14).getTime();
  const nowMs = Date.now();
  const newCustomers = countInRange(customers, (customer) => new Date(customer?.joinedAt || customer?.createdAt || 0).getTime(), weekAgo, nowMs);
  const prevNewCustomers = countInRange(customers, (customer) => new Date(customer?.joinedAt || customer?.createdAt || 0).getTime(), twoWeeksAgo, weekAgo);
  const returningCustomers = customers.filter((customer) => asNumber(customer?.totalOrders) >= 2).length;

  const pendingOrders = orders.filter((order) => String(order?.status || "").toLowerCase().includes("pending")).length;
  const awaitingFulfillment = orders.filter(isPendingFulfillment).length;
  const lowStockProducts = products.filter((product) => asNumber(product?.stock) > 0 && asNumber(product?.stock) <= LOW_STOCK_THRESHOLD);
  const outOfStockProducts = products.filter((product) => asNumber(product?.stock) <= 0);
  const lowStock = productsFailed ? asNumber(stats.lowStock) : lowStockProducts.length;

  const recentOrders = [...orders].sort((left, right) => orderTimestamp(right) - orderTimestamp(left)).slice(0, RECENT_ORDERS_LIMIT);
  const topProducts = deriveTopProducts(orders, products, analytics.topProducts);
  const activity = deriveActivity(snapshot.activity, payload?.activityLogs, orders, customers);
  const customerGrowthFromAnalytics = asList(analytics.customerGrowth).map((entry) => ({
    label: String(entry?.label || "-"),
    value: asNumber(entry?.joined ?? entry?.value ?? entry?.cumulative)
  }));
  const customerGrowth = customerGrowthFromAnalytics.some((entry) => entry.value > 0)
    ? customerGrowthFromAnalytics
    : buildCustomerGrowthFromCustomers(customers);
  const hasCustomerTrend = customerGrowth.some((entry) => entry.value > 0);

  const revenueSeries = buildRevenueSeries(orders, range, analytics);
  const hasRevenueTrend = revenueSeries.some((entry) => entry.value > 0);

  const alerts = [];
  if (failed.size) {
    alerts.push({
      tone: "danger",
      title: "Data source issue",
      detail: `${failed.size} Overview feed${failed.size === 1 ? "" : "s"} failed to load.`,
      href: "",
      action: "Retry"
    });
  }
  if (!failed.has("orders") && awaitingFulfillment > 0) {
    alerts.push({
      tone: "warn",
      title: "Order backlog",
      detail: `${awaitingFulfillment} order${awaitingFulfillment === 1 ? "" : "s"} awaiting fulfillment.`,
      href: "#/orders?status=pending",
      action: "View orders"
    });
  }
  if (!failed.has("products") && outOfStockProducts.length > 0) {
    alerts.push({
      tone: "danger",
      title: "Out of stock",
      detail: `${outOfStockProducts.length} product${outOfStockProducts.length === 1 ? "" : "s"} have no remaining stock.`,
      href: "#/inventory",
      action: "View inventory"
    });
  }
  if (!failed.has("products") && lowStock > 0) {
    alerts.push({
      tone: "warn",
      title: "Low inventory",
      detail: `${lowStock} product${lowStock === 1 ? "" : "s"} are at or below ${LOW_STOCK_THRESHOLD} units.`,
      href: "#/inventory",
      action: "View inventory"
    });
  }

  return {
    range,
    failed,
    revenue,
    ordersCount,
    customersCount,
    productsCount,
    productNote,
    revenueChange: percentChange(revenueThisWeek, revenuePrevWeek),
    ordersChange: percentChange(ordersThisWeek, ordersPrevWeek),
    customersChange: percentChange(newCustomers, prevNewCustomers),
    newCustomers,
    returningCustomers,
    pendingOrders,
    awaitingFulfillment,
    lowStock,
    outOfStock: outOfStockProducts.length,
    recentOrders,
    topProducts,
    activity,
    customerGrowth,
    hasCustomerTrend,
    revenueSeries,
    hasRevenueTrend,
    alerts,
    ordersFailed,
    customersFailed,
    productsFailed,
    analyticsFailed: failed.has("analytics") || failed.has("dashboard")
  };
}

function renderAreaChart(series, label) {
  const points = asList(series);
  if (!points.length || !points.some((entry) => entry.value > 0)) {
    return emptyState("No sales data available for this period");
  }

  const maxValue = Math.max(1, ...points.map((entry) => asNumber(entry.value)));
  const total = points.reduce((sum, entry) => sum + asNumber(entry.value), 0);
  const peak = Math.max(...points.map((entry) => asNumber(entry.value)));
  const width = Math.max(1, points.length - 1);

  const coords = points.map((entry, index) => {
    const x = points.length === 1 ? 50 : (index / width) * 100;
    const y = 86 - ((asNumber(entry.value) / maxValue) * 72);
    return { x, y, entry };
  });

  const line = coords.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const area = `0,100 ${line} 100,100`;

  return `
    <div class="overview-chart" role="img" aria-label="${escapeHtml(label)}">
      <div class="overview-chart-meta">
        <span>Total ${formatCurrency(total)}</span>
        <span>Peak ${formatCurrency(peak)}</span>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="overviewRevenueFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="rgba(0,184,148,0.28)"></stop>
            <stop offset="100%" stop-color="rgba(0,184,148,0.02)"></stop>
          </linearGradient>
        </defs>
        <polygon points="${area}" fill="url(#overviewRevenueFill)"></polygon>
        <polyline points="${line}" fill="none" stroke="#00b894" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline>
      </svg>
      <div class="overview-chart-points">
        ${coords.map((point) => `
          <button type="button" class="overview-chart-point" style="left:${point.x}%; top:${point.y}%" title="${escapeHtml(point.entry.label)}: ${formatCurrency(point.entry.value)}" aria-label="${escapeHtml(point.entry.label)} ${formatCurrency(point.entry.value)}"></button>
        `).join("")}
      </div>
      <div class="overview-chart-axis">
        ${points.map((entry) => `<span title="${escapeHtml(entry.label)}">${escapeHtml(entry.label)}</span>`).join("")}
      </div>
    </div>
  `;
}

function activityIconName(type) {
  const value = String(type || "").toLowerCase();
  if (value.includes("order")) return "orders";
  if (value.includes("customer")) return "customers";
  if (value.includes("product") || value.includes("stock") || value.includes("inventory")) return "products";
  if (value.includes("alert") || value.includes("warn")) return "alert";
  if (value.includes("sale") || value.includes("revenue") || value.includes("payment")) return "revenue";
  return "activity";
}

function renderCustomerSummary(model) {
  return `
    <dl class="overview-customer-summary">
      <div>
        <dt>Total customers</dt>
        <dd>${escapeHtml(String(model.customersCount))}</dd>
      </div>
      <div>
        <dt>New this week</dt>
        <dd>${escapeHtml(String(model.newCustomers))}</dd>
      </div>
      <div>
        <dt>Returning</dt>
        <dd>${escapeHtml(String(model.returningCustomers))}</dd>
      </div>
    </dl>
  `;
}

function renderMiniBars(series, label) {
  const points = asList(series);
  if (!points.length || !points.some((entry) => entry.value > 0)) {
    return emptyState("No customer activity yet");
  }
  const maxValue = Math.max(1, ...points.map((entry) => asNumber(entry.value)));
  return `
    <div class="overview-mini-bars" role="img" aria-label="${escapeHtml(label)}">
      ${points.map((entry) => `
        <div class="overview-mini-bar">
          <span class="overview-mini-bar-fill" style="height:${Math.max(6, Math.round((asNumber(entry.value) / maxValue) * 100))}%" title="${escapeHtml(entry.label)}: ${asNumber(entry.value)}"></span>
          <small>${escapeHtml(entry.label)}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function kpiCard({ icon, label, value, note, change, failed, error }) {
  if (failed) {
    return `
      <article class="overview-kpi is-error">
        ${metricIcon(icon)}
        <p class="overview-kpi-label">${escapeHtml(label)}</p>
        <p class="overview-kpi-error">${escapeHtml(error || "Unable to load this metric.")}</p>
        <button type="button" class="btn btn-ghost overview-retry" data-overview-refresh>Retry</button>
      </article>
    `;
  }

  return `
    <article class="overview-kpi">
      ${metricIcon(icon)}
      <p class="overview-kpi-label">${escapeHtml(label)}</p>
      <p class="overview-kpi-value">${escapeHtml(value)}</p>
      <p class="overview-kpi-note">${changeMarkup(change)}${note ? `<span>${escapeHtml(note)}</span>` : ""}</p>
    </article>
  `;
}

function renderRecentOrders(model) {
  if (model.ordersFailed) {
    return `<div class="overview-error" role="alert"><p>Unable to load orders.</p><button type="button" class="btn btn-ghost" data-overview-refresh>Retry</button></div>`;
  }
  if (!model.recentOrders.length) {
    return emptyState("No recent orders");
  }

  const rows = model.recentOrders.map((order) => {
    const id = String(order?.orderId || order?.id || "-");
    const status = String(order?.status || "Pending");
    return `
      <tr>
        <td><span class="overview-id" title="${escapeHtml(id)}">${escapeHtml(id)}</span></td>
        <td><span class="overview-truncate" title="${escapeHtml(order?.customerName || "Guest")}">${escapeHtml(order?.customerName || "Guest")}</span></td>
        <td>${escapeHtml(formatCurrency(order?.total || order?.amount || 0))}</td>
        <td>${badge(status, statusTone(status))}</td>
        <td><time datetime="${escapeHtml(order?.createdAt || order?.date || "")}">${escapeHtml(formatRelativeTime(order?.createdAt || order?.date))}</time></td>
        <td><a class="overview-link" href="#/orders">View</a></td>
      </tr>
    `;
  }).join("");

  return `
    <div class="overview-table-wrap">
      <table class="overview-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Time</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderTopProducts(model) {
  if (model.ordersFailed && model.productsFailed) {
    return `<div class="overview-error" role="alert"><p>Unable to load product sales.</p><button type="button" class="btn btn-ghost" data-overview-refresh>Retry</button></div>`;
  }
  if (!model.topProducts.length) {
    return emptyState("No sales data available for this period");
  }

  return `
    <ul class="overview-product-list">
      ${model.topProducts.map((product) => {
        const stockLabel = product.stock == null
          ? ""
          : asNumber(product.stock) <= 0
            ? "Out of stock"
            : asNumber(product.stock) <= LOW_STOCK_THRESHOLD
              ? "Low stock"
              : "In stock";
        const stockToneValue = asNumber(product.stock) <= 0 ? "danger" : asNumber(product.stock) <= LOW_STOCK_THRESHOLD ? "warn" : "success";
        return `
          <li class="overview-product-item">
            <span class="overview-product-thumb" aria-hidden="true">
              ${product.image ? `<img src="${escapeHtml(product.image)}" alt="">` : escapeHtml(String(product.name || "P").charAt(0).toUpperCase())}
            </span>
            <span class="overview-product-copy">
              <strong class="overview-truncate" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</strong>
              <small>${escapeHtml(String(product.quantity))} sold · ${escapeHtml(formatCurrency(product.revenue))}</small>
            </span>
            ${stockLabel ? badge(stockLabel, stockToneValue) : ""}
          </li>
        `;
      }).join("")}
    </ul>
  `;
}

function renderActivity(model) {
  if (!model.activity.length) {
    return emptyState("No recent activity");
  }

  return `
    <ol class="overview-activity">
      ${model.activity.map((item) => `
        <li class="overview-activity-item">
          <span class="overview-activity-icon is-${escapeHtml(statusTone(item.tone || item.title))}" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="${iconSvg(activityIconName(item.type))}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
          </span>
          <span>
            <strong>${escapeHtml(item.type)} · ${escapeHtml(item.title)}</strong>
            <small class="overview-truncate" title="${escapeHtml(item.detail)}">${escapeHtml(item.detail)}</small>
          </span>
          <time datetime="${escapeHtml(item.time || "")}">${escapeHtml(formatRelativeTime(item.time))}</time>
        </li>
      `).join("")}
    </ol>
  `;
}

function renderAlerts(model) {
  if (!model.alerts.length) {
    return `<div class="overview-alert is-success"><strong>No operational issues</strong><p>No low-stock or order backlog alerts from the current data.</p></div>`;
  }

  return model.alerts.map((alert) => `
    <article class="overview-alert is-${escapeHtml(alert.tone)}">
      <div>
        <strong>${escapeHtml(alert.title)}</strong>
        <p>${escapeHtml(alert.detail)}</p>
      </div>
      ${alert.href
        ? `<a class="overview-link" href="${escapeHtml(alert.href)}">${escapeHtml(alert.action || "Open")}</a>`
        : `<button type="button" class="overview-link" data-overview-refresh>${escapeHtml(alert.action || "Retry")}</button>`}
    </article>
  `).join("");
}

function rangeButtons(range) {
  const options = [
    ["week", "This Week"],
    ["month", "This Month"],
    ["year", "This Year"]
  ];
  return options.map(([value, label]) => `
    <button type="button" class="overview-range-btn${range === value ? " is-active" : ""}" data-overview-range="${value}" aria-pressed="${range === value ? "true" : "false"}">${label}</button>
  `).join("");
}

export function buildOverviewMarkup(model) {
  return `
    <section class="overview-command" data-overview-root>
      <div class="overview-toolbar">
        <p class="overview-lede">Your business performance and operational overview.</p>
        <div class="overview-toolbar-actions">
          <button type="button" class="btn btn-ghost" data-overview-refresh>Refresh</button>
          <button type="button" class="btn btn-secondary overview-export" data-overview-export>Export snapshot</button>
        </div>
      </div>

      <section class="overview-kpi-grid" aria-label="Business health">
        ${kpiCard({
          icon: "revenue",
          label: "Total Revenue",
          value: formatCurrency(model.revenue),
          note: "Eligible order totals",
          change: model.revenueChange,
          failed: model.ordersFailed && !model.revenue,
          error: "Unable to load revenue data."
        })}
        ${kpiCard({
          icon: "orders",
          label: "Total Orders",
          value: String(model.ordersCount),
          note: model.awaitingFulfillment ? `${model.awaitingFulfillment} need attention` : "All captured orders",
          change: model.ordersChange,
          failed: model.ordersFailed && !model.ordersCount,
          error: "Unable to load orders."
        })}
        ${kpiCard({
          icon: "customers",
          label: "Total Customers",
          value: String(model.customersCount),
          note: model.newCustomers ? `${model.newCustomers} new this week` : "Registered customers",
          change: model.customersChange,
          failed: model.customersFailed && !model.customersCount,
          error: "Unable to load customers."
        })}
        ${kpiCard({
          icon: "products",
          label: "Total Products",
          value: String(model.productsCount),
          note: model.productNote,
          failed: model.productsFailed && !model.productsCount,
          error: "Unable to load products."
        })}
      </section>

      <section class="overview-primary-grid">
        <article class="overview-card overview-card-chart">
          <header class="overview-card-header">
            <div>
              <h2>Revenue Overview</h2>
              <p>Revenue from eligible orders for the selected period.</p>
            </div>
            <div class="overview-range" role="group" aria-label="Revenue period">
              ${rangeButtons(model.range)}
            </div>
          </header>
          <div id="overviewRevenueChart">
            ${model.ordersFailed && !model.hasRevenueTrend
              ? `<div class="overview-error" role="alert"><p>Unable to load revenue data.</p><button type="button" class="btn btn-ghost" data-overview-refresh>Retry</button></div>`
              : renderAreaChart(model.revenueSeries, "Revenue overview")}
          </div>
        </article>

        <article class="overview-card">
          <header class="overview-card-header">
            <div>
              <h2>Recent Orders</h2>
              <p>Latest orders from the live order feed.</p>
            </div>
            <a class="overview-link" href="#/orders">View all orders</a>
          </header>
          ${renderRecentOrders(model)}
        </article>
      </section>

      <section class="overview-secondary-grid">
        <article class="overview-card">
          <header class="overview-card-header">
            <div>
              <h2>Customer Activity</h2>
              <p>${model.customersCount} registered · ${model.newCustomers} new this week${model.returningCustomers ? ` · ${model.returningCustomers} returning` : ""}</p>
            </div>
            <a class="overview-link" href="#/customers">Manage customers</a>
          </header>
          ${model.customersFailed && !model.customersCount
            ? `<div class="overview-error" role="alert"><p>Unable to load customer data.</p><button type="button" class="btn btn-ghost" data-overview-refresh>Retry</button></div>`
            : model.hasCustomerTrend
              ? renderMiniBars(model.customerGrowth, "Customer activity by month")
              : model.customersCount
                ? renderCustomerSummary(model)
                : emptyState("No customer activity yet")}
        </article>

        <article class="overview-card">
          <header class="overview-card-header">
            <div>
              <h2>Top Selling Products</h2>
              <p>Ranked by revenue from eligible orders.</p>
            </div>
            <a class="overview-link" href="#/products">View products</a>
          </header>
          ${renderTopProducts(model)}
        </article>

        <article class="overview-card">
          <header class="overview-card-header">
            <div>
              <h2>Activity Feed</h2>
              <p>Recent business and system events.</p>
            </div>
          </header>
          ${renderActivity(model)}
        </article>
      </section>

      <section class="overview-ops-grid">
        <article class="overview-card">
          <header class="overview-card-header">
            <div>
              <h2>Operational Alerts</h2>
              <p>Issues that need administrator attention.</p>
            </div>
          </header>
          <div class="overview-alert-list">
            ${renderAlerts(model)}
          </div>
        </article>

        <article class="overview-card">
          <header class="overview-card-header">
            <div>
              <h2>Quick Actions</h2>
              <p>Jump into existing admin workflows.</p>
            </div>
          </header>
          <div class="overview-actions">
            <a class="overview-action" href="#/products?view=create&step=info"><strong>Add product</strong><span>Create a catalog item</span></a>
            <a class="overview-action" href="#/orders"><strong>View orders</strong><span>Fulfillment and status</span></a>
            <a class="overview-action" href="#/customers"><strong>Manage customers</strong><span>Customer directory</span></a>
            <a class="overview-action" href="#/inventory"><strong>View inventory</strong><span>Stock and replenishment</span></a>
            <a class="overview-action" href="#/analytics"><strong>Open analytics</strong><span>Revenue and conversion reports</span></a>
          </div>
        </article>
      </section>
    </section>
  `;
}

export function renderOverviewLoading() {
  return `
    <section class="overview-command overview-command-loading" aria-busy="true" aria-live="polite">
      <div class="overview-toolbar">
        <span class="skeleton-line skeleton-line-lg"></span>
        <span class="skeleton-pill"></span>
      </div>
      <section class="overview-kpi-grid">
        <article class="overview-kpi"><span class="skeleton-line"></span><span class="skeleton-line skeleton-line-lg"></span></article>
        <article class="overview-kpi"><span class="skeleton-line"></span><span class="skeleton-line skeleton-line-lg"></span></article>
        <article class="overview-kpi"><span class="skeleton-line"></span><span class="skeleton-line skeleton-line-lg"></span></article>
        <article class="overview-kpi"><span class="skeleton-line"></span><span class="skeleton-line skeleton-line-lg"></span></article>
      </section>
      <section class="overview-primary-grid">
        <article class="overview-card"><span class="skeleton-line skeleton-line-lg"></span><div class="skeleton-box" style="height:180px"></div></article>
        <article class="overview-card"><span class="skeleton-line skeleton-line-lg"></span><div class="skeleton-box" style="height:180px"></div></article>
      </section>
      <section class="overview-secondary-grid">
        <article class="overview-card"><span class="skeleton-line"></span><div class="skeleton-box" style="height:120px"></div></article>
        <article class="overview-card"><span class="skeleton-line"></span><div class="skeleton-box" style="height:120px"></div></article>
        <article class="overview-card"><span class="skeleton-line"></span><div class="skeleton-box" style="height:120px"></div></article>
      </section>
    </section>
  `;
}

export function bindOverviewActions(container, { payload, onRefresh } = {}) {
  if (!container) return;

  const refresh = () => {
    if (typeof onRefresh === "function") {
      onRefresh({ force: true });
    }
  };

  container.querySelectorAll("[data-overview-refresh]").forEach((button) => {
    button.addEventListener("click", refresh);
  });

  container.querySelectorAll("[data-overview-range]").forEach((button) => {
    button.addEventListener("click", () => {
      const range = String(button.getAttribute("data-overview-range") || "week");
      const nextModel = buildOverviewModel(payload, range);
      const chart = container.querySelector("#overviewRevenueChart");
      if (chart) {
        chart.innerHTML = nextModel.ordersFailed && !nextModel.hasRevenueTrend
          ? `<div class="overview-error" role="alert"><p>Unable to load revenue data.</p><button type="button" class="btn btn-ghost" data-overview-refresh>Retry</button></div>`
          : renderAreaChart(nextModel.revenueSeries, "Revenue overview");
        chart.querySelector("[data-overview-refresh]")?.addEventListener("click", refresh);
      }
      container.querySelectorAll("[data-overview-range]").forEach((node) => {
        const active = node.getAttribute("data-overview-range") === range;
        node.classList.toggle("is-active", active);
        node.setAttribute("aria-pressed", active ? "true" : "false");
      });
      container._overviewRange = range;
    });
  });

  container.querySelector("[data-overview-export]")?.addEventListener("click", () => {
    const model = buildOverviewModel(payload, container._overviewRange || "week");
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsvFile(`byose-overview-${stamp}.csv`, [
      { Section: "KPI", Label: "Total Revenue", Value: model.revenue },
      { Section: "KPI", Label: "Total Orders", Value: model.ordersCount },
      { Section: "KPI", Label: "Total Customers", Value: model.customersCount },
      { Section: "KPI", Label: "Total Products", Value: model.productsCount },
      ...model.recentOrders.map((order) => ({
        Section: "Recent Orders",
        Label: order.orderId || order.id,
        Value: order.total || 0,
        Status: order.status || "",
        Customer: order.customerName || ""
      })),
      ...model.topProducts.map((product) => ({
        Section: "Top Products",
        Label: product.name,
        Value: product.revenue,
        Status: `${product.quantity} sold`
      })),
      ...model.alerts.map((alert) => ({
        Section: "Alerts",
        Label: alert.title,
        Value: alert.detail
      }))
    ]);
  });
}
