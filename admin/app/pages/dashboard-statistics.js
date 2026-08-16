import { badge, emptyState, escapeHtml, formatCurrency } from "../components/ui.js";
import { downloadCsvFile } from "../services/enterprise-intelligence.service.js";

const LOW_STOCK_THRESHOLD = 5;
const TOP_PRODUCTS_LIMIT = 10;
const STATUS_ORDER = [
  "Pending",
  "Confirmed",
  "Processing",
  "Packed",
  "Shipping",
  "Delivered",
  "Completed",
  "Cancelled",
  "Returned",
  "Refunded"
];

const PERIOD_OPTIONS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This Week" },
  { key: "lastWeek", label: "Last Week" },
  { key: "month", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "year", label: "This Year" },
  { key: "custom", label: "Custom Range" }
];

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

function formatNumber(value) {
  return asNumber(value).toLocaleString("en-US");
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
  const diff = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - diff);
  return date;
}

function endOfWeekSunday(value = new Date()) {
  const date = startOfWeekMonday(value);
  date.setDate(date.getDate() + 6);
  return endOfLocalDay(date);
}

function parseLocalDateInput(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLocalDateInput(value = new Date()) {
  const date = value instanceof Date ? value : parseLocalDateInput(value);
  if (!date || Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatReadableDate(value) {
  const date = value instanceof Date ? value : parseLocalDateInput(value) || new Date(value || 0);
  if (!date || Number.isNaN(date.getTime()) || date.getTime() <= 0) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function localDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return formatLocalDateInput(date);
}

function failedSet(failedSources) {
  return new Set(asList(failedSources).map((entry) => String(entry).split(":")[0].trim().toLowerCase()));
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

function normalizeStatusLabel(status) {
  const value = String(status || "Pending").toLowerCase();
  if (value.includes("out for delivery") || value.includes("out_for_delivery")) return "Shipping";
  if (value.includes("deliver")) return "Delivered";
  if (value.includes("complete")) return "Completed";
  if (value.includes("ship")) return "Shipping";
  if (value.includes("cancel")) return "Cancelled";
  if (value.includes("refund")) return "Refunded";
  if (value.includes("return")) return "Returned";
  if (value.includes("pack")) return "Packed";
  if (value.includes("process")) return "Processing";
  if (value.includes("confirm")) return "Confirmed";
  if (value.includes("pending")) return "Pending";
  return "Pending";
}

function statusTone(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("deliver") || value.includes("complete")) return "success";
  if (value.includes("cancel") || value.includes("return") || value.includes("refund")) return "danger";
  if (value.includes("pending") || value.includes("process") || value.includes("confirm") || value.includes("pack") || value.includes("ship")) return "warn";
  return "neutral";
}

function percentChange(current, previous) {
  if (!Number.isFinite(previous) || previous <= 0 || !Number.isFinite(current)) {
    return null;
  }
  return ((current - previous) / previous) * 100;
}

function changeMarkup(change) {
  if (change == null || !Number.isFinite(change)) {
    return `<span class="stats-compare is-empty">No previous-period comparison</span>`;
  }
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const prefix = change > 0 ? "+" : "";
  return `<span class="stats-compare is-${direction}">${prefix}${change.toFixed(1)}% vs previous period</span>`;
}

function resolvePeriod(state = {}, now = new Date()) {
  const key = PERIOD_OPTIONS.some((item) => item.key === state.key) ? state.key : "month";
  const todayStart = startOfLocalDay(now);
  const todayEnd = endOfLocalDay(now);

  if (key === "today") {
    const prevStart = startOfLocalDay(addDays(todayStart, -1));
    return {
      key,
      label: `Today · ${formatReadableDate(todayStart)}`,
      startMs: todayStart.getTime(),
      endMs: todayEnd.getTime(),
      prevStartMs: prevStart.getTime(),
      prevEndMs: endOfLocalDay(prevStart).getTime(),
      bucket: "hour",
      fromInput: formatLocalDateInput(todayStart),
      toInput: formatLocalDateInput(todayStart)
    };
  }

  if (key === "yesterday") {
    const start = startOfLocalDay(addDays(todayStart, -1));
    const prevStart = startOfLocalDay(addDays(todayStart, -2));
    return {
      key,
      label: `Yesterday · ${formatReadableDate(start)}`,
      startMs: start.getTime(),
      endMs: endOfLocalDay(start).getTime(),
      prevStartMs: prevStart.getTime(),
      prevEndMs: endOfLocalDay(prevStart).getTime(),
      bucket: "hour",
      fromInput: formatLocalDateInput(start),
      toInput: formatLocalDateInput(start)
    };
  }

  if (key === "week") {
    const start = startOfWeekMonday(now);
    const prevStart = addDays(start, -7);
    const elapsed = todayEnd.getTime() - start.getTime();
    return {
      key,
      label: `This week · ${formatReadableDate(start)} – ${formatReadableDate(now)}`,
      startMs: start.getTime(),
      endMs: todayEnd.getTime(),
      prevStartMs: prevStart.getTime(),
      prevEndMs: prevStart.getTime() + elapsed,
      bucket: "day",
      fromInput: formatLocalDateInput(start),
      toInput: formatLocalDateInput(now)
    };
  }

  if (key === "lastWeek") {
    const thisWeek = startOfWeekMonday(now);
    const start = addDays(thisWeek, -7);
    const end = endOfWeekSunday(start);
    const prevStart = addDays(start, -7);
    return {
      key,
      label: `Last week · ${formatReadableDate(start)} – ${formatReadableDate(end)}`,
      startMs: start.getTime(),
      endMs: end.getTime(),
      prevStartMs: prevStart.getTime(),
      prevEndMs: endOfWeekSunday(prevStart).getTime(),
      bucket: "day",
      fromInput: formatLocalDateInput(start),
      toInput: formatLocalDateInput(end)
    };
  }

  if (key === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthDay = Math.min(now.getDate(), new Date(now.getFullYear(), now.getMonth(), 0).getDate());
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevEnd = endOfLocalDay(new Date(now.getFullYear(), now.getMonth() - 1, prevMonthDay));
    return {
      key,
      label: `This month · ${formatReadableDate(start)} – ${formatReadableDate(now)}`,
      startMs: start.getTime(),
      endMs: todayEnd.getTime(),
      prevStartMs: prevStart.getTime(),
      prevEndMs: prevEnd.getTime(),
      bucket: "day",
      fromInput: formatLocalDateInput(start),
      toInput: formatLocalDateInput(now)
    };
  }

  if (key === "lastMonth") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = endOfLocalDay(new Date(now.getFullYear(), now.getMonth(), 0));
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const prevEnd = endOfLocalDay(new Date(now.getFullYear(), now.getMonth() - 1, 0));
    return {
      key,
      label: `Last month · ${formatReadableDate(start)} – ${formatReadableDate(end)}`,
      startMs: start.getTime(),
      endMs: end.getTime(),
      prevStartMs: prevStart.getTime(),
      prevEndMs: prevEnd.getTime(),
      bucket: "day",
      fromInput: formatLocalDateInput(start),
      toInput: formatLocalDateInput(end)
    };
  }

  if (key === "year") {
    const start = new Date(now.getFullYear(), 0, 1);
    const prevStart = new Date(now.getFullYear() - 1, 0, 1);
    const prevEnd = endOfLocalDay(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()));
    return {
      key,
      label: `This year · ${formatReadableDate(start)} – ${formatReadableDate(now)}`,
      startMs: start.getTime(),
      endMs: todayEnd.getTime(),
      prevStartMs: prevStart.getTime(),
      prevEndMs: prevEnd.getTime(),
      bucket: "month",
      fromInput: formatLocalDateInput(start),
      toInput: formatLocalDateInput(now)
    };
  }

  const from = parseLocalDateInput(state.from);
  const to = parseLocalDateInput(state.to);
  if (!from || !to) {
    return {
      key: "custom",
      invalid: true,
      label: "Custom range",
      startMs: 0,
      endMs: 0,
      prevStartMs: 0,
      prevEndMs: 0,
      bucket: "day",
      fromInput: state.from || "",
      toInput: state.to || ""
    };
  }

  const start = startOfLocalDay(from.getTime() <= to.getTime() ? from : to);
  const end = endOfLocalDay(from.getTime() <= to.getTime() ? to : from);
  const duration = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - duration);
  const daySpan = Math.max(1, Math.round(duration / 86400000));
  return {
    key: "custom",
    label: `${formatReadableDate(start)} – ${formatReadableDate(end)}`,
    startMs: start.getTime(),
    endMs: end.getTime(),
    prevStartMs: startOfLocalDay(prevStart).getTime(),
    prevEndMs: prevEnd.getTime(),
    bucket: daySpan <= 2 ? "hour" : daySpan <= 62 ? "day" : daySpan <= 400 ? "week" : "month",
    fromInput: formatLocalDateInput(start),
    toInput: formatLocalDateInput(end)
  };
}

