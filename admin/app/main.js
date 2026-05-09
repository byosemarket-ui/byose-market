import { ensureAuthenticated, logout, validateActiveSession } from "./core/auth.js";
import { AUTO_REFRESH_INTERVAL_MS, MIN_SYNC_REFRESH_DEBOUNCE_MS, REALTIME_SYNC_INTERVAL_MS, ROUTES } from "./core/constants.js";
import { startRouter } from "./core/router.js";
import { createStore } from "./core/state.js";
import { bindLayoutActions, renderAppShell, setActiveNav, setRouteTitle } from "./components/layout.js";
import { errorState, loadingState, mountModalHandlers } from "./components/ui.js";
import { ADMIN_SYNC_EVENT, startRealtimeAnalyticsSync, stopRealtimeAnalyticsSync } from "./services/admin-data.service.js";
import { startRealtimeSync, stopRealtimeSync as stopRealtimeTransport, subscribeToRealtimeEvents } from "./services/realtime-sync.service.js";

// ---------------------------------------------------------------------------
// LAZY PAGE LOADER
// ---------------------------------------------------------------------------
// Pages are loaded on first visit using dynamic import() so the browser only
// parses and executes each module when it is actually needed. This reduces
// initial parse time and memory pressure — important as more pages are added.
//
// The resolved renderer is cached after the first load, so subsequent visits
// to the same route incur no extra network round-trip.
// ---------------------------------------------------------------------------

const PAGE_MODULES = {
  dashboard: () => import("./pages/dashboard.js").then((m) => m.renderDashboard),
  enterprise: () => import("./pages/enterprise.js").then((m) => m.renderEnterprise),
  orders: () => import("./pages/orders.js").then((m) => m.renderOrders),
  customers: () => import("./pages/customers.js").then((m) => m.renderCustomers),
  products: () => import("./pages/products.js").then((m) => m.renderProducts),
  analytics: () => import("./pages/analytics.js").then((m) => m.renderAnalytics),
  inventory: () => import("./pages/inventory.js").then((m) => m.renderInventory),
  activity: () => import("./pages/activity.js").then((m) => m.renderActivity),
  settings: () => import("./pages/settings.js").then((m) => m.renderSettings)
};

// Cache resolved renderers after first load.
const pageRendererCache = new Map();

async function getPageRenderer(routeKey) {
  if (pageRendererCache.has(routeKey)) {
    return pageRendererCache.get(routeKey);
  }

  const loader = PAGE_MODULES[routeKey] || PAGE_MODULES.dashboard;
  const renderer = await loader();
  pageRendererCache.set(routeKey, renderer);
  return renderer;
}

let activeRenderToken = 0;
let activeRouteKey = "";
let autoRefreshTimer = null;
let inAppSyncRefreshTimer = null;
let stopRealtimeSync = null;
const realtimeUnsubscribers = [];

const REFRESHABLE_ROUTES = new Set(["dashboard", "enterprise", "orders", "customers", "products", "analytics", "inventory", "activity"]);
const ROUTE_SCOPE_MAP = {
  dashboard: new Set(["dashboard", "orders", "customers", "products", "activity", "messages", "analytics", "inventory", "carts", "intelligence"]),
  enterprise: new Set(["dashboard", "orders", "customers", "products", "activity", "messages", "analytics", "inventory", "carts", "intelligence"]),
  orders: new Set(["orders"]),
  customers: new Set(["customers"]),
  products: new Set(["products"]),
  analytics: new Set(["analytics", "orders", "customers", "activity", "messages", "dashboard", "intelligence"]),
  inventory: new Set(["inventory", "products"]),
  activity: new Set(["activity", "messages"])
};

function routeShouldRefreshForScope(routeKey, scope) {
  const normalizedRoute = String(routeKey || "").trim().toLowerCase();
  const normalizedScope = String(scope || "").trim().toLowerCase();
  if (!normalizedScope) {
    return false;
  }

  const routeScopes = ROUTE_SCOPE_MAP[normalizedRoute] || new Set(["intelligence"]);
  return routeScopes.has(normalizedScope);
}

function installSessionRefreshGuard() {
  window.addEventListener("focus", async () => {
    const valid = await validateActiveSession();
    if (!valid) {
      logout();
    }
  });
}

