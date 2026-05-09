import { chartContainer, formatCurrency, panel, statCard, table } from "../components/ui.js";
import { getAnalytics, getDashboard, getEnterpriseOverview } from "../services/admin-data.service.js";

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

function toSeries(items, valueKey = "total") {
  return (Array.isArray(items) ? items : []).map((item) => ({
    label: item?.label || item?.month || item?.day || "-",
    total: Number(item?.[valueKey] ?? item?.total ?? item?.value ?? 0) || 0
  }));
}

function inventoryRows(overview) {
  const lowStock = overview?.analytics?.inventoryAnalytics?.lowStockProducts || [];
  return lowStock.slice(0, 12).map((product) => [
    product?.id || "-",
    product?.name || "Product",
    product?.category || "general",
    String(product?.stock ?? 0),
    product?.updatedAt ? new Date(product.updatedAt).toLocaleDateString("en-US") : "-"
  ]);
}

function topProductRows(overview) {
  const products = overview?.operationalIntelligence?.topSellingProducts || [];
  return products.slice(0, 12).map((product) => [
    product?.name || "Product",
    String(product?.quantity ?? 0),
    formatCurrency(product?.revenue ?? 0),
    String(product?.orders ?? 0)
  ]);
}

export async function renderAnalytics(container) {
  const state = {
    rangeDays: 30,
    loading: false
  };

  const render = async () => {
    state.loading = true;
    container.innerHTML = `<section class="card"><p>Loading analytics intelligence...</p></section>`;

    const [analytics, dashboard, overview] = await Promise.all([
      getAnalytics(),
      getDashboard(),
      getEnterpriseOverview({ rangeDays: state.rangeDays })
    ]);

    const summary = overview?.summary || {};
    const monitoring = overview?.operationalIntelligence?.monitoringInsights || analytics?.monitoring || {};
    const kpi = monitoring?.kpi || {};
    const source = String(monitoring?.source || analytics?.monitoring?.source || "api").toUpperCase();
    const staleLabel = String(monitoring?.staleLabel || analytics?.monitoring?.staleLabel || "just now");
    const syncedAt = asSyncLabel(overview?.generatedAt || analytics?.syncedAt || monitoring?.generatedAt);

    const revenueSeries = toSeries(overview?.analytics?.revenueAnalytics?.monthlyRevenue || analytics?.monthlyRevenue, "total");
    const salesSeries = toSeries(overview?.analytics?.salesAnalytics?.dailySeries || analytics?.weeklySales, "revenue");
    const conversionSeries = toSeries(overview?.analytics?.salesAnalytics?.dailySeries || [], "conversionRate");
    const customerGrowthSeries = toSeries(overview?.analytics?.customerAnalytics?.customerGrowth || analytics?.customerGrowth, "cumulative");
    const orderTrendSeries = toSeries(overview?.trends?.orderTrends || [], "total");
    const trafficSeries = toSeries(overview?.analytics?.trafficAnalytics?.recentActivity?.slice(0, 14).map((entry) => ({ label: entry?.eventType || entry?.path || "event", total: 1 })) || analytics?.visitorActivity, "total");

    const lowStockRows = inventoryRows(overview);
    const topRows = topProductRows(overview);

    container.innerHTML = `
      <section class="analytics-toolbar card">
        <div>
          <h1>Enterprise Ecommerce Analytics</h1>
          <p>Centralized sales, revenue, customer, inventory, conversion, and traffic intelligence.</p>
        </div>
        <label>
          <span>Range</span>
          <select id="analyticsRangeSelect">
            <option value="14" ${state.rangeDays === 14 ? "selected" : ""}>Last 14 days</option>
            <option value="30" ${state.rangeDays === 30 ? "selected" : ""}>Last 30 days</option>
            <option value="60" ${state.rangeDays === 60 ? "selected" : ""}>Last 60 days</option>
            <option value="90" ${state.rangeDays === 90 ? "selected" : ""}>Last 90 days</option>
          </select>
        </label>
      </section>

      <section class="stats-grid">
        ${statCard("Total Revenue", formatCurrency(summary.revenue || analytics?.totalRevenue || dashboard?.stats?.revenue || 0), "Centralized revenue analytics")}
        ${statCard("Orders", String(summary.ordersCount || dashboard?.stats?.ordersCount || 0), "Sales volume")}
        ${statCard("Customers", String(summary.customersCount || dashboard?.stats?.customersCount || 0), "Customer growth base")}
        ${statCard("Products", String(summary.productsCount || dashboard?.stats?.productsCount || 0), "Catalog size")}
        ${statCard("Conversion", asPercent(summary.conversionRate || analytics?.conversionRate || kpi?.conversionRate || 0), "Orders to visits")}
        ${statCard("Fulfillment", asPercent(summary.fulfillmentRate || kpi?.fulfillmentRate || 0), "Delivered order ratio")}
        ${statCard("Average Order", formatCurrency(summary.averageOrderValue || analytics?.averageOrderValue || kpi?.averageOrderValue || 0), "Revenue efficiency")}
        ${statCard("Active Carts", String(summary.activeCarts || kpi?.activeCarts || dashboard?.stats?.cartsWithItems || 0), "Cart conversion pipeline")}
      </section>

      <section class="content-grid two-col">
        ${chartContainer("Monthly Revenue", "Revenue trend by month", revenueSeries)}
        ${chartContainer("Daily Sales", "Sales trend for selected range", salesSeries)}
        ${chartContainer("Customer Growth", "Cumulative customer growth", customerGrowthSeries)}
        ${chartContainer("Order Trends", "Order volume trend", orderTrendSeries)}
        ${chartContainer("Conversion Trend", "Daily conversion progression", conversionSeries)}
        ${chartContainer("Traffic Activity", "Tracked traffic/activity signals", trafficSeries)}
      </section>

      <section class="content-grid two-col">
        ${panel("Top-Selling Products", "Best-selling product intelligence", topRows.length ? table(["Product", "Quantity", "Revenue", "Orders"], topRows) : "<p>No top-selling data available.</p>")}
        ${panel("Low-Stock Intelligence", "Inventory risk watchlist", lowStockRows.length ? table(["ID", "Product", "Category", "Stock", "Updated"], lowStockRows) : "<p>No low-stock products detected.</p>")}
        ${panel("Analytics Monitoring", "Source, freshness, and operational monitoring", `<ul class="bullet-list"><li>Source: ${source}</li><li>Freshness: ${staleLabel}</li><li>Synced: ${syncedAt}</li><li>Visits: ${Number(summary.visitsCount || kpi?.visitsCount || dashboard?.stats?.visitsCount || 0)}</li><li>Open Messages: ${Number(monitoring?.openMessages || kpi?.openMessages || 0)}</li></ul>`)}
      </section>
    `;

    const rangeSelect = document.getElementById("analyticsRangeSelect");
    rangeSelect?.addEventListener("change", async () => {
      const next = Number(rangeSelect.value || 30);
      if (next === state.rangeDays) {
        return;
      }

      state.rangeDays = Math.min(90, Math.max(14, next));
      await render();
    });

    state.loading = false;
  };

  await render();
}
