import { emptyState, escapeHtml, panel } from "../components/ui.js";
import {
  getCustomerDetail,
  getProducts,
  searchCustomers,
  sendCustomerNotification
} from "../services/admin-data.service.js";

const CATEGORY_OPTIONS = [
  { value: "general", label: "General" },
  { value: "important", label: "Important" },
  { value: "promotion", label: "Promotion" },
  { value: "order", label: "Order" },
  { value: "account", label: "Account" },
  { value: "product", label: "Product" }
];

function attr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `admin-msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatCustomerLine(customer) {
  const parts = [
    customer?.name,
    customer?.email,
    customer?.id
  ].filter(Boolean);
  return parts.join(" · ");
}

function renderCustomerOption(customer, selectedId) {
  const id = String(customer?.id || "");
  const selected = id && id === String(selectedId || "") ? "selected" : "";
  const label = formatCustomerLine(customer);
  return `<option value="${attr(id)}" ${selected}>${escapeHtml(label)}</option>`;
}

function renderOrderOptions(orders, selectedId) {
  const items = Array.isArray(orders) ? orders : [];
  if (!items.length) {
    return `<option value="">No orders for this customer</option>`;
  }
  return [
    `<option value="">No related order</option>`,
    ...items.map((order) => {
      const id = String(order?.id || order?.orderId || "");
      const status = String(order?.status || "Pending");
      const total = Number(order?.total || 0);
      const label = `${id} · ${status} · ${total.toLocaleString()} RWF`;
      const selected = id && id === String(selectedId || "") ? "selected" : "";
      return `<option value="${attr(id)}" ${selected}>${escapeHtml(label)}</option>`;
    })
  ].join("");
}

function renderProductOptions(products, selectedId, query) {
  const items = Array.isArray(products) ? products : [];
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const filtered = normalizedQuery
    ? items.filter((product) => {
      const haystack = [
        product?.id,
        product?.catalogId,
        product?.name,
        product?.title
      ].join(" ").toLowerCase();
      return haystack.includes(normalizedQuery);
    }).slice(0, 40)
    : items.slice(0, 40);

  if (!filtered.length) {
    return `<option value="">No matching product</option>`;
  }

  return [
    `<option value="">No related product</option>`,
    ...filtered.map((product) => {
      const id = String(product?.catalogId || product?.id || "");
      const name = String(product?.name || product?.title || "Product");
      const selected = id && id === String(selectedId || "") ? "selected" : "";
      return `<option value="${attr(id)}" ${selected}>${escapeHtml(`${name} (${id})`)}</option>`;
    })
  ].join("");
}

function buildPreviewMarkup(state) {
  const customer = state.selectedCustomer;
  const category = CATEGORY_OPTIONS.find((item) => item.value === state.category)?.label || "General";
  return `
    <article class="customer-notify-preview">
      <p class="customer-notify-preview__label">Preview</p>
      <h3>${escapeHtml(state.title || "Notification title")}</h3>
      <p class="customer-notify-preview__meta">
        To: ${escapeHtml(customer?.name || "Selected customer")} (${escapeHtml(customer?.id || "—")})
        · ${escapeHtml(category)}
      </p>
      <div class="customer-notify-preview__body">${escapeHtml(state.message || "Notification message")}</div>
      ${state.orderId ? `<p class="customer-notify-preview__link">Order: ${escapeHtml(state.orderId)}</p>` : ""}
      ${state.productId ? `<p class="customer-notify-preview__link">Product: ${escapeHtml(state.productId)}</p>` : ""}
    </article>
  `;
}

function validateForm(state) {
  if (!state.selectedCustomer?.id) return "Select a customer before sending.";
  if (!String(state.title || "").trim()) return "Notification title is required.";
  if (!String(state.message || "").trim()) return "Notification message is required.";
  return "";
}

export async function renderCustomerNotificationsSend(container, { softRefresh = false } = {}) {
  if (!container) return;

  const state = {
    searchQuery: "",
    searchResults: [],
    selectedCustomer: null,
    customerOrders: [],
    products: [],
    productQuery: "",
    category: "general",
    title: "",
    message: "",
    orderId: "",
    productId: "",
    idempotencyKey: createIdempotencyKey(),
    sending: false,
    notice: "",
    noticeTone: "success",
    showPreview: false,
    searchLoading: false
  };

  if (!softRefresh) {
    container.innerHTML = loadingMarkup();
  }

  try {
    state.products = await getProducts({ emit: false, maxItems: 500 });
  } catch (_error) {
    state.products = [];
  }

  render();

  function loadingMarkup() {
    return `<div class="customer-notify-page"><p class="admin-muted">Loading customer notification tools…</p></div>`;
  }

  function renderNotice() {
    if (!state.notice) return "";
    const tone = state.noticeTone === "danger" ? "notification-center-notice--danger" : "";
    return `<div class="notification-center-notice ${tone}" role="status">${escapeHtml(state.notice)}</div>`;
  }

  function renderForm() {
    const validationMessage = validateForm(state);
    const canSend = !validationMessage && !state.sending;
    const selectedCustomerLabel = state.selectedCustomer
      ? formatCustomerLine(state.selectedCustomer)
      : "Search and select a customer";

    return `
      <form class="customer-notify-form" novalidate>
        ${renderNotice()}
        <div class="customer-notify-grid">
          <section class="customer-notify-card">
            <h3>1. Select customer</h3>
            <label class="customer-notify-field">
              <span>Search customers</span>
              <input type="search" name="customerSearch" value="${attr(state.searchQuery)}" placeholder="Name, email, customer ID, or phone" autocomplete="off" />
            </label>
            <div class="customer-notify-search-meta">
              ${state.searchLoading ? "<span>Searching…</span>" : `<span>${state.searchResults.length} result(s)</span>`}
            </div>
            <label class="customer-notify-field">
              <span>Customer</span>
              <select name="customerId" required>
                <option value="">Select a customer</option>
                ${state.searchResults.map((customer) => renderCustomerOption(customer, state.selectedCustomer?.id)).join("")}
              </select>
            </label>
            <p class="customer-notify-help">Selected: <strong>${escapeHtml(selectedCustomerLabel)}</strong></p>
          </section>

          <section class="customer-notify-card">
            <h3>2. Compose notification</h3>
            <label class="customer-notify-field">
              <span>Title</span>
              <input type="text" name="title" maxlength="120" value="${attr(state.title)}" placeholder="Short notification title" required />
            </label>
            <label class="customer-notify-field">
              <span>Message</span>
              <textarea name="message" rows="6" maxlength="2000" placeholder="Write the message the customer will read in their Notification Center." required>${escapeHtml(state.message)}</textarea>
            </label>
            <label class="customer-notify-field">
              <span>Category</span>
              <select name="category">
                ${CATEGORY_OPTIONS.map((option) => {
                  const selected = option.value === state.category ? "selected" : "";
                  return `<option value="${attr(option.value)}" ${selected}>${escapeHtml(option.label)}</option>`;
                }).join("")}
              </select>
            </label>
          </section>

          <section class="customer-notify-card">
            <h3>3. Optional links</h3>
            <label class="customer-notify-field">
              <span>Related order</span>
              <select name="orderId" ${state.selectedCustomer ? "" : "disabled"}>
                ${renderOrderOptions(state.customerOrders, state.orderId)}
              </select>
            </label>
            <label class="customer-notify-field">
              <span>Search products</span>
              <input type="search" name="productSearch" value="${attr(state.productQuery)}" placeholder="Filter products by name or ID" ${state.selectedCustomer ? "" : "disabled"} />
            </label>
            <label class="customer-notify-field">
              <span>Related product</span>
              <select name="productId" ${state.selectedCustomer ? "" : "disabled"}>
                ${renderProductOptions(state.products, state.productId, state.productQuery)}
              </select>
            </label>
          </section>
        </div>

        ${state.showPreview ? buildPreviewMarkup(state) : ""}

        <div class="customer-notify-actions">
          <button type="button" class="btn btn-ghost" data-action="preview">${state.showPreview ? "Hide preview" : "Preview"}</button>
          <button type="submit" class="btn btn-primary" ${canSend ? "" : "disabled"}>${state.sending ? "Sending…" : "Send notification"}</button>
        </div>
        ${validationMessage ? `<p class="customer-notify-validation">${escapeHtml(validationMessage)}</p>` : ""}
      </form>
    `;
  }

  function render() {
    container.innerHTML = panel(
      "Customer Notifications",
      "Send a manual notification to one specific customer. Only the selected customer will receive it in their account Notification Center.",
      `<div class="customer-notify-page">${renderForm()}</div>`
    );
    bindEvents();
  }

  let searchTimer = null;

  async function runCustomerSearch(query) {
    state.searchLoading = true;
    render();
    try {
      state.searchResults = await searchCustomers(query, { maxItems: 25 });
    } catch (_error) {
      state.searchResults = [];
      state.notice = "Unable to search customers right now.";
      state.noticeTone = "danger";
    } finally {
      state.searchLoading = false;
      render();
    }
  }

  async function loadCustomerDetail(customerId) {
    if (!customerId) {
      state.selectedCustomer = null;
      state.customerOrders = [];
      state.orderId = "";
      return;
    }

    try {
      const customer = await getCustomerDetail(customerId);
      state.selectedCustomer = customer;
      state.customerOrders = Array.isArray(customer?.orders) ? customer.orders : [];
      if (state.orderId && !state.customerOrders.some((order) => String(order.id || order.orderId) === String(state.orderId))) {
        state.orderId = "";
      }
    } catch (_error) {
      state.selectedCustomer = null;
      state.customerOrders = [];
      state.orderId = "";
      state.notice = "Unable to load the selected customer.";
      state.noticeTone = "danger";
    }
  }

  function bindEvents() {
    const form = container.querySelector(".customer-notify-form");
    if (!form) return;

    const searchInput = form.querySelector('input[name="customerSearch"]');
    if (searchInput) {
      searchInput.addEventListener("input", (event) => {
        state.searchQuery = event.target.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => runCustomerSearch(state.searchQuery), 280);
      });
    }

    const customerSelect = form.querySelector('select[name="customerId"]');
    if (customerSelect) {
      customerSelect.addEventListener("change", async (event) => {
        const customerId = event.target.value;
        await loadCustomerDetail(customerId);
        render();
      });
    }

    form.querySelector('input[name="title"]')?.addEventListener("input", (event) => {
      state.title = event.target.value;
    });
    form.querySelector('textarea[name="message"]')?.addEventListener("input", (event) => {
      state.message = event.target.value;
    });
    form.querySelector('select[name="category"]')?.addEventListener("change", (event) => {
      state.category = event.target.value;
    });
    form.querySelector('select[name="orderId"]')?.addEventListener("change", (event) => {
      state.orderId = event.target.value;
    });
    form.querySelector('input[name="productSearch"]')?.addEventListener("input", (event) => {
      state.productQuery = event.target.value;
      render();
    });
    form.querySelector('select[name="productId"]')?.addEventListener("change", (event) => {
      state.productId = event.target.value;
    });

    form.querySelector('[data-action="preview"]')?.addEventListener("click", () => {
      state.showPreview = !state.showPreview;
      render();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const validationMessage = validateForm(state);
      if (validationMessage || state.sending) {
        state.notice = validationMessage || "Notification is already sending.";
        state.noticeTone = "danger";
        render();
        return;
      }

      state.sending = true;
      state.notice = "";
      render();

      try {
        const response = await sendCustomerNotification({
          customerId: state.selectedCustomer.id,
          title: state.title.trim(),
          message: state.message.trim(),
          category: state.category,
          orderId: state.orderId || undefined,
          productId: state.productId || undefined,
          idempotencyKey: state.idempotencyKey
        });

        if (!response?.success) {
          throw new Error(response?.message || "Unable to send notification.");
        }

        state.notice = response.message || "Notification sent successfully.";
        state.noticeTone = "success";
        state.title = "";
        state.message = "";
        state.orderId = "";
        state.productId = "";
        state.showPreview = false;
        state.idempotencyKey = createIdempotencyKey();
      } catch (error) {
        state.notice = error?.message || "Unable to send notification.";
        state.noticeTone = "danger";
      } finally {
        state.sending = false;
        render();
      }
    });
  }

  if (!softRefresh) {
    await runCustomerSearch("");
  }
}
