import { chartContainer, formatCurrency, panel, statCard } from "../components/ui.js";
import { getAnalytics, getDashboard } from "../services/admin-data.service.js";

function asPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function asSyncLabel(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export async function renderAnalytics(container) {
  const [analytics, dashboard] = await Promise.all([getAnalytics(), getDashboard()]);

  const totalRevenue = analytics?.totalRevenue || dashboard?.stats?.revenue || dashboard?.stats?.totalSales || 0;
  const avgOrder = analytics?.averageOrderValue || 0;
  const monitoring = analytics?.monitoring || {};
  const kpi = monitoring?.kpi || {};
  const conversionRate = Number(kpi?.conversionRate || analytics?.conversionRate || 0);
  const fulfillmentRate = Number(kpi?.fulfillmentRate || 0);
  const source = String(monitoring?.source || "api").toUpperCase();
  const staleLabel = String(monitoring?.staleLabel || "just now");
  const syncedAt = asSyncLabel(analytics?.syncedAt || monitoring?.syncedAt);

  container.innerHTML = `
    <section class="stats-grid">
      ${statCard("Total Revenue", formatCurrency(totalRevenue), "Backend analytics summary")}
      ${statCard("Avg Order Value", formatCurrency(avgOrder), "Calculated from available order data")}
      ${statCard("Conversion", asPercent(conversionRate), "Realtime order-to-visit conversion")}
      ${statCard("Fulfillment", asPercent(fulfillmentRate), "Completed order execution rate")}
      ${statCard("Returning Customers", String(analytics?.returningCustomers || 0), "Loyalty indicator")}
      ${statCard("Open Support", String(kpi?.openMessages || 0), "New shared inbox items")}
    </section>
    <section class="content-grid two-col">
      ${chartContainer("Revenue Performance", "Monthly backend revenue trend", analytics?.monthlyRevenue || [])}
      ${chartContainer("Customer Growth", "Rolling customer acquisition", analytics?.customerGrowth || [])}
      ${chartContainer("Weekly Sales", "Last 7-day order revenue series", analytics?.weeklySales || [])}
      ${chartContainer("Visitor Activity", "Tracked visit intensity by day", analytics?.visitorActivity || [])}
      ${panel("Analytics Health", "Realtime synchronization and source status", `<ul class="bullet-list"><li>Source: ${source}</li><li>Freshness: ${staleLabel}</li><li>Synced: ${syncedAt}</li><li>Low Stock Alerts: ${Number(kpi?.lowStock || 0)}</li></ul>`) }
    </section>
  `;
}
