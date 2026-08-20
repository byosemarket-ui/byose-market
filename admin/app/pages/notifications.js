import { emptyState, escapeHtml } from "../components/ui.js";
import {
  archiveNotification,
  bulkArchiveNotifications,
  bulkDeleteNotifications,
  bulkMarkNotificationsRead,
  bulkMarkNotificationsUnread,
  clearOldNotifications,
  deleteNotification,
  getAdminNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread
} from "../services/admin-data.service.js";
import { startRealtimeSync, subscribeToRealtimeEvents } from "../services/realtime-sync.service.js";

const PAGE_SIZES = [10, 25, 50];
const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "order", label: "Order" },
  { value: "payment", label: "Payment" },
  { value: "refund", label: "Refund" },
  { value: "customer", label: "Customer" },
  { value: "inventory", label: "Inventory" },
  { value: "product", label: "Product" },
  { value: "system", label: "System" }
];

function attr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function priorityTone(priority) {
  const value = String(priority || "").toLowerCase();
  if (value === "high") return "danger";
  if (value === "low") return "neutral";
  return "info";
}

function priorityLabel(priority) {
  const value = String(priority || "normal").toLowerCase();
  if (value === "normal") return "Medium";
  if (value === "high") return "High";
  if (value === "low") return "Low";
  return value;
}

function statusLabel(status) {
  const value = String(status || "unread").toLowerCase();
  if (value === "archived") return "Archived";
  if (value === "read") return "Read";
  return "Unread";
}

function formatDatePart(value) {
  const date = new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString();
}

