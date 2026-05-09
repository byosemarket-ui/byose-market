import { emptyState, formatCurrency, formatDate, loadingState, panel, statCard, table } from "../components/ui.js";
import { getCustomers } from "../services/admin-data.service.js";

export async function renderCustomers(container) {
  container.innerHTML = loadingState("Loading customers...");
  const allCustomers = await getCustomers();

  const state = { query: "", sortBy: "totalSpent", page: 0 };
  const PAGE_SIZE = 50;

  function filtered() {
    let records = allCustomers;
    if (state.query) {
      const q = state.query.toLowerCase();
      records = records.filter((c) =>
        String(c?.name || "").toLowerCase().includes(q) ||
        String(c?.email || "").toLowerCase().includes(q) ||
        String(c?.phone || "").toLowerCase().includes(q)
      );
    }
    if (state.sortBy === "totalSpent") {
      records = [...records].sort((a, b) => Number(b?.totalSpent || 0) - Number(a?.totalSpent || 0));
    } else if (state.sortBy === "totalOrders") {
      records = [...records].sort((a, b) => Number(b?.totalOrders || 0) - Number(a?.totalOrders || 0));
    } else if (state.sortBy === "newest") {
      records = [...records].sort((a, b) => new Date(b?.joinedAt || b?.createdAt || 0).getTime() - new Date(a?.joinedAt || a?.createdAt || 0).getTime());
    }
    return records;
  }

  function render() {
    const records = filtered();
    const start = state.page * PAGE_SIZE;
    const page = records.slice(start, start + PAGE_SIZE);
    const totalPages = Math.ceil(records.length / PAGE_SIZE);

    const totalRevenue = allCustomers.reduce((sum, c) => sum + Number(c?.totalSpent || 0), 0);
    const repeatCustomers = allCustomers.filter((c) => Number(c?.totalOrders || 0) > 1).length;

    const stats = `
      <section class="stats-grid">
        ${statCard("Total Customers", String(allCustomers.length), "Registered accounts")}
        ${statCard("Filtered", String(records.length), "Current search")}
        ${statCard("Repeat Buyers", String(repeatCustomers), "More than 1 order")}
        ${statCard("Total Revenue", formatCurrency(totalRevenue), "Across all customers")}
      </section>
    `;

    const rows = page.map((customer) => [
      customer?.name || "Unnamed",
      customer?.email || "-",
      customer?.phone || "-",
      String(customer?.totalOrders || 0),
      formatCurrency(customer?.totalSpent || 0),
      formatDate(customer?.joinedAt || customer?.createdAt)
    ]);

    const pagination = totalPages > 1 ? `
      <div class="pagination-row">
        <button class="btn btn-secondary" type="button" id="custPrev" ${state.page === 0 ? "disabled" : ""}>← Previous</button>
        <span>Page ${state.page + 1} of ${totalPages} (${records.length} customers)</span>
        <button class="btn btn-secondary" type="button" id="custNext" ${state.page >= totalPages - 1 ? "disabled" : ""}>Next →</button>
      </div>
    ` : `<p class="table-count">${records.length} customers</p>`;

    const toolbar = `
      <div class="filter-toolbar">
        <label><span>Search</span><input id="custSearch" type="search" value="${state.query.replace(/"/g, "&quot;")}" placeholder="Name, email, or phone" /></label>
        <label><span>Sort by</span>
          <select id="custSort">
            <option value="totalSpent">Highest spend</option>
            <option value="totalOrders">Most orders</option>
            <option value="newest">Newest</option>
          </select>
        </label>
      </div>
    `;

    const content = rows.length
      ? table(["Name", "Email", "Phone", "Orders", "Total Spent", "Joined"], rows) + pagination
      : emptyState("No customers match the current filters.");

    container.innerHTML = `${stats}${panel("Customers", "Audience and account health overview", toolbar + content)}`;

    const searchInput = container.querySelector("#custSearch");
    const sortSelect = container.querySelector("#custSort");
    if (sortSelect) sortSelect.value = state.sortBy;

    searchInput?.addEventListener("input", () => { state.query = searchInput.value; state.page = 0; render(); });
    sortSelect?.addEventListener("change", () => { state.sortBy = sortSelect.value; state.page = 0; render(); });
    container.querySelector("#custPrev")?.addEventListener("click", () => { state.page--; render(); });
    container.querySelector("#custNext")?.addEventListener("click", () => { state.page++; render(); });
  }

  render();
}
