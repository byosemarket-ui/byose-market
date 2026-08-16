#!/usr/bin/env node
/**
 * STEP 4 Admin Quick Analytics / Decision Center checks.
 * Run: node scripts/verify-admin-quick-analytics-step4.js
 */

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.resolve(__dirname, "..");
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

async function main() {
  const dashboardJs = read("admin/app/pages/dashboard.js");
  const quickJs = read("admin/app/pages/dashboard-quick-analytics.js");
  const overviewJs = read("admin/app/pages/dashboard-overview.js");
  const statsJs = read("admin/app/pages/dashboard-statistics.js");
  const viewJs = read("admin/app/pages/dashboard-view.js");
  const css = read("admin/app/styles/quick-analytics.css");
  const appCss = read("admin/app/styles/admin-app.css");

  assert(dashboardJs.includes("buildQuickAnalyticsMarkup"), "dashboard must render Quick Analytics");
  assert(dashboardJs.includes("isQuickAnalyticsPanel"), "dashboard must branch Quick Analytics away from Overview and Statistics");
  assert(dashboardJs.includes("buildOverviewMarkup"), "Overview must remain wired");
  assert(dashboardJs.includes("buildStatisticsMarkup"), "Statistics must remain wired");
  assert(dashboardJs.includes("buildDashboardMarkup"), "legacy dashboard markup must remain available");
  assert(quickJs.includes("formatCurrency"), "Quick Analytics must use the shared RWF formatter");
  assert(quickJs.includes("#/orders?status=pending"), "pending-order action must use the real Orders filter");
  assert(quickJs.includes("#/inventory"), "inventory action must use the real Inventory destination");
  assert(quickJs.includes("#/products?view=create&step=info"), "add product must keep the real create destination");
  assert(quickJs.includes("#/dashboard?panel=statistics"), "reports action must open Statistics");
  assert(quickJs.includes("LOW_STOCK_THRESHOLD = 5"), "inventory must reuse the existing stock threshold");
  assert(!/124,?500|898,?000/.test(quickJs), "Quick Analytics must not hard-code sample revenue");
  assert(!/Kwizera/i.test(quickJs), "Quick Analytics must not copy sample-screenshot names");
  assert(!quickJs.includes("chartContainer"), "Quick Analytics must not use the dummy chart placeholder");
  assert(overviewJs.includes("overview-command"), "Overview command center must remain distinct");
  assert(statsJs.includes("stats-workspace"), "Statistics workspace must remain distinct");
  assert(css.includes(".qa-board"), "Quick Analytics styles must include the decision-board layout");
  assert(css.includes("@media (max-width: 767px)"), "Quick Analytics must include a mobile layout");
  assert(appCss.includes("./quick-analytics.css"), "Quick Analytics stylesheet must be loaded");
  assert(viewJs.includes("export function buildDashboardMarkup"), "Existing dashboard view must remain exported");

  global.window = {
    location: { hash: "#/dashboard?panel=quick-analytics", pathname: "/admin/dashboard.html" },
    localStorage: { getItem() { return null; }, setItem() {} },
    addEventListener() {},
    URL: { createObjectURL() { return "blob:test"; }, revokeObjectURL() {} }
  };
  global.document = {
    createElement() { return { click() {}, href: "", download: "" }; },
    body: { appendChild() {}, removeChild() {} }
  };

  const quickUrl = pathToFileURL(path.join(root, "admin/app/pages/dashboard-quick-analytics.js")).href;
  const overviewUrl = pathToFileURL(path.join(root, "admin/app/pages/dashboard-overview.js")).href;
  const statsUrl = pathToFileURL(path.join(root, "admin/app/pages/dashboard-statistics.js")).href;
  const viewUrl = pathToFileURL(path.join(root, "admin/app/pages/dashboard-view.js")).href;
  const { buildQuickAnalyticsMarkup, buildQuickAnalyticsModel } = await import(quickUrl);
  const { buildOverviewMarkup, buildOverviewModel } = await import(overviewUrl);
  const { buildStatisticsMarkup, buildStatisticsModel } = await import(statsUrl);
  const { buildDashboardMarkup, buildDashboardModel } = await import(viewUrl);

  const payload = {
    snapshot: { stats: { totalSales: 999999, ordersCount: 99 } },
    analytics: {},
    orders: [
      { id: "ORD-1", orderId: "ORD-1", status: "Pending", total: 15000, createdAt: "2026-08-17T08:00:00.000Z", products: [{ productId: "p1", name: "Trail Runner", quantity: 2, price: 7000, lineTotal: 14000 }] },
      { id: "ORD-2", orderId: "ORD-2", status: "Delivered", total: 10000, createdAt: "2026-08-16T08:00:00.000Z", products: [{ productId: "p1", name: "Trail Runner", quantity: 1, price: 7000, lineTotal: 7000 }] },
      { id: "ORD-3", orderId: "ORD-3", status: "Cancelled", total: 8000, createdAt: "2026-08-17T09:00:00.000Z", products: [{ productId: "p2", name: "City Loafer", quantity: 1, price: 8000, lineTotal: 8000 }] }
    ],
    customers: [
      { id: "c1", name: "Ada", joinedAt: "2026-08-17T07:00:00.000Z", totalOrders: 1 },
      { id: "c2", name: "Ben", joinedAt: "2026-01-01T00:00:00.000Z", totalOrders: 4 }
    ],
    products: [
      { id: "p1", name: "Trail Runner", stock: 4, status: "active" },
      { id: "p2", name: "City Loafer", stock: 0, status: "active" },
      { id: "p3", name: "Garden Clog", stock: 18, status: "active" }
    ],
    failedSources: []
  };

  const today = buildQuickAnalyticsModel(payload, "today");
  assert(today.revenue === 15000, "today's revenue must exclude cancelled orders");
  assert(today.ordersCount === 2, "today's orders must count every captured order including cancelled");
  assert(today.averageOrderValue === 15000, "AOV must use eligible orders only");
  assert(today.pendingOrders === 1, "pending attention must use real pending statuses");
  assert(today.outOfStock.some((item) => item.name === "City Loafer"), "out-of-stock alerts must use real inventory");
  assert(today.lowStock.some((item) => item.name === "Trail Runner"), "low-stock alerts must reuse the existing threshold");
  assert(today.topProducts[0]?.name === "Trail Runner", "product highlights must use eligible sales");
  assert(today.newCustomers === 1, "customer activity must use real registration dates");
  assert(today.alerts.some((alert) => /out of stock/i.test(alert.title)), "alerts must come from actual conditions");
  assert(today.revenueChange == null || Number.isFinite(today.revenueChange), "comparisons must not become Infinity");

  const todayMarkup = buildQuickAnalyticsMarkup(today);
  assert(todayMarkup.includes("RWF 15,000"), "revenue must render with the shared RWF formatter");
  assert(todayMarkup.includes("#/orders?status=pending"), "View pending orders must stay wired");
  assert(todayMarkup.includes("#/products?view=create&step=info"), "Add product must stay wired");
  assert(!todayMarkup.includes("overview-command"), "Quick Analytics must not reuse Overview markup");
  assert(!todayMarkup.includes("stats-workspace"), "Quick Analytics must not reuse Statistics markup");
  assert(todayMarkup.includes("qa-workspace"), "Quick Analytics must use its own decision-center layout");

  const empty = buildQuickAnalyticsModel({
    snapshot: { stats: {} },
    analytics: {},
    orders: [],
    customers: [],
    products: [{ id: "p3", name: "Garden Clog", stock: 18 }],
    failedSources: []
  }, "today");
  const emptyMarkup = buildQuickAnalyticsMarkup(empty);
  assert(emptyMarkup.includes("No pending orders"), "empty order attention must stay compact");
  assert(emptyMarkup.includes("No low-stock products") || empty.lowStock.length === 0, "healthy inventory must not invent low-stock alerts");
  assert(empty.alerts.some((alert) => /no issues requiring action/i.test(alert.title)), "empty operational state must not invent problems");

  const failed = buildQuickAnalyticsMarkup(buildQuickAnalyticsModel({
    snapshot: { stats: {} },
    analytics: {},
    orders: [],
    customers: [{ id: "c1", name: "Ada", joinedAt: "2026-08-17T07:00:00.000Z" }],
    products: [],
    failedSources: ["orders: Request failed"]
  }, "today"));
  assert(failed.includes("Unable to load revenue."), "order API failure must stay local");
  assert(failed.includes("Customer activity"), "customer section must remain when orders fail");
  assert(failed.includes("Quick actions"), "failed sections must not remove working actions");

  const overviewMarkup = buildOverviewMarkup(buildOverviewModel(payload, "week"));
  const statsMarkup = buildStatisticsMarkup(buildStatisticsModel(payload, { key: "month" }));
  assert(overviewMarkup.includes("overview-command"), "Overview remains the command center");
  assert(statsMarkup.includes("stats-workspace"), "Statistics remains the analytics workspace");

  const legacy = buildDashboardMarkup(buildDashboardModel({
    snapshot: { stats: { revenue: 0, orders: 0, customers: 0, products: 0 } },
    analytics: {},
    orders: [],
    customers: [],
    products: [],
    activityLogs: [],
    carts: [],
    failedSources: ["orders: Request failed"]
  }));
  assert(legacy.includes("dashboard-grid"), "legacy dashboard markup must remain exported");

  if (failures.length) {
    console.error("FAIL verify-admin-quick-analytics-step4");
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log("PASS verify-admin-quick-analytics-step4");
  console.log(" - Quick Analytics uses period-focused real operational data");
  console.log(" - Alerts and actions stay tied to existing Admin destinations");
  console.log(" - Overview and Statistics remain separate");
}

main().catch((error) => {
  console.error("FAIL verify-admin-quick-analytics-step4");
  console.error(error);
  process.exit(1);
});
