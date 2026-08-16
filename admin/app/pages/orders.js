import { badge, emptyState, formatCurrency, formatDate, panel } from "../components/ui.js";
import { bulkDeleteOrders, bulkUpdateOrderStatus, deleteOrder, getOrders, updateOrderStatus } from "../services/admin-data.service.js";
import { downloadCsvFile, openPrintableReport } from "../services/enterprise-intelligence.service.js";
import { subscribeToLiveFeeds } from "../services/live-feeds.service.js";

const STATUS_OPTIONS = [
  "Pending",
  "Confirmed",
  "Processing",
  "Packed",
  "Shipping",
  "Delivered",
  "Cancelled",
  "Returned",
  "Refunded"
];

const PRIORITY_OPTIONS = [
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" }
];

const STAFF_OPTIONS = ["Unassigned", "Admin", "Fulfillment", "Support", "Delivery"];
const ORDER_META_STORAGE_KEY = "byose.admin.orderMeta.v1";
const ORDERS_FILTER_STORAGE_KEY = "byose.admin.orders.listFilters.v1";
const DATE_TABS = [
  { key: "all", label: "All Orders" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "custom", label: "Custom Range" }
];
const DATE_TAB_SHORT = {
  all: "All",
  today: "Today",
  yesterday: "Yesterday",
  week: "This Week",
  month: "This Month",
  custom: "Custom"
};
const PAYMENT_METHOD_FILTERS = [
  { value: "mtn", label: "MTN MoMo" },
  { value: "card", label: "Card" },
  { value: "cod", label: "Cash on Delivery" }
];
const PAYMENT_STATUS_FILTERS = [
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "refunded", label: "Refunded" }
];
const DELIVERY_STATUS_FILTERS = [
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "shipped", label: "Shipped" },
  { value: "out_for_delivery", label: "Out for Delivery" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
  { value: "returned", label: "Returned" }
];
const SORT_LABELS = {
  "date-desc": "Newest First",
  "date-asc": "Oldest First",
  "total-desc": "Highest Total",
  "total-asc": "Lowest Total",
  "customer-asc": "Customer Name A–Z",
  "customer-desc": "Customer Name Z–A",
  status: "Status"
};
const PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 25, 50];
const ORDER_DETAIL_NAV = [
  { key: "summary", label: "Summary" },
  { key: "products", label: "Products" },
  { key: "customer", label: "Customer" },
  { key: "payment", label: "Payment" },
  { key: "shipping", label: "Shipping" },
  { key: "timeline", label: "Timeline" },
  { key: "manage", label: "Manage" }
];

let ordersUxDialogResolver = null;
let ordersNoticeTimer = 0;

function resolvePageSize(stateLike = {}) {
  const size = Number(stateLike.pageSize) || PAGE_SIZE;
  return PAGE_SIZE_OPTIONS.includes(size) ? size : PAGE_SIZE;
}

function buildPaginationPages(current = 1, total = 1) {
  const safeTotal = Math.max(1, Number(total) || 1);
  const safeCurrent = Math.min(Math.max(1, Number(current) || 1), safeTotal);
  if (safeTotal <= 7) {
    return Array.from({ length: safeTotal }, (_, index) => index + 1);
  }
  const marks = new Set([1, safeTotal, safeCurrent, safeCurrent - 1, safeCurrent + 1, safeCurrent - 2, safeCurrent + 2]);
  const sorted = Array.from(marks).filter((page) => page >= 1 && page <= safeTotal).sort((a, b) => a - b);
  const pages = [];
  let previous = 0;
  sorted.forEach((page) => {
    if (previous && page - previous > 1) pages.push("ellipsis");
    pages.push(page);
    previous = page;
  });
  return pages;
}

function ensureOrdersUxHost() {
  let host = document.getElementById("ordersUxOverlayHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "ordersUxOverlayHost";
    host.className = "orders-ux-overlay-host";
    host.hidden = true;
    document.body.appendChild(host);
  }
  return host;
}

function closeOrdersUxDialog(result = false) {
  const host = document.getElementById("ordersUxOverlayHost");
  if (host) {
    host.hidden = true;
    host.innerHTML = "";
    host.onclick = null;
  }
  const resolve = ordersUxDialogResolver;
  ordersUxDialogResolver = null;
  if (typeof resolve === "function") resolve(result);
}

function openOrdersConfirmDialog({
  title = "Confirm",
  message = "",
  details = [],
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "warn"
} = {}) {
  return new Promise((resolve) => {
    closeOrdersUxDialog(false);
    ordersUxDialogResolver = resolve;
    const host = ensureOrdersUxHost();
    const detailsHtml = (Array.isArray(details) ? details : [])
      .filter((row) => Array.isArray(row) && row[0] && String(row[1] ?? "").trim() !== "")
      .map((row) => `<div class="orders-ux-info-row"><span>${escapeHtml(row[0])}</span><strong>${escapeHtml(row[1])}</strong></div>`)
      .join("");
    host.hidden = false;
    host.innerHTML = `
      <div class="orders-ux-backdrop" data-orders-dialog-dismiss></div>
      <div class="orders-ux-dialog orders-ux-dialog--${escapeHtml(tone)}" role="alertdialog" aria-modal="true" aria-labelledby="ordersUxDialogTitle" aria-describedby="ordersUxDialogBody">
        <header class="orders-ux-dialog__head">
          <h3 id="ordersUxDialogTitle">${escapeHtml(title)}</h3>
        </header>
        <div class="orders-ux-dialog__body" id="ordersUxDialogBody">
          ${message ? `<p>${escapeHtml(message)}</p>` : ""}
          ${detailsHtml}
        </div>
        <footer class="orders-ux-dialog__actions">
          <button type="button" class="orders-tool-btn" data-orders-dialog-dismiss>${escapeHtml(cancelLabel)}</button>
          <button type="button" class="orders-tool-btn ${tone === "danger" ? "orders-tool-btn--danger" : "orders-tool-btn--primary"}" data-orders-dialog-confirm autofocus>${escapeHtml(confirmLabel)}</button>
        </footer>
      </div>
    `;
    host.onclick = (event) => {
      if (event.target?.closest?.("[data-orders-dialog-confirm]")) {
        const confirmBtn = event.target.closest("[data-orders-dialog-confirm]");
        if (confirmBtn?.disabled) return;
        confirmBtn.disabled = true;
        closeOrdersUxDialog(true);
        return;
      }
      if (event.target?.closest?.("[data-orders-dialog-dismiss]")) {
        closeOrdersUxDialog(false);
      }
    };
    host.querySelector("[data-orders-dialog-confirm]")?.focus();
  });
}

function openOrdersInfoDialog({ title = "Details", lines = [] } = {}) {
  return new Promise((resolve) => {
    closeOrdersUxDialog(false);
    ordersUxDialogResolver = resolve;
    const host = ensureOrdersUxHost();
    const rows = (Array.isArray(lines) ? lines : [])
      .map((line) => {
        if (Array.isArray(line)) {
          return `<div class="orders-ux-info-row"><span>${escapeHtml(line[0])}</span><strong>${escapeHtml(line[1])}</strong></div>`;
        }
        return `<p>${escapeHtml(line)}</p>`;
      })
      .join("");
    host.hidden = false;
    host.innerHTML = `
      <div class="orders-ux-backdrop" data-orders-dialog-dismiss></div>
      <div class="orders-ux-dialog orders-ux-dialog--info" role="dialog" aria-modal="true" aria-labelledby="ordersUxDialogTitle">
        <header class="orders-ux-dialog__head">
          <h3 id="ordersUxDialogTitle">${escapeHtml(title)}</h3>
          <button type="button" class="orders-ux-dialog__close" data-orders-dialog-dismiss aria-label="Close dialog">×</button>
        </header>
        <div class="orders-ux-dialog__body orders-ux-dialog__body--info">${rows || "<p>No details available.</p>"}</div>
        <footer class="orders-ux-dialog__actions">
          <button type="button" class="orders-tool-btn orders-tool-btn--primary" data-orders-dialog-dismiss autofocus>Close</button>
        </footer>
      </div>
    `;
    host.onclick = (event) => {
      if (event.target?.closest?.("[data-orders-dialog-dismiss]")) {
        closeOrdersUxDialog(true);
      }
    };
    host.querySelector("[data-orders-dialog-dismiss].orders-tool-btn, [data-orders-dialog-dismiss][autofocus]")?.focus();
  });
}

