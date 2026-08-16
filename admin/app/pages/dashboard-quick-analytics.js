import { escapeHtml, formatCurrency } from "../components/ui.js";

const LOW_STOCK_THRESHOLD = 5;
const PERIOD_OPTIONS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This Week" }
];

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatNumber(value) {
  return asNumber(value).toLocaleString("en-US");
}

function failedSet(failedSources) {
  return new Set(asList(failedSources).map((entry) => String(entry).split(":")[0].trim().toLowerCase()));
}

function startOfLocalDay(value = new Date()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfLocalDay(value = new Date()) {
  const date = startOfLocalDay(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function startOfWeekMonday(value = new Date()) {
  const date = startOfLocalDay(value);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date;
}

function formatReadableDate(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function isRevenueEligible(order) {
  const status = String(order?.status || order?.orderStatus || "").toLowerCase();
  const payment = String(order?.paymentStatus || order?.paymentStatusLabel || "").toLowerCase();
  if (status.includes("cancel") || status.includes("return") || status.includes("refund")) return false;
  if (payment.includes("refund")) return false;
  return true;
}

function orderTimestamp(order) {
  const date = new Date(order?.date || order?.createdAt || 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function customerTimestamp(customer) {
  const date = new Date(customer?.joinedAt || customer?.createdAt || 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function inRange(time, startMs, endMs) {
  return Number.isFinite(time) && time > 0 && time >= startMs && time <= endMs;
}

function orderTotal(order) {
  return asNumber(order?.total || order?.amount || order?.grandTotal);
}

function isPendingStatus(order) {
  return String(order?.status || order?.orderStatus || "").toLowerCase().includes("pending");
}

function isPendingFulfillment(order) {
  const value = String(order?.status || order?.orderStatus || "").toLowerCase();
  return value.includes("pending") || value.includes("process") || value.includes("confirm") || value.includes("pack");
}

function isCompletedStatus(order) {
  const value = String(order?.status || order?.orderStatus || "").toLowerCase();
  return value.includes("deliver") || value.includes("complete");
}

function percentChange(current, previous) {
  if (!Number.isFinite(previous) || previous <= 0 || !Number.isFinite(current)) return null;
  return ((current - previous) / previous) * 100;
}

function lineItems(order) {
  return asList(order?.products || order?.items);
}

function unitsFromOrders(orders) {
  return asList(orders).reduce((sum, order) => (
    sum + lineItems(order).reduce((inner, item) => inner + Math.max(1, asNumber(item?.qty || item?.quantity || 1, 1)), 0)
  ), 0);
}

function resolveFocusPeriod(key = "today", now = new Date()) {
  const selected = PERIOD_OPTIONS.some((item) => item.key === key) ? key : "today";
  const todayStart = startOfLocalDay(now);
  const todayEnd = endOfLocalDay(now);

  if (selected === "yesterday") {
    const start = startOfLocalDay(addDays(todayStart, -1));
    const prevStart = startOfLocalDay(addDays(todayStart, -2));
    return {
      key: selected,
      label: `Yesterday · ${formatReadableDate(start)}`,
      compareLabel: "the previous day",
      startMs: start.getTime(),
      endMs: endOfLocalDay(start).getTime(),
      prevStartMs: prevStart.getTime(),
      prevEndMs: endOfLocalDay(prevStart).getTime()
    };
  }

  if (selected === "week") {
    const start = startOfWeekMonday(now);
    const prevStart = addDays(start, -7);
    const elapsed = todayEnd.getTime() - start.getTime();
    return {
      key: selected,
      label: `This week · ${formatReadableDate(start)} – ${formatReadableDate(now)}`,
      compareLabel: "previous week-to-date",
      startMs: start.getTime(),
      endMs: todayEnd.getTime(),
      prevStartMs: prevStart.getTime(),
      prevEndMs: prevStart.getTime() + elapsed
    };
  }

  const prevStart = startOfLocalDay(addDays(todayStart, -1));
  return {
    key: "today",
    label: `Today · ${formatReadableDate(todayStart)}`,
    compareLabel: "yesterday",
    startMs: todayStart.getTime(),
    endMs: todayEnd.getTime(),
    prevStartMs: prevStart.getTime(),
    prevEndMs: endOfLocalDay(prevStart).getTime()
  };
}

function metricLabel(key, noun) {
  if (key === "yesterday") return `Yesterday's ${noun}`;
  if (key === "week") return `This week's ${noun}`;
  return `Today's ${noun}`;
}

function signalFromChange(change) {
  if (change == null || !Number.isFinite(change)) return null;
  if (change > 0) {
    return { tone: "success", text: "Growing", detail: "Above previous period" };
  }
  if (change < 0) {
    return { tone: "danger", text: "Declining", detail: "Below previous period" };
  }
  return { tone: "neutral", text: "Stable", detail: "No significant change" };
}

function deriveTopProducts(orders) {
  const lookup = new Map();
  asList(orders).forEach((order) => {
    lineItems(order).forEach((item) => {
      const id = String(item?.productId || item?.id || "").trim();
      const name = String(item?.productName || item?.name || "Product").trim();
      const key = id || name.toLowerCase();
      if (!key) return;
      const current = lookup.get(key) || { id: id || key, name, quantity: 0, revenue: 0 };
      const quantity = Math.max(1, asNumber(item?.qty || item?.quantity || 1, 1));
      current.quantity += quantity;
      current.revenue += asNumber(item?.lineTotal) || quantity * asNumber(item?.price);
      lookup.set(key, current);
    });
  });
  return Array.from(lookup.values()).sort((left, right) => right.revenue - left.revenue || right.quantity - left.quantity);
}

export function buildQuickAnalyticsModel(payload, periodKey = "today") {
  const period = resolveFocusPeriod(periodKey);
  const failed = failedSet(payload?.failedSources);
  const ordersFailed = failed.has("orders");
  const customersFailed = failed.has("customers");
  const productsFailed = failed.has("products");
  const orders = asList(payload?.orders);
  const customers = asList(payload?.customers);
  const products = asList(payload?.products);

  const periodOrders = orders.filter((order) => inRange(orderTimestamp(order), period.startMs, period.endMs));
  const prevOrders = orders.filter((order) => inRange(orderTimestamp(order), period.prevStartMs, period.prevEndMs));
  const eligible = periodOrders.filter(isRevenueEligible);
  const prevEligible = prevOrders.filter(isRevenueEligible);

  const revenue = eligible.reduce((sum, order) => sum + orderTotal(order), 0);
  const prevRevenue = prevEligible.reduce((sum, order) => sum + orderTotal(order), 0);
  const ordersCount = periodOrders.length;
  const prevOrdersCount = prevOrders.length;
  const averageOrderValue = eligible.length ? revenue / eligible.length : 0;
  const unitsSold = unitsFromOrders(eligible);
  const pendingOrders = periodOrders.filter(isPendingStatus).length;
  const awaitingFulfillment = periodOrders.filter(isPendingFulfillment).length;
  const completedOrders = periodOrders.filter(isCompletedStatus).length;
  const openAttention = orders.filter(isPendingFulfillment).length;

  const newCustomers = customers.filter((customer) => inRange(customerTimestamp(customer), period.startMs, period.endMs));
  const prevNewCustomers = customers.filter((customer) => inRange(customerTimestamp(customer), period.prevStartMs, period.prevEndMs));

  const topProducts = deriveTopProducts(eligible).slice(0, 3);
  const soldKeys = new Set(deriveTopProducts(eligible).flatMap((item) => [String(item.id), String(item.name).toLowerCase()]));
  const inStockUnsold = products.filter((product) => {
    const stock = asNumber(product?.stock);
    if (stock <= 0) return false;
    const id = String(product?.id || "");
    const name = String(product?.name || "").toLowerCase();
    return !soldKeys.has(id) && !soldKeys.has(name);
  });
  const outOfStock = products.filter((product) => asNumber(product?.stock) <= 0);
  const lowStock = products.filter((product) => asNumber(product?.stock) > 0 && asNumber(product?.stock) <= LOW_STOCK_THRESHOLD);
  const healthyStock = products.filter((product) => asNumber(product?.stock) > LOW_STOCK_THRESHOLD);

  const revenueChange = percentChange(revenue, prevRevenue);
  const ordersChange = percentChange(ordersCount, prevOrdersCount);
  const customersChange = percentChange(newCustomers.length, prevNewCustomers.length);
  const signals = [
    { label: "Revenue", change: revenueChange, ...signalFromChange(revenueChange) },
    { label: "Orders", change: ordersChange, ...signalFromChange(ordersChange) },
    { label: "Customers", change: customersChange, ...signalFromChange(customersChange) }
  ].filter((item) => item.text);

  const alerts = [];
  if (failed.size) {
    alerts.push({
      tone: "critical",
      title: "Data source issue",
      detail: `${failed.size} Quick Analytics feed${failed.size === 1 ? "" : "s"} failed to load.`,
      href: "",
      action: "Retry"
    });
  }
  if (!productsFailed && outOfStock.length) {
    alerts.push({
      tone: "critical",
      title: "Out of stock",
      detail: `${formatNumber(outOfStock.length)} product${outOfStock.length === 1 ? "" : "s"} have no remaining stock.`,
      href: "#/inventory",
      action: "View inventory"
    });
  }
  if (!ordersFailed && openAttention) {
    alerts.push({
      tone: "warning",
      title: "Orders need action",
      detail: `${formatNumber(openAttention)} order${openAttention === 1 ? "" : "s"} awaiting fulfillment.`,
      href: "#/orders?status=pending",
      action: "View pending orders"
    });
  }
  if (!productsFailed && lowStock.length) {
    alerts.push({
      tone: "warning",
      title: "Low inventory",
      detail: `${formatNumber(lowStock.length)} product${lowStock.length === 1 ? "" : "s"} are at or below ${LOW_STOCK_THRESHOLD} units.`,
      href: "#/inventory",
      action: "View inventory"
    });
  }
  if (!ordersFailed && revenueChange != null && revenueChange < 0) {
    alerts.push({
      tone: "warning",
      title: "Revenue below previous period",
      detail: `Eligible revenue is ${Math.abs(revenueChange).toFixed(1)}% below ${period.compareLabel}.`,
      href: "#/dashboard?panel=statistics",
      action: "Open statistics"
    });
  }
  if (!ordersFailed && revenueChange != null && revenueChange > 0) {
    alerts.push({
      tone: "success",
      title: "Revenue growing",
      detail: `Eligible revenue is ${revenueChange.toFixed(1)}% above ${period.compareLabel}.`,
      href: "#/dashboard?panel=statistics",
      action: "Open statistics"
    });
  }
  if (!alerts.length) {
    alerts.push({
      tone: "success",
      title: "No issues requiring action",
      detail: "No pending fulfillment, stock, or data-source alerts from the current feeds.",
      href: "",
      action: ""
    });
  }

  const opportunities = [];
  if (topProducts[0] && topProducts[0].revenue > 0) {
    opportunities.push(`${topProducts[0].name} leads eligible sales with ${formatNumber(topProducts[0].quantity)} sold.`);
  }
  if (!productsFailed && inStockUnsold.length) {
    opportunities.push(`${formatNumber(inStockUnsold.length)} in-stock catalog item${inStockUnsold.length === 1 ? "" : "s"} had no eligible sales in this period.`);
  }
  if (newCustomers.length && customersChange != null && customersChange > 0) {
    opportunities.push(`New customer registrations are above ${period.compareLabel}.`);
  }

  return {
    period,
    ordersFailed,
    customersFailed,
    productsFailed,
    revenue,
    revenueChange,
    ordersCount,
    ordersChange,
    eligibleCount: eligible.length,
    averageOrderValue,
    unitsSold,
    pendingOrders,
    awaitingFulfillment,
    completedOrders,
    openAttention,
    newCustomers: newCustomers.length,
    customersChange,
    recentCustomers: newCustomers.slice(0, 3),
    topProducts,
    outOfStock,
    lowStock,
    healthyStockCount: healthyStock.length,
    unsoldInStockCount: inStockUnsold.length,
    signals,
    alerts: alerts.slice(0, 5),
    opportunities: opportunities.slice(0, 3)
  };
}

function compareNote(change, compareLabel) {
  if (change == null || !Number.isFinite(change)) return "";
  const prefix = change > 0 ? "+" : "";
  return `${prefix}${change.toFixed(1)}% vs ${compareLabel}`;
}

function kpiCard({ label, value, note, change, compareLabel, failed, error }) {
  if (failed) {
    return `
      <article class="qa-kpi is-error">
        <p class="qa-kpi-label">${escapeHtml(label)}</p>
        <p class="qa-error-text">${escapeHtml(error)}</p>
        <button type="button" class="btn btn-ghost" data-quick-refresh>Retry</button>
      </article>
    `;
  }
  const comparison = compareNote(change, compareLabel);
  return `
    <article class="qa-kpi">
      <p class="qa-kpi-label">${escapeHtml(label)}</p>
      <p class="qa-kpi-value">${escapeHtml(value)}</p>
      <p class="qa-kpi-note">${comparison ? `<span class="qa-delta is-${change > 0 ? "up" : change < 0 ? "down" : "flat"}">${escapeHtml(comparison)}</span>` : ""}<span>${escapeHtml(note || "")}</span></p>
    </article>
  `;
}

function sectionError(message) {
  return `<div class="qa-error" role="alert"><p>${escapeHtml(message)}</p><button type="button" class="btn btn-ghost" data-quick-refresh>Retry</button></div>`;
}

function compactList(items, emptyMessage) {
  if (!items.length) return `<p class="qa-empty">${escapeHtml(emptyMessage)}</p>`;
  return `<ul class="qa-list">${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
}

export function buildQuickAnalyticsMarkup(model) {
  const period = model.period;
  const compareLabel = period.compareLabel;
  return `
    <section class="qa-workspace" data-quick-root>
      <div class="qa-toolbar">
        <p class="qa-lede">Fast business insights and actions.</p>
        <div class="qa-toolbar-actions">
          <a class="qa-link" href="#/dashboard?panel=statistics">Open statistics</a>
          <button type="button" class="btn btn-ghost" data-quick-refresh>Refresh</button>
        </div>
      </div>

      <div class="qa-period" role="group" aria-label="Quick Analytics period">
        <p class="qa-period-label">Focus: <strong>${escapeHtml(period.label)}</strong></p>
        <div class="qa-period-row">
          ${PERIOD_OPTIONS.map((option) => `
            <button type="button" class="qa-period-btn${period.key === option.key ? " is-active" : ""}" data-quick-period="${option.key}" aria-pressed="${period.key === option.key ? "true" : "false"}">${escapeHtml(option.label)}</button>
          `).join("")}
        </div>
      </div>

      <div class="qa-board${model.opportunities.length ? " has-opportunities" : ""}">
        <section class="qa-panel qa-kpis" aria-label="Period performance">
          <h2>Performance snapshot</h2>
          <div class="qa-kpi-grid">
            ${kpiCard({
              label: metricLabel(period.key, "revenue"),
              value: formatCurrency(model.revenue),
              note: "Eligible order totals",
              change: model.revenueChange,
              compareLabel,
              failed: model.ordersFailed,
              error: "Unable to load revenue."
            })}
            ${kpiCard({
              label: metricLabel(period.key, "orders"),
              value: formatNumber(model.ordersCount),
              note: `${formatNumber(model.pendingOrders)} pending · ${formatNumber(model.completedOrders)} completed`,
              change: model.ordersChange,
              compareLabel,
              failed: model.ordersFailed,
              error: "Unable to load orders."
            })}
            ${kpiCard({
              label: "Average order value",
              value: formatCurrency(model.averageOrderValue),
              note: `${formatNumber(model.eligibleCount)} eligible orders`,
              failed: model.ordersFailed,
              error: "Unable to load revenue."
            })}
            ${kpiCard({
              label: metricLabel(period.key, "customers"),
              value: formatNumber(model.newCustomers),
              note: "New registrations",
              change: model.customersChange,
              compareLabel,
              failed: model.customersFailed,
              error: "Unable to load customers."
            })}
            ${kpiCard({
              label: "Units sold",
              value: formatNumber(model.unitsSold),
              note: "From eligible order items",
              failed: model.ordersFailed,
              error: "Unable to load product sales."
            })}
          </div>
        </section>

        <section class="qa-panel qa-signals">
          <h2>Performance signals</h2>
          ${model.ordersFailed && model.customersFailed
            ? sectionError("Unable to load performance signals.")
            : model.signals.length
              ? `<ul class="qa-signal-list">${model.signals.map((signal) => `
                  <li class="qa-signal is-${escapeHtml(signal.tone)}">
                    <strong>${escapeHtml(signal.label)}</strong>
                    <span>${escapeHtml(signal.text)} · ${escapeHtml(signal.detail)}</span>
                    ${signal.change != null ? `<em>${escapeHtml(compareNote(signal.change, compareLabel))}</em>` : ""}
                  </li>
                `).join("")}</ul>`
              : `<p class="qa-empty">No previous-period comparison for this focus.</p>`}
        </section>

        <section class="qa-panel qa-orders">
          <header class="qa-panel-head">
            <h2>Order attention</h2>
            <a class="qa-link" href="#/orders?status=pending">View pending orders</a>
          </header>
          ${model.ordersFailed
            ? sectionError("Unable to load order analytics.")
            : `
              <dl class="qa-attention">
                <div><dt>Pending in this period</dt><dd>${escapeHtml(formatNumber(model.pendingOrders))}</dd></div>
                <div><dt>Awaiting fulfillment now</dt><dd>${escapeHtml(formatNumber(model.openAttention))}</dd></div>
                <div><dt>Completed in this period</dt><dd>${escapeHtml(formatNumber(model.completedOrders))}</dd></div>
              </dl>
              ${model.openAttention ? `<p class="qa-hint">Open the pending queue to work orders that still need fulfillment.</p>` : `<p class="qa-empty">No pending orders</p>`}
            `}
        </section>

        <section class="qa-panel qa-inventory">
          <header class="qa-panel-head">
            <h2>Inventory attention</h2>
            <a class="qa-link" href="#/inventory">View inventory</a>
          </header>
          ${model.productsFailed
            ? sectionError("Unable to load inventory analytics.")
            : `
              <ul class="qa-severity">
                <li class="is-critical"><span>Critical</span><strong>${escapeHtml(formatNumber(model.outOfStock.length))} out of stock</strong></li>
                <li class="is-warning"><span>Warning</span><strong>${escapeHtml(formatNumber(model.lowStock.length))} low stock</strong></li>
                <li class="is-success"><span>Normal</span><strong>${escapeHtml(formatNumber(model.healthyStockCount))} healthy stock</strong></li>
              </ul>
              ${compactList(
                [...model.outOfStock.slice(0, 3).map((product) => `<span class="qa-truncate" title="${escapeHtml(product.name || "Product")}">${escapeHtml(product.name || "Product")}</span> <em>Out of stock</em>`),
                  ...model.lowStock.slice(0, 3).map((product) => `<span class="qa-truncate" title="${escapeHtml(product.name || "Product")}">${escapeHtml(product.name || "Product")}</span> <em>${escapeHtml(String(product.stock))} units</em>`)],
                "No low-stock products"
              )}
            `}
        </section>

        <section class="qa-panel qa-products">
          <header class="qa-panel-head">
            <h2>Product highlights</h2>
            <a class="qa-link" href="#/products">View products</a>
          </header>
          ${model.ordersFailed
            ? sectionError("Unable to load product sales.")
            : model.topProducts.length
              ? `<ol class="qa-highlights">${model.topProducts.map((product) => `
                  <li>
                    <span class="qa-truncate" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</span>
                    <strong>${escapeHtml(formatCurrency(product.revenue))}</strong>
                    <small>${escapeHtml(formatNumber(product.quantity))} sold</small>
                  </li>
                `).join("")}</ol>`
              : `<p class="qa-empty">No sales data available</p>`}
        </section>

        <section class="qa-panel qa-customers">
          <header class="qa-panel-head">
            <h2>Customer activity</h2>
            <a class="qa-link" href="#/customers">Manage customers</a>
          </header>
          ${model.customersFailed
            ? sectionError("Unable to load customer analytics.")
            : `
              <p class="qa-lead">${escapeHtml(formatNumber(model.newCustomers))} new registration${model.newCustomers === 1 ? "" : "s"} in this period.</p>
              ${compactList(
                model.recentCustomers.map((customer) => `<span class="qa-truncate">${escapeHtml(customer.name || customer.email || "Customer")}</span>`),
                "No customer activity in this period"
              )}
            `}
        </section>

        <section class="qa-panel qa-alerts">
          <h2>Quick alerts</h2>
          <ul class="qa-alert-list">
            ${model.alerts.map((alert) => `
              <li class="qa-alert is-${escapeHtml(alert.tone)}">
                <div>
                  <strong>${escapeHtml(alert.title)}</strong>
                  <p>${escapeHtml(alert.detail)}</p>
                </div>
                ${alert.href
                  ? `<a class="qa-link" href="${escapeHtml(alert.href)}">${escapeHtml(alert.action)}</a>`
                  : (alert.action ? `<button type="button" class="qa-link" data-quick-refresh>${escapeHtml(alert.action)}</button>` : "")}
              </li>
            `).join("")}
          </ul>
        </section>

        ${model.opportunities.length
          ? `<section class="qa-panel qa-opportunities">
              <h2>Opportunities</h2>
              <ul class="qa-list">${model.opportunities.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
            </section>`
          : ""}

        <section class="qa-panel qa-actions">
          <h2>Quick actions</h2>
          <div class="qa-action-grid">
            <a class="qa-action" href="#/products?view=create&step=info"><strong>Add product</strong><span>Create a catalog item</span></a>
            <a class="qa-action" href="#/orders"><strong>View orders</strong><span>Fulfillment and status</span></a>
            <a class="qa-action" href="#/inventory"><strong>Manage inventory</strong><span>Stock and replenishment</span></a>
            <a class="qa-action" href="#/customers"><strong>Manage customers</strong><span>Customer directory</span></a>
            <a class="qa-action" href="#/dashboard?panel=statistics"><strong>View reports</strong><span>Open Statistics</span></a>
            <a class="qa-action" href="#/analytics"><strong>Open analytics</strong><span>Revenue and conversion</span></a>
          </div>
        </section>
      </div>
    </section>
  `;
}

export function renderQuickAnalyticsLoading() {
  return `
    <section class="qa-workspace qa-workspace-loading" aria-busy="true" aria-live="polite">
      <div class="qa-toolbar"><span class="skeleton-line skeleton-line-lg"></span><span class="skeleton-pill"></span></div>
      <div class="qa-kpi-grid">
        <article class="qa-kpi"><span class="skeleton-line"></span><span class="skeleton-line skeleton-line-lg"></span></article>
        <article class="qa-kpi"><span class="skeleton-line"></span><span class="skeleton-line skeleton-line-lg"></span></article>
        <article class="qa-kpi"><span class="skeleton-line"></span><span class="skeleton-line skeleton-line-lg"></span></article>
      </div>
      <div class="qa-board">
        <article class="qa-panel"><span class="skeleton-line"></span><div class="skeleton-box" style="height:90px"></div></article>
        <article class="qa-panel"><span class="skeleton-line"></span><div class="skeleton-box" style="height:90px"></div></article>
      </div>
    </section>
  `;
}

function paintQuickAnalytics(container, payload, periodKey, onRefresh) {
  container._quickPeriod = periodKey;
  container.innerHTML = buildQuickAnalyticsMarkup(buildQuickAnalyticsModel(payload, periodKey));
  bindQuickAnalyticsActions(container, { payload, onRefresh });
}

export function bindQuickAnalyticsActions(container, { payload, onRefresh } = {}) {
  if (!container) return;
  const refresh = () => {
    if (typeof onRefresh === "function") onRefresh({ force: true });
  };
  container.querySelectorAll("[data-quick-refresh]").forEach((button) => {
    button.addEventListener("click", refresh);
  });
  container.querySelectorAll("[data-quick-period]").forEach((button) => {
    button.addEventListener("click", () => {
      paintQuickAnalytics(container, payload, String(button.getAttribute("data-quick-period") || "today"), onRefresh);
    });
  });
}
