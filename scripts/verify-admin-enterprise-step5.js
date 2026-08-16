#!/usr/bin/env node
/**
 * STEP 5 Admin Enterprise Console / Operational Control Center checks.
 * Run: node scripts/verify-admin-enterprise-step5.js
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
  const enterpriseJs = read("admin/app/pages/enterprise.js");
  const consoleJs = read("admin/app/pages/enterprise-console.js");
  const dashboardJs = read("admin/app/pages/dashboard.js");
  const overviewJs = read("admin/app/pages/dashboard-overview.js");
  const statsJs = read("admin/app/pages/dashboard-statistics.js");
  const quickJs = read("admin/app/pages/dashboard-quick-analytics.js");
  const viewJs = read("admin/app/pages/dashboard-view.js");
  const css = read("admin/app/styles/enterprise-console.css");
  const appCss = read("admin/app/styles/admin-app.css");
  const navigationJs = read("admin/app/core/navigation.js");
  const mainJs = read("admin/app/main.js");
  const authJs = read("admin/app/core/auth.js");

  assert(enterpriseJs.includes("readEnterpriseSearchQuery"), "enterprise search must still accept shell query params");
  assert(enterpriseJs.includes("enterpriseSearchInput"), "header search target id must remain");
  assert(enterpriseJs.includes("renderEnterprise"), "Enterprise Console must still export renderEnterprise");
  assert(enterpriseJs.includes("Promise.allSettled"), "Enterprise Console must isolate failing services");
  assert(enterpriseJs.includes("realtime/ping"), "API status must use a real ping check");
  assert(enterpriseJs.includes("/healthz"), "backend/database status must use the existing healthz endpoint");
  assert(enterpriseJs.includes("getNotificationMonitoringHealth"), "notification status must use the existing health endpoint");
  assert(enterpriseJs.includes("getAdminSecurityEvents"), "admin activity must use existing security events where available");
  assert(enterpriseJs.includes("getNotificationCenter"), "notifications must use the existing notification center");
  assert(!enterpriseJs.includes("getRealtimeIntelligence"), "Enterprise Console must not duplicate the intelligence aggregator request");
  assert(!/cpu|memory usage|uptime monitoring|api latency/i.test(consoleJs), "must not invent server monitoring metrics");
  assert(!/All Systems Operational/.test(consoleJs), "must not claim all systems operational as a default phrase");
  assert(consoleJs.includes("UNKNOWN"), "unknown states must remain first-class");
  assert(consoleJs.includes("LOW_STOCK_THRESHOLD = 5"), "inventory must reuse the existing stock threshold");
  assert(consoleJs.includes("#/orders?status=pending"), "pending-order actions must use the real Orders filter");
  assert(consoleJs.includes("#/inventory"), "inventory actions must use the real Inventory destination");
  assert(consoleJs.includes("#/settings"), "settings action must use the real Settings destination");
  assert(consoleJs.includes("Operational &amp; System Control Center") || consoleJs.includes("Operational & System Control Center"), "page must keep the operational control-center purpose");
  assert(consoleJs.includes("data-enterprise-refresh"), "Refresh must be wired");
  assert(!/124,?500|898,?000/.test(consoleJs), "Enterprise Console must not hard-code sample revenue");
  assert(!/Kwizera/i.test(consoleJs), "Enterprise Console must not copy sample-screenshot names");
  assert(!consoleJs.includes("chartContainer"), "Enterprise Console must not use the dummy chart placeholder");
  assert(css.includes(".ecc-root"), "Enterprise Console must have its own layout namespace");
  assert(css.includes("@media (max-width: 767px)"), "Enterprise Console must include a mobile layout");
  assert(appCss.includes("./enterprise-console.css"), "Enterprise Console stylesheet must be loaded");
  assert(navigationJs.includes('routeLink("dashboard-enterprise", "Enterprise Console", "enterprise"'), "Enterprise Console destination must remain");
  assert(mainJs.includes("enterprise: renderEnterprise"), "router must still render Enterprise Console at #/enterprise");
  assert(mainJs.includes("ensureAuthenticated()"), "bootstrap must still require authentication");
  assert(authJs.includes("security.logout"), "logout must remain wired");
  assert(dashboardJs.includes("buildOverviewMarkup"), "Overview must remain wired");
  assert(dashboardJs.includes("buildStatisticsMarkup"), "Statistics must remain wired");
  assert(dashboardJs.includes("buildQuickAnalyticsMarkup"), "Quick Analytics must remain wired");
  assert(overviewJs.includes("overview-command"), "Overview command center must remain distinct");
  assert(statsJs.includes("stats-workspace"), "Statistics workspace must remain distinct");
  assert(quickJs.includes("qa-workspace"), "Quick Analytics board must remain distinct");
  assert(viewJs.includes("export function buildDashboardMarkup"), "Existing dashboard view must remain exported");

  global.window = {
    location: { hash: "#/enterprise?q=orders", pathname: "/admin/dashboard.html" },
    localStorage: { getItem() { return null; }, setItem() {} },
    addEventListener() {},
    URL: { createObjectURL() { return "blob:test"; }, revokeObjectURL() {} }
  };
  global.document = {
    createElement() { return { click() {}, href: "", download: "" }; },
    body: { appendChild() {}, removeChild() {} }
  };

  const consoleUrl = pathToFileURL(path.join(root, "admin/app/pages/enterprise-console.js")).href;
  const { buildEnterpriseConsoleMarkup, buildEnterpriseConsoleModel } = await import(consoleUrl);

  const unknownModel = buildEnterpriseConsoleModel({}, {});
  assert(unknownModel.summary.key === "unknown", "missing checks must produce STATUS UNKNOWN");
  assert(unknownModel.summary.label === "STATUS UNKNOWN", "unknown summary label must be explicit");
  assert(unknownModel.services.every((service) => service.status === "unknown"), "unverified services must be UNKNOWN, not ONLINE or OFFLINE");
  const unknownMarkup = buildEnterpriseConsoleMarkup(unknownModel);
  assert(unknownMarkup.includes("STATUS UNKNOWN"), "unknown markup must show STATUS UNKNOWN");
  assert(!unknownMarkup.includes(">ONLINE<"), "unverified services must not render ONLINE");
  assert(!unknownMarkup.includes(">OFFLINE<"), "unverified services must not render OFFLINE");
  assert(unknownMarkup.includes("No active alerts"), "empty alert center must stay compact");
  assert(unknownMarkup.includes("id=\"enterpriseSearchInput\"") === false, "lookup markup is supplied by the page, not the model");
  assert(unknownMarkup.includes("Enterprise Console"), "page heading must remain Enterprise Console");
  assert(unknownMarkup.includes("ecc-root"), "Enterprise Console must use its own layout");
  assert(!unknownMarkup.includes("overview-command"), "Enterprise Console must not reuse Overview markup");
  assert(!unknownMarkup.includes("stats-workspace"), "Enterprise Console must not reuse Statistics markup");
  assert(!unknownMarkup.includes("qa-workspace"), "Enterprise Console must not reuse Quick Analytics markup");

  const liveModel = buildEnterpriseConsoleModel({
    session: {
      checked: true,
      authenticated: true,
      jwtProtected: true,
      online: true,
      detail: "JWT validation is active."
    },
    ping: { ok: true, checkedAt: "2026-08-17T08:00:00.000Z" },
    pingFailed: false,
    healthz: { checked: true, ok: true, status: "ok", dbConnected: true, checkedAt: "2026-08-17T08:00:00.000Z" },
    healthzFailed: false,
    dashboard: { stats: {} },
    dashboardFailed: false,
    orders: [
      { id: "ORD-1", status: "Pending", total: 15000, createdAt: "2026-08-17T08:00:00.000Z" },
      { id: "ORD-2", status: "Delivered", total: 10000, createdAt: "2026-08-16T08:00:00.000Z" }
    ],
    products: [
      { id: "p1", name: "Trail Runner", stock: 4, status: "active" },
      { id: "p2", name: "City Loafer", stock: 0, status: "active" }
    ],
    activity: [
      { id: "a1", event: "product_updated", type: "product", path: "/admin/products/p1", createdAt: "2026-08-17T07:30:00.000Z" }
    ],
    messages: [{ id: "m1", status: "New" }],
    notifications: {
      unreadCount: 2,
      notifications: [{ id: "n1", title: "Low stock alert", message: "Trail Runner is low", type: "inventory", status: "unread", createdAt: "2026-08-17T07:40:00.000Z" }]
    },
    notificationHealth: {
      overall: { code: "healthy", label: "Healthy" },
      checkedAt: "2026-08-17T08:00:00.000Z"
    },
    securityEvents: {
      items: [{ id: 9, adminEmail: "admin@byosemarket.com", eventType: "successful_login", category: "security", summary: "Administrator signed in", createdAt: "2026-08-17T07:10:00.000Z" }]
    },
    opsLogs: {
      logs: [{ id: "nol1", eventType: "MONITOR_CYCLE", status: "info", message: "Notification monitor cycle completed", createdAt: "2026-08-17T07:50:00.000Z" }]
    },
    refreshedAt: "2026-08-17T08:01:00.000Z"
  }, { activityFilter: "all" });

  assert(liveModel.summary.label === "SYSTEM OPERATIONAL", "verified healthy services may show SYSTEM OPERATIONAL");
  assert(liveModel.operational.pendingOrders === 1, "pending orders must use real order statuses");
  assert(liveModel.operational.outOfStock === 1, "out-of-stock count must use real stock data");
  assert(liveModel.operational.lowStock === 1, "low-stock count must reuse the existing threshold");
  assert(liveModel.alerts.some((alert) => /out of stock/i.test(alert.title)), "alerts must come from actual inventory conditions");
  assert(liveModel.alerts.some((alert) => /awaiting action/i.test(alert.title)), "alerts must come from actual order conditions");
  assert(liveModel.activity.items.some((item) => item.eventType === "successful_login"), "admin activity must use real security events");
  assert(liveModel.notifications.unreadCount === 2, "notification unread count must use real notification data");
  assert(liveModel.events.items.some((item) => /monitor cycle/i.test(item.description)), "system events must use real ops logs");

  const liveMarkup = buildEnterpriseConsoleMarkup(liveModel);
  assert(liveMarkup.includes("Last updated:"), "last updated must use the actual refresh timestamp");
  assert(liveMarkup.includes("#/orders?status=pending"), "order alerts must link to Orders");
  assert(liveMarkup.includes("#/inventory"), "inventory alerts must link to Inventory");
  assert(liveMarkup.includes("#/notifications"), "notification actions must link to the inbox");
  assert(liveMarkup.includes("admin@byosemarket.com") || liveMarkup.includes("Administrator signed in"), "activity feed must show the real actor/action");
  assert(!liveMarkup.includes("header.payload.signature"), "JWT tokens must not be rendered");
  assert(!liveMarkup.includes("password"), "passwords must not be rendered");

  const isolated = buildEnterpriseConsoleModel({
    session: { checked: true, authenticated: true, jwtProtected: true, online: true, detail: "JWT validation is active." },
    pingFailed: true,
    pingError: "Realtime ping failed.",
    healthzFailed: true,
    ordersFailed: true,
    ordersError: "Unable to retrieve order operational status.",
    products: [{ id: "p3", name: "Garden Clog", stock: 18, status: "active" }],
    notificationsFailed: true,
    notificationsError: "Unable to retrieve notifications.",
    activity: [],
    securityEventsFailed: true,
    opsLogsFailed: true,
    refreshedAt: "2026-08-17T08:02:00.000Z"
  });
  const isolatedMarkup = buildEnterpriseConsoleMarkup(isolated);
  assert(isolated.services.find((service) => service.id === "api")?.status === "offline", "failed ping with no dashboard must mark API OFFLINE");
  assert(isolated.services.find((service) => service.id === "database")?.status === "unknown", "failed healthz must mark database UNKNOWN, not OFFLINE");
  assert(isolated.operational.ordersFailed, "order section must fail independently");
  assert(isolated.operational.outOfStock === 0, "inventory section must continue when orders fail");
  assert(isolatedMarkup.includes("Unable to retrieve order operational status."), "failed order section must show an isolated error");
  assert(isolatedMarkup.includes("Unable to retrieve notifications."), "failed notifications must not blank the console");
  assert(isolatedMarkup.includes("Manage Orders"), "administrative actions must remain available during partial failure");

  if (failures.length) {
    console.error("STEP 5 Enterprise Console checks failed:");
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log("STEP 5 Enterprise Console checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
