#!/usr/bin/env node
/**
 * STEP 3 Admin Statistics workspace checks.
 * Run: node scripts/verify-admin-statistics-step3.js
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
  const statsJs = read("admin/app/pages/dashboard-statistics.js");
  const overviewJs = read("admin/app/pages/dashboard-overview.js");
  const viewJs = read("admin/app/pages/dashboard-view.js");
  const statsCss = read("admin/app/styles/statistics.css");
  const appCss = read("admin/app/styles/admin-app.css");

  assert(dashboardJs.includes("buildStatisticsMarkup"), "dashboard must render the Statistics workspace");
  assert(dashboardJs.includes("isStatisticsPanel"), "dashboard must branch Statistics away from Overview and Quick Analytics");
  assert(dashboardJs.includes("buildOverviewMarkup"), "Overview command center must remain wired");
  assert(dashboardJs.includes("buildDashboardMarkup"), "Quick Analytics must keep the existing dashboard markup");
  assert(dashboardJs.includes("getOrders("), "Statistics must reuse getOrders");
  assert(dashboardJs.includes("getCustomers("), "Statistics must reuse getCustomers");
  assert(dashboardJs.includes("getProducts("), "Statistics must reuse getProducts");
  assert(statsJs.includes("formatCurrency"), "Statistics must use the shared RWF formatter");
  assert(statsJs.includes("downloadCsvFile"), "Export must use the existing CSV helper");
  assert(statsJs.includes("This Week"), "Statistics must include supported period controls");
  assert(statsJs.includes("Custom Range"), "Statistics must reuse a native custom date range");
  assert(statsJs.includes("No previous-period comparison"), "zero previous periods must not become Infinity%");
  assert(!/898,?000|847,?000/.test(statsJs), "Statistics must not hard-code sample revenue");
  assert(!/Kwizera/i.test(statsJs), "Statistics must not copy sample-screenshot names");
  assert(overviewJs.includes("overview-command"), "Overview markup must remain distinct");
  assert(statsCss.includes(".stats-summary"), "Statistics styles must include the summary grid");
  assert(statsCss.includes("@media (max-width: 767px)"), "Statistics must include a mobile layout");
  assert(appCss.includes("./statistics.css"), "Statistics stylesheet must be loaded");
  assert(viewJs.includes("export function buildDashboardMarkup"), "Existing dashboard view must remain exported");

  global.window = {
    location: { hash: "#/dashboard?panel=statistics", pathname: "/admin/dashboard.html" },
    localStorage: { getItem() { return null; }, setItem() {} },
    addEventListener() {},
    URL: { createObjectURL() { return "blob:test"; }, revokeObjectURL() {} }
  };
  global.document = {
    createElement() {
      return { click() {}, href: "", download: "" };
    },
    body: { appendChild() {}, removeChild() {} }
  };

  const statsUrl = pathToFileURL(path.join(root, "admin/app/pages/dashboard-statistics.js")).href;
  const viewUrl = pathToFileURL(path.join(root, "admin/app/pages/dashboard-view.js")).href;
  const overviewUrl = pathToFileURL(path.join(root, "admin/app/pages/dashboard-overview.js")).href;
  const { buildStatisticsMarkup, buildStatisticsModel } = await import(statsUrl);
  const { buildDashboardMarkup, buildDashboardModel } = await import(viewUrl);
  const { buildOverviewMarkup, buildOverviewModel } = await import(overviewUrl);

  const payload = {
    snapshot: { stats: { totalSales: 999999, ordersCount: 99, customersCount: 88, productsCount: 77 } },
    analytics: {},
    orders: [
      { id: "ORD-1", orderId: "ORD-1", customerName: "Ada", status: "Pending", total: 15000, createdAt: "2026-08-17T08:00:00.000Z", products: [{ productId: "p1", name: "Trail Runner", quantity: 2, price: 7000, lineTotal: 14000 }] },
      { id: "ORD-2", orderId: "ORD-2", customerName: "Ben", status: "Delivered", total: 10000, createdAt: "2026-08-16T08:00:00.000Z", products: [{ productId: "p1", name: "Trail Runner", quantity: 1, price: 7000, lineTotal: 7000 }] },
      { id: "ORD-3", orderId: "ORD-3", customerName: "Cara", status: "Cancelled", total: 8000, createdAt: "2026-08-15T08:00:00.000Z", products: [{ productId: "p2", name: "City Loafer", quantity: 1, price: 8000, lineTotal: 8000 }] }
    ],
    customers: [
      { id: "c1", name: "Ada", joinedAt: "2026-08-16T00:00:00.000Z", totalOrders: 1 },
      { id: "c2", name: "Ben", joinedAt: "2026-01-01T00:00:00.000Z", totalOrders: 4 }
    ],
    products: [
      { id: "p1", name: "Trail Runner", stock: 4, status: "active" },
      { id: "p2", name: "City Loafer", stock: 0, status: "active" }
    ],
    activityLogs: [],
    failedSources: []
  };

  const monthModel = buildStatisticsModel(payload, { key: "month" });
  assert(monthModel.revenue === 25000, "cancelled orders must be excluded from period revenue");
  assert(monthModel.ordersCount === 3, "order analytics must count every captured order in the period");
  assert(monthModel.eligibleCount === 2, "average order value must use eligible orders only");
  assert(monthModel.averageOrderValue === 12500, "AOV must equal eligible revenue divided by eligible orders");
  assert(monthModel.revenueChange == null, "a zero previous period must not invent a percentage");
  assert(monthModel.statusBreakdown.some((item) => item.label === "Cancelled" && item.value === 1), "status distribution must use real order statuses");
  assert(monthModel.topProducts[0]?.name === "Trail Runner", "product performance must use real eligible sales");
  assert(!monthModel.topProducts.some((item) => item.name === "City Loafer"), "cancelled order products must not rank as top sellers");
  assert(monthModel.unitsSold === 3, "units sold must come from eligible line items");
  assert(monthModel.newCustomers === 1, "new customers must use joined dates inside the period");

  const monthMarkup = buildStatisticsMarkup(monthModel);
  assert(monthMarkup.includes("RWF 25,000"), "revenue must render with the shared RWF formatter");
  assert(monthMarkup.includes("RWF 12,500"), "AOV must render from the calculated value");
  assert(monthMarkup.includes("No previous-period comparison"), "zero previous period must show an explicit non-percentage state");
  assert(monthMarkup.includes("Trail Runner"), "product table must render real product names");
  assert(monthMarkup.includes("data-statistics-period=\"today\""), "Today must be a real filter control");
  assert(monthMarkup.includes('href="#/customers"'), "customer section must keep the real Customers destination");
  assert(!monthMarkup.includes("overview-command"), "Statistics must not reuse the Overview command-center markup");

  const emptyModel = buildStatisticsModel({
    snapshot: { stats: {} },
    analytics: {},
    orders: [],
    customers: [],
    products: [],
    activityLogs: [],
    failedSources: []
  }, { key: "today" });
  const emptyMarkup = buildStatisticsMarkup(emptyModel);
  assert(emptyMarkup.includes("No statistics available for this period."), "empty periods must show an empty state instead of a fake chart");
  assert(emptyModel.revenue === 0, "empty data must not invent revenue");

  const failedModel = buildStatisticsModel({
    snapshot: { stats: {} },
    analytics: {},
    orders: [],
    customers: [{ id: "c1", name: "Ada", joinedAt: "2026-08-16T00:00:00.000Z", totalOrders: 1 }],
    products: [],
    activityLogs: [],
    failedSources: ["orders: Request failed"]
  }, { key: "month" });
  const failedMarkup = buildStatisticsMarkup(failedModel);
  assert(failedMarkup.includes("Unable to load revenue statistics."), "order API failure must stay local to revenue/order sections");
  assert(failedMarkup.includes("Customer Growth"), "customer section must remain when orders fail");

  const customInvalid = buildStatisticsModel(payload, { key: "custom", from: "", to: "" });
  const customMarkup = buildStatisticsMarkup(customInvalid);
  assert(customInvalid.invalid, "custom range without dates must not invent a period");
  assert(customMarkup.includes("Select a start and end date"), "incomplete custom range must ask for dates instead of fake zeros");

  const overviewMarkup = buildOverviewMarkup(buildOverviewModel(payload, "week"));
  assert(overviewMarkup.includes("overview-command"), "Overview must keep its command-center layout");

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
  assert(legacy.includes("dashboard-grid"), "Quick Analytics markup must remain available");
  assert(legacy.includes("Backend feed issues") || legacy.includes("failed to sync"), "legacy dashboard must still surface failed feeds");

  if (failures.length) {
    console.error("FAIL verify-admin-statistics-step3");
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log("PASS verify-admin-statistics-step3");
  console.log(" - Statistics uses period-filtered real order/customer/product data");
  console.log(" - AOV and comparisons do not invent values");
  console.log(" - Overview and Quick Analytics remain separate");
}

main().catch((error) => {
  console.error("FAIL verify-admin-statistics-step3");
  console.error(error);
  process.exit(1);
});
