import { emptyState, formatCurrency, panel, table } from "../components/ui.js";
import { getCustomers } from "../services/admin-data.service.js";

export async function renderCustomers(container) {
  const customers = await getCustomers();

  if (!customers.length) {
    container.innerHTML = panel("Customers", "Customer account directory", emptyState("No customers found."));
    return;
  }

  const rows = customers.slice(0, 40).map((customer) => [
    customer?.name || "Unnamed",
    customer?.email || "-",
    customer?.phone || "-",
    String(customer?.totalOrders || 0),
    formatCurrency(customer?.totalSpent || 0)
  ]);

  container.innerHTML = panel(
    "Customers",
    "Audience and account health overview",
    table(["Name", "Email", "Phone", "Orders", "Total Spent"], rows)
  );
}
