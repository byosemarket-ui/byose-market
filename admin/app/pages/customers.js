import { emptyState, formatCurrency, formatDate, panel, table } from "../components/ui.js";
import { getCustomers, updateCustomerStatus } from "../services/admin-data.service.js";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function statusBadge(status) {
  const normalized = String(status || "active").toLowerCase();
  const label = normalized === "blocked" ? "Disabled" : "Active";
  const className = normalized === "blocked" ? "badge badge-danger" : "badge badge-success";
  return `<span class="${className}">${label}</span>`;
}

function actionButtons(customer) {
  const id = escapeHtml(customer.id);
  const isBlocked = String(customer.status || "active").toLowerCase() === "blocked";
  const nextStatus = isBlocked ? "active" : "blocked";
  const label = isBlocked ? "Activate" : "Disable";
  return `<button type="button" class="btn btn-sm" data-customer-action="${nextStatus}" data-customer-id="${id}">${label}</button>`;
}

function filterCustomers(customers, query, status) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const normalizedStatus = String(status || "").trim().toLowerCase();

  return customers.filter((customer) => {
    const matchesStatus = !normalizedStatus || String(customer.status || "active").toLowerCase() === normalizedStatus;
    if (!matchesStatus) return false;
    if (!normalizedQuery) return true;

    const haystack = [
      customer.id,
      customer.name,
      customer.email,
      customer.phone
    ].join(" ").toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}

function renderToolbar(container, state, onChange) {
  const toolbar = document.createElement("div");
  toolbar.className = "customers-toolbar";
  toolbar.innerHTML = `
    <input type="search" class="input" id="customersSearch" placeholder="Search name, email, phone, ID" value="${escapeHtml(state.query)}" />
    <select class="input" id="customersStatusFilter">
      <option value="">All statuses</option>
      <option value="active"${state.status === "active" ? " selected" : ""}>Active</option>
      <option value="blocked"${state.status === "blocked" ? " selected" : ""}>Disabled</option>
    </select>
    <button type="button" class="btn btn-primary" id="customersRefreshBtn">Refresh</button>
  `;

  toolbar.querySelector("#customersSearch").addEventListener("input", (event) => {
    onChange({ query: event.target.value });
  });
  toolbar.querySelector("#customersStatusFilter").addEventListener("change", (event) => {
    onChange({ status: event.target.value });
  });
  toolbar.querySelector("#customersRefreshBtn").addEventListener("click", () => {
    onChange({ force: true });
  });

  container.appendChild(toolbar);
}

function renderTable(customers) {
  if (!customers.length) {
    return emptyState("No customers match your filters.");
  }

  const rows = customers.map((customer) => [
    customer.id || "-",
    customer.name || "Unnamed",
    customer.email || "-",
    customer.phone || "-",
    formatDate(customer.joinedAt),
    customer.lastLoginAt ? formatDate(customer.lastLoginAt) : "-",
    { html: statusBadge(customer.status) },
    String(customer.totalOrders || 0),
    formatCurrency(customer.totalSpent || 0),
    { html: actionButtons(customer) }
  ]);

  return table(
    ["ID", "Name", "Email", "Phone", "Registered", "Last Login", "Status", "Orders", "Spent", "Actions"],
    rows
  );
}

export async function renderCustomers(container) {
  container.innerHTML = panel("Customers", "Loading customer directory...", `<div class="state-block">Loading...</div>`);

  let state = { query: "", status: "", force: false };

  async function loadAndRender() {
    const customers = await getCustomers({ force: state.force, emit: false });
    state.force = false;

    const filtered = filterCustomers(customers, state.query, state.status);
    container.innerHTML = panel(
      "Customers",
      `${filtered.length} of ${customers.length} accounts`,
      `<div id="customersToolbarHost"></div><div id="customersTableHost">${renderTable(filtered)}</div>`
    );

    const toolbarHost = container.querySelector("#customersToolbarHost");
    renderToolbar(toolbarHost, state, async (next) => {
      state = { ...state, ...next };
      await loadAndRender();
    });

    container.querySelector("#customersTableHost").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-customer-action]");
      if (!button) return;

      const customerId = button.getAttribute("data-customer-id");
      const nextStatus = button.getAttribute("data-customer-action");
      button.disabled = true;

      try {
        await updateCustomerStatus(customerId, nextStatus);
        state.force = true;
        await loadAndRender();
      } catch (error) {
        button.disabled = false;
        alert(error?.message || "Unable to update customer status.");
      }
    });
  }

  await loadAndRender();
}
