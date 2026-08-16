#!/usr/bin/env node
/**
 * Guardrails for the Admin Console blank-page failure.
 * Run: node scripts/verify-admin-blank-page.js
 */

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function sliceBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  if (start < 0 || end < 0) return "";
  return source.slice(start, end);
}

async function main() {
  const security = read("admin/admin-login/js/admin-security.js");
  const mainJs = read("admin/app/main.js");
  const dashboardJs = read("admin/app/pages/dashboard.js");
  const layoutCss = read("admin/app/styles/layout.css");
  const dataJs = read("admin/app/services/admin-data.service.js");

  const logoutFn = sliceBetween(security, "function logout()", "function handleUnauthorized");
  assert(logoutFn.includes("redirectToLogin()"), "logout must still redirect to login");
  assert(
    !/history\.replaceState\(\s*null\s*,\s*["']["']\s*,\s*getLoginUrl\(\)/.test(logoutFn),
    "logout must not replaceState to the login URL before navigation"
  );

  const redirectFn = sliceBetween(security, "function redirectToLogin()", "function redirectToDashboard");
  assert(redirectFn.includes("window.location.replace(getLoginUrl())"), "redirectToLogin must force-load login.html");
  assert(redirectFn.includes("isLoginPage()"), "redirectToLogin must skip only when the login document is actually loaded");

  const renderRouteFn = sliceBetween(mainJs, "async function renderRoute", "function installSyncGuards");
  const loadingIndex = renderRouteFn.indexOf("loadingState(");
  const sessionIndex = renderRouteFn.indexOf("validateActiveSession(");
  assert(loadingIndex >= 0 && sessionIndex >= 0 && loadingIndex < sessionIndex, "renderRoute must paint a loading state before awaiting session validation");
  assert(renderRouteFn.includes("Redirecting to login"), "expired-session path must show a visible message instead of an empty pane");

  assert(dashboardJs.includes("startRealtimeSync().catch"), "dashboard must not let realtime startup reject unhandled");
  assert(dashboardJs.includes("Unable to load Dashboard data"), "dashboard refresh failures must render an error state");
  assert(!/await startRealtimeSync\(\)/.test(dashboardJs), "dashboard first paint must not await realtime sync");

  assert(layoutCss.includes("minmax(min-content, 1fr)"), "admin main shell must not collapse the content row to zero height");
  assert(dataJs.includes("refreshRealtimeIntelligence().catch"), "startup intelligence refresh must not become an unhandled rejection");

  const { buildDashboardMarkup, buildDashboardModel } = await import("../admin/app/pages/dashboard-view.js");
  const model = buildDashboardModel({
    snapshot: { stats: { revenue: 0, orders: 0, customers: 0, products: 0 } },
    analytics: {},
    orders: [],
    customers: [],
    products: [],
    activityLogs: [],
    carts: [],
    failedSources: ["orders: Request failed"]
  });
  const markup = buildDashboardMarkup(model);
  assert(markup.includes("dashboard-grid"), "dashboard markup must render the dashboard grid even when feeds fail");
  assert(markup.includes("Backend feed issues") || markup.includes("failed to sync"), "dashboard must surface failed data sources instead of rendering nothing");

  if (failures.length) {
    console.error("FAIL verify-admin-blank-page");
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log("PASS verify-admin-blank-page");
  console.log(" - Logout cannot fake-navigate to login.html");
  console.log(" - Router paints content before session validation");
  console.log(" - Dashboard still renders when APIs fail");
}

main().catch((error) => {
  console.error("FAIL verify-admin-blank-page");
  console.error(error);
  process.exit(1);
});
