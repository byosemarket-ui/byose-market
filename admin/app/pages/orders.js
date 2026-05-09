import { badge, emptyState, formatCurrency, formatDate, panel, table } from "../components/ui.js";
import { getOrders } from "../services/admin-data.service.js";

function statusTone(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("deliver") || value.includes("complete")) return "success";
  if (value.includes("cancel") || value.includes("return")) return "danger";
  if (value.includes("ship") || value.includes("confirm")) return "warn";
  return "neutral";
}

export async function renderOrders(container) {
  const orders = await getOrders();

  if (!orders.length) {
    container.innerHTML = panel("Orders", "Live backend orders", emptyState("No orders found."));
    return;
  }

  const rows = orders.slice(0, 40).map((order) => [
    order?.id || order?.orderId || "-",
    order?.customerName || order?.customer || "Guest",
    formatCurrency(order?.total || order?.amount || 0),
    String(order?.status || "Pending"),
    formatDate(order?.date || order?.createdAt)
  ]);

  const html = table(["Order", "Customer", "Total", "Status", "Date"], rows);
  const enriched = html.replace(/<td>(Pending|Confirmed|Shipping|Delivered|Cancelled|Returned)<\/td>/g, (match, value) => `<td>${badge(value, statusTone(value))}</td>`);
  container.innerHTML = panel("Orders", "Connected to backend and checkout flows", enriched);
}
