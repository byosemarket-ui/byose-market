import { emptyState, formatCurrency, panel, table } from "../components/ui.js";
import { getProducts } from "../services/admin-data.service.js";

export async function renderProducts(container) {
  const products = await getProducts();

  if (!products.length) {
    container.innerHTML = panel("Products", "Catalog management", emptyState("No products found."));
    return;
  }

  const rows = products.slice(0, 60).map((product) => [
    product?.name || product?.title || "-",
    product?.category || "general",
    formatCurrency(product?.price || 0),
    String(product?.stock || 0),
    product?.visibility || "both"
  ]);

  container.innerHTML = panel(
    "Products",
    "Live catalog records from ecommerce backend",
    table(["Product", "Category", "Price", "Stock", "Visibility"], rows)
  );
}
