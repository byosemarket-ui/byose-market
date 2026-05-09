import { badge, emptyState, panel, statCard, table } from "../components/ui.js";
import { getInventory, getEnterpriseOverview } from "../services/admin-data.service.js";

export async function renderInventory(container) {
  const [inventory, overview] = await Promise.allSettled([getInventory(), getEnterpriseOverview({ rangeDays: 30 })]);
  const inv = inventory.status === "fulfilled" ? inventory.value : {};
  const intel = overview.status === "fulfilled" ? overview.value : null;

  const entries = Array.isArray(inv?.entries) ? inv.entries : [];
  const invAnalytics = intel?.analytics?.inventoryAnalytics || {};
  const lowStockItems = Array.isArray(invAnalytics.lowStockProducts) ? invAnalytics.lowStockProducts : [];
  const outOfStockItems = Array.isArray(invAnalytics.outOfStockProducts) ? invAnalytics.outOfStockProducts : [];
  const topProducts = Array.isArray(intel?.analytics?.topProducts) ? intel.analytics.topProducts.slice(0, 10) : [];

  const top = `
    <section class="stats-grid">
      ${statCard("Total SKU", String(inv?.totalSku || 0), "Catalog stock units")}
      ${statCard("Total Stock", String(inv?.totalStock || 0), "Sum across products")}
      ${statCard("Low Stock", String(invAnalytics.lowStockCount ?? inv?.lowStock ?? 0), "Threshold ≤ 5 units")}
      ${statCard("Out of Stock", String(invAnalytics.outOfStockCount ?? 0), "Zero inventory items")}
    </section>
  `;

  const lowStockRows = lowStockItems.map((item) => [
    item?.name || "-",
    item?.sku || item?.id || "-",
    { html: badge(String(item?.stock ?? 0), "warn") },
    item?.category || "-"
  ]);

  const outOfStockRows = outOfStockItems.map((item) => [
    item?.name || "-",
    item?.sku || item?.id || "-",
    { html: badge("0", "danger") },
    item?.category || "-"
  ]);

  const topRows = topProducts.map((item) => [
    item?.name || "-",
    String(item?.quantity || 0),
    String(item?.revenue ? `${Number(item.revenue).toFixed(2)}` : "-")
  ]);

  const mainRows = entries.slice(0, 80).map((entry) => [
    entry?.name || "-",
    entry?.sku || entry?.id || "-",
    String(entry?.stock || 0),
    Number(entry?.stock || 0) === 0 ? { html: badge("Out", "danger") } : Number(entry?.stock || 0) <= 5 ? { html: badge("Low", "warn") } : { html: badge("OK", "success") }
  ]);

  container.innerHTML = `
    ${top}
    ${lowStockItems.length ? panel("Low Stock Alert", "Products needing replenishment (≤ 5 units)", table(["Product", "SKU", "Stock", "Category"], lowStockRows)) : ""}
    ${outOfStockItems.length ? panel("Out of Stock", "Products with zero inventory", table(["Product", "SKU", "Stock", "Category"], outOfStockRows)) : ""}
    ${topRows.length ? panel("Top-Selling Products", "Revenue leaders from the last 30 days", table(["Product", "Units Sold", "Revenue"], topRows)) : ""}
    ${panel("Full Inventory", "Stock control and replenishment", entries.length ? table(["Product", "SKU", "Stock", "Health"], mainRows) : emptyState("No inventory entries available."))}
  `;
}
