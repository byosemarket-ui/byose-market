import { badge, emptyState, formatCurrency, formatDate, loadingState, panel, statCard, table } from "../components/ui.js";
import { getOrders } from "../services/admin-data.service.js";

function statusTone(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("deliver") || value.includes("complete")) return "success";
  if (value.includes("cancel") || value.includes("return")) return "danger";
  if (value.includes("ship") || value.includes("confirm")) return "warn";
  return "neutral";
}

export async function renderOrders(container) {
  container.innerHTML = loadingState("Loading orders...");
  const allOrders = await getOrders();

  const state = { query: "", status: "all", dateFrom: "", dateTo: "", page: 0 };
  const PAGE_SIZE = 50;

  function filtered() {
    return allOrders.filter((order) => {
      const query = state.query.toLowerCase();
      if (query) {
        const id = String(order?.id || order?.orderId || "").toLowerCase();
        const name = String(order?.customerName || order?.customer || "").toLowerCase();
        const email = String(order?.customerEmail || order?.email || "").toLowerCase();
        if (!id.includes(query) && !name.includes(query) && !email.includes(query)) return false;
      }
      if (state.status !== "all" && String(order?.status || "").toLowerCase() !== state.status.toLowerCase()) return false;
      const created = new Date(order?.date || order?.createdAt || 0);
      if (state.dateFrom && created < new Date(state.dateFrom)) return false;
      if (state.dateTo && created > new Date(state.dateTo + "T23:59:59")) return false;
      return true;
    });
  }

  function render() {
    const records = filtered();
    const start = state.page * PAGE_SIZE;
    const page = records.slice(start, start + PAGE_SIZE);
    const totalPages = Math.ceil(records.length / PAGE_SIZE);

    const stats = `
      <section class="stats-grid">
        ${statCard("Total Orders", String(allOrders.length), "All time")}
        ${statCard("Filtered", String(records.length), "Current filters")}
        ${statCard("Pending", String(allOrders.filter((o) => String(o?.status || "").toLowerCase().includes("pending")).length), "Awaiting action")}
        ${statCard("Delivered", String(allOrders.filter((o) => String(o?.status || "").toLowerCase().includes("deliver")).length), "Fulfilled")}
      </section>
    `;

    const rows = page.map((order) => [
      order?.id || order?.orderId || "-",
      order?.customerName || order?.customer || "Guest",
      order?.customerEmail || order?.email || "-",
      formatCurrency(order?.total || order?.amount || 0),
      { html: badge(String(order?.status || "Pending"), statusTone(order?.status)) },
      order?.paymentMethod || order?.payment || "-",
      order?.deliveryMethod || order?.shipping || "-",
      formatDate(order?.date || order?.createdAt)
    ]);

    const pagination = totalPages > 1 ? `
      <div class="pagination-row">
        <button class="btn btn-secondary" type="button" id="ordersPrevPage" ${state.page === 0 ? "disabled" : ""}>← Previous</button>
        <span>Page ${state.page + 1} of ${totalPages} (${records.length} orders)</span>
        <button class="btn btn-secondary" type="button" id="ordersNextPage" ${state.page >= totalPages - 1 ? "disabled" : ""}>Next →</button>
      </div>
    ` : `<p class="table-count">${records.length} orders</p>`;

    const toolbar = `
      <div class="filter-toolbar">
        <label><span>Search</span><input id="ordersSearch" type="search" value="${state.query.replace(/"/g, "&quot;")}" placeholder="Order ID, customer name, email" /></label>
        <label><span>Status</span>
          <select id="ordersStatus">
            <option value="all">All statuses</option>
            <option value="Pending">Pending</option>
            <option value="Confirmed">Confirmed</option>
            <option value="Shipping">Shipping</option>
            <option value="Delivered">Delivered</option>
            <option value="Cancelled">Cancelled</option>
            <option value="Returned">Returned</option>
          </select>
        </label>
        <label><span>From</span><input id="ordersFrom" type="date" value="${state.dateFrom}" /></label>
        <label><span>To</span><input id="ordersTo" type="date" value="${state.dateTo}" /></label>
      </div>
    `;

    const content = rows.length
      ? table(["Order", "Customer", "Email", "Total", "Status", "Payment", "Shipping", "Date"], rows) + pagination
      : emptyState("No orders match the current filters.");

    container.innerHTML = `${stats}${panel("Orders", "Connected to backend and checkout flows", toolbar + content)}`;

    const searchInput = container.querySelector("#ordersSearch");
    const statusFilter = container.querySelector("#ordersStatus");
    const fromFilter = container.querySelector("#ordersFrom");
    const toFilter = container.querySelector("#ordersTo");
    if (statusFilter) statusFilter.value = state.status;

    searchInput?.addEventListener("input", () => { state.query = searchInput.value; state.page = 0; render(); });
    statusFilter?.addEventListener("change", () => { state.status = statusFilter.value; state.page = 0; render(); });
    fromFilter?.addEventListener("change", () => { state.dateFrom = fromFilter.value; state.page = 0; render(); });
    toFilter?.addEventListener("change", () => { state.dateTo = toFilter.value; state.page = 0; render(); });
    container.querySelector("#ordersPrevPage")?.addEventListener("click", () => { state.page--; render(); });
    container.querySelector("#ordersNextPage")?.addEventListener("click", () => { state.page++; render(); });
  }

  render();
}
