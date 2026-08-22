import { badge, emptyState, panel, statCard, table } from "../components/ui.js";
import { getInventory } from "../services/admin-data.service.js";

export async function renderInventory(container) {
  const inventory = await getInventory();
  const entries = Array.isArray(inventory?.entries) ? inventory.entries : [];

  const top = `
    <section class="stats-grid">
      ${statCard("Total SKU", String(inventory?.totalSku || 0), "Catalog stock units")}
      ${statCard("Physical", String(inventory?.totalPhysical || 0), "On-hand including reserved")}
      ${statCard("Reserved", String(inventory?.totalReserved || 0), "Held by unpaid/COD orders")}
      ${statCard("Available", String(inventory?.totalStock || 0), "Sellable now")}
      ${statCard("Sold", String(inventory?.totalSold || 0), "Committed after payment")}
      ${statCard("Low Stock", String(inventory?.lowStock || 0), "Available <= 5")}
    </section>
  `;

  if (!entries.length) {
    container.innerHTML = `${top}${panel("Inventory", "Stock health", emptyState("No inventory entries available."))}`;
    return;
  }

  const rows = entries.slice(0, 200).map((entry) => {
    const available = Number(entry?.availableStock ?? entry?.stock ?? 0);
    const reserved = Number(entry?.reservedStock || 0);
    const physical = Number(entry?.physicalStock || (available + reserved));
    const sold = Number(entry?.soldStock || 0);
    const health = available <= 0 ? "Out" : available <= 5 ? "Low" : "Healthy";
    return [
      entry?.name || "-",
      entry?.variantLabel || "Default",
      entry?.sku || entry?.id || "-",
      String(physical),
      String(reserved),
      String(available),
      String(sold),
      health
    ];
  });

  const rendered = table(
    ["Product", "SKU / Variant", "Code", "Physical", "Reserved", "Available", "Sold", "Health"],
    rows
  )
    .replace(/<td>Out<\/td>/g, `<td>${badge("Out", "danger")}</td>`)
    .replace(/<td>Low<\/td>/g, `<td>${badge("Low", "danger")}</td>`)
    .replace(/<td>Healthy<\/td>/g, `<td>${badge("Healthy", "success")}</td>`);

  container.innerHTML = `${top}${panel("Inventory", "Physical, reserved, available, and sold quantities by SKU", rendered)}`;
}