function openOrdersStatusDialog({ order, options = [] } = {}) {
  const choices = Array.isArray(options) ? options.filter(Boolean) : [];
  if (!choices.length) return Promise.resolve("");
  const orderNumber = resolveOrderIdentifiers(order).orderNumber || order?.orderId || order?.id || "";
  const current = getOrderStatusLabel(order);
  return new Promise((resolve) => {
    closeOrdersUxDialog(false);
    ordersUxDialogResolver = (result) => resolve(result ? String(result) : "");
    const host = ensureOrdersUxHost();
    const warning = choices.includes("Cancelled")
      ? "<p class=\"orders-ux-dialog__hint\">Cancelling restores stock. Paid orders may be prepared for Returns &amp; Refunds.</p>"
      : "";
    const restoreHint = choices.length === 1 && choices[0] === "Pending"
      ? "<p class=\"orders-ux-dialog__hint\">Restoring a cancelled order re-reserves stock if inventory is available.</p>"
      : "";
    host.hidden = false;
    host.innerHTML = `
      <div class="orders-ux-backdrop" data-orders-dialog-dismiss></div>
      <div class="orders-ux-dialog" role="dialog" aria-modal="true" aria-labelledby="ordersUxDialogTitle">
        <header class="orders-ux-dialog__head">
          <h3 id="ordersUxDialogTitle">Change order status?</h3>
        </header>
        <div class="orders-ux-dialog__body" id="ordersUxDialogBody">
          <div class="orders-ux-info-row"><span>Order</span><strong>#${escapeHtml(orderNumber)}</strong></div>
          <div class="orders-ux-info-row"><span>From</span><strong>${escapeHtml(current)}</strong></div>
          <label class="orders-ux-dialog__field">
            <span>To</span>
            <select id="ordersStatusDialogSelect" aria-label="New order status">
              ${choices.map((status, index) => `<option value="${escapeHtml(status)}" ${index === 0 ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}
            </select>
          </label>
          ${warning}${restoreHint}
        </div>
        <footer class="orders-ux-dialog__actions">
          <button type="button" class="orders-tool-btn" data-orders-dialog-dismiss>Keep Status</button>
          <button type="button" class="orders-tool-btn orders-tool-btn--primary" data-orders-dialog-confirm autofocus>Confirm Status Change</button>
        </footer>
      </div>
    `;
    const confirmBtn = host.querySelector("[data-orders-dialog-confirm]");
    const select = host.querySelector("#ordersStatusDialogSelect");
    host.onclick = (event) => {
      if (event.target?.closest?.("[data-orders-dialog-confirm]")) {
        if (confirmBtn?.disabled) return;
        confirmBtn.disabled = true;
        closeOrdersUxDialog(select?.value || choices[0]);
        return;
      }
      if (event.target?.closest?.("[data-orders-dialog-dismiss]")) {
        closeOrdersUxDialog("");
      }
    };
    select?.focus();
  });
}

function openOrdersCancelDialog(order) {
  const orderNumber = resolveOrderIdentifiers(order).orderNumber || order?.orderId || order?.id || "";
  const current = getOrderStatusLabel(order);
  return new Promise((resolve) => {
    closeOrdersUxDialog(false);
    const host = ensureOrdersUxHost();
    ordersUxDialogResolver = resolve;
    host.hidden = false;
    host.innerHTML = `
      <div class="orders-ux-backdrop" data-orders-dialog-dismiss></div>
      <div class="orders-ux-dialog orders-ux-dialog--danger" role="alertdialog" aria-modal="true" aria-labelledby="ordersUxDialogTitle">
        <header class="orders-ux-dialog__head">
          <h3 id="ordersUxDialogTitle">Cancel this order?</h3>
        </header>
        <div class="orders-ux-dialog__body">
          <div class="orders-ux-info-row"><span>Order</span><strong>#${escapeHtml(orderNumber)}</strong></div>
          <div class="orders-ux-info-row"><span>Current status</span><strong>${escapeHtml(current)}</strong></div>
          <p>This action may affect payment and inventory. Stock will be restored. Paid orders are prepared for Returns &amp; Refunds.</p>
          <label class="orders-ux-dialog__field">
            <span>Cancellation reason (optional)</span>
            <textarea id="ordersCancelReason" rows="3" maxlength="240">Cancelled by administrator</textarea>
          </label>
        </div>
        <footer class="orders-ux-dialog__actions">
          <button type="button" class="orders-tool-btn" data-orders-dialog-dismiss>Keep Order</button>
          <button type="button" class="orders-tool-btn orders-tool-btn--danger" data-orders-dialog-confirm autofocus>Cancel Order</button>
        </footer>
      </div>
    `;
    host.onclick = (event) => {
      if (event.target?.closest?.("[data-orders-dialog-confirm]")) {
        const confirmBtn = event.target.closest("[data-orders-dialog-confirm]");
        if (confirmBtn?.disabled) return;
        const reason = String(host.querySelector("#ordersCancelReason")?.value || "").trim();
        confirmBtn.disabled = true;
        closeOrdersUxDialog({ confirmed: true, reason });
        return;
      }
      if (event.target?.closest?.("[data-orders-dialog-dismiss]")) {
        closeOrdersUxDialog({ confirmed: false, reason: "" });
      }
    };
    host.querySelector("[data-orders-dialog-confirm]")?.focus();
  });
}
const TIMELINE_STAGES = [
  { key: "created", label: "Created", match: /pending|creat|received|order/i },
  { key: "confirmed", label: "Confirmed", match: /confirm|accept|paid/i },
  { key: "processing", label: "Processing", match: /process/i },
  { key: "packed", label: "Packed", match: /pack/i },
  { key: "shipped", label: "Shipped", match: /ship/i },
  { key: "out_for_delivery", label: "Out for Delivery", match: /out for delivery|out_for_delivery/i },
  { key: "delivered", label: "Delivered", match: /deliver/i },
  { key: "completed", label: "Completed", match: /complete/i },
  { key: "cancelled", label: "Cancelled", match: /cancel/i },
  { key: "returned", label: "Returned", match: /return/i },
  { key: "refunded", label: "Refunded", match: /refund/i }
];

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
  date.setHours(23, 59, 59, 999);
  return date;
}

function parseLocalDateInput(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLocalDateInput(value = new Date()) {
  const date = value instanceof Date ? value : parseLocalDateInput(value);
  if (!date || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function resolveOrderTimestamp(order) {
  const raw = order?.date || order?.createdAt || 0;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatCalendarGroupLabel(dayStartMs, now = new Date()) {
  const todayStart = startOfLocalDay(now).getTime();
  const yesterdayStart = todayStart - 86400000;
  if (dayStartMs === todayStart) return "Today";
  if (dayStartMs === yesterdayStart) return "Yesterday";
  return formatReadableDate(new Date(dayStartMs));
}

function groupOrdersByDate(orders = [], { now = new Date(), newestFirst = true } = {}) {
  const buckets = new Map();
  (Array.isArray(orders) ? orders : []).forEach((order) => {
    const ts = resolveOrderTimestamp(order);
    const key = ts ? startOfLocalDay(new Date(ts)).getTime() : 0;
    const current = buckets.get(key) || [];
    current.push(order);
    buckets.set(key, current);
  });
  return Array.from(buckets.entries())
    .sort((left, right) => {
      if (!left[0]) return 1;
      if (!right[0]) return -1;
      return newestFirst ? right[0] - left[0] : left[0] - right[0];
    })
    .map(([key, groupOrders]) => ({
      key: String(key),
      label: Number(key) ? formatCalendarGroupLabel(Number(key), now) : "Unknown date",
      orders: groupOrders,
      count: groupOrders.length
    }));
}

function normalizeDateTab(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "7d") return "week";
  if (raw === "30d" || raw === "month") return "month";
  if (DATE_TABS.some((tab) => tab.key === raw)) return raw;
  return "all";
}

function paymentMethodFilterLabel(value) {
  const match = PAYMENT_METHOD_FILTERS.find((item) => item.value === String(value || "").toLowerCase());
  return match?.label || titleCaseLabel(value, "");
}

function classifyOrderStatBucket(order) {
  const status = String(order?.status || order?.orderStatus || "").toLowerCase();
  if (status.includes("cancel")) return "cancelled";
  if (status.includes("deliver") || status.includes("complete")) return "delivered";
  if (status.includes("ship") || status.includes("out for delivery") || status.includes("out_for_delivery")) return "shipped";
  if (status.includes("process") || status.includes("pack") || status.includes("confirm")) return "processing";
  return "pending";
}

function computeAllOrdersStats(orders = []) {
  const list = dedupeOrdersById(orders);
  const stats = {
    total: list.length,
    pending: 0,
    processing: 0,
    shipped: 0,
    delivered: 0,
    cancelled: 0
  };
  list.forEach((order) => {
    const bucket = classifyOrderStatBucket(order);
    if (Object.prototype.hasOwnProperty.call(stats, bucket)) stats[bucket] += 1;
  });
  return stats;
}

function isSettledPaidStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (!status) return false;
  if (
    status.includes("unpaid")
    || status.includes("awaiting")
    || status.includes("pending")
    || status.includes("fail")
    || status.includes("cancel")
    || status.includes("unsuccess")
    || status.includes("invalid")
    || status.includes("refund")
  ) {
    return false;
  }
  return status === "paid"
    || status === "success"
    || status === "successful"
    || status === "completed"
    || status === "complete"
    || status === "payment_successful"
    || status === "authorized";
}

function matchesPaymentStatusFilter(order, filter) {
  const raw = String(filter || "").trim().toLowerCase();
  if (!raw) return true;
  const value = String(order?.paymentStatusLabel || order?.paymentStatus || "").toLowerCase();
  if (raw === "paid") {
    return isSettledPaidStatus(value);
  }
  if (raw === "pending") {
    return !isSettledPaidStatus(value) && (value.includes("pending") || value.includes("awaiting") || value.includes("unpaid") || !value);
  }
  if (raw === "failed") {
    return value.includes("fail") || value.includes("decline") || value.includes("error");
  }
  if (raw === "refunded") {
    return value.includes("refund");
  }
  return value.includes(raw);
}

function matchesDeliveryStatusFilter(order, filter) {
  const raw = String(filter || "").trim().toLowerCase();
  if (!raw) return true;
  const value = String(order?.deliveryStatus || order?.shippingStatus || order?.status || "").toLowerCase();
  if (raw === "pending") {
    return value.includes("pending") || value.includes("confirm") || (!value.includes("ship") && !value.includes("deliver") && !value.includes("cancel") && !value.includes("process") && !value.includes("pack") && !value.includes("return"));
  }
  if (raw === "processing") {
    return value.includes("process") || value.includes("pack");
  }
  if (raw === "out_for_delivery" || raw === "out-for-delivery") {
    return value.includes("out for delivery") || value.includes("out_for_delivery");
  }
  if (raw === "shipped") {
    return (value.includes("ship") || value.includes("out for delivery") || value.includes("out_for_delivery"))
      && !value.includes("deliver")
      && !value.includes("complete");
  }
  if (raw === "delivered") {
    return value.includes("deliver") || value.includes("complete");
  }
  if (raw === "cancelled") {
    return value.includes("cancel");
  }
  if (raw === "returned") {
    return value.includes("return");
  }
  return value.includes(raw);
}

function matchesDateTab(order, state = {}, now = new Date()) {
  const tab = normalizeDateTab(state.dateTab || state.dateRangeFilter || "all");
  if (!tab || tab === "all") return true;
  const ts = resolveOrderTimestamp(order);
  if (!ts) return false;
  const todayStart = startOfLocalDay(now).getTime();
  const tomorrowStart = todayStart + 86400000;
  if (tab === "today") return ts >= todayStart && ts < tomorrowStart;
  if (tab === "yesterday") return ts >= (todayStart - 86400000) && ts < todayStart;
  if (tab === "week") {
    return ts >= startOfWeekMonday(now).getTime() && ts <= endOfWeekSunday(now).getTime();
  }
  if (tab === "month") {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const monthEnd = endOfLocalDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)).getTime();
    return ts >= monthStart && ts <= monthEnd;
  }
  if (tab === "custom") {
    const from = parseLocalDateInput(state.customFrom);
    const to = parseLocalDateInput(state.customTo);
    if (!from || !to) return false;
    const start = startOfLocalDay(from).getTime();
    const end = endOfLocalDay(to).getTime();
    return ts >= Math.min(start, end) && ts <= Math.max(start, end);
  }
  return matchesDateRangeFilter(order, tab, now);
}

function matchesDateRangeFilter(order, range, now = new Date()) {
  return matchesDateTab(order, { dateTab: range }, now);
}

function computeDateTabCounts(orders = [], state = {}, now = new Date()) {
  const list = dedupeOrdersById(orders);
  const counts = {
    all: list.length,
    today: 0,
    yesterday: 0,
    week: 0,
    month: 0,
    custom: 0
  };
  list.forEach((order) => {
    if (matchesDateTab(order, { dateTab: "today" }, now)) counts.today += 1;
    if (matchesDateTab(order, { dateTab: "yesterday" }, now)) counts.yesterday += 1;
    if (matchesDateTab(order, { dateTab: "week" }, now)) counts.week += 1;
    if (matchesDateTab(order, { dateTab: "month" }, now)) counts.month += 1;
    if (state.customFrom && state.customTo && matchesDateTab(order, { dateTab: "custom", customFrom: state.customFrom, customTo: state.customTo }, now)) {
      counts.custom += 1;
    }
  });
  return counts;
}

function shouldGroupOrdersByDate(state = {}) {
  const tab = normalizeDateTab(state.dateTab || "all");
  const sort = String(state.sort || "date-desc");
  if (sort !== "date-desc" && sort !== "date-asc") return false;
  return tab === "all" || tab === "week" || tab === "month" || tab === "custom";
}

function formatCount(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function readStoredListFilters() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(ORDERS_FILTER_STORAGE_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function writeStoredListFilters(state = {}) {
  try {
    sessionStorage.setItem(ORDERS_FILTER_STORAGE_KEY, JSON.stringify({
      query: state.query || "",
      dateTab: normalizeDateTab(state.dateTab || "all"),
      customFrom: state.customFrom || "",
      customTo: state.customTo || "",
      customDraftFrom: state.customDraftFrom || state.customFrom || "",
      customDraftTo: state.customDraftTo || state.customTo || "",
      statusFilter: String(state.statusFilter || "").startsWith("status:") ? state.statusFilter : "",
      paymentFilter: state.paymentFilter || "",
      paymentStatusFilter: state.paymentStatusFilter || "",
      deliveryStatusFilter: state.deliveryStatusFilter || "",
      sort: state.sort || "date-desc",
      page: state.page || 1,
      pageSize: state.pageSize || PAGE_SIZE,
      statBucket: state.statBucket || "",
      filtersOpen: Boolean(state.filtersOpen)
    }));
  } catch (_error) {
    /* ignore quota / private mode */
  }
}

function clearStoredListFilters() {
  try {
    sessionStorage.removeItem(ORDERS_FILTER_STORAGE_KEY);
  } catch (_error) {
    /* ignore */
  }
}

function hasActiveListFilters(state = {}) {
  return Boolean(
    String(state.query || "").trim()
    || (normalizeDateTab(state.dateTab || "all") !== "all")
    || String(state.statusFilter || "").startsWith("status:")
    || state.paymentFilter
    || state.paymentStatusFilter
    || state.deliveryStatusFilter
    || state.statBucket
    || (state.sort && state.sort !== "date-desc")
  );
}

function buildActiveFilterChips(state = {}) {
  const chips = [];
  const tab = normalizeDateTab(state.dateTab || "all");
  if (tab !== "all") {
    const tabMeta = DATE_TABS.find((item) => item.key === tab);
    let label = tabMeta?.label || tab;
    if (tab === "custom" && state.customFrom && state.customTo) {
      label = `${formatReadableDate(state.customFrom)} – ${formatReadableDate(state.customTo)}`;
    }
    chips.push({ key: "date", label });
  }
  if (String(state.statusFilter || "").startsWith("status:")) {
    chips.push({ key: "status", label: `Order Status: ${titleCaseLabel(state.statusFilter.slice(7))}` });
  }
  if (state.statBucket) {
    chips.push({ key: "stat", label: `Summary: ${titleCaseLabel(state.statBucket)}` });
  }
  if (state.paymentStatusFilter) {
    const pay = PAYMENT_STATUS_FILTERS.find((item) => item.value === state.paymentStatusFilter);
    chips.push({ key: "payStatus", label: `Payment Status: ${pay?.label || titleCaseLabel(state.paymentStatusFilter)}` });
  }
  if (state.paymentFilter) {
    chips.push({ key: "payMethod", label: `Payment Method: ${paymentMethodFilterLabel(state.paymentFilter)}` });
  }
  if (state.deliveryStatusFilter) {
    const delivery = DELIVERY_STATUS_FILTERS.find((item) => item.value === state.deliveryStatusFilter);
    chips.push({ key: "delivery", label: `Delivery Status: ${delivery?.label || titleCaseLabel(state.deliveryStatusFilter)}` });
  }
  if (String(state.query || "").trim()) {
    chips.push({ key: "query", label: `Search: ${String(state.query).trim()}` });
  }
  return chips;
}

function resetAllOrdersListFilters(state) {
  state.query = "";
  state.statusFilter = "";
  state.paymentFilter = "";
  state.paymentStatusFilter = "";
  state.deliveryStatusFilter = "";
  state.dateRangeFilter = "";
  state.dateTab = "all";
  state.customFrom = "";
  state.customTo = "";
  state.customDraftFrom = "";
  state.customDraftTo = "";
  state.statBucket = "";
  state.sort = "date-desc";
  state.page = 1;
  state.selectedIds = [];
  clearStoredListFilters();
}

function buildOrdersExportRows(orders = []) {
  return (Array.isArray(orders) ? orders : []).map((order) => ({
    "Order Number": order.orderId || order.id || "",
    "Date": order.date || order.createdAt || "",
    "Customer": order.customerName || "",
    "Phone": order.customerPhone || "",
    "Status": order.status || "",
    "Payment Method": paymentLabel(order),
    "Payment Status": order.paymentStatusLabel || order.paymentStatus || "",
    "Delivery Status": order.deliveryStatus || order.status || "",
    "Total": order.total || 0,
    "Items": (order.items || []).map((item) => item.productName).filter(Boolean).join("; ")
  }));
}

function printOrdersListReport(orders = []) {
  const rows = Array.isArray(orders) ? orders : [];
  const body = rows.length
    ? `<table><thead><tr>
        <th>Order</th><th>Date</th><th>Customer</th><th>Status</th><th>Payment</th><th>Total</th>
      </tr></thead><tbody>
      ${rows.map((order) => `<tr>
        <td>${escapeHtml(order.orderId || order.id)}</td>
        <td>${escapeHtml(formatDate(order.date || order.createdAt))}</td>
        <td>${escapeHtml(order.customerName || "—")}</td>
        <td>${escapeHtml(order.status || "—")}</td>
        <td>${escapeHtml(paymentLabel(order))} · ${escapeHtml(order.paymentStatusLabel || order.paymentStatus || "—")}</td>
        <td>${escapeHtml(formatCurrency(order.total || 0))}</td>
      </tr>`).join("")}
      </tbody></table>`
    : "<p>No orders match the current filters.</p>";

  openPrintableReport("All Orders Report", [
    {
      title: "Orders Overview",
      subtitle: `${rows.length} order${rows.length === 1 ? "" : "s"} · Generated ${formatDate(new Date().toISOString())}`,
      content: body
    }
  ]);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readOrderMetaStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ORDER_META_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function writeOrderMetaStore(store) {
  try {
    localStorage.setItem(ORDER_META_STORAGE_KEY, JSON.stringify(store || {}));
  } catch (_error) {
    /* ignore quota / private mode */
  }
}

function normalizeOrderMeta(entry = {}) {
  const tags = Array.isArray(entry.tags)
    ? entry.tags
    : String(entry.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean);
  const priority = String(entry.priority || "normal").toLowerCase();
  return {
    priority: ["high", "normal", "low"].includes(priority) ? priority : "normal",
    staffNotes: String(entry.staffNotes || ""),
    customerNotes: String(entry.customerNotes || ""),
    deliveryNotes: String(entry.deliveryNotes || ""),
    estimatedDelivery: String(entry.estimatedDelivery || ""),
    tags,
    assignedStaff: String(entry.assignedStaff || "")
  };
}

function getOrderMeta(orderId) {
  const store = readOrderMetaStore();
  return normalizeOrderMeta(store[String(orderId || "")] || {});
}

function saveOrderMeta(orderId, patch = {}) {
  const id = String(orderId || "").trim();
  if (!id) return normalizeOrderMeta();
  const store = readOrderMetaStore();
  const next = normalizeOrderMeta({ ...getOrderMeta(id), ...patch, updatedAt: new Date().toISOString() });
  store[id] = next;
  writeOrderMetaStore(store);
  return next;
}

function removeOrderMeta(orderId) {
  const id = String(orderId || "").trim();
  if (!id) return;
  const store = readOrderMetaStore();
  if (!store[id]) return;
  delete store[id];
  writeOrderMetaStore(store);
}

function priorityTone(priority) {
  const value = String(priority || "").toLowerCase();
  if (value === "high") return "danger";
  if (value === "low") return "neutral";
  return "warn";
}

function canBulkDeleteOrder(order) {
  const status = String(order?.status || order?.orderStatus || "").toLowerCase();
  return status.includes("cancel") || status.includes("return") || status.includes("refund");
}

function getOrderStatusLabel(order) {
  return titleCaseLabel(order?.status || order?.orderStatus, "Pending");
}

function canCancelOrder(order) {
  const status = String(order?.status || order?.orderStatus || "").toLowerCase();
  if (!status) return false;
  if (status.includes("cancel") || status.includes("return") || status.includes("refund")) return false;
  if (status.includes("deliver") || status.includes("complete")) return false;
  return true;
}

function getValidStatusTransitions(order) {
  const current = String(order?.status || order?.orderStatus || "").trim().toLowerCase();
  const flow = ["Pending", "Confirmed", "Processing", "Packed", "Shipping", "Delivered"];
  if (current.includes("cancel")) return ["Pending"];
  if (current.includes("return") || current.includes("refund")) return [];
  if (current.includes("deliver") || current.includes("complete")) return [];

  let index = flow.findIndex((status) => current === status.toLowerCase());
  if (index < 0 && current.includes("ship")) index = flow.indexOf("Shipping");
  if (index < 0 && current.includes("process")) index = flow.indexOf("Processing");
  if (index < 0 && current.includes("confirm")) index = flow.indexOf("Confirmed");
  if (index < 0 && current.includes("pack")) index = flow.indexOf("Packed");
  if (index < 0 && (current.includes("pending") || !current)) index = 0;

  const options = index >= 0
    ? flow.slice(index + 1)
    : flow.filter((status) => status.toLowerCase() !== current);
  if (canCancelOrder(order)) options.push("Cancelled");
  return options;
}

function getFulfillmentTransitions(order) {
  return getValidStatusTransitions(order).filter((status) => status !== "Cancelled");
}

function getOrderActionContext(order) {
  const customer = resolveReviewCustomerRecord(order);
  const identifiers = resolveOrderIdentifiers(order);
  return {
    id: String(order?.orderId || order?.id || ""),
    orderNumber: identifiers.orderNumber || order?.orderId || order?.id || "",
    phone: customer.phone,
    email: customer.email,
    telHref: formatReviewPhoneHref(customer.phone, "tel"),
    mailHref: customer.email ? `mailto:${encodeURIComponent(customer.email)}` : "",
    statusOptions: getFulfillmentTransitions(order),
    canCancel: canCancelOrder(order)
  };
}

function renderPriorityBadge(priority) {
  const meta = PRIORITY_OPTIONS.find((item) => item.value === priority) || PRIORITY_OPTIONS[1];
  return badge(meta.label, priorityTone(meta.value));
}

function statusTone(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("unpaid") || value.includes("awaiting") || value.includes("pending")) return "warn";
  if (value.includes("fail") || value.includes("decline") || value.includes("error")) return "danger";
  if (value.includes("deliver") || value.includes("complete") || isSettledPaidStatus(value)) return "success";
  if (value.includes("cancel") || value.includes("return") || value.includes("refund")) return "danger";
  if (value.includes("ship") || value.includes("confirm") || value.includes("pack") || value.includes("process")) return "warn";
  return "neutral";
}

function paymentLabel(order) {
  const method = String(order?.paymentMethod || "").toLowerCase();
  if (method === "mtn") return "MTN MoMo";
  if (method === "card") return "Card";
  if (method === "cod" || String(order?.paymentMethodLabel || "").toLowerCase().includes("cash")) {
    return "Cash on Delivery";
  }
  return order?.paymentMethodLabel || order?.paymentMethod || "—";
}

function resolveAdminPaymentMode(order) {
  const method = String(order?.paymentMethod || order?.payment?.method || "").toLowerCase();
  if (method === "cod") return "—";
  const mode = String(order?.payment?.gateway?.mode || "").toLowerCase();
  if (mode === "test") return "TEST";
  if (mode === "live") return "LIVE";
  const serviceType = String(order?.payment?.gateway?.serviceType || "").trim();
  if (serviceType === "54841") return "TEST";
  if (serviceType === "112815") return "LIVE";
  return order?.payment?.gateway?.transToken ? "LIVE" : "—";
}

function canMarkPaymentPaid(order) {
  const payment = String(order?.paymentStatus || order?.paymentStatusLabel || "").toLowerCase();
  if (!payment) return true;
  if (payment.includes("paid") && !payment.includes("unpaid") && !payment.includes("awaiting")) return false;
  if (payment.includes("refund")) return false;
  return payment.includes("awaiting")
    || payment.includes("pending")
    || payment.includes("unpaid")
    || payment.includes("failed")
    || payment.includes("authorized");
}

function canMarkPaymentFailed(order) {
  const payment = String(order?.paymentStatus || order?.paymentStatusLabel || "").toLowerCase();
  if (payment.includes("failed")) return false;
  if (payment.includes("refund")) return false;
  if (payment.includes("paid") && !payment.includes("unpaid") && !payment.includes("awaiting")) return false;
  return true;
}

function renderPaymentStatusActions(order) {
  const id = escapeHtml(order.orderId || order.id || "");
  const actions = [];
  if (canMarkPaymentPaid(order)) {
    actions.push(`<button type="button" class="orders-secondary-link orders-action--primary" data-order-action="mark-paid" data-order-id="${id}">Mark Payment Received</button>`);
  }
  if (canMarkPaymentFailed(order)) {
    actions.push(`<button type="button" class="orders-danger-button" data-order-action="mark-failed" data-order-id="${id}">Mark Payment Failed</button>`);
  }
  if (!actions.length) return "";
  return `<div class="orders-actions-inline orders-payment-actions" data-order-actions="${id}">${actions.join("")}</div>`;
}

function readHashQuery() {
  const hash = String(window.location.hash || "");
  const queryIndex = hash.indexOf("?");
  if (queryIndex < 0) return new URLSearchParams();
  return new URLSearchParams(hash.slice(queryIndex + 1));
}

function resolveMapLink(order) {
  const gps = order?.gpsLocation || {};
  const ship = order?.shippingAddress || {};
  const lat = gps.latitude || ship.latitude;
  const lng = gps.longitude || ship.longitude;
  const explicit = gps.googleMapsLink || gps.mapLink || ship.mapLink || "";
  if (explicit) return explicit;
  if (lat != null && lat !== "" && lng != null && lng !== "") {
    return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;
  }
  return "";
}

function matchesNavStatus(order, filter) {
  const status = String(order?.status || "").toLowerCase();
  const payment = String(order?.paymentStatus || order?.paymentStatusLabel || "").toLowerCase();
  const raw = String(filter || "").trim().toLowerCase();
  if (!raw) return true;

  if (raw.startsWith("status:")) {
    return status === raw.slice("status:".length);
  }

  switch (raw) {
    case "pending": {
      // Pending = unaccepted/unfulfilled only. Never overlap completed/cancelled/returns.
      if (
        status.includes("cancel")
        || status.includes("return")
        || status.includes("refund")
        || status.includes("deliver")
        || status.includes("complete")
        || status.includes("ship")
        || status.includes("pack")
        || status.includes("process")
        || status.includes("confirm")
      ) {
        return false;
      }
      return status === "pending"
        || payment.includes("awaiting_payment")
        || payment.includes("awaiting payment")
        || payment.includes("awaiting_delivery_payment");
    }
    case "completed":
      // Completed = delivered / finished fulfillment only (exclude terminal return/cancel paths).
      if (status.includes("cancel") || status.includes("return") || status.includes("refund")) {
        return false;
      }
      return status === "delivered" || status === "completed" || status.includes("deliver") || status.includes("complete");
    case "cancelled":
      return status.includes("cancel");
    case "returns": {
      // Only real return/refund signals — never fall back to generic paymentStatus.
      const workflow = order?.returnWorkflow || {};
      const returnStatus = String(workflow.returnStatus || order?.returnStatus || "").toLowerCase();
      const refundStatus = String(workflow.refundStatus || order?.refundStatus || "").toLowerCase();
      const hasReturnWorkflow = Boolean(returnStatus || refundStatus);
      const needsRefund = Boolean(order?.refundRequired)
        || payment.includes("refund_required")
        || refundStatus === "required"
        || refundStatus === "pending";
      return status.includes("return")
        || status.includes("refund")
        || needsRefund
        || hasReturnWorkflow;
    }
    default:
      return status === raw || status.includes(raw);
  }
}

function resolveCompletionDate(order) {
  const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index] || {};
    if (/deliver|complete/i.test(`${entry.status || ""} ${entry.label || ""}`)) {
      return entry.timestamp || "";
    }
  }
  if (/deliver|complete/i.test(String(order?.status || ""))) {
    return order.updatedAt || order.date || order.createdAt || "";
  }
  return "";
}

function resolveCancellationDate(order) {
  if (order?.cancelledAt) return order.cancelledAt;
  const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index] || {};
    if (/cancel/i.test(`${entry.status || ""} ${entry.label || ""}`)) {
      return entry.timestamp || "";
    }
  }
  if (/cancel/i.test(String(order?.status || ""))) {
    return order.updatedAt || order.date || "";
  }
  return "";
}

function resolveCancelledBy(order) {
  const explicit = String(order?.cancelledBy || order?.paymentCancellation?.cancelledBy || "").trim();
  if (explicit) return explicit;
  const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index] || {};
    if (/cancel/i.test(`${entry.status || ""} ${entry.label || ""}`) && entry.actor) {
      return entry.actor;
    }
  }
  return "Unknown";
}

function resolveCancellationReason(order) {
  return String(
    order?.cancellationReason
    || order?.paymentCancellation?.reason
    || [...(order?.statusHistory || [])].reverse().find((entry) => /cancel/i.test(`${entry?.status || ""} ${entry?.label || ""}`))?.reason
    || [...(order?.statusHistory || [])].reverse().find((entry) => /cancel/i.test(`${entry?.status || ""} ${entry?.label || ""}`))?.note
    || ""
  ).trim();
}

function resolveReturnRequestDate(order) {
  const workflow = order?.returnWorkflow || {};
  if (workflow.returnRequestedAt) return workflow.returnRequestedAt;
  const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index] || {};
    if (/return/i.test(`${entry.status || ""} ${entry.label || ""}`)) {
      return entry.timestamp || "";
    }
  }
  return order?.cancelledAt || "";
}

function resolveRefundDate(order) {
  const workflow = order?.returnWorkflow || {};
  return workflow.refundDate || workflow.refundApprovedAt || "";
}

function formatReturnStatusLabel(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "Not started";
  if (raw === "requested") return "Requested";
  if (raw === "approved") return "Approved";
  if (raw === "rejected") return "Rejected";
  if (raw === "received") return "Received";
  return String(value);
}

function formatRefundStatusLabel(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "Not required";
  if (raw === "required" || raw === "pending") return "Required";
  if (raw === "completed" || raw === "refunded") return "Completed";
  if (raw === "rejected") return "Rejected";
  return String(value);
}

function getReturnWorkflow(order) {
  return order?.returnWorkflow && typeof order.returnWorkflow === "object" ? order.returnWorkflow : {};
}

function dedupeOrdersById(orders) {
  const seen = new Set();
  return (Array.isArray(orders) ? orders : []).filter((order) => {
    const id = String(order?.orderId || order?.id || "").trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function getOrdersViewMeta(statusFilter) {
  const filter = String(statusFilter || "").trim().toLowerCase();
  if (filter === "pending") {
    return {
      mode: "pending",
      title: "Pending Orders",
      eyebrow: "Fulfillment queue",
      description: "New checkout orders awaiting acceptance. Accept or start processing to move them through the workflow."
    };
  }
  if (filter === "completed") {
    return {
      mode: "completed",
      title: "Completed Orders",
      eyebrow: "Completed fulfillment",
      description: "Delivered and completed orders preserved permanently with full checkout, payment, delivery, and product records."
    };
  }
  if (filter === "cancelled") {
    return {
      mode: "cancelled",
      title: "Cancelled Orders",
      eyebrow: "Cancellation desk",
      description: "Orders cancelled by customers or administrators. Stock is restored automatically and paid cancellations are prepared for Returns & Refunds."
    };
  }
  if (filter === "returns") {
    return {
      mode: "returns",
      title: "Returns & Refunds",
      eyebrow: "Return & refund desk",
      description: "Manage product returns and customer refund requests. Only qualifying orders appear here, linked permanently to their original checkout records."
    };
  }
  return {
    mode: "all",
    title: "All Orders",
    eyebrow: "Orders",
    description: "Central order management synchronized with checkout, payment, GPS, and fulfillment."
  };
}

function filterAndSortOrders(orders, state) {
  const query = String(state.query || "").trim().toLowerCase().replace(/^#/, "");
  const paymentFilter = String(state.paymentFilter || "").trim().toLowerCase();
  const paymentStatusFilter = String(state.paymentStatusFilter || "").trim().toLowerCase();
  const deliveryStatusFilter = String(state.deliveryStatusFilter || "").trim().toLowerCase();
  const cancelledByFilter = String(state.cancelledByFilter || "").trim().toLowerCase();
  const returnStatusFilter = String(state.returnStatusFilter || "").trim().toLowerCase();
  const refundStatusFilter = String(state.refundStatusFilter || "").trim().toLowerCase();
  let list = dedupeOrdersById(orders).filter((order) => matchesNavStatus(order, state.statusFilter));

  if (state.statBucket) {
    list = list.filter((order) => classifyOrderStatBucket(order) === String(state.statBucket));
  }

  if (paymentFilter) {
    list = list.filter((order) => {
      const method = String(order.paymentMethod || order.paymentMethodLabel || "").toLowerCase();
      if (paymentFilter === "cod") {
        return method.includes("cod") || method.includes("cash");
      }
      return method.includes(paymentFilter);
    });
  }

  if (paymentStatusFilter) {
    list = list.filter((order) => matchesPaymentStatusFilter(order, paymentStatusFilter));
  }

  if (deliveryStatusFilter) {
    list = list.filter((order) => matchesDeliveryStatusFilter(order, deliveryStatusFilter));
  }

  if (normalizeDateTab(state.dateTab || state.dateRangeFilter || "all") !== "all") {
    list = list.filter((order) => matchesDateTab(order, state));
  }

  if (cancelledByFilter) {
    list = list.filter((order) => String(resolveCancelledBy(order) || "").toLowerCase().includes(cancelledByFilter));
  }

  if (returnStatusFilter) {
    list = list.filter((order) => {
      const value = String(getReturnWorkflow(order).returnStatus || order.returnStatus || "").toLowerCase();
      return value === returnStatusFilter || value.includes(returnStatusFilter);
    });
  }

  if (refundStatusFilter) {
    list = list.filter((order) => {
      const workflow = getReturnWorkflow(order);
      const value = String(workflow.refundStatus || order.refundStatus || order.paymentStatus || "").toLowerCase();
      if (refundStatusFilter === "required") {
        return value.includes("required") || value.includes("pending") || Boolean(order.refundRequired);
      }
      if (refundStatusFilter === "completed") {
        return value.includes("completed") || value.includes("refunded");
      }
      return value === refundStatusFilter || value.includes(refundStatusFilter);
    });
  }

  if (query) {
    list = list.filter((order) => {
      const ship = order.shippingAddress || {};
      const customer = resolveOrderCustomer(order);
      const workflow = getReturnWorkflow(order);
      const haystack = [
        order.orderId,
        order.id,
        order.recordId,
        customer.name,
        customer.phone,
        order.customerName,
        order.customerPhone,
        order.phoneNumber,
        ship.phone,
        ship.fullName,
        order.customerEmail,
        order.paymentMethod,
        order.paymentMethodLabel,
        order.status,
        workflow.returnReason,
        workflow.returnStatus,
        workflow.refundStatus,
        ...(order.items || []).map((item) => item.productName),
        ...(order.items || []).map((item) => item.sku),
        ...(order.items || []).map((item) => item.productId)
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }

  const sort = state.sort || "date-desc";
  list = [...list].sort((a, b) => {
    if (sort === "return-desc") {
      return new Date(resolveReturnRequestDate(b) || b.date || 0) - new Date(resolveReturnRequestDate(a) || a.date || 0);
    }
    if (sort === "return-asc") {
      return new Date(resolveReturnRequestDate(a) || a.date || 0) - new Date(resolveReturnRequestDate(b) || b.date || 0);
    }
    if (sort === "cancelled-desc") {
      return new Date(resolveCancellationDate(b) || b.date || 0) - new Date(resolveCancellationDate(a) || a.date || 0);
    }
    if (sort === "cancelled-asc") {
      return new Date(resolveCancellationDate(a) || a.date || 0) - new Date(resolveCancellationDate(b) || b.date || 0);
    }
    if (sort === "completed-desc") {
      return new Date(resolveCompletionDate(b) || b.date || 0) - new Date(resolveCompletionDate(a) || a.date || 0);
    }
    if (sort === "completed-asc") {
      return new Date(resolveCompletionDate(a) || a.date || 0) - new Date(resolveCompletionDate(b) || b.date || 0);
    }
    if (sort === "date-asc") {
      return new Date(a.date || a.createdAt || 0) - new Date(b.date || b.createdAt || 0);
    }
    if (sort === "total-desc") {
      return (Number(b.grandTotal || b.total) || 0) - (Number(a.grandTotal || a.total) || 0);
    }
    if (sort === "total-asc") {
      return (Number(a.grandTotal || a.total) || 0) - (Number(b.grandTotal || b.total) || 0);
    }
    if (sort === "customer-asc") {
      return String(resolveOrderCustomer(a).name || "").localeCompare(String(resolveOrderCustomer(b).name || ""), undefined, { sensitivity: "base" });
    }
    if (sort === "customer-desc") {
      return String(resolveOrderCustomer(b).name || "").localeCompare(String(resolveOrderCustomer(a).name || ""), undefined, { sensitivity: "base" });
    }
    if (sort === "status") {
      return String(a.status || "").localeCompare(String(b.status || ""));
    }
    return new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0);
  });

  return list;
}

function renderInfoGrid(rows) {
  return `
    <div class="orders-info-grid">
      ${rows.filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
        .map(([label, value]) => `
          <div>
            <span>${escapeHtml(label)}</span>
            <strong>${typeof value === "object" && value?.html ? value.html : escapeHtml(value)}</strong>
          </div>
        `).join("")}
    </div>
  `;
}

function renderCustomerBlock(order) {
  const ship = order.shippingAddress || {};
  const full = order.fullAddress || {};
  const phone = ship.phone || order.customerPhone || "";
  const email = order.customerEmail || "";
  const mapLink = resolveMapLink(order);
  const gps = order.gpsLocation || {};

  return `
    <div class="orders-detail-card">
      <h4>Customer Information</h4>
      ${renderInfoGrid([
        ["Full Name", ship.fullName || order.customerName],
        ["Phone Number", phone
          ? { html: `<a class="orders-inline-link" href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a>` }
          : "—"],
        ["Email", email
          ? { html: `<a class="orders-inline-link" href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` }
          : ""],
        ["Province / City", ship.provinceCity || full.province],
        ["District", ship.district || full.district],
        ["Sector", ship.sector || full.sector],
        ["Cell", ship.cell || full.cell],
        ["Village", ship.village || full.village],
        ["Landmark / Note", ship.note || full.note || full.street],
        ["Latitude", gps.latitude || ship.latitude],
        ["Longitude", gps.longitude || ship.longitude]
      ])}
      ${mapLink ? `<p class="orders-inline-link-wrap"><a class="orders-inline-link" href="${escapeHtml(mapLink)}" target="_blank" rel="noopener">Open Customer Location in Google Maps</a></p>` : ""}
    </div>
  `;
}

function renderOrderInfoBlock(order, viewMode = "all") {
  const paymentStatus = order.paymentStatusLabel || order.paymentStatus || "Pending";
  const completionDate = resolveCompletionDate(order);
  const cancellationDate = resolveCancellationDate(order);
  const workflow = getReturnWorkflow(order);
  const returnRequestDate = resolveReturnRequestDate(order);
  const refundDate = resolveRefundDate(order);
  return `
    <div class="orders-detail-card">
      <h4>Order Information</h4>
      ${renderInfoGrid([
        ["Order Number", order.orderId || order.id],
        ["Order Date", formatDate(order.date || order.createdAt)],
        viewMode === "completed" || viewMode === "returns" || completionDate ? ["Delivery Date", completionDate ? formatDate(completionDate) : "—"] : null,
        viewMode === "completed" || completionDate ? ["Completion Date", completionDate ? formatDate(completionDate) : "—"] : null,
        viewMode === "cancelled" || cancellationDate ? ["Cancellation Date", cancellationDate ? formatDate(cancellationDate) : "—"] : null,
        viewMode === "cancelled" ? ["Cancelled By", resolveCancelledBy(order)] : null,
        viewMode === "cancelled" ? ["Cancellation Reason", resolveCancellationReason(order) || "—"] : null,
        viewMode === "cancelled" && order.refundRequired ? ["Refund Workflow", "Prepared for Returns & Refunds"] : null,
        viewMode === "returns" ? ["Return Request Date", returnRequestDate ? formatDate(returnRequestDate) : "—"] : null,
        viewMode === "returns" ? ["Return Status", formatReturnStatusLabel(workflow.returnStatus || order.returnStatus)] : null,
        viewMode === "returns" ? ["Refund Status", formatRefundStatusLabel(workflow.refundStatus || order.refundStatus || (order.refundRequired ? "required" : ""))] : null,
        ["Order Status", order.status || order.orderStatus || "Pending"],
        ["Payment Status", paymentStatus],
        ["Payment Method", paymentLabel(order)],
        ["Payer Phone", order.payerPhone],
        ["Payment Note", order.paymentNote],
        ["Shipping Method", order.deliveryLabel || order.deliveryMethod || "Home delivery"],
        ["Shipping Status", order.shippingStatus || order.status],
        ["Delivery Status", order.deliveryStatus || order.status],
        ["Subtotal", formatCurrency(order.subtotal || 0)],
        ["Shipping Cost", formatCurrency(order.shippingCost || order.deliveryFee || 0)],
        ["Discount", Number(order.discount) > 0 ? formatCurrency(order.discount) : ""],
        ["Tax", Number(order.tax) > 0 ? formatCurrency(order.tax) : ""],
        Number(order.codFee) > 0 ? ["COD Fee", formatCurrency(order.codFee)] : null,
        ["Grand Total", formatCurrency(order.grandTotal || order.total || 0)],
        viewMode === "returns" && refundDate ? ["Refund Date", formatDate(refundDate)] : null
      ].filter(Boolean))}
    </div>
  `;
}

function renderReturnInfoBlock(order) {
  const workflow = getReturnWorkflow(order);
  const images = Array.isArray(workflow.returnImages) ? workflow.returnImages : [];
  const refundAmount = Number(workflow.refundAmount || order.refundAmount || 0);
  const showAmount = refundAmount > 0 || String(workflow.refundStatus || "").toLowerCase() === "completed";
  return `
    <div class="orders-detail-card">
      <h4>Return Information</h4>
      ${renderInfoGrid([
        ["Return Reason", workflow.returnReason || order.returnReason || resolveCancellationReason(order) || "—"],
        ["Customer Notes", workflow.customerNotes || "—"],
        ["Admin Notes", workflow.adminNotes || "—"],
        ["Product Condition", workflow.productCondition || "—"],
        ["Return Approval Status", formatReturnStatusLabel(workflow.returnStatus || order.returnStatus)],
        ["Refund Status", formatRefundStatusLabel(workflow.refundStatus || order.refundStatus || (order.refundRequired ? "required" : ""))],
        ["Refund Amount", showAmount ? formatCurrency(refundAmount || order.total || 0) : "Pending approval"],
        ["Refund Method", workflow.refundMethod || order.refundMethod || paymentLabel(order)],
        ["Refund Date", resolveRefundDate(order) ? formatDate(resolveRefundDate(order)) : "—"],
        ["Return Request Date", resolveReturnRequestDate(order) ? formatDate(resolveReturnRequestDate(order)) : "—"]
      ])}
      ${images.length ? `
        <div class="orders-return-images">
          <span>Uploaded Return Images</span>
          <div class="orders-return-images__grid">
            ${images.map((src) => {
              const resolved = resolveProductImage({ image: src });
              return resolved
                ? `<a href="${escapeHtml(resolved)}" target="_blank" rel="noopener"><img src="${escapeHtml(resolved)}" alt="Return evidence" loading="lazy"></a>`
                : "";
            }).join("")}
          </div>
        </div>
      ` : `<p class="orders-empty-state">No return images uploaded.</p>`}
    </div>
  `;
}

function renderDeliveryBlock(order) {
  const ship = order.shippingAddress || {};
  const full = order.fullAddress || {};
  const mapLink = resolveMapLink(order);
  return `
    <div class="orders-detail-card">
      <h4>Delivery Information</h4>
      ${renderInfoGrid([
        ["Delivery Status", order.deliveryStatus || order.status],
        ["Shipping Method", order.deliveryLabel || order.deliveryMethod || "Home delivery"],
        ["Recipient", ship.fullName || order.customerName],
        ["Phone", ship.phone || order.customerPhone],
        ["Province / City", ship.provinceCity || full.province],
        ["District", ship.district || full.district],
        ["Sector", ship.sector || full.sector],
        ["Cell", ship.cell || full.cell],
        ["Village", ship.village || full.village],
        ["Landmark / Note", ship.note || full.note],
        ["Completion Date", resolveCompletionDate(order) ? formatDate(resolveCompletionDate(order)) : ""]
      ])}
      ${mapLink ? `<p class="orders-inline-link-wrap"><a class="orders-inline-link" href="${escapeHtml(mapLink)}" target="_blank" rel="noopener">Open Customer Location in Google Maps</a></p>` : ""}
    </div>
  `;
}

function renderGps(order) {
  const mapLink = resolveMapLink(order);
  const gps = order?.gpsLocation || {};
  const lat = gps.latitude || order?.shippingAddress?.latitude;
  const lng = gps.longitude || order?.shippingAddress?.longitude;
  if (!mapLink && (lat == null || lat === "" || lng == null || lng === "")) return "";
  return `
    <p class="orders-inline-link-wrap">
      ${mapLink ? `<a class="orders-inline-link" href="${escapeHtml(mapLink)}" target="_blank" rel="noopener noreferrer">Open GPS on Maps</a>` : ""}
      ${lat != null && lat !== "" && lng != null && lng !== "" ? `<small>(${escapeHtml(lat)}, ${escapeHtml(lng)})</small>` : ""}
    </p>
  `;
}

function resolveProductImage(item) {
  const value = String(item?.image || item?.colorImage || "").trim();
  if (!value) return "";
  if (/^(?:https?:|data:|blob:)/i.test(value)) return value;
  if (value.startsWith("/uploads/") || value.startsWith("/img/")) return value;
  if (value.startsWith("uploads/") || value.startsWith("img/")) return `/${value}`;
  if (/^(?:products|categories|users|reviews|hero|temp)\//i.test(value)) return `/uploads/${value}`;
  if (value.startsWith("/")) return value;
  return value;
}

function resolveCustomerLocation(order) {
  const ship = order?.shippingAddress || {};
  const full = order?.fullAddress || {};
  const parts = [
    ship.province || ship.provinceCity || full.province || full.provinceCity || order.provinceCity,
    ship.district || full.district,
    ship.sector || full.sector
  ].map((part) => String(part || "").trim()).filter(Boolean);
  if (parts.length) return parts.join(", ");
  return String(ship.city || full.city || ship.addressLine || full.addressLine || "").trim() || "—";
}

function resolveProductVariant(item) {
  return String(item?.attributeSummary || [item?.color, item?.size].filter(Boolean).join(" · ") || "").trim();
}

function titleCaseLabel(value, fallback = "Pending") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function resolveOrderIdentifiers(order) {
  const orderNumber = String(order?.orderId || order?.id || "").trim();
  const recordId = Number(order?.recordId);
  const legacyId = String(order?.id || "").trim();
  let internalId = "";
  if (Number.isFinite(recordId) && recordId > 0 && String(recordId) !== orderNumber) {
    internalId = String(recordId);
  } else if (legacyId && legacyId !== orderNumber) {
    internalId = legacyId;
  }
  return { orderNumber, internalId };
}

function resolveOrderCustomer(order) {
  const ship = order?.shippingAddress || {};
  const name = String(ship.fullName || order?.customerName || "").trim() || "—";
  const phone = String(ship.phone || order?.customerPhone || order?.phoneNumber || "").trim();
  return { name, phone };
}

function formatOrderRowDateTime(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) {
    return { date: "—", time: "" };
  }
  return {
    date: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(date),
    time: new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit"
    }).format(date)
  };
}

function renderOrderRowStatusBadge(status) {
  const label = titleCaseLabel(status, "Pending");
  const category = classifyOrderStatBucket({ status: label });
  return `<span class="order-row-status order-row-status--${escapeHtml(category)}" title="${escapeHtml(label)}" aria-label="Order status: ${escapeHtml(label)}">${escapeHtml(label)}</span>`;
}

function renderOrderRowPayment(order) {
  const status = titleCaseLabel(order?.paymentStatusLabel || order?.paymentStatus, "Pending");
  const method = paymentLabel(order);
  const tone = statusTone(status);
  const showMethod = method && method !== "—";
  return `
    <div class="order-row-payment" aria-label="Payment status: ${escapeHtml(status)}${showMethod ? `, ${escapeHtml(method)}` : ""}">
      <span class="order-row-pay-status order-row-pay-status--${escapeHtml(tone)}">${escapeHtml(status)}</span>
      ${showMethod ? `<span class="order-row-pay-method">${escapeHtml(method)}</span>` : ""}
    </div>
  `;
}

const reviewDrawer = {
  orderId: "",
  previousFocus: null,
  resolveOrder: null,
  reloadAndResolve: null,
  handleAction: null,
  busy: false
};

function isReviewDrawerOpen() {
  const host = document.getElementById("ordersReviewDrawerHost");
  return Boolean(host && !host.hidden);
}

function setReviewDrawerScrollLock(locked) {
  document.documentElement.classList.toggle("orders-review-locked", Boolean(locked));
  document.body.classList.toggle("orders-review-locked", Boolean(locked));
}

function getReviewDrawerFocusables(host) {
  return Array.from(host.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])"))
    .filter((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true");
}

function renderReviewMetaRows(rows = []) {
  return rows
    .filter((row) => row && String(row.value ?? "").trim() !== "")
    .map((row) => `
      <div class="orders-review-row">
        <span>${escapeHtml(row.label)}</span>
        <strong>${row.html ? row.value : escapeHtml(row.value)}</strong>
      </div>
    `).join("");
}

function resolveReviewItemVariants(item) {
  const size = String(item?.size || item?.sizeLabel || "").trim();
  const color = String(item?.color || item?.colorName || "").trim();
  const attrs = item?.attributes && typeof item.attributes === "object" ? item.attributes : {};
  const model = String(item?.model || attrs.Model || attrs.model || "").trim();
  const storage = String(item?.storage || attrs.Storage || attrs.storage || "").trim();
  const rows = [];
  if (size) rows.push(`Size: ${size}`);
  if (color) rows.push(`Color: ${color}`);
  if (model) rows.push(`Model: ${model}`);
  if (storage) rows.push(`Storage: ${storage}`);
  if (!rows.length) {
    const summary = resolveProductVariant(item);
    if (summary) rows.push(summary);
  }
  return rows;
}

function renderReviewOrderInformation(order) {
  const { orderNumber, internalId } = resolveOrderIdentifiers(order);
  const when = formatOrderRowDateTime(order.date || order.createdAt);
  const status = titleCaseLabel(order.status || order.orderStatus, "Pending");
  const total = Number(order?.grandTotal || order?.total);
  return `
    <section class="orders-review-section" data-review-section="information">
      <h3>Order Information</h3>
      <div class="orders-review-card">
        ${renderReviewMetaRows([
          { label: "Order Number", value: orderNumber ? `#${orderNumber}` : "" },
          { label: "Order ID", value: internalId },
          { label: "Order Date", value: when.date !== "—" ? when.date : "" },
          { label: "Order Time", value: when.time },
          { label: "Order Status", value: status },
          { label: "Total Amount", value: Number.isFinite(total) ? formatCurrency(total) : "" }
        ])}
      </div>
    </section>
  `;
}

function sanitizeReviewText(value) {
  if (value == null) return "";
  if (typeof value === "object") return "";
  const text = String(value).trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  if (lower === "undefined" || lower === "null" || lower === "[object object]") return "";
  return text;
}

function pickReviewText(...values) {
  for (const value of values) {
    const text = sanitizeReviewText(value);
    if (text) return text;
  }
  return "";
}

function coerceReviewObject(value) {
  if (!value) return {};
  if (typeof value === "string") {
    const text = sanitizeReviewText(value);
    if (!text) return {};
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      } catch (_error) {
        return { addressLine: text };
      }
    }
    return { addressLine: text };
  }
  if (typeof value === "object" && !Array.isArray(value)) return value;
  return {};
}

function uniqueReviewText(value, used) {
  const text = sanitizeReviewText(value);
  if (!text) return "";
  const key = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (used.has(key)) return "";
  used.add(key);
  return text;
}

function formatReviewPhoneHref(phone, protocol) {
  const compact = String(phone || "").replace(/[^\d+]/g, "");
  return compact ? `${protocol}:${compact}` : "";
}

function renderReviewField(label, value, extraHtml = "", options = {}) {
  const text = sanitizeReviewText(value);
  if (!text && !extraHtml) return "";
  const copyable = Boolean(options.copyable);
  return `
    <div class="orders-review-field">
      <span>${escapeHtml(label)}</span>
      <div class="orders-review-field__value">
        ${text ? `<strong class="${copyable ? "orders-review-copyable" : ""}">${escapeHtml(text)}</strong>` : ""}
        ${extraHtml}
      </div>
    </div>
  `;
}

function renderReviewNoteBlock(text) {
  const value = sanitizeReviewText(text);
  if (!value) return "";
  return `<p class="orders-review-note">${escapeHtml(value)}</p>`;
}

function renderReviewContactActions(phone, email) {
  const telHref = formatReviewPhoneHref(phone, "tel");
  const smsHref = formatReviewPhoneHref(phone, "sms");
  const mailHref = email ? `mailto:${encodeURIComponent(email)}` : "";
  const actions = [
    telHref ? `<a class="orders-review-contact" href="${escapeHtml(telHref)}" aria-label="Call ${escapeHtml(phone)}">Call</a>` : "",
    smsHref ? `<a class="orders-review-contact" href="${escapeHtml(smsHref)}" aria-label="Message ${escapeHtml(phone)}">Message</a>` : "",
    mailHref ? `<a class="orders-review-contact" href="${escapeHtml(mailHref)}" aria-label="Email ${escapeHtml(email)}">Email</a>` : ""
  ].filter(Boolean);
  if (!actions.length) return "";
  return `<span class="orders-review-contacts">${actions.join("")}</span>`;
}

function resolveReviewCustomerRecord(order) {
  const ship = coerceReviewObject(order?.shippingAddress || order?.deliveryAddress);
  const customer = coerceReviewObject(order?.customer);
  const name = pickReviewText(ship.fullName, order?.customerName, customer.name, customer.fullName);
  const phone = pickReviewText(ship.phone, order?.customerPhone, order?.phoneNumber, customer.phone);
  const email = pickReviewText(order?.customerEmail, order?.userEmail, customer.email, ship.email);
  const customerId = pickReviewText(order?.customerId, customer.id, customer.customerId);
  const isGuest = !customerId;
  return {
    name: name || (isGuest ? "Guest Customer" : "Not provided"),
    phone,
    email,
    customerId,
    isGuest,
    initial: (name || "G").slice(0, 1).toUpperCase()
  };
}

function resolveReviewAddressRecord(order) {
  const ship = coerceReviewObject(order?.shippingAddress || order?.deliveryAddress);
  const full = coerceReviewObject(order?.fullAddress);
  const used = new Set();
  const province = uniqueReviewText(pickReviewText(
    ship.provinceCity, ship.province, ship.city, full.provinceCity, full.province, full.city, order?.provinceCity
  ), used);
  const district = uniqueReviewText(pickReviewText(ship.district, full.district), used);
  const sector = uniqueReviewText(pickReviewText(ship.sector, full.sector), used);
  const cell = uniqueReviewText(pickReviewText(ship.cell, full.cell), used);
  const village = uniqueReviewText(pickReviewText(ship.village, full.village), used);
  const street = uniqueReviewText(pickReviewText(ship.street, ship.line1, full.street, full.line1), used);
  const house = uniqueReviewText(pickReviewText(ship.houseNumber, ship.houseNo, ship.house, full.houseNumber, full.house), used);
  const building = uniqueReviewText(pickReviewText(ship.building, full.building), used);
  const apartment = uniqueReviewText(pickReviewText(ship.apartment, ship.apt, full.apartment), used);
  const postal = uniqueReviewText(pickReviewText(ship.postalCode, ship.postal, ship.zip, full.postalCode, full.postal), used);
  const additional = uniqueReviewText(pickReviewText(
    ship.additionalAddress, ship.additional, full.additionalAddress, ship.addressLine, full.addressLine, full.street
  ), used);
  const landmark = uniqueReviewText(pickReviewText(ship.note, full.note, ship.landmark, full.landmark), used);
  return {
    province,
    district,
    sector,
    cell,
    village,
    street,
    house,
    building,
    apartment,
    postal,
    additional,
    landmark,
    hasHierarchy: Boolean(province || district || sector || cell || village),
    hasAny: Boolean(province || district || sector || cell || village || street || house || building || apartment || postal || additional || landmark)
  };
}

function resolveReviewLocationRecord(order) {
  const gps = coerceReviewObject(order?.gpsLocation);
  const ship = coerceReviewObject(order?.shippingAddress || order?.deliveryAddress);
  const latitude = pickReviewText(gps.latitude, ship.latitude, order?.latitude);
  const longitude = pickReviewText(gps.longitude, ship.longitude, order?.longitude);
  const explicitLink = pickReviewText(gps.googleMapsLink, gps.mapLink, ship.mapLink);
  const locationName = pickReviewText(gps.name, gps.locationName, gps.displayName, ship.locationName);
  const accuracy = pickReviewText(gps.accuracy, ship.locationAccuracy);
  const capturedAt = pickReviewText(gps.capturedAt, ship.locationCapturedAt);
  const latNum = Number(latitude);
  const lngNum = Number(longitude);
  const hasCoords = latitude !== "" && longitude !== ""
    && Number.isFinite(latNum)
    && Number.isFinite(lngNum)
    && !(latNum === 0 && lngNum === 0);
  const mapLink = explicitLink || (hasCoords ? resolveMapLink(order) : "");
  return {
    latitude: hasCoords ? latitude : "",
    longitude: hasCoords ? longitude : "",
    mapLink,
    locationName,
    accuracy,
    capturedAt,
    hasAny: Boolean((hasCoords && latitude) || mapLink || locationName)
  };
}

function resolveReviewCustomerNotes(order, address) {
  const ship = coerceReviewObject(order?.shippingAddress || order?.deliveryAddress);
  const used = new Set();
  [address?.landmark, address?.additional].forEach((value) => {
    const key = sanitizeReviewText(value).replace(/\s+/g, " ").trim().toLowerCase();
    if (key) used.add(key);
  });
  const instructions = uniqueReviewText(pickReviewText(
    ship.deliveryInstructions, order?.deliveryInstructions, ship.instructions
  ), used);
  const notes = uniqueReviewText(pickReviewText(
    order?.customerMessage, order?.orderNotes, order?.checkoutNotes, ship.customerNotes, order?.buyerNotes
  ), used);
  return { instructions, notes };
}

function renderReviewCustomerIdentity(order) {
  const customer = resolveReviewCustomerRecord(order);
  const phoneActions = customer.phone ? renderReviewContactActions(customer.phone, "") : "";
  const emailActions = customer.email ? renderReviewContactActions("", customer.email) : "";
  return `
    <section class="orders-review-section" data-review-section="customer">
      <h3>Customer Information</h3>
      <div class="orders-review-card">
        <div class="orders-review-customer-head">
          <div class="orders-review-avatar" aria-hidden="true">${escapeHtml(customer.initial)}</div>
          <div class="orders-review-customer-copy">
            <strong class="orders-review-customer-name">${escapeHtml(customer.name)}</strong>
            ${customer.isGuest ? `<span class="orders-review-customer-type">Guest checkout</span>` : `<span class="orders-review-customer-type">Registered customer</span>`}
          </div>
        </div>
        <div class="orders-review-fields">
          ${customer.customerId ? renderReviewField("Customer ID", customer.customerId) : ""}
          ${renderReviewField("Phone", customer.phone || "Not provided", phoneActions)}
          ${customer.email ? renderReviewField("Email", customer.email, emailActions) : ""}
        </div>
      </div>
    </section>
  `;
}

function renderReviewDeliveryAddress(order) {
  const address = resolveReviewAddressRecord(order);
  if (!address.hasAny) return "";
  const streetHouse = [address.street, address.house].filter(Boolean).join(", ");
  const aptBuilding = [address.apartment, address.building].filter(Boolean).join(", ");
  return `
    <section class="orders-review-section" data-review-section="address">
      <h3>Delivery Address</h3>
      <div class="orders-review-card">
        <div class="orders-review-fields">
          ${address.hasHierarchy ? renderReviewField("Province / City", address.province || "Not provided") : ""}
          ${address.hasHierarchy ? renderReviewField("District", address.district || "Not provided") : ""}
          ${address.hasHierarchy ? renderReviewField("Sector", address.sector || "Not provided") : ""}
          ${address.hasHierarchy ? renderReviewField("Cell", address.cell || "Not provided") : ""}
          ${address.hasHierarchy ? renderReviewField("Village", address.village || "Not provided") : ""}
          ${streetHouse ? renderReviewField("Street / House", streetHouse) : ""}
          ${aptBuilding ? renderReviewField("Apartment / Building", aptBuilding) : ""}
          ${address.postal ? renderReviewField("Postal Code", address.postal) : ""}
          ${address.additional ? renderReviewField("Additional Address", address.additional) : ""}
          ${address.landmark ? renderReviewField("Landmark / Note", address.landmark) : ""}
        </div>
      </div>
    </section>
  `;
}

function renderReviewCustomerLocation(order) {
  const location = resolveReviewLocationRecord(order);
  if (!location.hasAny) return "";
  const captured = location.capturedAt ? formatOrderRowDateTime(location.capturedAt) : null;
  const capturedLabel = captured && captured.date !== "—"
    ? [captured.date, captured.time].filter(Boolean).join(" • ")
    : "";
  const mapAction = location.mapLink
    ? `<a class="orders-review-map-link" href="${escapeHtml(location.mapLink)}" target="_blank" rel="noopener noreferrer">View on Map</a>`
    : "";
  return `
    <section class="orders-review-section" data-review-section="location">
      <h3>Customer Location</h3>
      <div class="orders-review-card">
        <div class="orders-review-fields">
          ${location.locationName ? renderReviewField("Location", location.locationName) : ""}
          ${location.latitude ? renderReviewField("Latitude", location.latitude) : ""}
          ${location.longitude ? renderReviewField("Longitude", location.longitude) : ""}
          ${location.accuracy ? renderReviewField("Accuracy", location.accuracy) : ""}
          ${capturedLabel ? renderReviewField("Captured", capturedLabel) : ""}
        </div>
        ${mapAction}
      </div>
    </section>
  `;
}

function renderReviewCustomerNotesSections(order) {
  const address = resolveReviewAddressRecord(order);
  const { instructions, notes } = resolveReviewCustomerNotes(order, address);
  const parts = [];
  if (notes) {
    parts.push(`
      <section class="orders-review-section" data-review-section="notes">
        <h3>Customer Notes</h3>
        <div class="orders-review-card">${renderReviewNoteBlock(notes)}</div>
      </section>
    `);
  }
  if (instructions) {
    parts.push(`
      <section class="orders-review-section" data-review-section="instructions">
        <h3>Delivery Instructions</h3>
        <div class="orders-review-card">${renderReviewNoteBlock(instructions)}</div>
      </section>
    `);
  }
  return parts.join("");
}

function renderReviewCustomerPreview(order) {
  return [
    renderReviewCustomerIdentity(order),
    renderReviewDeliveryAddress(order),
    renderReviewCustomerLocation(order),
    renderReviewCustomerNotesSections(order)
  ].join("");
}

function renderReviewOrderItem(item) {
  const productName = String(item?.productName || "Product").trim();
  const imageSrc = resolveProductImage(item);
  const sku = sanitizeReviewText(item?.sku);
  const productId = sanitizeReviewText(item?.productId);
  const variants = resolveReviewItemVariants(item);
  const qty = Number(item?.quantity) || 1;
  const unit = Number(item?.price) || 0;
  const lineTotal = Number(item?.lineTotal != null ? item.lineTotal : unit * qty) || 0;
  const placeholderLetter = escapeHtml(productName.slice(0, 1).toUpperCase() || "P");
  return `
    <article class="orders-review-item">
      <div class="orders-review-item-media">
        ${imageSrc
          ? `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(productName)}" loading="lazy" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false;">`
          : ""}
        <div class="orders-review-item-ph" ${imageSrc ? "hidden" : ""} aria-hidden="true">${placeholderLetter}</div>
      </div>
      <div class="orders-review-item-body">
        <h4 class="orders-review-item-name" title="${escapeHtml(productName)}">${escapeHtml(productName)}</h4>
        ${productId ? `<p class="orders-review-item-id">Product ID: ${escapeHtml(productId)}</p>` : ""}
        ${sku ? `<p class="orders-review-item-id">SKU: ${escapeHtml(sku)}</p>` : ""}
        ${variants.map((line) => `<p class="orders-review-item-variant">${escapeHtml(line)}</p>`).join("")}
        <p class="orders-review-item-qty">Qty: ${escapeHtml(qty)}</p>
      </div>
      <div class="orders-review-item-price">
        ${qty > 1 ? `<span>${formatCurrency(unit)} × ${escapeHtml(qty)}</span>` : ""}
        <strong>${formatCurrency(lineTotal)}</strong>
      </div>
    </article>
  `;
}

function renderReviewOrderItems(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const countLabel = items.length ? ` — ${items.length} item${items.length === 1 ? "" : "s"}` : "";
  return `
    <section class="orders-review-section" data-review-section="items">
      <h3>Order Items${countLabel}</h3>
      ${items.length
        ? `<div class="orders-review-items">${items.map(renderReviewOrderItem).join("")}</div>`
        : `<div class="orders-review-card"><p class="orders-review-empty">This order has no line items.</p></div>`}
    </section>
  `;
}

function renderReviewOrderSummary(order) {
  const shipping = Number(order?.shippingCost || order?.deliveryFee || order?.shippingFee || 0);
  const couponDiscount = Number(order?.couponDiscount || 0);
  const discount = Number(order?.discount || order?.discountAmount || 0);
  const tax = Number(order?.tax || 0);
  const codFee = Number(order?.codFee || 0);
  const subtotal = Number(order?.subtotal || 0);
  const total = Number(order?.grandTotal || order?.total || 0);
  const rows = [];
  if (subtotal > 0) rows.push({ label: "Subtotal", value: formatCurrency(subtotal) });
  if (shipping > 0) rows.push({ label: "Shipping", value: formatCurrency(shipping) });
  if (couponDiscount > 0) {
    const coupon = sanitizeReviewText(order?.couponCode);
    rows.push({
      label: coupon ? `Discount (${coupon})` : "Discount",
      value: `− ${formatCurrency(couponDiscount)}`
    });
  } else if (discount > 0) {
    rows.push({ label: "Discount", value: `− ${formatCurrency(discount)}` });
  }
  if (tax > 0) rows.push({ label: "Tax", value: formatCurrency(tax) });
  if (codFee > 0) rows.push({ label: "COD Fee", value: formatCurrency(codFee) });
  rows.push({ label: "Total", value: formatCurrency(total), total: true });
  return `
    <section class="orders-review-section" data-review-section="summary">
      <h3>Order Summary</h3>
      <div class="orders-review-card orders-review-summary">
        ${rows.map((row) => `
          <div class="orders-review-summary-row${row.total ? " is-total" : ""}">
            <span>${escapeHtml(row.label)}</span>
            <strong>${escapeHtml(row.value)}</strong>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function resolveReviewPaymentTimestamp(order) {
  const payment = coerceReviewObject(order?.payment);
  const gateway = coerceReviewObject(payment.gateway);
  return pickReviewText(gateway.verifiedAt, gateway.updatedAt, gateway.initiatedAt, payment.paidAt, payment.confirmedAt);
}

function formatReviewDateTime(value) {
  const text = sanitizeReviewText(value);
  if (!text) return "";
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T12:00:00` : text;
  const when = formatOrderRowDateTime(normalized);
  if (when.date === "—") return text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return when.date;
  return [when.date, when.time].filter(Boolean).join(" • ");
}

function renderReviewPaymentPreview(order) {
  const method = paymentLabel(order);
  const status = titleCaseLabel(order?.paymentStatusLabel || order?.paymentStatus, "");
  const paid = isSettledPaidStatus(order?.paymentStatusLabel || order?.paymentStatus);
  const amount = Number(order?.grandTotal || order?.total || 0);
  const currency = pickReviewText(order?.currency) || "RWF";
  const payment = coerceReviewObject(order?.payment);
  const gateway = coerceReviewObject(payment.gateway);
  const transaction = coerceReviewObject(payment.transaction);
  const transactionId = pickReviewText(
    order?.transactionId,
    gateway.transRef,
    payment.transactionId,
    transaction.reference
  );
  const paymentRef = pickReviewText(
    order?.paymentReference,
    order?.transactionReference,
    payment.reference,
    gateway.companyRef
  );
  const refs = [];
  if (transactionId) refs.push({ label: "Transaction ID", value: transactionId });
  if (paymentRef && paymentRef !== transactionId) refs.push({ label: "Payment Reference", value: paymentRef });
  const payerPhone = pickReviewText(order?.payerPhone, payment.payerPhone);
  const note = pickReviewText(order?.paymentNote, payment.note);
  const paidAt = formatReviewDateTime(resolveReviewPaymentTimestamp(order));
  const mode = resolveAdminPaymentMode(order);
  const fields = [
    method && method !== "—" ? renderReviewField("Payment Method", method) : "",
    status ? renderReviewField("Payment Status", status) : "",
    Number.isFinite(amount) ? renderReviewField(paid ? "Amount Paid" : "Amount", formatCurrency(amount)) : "",
    currency ? renderReviewField("Currency", currency) : "",
    ...refs.map((row) => renderReviewField(row.label, row.value, "", { copyable: true })),
    paidAt ? renderReviewField("Payment Date", paidAt) : "",
    payerPhone ? renderReviewField("Payer Phone", payerPhone) : "",
    mode && mode !== "—" ? renderReviewField("Mode", mode) : "",
    note ? renderReviewField("Note", note) : ""
  ].filter(Boolean);
  if (!fields.length) return "";
  return `
    <section class="orders-review-section" data-review-section="payment">
      <h3>Payment Details</h3>
      <div class="orders-review-card">
        <div class="orders-review-fields">${fields.join("")}</div>
      </div>
    </section>
  `;
}

function resolveReviewDeliverySummary(order) {
  const address = resolveReviewAddressRecord(order);
  const line1 = [address.sector, address.district].filter(Boolean).join(", ");
  const line2 = address.province;
  return [line1, line2].filter(Boolean).join("\n");
}

function renderReviewDeliverySection(order) {
  const method = pickReviewText(order?.deliveryLabel, order?.deliveryMethod === "delivery" ? "Home Delivery" : order?.deliveryMethod);
  const status = titleCaseLabel(order?.deliveryStatus || order?.shippingStatus || order?.status || order?.orderStatus, "");
  const shipping = Number(order?.shippingCost || order?.deliveryFee || order?.shippingFee || 0);
  const addressSummary = resolveReviewDeliverySummary(order);
  const tracking = pickReviewText(order?.trackingNumber);
  const provider = pickReviewText(order?.deliveryProvider);
  const meta = getOrderMeta(order?.orderId || order?.id);
  const estimateRaw = pickReviewText(order?.deliveryEstimate, order?.estimatedDelivery, meta.estimatedDelivery);
  const estimate = formatReviewDateTime(estimateRaw) || estimateRaw;
  const deliveredAt = /deliver|complete/i.test(String(order?.status || order?.orderStatus || ""))
    ? formatReviewDateTime(resolveCompletionDate(order))
    : "";
  const fields = [
    method ? renderReviewField("Delivery Method", titleCaseLabel(method, method)) : "",
    status ? renderReviewField("Delivery Status", status) : "",
    addressSummary ? renderReviewField("Address", addressSummary) : "",
    shipping > 0 ? renderReviewField("Shipping Fee", formatCurrency(shipping)) : "",
    provider ? renderReviewField("Delivery Provider", provider) : "",
    tracking ? renderReviewField("Tracking Number", tracking, "", { copyable: true }) : "",
    estimate ? renderReviewField("Estimated Delivery", estimate) : "",
    deliveredAt ? renderReviewField("Delivered", deliveredAt) : ""
  ].filter(Boolean);
  if (!fields.length) return "";
  return `
    <section class="orders-review-section" data-review-section="delivery">
      <h3>Delivery Details</h3>
      <div class="orders-review-card">
        <div class="orders-review-fields">${fields.join("")}</div>
      </div>
    </section>
  `;
}

function timelineLabelKey(label) {
  return String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function reviewEventTime(value, fallback = 0) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) && time > 0 ? time : fallback;
}

function buildReviewTimelineEvents(order) {
  const events = [];
  const seen = new Set();

  const pushEvent = (event) => {
    const key = timelineLabelKey(event.label);
    if (!key) return;
    if (event.state !== "upcoming" && seen.has(key)) return;
    if (event.state !== "upcoming") seen.add(key);
    events.push(event);
  };

  const placedAt = order?.createdAt || order?.date || "";
  pushEvent({
    label: "Order Placed",
    timestamp: placedAt,
    state: "done",
    note: ""
  });

  const history = (Array.isArray(order?.statusHistory) ? order.statusHistory : [])
    .map((entry) => ({
      label: pickReviewText(entry.label, entry.status),
      timestamp: entry.timestamp || entry.at || entry.createdAt || "",
      note: pickReviewText(entry.note, entry.reason)
    }))
    .filter((entry) => entry.label)
    .sort((a, b) => reviewEventTime(a.timestamp, reviewEventTime(placedAt)) - reviewEventTime(b.timestamp, reviewEventTime(placedAt)));

  history.forEach((entry) => {
    if (/^(creat|received|placed|pending|order received)/i.test(entry.label)) return;
    pushEvent({
      label: titleCaseLabel(entry.label, entry.label),
      timestamp: entry.timestamp,
      state: "done",
      note: entry.note
    });
  });

  const paymentStatus = order?.paymentStatusLabel || order?.paymentStatus || "";
  if (isSettledPaidStatus(paymentStatus) && ![...seen].some((key) => /payment|paid/.test(key))) {
    pushEvent({
      label: "Payment Received",
      timestamp: resolveReviewPaymentTimestamp(order),
      state: "done",
      note: ""
    });
  }

  const status = String(order?.status || order?.orderStatus || "").toLowerCase();
  const cancelled = status.includes("cancel");
  const returned = status.includes("return") || status.includes("refund");
  const progress = resolveAllOrdersProgress(order);
  const hasPaymentEvent = [...seen].some((key) => /payment|paid/.test(key));
  const currentStage = progress.find((stage) => stage.state === "current");
  if (
    currentStage
    && currentStage.label !== "Order Placed"
    && !seen.has(timelineLabelKey(currentStage.label))
    && !(currentStage.key === "payment" && hasPaymentEvent)
  ) {
    const updatedAt = order?.updatedAt || "";
    const updatedTime = reviewEventTime(updatedAt);
    const placedTime = reviewEventTime(placedAt);
    pushEvent({
      label: currentStage.label,
      timestamp: updatedTime > placedTime ? updatedAt : "",
      state: "current",
      note: ""
    });
  }

  const upcoming = [];
  if (!cancelled && !returned) {
    progress.forEach((stage) => {
      if (stage.state !== "upcoming") return;
      if (seen.has(timelineLabelKey(stage.label))) return;
      if (stage.key === "payment" && hasPaymentEvent) return;
      if (stage.key === "placed") return;
      upcoming.push({
        label: stage.label,
        timestamp: "",
        state: "upcoming",
        note: "Not completed"
      });
    });
  }

  const recorded = events.filter((event) => event.state !== "upcoming");
  recorded.sort((a, b) => reviewEventTime(a.timestamp, reviewEventTime(placedAt)) - reviewEventTime(b.timestamp, reviewEventTime(placedAt)));
  return recorded.concat(upcoming);
}

function renderReviewTimelineSection(order) {
  const events = buildReviewTimelineEvents(order);
  if (!events.length) return "";
  return `
    <section class="orders-review-section" data-review-section="timeline">
      <h3>Order Timeline</h3>
      <ol class="orders-review-timeline">
        ${events.map((event) => {
          const when = event.timestamp ? formatReviewDateTime(event.timestamp) : "";
          const stateLabel = event.state === "upcoming"
            ? "Not completed"
            : event.state === "current"
              ? "Current"
              : "Completed";
          return `
            <li class="orders-review-timeline__item" data-state="${escapeHtml(event.state || "done")}">
              <span class="orders-review-timeline__dot" aria-hidden="true"></span>
              <div class="orders-review-timeline__copy">
                <strong>${escapeHtml(event.label)}</strong>
                ${event.note && event.state !== "upcoming" ? `<span>${escapeHtml(event.note)}</span>` : ""}
                <small>${escapeHtml(when || (event.state === "upcoming" ? "Not completed" : stateLabel))}</small>
              </div>
            </li>
          `;
        }).join("")}
      </ol>
    </section>
  `;
}

function renderReviewDrawerLoading() {
  return `
    <div class="orders-review-state" aria-busy="true">
      <div class="orders-review-skeleton" aria-hidden="true">
        <div class="orders-skeleton-line"></div>
        <div class="orders-skeleton-line orders-skeleton-line--mid"></div>
        <div class="orders-skeleton-line orders-skeleton-line--short"></div>
        <div class="orders-review-skeleton-item">
          <div class="orders-skeleton-line orders-skeleton-line--media"></div>
          <div class="orders-skeleton-copy">
            <div class="orders-skeleton-line"></div>
            <div class="orders-skeleton-line orders-skeleton-line--short"></div>
          </div>
        </div>
      </div>
      <p>Loading order information...</p>
    </div>
  `;
}

function renderReviewDrawerError(orderId = "") {
  return `
    <div class="orders-review-state orders-review-state--error">
      <h3>Unable to load order information.</h3>
      <p>Please try again.</p>
      <button type="button" class="orders-tool-btn orders-tool-btn--primary" data-review-retry data-order-id="${escapeHtml(orderId)}">Try again</button>
    </div>
  `;
}

function renderReviewActions(order) {
  const ctx = getOrderActionContext(order);
  const busy = Boolean(reviewDrawer.busy);
  const disabled = busy ? "disabled" : "";
  const primaryLabel = busy ? "Updating..." : (ctx.statusOptions.length === 1 && ctx.statusOptions[0] === "Pending" ? "Restore Order" : "Update Status");
  const secondary = [
    `<button type="button" class="orders-tool-btn" data-order-action="view-invoice" data-order-id="${escapeHtml(ctx.id)}" ${disabled}>View Invoice</button>`,
    `<button type="button" class="orders-tool-btn" data-order-action="invoice" data-order-id="${escapeHtml(ctx.id)}" ${disabled}>Print</button>`,
    ctx.telHref ? `<a class="orders-tool-btn" href="${escapeHtml(ctx.telHref)}">Call Customer</a>` : "",
    ctx.mailHref ? `<a class="orders-tool-btn" href="${escapeHtml(ctx.mailHref)}">Email Customer</a>` : ""
  ].filter(Boolean).join("");

  return `
    <section class="orders-review-section orders-review-actions" data-review-section="actions" aria-label="Order actions">
      ${ctx.statusOptions.length ? `<button type="button" class="orders-tool-btn orders-tool-btn--primary orders-review-action-primary" data-order-action="update-status" data-order-id="${escapeHtml(ctx.id)}" ${disabled}>${escapeHtml(primaryLabel)}</button>` : ""}
      ${secondary ? `<div class="orders-review-actions__secondary">${secondary}</div>` : ""}
      ${ctx.canCancel ? `<button type="button" class="orders-tool-btn orders-tool-btn--danger orders-review-action-danger" data-order-action="cancel" data-order-id="${escapeHtml(ctx.id)}" ${disabled}>Cancel Order</button>` : ""}
    </section>
  `;
}

function renderReviewDrawerBody(order) {
  return [
    renderReviewOrderInformation(order),
    renderReviewCustomerPreview(order),
    renderReviewOrderItems(order),
    renderReviewOrderSummary(order),
    renderReviewPaymentPreview(order),
    renderReviewDeliverySection(order),
    renderReviewTimelineSection(order),
    renderReviewActions(order)
  ].join("");
}

function renderReviewDrawerMarkup(order, { loading = false, error = false } = {}) {
  const orderNumber = order ? resolveOrderIdentifiers(order).orderNumber : reviewDrawer.orderId;
  const when = order ? formatOrderRowDateTime(order.date || order.createdAt) : { date: "", time: "" };
  const status = order ? (order.status || order.orderStatus || "") : "";
  const subtitle = [when.date && when.date !== "—" ? when.date : "", when.time].filter(Boolean).join(" • ");
  return `
    <div class="orders-review-backdrop" data-review-close></div>
    <aside class="orders-review-drawer" role="dialog" aria-modal="true" aria-labelledby="ordersReviewTitle" tabindex="-1"${loading || reviewDrawer.busy ? " aria-busy=\"true\"" : ""}>
      <header class="orders-review-header">
        <button type="button" class="orders-review-back" data-review-close aria-label="Back to orders list">←</button>
        <div class="orders-review-header__copy">
          <p class="orders-review-kicker">Order Details</p>
          <h2 id="ordersReviewTitle">${orderNumber ? `#${escapeHtml(orderNumber)}` : "Order Details"}</h2>
          ${subtitle ? `<p class="orders-review-header__meta">${escapeHtml(subtitle)}</p>` : ""}
        </div>
        <div class="orders-review-header__aside">
          ${status ? renderOrderRowStatusBadge(status) : ""}
          <button type="button" class="orders-review-close" data-review-close aria-label="Close order details">✕</button>
        </div>
      </header>
      <div class="orders-review-body">
        ${loading ? renderReviewDrawerLoading() : ""}
        ${error && !loading ? renderReviewDrawerError(reviewDrawer.orderId) : ""}
        ${order && !loading && !error ? renderReviewDrawerBody(order) : ""}
      </div>
    </aside>
  `;
}

function ensureReviewDrawerHost() {
  let host = document.getElementById("ordersReviewDrawerHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "ordersReviewDrawerHost";
    host.className = "orders-review-host";
    host.hidden = true;
    document.body.appendChild(host);
  }
  if (host.dataset.bound !== "1") {
    host.dataset.bound = "1";
    host.addEventListener("click", (event) => {
      if (event.target.closest("[data-review-retry]")) {
        retryReviewDrawer();
        return;
      }
      if (event.target.closest("[data-review-close]")) {
        closeReviewDrawer();
        return;
      }
      const actionBtn = event.target.closest("[data-order-action]");
      if (actionBtn) {
        const action = actionBtn.getAttribute("data-order-action");
        const orderId = actionBtn.getAttribute("data-order-id");
        if (actionBtn.hasAttribute("disabled") || reviewDrawer.busy) return;
        if (typeof reviewDrawer.handleAction === "function") {
          void reviewDrawer.handleAction(action, orderId);
        }
      }
    });
    host.addEventListener("keydown", (event) => {
      if (event.key !== "Tab" || host.hidden) return;
      const focusables = getReviewDrawerFocusables(host);
      if (focusables.length < 2) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }
  return host;
}

function paintReviewDrawer({ order = null, loading = false, error = false, focus = true } = {}) {
  const host = ensureReviewDrawerHost();
  const previousBody = host.querySelector(".orders-review-body");
  const scrollTop = !focus && previousBody ? previousBody.scrollTop : 0;
  host.innerHTML = renderReviewDrawerMarkup(order, { loading, error });
  host.hidden = false;
  setReviewDrawerScrollLock(true);
  if (!focus) {
    const nextBody = host.querySelector(".orders-review-body");
    if (nextBody) nextBody.scrollTop = scrollTop;
    return;
  }
  window.requestAnimationFrame(() => {
    const closeBtn = host.querySelector(".orders-review-close");
    (closeBtn || host.querySelector(".orders-review-drawer"))?.focus();
  });
}

function closeReviewDrawer({ restoreFocus = true } = {}) {
  const host = document.getElementById("ordersReviewDrawerHost");
  if (host) {
    host.hidden = true;
    host.innerHTML = "";
  }
  reviewDrawer.orderId = "";
  setReviewDrawerScrollLock(false);
  const previous = reviewDrawer.previousFocus;
  reviewDrawer.previousFocus = null;
  if (restoreFocus && previous && typeof previous.focus === "function") {
    try {
      previous.focus();
    } catch (_error) {
      /* ignore */
    }
  }
}

function retryReviewDrawer() {
  const orderId = reviewDrawer.orderId;
  if (!orderId) return;
  const resolved = typeof reviewDrawer.resolveOrder === "function" ? reviewDrawer.resolveOrder(orderId) : null;
  if (resolved) {
    paintReviewDrawer({ order: resolved });
    return;
  }
  paintReviewDrawer({ loading: true, error: false });
  if (typeof reviewDrawer.reloadAndResolve === "function") {
    void reviewDrawer.reloadAndResolve(orderId);
    return;
  }
  paintReviewDrawer({ error: true });
}

function openReviewDrawer(orderId, order = null) {
  const id = String(orderId || "").trim();
  if (!id) return;
  reviewDrawer.orderId = id;
  if (!reviewDrawer.previousFocus && document.activeElement instanceof HTMLElement) {
    reviewDrawer.previousFocus = document.activeElement;
  }
  const resolved = order || (typeof reviewDrawer.resolveOrder === "function" ? reviewDrawer.resolveOrder(id) : null);
  if (resolved) {
    paintReviewDrawer({ order: resolved });
    return;
  }
  paintReviewDrawer({ loading: true });
  if (typeof reviewDrawer.reloadAndResolve === "function") {
    void reviewDrawer.reloadAndResolve(id);
    return;
  }
  paintReviewDrawer({ error: true });
}

function refreshOpenReviewDrawer() {
  if (!isReviewDrawerOpen() || !reviewDrawer.orderId) return;
  const resolved = typeof reviewDrawer.resolveOrder === "function" ? reviewDrawer.resolveOrder(reviewDrawer.orderId) : null;
  if (resolved) {
    paintReviewDrawer({ order: resolved, focus: false });
    return;
  }
  const host = document.getElementById("ordersReviewDrawerHost");
  const waiting = Boolean(host?.querySelector(".orders-review-state"));
  if (waiting) paintReviewDrawer({ error: true, focus: false });
}

function renderAllOrdersProductStrip(items = []) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    return `
      <div class="order-row-product order-row-product--empty">
        <div class="order-row-product-media">
          <div class="order-row-product-ph" aria-hidden="true">—</div>
        </div>
        <div class="order-row-product-body">
          <p class="order-row-product-name">No products</p>
          <p class="order-row-product-meta">This order has no line items.</p>
        </div>
      </div>
    `;
  }

  const primary = list[0] || {};
  const imageSrc = resolveProductImage(primary);
  const productName = String(primary.productName || "Product").trim();
  const sku = String(primary.sku || "").trim();
  const productId = String(primary.productId || "").trim();
  const identityLabel = sku ? `SKU ${sku}` : (productId ? `ID ${productId}` : "");
  const variant = resolveProductVariant(primary);
  const qty = Number(primary.quantity) || 1;
  const extraCount = Math.max(0, list.length - 1);
  const metaParts = [
    identityLabel,
    `Qty ${qty}`,
    variant,
    extraCount ? `+${extraCount} more` : ""
  ].filter(Boolean);
  const placeholderLetter = escapeHtml(productName.slice(0, 1).toUpperCase() || "P");

  return `
    <div class="order-row-product">
      <div class="order-row-product-media">
        ${imageSrc
          ? `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(productName)}" loading="lazy" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false;">`
          : ""}
        <div class="order-row-product-ph" ${imageSrc ? "hidden" : ""} aria-hidden="true">${placeholderLetter}</div>
        ${extraCount ? `<span class="order-row-product-count" title="${extraCount} more item${extraCount === 1 ? "" : "s"}">+${extraCount}</span>` : ""}
      </div>
      <div class="order-row-product-body">
        <p class="order-row-product-name" title="${escapeHtml(productName)}">${escapeHtml(productName)}</p>
        <p class="order-row-product-meta" title="${escapeHtml(metaParts.join(" · "))}">${escapeHtml(metaParts.join(" · "))}</p>
      </div>
    </div>
  `;
}

function renderAllOrdersActions(order, expanded = false) {
  const ctx = getOrderActionContext(order);
  const id = escapeHtml(ctx.id);
  const detailsId = `order-details-${id}`;
  const restoreLabel = ctx.statusOptions.length === 1 && ctx.statusOptions[0] === "Pending" ? "Restore Order" : "Update Status";

  return `
    <div class="order-row-actions" data-order-actions="${id}">
      <details class="order-card-more">
        <summary class="order-row-more-btn" aria-label="Actions for order ${id}" aria-haspopup="menu" title="Actions">⋮</summary>
        <div class="order-card-more-menu" role="menu">
          <button type="button" role="menuitem" data-order-action="review" data-order-id="${id}">Review Information</button>
          ${ctx.statusOptions.length ? `<button type="button" role="menuitem" data-order-action="update-status" data-order-id="${id}">${escapeHtml(restoreLabel)}</button>` : ""}
          <button type="button" role="menuitem" data-order-action="view-invoice" data-order-id="${id}">View Invoice</button>
          <button type="button" role="menuitem" data-order-action="invoice" data-order-id="${id}">Print Invoice</button>
          ${ctx.telHref ? `<a role="menuitem" href="${escapeHtml(ctx.telHref)}">Call Customer</a>` : ""}
          ${ctx.mailHref ? `<a role="menuitem" href="${escapeHtml(ctx.mailHref)}">Email Customer</a>` : ""}
          <button type="button" role="menuitem" data-order-action="toggle" data-order-id="${id}" aria-expanded="${expanded ? "true" : "false"}" aria-controls="${detailsId}">${expanded ? "Hide Details" : "View Details"}</button>
          <button type="button" role="menuitem" data-order-action="packing" data-order-id="${id}">Print Packing Slip</button>
          ${ctx.canCancel ? `<button type="button" role="menuitem" class="orders-danger-button" data-order-action="cancel" data-order-id="${id}">Cancel Order</button>` : ""}
          ${canBulkDeleteOrder(order) ? `<button type="button" role="menuitem" class="orders-danger-button" data-order-action="delete-one" data-order-id="${id}">Delete Order</button>` : ""}
        </div>
      </details>
    </div>
  `;
}

function renderAllOrdersManagementSection(order) {
  const id = escapeHtml(order.orderId || order.id);
  const meta = getOrderMeta(order.orderId || order.id);
  return `
    <section class="order-details-section order-details-section--manage">
      <header class="order-details-section__head">
        <h3>Order Management</h3>
        <p>Priority, notes, tags, and assignment</p>
      </header>
      <form class="order-manage-form" data-order-manage-form="${id}">
        <div class="order-manage-grid">
          <label>
            <span>Priority</span>
            <select name="priority">
              ${PRIORITY_OPTIONS.map((option) => (
                `<option value="${escapeHtml(option.value)}" ${meta.priority === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`
              )).join("")}
            </select>
          </label>
          <label>
            <span>Assigned Staff</span>
            <select name="assignedStaff">
              ${STAFF_OPTIONS.map((option) => (
                `<option value="${escapeHtml(option === "Unassigned" ? "" : option)}" ${String(meta.assignedStaff || "") === (option === "Unassigned" ? "" : option) ? "selected" : ""}>${escapeHtml(option)}</option>`
              )).join("")}
            </select>
          </label>
          <label>
            <span>Estimated Delivery</span>
            <input type="date" name="estimatedDelivery" value="${escapeHtml(meta.estimatedDelivery)}" />
          </label>
          <label>
            <span>Order Tags</span>
            <input type="text" name="tags" value="${escapeHtml(meta.tags.join(", "))}" placeholder="vip, fragile, express" />
          </label>
          <label class="order-manage-span">
            <span>Internal Staff Notes</span>
            <textarea name="staffNotes" rows="2" placeholder="Internal notes for your team">${escapeHtml(meta.staffNotes)}</textarea>
          </label>
          <label class="order-manage-span">
            <span>Customer Notes</span>
            <textarea name="customerNotes" rows="2" placeholder="Notes shared by the customer">${escapeHtml(meta.customerNotes)}</textarea>
          </label>
          <label class="order-manage-span">
            <span>Delivery Notes</span>
            <textarea name="deliveryNotes" rows="2" placeholder="Gate code, landmark, delivery instructions">${escapeHtml(meta.deliveryNotes)}</textarea>
          </label>
        </div>
        <div class="order-manage-actions">
          <button type="submit" class="order-qa-btn order-qa-btn--primary">Save Management Details</button>
        </div>
      </form>
    </section>
  `;
}

function renderProductCard(item) {
  const imageSrc = resolveProductImage(item);
  const image = imageSrc
    ? `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(item.productName || "Product")}" loading="lazy">`
    : `<div class="order-product-ph" aria-hidden="true"></div>`;
  const variant = item?.attributeSummary || [item?.color, item?.size].filter(Boolean).join(" · ");
  const link = item?.productUrl
    ? `<a class="orders-inline-link" href="${escapeHtml(item.productUrl)}" target="_blank" rel="noopener">View product</a>`
    : "";

  return `
    <article class="order-product-card">
      ${image}
      <div class="order-product-copy">
        <div class="order-product-heading">
          <div>
            <h3>${escapeHtml(item?.productName || "Product")}</h3>
            ${variant ? `<p>${escapeHtml(variant)}</p>` : ""}
          </div>
          <strong>${formatCurrency(item?.lineTotal || ((Number(item?.price) || 0) * (Number(item?.quantity) || 1)))}</strong>
        </div>
        <div class="order-product-meta">
          <div><span>SKU</span><strong>${escapeHtml(item?.sku || "—")}</strong></div>
          <div><span>Color</span><strong>${escapeHtml(item?.color || "—")}</strong></div>
          <div><span>Size</span><strong>${escapeHtml(item?.size || "—")}</strong></div>
          <div><span>Qty</span><strong>${escapeHtml(item?.quantity || 1)}</strong></div>
          <div><span>Unit price</span><strong>${formatCurrency(item?.price || 0)}</strong></div>
          <div><span>Total price</span><strong>${formatCurrency(item?.lineTotal || ((Number(item?.price) || 0) * (Number(item?.quantity) || 1)))}</strong></div>
        </div>
        ${link}
      </div>
    </article>
  `;
}

const ALL_ORDERS_PROGRESS = [
  { key: "placed", label: "Order Placed" },
  { key: "payment", label: "Payment Confirmed" },
  { key: "processing", label: "Processing" },
  { key: "packed", label: "Packed" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" }
];

function resolveDpoTransactionReference(order) {
  const payment = order?.payment && typeof order.payment === "object" ? order.payment : {};
  const gateway = payment.gateway && typeof payment.gateway === "object" ? payment.gateway : {};
  return String(gateway.transRef || order?.transactionReference || order?.paymentReference || "").trim() || "—";
}

function resolvePaymentTimestamp(order) {
  const payment = order?.payment && typeof order.payment === "object" ? order.payment : {};
  const gateway = payment.gateway && typeof payment.gateway === "object" ? payment.gateway : {};
  return gateway.verifiedAt || gateway.updatedAt || gateway.initiatedAt || order?.updatedAt || order?.createdAt || order?.date || "";
}

function resolveTransactionReference(order) {
  const payment = order?.payment && typeof order.payment === "object" ? order.payment : {};
  const gateway = payment.gateway && typeof payment.gateway === "object" ? payment.gateway : {};
  const transaction = payment.transaction && typeof payment.transaction === "object" ? payment.transaction : {};
  return String(
    order?.transactionId
    || order?.transactionReference
    || order?.paymentReference
    || order?.paymentRef
    || order?.txRef
    || order?.momoTransactionId
    || payment.transactionId
    || payment.reference
    || payment.txRef
    || transaction.reference
    || gateway.transRef
    || gateway.companyRef
    || ""
  ).trim() || "—";
}

function resolveInternalNotes(order) {
  const workflow = getReturnWorkflow(order);
  return String(
    order?.internalNotes
    || order?.adminNotes
    || order?.notes
    || workflow.adminNotes
    || order?.paymentNote
    || order?.shippingAddress?.note
    || ""
  ).trim();
}

function buildCustomerInfoText(order) {
  const ship = order?.shippingAddress || {};
  const full = order?.fullAddress || {};
  return [
    `Name: ${ship.fullName || order?.customerName || "—"}`,
    `Phone: ${ship.phone || order?.customerPhone || "—"}`,
    `Email: ${order?.customerEmail || "—"}`,
    `Province: ${ship.provinceCity || ship.province || full.province || full.provinceCity || "—"}`,
    `District: ${ship.district || full.district || "—"}`,
    `Sector: ${ship.sector || full.sector || "—"}`
  ].join("\n");
}

function buildDeliveryAddressText(order) {
  const ship = order?.shippingAddress || {};
  const full = order?.fullAddress || {};
  return [
    ship.fullName || order?.customerName || "",
    ship.phone || order?.customerPhone || "",
    ship.provinceCity || ship.province || full.province || full.provinceCity || "",
    ship.district || full.district || "",
    ship.sector || full.sector || "",
    ship.cell || full.cell || "",
    ship.village || full.village || "",
    ship.note || full.note || full.street || full.addressLine || ship.addressLine || ""
  ].map((part) => String(part || "").trim()).filter(Boolean).join("\n");
}

async function copyTextToClipboard(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (_error) {
    /* fallback below */
  }
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch (_error) {
    return false;
  }
}

function resolveAllOrdersProgress(order) {
  const status = String(order?.status || order?.orderStatus || "").toLowerCase();
  const payment = String(order?.paymentStatusLabel || order?.paymentStatus || "").toLowerCase();
  const method = String(order?.paymentMethod || order?.paymentMethodLabel || "").toLowerCase();
  const cancelled = status.includes("cancel");
  const paymentDone = isSettledPaidStatus(payment)
    || ((method.includes("cod") || method.includes("cash")) && (
      status.includes("confirm")
      || status.includes("process")
      || status.includes("pack")
      || status.includes("ship")
      || status.includes("deliver")
      || status.includes("complete")
    ));

  let index = 0;
  if (/deliver|complete/.test(status)) index = 5;
  else if (/ship|out for delivery|out_for_delivery/.test(status)) index = 4;
  else if (/pack/.test(status)) index = 3;
  else if (/process|confirm/.test(status)) index = 2;
  else if (paymentDone) index = 1;
  else index = 0;

  return ALL_ORDERS_PROGRESS.map((stage, stageIndex) => ({
    key: stage.key,
    label: stage.label,
    state: cancelled && stageIndex > index
      ? "muted"
      : stageIndex < index
        ? "done"
        : stageIndex === index
          ? (cancelled ? "cancelled" : "current")
          : "upcoming"
  }));
}

function renderAllOrdersProgressTimeline(order) {
  const stages = resolveAllOrdersProgress(order);
  return `
    <section class="order-details-section order-details-section--timeline" aria-label="Order fulfillment timeline">
      <header class="order-details-section__head">
        <h3>Order Timeline</h3>
        <p>Fulfillment progress for this order</p>
      </header>
      <ol class="order-progress-timeline">
        ${stages.map((stage) => `
          <li class="order-progress-timeline__item" data-state="${escapeHtml(stage.state)}">
            <span class="order-progress-timeline__dot" aria-hidden="true"></span>
            <strong>${escapeHtml(stage.label)}</strong>
          </li>
        `).join("")}
      </ol>
    </section>
  `;
}

function renderAllOrdersDetailProduct(item) {
  const imageSrc = resolveProductImage(item);
  const image = imageSrc
    ? `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(item.productName || "Product")}" loading="lazy" decoding="async">`
    : `<div class="order-detail-product__ph" aria-hidden="true">${escapeHtml(String(item?.productName || "P").slice(0, 1).toUpperCase())}</div>`;
  const variant = resolveProductVariant(item) || [item?.color, item?.size].filter(Boolean).join(" · ") || "Standard";
  const qty = Number(item?.quantity) || 1;
  const unit = Number(item?.price) || 0;
  const lineTotal = Number(item?.lineTotal != null ? item.lineTotal : unit * qty) || 0;

  return `
    <article class="order-detail-product">
      <div class="order-detail-product__media">${image}</div>
      <div class="order-detail-product__body">
        <div class="order-detail-product__heading">
          <h4>${escapeHtml(item?.productName || "Product")}</h4>
          <strong>${formatCurrency(lineTotal)}</strong>
        </div>
        <p class="order-detail-product__variant">${escapeHtml(variant)}</p>
        <div class="order-detail-product__meta">
          <div><span>SKU</span><strong>${escapeHtml(item?.sku || "—")}</strong></div>
          <div><span>Quantity</span><strong>${escapeHtml(qty)}</strong></div>
          <div><span>Unit Price</span><strong>${formatCurrency(unit)}</strong></div>
          <div><span>Total Price</span><strong>${formatCurrency(lineTotal)}</strong></div>
        </div>
      </div>
    </article>
  `;
}

function renderAllOrdersQuickActions(order) {
  const ctx = getOrderActionContext(order);
  const id = escapeHtml(ctx.id);
  const mapLink = resolveMapLink(order);

  return `
    <div class="order-details-actions" data-order-actions="${id}" aria-label="Order quick actions">
      <div class="order-details-actions__primary">
        <button type="button" class="order-qa-btn order-qa-btn--primary" data-order-action="invoice" data-order-id="${id}">Print Invoice</button>
        <button type="button" class="order-qa-btn" data-order-action="packing" data-order-id="${id}">Print Packing Slip</button>
        ${ctx.telHref ? `<a class="order-qa-btn" href="${escapeHtml(ctx.telHref)}">Call Customer</a>` : ""}
        ${mapLink ? `<a class="order-qa-btn" href="${escapeHtml(mapLink)}" target="_blank" rel="noopener noreferrer">Open in Maps</a>` : ""}
        <button type="button" class="order-qa-btn" data-order-action="copy-customer" data-order-id="${id}">Copy Customer</button>
        <button type="button" class="order-qa-btn" data-order-action="copy-address" data-order-id="${id}">Copy Address</button>
        <button type="button" class="order-qa-btn" data-order-action="download-invoice" data-order-id="${id}">Download PDF</button>
        <details class="order-qa-more">
          <summary class="order-qa-btn" aria-label="More order actions">More</summary>
          <div class="order-qa-more-menu" role="menu">
            <button type="button" role="menuitem" data-order-action="payment" data-order-id="${id}">View Payment Details</button>
            ${ctx.mailHref ? `<a role="menuitem" href="${escapeHtml(ctx.mailHref)}">Email Customer</a>` : ""}
            <button type="button" role="menuitem" data-order-action="summary" data-order-id="${id}">Print Order Summary</button>
            <button type="button" role="menuitem" data-order-action="toggle" data-order-id="${id}">Hide Details</button>
          </div>
        </details>
      </div>
      <div class="order-details-actions__status">
        ${renderStatusSelect(order)}
      </div>
    </div>
  `;
}

function renderAllOrdersDetailNav(order) {
  const id = escapeHtml(order.orderId || order.id);
  return `
    <nav class="order-details-nav" aria-label="Jump to order section">
      <div class="order-details-nav__track" role="list">
        ${ORDER_DETAIL_NAV.map((item) => `
          <button type="button" role="listitem" class="order-details-nav__btn" data-order-jump="${escapeHtml(item.key)}" data-order-id="${id}">${escapeHtml(item.label)}</button>
        `).join("")}
      </div>
      <button type="button" class="order-details-nav__btn order-details-nav__btn--close" data-order-action="toggle" data-order-id="${id}" aria-label="Close order details">Close</button>
    </nav>
  `;
}

function renderAllOrdersDetails(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const ship = order?.shippingAddress || {};
  const full = order?.fullAddress || {};
  const paymentStatus = order?.paymentStatusLabel || order?.paymentStatus || "Pending";
  const orderStatus = order?.status || order?.orderStatus || "Pending";
  const phone = ship.phone || order?.customerPhone || "";
  const email = order?.customerEmail || "";
  const province = ship.provinceCity || ship.province || full.province || full.provinceCity || "—";
  const district = ship.district || full.district || "—";
  const sector = ship.sector || full.sector || "—";
  const cell = ship.cell || full.cell || "—";
  const village = ship.village || full.village || "—";
  const landmark = ship.note || full.note || full.street || full.addressLine || ship.addressLine || "";
  const fullAddress = [
    province !== "—" ? province : "",
    district !== "—" ? district : "",
    sector !== "—" ? sector : "",
    cell !== "—" ? cell : "",
    village !== "—" ? village : "",
    landmark
  ].filter(Boolean).join(", ") || "—";
  const internalNotes = resolveInternalNotes(order);
  const mapLink = resolveMapLink(order);
  const orderKey = escapeHtml(order.orderId || order.id);

  return `
    <div class="order-details-panel">
      ${renderAllOrdersDetailNav(order)}
      ${renderAllOrdersQuickActions(order)}
      <div data-order-section="manage" data-order-section-for="${orderKey}">
        ${renderAllOrdersManagementSection(order)}
      </div>

      <div class="order-details-grid">
        <section class="order-details-section order-details-section--summary" data-order-section="summary" data-order-section-for="${orderKey}">
          <header class="order-details-section__head">
            <h3>Order Summary</h3>
            <div class="order-details-section__badges">
              ${badge(String(orderStatus), statusTone(orderStatus))}
              ${badge(String(paymentStatus), statusTone(paymentStatus))}
            </div>
          </header>
          ${renderInfoGrid([
            ["Order Number", order.orderId || order.id],
            ["Order Date", formatDate(order.date || order.createdAt)],
            ["Order Status", orderStatus],
            ["Payment Status", paymentStatus],
            ["Items", String(items.length || 0)],
            ["Subtotal", formatCurrency(order.subtotal || 0)],
            ["Shipping", formatCurrency(order.shippingCost || order.deliveryFee || 0)],
            Number(order.discount) > 0 ? ["Discount", formatCurrency(order.discount)] : null,
            Number(order.codFee) > 0 ? ["COD Fee", formatCurrency(order.codFee)] : null,
            ["Grand Total", formatCurrency(order.grandTotal || order.total || 0)]
          ].filter(Boolean))}
        </section>

        <section class="order-details-section order-details-section--payment" data-order-section="payment" data-order-section-for="${orderKey}">
          <header class="order-details-section__head">
            <h3>Payment Information</h3>
          </header>
          ${renderInfoGrid([
            ["Payment Method", paymentLabel(order)],
            ["Payment Status", { html: badge(String(paymentStatus), statusTone(paymentStatus)) }],
            ["Payment Reference", resolveTransactionReference(order)],
            ["DPO Transaction Reference", resolveDpoTransactionReference(order)],
            ["Mode", resolveAdminPaymentMode(order)],
            ["Payment Type", order.paymentType || (order.paymentMethod === "cod" ? "cod" : "pay_now")],
            ["Amount", formatCurrency(order.grandTotal || order.total || 0)],
            ["Currency", order.currency || "RWF"],
            ["Date / Time", formatDate(resolvePaymentTimestamp(order))],
            ["Payer Phone", order.payerPhone || order.customerPhone || "—"],
            ["Note", order.paymentNote || ""]
          ])}
          ${renderPaymentStatusActions(order)}
        </section>

        <section class="order-details-section order-details-section--customer" data-order-section="customer" data-order-section-for="${orderKey}">
          <header class="order-details-section__head">
            <h3>Customer Information</h3>
          </header>
          ${renderInfoGrid([
            ["Customer Name", ship.fullName || order.customerName || "—"],
            ["Phone Number", phone
              ? { html: `<a class="orders-inline-link" href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a>` }
              : "—"],
            ["Email", email
              ? { html: `<a class="orders-inline-link" href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` }
              : ""],
            ["Province", province],
            ["District", district],
            ["Sector", sector],
            ["Cell", cell],
            ["Village", village],
            ["Full Delivery Address", fullAddress]
          ])}
        </section>

        <section class="order-details-section order-details-section--delivery" data-order-section="delivery" data-order-section-for="${orderKey}">
          <header class="order-details-section__head">
            <h3>Delivery Address</h3>
          </header>
          ${renderInfoGrid([
            ["Recipient", ship.fullName || order.customerName || "—"],
            ["Phone", phone || "—"],
            ["Province", province],
            ["District", district],
            ["Sector", sector],
            ["Cell", cell],
            ["Village", village],
            ["Landmark / Note", landmark || "—"],
            ["Full Address", fullAddress]
          ])}
          ${mapLink ? `<p class="orders-inline-link-wrap"><a class="orders-inline-link" href="${escapeHtml(mapLink)}" target="_blank" rel="noopener noreferrer">Open Location on Google Maps</a></p>` : ""}
          ${renderGps(order)}
        </section>

        <section class="order-details-section order-details-section--shipping" data-order-section="shipping" data-order-section-for="${orderKey}">
          <header class="order-details-section__head">
            <h3>Shipping Information</h3>
          </header>
          ${renderInfoGrid([
            ["Shipping Method", order.deliveryLabel || order.deliveryMethod || "Home delivery"],
            ["Shipping Status", order.shippingStatus || order.status || "—"],
            ["Delivery Status", order.deliveryStatus || order.status || "—"],
            ["Shipping Cost", formatCurrency(order.shippingCost || order.deliveryFee || 0)],
            resolveCompletionDate(order) ? ["Delivery Date", formatDate(resolveCompletionDate(order))] : null
          ].filter(Boolean))}
        </section>

        <section class="order-details-section order-details-section--notes">
          <header class="order-details-section__head">
            <h3>Internal Notes</h3>
          </header>
          <div class="order-details-notes">
            ${internalNotes
              ? `<p>${escapeHtml(internalNotes)}</p>`
              : `<p class="order-details-notes--empty">No internal notes for this order.</p>`}
          </div>
        </section>
      </div>

      <section class="order-details-section order-details-section--products" data-order-section="products" data-order-section-for="${orderKey}">
        <header class="order-details-section__head">
          <h3>Product Information</h3>
          <p>${items.length} item${items.length === 1 ? "" : "s"}</p>
        </header>
        ${items.length
          ? `<div class="order-details-products">${items.map(renderAllOrdersDetailProduct).join("")}</div>`
          : `<p class="orders-empty-state">No products on this order.</p>`}
      </section>

      <div data-order-section="timeline" data-order-section-for="${orderKey}">
        ${renderAllOrdersProgressTimeline(order)}
      </div>
    </div>
  `;
}

function buildTimelineEvents(order, viewMode = "all") {
  const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
  const events = [];
  const completionDate = resolveCompletionDate(order);

  events.push({
    label: "Created",
    timestamp: order.createdAt || order.date,
    tone: "done"
  });

  history.forEach((entry) => {
    const label = entry.label || entry.status || "Update";
    if (/creat|received|pending/i.test(label) && events.length === 1) return;
    events.push({
      label,
      note: entry.note,
      timestamp: entry.timestamp,
      tone: statusTone(entry.status || entry.label)
    });
  });

  const current = String(order.status || "").toLowerCase();
  const stages = viewMode === "completed"
    ? TIMELINE_STAGES.filter((stage) => !["cancelled", "returned", "refunded"].includes(stage.key))
    : viewMode === "cancelled"
      ? TIMELINE_STAGES.filter((stage) => ["created", "confirmed", "processing", "packed", "shipped", "cancelled"].includes(stage.key))
      : viewMode === "returns"
        ? TIMELINE_STAGES.filter((stage) => ["created", "confirmed", "processing", "shipped", "delivered", "completed", "cancelled", "returned", "refunded"].includes(stage.key))
        : TIMELINE_STAGES;

  stages.forEach((stage) => {
    if (stage.key === "created") return;
    const already = events.some((event) => stage.match.test(String(event.label || "")));
    if (already) return;
    if (stage.match.test(current) || (stage.key === "completed" && /deliver|complete/.test(current))) {
      events.push({
        label: stage.label,
        timestamp: stage.key === "delivered" || stage.key === "completed" ? (completionDate || order.date) : order.date,
        tone: "current"
      });
    }
  });

  if (viewMode === "completed" && !events.some((event) => /complete/i.test(String(event.label || ""))) && /deliver|complete/.test(current)) {
    events.push({
      label: "Completed",
      timestamp: completionDate || order.date,
      tone: "success"
    });
  }

  return events;
}

function renderTimeline(order, viewMode = "all") {
  const events = buildTimelineEvents(order, viewMode);
  return `
    <div class="orders-detail-card">
      <h4>Order Timeline</h4>
      <ol class="orders-timeline">
        ${events.map((event) => `
          <li class="orders-timeline__item" data-tone="${escapeHtml(event.tone || "neutral")}">
            <strong>${escapeHtml(event.label)}</strong>
            ${event.note ? `<span>${escapeHtml(event.note)}</span>` : ""}
            <small>${event.timestamp ? formatDate(event.timestamp) : ""}</small>
          </li>
        `).join("")}
      </ol>
    </div>
  `;
}

function renderStatusSelect(order) {
  const current = getOrderStatusLabel(order);
  const allowed = [current, ...getValidStatusTransitions(order)].filter((status, index, list) => (
    list.findIndex((item) => item.toLowerCase() === status.toLowerCase()) === index
  ));
  const locked = allowed.length <= 1;
  const options = allowed.map((status) => (
    `<option value="${escapeHtml(status)}" ${status.toLowerCase() === current.toLowerCase() ? "selected" : ""}>${escapeHtml(status)}</option>`
  )).join("");

  return `
    <label class="orders-status-control">
      <span>Update Order Status</span>
      <select data-order-status="${escapeHtml(order.orderId || order.id)}" ${locked ? "disabled" : ""} aria-label="Update order status">${options}</select>
    </label>
  `;
}

function renderActions(order, viewMode = "all") {
  const id = escapeHtml(order.orderId || order.id);
  const phone = escapeHtml(order.customerPhone || order.shippingAddress?.phone || "");
  const email = escapeHtml(order.customerEmail || "");
  const mapLink = resolveMapLink(order);
  const isPendingView = viewMode === "pending";
  const isCompletedView = viewMode === "completed";
  const isCancelledView = viewMode === "cancelled";
  const isReturnsView = viewMode === "returns";
  const workflow = getReturnWorkflow(order);
  const returnStatus = String(workflow.returnStatus || "").toLowerCase();
  const refundStatus = String(workflow.refundStatus || order.paymentStatus || "").toLowerCase();
  const refundDone = refundStatus === "completed" || refundStatus === "refunded" || String(order.paymentStatus || "").toLowerCase() === "refunded";
  const returnRejected = returnStatus === "rejected";
  const returnApproved = returnStatus === "approved" || returnStatus === "received";
  const canOpenReturn = !returnApproved && !refundDone && returnStatus !== "requested" && !returnRejected;
  const canApproveReturn = (returnStatus === "requested" || (!returnStatus && order.refundRequired)) && !returnApproved && !returnRejected && !refundDone;
  const canRejectReturn = (returnStatus === "requested" || (!returnStatus && order.refundRequired)) && !returnApproved && !refundDone;
  const canApproveRefund = !refundDone && refundStatus !== "rejected" && (order.refundRequired || returnApproved || refundStatus === "required" || refundStatus === "pending" || String(order.paymentStatus || "").toLowerCase().includes("refund_required"));
  const canRejectRefund = canApproveRefund;

  return `
    <div class="orders-actions-inline${viewMode === "all" ? " orders-actions-inline--all" : ""}" data-order-actions="${id}">
      <button type="button" class="orders-secondary-link" data-order-action="toggle" data-order-id="${id}">${isReturnsView ? "View Complete Return" : "View Complete Order"}</button>
      ${isPendingView ? `
        <button type="button" class="orders-secondary-link orders-action--primary" data-order-action="accept" data-order-id="${id}">Accept Order</button>
        <button type="button" class="orders-secondary-link orders-action--primary" data-order-action="process" data-order-id="${id}">Start Processing</button>
      ` : ""}
      ${isCompletedView || isCancelledView || isReturnsView ? `
        <button type="button" class="orders-secondary-link" data-order-action="customer" data-order-id="${id}">View Customer Details</button>
      ` : ""}
      ${isCompletedView ? `
        <button type="button" class="orders-secondary-link" data-order-action="delivery" data-order-id="${id}">View Delivery Information</button>
      ` : ""}
      ${isCancelledView ? `
        <button type="button" class="orders-secondary-link" data-order-action="cancellation-reason" data-order-id="${id}">View Cancellation Reason</button>
        <button type="button" class="orders-secondary-link orders-action--primary" data-order-action="restore" data-order-id="${id}">Restore Order</button>
        <button type="button" class="orders-secondary-link" data-order-action="summary" data-order-id="${id}">Print Order Summary</button>
        ${order.refundRequired ? `<a class="orders-secondary-link" href="#/orders?status=returns">Open Returns &amp; Refunds</a>` : ""}
      ` : ""}
      ${isReturnsView ? `
        <a class="orders-secondary-link" href="#/orders" data-order-action="view-original" data-order-id="${id}">View Original Order</a>
        ${canOpenReturn ? `<button type="button" class="orders-secondary-link orders-action--primary" data-order-action="open-return" data-order-id="${id}">Open Return Request</button>` : ""}
        ${canApproveReturn ? `<button type="button" class="orders-secondary-link orders-action--primary" data-order-action="approve-return" data-order-id="${id}">Approve Return</button>` : ""}
        ${canRejectReturn ? `<button type="button" class="orders-danger-button" data-order-action="reject-return" data-order-id="${id}">Reject Return</button>` : ""}
        ${canApproveRefund ? `<button type="button" class="orders-secondary-link orders-action--primary" data-order-action="approve-refund" data-order-id="${id}">Approve Refund</button>` : ""}
        ${canRejectRefund ? `<button type="button" class="orders-danger-button" data-order-action="reject-refund" data-order-id="${id}">Reject Refund</button>` : ""}
        <button type="button" class="orders-secondary-link" data-order-action="print-return" data-order-id="${id}">Print Return Report</button>
        <button type="button" class="orders-secondary-link" data-order-action="print-refund" data-order-id="${id}">Print Refund Report</button>
      ` : ""}
      ${isReturnsView ? "" : `<button type="button" class="orders-secondary-link" data-order-action="invoice" data-order-id="${id}">Print Invoice</button>`}
      ${isCompletedView ? `
        <button type="button" class="orders-secondary-link" data-order-action="receipt" data-order-id="${id}">Print Receipt</button>
        <button type="button" class="orders-secondary-link" data-order-action="download-invoice" data-order-id="${id}">Download Invoice (PDF)</button>
      ` : ""}
      ${isReturnsView ? "" : `<button type="button" class="orders-secondary-link" data-order-action="packing" data-order-id="${id}">Print Packing Slip</button>`}
      ${phone ? `<a class="orders-secondary-link" href="tel:${phone}">Contact Customer</a>` : ""}
      ${email ? `<a class="orders-secondary-link" href="mailto:${email}">Email Customer</a>` : ""}
      ${mapLink ? `<a class="orders-secondary-link" href="${escapeHtml(mapLink)}" target="_blank" rel="noopener">Open Customer Location in Google Maps</a>` : ""}
      <button type="button" class="orders-secondary-link" data-order-action="payment" data-order-id="${id}">View Payment Details</button>
      ${isPendingView ? `
        <button type="button" class="orders-danger-button" data-order-action="cancel" data-order-id="${id}">Cancel Order</button>
      ` : ""}
    </div>
  `;
}

function renderAllOrdersGroupedList(orders = [], expandedId = "", selectedIds = [], { groupByDate = true, newestFirst = true } = {}) {
  const selectedSet = selectedIds instanceof Set
    ? selectedIds
    : new Set((Array.isArray(selectedIds) ? selectedIds : []).map(String));
  if (!orders.length) return "";

  const listHead = `
      <div class="orders-list-head" aria-hidden="true">
        <span class="order-row-col order-row-col--check"></span>
        <span class="order-row-col order-row-col--order">Order</span>
        <span class="order-row-col order-row-col--customer">Customer</span>
        <span class="order-row-col order-row-col--product">Product</span>
        <span class="order-row-col order-row-col--total">Total</span>
        <span class="order-row-col order-row-col--payment">Payment</span>
        <span class="order-row-col order-row-col--status">Status</span>
        <span class="order-row-col order-row-col--date">Date</span>
        <span class="order-row-col order-row-col--actions"></span>
      </div>`;

  const renderCards = (list) => list.map((order) => renderOrderCard(order, {
    expanded: String(order.orderId || order.id) === String(expandedId),
    viewMode: "all",
    selectedIds: selectedSet
  })).join("");

  if (!groupByDate) {
    return `
    <div class="orders-list-shell">
      ${listHead}
      <div class="orders-date-group__list">${renderCards(orders)}</div>
    </div>
  `;
  }

  const groups = groupOrdersByDate(orders, { newestFirst });
  if (!groups.length) return "";

  return `
    <div class="orders-list-shell">
      ${listHead}
      ${groups.map((group) => `
        <section class="orders-date-group" data-date-group="${escapeHtml(group.key)}" aria-labelledby="orders-group-${escapeHtml(group.key)}">
          <header class="orders-date-group__header">
            <div class="orders-date-group__heading">
              <h3 id="orders-group-${escapeHtml(group.key)}" class="orders-date-group__title">${escapeHtml(group.label)}</h3>
              <span class="orders-date-group__count">${group.count} order${group.count === 1 ? "" : "s"}</span>
            </div>
            <div class="orders-date-group__rule" aria-hidden="true"></div>
          </header>
          <div class="orders-date-group__list">
            ${renderCards(group.orders)}
          </div>
        </section>
      `).join("")}
    </div>
  `;
}

function renderAllOrdersBulkBar(selectedCount = 0, pageCount = 0, busy = false, pageSelectedCount = 0) {
  if (!selectedCount) return "";
  const disabled = busy ? "disabled" : "";
  const allOnPageSelected = pageCount > 0 && pageSelectedCount === pageCount;
  return `
    <div class="orders-bulk-bar" role="region" aria-label="Bulk order actions">
      <div class="orders-bulk-bar__copy">
        <strong>${selectedCount} selected</strong>
        <button type="button" class="orders-bulk-link" data-orders-bulk-action="clear-selection" ${disabled}>Clear</button>
        <button type="button" class="orders-bulk-link" data-orders-bulk-action="${allOnPageSelected ? "unselect-page" : "select-page"}" ${disabled}>
          ${allOnPageSelected ? "Unselect Page" : "Select Page"}
        </button>
      </div>
      <div class="orders-bulk-bar__actions">
        <label class="orders-bulk-status">
          <span class="sr-only">Bulk status</span>
          <select id="ordersBulkStatus" ${disabled}>
            <option value="">Change status…</option>
            ${STATUS_OPTIONS.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`).join("")}
          </select>
        </label>
        <button type="button" class="orders-tool-btn orders-tool-btn--primary" data-orders-bulk-action="apply-status" ${disabled}>Apply Status</button>
        <button type="button" class="orders-tool-btn" data-orders-bulk-action="print-invoices" ${disabled}>Print Invoices</button>
        <button type="button" class="orders-tool-btn" data-orders-bulk-action="print-packing" ${disabled}>Packing Slips</button>
        <button type="button" class="orders-tool-btn" data-orders-bulk-action="export-excel" ${disabled}>Export Excel</button>
        <button type="button" class="orders-tool-btn" data-orders-bulk-action="export-pdf" ${disabled}>Export PDF</button>
        <button type="button" class="orders-tool-btn orders-tool-btn--danger" data-orders-bulk-action="delete" ${disabled}>Delete</button>
      </div>
    </div>
  `;
}

function renderAllOrdersSkeleton() {
  return `
    <div class="orders-skeleton" aria-busy="true" aria-label="Loading orders">
      ${Array.from({ length: 5 }).map(() => `
        <div class="orders-skeleton-card">
          <div class="orders-skeleton-line orders-skeleton-line--check"></div>
          <div class="orders-skeleton-line orders-skeleton-line--media"></div>
          <div class="orders-skeleton-copy">
            <div class="orders-skeleton-line"></div>
            <div class="orders-skeleton-line orders-skeleton-line--short"></div>
          </div>
          <div class="orders-skeleton-copy orders-skeleton-copy--side">
            <div class="orders-skeleton-line orders-skeleton-line--mid"></div>
            <div class="orders-skeleton-line orders-skeleton-line--short"></div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderAllOrdersEmptyState({
  hasOrders = false,
  hasQuery = false,
  hasAttributeFilters = false,
  needsCustomRange = false,
  dateTab = "all",
  loadError = ""
} = {}) {
  if (loadError && !hasOrders) {
    return `
      <div class="orders-empty-state orders-empty-state--all orders-empty-state--smart">
        <h3>Something went wrong.</h3>
        <p>Please try again.</p>
        <button type="button" class="orders-tool-btn orders-tool-btn--primary" id="ordersRefreshBtn">Try again</button>
      </div>
    `;
  }
  if (!hasOrders) {
    return `
      <div class="orders-empty-state orders-empty-state--all orders-empty-state--smart">
        <h3>No orders yet</h3>
        <p>Orders will appear here when customers place orders.</p>
        <button type="button" class="orders-tool-btn orders-tool-btn--primary" id="ordersRefreshBtn">Refresh Orders</button>
      </div>
    `;
  }
  if (needsCustomRange) {
    return `
      <div class="orders-empty-state orders-empty-state--all orders-empty-state--smart">
        <h3>Select a custom date range</h3>
        <p>Choose a start date and end date, then click Apply to view matching orders.</p>
      </div>
    `;
  }
  const tab = normalizeDateTab(dateTab || "all");
  if (!hasQuery && !hasAttributeFilters && tab !== "all") {
    return `
      <div class="orders-empty-state orders-empty-state--all orders-empty-state--smart">
        <h3>No orders for this date</h3>
        <p>Try another date range, or clear filters to see all orders.</p>
        <button type="button" class="orders-tool-btn" data-orders-toolbar-action="clear-filters">Clear Filters</button>
      </div>
    `;
  }
  return `
    <div class="orders-empty-state orders-empty-state--all orders-empty-state--smart">
      <h3>No matching orders</h3>
      <p>Try changing your search or filters.</p>
      <button type="button" class="orders-tool-btn" data-orders-toolbar-action="clear-filters">Clear Filters</button>
    </div>
  `;
}

function renderOrderCard(order, { expanded = false, viewMode = "all", selectedIds = [] } = {}) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const paymentStatus = order?.paymentStatusLabel || order?.paymentStatus || "Pending";
  const completionDate = resolveCompletionDate(order);
  const cancellationDate = resolveCancellationDate(order);
  const workflow = getReturnWorkflow(order);
  const returnRequestDate = resolveReturnRequestDate(order);
  const returnLabel = formatReturnStatusLabel(workflow.returnStatus || order.returnStatus);
  const refundLabel = formatRefundStatusLabel(workflow.refundStatus || order.refundStatus || (order.refundRequired ? "required" : ""));

  if (viewMode === "all") {
    const orderId = order.orderId || order.id;
    const safeId = escapeHtml(orderId);
    const { orderNumber, internalId } = resolveOrderIdentifiers(order);
    const customer = resolveOrderCustomer(order);
    const grandTotal = formatCurrency(order.grandTotal || order.total || 0);
    const detailsId = `order-details-${safeId}`;
    const when = formatOrderRowDateTime(order.date || order.createdAt);
    const orderStatus = order.status || order.orderStatus || "Pending";
    const selected = selectedIds instanceof Set
      ? selectedIds.has(String(orderId))
      : (Array.isArray(selectedIds) ? selectedIds : []).map(String).includes(String(orderId));

    return `
      <article class="order-card-enterprise${expanded ? " is-expanded" : ""}${selected ? " is-selected" : ""}" data-order-id="${safeId}" aria-label="Order ${safeId}">
        <div class="order-row">
          <div class="order-row-col order-row-col--check">
            <label class="order-card-check">
              <input type="checkbox" data-order-select="${safeId}" ${selected ? "checked" : ""} aria-label="Select order ${safeId}" />
            </label>
          </div>
          <div class="order-row-col order-row-col--order">
            <strong class="order-row-number" title="${escapeHtml(orderNumber)}">#${escapeHtml(orderNumber)}</strong>
            ${internalId ? `<span class="order-row-id">ID: ${escapeHtml(internalId)}</span>` : ""}
          </div>
          <div class="order-row-col order-row-col--customer">
            <strong class="order-row-customer-name" title="${escapeHtml(customer.name)}">${escapeHtml(customer.name)}</strong>
            ${customer.phone ? `<span class="order-row-customer-phone" title="${escapeHtml(customer.phone)}">${escapeHtml(customer.phone)}</span>` : ""}
          </div>
          <div class="order-row-col order-row-col--product">
            ${renderAllOrdersProductStrip(items)}
          </div>
          <div class="order-row-col order-row-col--total">
            <strong class="order-row-total">${grandTotal}</strong>
          </div>
          <div class="order-row-col order-row-col--payment">
            ${renderOrderRowPayment(order)}
          </div>
          <div class="order-row-col order-row-col--status">
            ${renderOrderRowStatusBadge(orderStatus)}
          </div>
          <div class="order-row-col order-row-col--date">
            <time datetime="${escapeHtml(order.date || order.createdAt || "")}">
              <strong class="order-row-date">${escapeHtml(when.date)}</strong>
              ${when.time ? `<span class="order-row-time">${escapeHtml(when.time)}</span>` : ""}
            </time>
          </div>
          <div class="order-row-col order-row-col--actions">
            ${renderAllOrdersActions(order, expanded)}
          </div>
        </div>
        <div class="orders-order-details orders-order-details--all" id="${detailsId}" ${expanded ? "" : "hidden"}>
          ${expanded ? renderAllOrdersDetails(order) : ""}
        </div>
      </article>
    `;
  }

  return `
    <article class="order-mobile-card${expanded ? " is-expanded" : ""}" data-order-id="${escapeHtml(order.orderId || order.id)}">
      <div class="order-mobile-head">
        <div class="order-mobile-title">
          <h3>${escapeHtml(order.orderId || order.id)}</h3>
          <p>${formatDate(order.date)}${viewMode === "completed" && completionDate ? ` · Completed ${formatDate(completionDate)}` : ""}${viewMode === "cancelled" && cancellationDate ? ` · Cancelled ${formatDate(cancellationDate)}` : ""}${viewMode === "returns" && returnRequestDate ? ` · Return ${formatDate(returnRequestDate)}` : ""}</p>
        </div>
        ${badge(viewMode === "returns" ? refundLabel : String(order.status || "Pending"), statusTone(viewMode === "returns" ? refundLabel : order.status))}
      </div>
      <div class="order-mobile-meta">
        <div><span>Customer</span><strong>${escapeHtml(order.customerName)}</strong></div>
        <div><span>Phone</span><strong>${escapeHtml(order.customerPhone || "—")}</strong></div>
        <div><span>Payment</span><strong>${escapeHtml(paymentLabel(order))}</strong></div>
        <div><span>Payment status</span><strong>${escapeHtml(paymentStatus)}</strong></div>
        ${viewMode === "cancelled" ? `<div><span>Cancelled by</span><strong>${escapeHtml(resolveCancelledBy(order))}</strong></div>` : ""}
        ${viewMode === "returns" ? `<div><span>Return status</span><strong>${escapeHtml(returnLabel)}</strong></div>` : ""}
        ${viewMode === "returns" ? `<div><span>Refund status</span><strong>${escapeHtml(refundLabel)}</strong></div>` : ""}
        ${viewMode === "cancelled" || viewMode === "returns" ? "" : `<div><span>Delivery</span><strong>${escapeHtml(order.deliveryStatus || order.status || "—")}</strong></div>`}
        <div class="order-mobile-meta-total"><span>Grand Total</span><strong>${formatCurrency(order.total || 0)}</strong></div>
      </div>
      ${renderActions(order, viewMode)}
      ${viewMode === "pending" || viewMode === "completed" || viewMode === "cancelled" || viewMode === "returns" ? "" : renderStatusSelect(order)}
      <div class="orders-order-details" ${expanded ? "" : "hidden"}>
        ${renderCustomerBlock(order)}
        ${renderOrderInfoBlock(order, viewMode)}
        ${viewMode === "returns" ? renderReturnInfoBlock(order) : ""}
        ${viewMode === "completed" ? renderDeliveryBlock(order) : ""}
        ${viewMode === "cancelled" ? `
          <div class="orders-detail-card">
            <h4>Cancellation Details</h4>
            ${renderInfoGrid([
              ["Cancellation Date", cancellationDate ? formatDate(cancellationDate) : "—"],
              ["Cancelled By", resolveCancelledBy(order)],
              ["Cancellation Reason", resolveCancellationReason(order) || "—"],
              ["Refund Required", order.refundRequired ? "Yes — prepared for Returns & Refunds" : "No"]
            ])}
          </div>
        ` : ""}
        <div class="orders-detail-card">
          <h4>Payment Details</h4>
          ${renderInfoGrid([
            ["Method", paymentLabel(order)],
            ["Status", paymentStatus],
            ["Type", order.paymentType || (order.paymentMethod === "cod" ? "cod" : "pay_now")],
            ["Payer Phone", order.payerPhone || order.customerPhone],
            ["Note", order.paymentNote]
          ])}
          ${renderPaymentStatusActions(order)}
          ${renderGps(order)}
        </div>
        ${renderTimeline(order, viewMode)}
        <div class="orders-detail-card">
          <h4>Purchased Products</h4>
          ${items.length
            ? `<div class="orders-products-list">${items.map(renderProductCard).join("")}</div>`
            : `<p class="orders-empty-state">No products on this order.</p>`}
        </div>
        ${viewMode === "pending" ? renderStatusSelect(order) : ""}
      </div>
    </article>
  `;
}

function buildPrintRows(order) {
  const ship = order.shippingAddress || {};
  const full = order.fullAddress || {};
  return [
    ["Order", order.orderId || order.id],
    ["Date", formatDate(order.date)],
    ["Status", order.status],
    ["Customer", ship.fullName || order.customerName],
    ["Phone", ship.phone || order.customerPhone],
    ["Email", order.customerEmail || "—"],
    ["Address", [
      ship.provinceCity || full.province,
      ship.district || full.district,
      ship.sector || full.sector,
      ship.cell || full.cell,
      ship.village || full.village,
      ship.note || full.note
    ].filter(Boolean).join(", ")],
    ["Payment", `${paymentLabel(order)} · ${order.paymentStatusLabel || order.paymentStatus || "Pending"}`],
    ["Subtotal", formatCurrency(order.subtotal || 0)],
    ["Shipping", formatCurrency(order.deliveryFee || 0)],
    ["Total", formatCurrency(order.total || 0)]
  ];
}

function openOrderInvoice(order, { autoPrint = true } = {}) {
  const rows = buildPrintRows(order);
  const items = Array.isArray(order.items) ? order.items : [];
  return openPrintableReport(`Invoice ${order.orderId || order.id}`, [
    {
      title: "Order Summary",
      content: `<table><tbody>${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}</tbody></table>`
    },
    {
      title: "Products",
      content: `<table><thead><tr><th>Product</th><th>SKU</th><th>Variant</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead><tbody>${
        items.map((item) => `<tr>
          <td>${escapeHtml(item.productName)}</td>
          <td>${escapeHtml(item.sku || "—")}</td>
          <td>${escapeHtml(item.attributeSummary || [item.color, item.size].filter(Boolean).join(" · ") || "—")}</td>
          <td>${escapeHtml(item.quantity || 1)}</td>
          <td>${formatCurrency(item.price || 0)}</td>
          <td>${formatCurrency(item.lineTotal || ((Number(item.price) || 0) * (Number(item.quantity) || 1)))}</td>
        </tr>`).join("")
      }</tbody></table>`
    }
  ], { autoPrint });
}

function printInvoice(order) {
  return openOrderInvoice(order, { autoPrint: true });
}

function viewInvoice(order) {
  return openOrderInvoice(order, { autoPrint: false });
}

function printPackingSlip(order) {
  const ship = order.shippingAddress || {};
  const items = Array.isArray(order.items) ? order.items : [];
  openPrintableReport(`Packing Slip ${order.orderId || order.id}`, [
    {
      title: "Ship To",
      content: `<p><strong>${escapeHtml(ship.fullName || order.customerName)}</strong><br>${escapeHtml(ship.phone || order.customerPhone || "")}<br>${escapeHtml([
        ship.provinceCity,
        ship.district,
        ship.sector,
        ship.cell,
        ship.village,
        ship.note
      ].filter(Boolean).join(", "))}</p>`
    },
    {
      title: "Pack Contents",
      content: `<table><thead><tr><th>Product</th><th>SKU</th><th>Color</th><th>Size</th><th>Qty</th></tr></thead><tbody>${
        items.map((item) => `<tr>
          <td>${escapeHtml(item.productName)}</td>
          <td>${escapeHtml(item.sku || "—")}</td>
          <td>${escapeHtml(item.color || "—")}</td>
          <td>${escapeHtml(item.size || "—")}</td>
          <td>${escapeHtml(item.quantity || 1)}</td>
        </tr>`).join("")
      }</tbody></table>`
    }
  ]);
}

function printReceipt(order) {
  const rows = buildPrintRows(order);
  const completionDate = resolveCompletionDate(order);
  openPrintableReport(`Receipt ${order.orderId || order.id}`, [
    {
      title: "Payment Receipt",
      subtitle: completionDate ? `Completed ${formatDate(completionDate)}` : "Completed order receipt",
      content: `<table><tbody>${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}</tbody></table>
        <p><strong>Amount paid / due:</strong> ${formatCurrency(order.total || 0)}</p>
        <p><strong>Payment:</strong> ${escapeHtml(paymentLabel(order))} · ${escapeHtml(order.paymentStatusLabel || order.paymentStatus || "Pending")}</p>`
    }
  ]);
}

function downloadInvoicePdf(order) {
  // Opens the printable invoice so the browser can Save as PDF — no extra PDF dependency.
  printInvoice(order);
}

function showCustomerDetails(order) {
  const ship = order.shippingAddress || {};
  void openOrdersInfoDialog({
    title: `Customer · ${order.orderId || order.id || ""}`,
    lines: [
      ["Customer", ship.fullName || order.customerName || "—"],
      ["Phone", ship.phone || order.customerPhone || "—"],
      ["Email", order.customerEmail || "—"],
      ["Province/City", ship.provinceCity || order.fullAddress?.province || "—"],
      ["District", ship.district || order.fullAddress?.district || "—"],
      ["Sector", ship.sector || order.fullAddress?.sector || "—"],
      ["Cell", ship.cell || order.fullAddress?.cell || "—"],
      ["Village", ship.village || order.fullAddress?.village || "—"],
      ["Landmark", ship.note || order.fullAddress?.note || "—"]
    ]
  });
}

function showDeliveryDetails(order) {
  const ship = order.shippingAddress || {};
  const completionDate = resolveCompletionDate(order);
  void openOrdersInfoDialog({
    title: `Delivery · ${order.orderId || order.id || ""}`,
    lines: [
      ["Order", order.orderId || order.id || "—"],
      ["Delivery status", order.deliveryStatus || order.status || "—"],
      ["Shipping method", order.deliveryLabel || order.deliveryMethod || "Home delivery"],
      ["Completed", completionDate ? formatDate(completionDate) : "—"],
      ["Address", [
        ship.provinceCity,
        ship.district,
        ship.sector,
        ship.cell,
        ship.village,
        ship.note
      ].filter(Boolean).join(", ") || "—"],
      ["Maps", resolveMapLink(order) || "—"]
    ]
  });
}

function showCancellationReason(order) {
  void openOrdersInfoDialog({
    title: `Cancellation · ${order.orderId || order.id || ""}`,
    lines: [
      ["Order", order.orderId || order.id || "—"],
      ["Cancelled by", resolveCancelledBy(order)],
      ["Cancellation date", resolveCancellationDate(order) ? formatDate(resolveCancellationDate(order)) : "—"],
      ["Reason", resolveCancellationReason(order) || "No reason recorded."],
      ["Refund required", order.refundRequired ? "Yes" : "No"]
    ]
  });
}

function printOrderSummary(order) {
  const rows = buildPrintRows(order);
  const cancellationDate = resolveCancellationDate(order);
  openPrintableReport(`Order Summary ${order.orderId || order.id}`, [
    {
      title: "Cancelled Order Summary",
      subtitle: cancellationDate ? `Cancelled ${formatDate(cancellationDate)}` : "Cancelled order record",
      content: `<table><tbody>
        ${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}
        <tr><th>Cancelled By</th><td>${escapeHtml(resolveCancelledBy(order))}</td></tr>
        <tr><th>Cancellation Reason</th><td>${escapeHtml(resolveCancellationReason(order) || "—")}</td></tr>
        <tr><th>Refund Required</th><td>${order.refundRequired ? "Yes" : "No"}</td></tr>
      </tbody></table>`
    },
    {
      title: "Products",
      content: `<table><thead><tr><th>Product</th><th>SKU</th><th>Qty</th><th>Total</th></tr></thead><tbody>${
        (order.items || []).map((item) => `<tr>
          <td>${escapeHtml(item.productName)}</td>
          <td>${escapeHtml(item.sku || "—")}</td>
          <td>${escapeHtml(item.quantity || 1)}</td>
          <td>${formatCurrency(item.lineTotal || ((Number(item.price) || 0) * (Number(item.quantity) || 1)))}</td>
        </tr>`).join("")
      }</tbody></table>`
    }
  ]);
}

function printReturnReport(order) {
  const workflow = getReturnWorkflow(order);
  const rows = buildPrintRows(order);
  openPrintableReport(`Return Report ${order.orderId || order.id}`, [
    {
      title: "Return Report",
      subtitle: resolveReturnRequestDate(order) ? `Requested ${formatDate(resolveReturnRequestDate(order))}` : "Return record",
      content: `<table><tbody>
        ${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}
        <tr><th>Return Reason</th><td>${escapeHtml(workflow.returnReason || resolveCancellationReason(order) || "—")}</td></tr>
        <tr><th>Customer Notes</th><td>${escapeHtml(workflow.customerNotes || "—")}</td></tr>
        <tr><th>Admin Notes</th><td>${escapeHtml(workflow.adminNotes || "—")}</td></tr>
        <tr><th>Product Condition</th><td>${escapeHtml(workflow.productCondition || "—")}</td></tr>
        <tr><th>Return Status</th><td>${escapeHtml(formatReturnStatusLabel(workflow.returnStatus))}</td></tr>
        <tr><th>Refund Status</th><td>${escapeHtml(formatRefundStatusLabel(workflow.refundStatus || (order.refundRequired ? "required" : "")))}</td></tr>
      </tbody></table>`
    },
    {
      title: "Products",
      content: `<table><thead><tr><th>Product</th><th>SKU</th><th>Variant</th><th>Qty</th><th>Total</th></tr></thead><tbody>${
        (order.items || []).map((item) => `<tr>
          <td>${escapeHtml(item.productName)}</td>
          <td>${escapeHtml(item.sku || "—")}</td>
          <td>${escapeHtml(item.attributeSummary || [item.color, item.size].filter(Boolean).join(" · ") || "—")}</td>
          <td>${escapeHtml(item.quantity || 1)}</td>
          <td>${formatCurrency(item.lineTotal || ((Number(item.price) || 0) * (Number(item.quantity) || 1)))}</td>
        </tr>`).join("")
      }</tbody></table>`
    }
  ]);
}

function printRefundReport(order) {
  const workflow = getReturnWorkflow(order);
  const rows = buildPrintRows(order);
  const amount = Number(workflow.refundAmount || order.refundAmount || order.total || 0);
  openPrintableReport(`Refund Report ${order.orderId || order.id}`, [
    {
      title: "Refund Report",
      subtitle: resolveRefundDate(order) ? `Refunded ${formatDate(resolveRefundDate(order))}` : "Refund record",
      content: `<table><tbody>
        ${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}
        <tr><th>Refund Status</th><td>${escapeHtml(formatRefundStatusLabel(workflow.refundStatus || order.paymentStatus))}</td></tr>
        <tr><th>Refund Amount</th><td>${escapeHtml(formatCurrency(amount))}</td></tr>
        <tr><th>Refund Method</th><td>${escapeHtml(workflow.refundMethod || paymentLabel(order))}</td></tr>
        <tr><th>Refund Date</th><td>${escapeHtml(resolveRefundDate(order) ? formatDate(resolveRefundDate(order)) : "—")}</td></tr>
        <tr><th>Admin Notes</th><td>${escapeHtml(workflow.adminNotes || "—")}</td></tr>
      </tbody></table>`
    }
  ]);
}

function showPaymentAlert(order) {
  void openOrdersInfoDialog({
    title: `Payment · ${order.orderId || order.id || ""}`,
    lines: [
      ["Order", order.orderId || order.id || "—"],
      ["Method", paymentLabel(order)],
      ["Status", order.paymentStatusLabel || order.paymentStatus || "Pending"],
      ["Type", order.paymentType || "—"],
      ["Payer phone", order.payerPhone || order.customerPhone || "—"],
      ["Transaction", resolveTransactionReference(order)],
      ["Note", order.paymentNote || "—"],
      ["Grand total", formatCurrency(order.total || 0)]
    ]
  });
}

let unsubscribeLive = null;
let ordersPageApi = null;

export async function renderOrders(container, options = {}) {
  // Soft refresh: reload data in place without wiping search/filters/expanded state.
  if (options?.softRefresh && ordersPageApi?.reload && container?.dataset?.ordersMounted === "1") {
    await ordersPageApi.reload({ force: true });
    return;
  }

  if (typeof unsubscribeLive === "function") {
    unsubscribeLive();
    unsubscribeLive = null;
  }
  if (container?._ordersKeydown) {
    document.removeEventListener("keydown", container._ordersKeydown);
    container._ordersKeydown = null;
  }
  if (container?._ordersHashChange) {
    window.removeEventListener("hashchange", container._ordersHashChange);
    container._ordersHashChange = null;
  }
  container?._ordersStickyObserver?.disconnect?.();
  container._ordersStickyObserver = null;
  closeOrdersUxDialog(false);
  closeReviewDrawer({ restoreFocus: false });
  reviewDrawer.resolveOrder = null;
  reviewDrawer.reloadAndResolve = null;
  reviewDrawer.handleAction = null;
  reviewDrawer.busy = false;
  ordersPageApi = null;

  const hashQuery = readHashQuery();
  const queueStatus = String(hashQuery.get("status") || "").trim().toLowerCase();
  const queueModes = new Set(["pending", "completed", "cancelled", "returns"]);
  const storedFilters = queueModes.has(queueStatus) ? null : readStoredListFilters();
  const todayInput = formatLocalDateInput(new Date());
  const monthStartInput = formatLocalDateInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const state = {
    query: storedFilters?.query || "",
    statusFilter: hashQuery.get("status") || storedFilters?.statusFilter || "",
    paymentFilter: storedFilters?.paymentFilter || "",
    paymentStatusFilter: storedFilters?.paymentStatusFilter || "",
    deliveryStatusFilter: storedFilters?.deliveryStatusFilter || "",
    dateRangeFilter: "",
    dateTab: normalizeDateTab(storedFilters?.dateTab || "all"),
    customFrom: storedFilters?.customFrom || "",
    customTo: storedFilters?.customTo || "",
    customDraftFrom: storedFilters?.customDraftFrom || storedFilters?.customFrom || monthStartInput,
    customDraftTo: storedFilters?.customDraftTo || storedFilters?.customTo || todayInput,
    statBucket: storedFilters?.statBucket || "",
    sort: hashQuery.get("status") === "completed"
      ? "completed-desc"
      : hashQuery.get("status") === "cancelled"
        ? "cancelled-desc"
        : hashQuery.get("status") === "returns"
          ? "return-desc"
          : (storedFilters?.sort || "date-desc"),
    cancelledByFilter: "",
    returnStatusFilter: "",
    refundStatusFilter: "",
    page: Number(storedFilters?.page) > 0 ? Number(storedFilters.page) : 1,
    pageSize: resolvePageSize({ pageSize: storedFilters?.pageSize || PAGE_SIZE }),
    expandedId: "",
    selectedIds: [],
    bulkBusy: false,
    allOrders: [],
    loading: false,
    notice: null,
    busyOrderId: "",
    loadError: "",
    stickyActive: false,
    orderIndex: null,
    filtersOpen: Boolean(storedFilters?.filtersOpen)
  };

  function findOrder(orderId) {
    if (!state.orderIndex) {
      state.orderIndex = new Map();
      state.allOrders.forEach((order) => {
        state.orderIndex.set(String(order.orderId || order.id), order);
      });
    }
    return state.orderIndex.get(String(orderId));
  }

  function invalidateOrderIndex() {
    state.orderIndex = null;
  }

  function setNotice(message, tone = "success") {
    window.clearTimeout(ordersNoticeTimer);
    const noticeAt = Date.now();
    state.notice = message ? { message, tone, at: noticeAt } : null;
    syncNoticeUi();
    if (!message) return;
    if (tone === "danger") return;
    ordersNoticeTimer = window.setTimeout(() => {
      if (!state.notice || state.notice.at !== noticeAt) return;
      state.notice = null;
      if (!syncNoticeUi()) paintFromState();
    }, tone === "warn" ? 5200 : 3600);
  }

  function renderNotice() {
    if (!state.notice?.message) return "";
    const tone = state.notice.tone || "neutral";
    return `
      <div class="orders-status-message orders-status-message--${escapeHtml(tone)} orders-toast" role="status" aria-live="polite">
        <span class="orders-toast__text">${escapeHtml(state.notice.message)}</span>
        <button type="button" class="orders-toast__dismiss" data-orders-notice-dismiss aria-label="Dismiss notification">×</button>
      </div>
    `;
  }

  function pageSize() {
    return resolvePageSize(state);
  }

  function getAllOrdersPageContext() {
    const filtered = filterAndSortOrders(state.allOrders, state);
    const size = pageSize();
    const totalPages = Math.max(1, Math.ceil(filtered.length / size));
    if (state.page > totalPages) state.page = totalPages;
    const startIdx = (state.page - 1) * size;
    const pageItems = filtered.slice(startIdx, startIdx + size);
    const pageIds = pageItems.map((order) => String(order.orderId || order.id));
    const knownIds = new Set(state.allOrders.map((order) => String(order.orderId || order.id)));
    state.selectedIds = state.selectedIds.filter((id) => knownIds.has(String(id)));
    const selectedSet = new Set(state.selectedIds.map(String));
    const selectedOnPage = pageIds.filter((id) => selectedSet.has(id));
    return { filtered, size, totalPages, pageItems, pageIds, selectedSet, selectedOnPage };
  }

  function syncNoticeUi() {
    const slot = container.querySelector("[data-orders-notice-slot]");
    if (!slot) return false;
    slot.innerHTML = renderNotice();
    return true;
  }

  function syncSelectionUi() {
    if (getOrdersViewMeta(state.statusFilter).mode !== "all") return false;
    if (!container.querySelector(".orders-page--all")) return false;
    const { pageIds, selectedSet, selectedOnPage } = getAllOrdersPageContext();

    container.querySelectorAll(".order-card-enterprise[data-order-id]").forEach((card) => {
      const id = String(card.getAttribute("data-order-id") || "");
      const selected = selectedSet.has(id);
      card.classList.toggle("is-selected", selected);
      const checkbox = card.querySelector("input[data-order-select]");
      if (checkbox && checkbox.checked !== selected) checkbox.checked = selected;
    });

    const selectAll = container.querySelector("#ordersSelectAllPage");
    if (selectAll) {
      selectAll.checked = pageIds.length > 0 && selectedOnPage.length === pageIds.length;
      selectAll.indeterminate = selectedOnPage.length > 0 && selectedOnPage.length < pageIds.length;
    }

    const bulkSlot = container.querySelector("[data-orders-bulk-slot]");
    if (bulkSlot) {
      bulkSlot.innerHTML = renderAllOrdersBulkBar(
        state.selectedIds.length,
        pageIds.length,
        state.bulkBusy,
        selectedOnPage.length
      );
    }
    return true;
  }

  function bindStickyShell() {
    const stack = container.querySelector(".orders-sticky-stack");
    const sentinel = container.querySelector(".orders-sticky-sentinel");
    if (!stack || !sentinel || typeof IntersectionObserver !== "function") return;
    container._ordersStickyObserver?.disconnect?.();
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      const stuck = Boolean(entry && !entry.isIntersecting);
      stack.classList.toggle("is-stuck", stuck);
      state.stickyActive = stuck;
    }, { threshold: 0, rootMargin: "-1px 0px 0px 0px" });
    observer.observe(sentinel);
    container._ordersStickyObserver = observer;
  }

  function markFreshCards() {
    const grid = container.querySelector(".orders-mobile-grid--all");
    if (!grid) return;
    grid.classList.add("is-fresh");
    window.setTimeout(() => grid.classList.remove("is-fresh"), 280);
  }

  function jumpToOrderSection(orderId, sectionKey) {
    const section = String(sectionKey || "").trim();
    if (!orderId || !section) return;
    const needsExpand = String(state.expandedId) !== String(orderId);
    if (needsExpand) {
      state.expandedId = String(orderId);
      paintFromState();
    }
    window.requestAnimationFrame(() => {
      const card = Array.from(container.querySelectorAll(".order-card-enterprise"))
        .find((el) => String(el.getAttribute("data-order-id")) === String(orderId));
      const target = Array.from(container.querySelectorAll(`[data-order-section="${section}"]`))
        .find((el) => String(el.getAttribute("data-order-section-for")) === String(orderId));
      if (needsExpand && card) {
        card.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (target) {
        target.classList.add("is-section-focus");
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        window.setTimeout(() => target.classList.remove("is-section-focus"), 1400);
      }
    });
  }

  function renderToolbar(filteredCount, totalCount) {
    const meta = getOrdersViewMeta(state.statusFilter);
    const lockFilter = meta.mode !== "all";
    const isAllOrders = meta.mode === "all";
    const countLabel = state.loading ? "Loading orders..." : `${filteredCount} shown · ${totalCount} loaded`;

    if (isAllOrders) {
      const stats = computeAllOrdersStats(state.allOrders);
      const dateCounts = computeDateTabCounts(state.allOrders, state);
      const disabled = state.loading ? "disabled" : "";
      const activeBucket = String(state.statBucket || "");
      const activeDateTab = normalizeDateTab(state.dateTab || "all");
      const chips = buildActiveFilterChips(state);
      const hasFilters = hasActiveListFilters(state);
      const todayMax = formatLocalDateInput(new Date());
      const statCards = [
        { key: "", label: "Total", count: stats.total, icon: "#", tone: "neutral" },
        { key: "pending", label: "Pending", count: stats.pending, icon: "P", tone: "warn" },
        { key: "processing", label: "Processing", count: stats.processing, icon: "R", tone: "info" },
        { key: "shipped", label: "Shipped", count: stats.shipped, icon: "S", tone: "info" },
        { key: "delivered", label: "Delivered", count: stats.delivered, icon: "D", tone: "success" },
        { key: "cancelled", label: "Cancelled", count: stats.cancelled, icon: "C", tone: "danger" }
      ];
      const dateTabs = DATE_TABS.map((tab) => ({
        ...tab,
        count: tab.key === "custom"
          ? (state.customFrom && state.customTo ? dateCounts.custom : null)
          : dateCounts[tab.key]
      }));

      return `
      <section class="orders-toolbar-panel glass-panel orders-toolbar-panel--all" aria-label="All Orders controls">
        <div class="orders-toolbar-header-all">
          <div class="orders-toolbar-copy orders-toolbar-copy--all">
            <h2>${escapeHtml(meta.title)} <span class="orders-toolbar-count">${escapeHtml(state.loading ? "…" : formatCount(filteredCount))}</span></h2>
          </div>
          <div class="orders-toolbar-top-actions" role="toolbar" aria-label="Order actions">
            <label class="orders-select-all">
              <input type="checkbox" id="ordersSelectAllPage" ${disabled} />
              <span>Select page</span>
            </label>
            <button type="button" class="orders-tool-btn orders-tool-btn--primary" id="ordersRefreshBtn" ${disabled}>${state.loading ? "Refreshing…" : "Refresh"}</button>
            <button type="button" class="orders-tool-btn" data-orders-toolbar-action="export" ${disabled || !filteredCount ? "disabled" : ""}>Export</button>
            <button type="button" class="orders-tool-btn" data-orders-toolbar-action="print" ${disabled || !filteredCount ? "disabled" : ""}>Print</button>
            <details class="orders-tool-more">
              <summary class="orders-tool-btn" aria-label="More toolbar actions">More</summary>
              <div class="orders-tool-more-menu" role="menu">
                <button type="button" role="menuitem" data-orders-toolbar-action="clear-filters">Clear Filters</button>
                <button type="button" role="menuitem" data-orders-toolbar-action="collapse-all">Collapse Details</button>
                <a role="menuitem" href="#/orders?status=pending">Open Pending Queue</a>
                <a role="menuitem" href="#/orders?status=completed">Open Completed</a>
                <a role="menuitem" href="#/orders?status=cancelled">Open Cancelled</a>
                <a role="menuitem" href="#/orders?status=returns">Open Returns &amp; Refunds</a>
              </div>
            </details>
          </div>
        </div>

        <div class="orders-stats-strip" role="group" aria-label="Order status summary">
          ${statCards.map((card) => {
            const active = activeBucket === card.key;
            return `
              <button type="button" class="orders-stat-chip orders-stat-chip--${escapeHtml(card.tone)}${active ? " is-active" : ""}" data-orders-stat="${escapeHtml(card.key)}" aria-pressed="${active ? "true" : "false"}" ${disabled}>
                <span class="orders-stat-chip__icon" aria-hidden="true">${card.icon}</span>
                <span class="orders-stat-chip__copy">
                  <span class="orders-stat-chip__label">${escapeHtml(card.label)}</span>
                  <strong class="orders-stat-chip__count">${escapeHtml(formatCount(card.count))}</strong>
                </span>
              </button>
            `;
          }).join("")}
        </div>

        <div class="orders-date-tabs" role="tablist" aria-label="Filter orders by date">
          ${dateTabs.map((tab) => {
            const active = activeDateTab === tab.key;
            const countLabelText = tab.count == null ? "" : formatCount(tab.count);
            return `
              <button type="button" role="tab" class="orders-date-tab${active ? " is-active" : ""}" data-orders-date-tab="${escapeHtml(tab.key)}" aria-selected="${active ? "true" : "false"}" ${disabled}>
                <span class="orders-date-tab__label">${escapeHtml(DATE_TAB_SHORT[tab.key] || tab.label)}</span>
                ${countLabelText ? `<span class="orders-date-tab__count">${escapeHtml(countLabelText)}</span>` : ""}
              </button>
            `;
          }).join("")}
        </div>

        ${activeDateTab === "custom" ? `
          <div class="orders-custom-range" role="group" aria-label="Custom date range">
            <label class="orders-custom-range__field">
              <span>From</span>
              <input type="date" id="ordersCustomFrom" max="${escapeHtml(todayMax)}" value="${escapeHtml(state.customDraftFrom || state.customFrom || "")}" ${disabled} />
            </label>
            <label class="orders-custom-range__field">
              <span>To</span>
              <input type="date" id="ordersCustomTo" max="${escapeHtml(todayMax)}" value="${escapeHtml(state.customDraftTo || state.customTo || "")}" ${disabled} />
            </label>
            <button type="button" class="orders-tool-btn orders-tool-btn--primary" data-orders-toolbar-action="apply-custom-range" ${disabled}>Apply</button>
            <button type="button" class="orders-tool-btn" data-orders-toolbar-action="clear-custom-range" ${disabled}>Clear range</button>
            ${state.customFrom && state.customTo ? `<p class="orders-custom-range__applied">${escapeHtml(formatReadableDate(state.customFrom))} – ${escapeHtml(formatReadableDate(state.customTo))}</p>` : ""}
          </div>
        ` : ""}

        <div data-orders-notice-slot>${renderNotice()}</div>

        <div class="orders-toolbar-controls">
          <div class="orders-search-row">
            <label class="orders-search-field orders-search-field--all" for="ordersSearch">
              <span class="sr-only">Search orders</span>
              <span aria-hidden="true">⌕</span>
              <input type="search" id="ordersSearch" placeholder="Search Orders..." value="${escapeHtml(state.query)}" autocomplete="off" ${disabled} />
            </label>
            <div class="orders-search-row__tools">
              <button type="button" class="orders-tool-btn orders-filters-toggle${state.filtersOpen ? " is-open" : ""}" data-orders-toolbar-action="toggle-filters" aria-expanded="${state.filtersOpen ? "true" : "false"}" aria-controls="ordersFilterPanel" ${disabled}>Filter</button>
              <select id="ordersSort" class="input orders-filter-control orders-sort-control" aria-label="Sort orders" ${disabled}>
                <option value="date-desc" ${state.sort === "date-desc" ? "selected" : ""}>Newest First</option>
                <option value="date-asc" ${state.sort === "date-asc" ? "selected" : ""}>Oldest First</option>
                <option value="total-desc" ${state.sort === "total-desc" ? "selected" : ""}>Highest Total</option>
                <option value="total-asc" ${state.sort === "total-asc" ? "selected" : ""}>Lowest Total</option>
                <option value="customer-asc" ${state.sort === "customer-asc" ? "selected" : ""}>Customer Name A–Z</option>
                <option value="customer-desc" ${state.sort === "customer-desc" ? "selected" : ""}>Customer Name Z–A</option>
                <option value="status" ${state.sort === "status" ? "selected" : ""}>Status</option>
              </select>
            </div>
          </div>

          <div id="ordersFilterPanel" class="orders-toolbar-filters orders-toolbar-filters--all${state.filtersOpen ? " is-open" : ""}">
            <select id="ordersStatusFilter" class="input orders-filter-control" aria-label="Filter by order status" ${disabled}>
              <option value="" ${!state.statusFilter ? "selected" : ""}>Order Status</option>
              ${STATUS_OPTIONS.map((status) => {
                const value = `status:${status.toLowerCase()}`;
                return `<option value="${escapeHtml(value)}" ${state.statusFilter === value ? "selected" : ""}>${escapeHtml(status)}</option>`;
              }).join("")}
            </select>
            <select id="ordersPaymentStatusFilter" class="input orders-filter-control" aria-label="Filter by payment status" ${disabled}>
              <option value="" ${!state.paymentStatusFilter ? "selected" : ""}>Payment Status</option>
              ${PAYMENT_STATUS_FILTERS.map((item) => (
                `<option value="${escapeHtml(item.value)}" ${state.paymentStatusFilter === item.value ? "selected" : ""}>${escapeHtml(item.label)}</option>`
              )).join("")}
            </select>
            <select id="ordersPaymentFilter" class="input orders-filter-control" aria-label="Filter by payment method" ${disabled}>
              <option value="" ${!state.paymentFilter ? "selected" : ""}>Payment Method</option>
              ${PAYMENT_METHOD_FILTERS.map((item) => (
                `<option value="${escapeHtml(item.value)}" ${state.paymentFilter === item.value ? "selected" : ""}>${escapeHtml(item.label)}</option>`
              )).join("")}
            </select>
            <select id="ordersDeliveryFilter" class="input orders-filter-control" aria-label="Filter by delivery status" ${disabled}>
              <option value="" ${!state.deliveryStatusFilter ? "selected" : ""}>Delivery Status</option>
              ${DELIVERY_STATUS_FILTERS.map((item) => (
                `<option value="${escapeHtml(item.value)}" ${state.deliveryStatusFilter === item.value ? "selected" : ""}>${escapeHtml(item.label)}</option>`
              )).join("")}
            </select>
            <button type="button" class="orders-tool-btn orders-clear-filters" data-orders-toolbar-action="clear-filters" ${disabled || !hasFilters ? "disabled" : ""}>Clear Filters</button>
          </div>
        </div>

        ${chips.length ? `
          <div class="orders-active-filters" aria-label="Active filters">
            <div class="orders-active-filters__chips">
              ${chips.map((chip) => `<span class="orders-filter-chip">${escapeHtml(chip.label)}</span>`).join("")}
            </div>
          </div>
        ` : ""}
      </section>
    `;
    }

    return `
      <section class="orders-toolbar-panel glass-panel">
        <div class="orders-toolbar-copy">
          <p class="dashboard-eyebrow">${escapeHtml(meta.eyebrow)}</p>
          <h2>${escapeHtml(meta.title)}</h2>
          <p>${escapeHtml(meta.description)}</p>
        </div>
        ${renderNotice()}
        <div class="orders-toolbar-actions">
          <label class="orders-search-field">
            <span aria-hidden="true">⌕</span>
            <input type="search" id="ordersSearch" placeholder="Search order, customer, phone, product, SKU" value="${escapeHtml(state.query)}" ${state.loading ? "disabled" : ""} />
          </label>
          <select id="ordersStatusFilter" class="input" aria-label="Filter by status" ${lockFilter ? "disabled" : ""}>
            <option value="" ${!state.statusFilter ? "selected" : ""}>All statuses</option>
            <option value="pending" ${state.statusFilter === "pending" ? "selected" : ""}>Pending queue</option>
            <option value="completed" ${state.statusFilter === "completed" ? "selected" : ""}>Completed</option>
            <option value="cancelled" ${state.statusFilter === "cancelled" ? "selected" : ""}>Cancelled</option>
            <option value="returns" ${state.statusFilter === "returns" ? "selected" : ""}>Returns &amp; refunds</option>
            ${STATUS_OPTIONS.map((status) => {
              const value = `status:${status.toLowerCase()}`;
              return `<option value="${escapeHtml(value)}" ${state.statusFilter === value ? "selected" : ""}>${escapeHtml(status)} only</option>`;
            }).join("")}
          </select>
          <select id="ordersSort" class="input" aria-label="Sort orders" ${state.loading ? "disabled" : ""}>
            <option value="date-desc" ${state.sort === "date-desc" ? "selected" : ""}>Newest first</option>
            <option value="date-asc" ${state.sort === "date-asc" ? "selected" : ""}>Oldest first</option>
            ${meta.mode === "completed" ? `
              <option value="completed-desc" ${state.sort === "completed-desc" ? "selected" : ""}>Newest completion</option>
              <option value="completed-asc" ${state.sort === "completed-asc" ? "selected" : ""}>Oldest completion</option>
            ` : ""}
            ${meta.mode === "cancelled" ? `
              <option value="cancelled-desc" ${state.sort === "cancelled-desc" ? "selected" : ""}>Newest cancellation</option>
              <option value="cancelled-asc" ${state.sort === "cancelled-asc" ? "selected" : ""}>Oldest cancellation</option>
            ` : ""}
            ${meta.mode === "returns" ? `
              <option value="return-desc" ${state.sort === "return-desc" ? "selected" : ""}>Newest return request</option>
              <option value="return-asc" ${state.sort === "return-asc" ? "selected" : ""}>Oldest return request</option>
            ` : ""}
            <option value="total-desc" ${state.sort === "total-desc" ? "selected" : ""}>Highest total</option>
            <option value="total-asc" ${state.sort === "total-asc" ? "selected" : ""}>Lowest total</option>
            <option value="status" ${state.sort === "status" ? "selected" : ""}>Status</option>
          </select>
          ${meta.mode === "completed" || meta.mode === "cancelled" || meta.mode === "returns" ? `
            <select id="ordersPaymentFilter" class="input" aria-label="Filter by payment method" ${state.loading ? "disabled" : ""}>
              <option value="" ${!state.paymentFilter ? "selected" : ""}>All payment methods</option>
              <option value="mtn" ${state.paymentFilter === "mtn" ? "selected" : ""}>MTN MoMo</option>
              <option value="card" ${state.paymentFilter === "card" ? "selected" : ""}>Card</option>
              <option value="cod" ${state.paymentFilter === "cod" ? "selected" : ""}>Cash on Delivery</option>
            </select>
          ` : ""}
          ${meta.mode === "returns" ? `
            <select id="ordersReturnStatusFilter" class="input" aria-label="Filter by return status" ${state.loading ? "disabled" : ""}>
              <option value="" ${!state.returnStatusFilter ? "selected" : ""}>All return statuses</option>
              <option value="requested" ${state.returnStatusFilter === "requested" ? "selected" : ""}>Requested</option>
              <option value="approved" ${state.returnStatusFilter === "approved" ? "selected" : ""}>Approved</option>
              <option value="rejected" ${state.returnStatusFilter === "rejected" ? "selected" : ""}>Rejected</option>
            </select>
            <select id="ordersRefundStatusFilter" class="input" aria-label="Filter by refund status" ${state.loading ? "disabled" : ""}>
              <option value="" ${!state.refundStatusFilter ? "selected" : ""}>All refund statuses</option>
              <option value="required" ${state.refundStatusFilter === "required" ? "selected" : ""}>Required</option>
              <option value="completed" ${state.refundStatusFilter === "completed" ? "selected" : ""}>Completed</option>
              <option value="rejected" ${state.refundStatusFilter === "rejected" ? "selected" : ""}>Rejected</option>
            </select>
          ` : ""}
          ${meta.mode === "cancelled" ? `
            <select id="ordersCancelledByFilter" class="input" aria-label="Filter by cancelled by" ${state.loading ? "disabled" : ""}>
              <option value="" ${!state.cancelledByFilter ? "selected" : ""}>Cancelled by anyone</option>
              <option value="admin" ${state.cancelledByFilter === "admin" ? "selected" : ""}>Admin</option>
              <option value="customer" ${state.cancelledByFilter === "customer" ? "selected" : ""}>Customer</option>
            </select>
          ` : ""}
          <button type="button" class="btn btn-primary" id="ordersRefreshBtn" ${state.loading ? "disabled" : ""}>${state.loading ? "Refreshing..." : "Refresh"}</button>
        </div>
        <div class="orders-hero-status-row">
          <span>${escapeHtml(countLabel)}</span>
          ${meta.mode === "pending" || meta.mode === "completed" || meta.mode === "cancelled" || meta.mode === "returns" ? `<a class="orders-inline-link" href="#/orders">Open All Orders</a>` : ""}
        </div>
      </section>
    `;
  }

  function renderPagination(totalPages, filteredCount = 0) {
    const meta = getOrdersViewMeta(state.statusFilter);
    if (meta.mode !== "all") {
      if (totalPages <= 1) return "";
      return `
        <div class="orders-pagination">
          <button type="button" class="orders-secondary-link" data-page-action="prev" ${state.page <= 1 || state.loading ? "disabled" : ""}>Previous</button>
          <span>Page ${state.page} of ${totalPages}</span>
          <button type="button" class="orders-secondary-link" data-page-action="next" ${state.page >= totalPages || state.loading ? "disabled" : ""}>Next</button>
        </div>
      `;
    }

    const size = pageSize();
    const start = filteredCount ? ((state.page - 1) * size) + 1 : 0;
    const end = Math.min(state.page * size, filteredCount);
    const pages = buildPaginationPages(state.page, totalPages);
    const disabled = state.loading ? "disabled" : "";

    return `
      <div class="orders-pagination orders-pagination--enterprise" role="navigation" aria-label="Orders pagination">
        <div class="orders-pagination__meta">
          <span>Showing <strong>${start}</strong>–<strong>${end}</strong> of <strong>${filteredCount}</strong></span>
        </div>
        <div class="orders-pagination__controls">
          <button type="button" class="orders-page-btn" data-page-action="first" aria-label="First page" ${state.page <= 1 || state.loading ? "disabled" : ""}>First</button>
          <button type="button" class="orders-page-btn" data-page-action="prev" aria-label="Previous page" ${state.page <= 1 || state.loading ? "disabled" : ""}>Prev</button>
          ${pages.map((page) => {
            if (page === "ellipsis") {
              return `<span class="orders-page-ellipsis" aria-hidden="true">…</span>`;
            }
            const active = Number(page) === Number(state.page);
            return `<button type="button" class="orders-page-btn${active ? " is-active" : ""}" data-page-action="goto" data-page="${page}" aria-label="Page ${page}" aria-current="${active ? "page" : "false"}" ${disabled}>${page}</button>`;
          }).join("")}
          <button type="button" class="orders-page-btn" data-page-action="next" aria-label="Next page" ${state.page >= totalPages || state.loading ? "disabled" : ""}>Next</button>
          <button type="button" class="orders-page-btn" data-page-action="last" aria-label="Last page" ${state.page >= totalPages || state.loading ? "disabled" : ""}>Last</button>
        </div>
        <label class="orders-pagination__size">
          <span>Per page</span>
          <select id="ordersPageSize" aria-label="Orders per page" ${disabled}>
            ${PAGE_SIZE_OPTIONS.map((option) => (
              `<option value="${option}" ${size === option ? "selected" : ""}>${option}</option>`
            )).join("")}
          </select>
        </label>
      </div>
    `;
  }

  function paintFromState() {
    const meta = getOrdersViewMeta(state.statusFilter);
    const filtered = filterAndSortOrders(state.allOrders, state);
    const size = pageSize();
    const totalPages = Math.max(1, Math.ceil(filtered.length / size));
    if (state.page > totalPages) state.page = totalPages;
    const start = (state.page - 1) * size;
    const pageItems = filtered.slice(start, start + size);
    const activeEl = document.activeElement;
    const restoreSearch = meta.mode === "all"
      && activeEl
      && activeEl.id === "ordersSearch"
      && container.contains(activeEl);
    const searchSelection = restoreSearch
      ? { start: activeEl.selectionStart, end: activeEl.selectionEnd }
      : null;

    if (state.loading && !state.allOrders.length) {
      if (meta.mode === "all") {
        container.innerHTML = `
          <div class="orders-page-grid orders-page--all">
            <div class="orders-sticky-sentinel" aria-hidden="true"></div>
            <div class="orders-sticky-stack${state.stickyActive ? " is-stuck" : ""}">
              ${renderToolbar(0, 0)}
            </div>
            ${renderAllOrdersSkeleton()}
          </div>
        `;
        bindStickyShell();
        return;
      }
      container.innerHTML = panel(meta.title, meta.description, `<div class="state-block">Loading ${escapeHtml(meta.title.toLowerCase())}...</div>`);
      return;
    }

    if (!state.loading && !state.allOrders.length) {
      if (meta.mode === "all") {
        container.innerHTML = `
          <div class="orders-page-grid orders-page--all">
            <div class="orders-sticky-sentinel" aria-hidden="true"></div>
            <div class="orders-sticky-stack${state.stickyActive ? " is-stuck" : ""}">
              ${renderToolbar(0, 0)}
            </div>
            ${renderAllOrdersEmptyState({ hasOrders: false, loadError: state.loadError })}
          </div>
        `;
        bindStickyShell();
        return;
      }
      container.innerHTML = panel(meta.title, meta.description, emptyState("No orders found."));
      return;
    }

    const emptyCopy = meta.mode === "pending"
      ? "No pending orders right now. New checkout orders will appear here automatically."
      : meta.mode === "completed"
        ? "No completed orders yet. Orders marked Delivered or Completed will appear here automatically."
        : meta.mode === "cancelled"
          ? "No cancelled orders yet. Customer or admin cancellations will appear here automatically."
          : meta.mode === "returns"
            ? "No return or refund requests yet. Paid cancellations and return requests will appear here automatically."
            : "No orders match your search or filters.";

    const hasQuery = Boolean(String(state.query || "").trim());
    const hasAttributeFilters = Boolean(
      String(state.statusFilter || "").startsWith("status:")
      || state.paymentFilter
      || state.paymentStatusFilter
      || state.deliveryStatusFilter
      || state.statBucket
    );
    const needsCustomRange = meta.mode === "all"
      && normalizeDateTab(state.dateTab) === "custom"
      && (!state.customFrom || !state.customTo);

    const pageIds = pageItems.map((order) => String(order.orderId || order.id));
    const knownIds = new Set(state.allOrders.map((order) => String(order.orderId || order.id)));
    state.selectedIds = state.selectedIds.filter((id) => knownIds.has(String(id)));
    const selectedSet = new Set(state.selectedIds.map(String));
    const selectedOnPage = pageIds.filter((id) => selectedSet.has(id));

    const cards = pageItems.length
      ? (meta.mode === "all"
        ? renderAllOrdersGroupedList(pageItems, state.expandedId, selectedSet, {
          groupByDate: shouldGroupOrdersByDate(state),
          newestFirst: String(state.sort || "date-desc") !== "date-asc"
        })
        : pageItems.map((order) => renderOrderCard(order, {
          expanded: String(order.orderId || order.id) === String(state.expandedId),
          viewMode: meta.mode
        })).join(""))
      : (meta.mode === "all"
        ? renderAllOrdersEmptyState({
          hasOrders: true,
          hasQuery,
          hasAttributeFilters,
          needsCustomRange,
          dateTab: state.dateTab
        })
        : `<div class="orders-empty-state">${emptyState(emptyCopy)}</div>`);

    if (meta.mode === "all") {
      container.innerHTML = `
        <div class="orders-page-grid orders-page--all">
          <div class="orders-sticky-sentinel" aria-hidden="true"></div>
          <div class="orders-sticky-stack${state.stickyActive ? " is-stuck" : ""}">
            ${renderToolbar(filtered.length, state.allOrders.length)}
            <div data-orders-bulk-slot>${renderAllOrdersBulkBar(state.selectedIds.length, pageIds.length, state.bulkBusy, selectedOnPage.length)}</div>
          </div>
          <div class="orders-mobile-grid orders-mobile-grid--all">${cards}</div>
          ${filtered.length ? renderPagination(totalPages, filtered.length) : ""}
        </div>
      `;
      const selectAll = container.querySelector("#ordersSelectAllPage");
      if (selectAll) {
        selectAll.checked = pageIds.length > 0 && selectedOnPage.length === pageIds.length;
        selectAll.indeterminate = selectedOnPage.length > 0 && selectedOnPage.length < pageIds.length;
      }
      bindStickyShell();
      markFreshCards();
      container.querySelector(".orders-page--all")?.setAttribute("aria-busy", state.loading ? "true" : "false");
      writeStoredListFilters(state);
    } else {
      container.innerHTML = `
        <div class="orders-page-grid">
          ${renderToolbar(filtered.length, state.allOrders.length)}
          <div class="orders-mobile-grid">${cards}</div>
          ${renderPagination(totalPages, filtered.length)}
        </div>
      `;
    }

    if (restoreSearch) {
      const nextSearch = container.querySelector("#ordersSearch");
      if (nextSearch) {
        nextSearch.focus();
        if (searchSelection && typeof nextSearch.setSelectionRange === "function") {
          const length = nextSearch.value.length;
          const startPos = Math.min(Number(searchSelection.start) || 0, length);
          const endPos = Math.min(Number(searchSelection.end) || 0, length);
          nextSearch.setSelectionRange(startPos, endPos);
        }
      }
    }
  }

  async function loadOrders(options = {}) {
    const query = typeof options === "boolean" ? { force: options } : (options || {});
    state.loading = true;
    paintFromState();
    try {
      state.allOrders = await getOrders({ ...query, force: query.force !== false });
      state.loadError = "";
      invalidateOrderIndex();
      if (readHashQuery().has("status")) {
        state.statusFilter = readHashQuery().get("status") || "";
        if (query.resetFilter) state.page = 1;
      } else if (query.resetFilter) {
        const current = String(state.statusFilter || "").trim().toLowerCase();
        if (queueModes.has(current)) {
          state.statusFilter = "";
          state.page = 1;
        }
      }
    } catch (error) {
      console.error(error);
      state.loadError = error?.message || "Unable to load orders.";
      setNotice(state.loadError, "danger");
    } finally {
      state.loading = false;
      paintFromState();
      refreshOpenReviewDrawer();
    }
  }

  function setReviewActionBusy(busy) {
    reviewDrawer.busy = Boolean(busy);
    if (!isReviewDrawerOpen() || !reviewDrawer.orderId) return;
    const resolved = findOrder(reviewDrawer.orderId);
    if (resolved) paintReviewDrawer({ order: resolved, focus: false });
  }

  function notifyWithoutRemount(message, tone) {
    setNotice(message, tone);
    if (!syncNoticeUi()) paintFromState();
  }

  async function applyStatusChange(orderId, nextStatus, successMessage, options = {}) {
    if (!orderId || !nextStatus || state.busyOrderId) return false;
    const keepExpanded = String(state.expandedId) === String(orderId);
    state.busyOrderId = String(orderId);
    setReviewActionBusy(true);
    notifyWithoutRemount("Updating...", "warn");
    try {
      await updateOrderStatus(orderId, nextStatus, options);
      notifyWithoutRemount(successMessage || "Order status updated successfully.", "success");
      if (keepExpanded) state.expandedId = String(orderId);
      await loadOrders({ force: true });
      return true;
    } catch (error) {
      console.error(error);
      notifyWithoutRemount(error?.message || "Unable to update order status. Please try again.", "danger");
      return false;
    } finally {
      state.busyOrderId = "";
      reviewDrawer.busy = false;
      if (isReviewDrawerOpen()) refreshOpenReviewDrawer();
    }
  }

  async function promptAndApplyStatus(order) {
    if (!order || state.busyOrderId || reviewDrawer.busy) return;
    const options = getFulfillmentTransitions(order);
    if (!options.length) {
      notifyWithoutRemount("No valid status changes for this order.", "warn");
      return;
    }
    const picked = await openOrdersStatusDialog({ order, options });
    if (!picked) return;
    const from = getOrderStatusLabel(order);
    if (picked.toLowerCase() === from.toLowerCase()) return;
    await applyStatusChange(order.orderId || order.id, picked, "Order status updated successfully.", {
      reason: `Status changed from ${from} to ${picked}`
    });
  }

  async function promptAndCancelOrder(order) {
    if (!order || state.busyOrderId || reviewDrawer.busy) return;
    if (!canCancelOrder(order)) {
      notifyWithoutRemount("This order cannot be cancelled.", "warn");
      return;
    }
    const result = await openOrdersCancelDialog(order);
    if (!result?.confirmed) return;
    await applyStatusChange(order.orderId || order.id, "Cancelled", "Order status updated successfully.", {
      reason: result.reason || "Cancelled by administrator",
      cancellationReason: result.reason || "Cancelled by administrator"
    });
  }

  function openOrderInvoiceAction(order, { autoPrint = true } = {}) {
    const opened = autoPrint ? printInvoice(order) : viewInvoice(order);
    if (opened) {
      notifyWithoutRemount(autoPrint ? `Print invoice opened for ${order.orderId || order.id}.` : `Invoice opened for ${order.orderId || order.id}.`, "success");
      return;
    }
    notifyWithoutRemount("Unable to open invoice. Allow pop-ups and try again.", "danger");
  }

  function getSelectedOrders() {
    return state.selectedIds
      .map((id) => findOrder(id))
      .filter(Boolean);
  }

  function toggleSelectedId(orderId, checked) {
    const id = String(orderId || "");
    if (!id) return;
    const set = new Set(state.selectedIds.map(String));
    if (checked) set.add(id);
    else set.delete(id);
    state.selectedIds = Array.from(set);
  }

  async function runBulkAction(action) {
    const selected = getSelectedOrders();
    if (!selected.length) {
      setNotice("Select at least one order first.", "warn");
      paintFromState();
      return;
    }

    if (action === "apply-status") {
      const status = container.querySelector("#ordersBulkStatus")?.value || "";
      if (!status) {
        setNotice("Choose a status to apply.", "warn");
        paintFromState();
        return;
      }
      const eligible = selected.filter((order) => (
        getValidStatusTransitions(order).some((item) => item.toLowerCase() === status.toLowerCase())
      ));
      if (!eligible.length) {
        setNotice(`None of the selected orders can change to ${status}.`, "warn");
        paintFromState();
        return;
      }
      const confirmed = await openOrdersConfirmDialog({
        title: "Change order status?",
        message: `Update ${eligible.length} eligible order${eligible.length === 1 ? "" : "s"} to ${status}? Orders without a valid transition will be skipped.`,
        details: [
          ["Selected", String(selected.length)],
          ["Eligible", String(eligible.length)],
          ["To", status]
        ],
        confirmLabel: "Confirm Status Change",
        cancelLabel: "Keep Status",
        tone: status === "Cancelled" ? "danger" : "warn"
      });
      if (!confirmed) return;
      state.bulkBusy = true;
      setNotice(`Updating ${eligible.length} order${eligible.length === 1 ? "" : "s"}…`, "warn");
      paintFromState();
      try {
        const ids = eligible.map((order) => order.orderId || order.id);
        await bulkUpdateOrderStatus(ids, status);
        setNotice(`Updated ${ids.length} order${ids.length === 1 ? "" : "s"} to ${status}.`, "success");
        state.selectedIds = [];
        await loadOrders({ force: true });
      } catch (error) {
        console.error(error);
        setNotice(error?.message || "Unable to update selected orders.", "danger");
        await loadOrders({ force: true });
      } finally {
        state.bulkBusy = false;
        paintFromState();
      }
      return;
    }

    if (action === "print-invoices") {
      selected.forEach((order) => printInvoice(order));
      setNotice(`Opened ${selected.length} invoice${selected.length === 1 ? "" : "s"}.`, "success");
      paintFromState();
      return;
    }

    if (action === "print-packing") {
      selected.forEach((order) => printPackingSlip(order));
      setNotice(`Opened ${selected.length} packing slip${selected.length === 1 ? "" : "s"}.`, "success");
      paintFromState();
      return;
    }

    if (action === "export-excel") {
      downloadCsvFile(`byose-orders-selected-${new Date().toISOString().slice(0, 10)}.csv`, buildOrdersExportRows(selected));
      setNotice(`Exported ${selected.length} order${selected.length === 1 ? "" : "s"} for Excel.`, "success");
      paintFromState();
      return;
    }

    if (action === "export-pdf") {
      printOrdersListReport(selected);
      setNotice(`PDF/print view opened for ${selected.length} order${selected.length === 1 ? "" : "s"}.`, "success");
      paintFromState();
      return;
    }

    if (action === "delete") {
      const deletable = selected.filter(canBulkDeleteOrder);
      if (!deletable.length) {
        setNotice("Bulk delete is only available for cancelled, returned, or refunded orders.", "warn");
        paintFromState();
        return;
      }
      const confirmed = await openOrdersConfirmDialog({
        title: "Delete selected orders",
        message: `Delete ${deletable.length} permitted order${deletable.length === 1 ? "" : "s"}? This cannot be undone.`,
        confirmLabel: "Delete Orders",
        cancelLabel: "Keep Orders",
        tone: "danger"
      });
      if (!confirmed) return;
      state.bulkBusy = true;
      setNotice(`Deleting ${deletable.length} order${deletable.length === 1 ? "" : "s"}…`, "warn");
      paintFromState();
      try {
        const ids = deletable.map((order) => order.orderId || order.id);
        await bulkDeleteOrders(ids);
        ids.forEach((id) => removeOrderMeta(id));
        state.selectedIds = state.selectedIds.filter((id) => !ids.map(String).includes(String(id)));
        setNotice(`Deleted ${ids.length} order${ids.length === 1 ? "" : "s"}.`, "success");
        await loadOrders({ force: true });
      } catch (error) {
        console.error(error);
        setNotice(error?.message || "Unable to delete selected orders.", "danger");
        await loadOrders({ force: true });
      } finally {
        state.bulkBusy = false;
        paintFromState();
      }
    }
  }

  async function applyPaymentStatusChange(orderId, paymentStatus, successMessage) {
    if (!orderId || !paymentStatus || state.busyOrderId) return;
    const keepExpanded = String(state.expandedId) === String(orderId);
    state.busyOrderId = String(orderId);
    setNotice(`Updating payment for ${orderId}...`, "warn");
    paintFromState();
    try {
      await updateOrderStatus(orderId, "", { paymentStatus });
      setNotice(successMessage || `Payment updated for ${orderId}.`, "success");
      state.expandedId = keepExpanded ? String(orderId) : String(orderId);
      await loadOrders({ force: true });
    } catch (error) {
      console.error(error);
      setNotice(error?.message || "Unable to update payment status.", "danger");
      paintFromState();
    } finally {
      state.busyOrderId = "";
    }
  }

  async function applyReturnAction(orderId, returnAction, successMessage, options = {}) {
    if (!orderId || !returnAction || state.busyOrderId) return;
    state.busyOrderId = String(orderId);
    setNotice(`Processing ${returnAction.replace(/_/g, " ")} for ${orderId}...`, "warn");
    paintFromState();
    try {
      await updateOrderStatus(orderId, "", { ...options, returnAction });
      setNotice(successMessage || `Return action completed for ${orderId}.`, "success");
      state.expandedId = String(orderId);
      await loadOrders({ force: true });
    } catch (error) {
      console.error(error);
      setNotice(error?.message || "Unable to process return/refund action.", "danger");
      paintFromState();
    } finally {
      state.busyOrderId = "";
    }
  }

  reviewDrawer.resolveOrder = findOrder;
  reviewDrawer.reloadAndResolve = async (orderId) => {
    const id = String(orderId || "").trim();
    if (!id) return;
    await loadOrders({ force: true });
  };
  reviewDrawer.handleAction = async (action, orderId) => {
    const order = findOrder(orderId);
    if (!order) return;
    if (action === "update-status") {
      await promptAndApplyStatus(order);
      return;
    }
    if (action === "view-invoice") {
      openOrderInvoiceAction(order, { autoPrint: false });
      return;
    }
    if (action === "invoice") {
      openOrderInvoiceAction(order, { autoPrint: true });
      return;
    }
    if (action === "cancel") {
      await promptAndCancelOrder(order);
    }
  };

  await loadOrders({ force: true, resetFilter: true });

  let searchPaintTimer = 0;
  container.oninput = (event) => {
    if (event.target?.id === "ordersSearch") {
      state.query = event.target.value;
      state.page = 1;
      window.clearTimeout(searchPaintTimer);
      searchPaintTimer = window.setTimeout(() => {
        paintFromState();
      }, 160);
    }
  };

  container.onchange = async (event) => {
    const target = event.target;
    if (!target) return;

    if (target.id === "ordersSelectAllPage") {
      const { pageIds } = getAllOrdersPageContext();
      if (target.checked) {
        const set = new Set(state.selectedIds.map(String));
        pageIds.forEach((id) => set.add(id));
        state.selectedIds = Array.from(set);
      } else {
        state.selectedIds = state.selectedIds.filter((id) => !pageIds.includes(String(id)));
      }
      if (!syncSelectionUi()) paintFromState();
      return;
    }

    if (target.matches?.("input[data-order-select]")) {
      toggleSelectedId(target.getAttribute("data-order-select"), Boolean(target.checked));
      if (!syncSelectionUi()) paintFromState();
      return;
    }

    if (target.id === "ordersPageSize") {
      state.pageSize = resolvePageSize({ pageSize: Number(target.value) || PAGE_SIZE });
      state.page = 1;
      paintFromState();
      return;
    }

    if (target.id === "ordersStatusFilter") {
      const nextValue = target.value;
      const queueModes = new Set(["pending", "completed", "cancelled", "returns"]);
      const isQueueJump = queueModes.has(String(nextValue || "").toLowerCase());
      if (isQueueJump || (nextValue === "" && queueModes.has(String(state.statusFilter || "").toLowerCase()))) {
        const nextHash = nextValue
          ? `#/orders?status=${encodeURIComponent(nextValue)}`
          : "#/orders";
        const currentHash = String(window.location.hash || "").split("&")[0];
        if (currentHash.toLowerCase() !== nextHash.toLowerCase()) {
          window.location.hash = nextHash;
          return;
        }
      }
      state.statusFilter = nextValue;
      state.page = 1;
      paintFromState();
      return;
    }

    if (target.id === "ordersSort") {
      state.sort = target.value;
      state.page = 1;
      paintFromState();
      return;
    }

    if (target.id === "ordersPaymentFilter") {
      state.paymentFilter = target.value;
      state.page = 1;
      paintFromState();
      return;
    }

    if (target.id === "ordersPaymentStatusFilter") {
      state.paymentStatusFilter = target.value;
      state.page = 1;
      paintFromState();
      return;
    }

    if (target.id === "ordersDeliveryFilter") {
      state.deliveryStatusFilter = target.value;
      state.page = 1;
      paintFromState();
      return;
    }

    if (target.id === "ordersCustomFrom") {
      state.customDraftFrom = target.value;
      return;
    }

    if (target.id === "ordersCustomTo") {
      state.customDraftTo = target.value;
      return;
    }

    if (target.id === "ordersDateRangeFilter") {
      state.dateTab = normalizeDateTab(target.value || "all");
      state.dateRangeFilter = "";
      state.page = 1;
      paintFromState();
      return;
    }

    if (target.id === "ordersCancelledByFilter") {
      state.cancelledByFilter = target.value;
      state.page = 1;
      paintFromState();
      return;
    }

    if (target.id === "ordersReturnStatusFilter") {
      state.returnStatusFilter = target.value;
      state.page = 1;
      paintFromState();
      return;
    }

    if (target.id === "ordersRefundStatusFilter") {
      state.refundStatusFilter = target.value;
      state.page = 1;
      paintFromState();
      return;
    }

    const select = target.closest?.("select[data-order-status]");
    if (!select) return;
    const orderId = select.getAttribute("data-order-status");
    const nextStatus = select.value;
    const order = findOrder(orderId);
    if (!order || !nextStatus) return;
    const from = getOrderStatusLabel(order);
    if (nextStatus.toLowerCase() === from.toLowerCase()) return;
    const allowed = getValidStatusTransitions(order).some((item) => item.toLowerCase() === nextStatus.toLowerCase());
    if (!allowed) {
      notifyWithoutRemount("That status change is not allowed for this order.", "warn");
      paintFromState();
      return;
    }
    if (nextStatus === "Cancelled") {
      select.disabled = true;
      const result = await openOrdersCancelDialog(order);
      if (!result?.confirmed) {
        paintFromState();
        return;
      }
      await applyStatusChange(orderId, "Cancelled", "Order status updated successfully.", {
        reason: result.reason || "Cancelled by administrator",
        cancellationReason: result.reason || "Cancelled by administrator"
      });
      return;
    }
    const confirmed = await openOrdersConfirmDialog({
      title: "Change order status?",
      details: [
        ["Order", `#${resolveOrderIdentifiers(order).orderNumber || orderId}`],
        ["From", from],
        ["To", nextStatus]
      ],
      confirmLabel: "Confirm Status Change",
      cancelLabel: "Keep Status",
      tone: "warn"
    });
    if (!confirmed) {
      paintFromState();
      return;
    }
    select.disabled = true;
    await applyStatusChange(orderId, nextStatus, "Order status updated successfully.", {
      reason: `Status changed from ${from} to ${nextStatus}`
    });
  };

  container.onsubmit = (event) => {
    const form = event.target?.closest?.("form[data-order-manage-form]");
    if (!form) return;
    event.preventDefault();
    const orderId = form.getAttribute("data-order-manage-form");
    const formData = new FormData(form);
    const tags = String(formData.get("tags") || "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    saveOrderMeta(orderId, {
      priority: String(formData.get("priority") || "normal"),
      assignedStaff: String(formData.get("assignedStaff") || ""),
      estimatedDelivery: String(formData.get("estimatedDelivery") || ""),
      tags,
      staffNotes: String(formData.get("staffNotes") || ""),
      customerNotes: String(formData.get("customerNotes") || ""),
      deliveryNotes: String(formData.get("deliveryNotes") || "")
    });
    setNotice(`Management details saved for ${orderId}.`, "success");
    paintFromState();
  };

  container.onclick = async (event) => {
    const refreshBtn = event.target?.closest?.("#ordersRefreshBtn");
    if (refreshBtn) {
      setNotice("");
      void loadOrders({ force: true });
      return;
    }

    if (event.target?.closest?.("[data-orders-notice-dismiss]")) {
      setNotice("");
      if (!syncNoticeUi()) paintFromState();
      return;
    }

    const jumpBtn = event.target?.closest?.("[data-order-jump]");
    if (jumpBtn) {
      jumpToOrderSection(jumpBtn.getAttribute("data-order-id"), jumpBtn.getAttribute("data-order-jump"));
      return;
    }

    const bulkBtn = event.target?.closest?.("[data-orders-bulk-action]");
    if (bulkBtn) {
      const action = bulkBtn.getAttribute("data-orders-bulk-action");
      if (action === "clear-selection") {
        state.selectedIds = [];
        if (!syncSelectionUi()) paintFromState();
        return;
      }
      if (action === "select-page" || action === "unselect-page") {
        const { pageIds } = getAllOrdersPageContext();
        if (action === "select-page") {
          const set = new Set(state.selectedIds.map(String));
          pageIds.forEach((id) => set.add(id));
          state.selectedIds = Array.from(set);
        } else {
          state.selectedIds = state.selectedIds.filter((id) => !pageIds.includes(String(id)));
        }
        if (!syncSelectionUi()) paintFromState();
        return;
      }
      void runBulkAction(action);
      return;
    }

    const toolbarActionBtn = event.target?.closest?.("[data-orders-toolbar-action]");
    if (toolbarActionBtn) {
      const action = toolbarActionBtn.getAttribute("data-orders-toolbar-action");
      const filtered = filterAndSortOrders(state.allOrders, state);
      if (action === "export") {
        if (!filtered.length) {
          setNotice("No orders to export for the current filters.", "warn");
          paintFromState();
          return;
        }
        downloadCsvFile(`byose-orders-${new Date().toISOString().slice(0, 10)}.csv`, buildOrdersExportRows(filtered));
        setNotice(`Exported ${filtered.length} order${filtered.length === 1 ? "" : "s"} to CSV.`, "success");
        paintFromState();
        return;
      }
      if (action === "print") {
        printOrdersListReport(filtered);
        setNotice(`Print view opened for ${filtered.length} order${filtered.length === 1 ? "" : "s"}.`, "success");
        paintFromState();
        return;
      }
      if (action === "collapse-all") {
        state.expandedId = "";
        setNotice("Order details collapsed.", "success");
        paintFromState();
        return;
      }
      if (action === "clear-filters") {
        resetAllOrdersListFilters(state);
        if (String(window.location.hash || "").includes("status=")) {
          window.location.hash = "#/orders";
          return;
        }
        setNotice("Filters cleared.", "success");
        paintFromState();
        return;
      }
      if (action === "toggle-filters") {
        state.filtersOpen = !state.filtersOpen;
        paintFromState();
        return;
      }
      if (action === "apply-custom-range") {
        const fromValue = container.querySelector("#ordersCustomFrom")?.value || state.customDraftFrom;
        const toValue = container.querySelector("#ordersCustomTo")?.value || state.customDraftTo;
        const from = parseLocalDateInput(fromValue);
        const to = parseLocalDateInput(toValue);
        if (!from || !to) {
          setNotice("Select a start date and end date.", "warn");
          paintFromState();
          return;
        }
        const start = from.getTime() <= to.getTime() ? fromValue : toValue;
        const end = from.getTime() <= to.getTime() ? toValue : fromValue;
        state.dateTab = "custom";
        state.customFrom = start;
        state.customTo = end;
        state.customDraftFrom = start;
        state.customDraftTo = end;
        state.page = 1;
        paintFromState();
        return;
      }
      if (action === "clear-custom-range") {
        state.dateTab = "all";
        state.customFrom = "";
        state.customTo = "";
        state.customDraftFrom = formatLocalDateInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
        state.customDraftTo = formatLocalDateInput(new Date());
        state.page = 1;
        paintFromState();
        return;
      }
    }

    const dateTabBtn = event.target?.closest?.("[data-orders-date-tab]");
    if (dateTabBtn) {
      const nextTab = normalizeDateTab(dateTabBtn.getAttribute("data-orders-date-tab") || "all");
      state.dateTab = nextTab;
      state.dateRangeFilter = "";
      if (nextTab === "custom") {
        if (!state.customDraftFrom) {
          state.customDraftFrom = formatLocalDateInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
        }
        if (!state.customDraftTo) {
          state.customDraftTo = formatLocalDateInput(new Date());
        }
      }
      state.page = 1;
      paintFromState();
      return;
    }

    const statBtn = event.target?.closest?.("[data-orders-stat]");
    if (statBtn) {
      const nextBucket = String(statBtn.getAttribute("data-orders-stat") || "");
      state.statBucket = state.statBucket === nextBucket ? "" : nextBucket;
      state.page = 1;
      paintFromState();
      return;
    }

    const pageBtn = event.target?.closest?.("[data-page-action]");
    if (pageBtn) {
      const action = pageBtn.getAttribute("data-page-action");
      const filtered = filterAndSortOrders(state.allOrders, state);
      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize()));
      if (action === "prev" && state.page > 1) state.page -= 1;
      if (action === "next" && state.page < totalPages) state.page += 1;
      if (action === "first") state.page = 1;
      if (action === "last") state.page = totalPages;
      if (action === "goto") {
        const nextPage = Number(pageBtn.getAttribute("data-page")) || 1;
        state.page = Math.min(Math.max(1, nextPage), totalPages);
      }
      paintFromState();
      return;
    }

    const moreToggle = event.target?.closest?.(".order-card-more > summary");
    if (moreToggle) {
      const current = moreToggle.closest(".order-card-more");
      container.querySelectorAll(".order-card-more[open]").forEach((el) => {
        if (el !== current) el.removeAttribute("open");
      });
    }

    const actionBtn = event.target?.closest?.("[data-order-action]");
    if (!actionBtn) return;
    const orderId = actionBtn.getAttribute("data-order-id");
    const action = actionBtn.getAttribute("data-order-action");
    const order = findOrder(orderId);

    if (action === "review") {
      actionBtn.closest(".order-card-more")?.removeAttribute("open");
      openReviewDrawer(orderId, order || null);
      return;
    }
    if (action === "update-status") {
      actionBtn.closest(".order-card-more")?.removeAttribute("open");
      if (!order) return;
      await promptAndApplyStatus(order);
      return;
    }
    if (action === "view-invoice") {
      actionBtn.closest(".order-card-more")?.removeAttribute("open");
      if (!order) return;
      openOrderInvoiceAction(order, { autoPrint: false });
      return;
    }
    if (action === "cancel") {
      actionBtn.closest(".order-card-more")?.removeAttribute("open");
      if (!order) return;
      await promptAndCancelOrder(order);
      return;
    }

    if (!order) return;
    const isAllMode = getOrdersViewMeta(state.statusFilter).mode === "all";

    if (action === "toggle") {
      const alreadyOpen = String(state.expandedId) === String(orderId);
      const nextExpanded = alreadyOpen ? "" : String(orderId);
      if (String(state.expandedId) !== String(nextExpanded)) {
        state.expandedId = nextExpanded;
        paintFromState();
      }
      if (nextExpanded) {
        window.requestAnimationFrame(() => {
          const card = Array.from(container.querySelectorAll(".order-card-enterprise, .order-mobile-card"))
            .find((el) => String(el.getAttribute("data-order-id")) === String(orderId));
          card?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
      return;
    }
    if (action === "invoice") {
      actionBtn.closest(".order-card-more")?.removeAttribute("open");
      openOrderInvoiceAction(order, { autoPrint: true });
      return;
    }
    if (action === "receipt") {
      printReceipt(order);
      setNotice(`Receipt opened for ${orderId}.`, "success");
      paintFromState();
      return;
    }
    if (action === "download-invoice") {
      downloadInvoicePdf(order);
      setNotice(`Use your browser Print dialog to save invoice ${orderId} as PDF.`, "success");
      paintFromState();
      return;
    }
    if (action === "packing") {
      printPackingSlip(order);
      return;
    }
    if (action === "copy-phone") {
      const phone = order.customerPhone || order.shippingAddress?.phone || "";
      void copyTextToClipboard(phone).then((ok) => {
        setNotice(ok ? `Phone number copied for ${orderId}.` : "Unable to copy phone number.", ok ? "success" : "danger");
        paintFromState();
      });
      return;
    }
    if (action === "copy-customer") {
      void copyTextToClipboard(buildCustomerInfoText(order)).then((ok) => {
        setNotice(ok ? `Customer information copied for ${orderId}.` : "Unable to copy customer information.", ok ? "success" : "danger");
        paintFromState();
      });
      return;
    }
    if (action === "copy-address") {
      void copyTextToClipboard(buildDeliveryAddressText(order)).then((ok) => {
        setNotice(ok ? `Delivery address copied for ${orderId}.` : "Unable to copy delivery address.", ok ? "success" : "danger");
        paintFromState();
      });
      return;
    }
    if (action === "delete-one") {
      if (!canBulkDeleteOrder(order)) {
        setNotice("Only cancelled, returned, or refunded orders can be deleted here.", "warn");
        paintFromState();
        return;
      }
      const confirmed = await openOrdersConfirmDialog({
        title: "Delete order",
        message: `Delete order ${orderId}? This cannot be undone.`,
        confirmLabel: "Delete Order",
        cancelLabel: "Keep Order",
        tone: "danger"
      });
      if (!confirmed) return;
      state.busyOrderId = String(orderId);
      setNotice(`Deleting order ${orderId}…`, "warn");
      paintFromState();
      void deleteOrder(orderId)
        .then(async () => {
          removeOrderMeta(orderId);
          state.selectedIds = state.selectedIds.filter((id) => String(id) !== String(orderId));
          setNotice(`Order ${orderId} deleted.`, "success");
          await loadOrders({ force: true });
        })
        .catch((error) => {
          console.error(error);
          setNotice(error?.message || "Unable to delete order.", "danger");
          paintFromState();
        })
        .finally(() => {
          state.busyOrderId = "";
        });
      return;
    }
    if (action === "payment") {
      if (isAllMode) {
        jumpToOrderSection(orderId, "payment");
        return;
      }
      showPaymentAlert(order);
      return;
    }
    if (action === "mark-paid") {
      const confirmed = await openOrdersConfirmDialog({
        title: "Mark payment received",
        message: `Confirm payment received for order ${orderId}? This will create a Payment Received notification when enabled.`,
        confirmLabel: "Mark Paid",
        cancelLabel: "Cancel",
        tone: "primary"
      });
      if (!confirmed) return;
      await applyPaymentStatusChange(orderId, "paid", `Payment received recorded for ${orderId}.`);
      return;
    }
    if (action === "mark-failed") {
      const confirmed = await openOrdersConfirmDialog({
        title: "Mark payment failed",
        message: `Mark payment as failed for order ${orderId}? This will create a Payment Failed notification when enabled.`,
        confirmLabel: "Mark Failed",
        cancelLabel: "Cancel",
        tone: "danger"
      });
      if (!confirmed) return;
      await applyPaymentStatusChange(orderId, "failed", `Payment failed recorded for ${orderId}.`);
      return;
    }
    if (action === "customer") {
      if (isAllMode) {
        jumpToOrderSection(orderId, "customer");
        return;
      }
      showCustomerDetails(order);
      return;
    }
    if (action === "delivery") {
      if (isAllMode) {
        jumpToOrderSection(orderId, "shipping");
        return;
      }
      showDeliveryDetails(order);
      return;
    }
    if (action === "cancellation-reason") {
      showCancellationReason(order);
      return;
    }
    if (action === "summary") {
      printOrderSummary(order);
      setNotice(`Order summary opened for ${orderId}.`, "success");
      paintFromState();
      return;
    }
    if (action === "print-return") {
      printReturnReport(order);
      setNotice(`Return report opened for ${orderId}.`, "success");
      paintFromState();
      return;
    }
    if (action === "print-refund") {
      printRefundReport(order);
      setNotice(`Refund report opened for ${orderId}.`, "success");
      paintFromState();
      return;
    }
    if (action === "view-original") {
      state.expandedId = String(orderId);
      window.location.hash = "#/orders";
      return;
    }
    if (action === "open-return") {
      const reason = window.prompt(`Open return request for ${orderId}?\n\nReturn reason:`, getReturnWorkflow(order).returnReason || "Customer return request") || "";
      if (!reason.trim()) return;
      const confirmed = await openOrdersConfirmDialog({
        title: "Open return request",
        message: `Confirm opening a return request for order ${orderId}?`,
        confirmLabel: "Open Return",
        tone: "warn"
      });
      if (!confirmed) return;
      void applyReturnAction(orderId, "open_return", `Return request opened for ${orderId}.`, {
        reason: reason.trim(),
        adminNotes: reason.trim()
      });
      return;
    }
    if (action === "approve-return") {
      const note = window.prompt(`Approve return for ${orderId}?\n\nOptional admin notes:`, getReturnWorkflow(order).adminNotes || "Return approved") || "";
      const confirmed = await openOrdersConfirmDialog({
        title: "Approve return",
        message: `Approve return for order ${orderId}? Stock will be restored when appropriate.`,
        confirmLabel: "Approve Return",
        tone: "warn"
      });
      if (!confirmed) return;
      void applyReturnAction(orderId, "approve_return", `Return approved for ${orderId}.`, {
        adminNotes: note.trim() || "Return approved"
      });
      return;
    }
    if (action === "reject-return") {
      const note = window.prompt(`Reject return for ${orderId}?\n\nRejection reason:`, "Return rejected") || "";
      if (!note.trim()) return;
      const confirmed = await openOrdersConfirmDialog({
        title: "Reject return",
        message: `Reject return for order ${orderId}?`,
        confirmLabel: "Reject Return",
        tone: "danger"
      });
      if (!confirmed) return;
      void applyReturnAction(orderId, "reject_return", `Return rejected for ${orderId}.`, {
        adminNotes: note.trim()
      });
      return;
    }
    if (action === "approve-refund") {
      const defaultAmount = String(getReturnWorkflow(order).refundAmount || order.total || 0);
      const amountRaw = window.prompt(`Approve refund for ${orderId}?\n\nRefund amount:`, defaultAmount);
      if (amountRaw == null) return;
      const amount = Number(amountRaw);
      if (!Number.isFinite(amount) || amount < 0) {
        setNotice("Enter a valid refund amount.", "danger");
        paintFromState();
        return;
      }
      const method = window.prompt("Refund method:", getReturnWorkflow(order).refundMethod || paymentLabel(order) || "original_payment") || "original_payment";
      const note = window.prompt("Optional admin notes:", getReturnWorkflow(order).adminNotes || "Refund approved") || "Refund approved";
      const confirmed = await openOrdersConfirmDialog({
        title: "Confirm refund",
        message: `Confirm refund of ${formatCurrency(amount)} for order ${orderId}? This updates payment records, reports, and dashboard statistics. Duplicate refunds are blocked.`,
        confirmLabel: "Complete Refund",
        tone: "warn"
      });
      if (!confirmed) return;
      void applyReturnAction(orderId, "approve_refund", `Refund approved for ${orderId}.`, {
        refundAmount: amount,
        refundMethod: method.trim(),
        adminNotes: note.trim() || "Refund approved"
      });
      return;
    }
    if (action === "reject-refund") {
      const note = window.prompt(`Reject refund for ${orderId}?\n\nRejection reason:`, "Refund rejected") || "";
      if (!note.trim()) return;
      const confirmed = await openOrdersConfirmDialog({
        title: "Reject refund",
        message: `Reject refund for order ${orderId}?`,
        confirmLabel: "Reject Refund",
        tone: "danger"
      });
      if (!confirmed) return;
      void applyReturnAction(orderId, "reject_refund", `Refund rejected for ${orderId}.`, {
        adminNotes: note.trim()
      });
      return;
    }
    if (action === "restore") {
      const confirmed = await openOrdersConfirmDialog({
        title: "Restore order",
        message: `Restore order ${orderId} back to Pending? Stock will be re-reserved if available. Confirm inventory before fulfilling.`,
        confirmLabel: "Restore Order",
        tone: "warn"
      });
      if (!confirmed) return;
      void applyStatusChange(orderId, "Pending", `Order ${orderId} restored to Pending.`, {
        reason: "Order restored by administrator"
      });
      return;
    }
    if (action === "accept") {
      const confirmed = await openOrdersConfirmDialog({
        title: "Change order status?",
        details: [
          ["Order", `#${resolveOrderIdentifiers(order).orderNumber || orderId}`],
          ["From", getOrderStatusLabel(order)],
          ["To", "Confirmed"]
        ],
        confirmLabel: "Confirm Status Change",
        cancelLabel: "Keep Status",
        tone: "warn"
      });
      if (!confirmed) return;
      void applyStatusChange(orderId, "Confirmed", "Order status updated successfully.");
      return;
    }
    if (action === "process") {
      const confirmed = await openOrdersConfirmDialog({
        title: "Change order status?",
        details: [
          ["Order", `#${resolveOrderIdentifiers(order).orderNumber || orderId}`],
          ["From", getOrderStatusLabel(order)],
          ["To", "Processing"]
        ],
        confirmLabel: "Confirm Status Change",
        cancelLabel: "Keep Status",
        tone: "warn"
      });
      if (!confirmed) return;
      void applyStatusChange(orderId, "Processing", "Order status updated successfully.");
      return;
    }
  };

  const onOrdersKeydown = (event) => {
    if (event.key !== "Escape") return;
    const host = document.getElementById("ordersUxOverlayHost");
    if (host && !host.hidden) {
      closeOrdersUxDialog(false);
      event.preventDefault();
      return;
    }
    const openMenu = container.querySelector(".order-card-more[open], .order-qa-more[open], .orders-tool-more[open]");
    if (openMenu) {
      openMenu.removeAttribute("open");
      event.preventDefault();
      return;
    }
    if (isReviewDrawerOpen()) {
      closeReviewDrawer();
      event.preventDefault();
      return;
    }
    if (getOrdersViewMeta(state.statusFilter).mode === "all" && state.expandedId) {
      state.expandedId = "";
      paintFromState();
    }
  };
  if (container._ordersKeydown) {
    document.removeEventListener("keydown", container._ordersKeydown);
  }
  document.addEventListener("keydown", onOrdersKeydown);
  container._ordersKeydown = onOrdersKeydown;

  const onOrdersHashChange = () => {
    if (!/#\/orders/i.test(window.location.hash || "")) {
      closeReviewDrawer({ restoreFocus: false });
    }
  };
  if (container._ordersHashChange) {
    window.removeEventListener("hashchange", container._ordersHashChange);
  }
  window.addEventListener("hashchange", onOrdersHashChange);
  container._ordersHashChange = onOrdersHashChange;

  unsubscribeLive = subscribeToLiveFeeds("orders", () => {
    void loadOrders({ preferCache: false, force: true });
  });

  container.dataset.ordersMounted = "1";
  ordersPageApi = {
    reload: (opts = {}) => loadOrders({ force: true, ...opts })
  };
}
