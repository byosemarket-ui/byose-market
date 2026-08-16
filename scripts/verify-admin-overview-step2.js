#!/usr/bin/env node
/**
 * STEP 2 Admin Overview / Command Center checks.
 * Run: node scripts/verify-admin-overview-step2.js
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
  const overviewJs = read("admin/app/pages/dashboard-overview.js");
  const viewJs = read("admin/app/pages/dashboard-view.js");
  const overviewCss = read("admin/app/styles/overview.css");
  const appCss = read("admin/app/styles/admin-app.css");

  assert(dashboardJs.includes("buildOverviewMarkup"), "dashboard must render the Overview command center");
  assert(dashboardJs.includes("buildDashboardMarkup"), "Statistics/Quick Analytics must keep the existing dashboard markup");
  assert(dashboardJs.includes("isOverviewPanel"), "dashboard must branch Overview away from other dashboard panels");
  assert(dashboardJs.includes("getDashboard("), "Overview must reuse getDashboard");
  assert(dashboardJs.includes("getOrders("), "Overview must reuse getOrders");
  assert(dashboardJs.includes("getCustomers("), "Overview must reuse getCustomers");
  assert(dashboardJs.includes("getProducts("), "Overview must reuse getProducts");
  assert(overviewJs.includes("formatCurrency"), "Overview must use the shared RWF formatter");
  assert(overviewJs.includes("#/orders"), "View all orders must keep the real Orders destination");
  assert(overviewJs.includes("#/products?view=create&step=info"), "Add product must keep the real create destination");
  assert(overviewJs.includes("#/customers"), "Manage customers must keep the real Customers destination");
  assert(overviewJs.includes("#/inventory"), "Inventory alerts/actions must keep the real Inventory destination");
  assert(overviewJs.includes("#/analytics"), "Report action must keep the real Analytics destination");
  assert(overviewJs.includes("downloadCsvFile"), "Export must use the existing CSV helper");
  assert(!/898,?000|1,?256/.test(overviewJs), "Overview must not hard-code sample KPI numbers");
  assert(!/Kwizera/i.test(overviewJs), "Overview must not copy sample-screenshot names");
  assert(overviewCss.includes(".overview-kpi-grid"), "Overview styles must include the KPI grid");
  assert(overviewCss.includes("@media (max-width: 767px)"), "Overview must include a mobile layout");
  assert(appCss.includes("./overview.css"), "Overview stylesheet must be loaded by the admin app");
  assert(viewJs.includes("export function buildDashboardMarkup"), "Existing dashboard view must remain exported");

  global.window = {
    location: { hash: "#/dashboard", pathname: "/admin/dashboard.html" },
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

  const overviewUrl = pathToFileURL(path.join(root, "admin/app/pages/dashboard-overview.js")).href;
  const viewUrl = pathToFileURL(path.join(root, "admin/app/pages/dashboard-view.js")).href;
  const { buildOverviewMarkup, buildOverviewModel } = await import(overviewUrl);
  const { buildDashboardMarkup, buildDashboardModel } = await import(viewUrl);

  const emptyModel = buildOverviewModel({
    snapshot: { stats: {} },
    analytics: {},
    orders: [],
    customers: [],
    products: [],
    activityLogs: [],
    failedSources: []
  });
  assert(emptyModel.revenue === 0, "empty data must not invent revenue");
  assert(emptyModel.ordersCount === 0, "empty data must not invent orders");
  assert(emptyModel.customersCount === 0, "empty data must not invent customers");
  assert(emptyModel.productsCount === 0, "empty data must not invent products");
  assert(emptyModel.topProducts.length === 0, "empty data must not invent best sellers");
  const emptyMarkup = buildOverviewMarkup(emptyModel);
  assert(emptyMarkup.includes("No recent orders"), "empty orders must show an empty state");
  assert(emptyMarkup.includes("No sales data available for this period"), "empty sales must show an empty state");
  assert(emptyMarkup.includes("No customer activity yet"), "empty customers must show an empty state");
  assert(emptyMarkup.includes('href="#/orders"'), "View all orders remains wired");

  const consistentModel = buildOverviewModel({
    snapshot: { stats: { totalSales: 999999, ordersCount: 99, customersCount: 88, productsCount: 77 } },
    analytics: {},
    orders: [],
    customers: [],
    products: [],
    activityLogs: [],
    failedSources: []
  });
  assert(consistentModel.revenue === 0, "successful empty order feed must not fall back to snapshot revenue");
  assert(consistentModel.ordersCount === 0, "successful empty order feed must not fall back to snapshot order count");
  assert(consistentModel.customersCount === 0, "successful empty customer feed must not fall back to snapshot customer count");
  assert(consistentModel.productsCount === 0, "successful empty product feed must not fall back to snapshot product count");

  const liveModel = buildOverviewModel({
    snapshot: {
      stats: { totalSales: 25000, ordersCount: 2, customersCount: 2, productsCount: 2 },
      activity: [{ type: "Order", statusLabel: "Pending", details: "ORD-1 · Ada", date: "2026-08-17T08:00:00.000Z" }]
    },
    analytics: { topProducts: [{ id: "p1", name: "Trail Runner", quantity: 3, revenue: 21000 }] },
    orders: [
      { id: "ORD-1", orderId: "ORD-1", customerName: "Ada", status: "Pending", total: 15000, createdAt: "2026-08-17T08:00:00.000Z", products: [{ productId: "p1", name: "Trail Runner", quantity: 2, price: 7000, lineTotal: 14000 }] },
      { id: "ORD-2", orderId: "ORD-2", customerName: "Ben", status: "Completed", total: 10000, createdAt: "2026-08-16T08:00:00.000Z", products: [{ productId: "p1", name: "Trail Runner", quantity: 1, price: 7000, lineTotal: 7000 }] }
    ],
    customers: [
      { id: "c1", name: "Ada", joinedAt: "2026-08-16T00:00:00.000Z", totalOrders: 1 },
      { id: "c2", name: "Ben", joinedAt: "2026-01-01T00:00:00.000Z", totalOrders: 4 }
    ],
    products: [
      { id: "p1", name: "Trail Runner", stock: 4, status: "active", mainImage: "/uploads/p1.png" },
      { id: "p2", name: "City Loafer", stock: 0, status: "active" }
    ],
    activityLogs: [],
    failedSources: []
  });

  assert(liveModel.revenue === 25000, "revenue must come from eligible orders");
  assert(liveModel.ordersCount === 2, "order count must match the order source");
  assert(liveModel.customersCount === 2, "customer count must match the customer source");
  assert(liveModel.productsCount === 2, "product count must match the catalog source");
  assert(liveModel.topProducts[0]?.name === "Trail Runner", "top products must use real sales data");
  assert(liveModel.lowStock >= 1, "low-stock alerts must use real inventory");
  assert(liveModel.outOfStock >= 1, "out-of-stock alerts must use real inventory");
  assert(liveModel.alerts.some((alert) => /awaiting fulfillment/i.test(alert.detail)), "pending fulfillment must create a real alert");
  const liveMarkup = buildOverviewMarkup(liveModel);
  assert(liveMarkup.includes("RWF 25,000"), "revenue must render with the shared RWF formatter");
  assert(liveMarkup.includes("Trail Runner"), "top selling products must render real product names");
  assert(liveMarkup.includes("ORD-1"), "recent orders must render real order IDs");
  assert(liveMarkup.includes("Live catalog items"), "product KPI must label catalog status honestly");
  assert(liveMarkup.includes("overview-customer-summary") || liveMarkup.includes("Customer activity by month"), "customer activity must render from real customer data");
  assert(liveMarkup.includes("#/orders?status=pending"), "order backlog alert must link to pending orders");
  assert(liveMarkup.includes("#/products?view=create&step=info"), "add product action must stay wired");
  assert(liveMarkup.includes("#/analytics"), "analytics/report action must stay wired");

  const failedModel = buildOverviewModel({
    snapshot: { stats: {} },
    analytics: {},
    orders: [],
    customers: [],
    products: [],
    activityLogs: [],
    failedSources: ["orders: Request failed", "customers: Request failed"]
  });
  const failedMarkup = buildOverviewMarkup(failedModel);
  assert(failedMarkup.includes("Unable to load orders"), "order API failure must stay local to the orders/revenue sections");
  assert(failedMarkup.includes("Unable to load customers") || failedMarkup.includes("Unable to load customer data"), "customer API failure must stay local");
  assert(failedMarkup.includes("Quick Actions"), "failed sections must not remove the rest of Overview");

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
  assert(legacy.includes("dashboard-grid"), "Statistics/Quick Analytics markup must remain available");
  assert(legacy.includes("Backend feed issues") || legacy.includes("failed to sync"), "legacy dashboard must still surface failed feeds");

  if (failures.length) {
    console.error("FAIL verify-admin-overview-step2");
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log("PASS verify-admin-overview-step2");
  console.log(" - Overview uses real order/customer/product/revenue sources");
  console.log(" - Empty and error states do not invent business data");
  console.log(" - Statistics/Quick Analytics keep the existing dashboard view");
}

main().catch((error) => {
  console.error("FAIL verify-admin-overview-step2");
  console.error(error);
  process.exit(1);
});