function buildBuckets(period) {
  if (!period || period.invalid) return [];
  const buckets = [];
  if (period.bucket === "hour") {
    const start = new Date(period.startMs);
    const endHour = new Date(Math.min(period.endMs, Date.now()));
    const lastHour = endHour.getHours();
    const sameDay = localDayKey(start) === localDayKey(endHour);
    const hours = sameDay ? lastHour + 1 : 24;
    for (let hour = 0; hour < hours; hour += 1) {
      const date = new Date(start);
      date.setHours(hour, 0, 0, 0);
      const next = new Date(date);
      next.setHours(hour + 1, 0, 0, 0);
      buckets.push({
        key: `${localDayKey(date)}-${hour}`,
        label: `${String(hour).padStart(2, "0")}:00`,
        startMs: date.getTime(),
        endMs: next.getTime() - 1
      });
    }
    return buckets;
  }

  if (period.bucket === "month") {
    const start = new Date(period.startMs);
    const end = new Date(period.endMs);
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor.getTime() <= end.getTime()) {
      const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      buckets.push({
        key: `${cursor.getFullYear()}-${cursor.getMonth() + 1}`,
        label: cursor.toLocaleDateString("en-US", { month: "short" }),
        startMs: cursor.getTime(),
        endMs: next.getTime() - 1
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return buckets;
  }

  if (period.bucket === "week") {
    let cursor = startOfWeekMonday(new Date(period.startMs));
    while (cursor.getTime() <= period.endMs) {
      const end = endOfWeekSunday(cursor);
      buckets.push({
        key: formatLocalDateInput(cursor),
        label: formatReadableDate(cursor),
        startMs: cursor.getTime(),
        endMs: end.getTime()
      });
      cursor = addDays(cursor, 7);
    }
    return buckets;
  }

  const start = startOfLocalDay(period.startMs);
  const end = startOfLocalDay(period.endMs);
  for (let cursor = new Date(start); cursor.getTime() <= end.getTime(); cursor = addDays(cursor, 1)) {
    const dayStart = startOfLocalDay(cursor);
    buckets.push({
      key: formatLocalDateInput(dayStart),
      label: dayStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      startMs: dayStart.getTime(),
      endMs: endOfLocalDay(dayStart).getTime()
    });
  }
  return buckets;
}

function seriesFromItems(items, getTime, getValue, period) {
  return buildBuckets(period).map((bucket) => ({
    label: bucket.label,
    value: asList(items).reduce((sum, item) => {
      const time = getTime(item);
      return inRange(time, bucket.startMs, bucket.endMs) ? sum + getValue(item) : sum;
    }, 0)
  }));
}

function lineItems(order) {
  return asList(order?.products || order?.items);
}

function unitsFromOrders(orders) {
  return asList(orders).reduce((sum, order) => (
    sum + lineItems(order).reduce((inner, item) => inner + Math.max(1, asNumber(item?.qty || item?.quantity || 1, 1)), 0)
  ), 0);
}

function deriveTopProducts(orders, products) {
  const catalog = new Map();
  asList(products).forEach((product) => {
    const id = String(product?.id || product?.catalogId || "").trim();
    const name = String(product?.name || product?.title || "").trim().toLowerCase();
    if (id) catalog.set(id, product);
    if (name) catalog.set(name, product);
  });

  const lookup = new Map();
  asList(orders).forEach((order) => {
    const orderId = String(order?.orderId || order?.id || "");
    lineItems(order).forEach((item) => {
      const id = String(item?.productId || item?.id || "").trim();
      const name = String(item?.productName || item?.name || "Product").trim();
      const key = id || name.toLowerCase();
      if (!key) return;
      const current = lookup.get(key) || {
        id: id || key,
        name,
        quantity: 0,
        revenue: 0,
        orderIds: new Set()
      };
      const quantity = Math.max(1, asNumber(item?.qty || item?.quantity || 1, 1));
      current.quantity += quantity;
      current.revenue += asNumber(item?.lineTotal) || quantity * asNumber(item?.price);
      if (orderId) current.orderIds.add(orderId);
      lookup.set(key, current);
    });
  });

  return Array.from(lookup.values())
    .map((item) => {
      const matched = catalog.get(String(item.id)) || catalog.get(String(item.name).toLowerCase()) || {};
      return {
        id: item.id,
        name: item.name || matched.name || "Product",
        quantity: item.quantity,
        revenue: item.revenue,
        orders: item.orderIds.size,
        stock: Number.isFinite(Number(matched.stock)) ? asNumber(matched.stock) : null,
        status: matched.status || ""
      };
    })
    .sort((left, right) => right.revenue - left.revenue || right.quantity - left.quantity)
    .slice(0, TOP_PRODUCTS_LIMIT);
}

function peakAndLow(series) {
  const points = asList(series);
  if (!points.length || !points.some((entry) => entry.value > 0)) {
    return { peak: null, low: null };
  }
  const withValue = points.filter((entry) => entry.value > 0);
  const peak = withValue.reduce((best, entry) => (entry.value > best.value ? entry : best));
  const low = withValue.reduce((best, entry) => (entry.value < best.value ? entry : best));
  return { peak, low };
}

export function buildStatisticsModel(payload, periodState = {}) {
  const period = resolvePeriod(periodState);
  const failed = failedSet(payload?.failedSources);
  const ordersFailed = failed.has("orders");
  const customersFailed = failed.has("customers");
  const productsFailed = failed.has("products");
  const orders = asList(payload?.orders);
  const customers = asList(payload?.customers);
  const products = asList(payload?.products);

  if (period.invalid) {
    return {
      period,
      failed,
      ordersFailed,
      customersFailed,
      productsFailed,
      invalid: true,
      revenue: 0,
      ordersCount: 0,
      averageOrderValue: 0,
      newCustomers: 0,
      unitsSold: 0,
      revenueSeries: [],
      orderSeries: [],
      customerSeries: [],
      statusBreakdown: [],
      topProducts: [],
      insights: []
    };
  }

  const periodOrders = orders.filter((order) => inRange(orderTimestamp(order), period.startMs, period.endMs));
  const prevOrders = orders.filter((order) => inRange(orderTimestamp(order), period.prevStartMs, period.prevEndMs));
  const eligible = periodOrders.filter(isRevenueEligible);
  const prevEligible = prevOrders.filter(isRevenueEligible);

  const revenue = eligible.reduce((sum, order) => sum + orderTotal(order), 0);
  const prevRevenue = prevEligible.reduce((sum, order) => sum + orderTotal(order), 0);
  const ordersCount = periodOrders.length;
  const prevOrdersCount = prevOrders.length;
  const averageOrderValue = eligible.length ? revenue / eligible.length : 0;
  const prevAverageOrderValue = prevEligible.length ? prevRevenue / prevEligible.length : 0;
  const unitsSold = unitsFromOrders(eligible);
  const prevUnitsSold = unitsFromOrders(prevEligible);

  const newCustomers = customers.filter((customer) => inRange(customerTimestamp(customer), period.startMs, period.endMs));
  const prevNewCustomers = customers.filter((customer) => inRange(customerTimestamp(customer), period.prevStartMs, period.prevEndMs));
  const customersToDate = customers.filter((customer) => {
    const time = customerTimestamp(customer);
    return time > 0 && time <= period.endMs;
  }).length;
  const returningCustomers = customers.filter((customer) => asNumber(customer?.totalOrders) >= 2).length;

  const revenueSeries = seriesFromItems(eligible, orderTimestamp, orderTotal, period);
  const orderSeries = seriesFromItems(periodOrders, orderTimestamp, () => 1, period);
  const joinedSeries = seriesFromItems(newCustomers, customerTimestamp, () => 1, period);
  let running = customers.filter((customer) => {
    const time = customerTimestamp(customer);
    return time > 0 && time < period.startMs;
  }).length;
  const customerSeries = joinedSeries.map((entry) => {
    running += entry.value;
    return { label: entry.label, value: entry.value, cumulative: running };
  });

  const statusCounts = new Map();
  periodOrders.forEach((order) => {
    const label = normalizeStatusLabel(order?.status || order?.orderStatus);
    statusCounts.set(label, (statusCounts.get(label) || 0) + 1);
  });
  const statusBreakdown = STATUS_ORDER
    .filter((label) => statusCounts.has(label))
    .map((label) => ({ label, value: statusCounts.get(label), tone: statusTone(label) }));

  const topProducts = deriveTopProducts(eligible, products);
  const soldIds = new Set(topProducts.map((item) => String(item.id)));
  const soldNames = new Set(topProducts.map((item) => String(item.name).toLowerCase()));
  const unsoldProducts = products.filter((product) => {
    const id = String(product?.id || "");
    const name = String(product?.name || "").toLowerCase();
    return !soldIds.has(id) && !soldNames.has(name);
  });
  const lowStock = products.filter((product) => asNumber(product?.stock) > 0 && asNumber(product?.stock) <= LOW_STOCK_THRESHOLD);
  const { peak, low } = peakAndLow(revenueSeries);
  const orderPeak = peakAndLow(orderSeries).peak;

  const insights = [];
  if (peak) insights.push(`Peak eligible revenue was ${formatCurrency(peak.value)} in ${peak.label}.`);
  if (low && peak && low.label !== peak.label) insights.push(`Lowest recorded revenue bucket was ${formatCurrency(low.value)} in ${low.label}.`);
  if (orderPeak) insights.push(`Highest order volume was ${formatNumber(orderPeak.value)} in ${orderPeak.label}.`);
  const cancelled = statusCounts.get("Cancelled") || 0;
  if (cancelled) insights.push(`${formatNumber(cancelled)} cancelled order${cancelled === 1 ? "" : "s"} in this period.`);
  if (!productsFailed && unsoldProducts.length) {
    insights.push(`${formatNumber(unsoldProducts.length)} catalog item${unsoldProducts.length === 1 ? "" : "s"} had no eligible sales in this period.`);
  }

  return {
    period,
    failed,
    ordersFailed,
    customersFailed,
    productsFailed,
    invalid: false,
    revenue,
    prevRevenue,
    revenueChange: percentChange(revenue, prevRevenue),
    ordersCount,
    prevOrdersCount,
    ordersChange: percentChange(ordersCount, prevOrdersCount),
    eligibleCount: eligible.length,
    averageOrderValue,
    aovChange: percentChange(averageOrderValue, prevAverageOrderValue),
    newCustomers: newCustomers.length,
    prevNewCustomers: prevNewCustomers.length,
    customersChange: percentChange(newCustomers.length, prevNewCustomers.length),
    customersToDate,
    returningCustomers,
    unitsSold,
    unitsChange: percentChange(unitsSold, prevUnitsSold),
    revenueSeries,
    orderSeries,
    customerSeries,
    hasRevenueTrend: revenueSeries.some((entry) => entry.value > 0),
    hasOrderTrend: orderSeries.some((entry) => entry.value > 0),
    hasCustomerTrend: customerSeries.some((entry) => entry.value > 0),
    statusBreakdown,
    topProducts,
    unsoldCount: unsoldProducts.length,
    lowStockCount: lowStock.length,
    peak,
    low,
    insights
  };
}

function renderAreaChart(series, label, emptyMessage) {
  const points = asList(series);
  if (!points.length || !points.some((entry) => entry.value > 0)) {
    return emptyState(emptyMessage || "No statistics available for this period.");
  }
  const maxValue = Math.max(1, ...points.map((entry) => asNumber(entry.value)));
  const width = Math.max(1, points.length - 1);
  const coords = points.map((entry, index) => ({
    x: points.length === 1 ? 50 : (index / width) * 100,
    y: 86 - ((asNumber(entry.value) / maxValue) * 72),
    entry
  }));
  const line = coords.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  return `
    <div class="stats-chart stats-chart-area" role="img" aria-label="${escapeHtml(label)}">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="statsRevenueFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="rgba(0,184,148,0.28)"></stop>
            <stop offset="100%" stop-color="rgba(0,184,148,0.02)"></stop>
          </linearGradient>
        </defs>
        <polygon points="0,100 ${line} 100,100" fill="url(#statsRevenueFill)"></polygon>
        <polyline points="${line}" fill="none" stroke="#00b894" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline>
      </svg>
      <div class="stats-chart-points">
        ${coords.map((point) => `
          <button type="button" class="stats-chart-point" style="left:${point.x}%; top:${point.y}%" title="${escapeHtml(point.entry.label)}: ${formatCurrency(point.entry.value)}" aria-label="${escapeHtml(point.entry.label)} ${formatCurrency(point.entry.value)}"></button>
        `).join("")}
      </div>
      <div class="stats-chart-axis">
        ${points.map((entry) => `<span title="${escapeHtml(entry.label)}">${escapeHtml(entry.label)}</span>`).join("")}
      </div>
    </div>
  `;
}

function renderColumnChart(series, label, formatter, emptyMessage) {
  const points = asList(series);
  if (!points.length || !points.some((entry) => entry.value > 0)) {
    return emptyState(emptyMessage || "No statistics available for this period.");
  }
  const maxValue = Math.max(1, ...points.map((entry) => asNumber(entry.value)));
  return `
    <div class="stats-columns" role="img" aria-label="${escapeHtml(label)}">
      ${points.map((entry) => `
        <div class="stats-column">
          <span class="stats-column-fill" style="height:${asNumber(entry.value) > 0 ? Math.max(6, Math.round((asNumber(entry.value) / maxValue) * 100)) : 0}%" title="${escapeHtml(entry.label)}: ${escapeHtml(formatter(entry.value))}"></span>
          <small title="${escapeHtml(entry.label)}">${escapeHtml(entry.label)}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function renderGrowthChart(series, label) {
  const points = asList(series);
  if (!points.length || !points.some((entry) => entry.value > 0 || entry.cumulative > 0)) {
    return emptyState("No customer activity yet for this period.");
  }
  const maxBar = Math.max(1, ...points.map((entry) => asNumber(entry.value)));
  const maxCumulative = Math.max(1, ...points.map((entry) => asNumber(entry.cumulative)));
  const width = Math.max(1, points.length - 1);
  const line = points.map((entry, index) => {
    const x = points.length === 1 ? 50 : (index / width) * 100;
    const y = 88 - ((asNumber(entry.cumulative) / maxCumulative) * 70);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return `
    <div class="stats-growth" role="img" aria-label="${escapeHtml(label)}">
      <div class="stats-growth-bars">
        ${points.map((entry) => `
          <span class="stats-growth-bar" style="height:${asNumber(entry.value) > 0 ? Math.max(4, Math.round((asNumber(entry.value) / maxBar) * 100)) : 0}%" title="${escapeHtml(entry.label)}: ${formatNumber(entry.value)} new · ${formatNumber(entry.cumulative)} cumulative"></span>
        `).join("")}
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points="${line}" fill="none" stroke="#1780c2" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline>
      </svg>
      <div class="stats-chart-axis">
        ${points.map((entry) => `<span title="${escapeHtml(entry.label)}">${escapeHtml(entry.label)}</span>`).join("")}
      </div>
    </div>
  `;
}

function renderDonut(items) {
  const points = asList(items).filter((item) => item.value > 0);
  if (!points.length) {
    return emptyState("No orders in this period.");
  }
  const total = points.reduce((sum, item) => sum + asNumber(item.value), 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const toneColor = {
    success: "#12a874",
    warn: "#dc8b1a",
    danger: "#d14f45",
    neutral: "#1780c2"
  };
  return `
    <div class="stats-donut-wrap">
      <svg class="stats-donut" viewBox="0 0 100 100" role="img" aria-label="Order status distribution">
        <circle cx="50" cy="50" r="${radius}" fill="none" stroke="#e8efed" stroke-width="12"></circle>
        ${points.map((item) => {
          const length = (asNumber(item.value) / total) * circumference;
          const circle = `<circle cx="50" cy="50" r="${radius}" fill="none" stroke="${toneColor[item.tone] || toneColor.neutral}" stroke-width="12" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 50 50)"></circle>`;
          offset += length;
          return circle;
        }).join("")}
        <text x="50" y="48" text-anchor="middle" class="stats-donut-total">${escapeHtml(formatNumber(total))}</text>
        <text x="50" y="62" text-anchor="middle" class="stats-donut-caption">orders</text>
      </svg>
      <ul class="stats-legend">
        ${points.map((item) => `
          <li>
            <span class="stats-legend-swatch is-${escapeHtml(item.tone)}"></span>
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(formatNumber(item.value))}</strong>
          </li>
        `).join("")}
      </ul>
    </div>
  `;
}

function metricCard({ label, value, note, change, failed, error }) {
  if (failed) {
    return `
      <article class="stats-metric is-error">
        <p class="stats-metric-label">${escapeHtml(label)}</p>
        <p class="stats-metric-error">${escapeHtml(error || "Unable to load this metric.")}</p>
        <button type="button" class="btn btn-ghost" data-statistics-refresh>Retry</button>
      </article>
    `;
  }
  return `
    <article class="stats-metric">
      <p class="stats-metric-label">${escapeHtml(label)}</p>
      <p class="stats-metric-value">${escapeHtml(value)}</p>
      <p class="stats-metric-note">${changeMarkup(change)}${note ? `<span>${escapeHtml(note)}</span>` : ""}</p>
    </article>
  `;
}

function renderBreakdown(series, formatter) {
  const points = asList(series).filter((entry) => entry.value > 0);
  if (!points.length) {
    return emptyState("No statistics available for this period.");
  }
  return `
    <div class="stats-table-wrap">
      <table class="stats-table">
        <thead>
          <tr><th>Period</th><th>Revenue</th></tr>
        </thead>
        <tbody>
          ${points.map((entry) => `
            <tr>
              <td>${escapeHtml(entry.label)}</td>
              <td>${escapeHtml(formatter(entry.value))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderProductTable(model) {
  if (model.ordersFailed) {
    return `<div class="stats-error" role="alert"><p>Unable to load product sales.</p><button type="button" class="btn btn-ghost" data-statistics-refresh>Retry</button></div>`;
  }
  if (!model.topProducts.length) {
    return emptyState("No sales data available for this period.");
  }
  return `
    <div class="stats-table-wrap">
      <table class="stats-table">
        <caption class="visually-hidden">Product performance for the selected period</caption>
        <thead>
          <tr>
            <th>Product</th>
            <th>Units sold</th>
            <th>Revenue</th>
            <th>Orders</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${model.topProducts.map((product) => {
            const status = product.status
              ? product.status
              : (product.stock == null ? "From orders" : asNumber(product.stock) <= 0 ? "Out of stock" : asNumber(product.stock) <= LOW_STOCK_THRESHOLD ? "Low stock" : "In stock");
            return `
              <tr>
                <td><span class="stats-truncate" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</span></td>
                <td>${escapeHtml(formatNumber(product.quantity))}</td>
                <td>${escapeHtml(formatCurrency(product.revenue))}</td>
                <td>${escapeHtml(formatNumber(product.orders))}</td>
                <td>${badge(status, statusTone(status))}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function periodButtons(period) {
  return PERIOD_OPTIONS.map((option) => `
    <button type="button" class="stats-period-btn${period.key === option.key ? " is-active" : ""}" data-statistics-period="${option.key}" aria-pressed="${period.key === option.key ? "true" : "false"}">${escapeHtml(option.label)}</button>
  `).join("");
}

export function buildStatisticsMarkup(model) {
  const period = model.period || { key: "month", label: "This month" };
  const todayMax = formatLocalDateInput(new Date());
  return `
    <section class="stats-workspace" data-statistics-root>
      <div class="stats-toolbar">
        <div>
          <p class="stats-lede">Detailed revenue, order, customer and product performance.</p>
          <p class="stats-period-label">Active period: <strong>${escapeHtml(period.label)}</strong></p>
        </div>
        <div class="stats-toolbar-actions">
          <button type="button" class="btn btn-ghost" data-statistics-refresh>Refresh</button>
          <button type="button" class="btn btn-secondary stats-export" data-statistics-export ${model.invalid ? "disabled" : ""}>Export snapshot</button>
        </div>
      </div>

      <form class="stats-filters" data-statistics-filters>
        <div class="stats-period-row" role="group" aria-label="Statistics period">
          ${periodButtons(period)}
        </div>
        <div class="stats-custom${period.key === "custom" ? " is-open" : ""}" data-statistics-custom>
          <label>
            <span>From</span>
            <input type="date" name="from" max="${escapeHtml(todayMax)}" value="${escapeHtml(period.fromInput || "")}">
          </label>
          <label>
            <span>To</span>
            <input type="date" name="to" max="${escapeHtml(todayMax)}" value="${escapeHtml(period.toInput || "")}">
          </label>
          <button type="submit" class="btn btn-secondary">Apply range</button>
        </div>
      </form>

      ${model.invalid
        ? `<div class="stats-empty-period">${emptyState("Select a start and end date to view statistics.")}</div>`
        : `
      <section class="stats-summary" aria-label="Period summary">
        ${metricCard({
          label: "Revenue",
          value: formatCurrency(model.revenue),
          note: "Eligible order totals",
          change: model.revenueChange,
          failed: model.ordersFailed,
          error: "Unable to load revenue statistics."
        })}
        ${metricCard({
          label: "Orders",
          value: formatNumber(model.ordersCount),
          note: "All captured orders in period",
          change: model.ordersChange,
          failed: model.ordersFailed,
          error: "Unable to load order statistics."
        })}
        ${metricCard({
          label: "Average order value",
          value: formatCurrency(model.averageOrderValue),
          note: `${formatNumber(model.eligibleCount)} eligible orders`,
          change: model.aovChange,
          failed: model.ordersFailed,
          error: "Unable to load revenue statistics."
        })}
        ${metricCard({
          label: "New customers",
          value: formatNumber(model.newCustomers),
          note: `${formatNumber(model.customersToDate)} on file to date`,
          change: model.customersChange,
          failed: model.customersFailed,
          error: "Unable to load customer statistics."
        })}
        ${metricCard({
          label: "Units sold",
          value: formatNumber(model.unitsSold),
          note: "From eligible order items",
          change: model.unitsChange,
          failed: model.ordersFailed,
          error: "Unable to load product sales."
        })}
      </section>

      <article class="stats-card stats-card-revenue">
        <header class="stats-card-header">
          <div>
            <h2>Revenue Analytics</h2>
            <p>Eligible revenue for the selected period. Cancelled, returned, and refunded orders are excluded.</p>
          </div>
        </header>
        <div class="stats-revenue-grid">
          <div>
            ${model.ordersFailed && !model.hasRevenueTrend
              ? `<div class="stats-error" role="alert"><p>Unable to load revenue statistics.</p><button type="button" class="btn btn-ghost" data-statistics-refresh>Retry</button></div>`
              : renderAreaChart(model.revenueSeries, "Revenue over the selected period", "No statistics available for this period.")}
          </div>
          <aside class="stats-revenue-meta">
            <p><span>Total</span><strong>${escapeHtml(formatCurrency(model.revenue))}</strong></p>
            <p><span>Peak</span><strong>${model.peak ? escapeHtml(`${model.peak.label} · ${formatCurrency(model.peak.value)}`) : "—"}</strong></p>
            <p><span>Low</span><strong>${model.low ? escapeHtml(`${model.low.label} · ${formatCurrency(model.low.value)}`) : "—"}</strong></p>
            <p><span>Comparison</span><strong>${changeMarkup(model.revenueChange)}</strong></p>
          </aside>
        </div>
        <div class="stats-breakdown">
          <h3>Revenue breakdown</h3>
          ${model.ordersFailed ? "" : renderBreakdown(model.revenueSeries, formatCurrency)}
        </div>
      </article>

      <section class="stats-split">
        <article class="stats-card">
          <header class="stats-card-header">
            <div>
              <h2>Order Analytics</h2>
              <p>Order volume over time for every captured order in this period.</p>
            </div>
          </header>
          ${model.ordersFailed && !model.hasOrderTrend
            ? `<div class="stats-error" role="alert"><p>Unable to load order statistics.</p><button type="button" class="btn btn-ghost" data-statistics-refresh>Retry</button></div>`
            : renderColumnChart(model.orderSeries, "Orders over the selected period", formatNumber, "No statistics available for this period.")}
        </article>
        <article class="stats-card">
          <header class="stats-card-header">
            <div>
              <h2>Order Status Distribution</h2>
              <p>Statuses present in the selected period.</p>
            </div>
          </header>
          ${model.ordersFailed
            ? `<div class="stats-error" role="alert"><p>Unable to load order statistics.</p><button type="button" class="btn btn-ghost" data-statistics-refresh>Retry</button></div>`
            : renderDonut(model.statusBreakdown)}
        </article>
      </section>

      <section class="stats-split">
        <article class="stats-card">
          <header class="stats-card-header">
            <div>
              <h2>Customer Growth</h2>
              <p>${formatNumber(model.newCustomers)} new this period · bars show new customers, line shows cumulative count.</p>
            </div>
            <a class="stats-link" href="#/customers">Manage customers</a>
          </header>
          ${model.customersFailed && !model.customersToDate
            ? `<div class="stats-error" role="alert"><p>Unable to load customer statistics.</p><button type="button" class="btn btn-ghost" data-statistics-refresh>Retry</button></div>`
            : renderGrowthChart(model.customerSeries, "Customer growth for the selected period")}
          ${!model.customersFailed && model.returningCustomers
            ? `<p class="stats-footnote">${escapeHtml(formatNumber(model.returningCustomers))} customers on file have 2 or more orders.</p>`
            : ""}
        </article>
        <article class="stats-card">
          <header class="stats-card-header">
            <div>
              <h2>Product Analytics</h2>
              <p>Ranked by eligible revenue in the selected period.</p>
            </div>
            <a class="stats-link" href="#/products">View products</a>
          </header>
          ${model.topProducts.length
            ? `<ol class="stats-product-list">${model.topProducts.slice(0, 5).map((product) => `
                <li>
                  <span class="stats-truncate" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</span>
                  <strong>${escapeHtml(formatCurrency(product.revenue))}</strong>
                  <small>${escapeHtml(formatNumber(product.quantity))} sold</small>
                </li>
              `).join("")}</ol>`
            : (model.ordersFailed
              ? `<div class="stats-error" role="alert"><p>Unable to load product sales.</p><button type="button" class="btn btn-ghost" data-statistics-refresh>Retry</button></div>`
              : emptyState("No sales data available for this period."))}
          ${!model.productsFailed && (model.lowStockCount || model.unsoldCount)
            ? `<p class="stats-footnote">${model.lowStockCount ? `${formatNumber(model.lowStockCount)} product${model.lowStockCount === 1 ? "" : "s"} at or below ${LOW_STOCK_THRESHOLD} units. ` : ""}${model.unsoldCount ? `${formatNumber(model.unsoldCount)} catalog item${model.unsoldCount === 1 ? "" : "s"} had no eligible sales in this period.` : ""}</p>`
            : ""}
        </article>
      </section>

      <article class="stats-card">
        <header class="stats-card-header">
          <div>
            <h2>Product Performance</h2>
            <p>Up to ${TOP_PRODUCTS_LIMIT} products with eligible sales in the selected period.</p>
          </div>
        </header>
        ${renderProductTable(model)}
      </article>

      ${model.insights.length
        ? `<article class="stats-card stats-insights"><h2>What the data shows</h2><ul>${model.insights.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></article>`
        : ""}
      `}
    </section>
  `;
}

export function renderStatisticsLoading() {
  return `
    <section class="stats-workspace stats-workspace-loading" aria-busy="true" aria-live="polite">
      <div class="stats-toolbar"><span class="skeleton-line skeleton-line-lg"></span><span class="skeleton-pill"></span></div>
      <section class="stats-summary">
        <article class="stats-metric"><span class="skeleton-line"></span><span class="skeleton-line skeleton-line-lg"></span></article>
        <article class="stats-metric"><span class="skeleton-line"></span><span class="skeleton-line skeleton-line-lg"></span></article>
        <article class="stats-metric"><span class="skeleton-line"></span><span class="skeleton-line skeleton-line-lg"></span></article>
        <article class="stats-metric"><span class="skeleton-line"></span><span class="skeleton-line skeleton-line-lg"></span></article>
        <article class="stats-metric"><span class="skeleton-line"></span><span class="skeleton-line skeleton-line-lg"></span></article>
      </section>
      <article class="stats-card"><span class="skeleton-line skeleton-line-lg"></span><div class="skeleton-box" style="height:220px"></div></article>
    </section>
  `;
}

function readPeriodState(container) {
  return container._statisticsPeriod || { key: "month", from: "", to: "" };
}

function paintStatistics(container, payload, periodState, onRefresh) {
  container._statisticsPeriod = periodState;
  container.innerHTML = buildStatisticsMarkup(buildStatisticsModel(payload, periodState));
  bindStatisticsActions(container, { payload, onRefresh });
}

export function bindStatisticsActions(container, { payload, onRefresh } = {}) {
  if (!container) return;

  const refresh = () => {
    if (typeof onRefresh === "function") {
      onRefresh({ force: true });
    }
  };

  container.querySelectorAll("[data-statistics-refresh]").forEach((button) => {
    button.addEventListener("click", refresh);
  });

  container.querySelectorAll("[data-statistics-period]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = String(button.getAttribute("data-statistics-period") || "month");
      const current = readPeriodState(container);
      paintStatistics(container, payload, { ...current, key }, onRefresh);
    });
  });

  container.querySelector("[data-statistics-filters]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const from = String(form.from?.value || "").trim();
    const to = String(form.to?.value || "").trim();
    paintStatistics(container, payload, { key: "custom", from, to }, onRefresh);
  });

  container.querySelector("[data-statistics-export]")?.addEventListener("click", () => {
    const periodState = readPeriodState(container);
    const model = buildStatisticsModel(payload, periodState);
    if (model.invalid) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsvFile(`byose-statistics-${stamp}.csv`, [
      { Section: "Period", Label: model.period.label, Value: "" },
      { Section: "Summary", Label: "Revenue", Value: model.revenue },
      { Section: "Summary", Label: "Orders", Value: model.ordersCount },
      { Section: "Summary", Label: "Average Order Value", Value: model.averageOrderValue },
      { Section: "Summary", Label: "Eligible Orders", Value: model.eligibleCount },
      { Section: "Summary", Label: "New Customers", Value: model.newCustomers },
      { Section: "Summary", Label: "Units Sold", Value: model.unitsSold },
      ...model.revenueSeries.map((entry) => ({ Section: "Revenue Series", Label: entry.label, Value: entry.value })),
      ...model.orderSeries.map((entry) => ({ Section: "Order Series", Label: entry.label, Value: entry.value })),
      ...model.statusBreakdown.map((entry) => ({ Section: "Order Status", Label: entry.label, Value: entry.value })),
      ...model.topProducts.map((product) => ({
        Section: "Top Products",
        Label: product.name,
        Value: product.revenue,
        Status: `${product.quantity} sold`
      }))
    ]);
  });
}