async function renderRoute(routeKey, store, options = {}) {
  const route = ROUTES[routeKey] || ROUTES.dashboard;
  const force = Boolean(options?.force);
  const softRefresh = Boolean(options?.softRefresh);
  if (!force && activeRouteKey === route.key) {
    return;
  }

  activeRouteKey = route.key;
  const renderToken = ++activeRenderToken;

  const content = document.getElementById("appContent");
  if (!content) {
    return;
  }

  const validSession = await validateActiveSession();
  if (!validSession) {
    logout();
    return;
  }

  const renderer = await getPageRenderer(route.key);

  setRouteTitle(route.label);
  setActiveNav(route.key);
  store.setState({ route: route.key });

  const hasExistingContent = Boolean(content.childElementCount);
  if (!softRefresh || !hasExistingContent) {
    content.innerHTML = loadingState(`Loading ${route.label}...`);
  }

  try {
    await renderer(content, { store });
    if (renderToken !== activeRenderToken) {
      return;
    }
  } catch (error) {
    if (renderToken !== activeRenderToken) {
      return;
    }

    if (softRefresh && hasExistingContent) {
      return;
    }
    content.innerHTML = errorState(error?.message || `Unable to render ${route.label}.`);
  }
}

function installSyncGuards(store) {
  window.addEventListener(ADMIN_SYNC_EVENT, (event) => {
    if (!REFRESHABLE_ROUTES.has(activeRouteKey)) {
      return;
    }

    if (activeRouteKey === "dashboard") {
      return;
    }

    const scope = String(event?.detail?.scope || "").trim().toLowerCase();
    if (!routeShouldRefreshForScope(activeRouteKey, scope)) {
      return;
    }

    if (inAppSyncRefreshTimer) {
      window.clearTimeout(inAppSyncRefreshTimer);
    }

    inAppSyncRefreshTimer = window.setTimeout(() => {
      renderRoute(activeRouteKey, store, { force: true, softRefresh: true });
    }, MIN_SYNC_REFRESH_DEBOUNCE_MS);
  });
}

function installRealtimeRouteRefresh(store) {
  const watchedScopes = ["orders", "customers", "products", "activity", "analytics", "messages", "carts"];

  watchedScopes.forEach((scope) => {
    const unsubscribe = subscribeToRealtimeEvents(scope, () => {
      if (!REFRESHABLE_ROUTES.has(activeRouteKey) || activeRouteKey === "dashboard") {
        return;
      }

      if (!routeShouldRefreshForScope(activeRouteKey, scope)) {
        return;
      }

      if (inAppSyncRefreshTimer) {
        window.clearTimeout(inAppSyncRefreshTimer);
      }

      inAppSyncRefreshTimer = window.setTimeout(() => {
        renderRoute(activeRouteKey, store, { force: true, softRefresh: true });
      }, MIN_SYNC_REFRESH_DEBOUNCE_MS);
    });

    realtimeUnsubscribers.push(unsubscribe);
  });
}

function installAutoRefresh(store) {
  if (autoRefreshTimer) {
    window.clearInterval(autoRefreshTimer);
  }

  autoRefreshTimer = window.setInterval(() => {
    if (document.visibilityState !== "visible") {
      return;
    }

    if (!REFRESHABLE_ROUTES.has(activeRouteKey)) {
      return;
    }

    renderRoute(activeRouteKey, store, { force: true, softRefresh: true });
  }, AUTO_REFRESH_INTERVAL_MS);
}

async function bootstrap() {
  if (!ensureAuthenticated()) {
    return;
  }

  const appRoot = document.getElementById("appRoot");
  if (!appRoot) {
    return;
  }

  renderAppShell(appRoot);
  bindLayoutActions();
  mountModalHandlers();

  const store = createStore({ route: "dashboard" });

  startRouter((routeKey) => {
    renderRoute(routeKey, store);
  });

  installSessionRefreshGuard();
  installSyncGuards(store);
  installRealtimeRouteRefresh(store);
  installAutoRefresh(store);
  await startRealtimeSync();
  stopRealtimeSync = startRealtimeAnalyticsSync({ intervalMs: REALTIME_SYNC_INTERVAL_MS });
}

window.addEventListener("beforeunload", () => {
  realtimeUnsubscribers.splice(0).forEach((unsubscribe) => {
    try {
      unsubscribe?.();
    } catch (_error) {
      // Ignore teardown errors.
    }
  });

  stopRealtimeTransport();

  if (typeof stopRealtimeSync === "function") {
    stopRealtimeSync();
  } else {
    stopRealtimeAnalyticsSync();
  }
});

bootstrap();
