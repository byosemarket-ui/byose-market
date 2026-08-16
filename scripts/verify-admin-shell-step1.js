#!/usr/bin/env node
/**
 * STEP 1 Admin Shell & Navigation Foundation checks.
 * Run: node scripts/verify-admin-shell-step1.js
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
  const layoutJs = read("admin/app/components/layout.js");
  const navigationJs = read("admin/app/core/navigation.js");
  const authJs = read("admin/app/core/auth.js");
  const mainJs = read("admin/app/main.js");
  const dashboardHtml = read("admin/dashboard.html");
  const tokensCss = read("admin/app/styles/tokens.css");
  const layoutCss = read("admin/app/styles/layout.css");
  const sidebarCss = read("admin/app/styles/sidebar-shell.css");
  const headerCss = read("admin/app/styles/header-shell.css");
  const mobileCss = read("admin/app/styles/responsive-mobile.css");
  const tabletCss = read("admin/app/styles/responsive-tablet.css");
  const brandingJs = read("admin/app/utils/admin-branding.js");
  const enterpriseJs = read("admin/app/pages/enterprise.js");
  const sidebarNavJs = read("admin/app/core/sidebar-navigation.js");

  [
    "appPageContent",
    "adminSidebar",
    "adminHeaderBar",
    "adminShellSearch",
    "headerNotificationsPanel",
    "routeTitle",
    "routeGroup",
    "data-admin-logout",
    "sidebarProfileName",
    "headerProfileName"
  ].forEach((token) => {
    assert(layoutJs.includes(token), `layout.js must keep ${token}`);
  });

  assert(layoutJs.includes("BYOSE Market"), "sidebar brand must use BYOSE Market identity");
  assert(!/Kwizera/i.test(layoutJs), "layout must not hard-code sample screenshot names");
  assert(!/disabled aria-disabled="true"/.test(layoutJs), "admin search must not be a disabled placeholder");
  assert(layoutJs.includes('placeholder="Search orders, customers, products'), "search placeholder must mention real admin objects");
  assert(layoutJs.includes("logout()"), "shell logout must call the real logout implementation");
  assert(!/id="adminShellSearch"[^>]*disabled/.test(layoutJs), "search input must not be disabled");
  assert(authJs.includes("security.logout"), "auth.js must still delegate to AdminSecurity.logout");
  assert(mainJs.includes("ensureAuthenticated()"), "bootstrap must still require authentication");
  assert(mainJs.includes("validateActiveSession()"), "route rendering must still validate the session");
  assert(mainJs.includes('getElementById("appPageContent")'), "router must still render into #appPageContent");
  assert(dashboardHtml.includes('src="../admin.js"'), "dashboard.html must keep the existing SPA entrypoint");
  assert(dashboardHtml.includes("admin-login/js/admin-security.js"), "dashboard.html must keep JWT/session protection");

  assert(navigationJs.includes('routeLink("dashboard-overview", "Overview", "dashboard"'), "Overview destination must remain");
  assert(navigationJs.includes('query: "?panel=statistics"'), "Statistics destination must remain");
  assert(navigationJs.includes('query: "?panel=quick-analytics"'), "Quick Analytics destination must remain");
  assert(navigationJs.includes('routeLink("dashboard-enterprise", "Enterprise Console", "enterprise"'), "Enterprise Console destination must remain");
  assert(navigationJs.includes('id: "orders"'), "Orders navigation must remain");
  assert(navigationJs.includes('id: "products"'), "Products navigation must remain");
  assert(navigationJs.includes('id: "customers"'), "Customers navigation must remain");

  assert(layoutCss.includes("minmax(min-content, 1fr)"), "main shell must keep a non-zero content row");
  assert(layoutCss.includes(".admin-page-heading"), "shell must provide a page heading structure");
  assert(sidebarCss.includes(".sidebar-nav-scroll"), "sidebar must have an independent scroll area");
  assert(sidebarCss.includes(".sidebar-profile"), "sidebar must include the admin profile area");
  assert(headerCss.includes(".header-search-field"), "header must include the admin search field");
  assert(mobileCss.includes("translateX(-104%)"), "mobile sidebar must become a drawer");
  assert(tabletCss.includes("translateX(-104%)"), "tablet sidebar must become a drawer");
  assert(tokensCss.includes("--app-sidebar-bg"), "design tokens must include sidebar background");
  assert(tokensCss.includes("--app-primary"), "design tokens must include primary accent");
  assert(brandingJs.includes("sidebar-brand-mark"), "branding must still apply the admin logo to the sidebar mark");
  assert(enterpriseJs.includes("readEnterpriseSearchQuery"), "enterprise search must accept shell query params");
  assert(sidebarNavJs.includes("flattenNavigationDestinations"), "search must reuse the existing navigation map");
  assert(sidebarNavJs.includes("stripTransientHashParams"), "hash matching must ignore search query params");

  const windowMock = {
    location: { hash: "#/dashboard", pathname: "/admin/dashboard.html", href: "http://localhost/admin/dashboard.html", origin: "http://localhost" },
    localStorage: { getItem() { return "[]"; }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init && init.detail;
      }
    }
  };
  global.window = windowMock;
  global.document = {
    addEventListener() {},
    removeEventListener() {},
    documentElement: { style: { setProperty() {} } },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById() { return null; }
  };
  global.navigator = { onLine: true, userAgent: "node-test" };
  global.window.AdminSecurity = {
    getSessionSnapshot() {
      return {
        authenticated: true,
        email: "tester@byosemarket.com",
        token: "header.payload.signature",
        profile: { name: "Test Administrator", role: "admin", email: "tester@byosemarket.com" }
      };
    },
    isAuthenticated() { return true; }
  };

  const navigationUrl = pathToFileURL(path.join(root, "admin/app/core/navigation.js")).href;
  const sidebarNavUrl = pathToFileURL(path.join(root, "admin/app/core/sidebar-navigation.js")).href;
  const { ADMIN_NAVIGATION } = await import(navigationUrl);
  const { collectActiveTrail, flattenNavigationDestinations, matchesNavigationEntry } = await import(sidebarNavUrl);

  const destinations = flattenNavigationDestinations(ADMIN_NAVIGATION);
  const labels = destinations.map((item) => item.label);
  ["Overview", "Statistics", "Quick Analytics", "Enterprise Console", "All Orders", "All Products", "All Customers"].forEach((label) => {
    assert(labels.includes(label), `navigation map must still include ${label}`);
  });

  const overview = destinations.find((item) => item.id === "dashboard-overview");
  const statistics = destinations.find((item) => item.id === "dashboard-statistics");
  const quick = destinations.find((item) => item.id === "dashboard-quick-analytics");
  const enterprise = destinations.find((item) => item.id === "dashboard-enterprise");

  assert(overview?.href === "#/dashboard", "Overview must keep #/dashboard");
  assert(statistics?.href === "#/dashboard?panel=statistics", "Statistics must keep its panel hash");
  assert(quick?.href === "#/dashboard?panel=quick-analytics", "Quick Analytics must keep its panel hash");
  assert(enterprise?.href === "#/enterprise", "Enterprise Console must keep #/enterprise");

  const overviewActive = matchesNavigationEntry(overview, { hash: "#/dashboard", pathname: "dashboard.html", routeKey: "dashboard" });
  const statsActive = matchesNavigationEntry(statistics, { hash: "#/dashboard?panel=statistics", pathname: "dashboard.html", routeKey: "dashboard" });
  const enterpriseSearchActive = matchesNavigationEntry(enterprise, { hash: "#/enterprise?q=orders", pathname: "dashboard.html", routeKey: "enterprise" });
  const overviewNotStats = matchesNavigationEntry(overview, { hash: "#/dashboard?panel=statistics", pathname: "dashboard.html", routeKey: "dashboard" });

  assert(overviewActive, "Overview must match #/dashboard");
  assert(statsActive, "Statistics must match #/dashboard?panel=statistics");
  assert(enterpriseSearchActive, "Enterprise Console must stay active when a search query is present");
  assert(!overviewNotStats, "Overview must not stay active on the Statistics panel");

  const statsTrail = collectActiveTrail(ADMIN_NAVIGATION, { hash: "#/dashboard?panel=statistics", pathname: "dashboard.html", routeKey: "dashboard" });
  assert(statsTrail.activeItemIds.has("dashboard-statistics"), "Statistics trail must mark the Statistics item active");
  assert(statsTrail.activeBranchIds.has("dashboard"), "Statistics trail must expand the Dashboard group");

  if (failures.length) {
    console.error("FAIL verify-admin-shell-step1");
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log("PASS verify-admin-shell-step1");
  console.log(" - Admin shell IDs, branding, search, and logout preserved");
  console.log(" - Dashboard Overview/Statistics/Quick Analytics/Enterprise routes intact");
  console.log(" - Hash matching still distinguishes Dashboard panels");
}

main().catch((error) => {
  console.error("FAIL verify-admin-shell-step1");
  console.error(error);
  process.exit(1);
});
