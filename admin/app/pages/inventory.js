import { badge, emptyState, panel, statCard, table } from "../components/ui.js";
import { getInventory } from "../services/admin-data.service.js";

export async function renderInventory(container) {
  const inventory = await getInventory();
  const entries = Array.isArray(inventory?.entries) ? inventory.entries : [];

  const top = `
    <section class="stats-grid">
      ${statCard("Total SKU", String(inventory?.totalSku || 0), "Catalog stock units")}
      ${statCard("Total Stock", String(inventory?.totalStock || 0), "Sum across products")}
      ${statCard("Low Stock", String(inventory?.lowStock || 0), "Threshold <= 5")}
      ${statCard("Realtime Ready", "Enabled", "Inventory stream adapter slot prepared")}
    </section>
  `;

  if (!entries.length) {
    container.innerHTML = `${top}${panel("Inventory", "Stock health", emptyState("No inventory entries available."))}`;
    return;
  }

  const rows = entries.slice(0, 50).map((entry) => [
    entry?.name || "-",
    entry?.sku || entry?.id || "-",
    String(entry?.stock || 0),
    Number(entry?.stock || 0) <= 5 ? "Low" : "Healthy"
  ]);

  const rendered = table(["Product", "SKU", "Stock", "Health"], rows)
    .replace(/<td>Low<\/td>/g, `<td>${badge("Low", "danger")}</td>`)
    .replace(/<td>Healthy<\/td>/g, `<td>${badge("Healthy", "success")}</td>`);

  container.innerHTML = `${top}${panel("Inventory", "Stock control and replenishment", rendered)}`;
}
