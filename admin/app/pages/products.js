import { badge, emptyState, formatCurrency, loadingState, panel, statCard, table } from "../components/ui.js";
import { getProducts } from "../services/admin-data.service.js";

function stockTone(stock) {
  const n = Number(stock || 0);
  if (n === 0) return "danger";
  if (n <= 5) return "warn";
  return "success";
}

export async function renderProducts(container) {
  container.innerHTML = loadingState("Loading products...");
  const allProducts = await getProducts();

  const categories = [...new Set(allProducts.map((p) => p?.category || "general").filter(Boolean))].sort();
  const state = { query: "", category: "all", stockFilter: "all", page: 0 };
  const PAGE_SIZE = 60;

  function filtered() {
    return allProducts.filter((product) => {
      const q = state.query.toLowerCase();
      if (q && !String(product?.name || product?.title || "").toLowerCase().includes(q)) return false;
      if (state.category !== "all" && (product?.category || "general") !== state.category) return false;
      const stock = Number(product?.stock || 0);
      if (state.stockFilter === "low" && (stock === 0 || stock > 5)) return false;
      if (state.stockFilter === "out" && stock !== 0) return false;
      if (state.stockFilter === "healthy" && stock <= 5) return false;
      return true;
    });
  }

  function render() {
    const records = filtered();
    const start = state.page * PAGE_SIZE;
    const page = records.slice(start, start + PAGE_SIZE);
    const totalPages = Math.ceil(records.length / PAGE_SIZE);

    const outOfStock = allProducts.filter((p) => Number(p?.stock || 0) === 0).length;
    const lowStock = allProducts.filter((p) => { const s = Number(p?.stock || 0); return s > 0 && s <= 5; }).length;

    const stats = `
      <section class="stats-grid">
        ${statCard("Total Products", String(allProducts.length), "Catalog size")}
        ${statCard("Filtered", String(records.length), "Current filters")}
        ${statCard("Low Stock", String(lowStock), "1-5 units remaining")}
        ${statCard("Out of Stock", String(outOfStock), "Zero inventory")}
      </section>
    `;

    const rows = page.map((product) => [
      product?.name || product?.title || "-",
      product?.category || "general",
      formatCurrency(product?.price || 0),
      { html: badge(String(product?.stock || 0), stockTone(product?.stock)) },
      product?.visibility || "both"
    ]);

    const categoryOptions = categories.map((cat) => `<option value="${cat}">${cat}</option>`).join("");

    const pagination = totalPages > 1 ? `
      <div class="pagination-row">
        <button class="btn btn-secondary" type="button" id="prodPrev" ${state.page === 0 ? "disabled" : ""}>← Previous</button>
        <span>Page ${state.page + 1} of ${totalPages} (${records.length} products)</span>
        <button class="btn btn-secondary" type="button" id="prodNext" ${state.page >= totalPages - 1 ? "disabled" : ""}>Next →</button>
      </div>
    ` : `<p class="table-count">${records.length} products</p>`;

    const toolbar = `
      <div class="filter-toolbar">
        <label><span>Search</span><input id="prodSearch" type="search" value="${state.query.replace(/"/g, "&quot;")}" placeholder="Product name" /></label>
        <label><span>Category</span>
          <select id="prodCategory">
            <option value="all">All categories</option>
            ${categoryOptions}
          </select>
        </label>
        <label><span>Stock</span>
          <select id="prodStock">
            <option value="all">All stock levels</option>
            <option value="healthy">Healthy (>5)</option>
            <option value="low">Low (1-5)</option>
            <option value="out">Out of stock</option>
          </select>
        </label>
      </div>
    `;

    const content = rows.length
      ? table(["Product", "Category", "Price", "Stock", "Visibility"], rows) + pagination
      : emptyState("No products match the current filters.");

    container.innerHTML = `${stats}${panel("Products", "Live catalog records from ecommerce backend", toolbar + content)}`;

    const searchInput = container.querySelector("#prodSearch");
    const catFilter = container.querySelector("#prodCategory");
    const stockFilter = container.querySelector("#prodStock");
    if (catFilter) catFilter.value = state.category;
    if (stockFilter) stockFilter.value = state.stockFilter;

    searchInput?.addEventListener("input", () => { state.query = searchInput.value; state.page = 0; render(); });
    catFilter?.addEventListener("change", () => { state.category = catFilter.value; state.page = 0; render(); });
    stockFilter?.addEventListener("change", () => { state.stockFilter = stockFilter.value; state.page = 0; render(); });
    container.querySelector("#prodPrev")?.addEventListener("click", () => { state.page--; render(); });
    container.querySelector("#prodNext")?.addEventListener("click", () => { state.page++; render(); });
  }

  render();
}