function formatTimePart(value) {
  const date = new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function iconGlyph(iconOrType) {
  const key = String(iconOrType || "system").toLowerCase();
  if (key.includes("order") || key === "cart") return "ORD";
  if (key.includes("payment")) return "PAY";
  if (key.includes("refund")) return "REF";
  if (key.includes("customer") || key.includes("user")) return "CUS";
  if (key.includes("inventory") || key.includes("stock")) return "INV";
  if (key.includes("product")) return "PRD";
  return "SYS";
}

function selectedCount(selected) {
  return selected instanceof Set ? selected.size : 0;
}

function emailDeliveryLabel(item) {
  const meta = item?.metadata?.emailDelivery || item?.emailDelivery || null;
  if (!meta || typeof meta !== "object") return "";
  const status = String(meta.status || "").toLowerCase();
  if (!status) return "";
  if (status === "sent") return "Email sent";
  if (status === "skipped") return "Email skipped";
  if (status === "retry_scheduled" || status === "pending" || status === "retrying") return "Email retrying";
  if (status === "failed" || status === "partial") return status === "partial" ? "Email partial" : "Email failed";
  return `Email ${status}`;
}

function smsDeliveryLabel(item) {
  const meta = item?.metadata?.smsDelivery || item?.smsDelivery || null;
  if (!meta || typeof meta !== "object") return "";
  const status = String(meta.status || "").toLowerCase();
  if (!status) return "";
  if (status === "sent") return "Historical SMS sent";
  if (status === "skipped") return "Historical SMS skipped";
  if (status === "retry_scheduled" || status === "pending" || status === "retrying") return "Historical SMS";
  if (status === "failed" || status === "partial") return status === "partial" ? "Historical SMS partial" : "Historical SMS failed";
  return `Historical SMS ${status}`;
}

function renderHistoryRow(item, selected) {
  const id = String(item.id || "");
  const unread = String(item.status || "").toLowerCase() === "unread";
  const icon = item.icon || item?.metadata?.icon || item.type || "system";
  const customerLabel = item.relatedCustomerName
    || item?.metadata?.relatedCustomerName
    || item.relatedCustomerId
    || "";
  const isSelected = selected.has(id);
  const emailLabel = emailDeliveryLabel(item);
  const smsLabel = smsDeliveryLabel(item);
  const orderId = String(item.relatedOrderId || "").trim();

  return `
    <article class="nh-row${unread ? " is-unread" : ""}${isSelected ? " is-selected" : ""}" data-notification-id="${attr(id)}">
      <label class="nh-check">
        <input type="checkbox" data-nh-select="${attr(id)}" ${isSelected ? "checked" : ""} />
        <span class="sr-only">Select notification</span>
      </label>
      <div class="nh-icon nh-icon--${attr(String(item.type || "system"))}" aria-hidden="true">${escapeHtml(iconGlyph(icon))}</div>
      <div class="nh-main">
        <div class="nh-head">
          <strong>${escapeHtml(item.title || "Notification")}</strong>
          <span class="notification-pill">${escapeHtml(String(item.type || "system"))}</span>
          <span class="notification-pill notification-pill--${priorityTone(item.priority)}">${escapeHtml(priorityLabel(item.priority))}</span>
          <span class="notification-pill">${escapeHtml(statusLabel(item.status))}</span>
          ${emailLabel ? `<span class="notification-pill notification-pill--${emailLabel.includes("fail") ? "danger" : "info"}">${escapeHtml(emailLabel)}</span>` : ""}
          ${smsLabel ? `<span class="notification-pill notification-pill--${smsLabel.includes("fail") ? "danger" : "info"}">${escapeHtml(smsLabel)}</span>` : ""}
        </div>
        <p>${escapeHtml(item.message || "")}</p>
        <div class="nh-meta">
          ${orderId
            ? `<a class="nh-order-link" href="#/orders?orderId=${encodeURIComponent(orderId)}">Order ${escapeHtml(orderId)}</a>`
            : ""}
          ${customerLabel ? `<span>Customer ${escapeHtml(customerLabel)}</span>` : ""}
          <span>${escapeHtml(formatDatePart(item.createdAt))}</span>
          <span>${escapeHtml(formatTimePart(item.createdAt))}</span>
        </div>
      </div>
      <div class="nh-actions">
        ${unread
          ? `<button type="button" class="btn btn-ghost" data-notification-action="read" data-notification-id="${attr(id)}">Mark read</button>`
          : `<button type="button" class="btn btn-ghost" data-notification-action="unread" data-notification-id="${attr(id)}">Mark unread</button>`}
        ${String(item.status).toLowerCase() !== "archived"
          ? `<button type="button" class="btn btn-ghost" data-notification-action="archive" data-notification-id="${attr(id)}">Archive</button>`
          : ""}
        <button type="button" class="btn btn-ghost" data-notification-action="delete" data-notification-id="${attr(id)}">Delete</button>
      </div>
    </article>
  `;
}

export async function renderNotifications(container) {
  if (typeof container.__notificationLiveCleanup === "function") {
    try {
      container.__notificationLiveCleanup();
    } catch (_error) {
      // ignore cleanup errors
    }
    container.__notificationLiveCleanup = null;
  }

  const state = {
    q: "",
    status: "",
    priority: "",
    type: "",
    datePreset: "",
    sort: "newest",
    page: 1,
    pageSize: 25,
    loading: true,
    items: [],
    total: 0,
    unreadCount: 0,
    selected: new Set(),
    notice: "",
    noticeTone: "success"
  };

  function totalPages() {
    return Math.max(1, Math.ceil(Number(state.total || 0) / Number(state.pageSize || 25)));
  }

  function paint() {
    const pages = totalPages();
    const from = state.total ? ((state.page - 1) * state.pageSize) + 1 : 0;
    const to = Math.min(state.total, state.page * state.pageSize);
    const selected = selectedCount(state.selected);

    container.innerHTML = `
      <div class="nh-page">
        <header class="nh-hero">
          <div>
            <p class="dashboard-eyebrow">Notifications</p>
            <h2>Notification History</h2>
            <p>${state.loading
              ? "Loading notification history…"
              : `${state.total.toLocaleString()} notification${state.total === 1 ? "" : "s"} · ${state.unreadCount} unread`}</p>
          </div>
            <div class="nh-hero-actions">
            <button type="button" class="btn btn-primary" id="nhMarkAllReadBtn" ${state.loading ? "disabled" : ""}>Mark all as read</button>
            <a class="btn btn-ghost" href="#/notificationanalytics">Analytics</a>
            <a class="btn btn-ghost" href="#/notificationmonitoring">Monitoring</a>
            <a class="btn btn-ghost" href="#/settings?panel=notifications">Notification Settings</a>
          </div>
        </header>

        ${state.notice
          ? `<div class="notification-center-notice notification-center-notice--${escapeHtml(state.noticeTone)}" role="status">
              ${escapeHtml(state.notice)}
              ${state.noticeTone === "danger"
                ? `<button type="button" class="btn btn-ghost" id="nhRetryLoadBtn">Retry</button>`
                : ""}
            </div>`
          : ""}

        <section class="nh-toolbar admin-profile-card">
          <div class="nh-search-row">
            <label class="admin-field nh-search-field">
              <span>Search</span>
              <input
                id="nhSearchInput"
                class="input"
                type="search"
                placeholder="Order number, customer, type, keywords…"
                value="${attr(state.q)}"
              />
            </label>
            <button type="button" class="btn btn-primary" id="nhSearchBtn">Search</button>
            <button type="button" class="btn btn-ghost" id="nhResetBtn">Reset</button>
          </div>

          <div class="nh-filter-grid">
            <label class="admin-field">
              <span>Status</span>
              <select id="nhStatusFilter" class="input">
                <option value="" ${!state.status ? "selected" : ""}>Active (read + unread)</option>
                <option value="unread" ${state.status === "unread" ? "selected" : ""}>Unread</option>
                <option value="read" ${state.status === "read" ? "selected" : ""}>Read</option>
                <option value="archived" ${state.status === "archived" ? "selected" : ""}>Archived</option>
              </select>
            </label>
            <label class="admin-field">
              <span>Priority</span>
              <select id="nhPriorityFilter" class="input">
                <option value="" ${!state.priority ? "selected" : ""}>All priorities</option>
                <option value="high" ${state.priority === "high" ? "selected" : ""}>High</option>
                <option value="normal" ${state.priority === "normal" ? "selected" : ""}>Medium</option>
                <option value="low" ${state.priority === "low" ? "selected" : ""}>Low</option>
              </select>
            </label>
            <label class="admin-field">
              <span>Type</span>
              <select id="nhTypeFilter" class="input">
                ${TYPE_OPTIONS.map((option) => `
                  <option value="${attr(option.value)}" ${state.type === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>
                `).join("")}
              </select>
            </label>
            <label class="admin-field">
              <span>Date</span>
              <select id="nhDatePresetFilter" class="input">
                <option value="" ${!state.datePreset ? "selected" : ""}>Any time</option>
                <option value="today" ${state.datePreset === "today" ? "selected" : ""}>Today</option>
                <option value="yesterday" ${state.datePreset === "yesterday" ? "selected" : ""}>Yesterday</option>
                <option value="this_week" ${state.datePreset === "this_week" ? "selected" : ""}>This week</option>
                <option value="this_month" ${state.datePreset === "this_month" ? "selected" : ""}>This month</option>
              </select>
            </label>
            <label class="admin-field">
              <span>Sort</span>
              <select id="nhSortFilter" class="input">
                <option value="newest" ${state.sort === "newest" ? "selected" : ""}>Newest</option>
                <option value="oldest" ${state.sort === "oldest" ? "selected" : ""}>Oldest</option>
                <option value="priority" ${state.sort === "priority" ? "selected" : ""}>Priority</option>
                <option value="type" ${state.sort === "type" ? "selected" : ""}>Notification type</option>
              </select>
            </label>
            <label class="admin-field">
              <span>Page size</span>
              <select id="nhPageSizeFilter" class="input">
                ${PAGE_SIZES.map((size) => `
                  <option value="${size}" ${Number(state.pageSize) === size ? "selected" : ""}>${size} / page</option>
                `).join("")}
              </select>
            </label>
          </div>
        </section>

        <section class="nh-bulkbar${selected ? " is-visible" : ""}" ${selected ? "" : "hidden"}>
          <strong>${selected} selected</strong>
          <div class="nh-bulkbar-actions">
            <button type="button" class="btn btn-ghost" data-nh-bulk="read">Mark read</button>
            <button type="button" class="btn btn-ghost" data-nh-bulk="unread">Mark unread</button>
            <button type="button" class="btn btn-ghost" data-nh-bulk="archive">Archive</button>
            <button type="button" class="btn btn-ghost" data-nh-bulk="delete">Delete</button>
            <button type="button" class="btn btn-ghost" data-nh-bulk="clear">Clear selection</button>
          </div>
        </section>

        <section class="nh-list-card admin-profile-card">
          <div class="nh-list-head">
            <label class="nh-check nh-check--all">
              <input type="checkbox" id="nhSelectAll" ${state.items.length && state.items.every((item) => state.selected.has(String(item.id))) ? "checked" : ""} />
              <span>Select page</span>
            </label>
            <div class="nh-list-head-actions">
              <button type="button" class="btn btn-ghost" id="nhClearOldBtn">Clear old (90+ days)</button>
            </div>
          </div>

          ${state.loading
            ? `<div class="state-block">Loading notification history…</div>`
            : state.items.length
              ? `<div class="nh-list">${state.items.map((item) => renderHistoryRow(item, state.selected)).join("")}</div>`
              : emptyState("No notifications match your filters.")}

          <div class="nh-pagination">
            <p>${state.total ? `Showing ${from}–${to} of ${state.total.toLocaleString()}` : "No results"}</p>
            <div class="nh-pagination-controls">
              <button type="button" class="btn btn-ghost" id="nhPrevPage" ${state.page <= 1 || state.loading ? "disabled" : ""}>Previous</button>
              <span>Page ${state.page} / ${pages}</span>
              <button type="button" class="btn btn-ghost" id="nhNextPage" ${state.page >= pages || state.loading ? "disabled" : ""}>Next</button>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  async function load(options = {}) {
    const soft = Boolean(options.soft);
    if (!soft) {
      state.loading = true;
      paint();
    }

    try {
      const offset = (Math.max(1, state.page) - 1) * state.pageSize;
      const result = await getAdminNotifications({
        q: state.q,
        status: state.status === "archived" ? "archived" : state.status,
        includeArchived: state.status === "archived",
        priority: state.priority,
        type: state.type,
        datePreset: state.datePreset,
        sort: state.sort,
        limit: state.pageSize,
        offset
      });

      state.items = result.notifications;
      state.total = result.total;
      state.unreadCount = result.unreadCount;
      state.sort = result.sort || state.sort;

      const maxPage = Math.max(1, Math.ceil(Number(state.total || 0) / Number(state.pageSize || 25)));
      if (state.page > maxPage) {
        state.page = maxPage;
        if (!options._retried) {
          return load({ ...options, soft: true, _retried: true });
        }
      }

      // Drop selections that are no longer on the current page set if desired — keep across pages.
      if (!soft) state.notice = "";
    } catch (error) {
      console.error(error);
      if (!soft) {
        state.items = [];
        state.total = 0;
        state.notice = error?.message || "Unable to load notification history.";
        state.noticeTone = "danger";
      }
    } finally {
      state.loading = false;
      paint();
    }
  }

  function syncFiltersFromDom() {
    state.q = String(container.querySelector("#nhSearchInput")?.value || "").trim();
    state.status = String(container.querySelector("#nhStatusFilter")?.value || "");
    state.priority = String(container.querySelector("#nhPriorityFilter")?.value || "");
    state.type = String(container.querySelector("#nhTypeFilter")?.value || "");
    state.datePreset = String(container.querySelector("#nhDatePresetFilter")?.value || "");
    state.sort = String(container.querySelector("#nhSortFilter")?.value || "newest");
    state.pageSize = Number(container.querySelector("#nhPageSizeFilter")?.value || 25) || 25;
  }

  function resetFilters() {
    state.q = "";
    state.status = "";
    state.priority = "";
    state.type = "";
    state.datePreset = "";
    state.sort = "newest";
    state.page = 1;
    state.pageSize = 25;
    state.selected = new Set();
  }

  await load();

  void startRealtimeSync().catch(() => {});
  let liveRefreshTimer = null;
  const unsubscribeLive = subscribeToRealtimeEvents("notifications", (event) => {
    const type = String(event?.type || "");
    if (!type.startsWith("notification:")) return;
    if (liveRefreshTimer) window.clearTimeout(liveRefreshTimer);
    liveRefreshTimer = window.setTimeout(() => {
      void load({ soft: true });
    }, 280);
  });
  container.__notificationLiveCleanup = () => {
    if (liveRefreshTimer) window.clearTimeout(liveRefreshTimer);
    unsubscribeLive?.();
  };

  container.onchange = (event) => {
    const target = event.target;
    if (!target) return;

    if (target.matches?.("[data-nh-select]")) {
      const id = target.getAttribute("data-nh-select");
      if (!id) return;
      if (target.checked) state.selected.add(id);
      else state.selected.delete(id);
      paint();
      return;
    }

    if (target.id === "nhSelectAll") {
      if (target.checked) {
        state.items.forEach((item) => state.selected.add(String(item.id)));
      } else {
        state.items.forEach((item) => state.selected.delete(String(item.id)));
      }
      paint();
      return;
    }

    if ([
      "nhStatusFilter",
      "nhPriorityFilter",
      "nhTypeFilter",
      "nhDatePresetFilter",
      "nhSortFilter",
      "nhPageSizeFilter"
    ].includes(target.id)) {
      syncFiltersFromDom();
      state.page = 1;
      void load();
    }
  };

  container.onkeydown = (event) => {
    if (event.key === "Enter" && event.target?.id === "nhSearchInput") {
      event.preventDefault();
      syncFiltersFromDom();
      state.page = 1;
      void load();
    }
  };

  container.onclick = async (event) => {
    if (event.target?.closest?.("#nhSearchBtn")) {
      syncFiltersFromDom();
      state.page = 1;
      void load();
      return;
    }

    if (event.target?.closest?.("#nhResetBtn")) {
      resetFilters();
      void load();
      return;
    }

    if (event.target?.closest?.("#nhPrevPage")) {
      if (state.page > 1) {
        state.page -= 1;
        void load();
      }
      return;
    }

    if (event.target?.closest?.("#nhNextPage")) {
      if (state.page < totalPages()) {
        state.page += 1;
        void load();
      }
      return;
    }

    if (event.target?.closest?.("#nhRetryLoadBtn")) {
      state.notice = "";
      await load();
      return;
    }

    if (event.target?.closest?.("#nhMarkAllReadBtn")) {
      try {
        const result = await markAllNotificationsRead();
        state.notice = `Marked ${result.updated} notification${result.updated === 1 ? "" : "s"} as read.`;
        state.noticeTone = "success";
        window.dispatchEvent(new CustomEvent("admin:notifications-changed"));
        await load({ soft: true });
      } catch (error) {
        state.notice = error?.message || "Unable to mark all as read.";
        state.noticeTone = "danger";
        paint();
      }
      return;
    }

    if (event.target?.closest?.("#nhClearOldBtn")) {
      const confirmed = window.confirm("Soft-delete notifications older than 90 days? This can be recovered only from the database.");
      if (!confirmed) return;
      try {
        const result = await clearOldNotifications(90);
        state.notice = `Cleared ${result.deleted} old notification${result.deleted === 1 ? "" : "s"}.`;
        state.noticeTone = "success";
        state.selected = new Set();
        window.dispatchEvent(new CustomEvent("admin:notifications-changed"));
        await load();
      } catch (error) {
        state.notice = error?.message || "Unable to clear old notifications.";
        state.noticeTone = "danger";
        paint();
      }
      return;
    }

    const bulkBtn = event.target?.closest?.("[data-nh-bulk]");
    if (bulkBtn) {
      const action = bulkBtn.getAttribute("data-nh-bulk");
      const ids = [...state.selected];
      if (action === "clear") {
        state.selected = new Set();
        paint();
        return;
      }
      if (!ids.length) return;
      try {
        if (action === "read") {
          const result = await bulkMarkNotificationsRead(ids);
          state.notice = `Marked ${result.updated} selected notification${result.updated === 1 ? "" : "s"} as read.`;
        } else if (action === "unread") {
          const result = await bulkMarkNotificationsUnread(ids);
          state.notice = `Marked ${result.updated} selected notification${result.updated === 1 ? "" : "s"} as unread.`;
        } else if (action === "archive") {
          const result = await bulkArchiveNotifications(ids);
          state.notice = `Archived ${result.updated} notification${result.updated === 1 ? "" : "s"}.`;
        } else if (action === "delete") {
          const confirmed = window.confirm(`Delete ${ids.length} selected notification${ids.length === 1 ? "" : "s"}?`);
          if (!confirmed) return;
          const result = await bulkDeleteNotifications(ids);
          state.notice = `Deleted ${result.deleted} notification${result.deleted === 1 ? "" : "s"}.`;
          state.selected = new Set();
        }
        state.noticeTone = "success";
        window.dispatchEvent(new CustomEvent("admin:notifications-changed"));
        await load({ soft: true });
      } catch (error) {
        state.notice = error?.message || "Unable to update selected notifications.";
        state.noticeTone = "danger";
        paint();
      }
      return;
    }

    const actionBtn = event.target?.closest?.("[data-notification-action]");
    if (!actionBtn) return;
    const id = actionBtn.getAttribute("data-notification-id");
    const action = actionBtn.getAttribute("data-notification-action");
    try {
      if (action === "read") await markNotificationRead(id);
      if (action === "unread") await markNotificationUnread(id);
      if (action === "archive") await archiveNotification(id);
      if (action === "delete") {
        const confirmed = window.confirm("Delete this notification?");
        if (!confirmed) return;
        await deleteNotification(id);
        state.selected.delete(String(id));
      }
      state.notice = "Notification updated.";
      state.noticeTone = "success";
      window.dispatchEvent(new CustomEvent("admin:notifications-changed"));
      await load({ soft: true });
    } catch (error) {
      state.notice = error?.message || "Unable to update notification.";
      state.noticeTone = "danger";
      paint();
    }
  };
}
