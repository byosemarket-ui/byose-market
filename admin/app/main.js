import { ensureAuthenticated, logout, validateActiveSession } from "./core/auth.js";
import { ROUTES } from "./core/constants.js";
import { startRouter } from "./core/router.js";
import { createStore } from "./core/state.js";
import { bindLayoutActions, renderAppShell, setActiveNav, setRouteTitle } from "./components/layout.js";
import { errorState, loadingState, mountModalHandlers } from "./components/ui.js";
import { renderDashboard } from "./pages/dashboard.js";
import { renderEnterprise } from "./pages/enterprise.js";
import { renderOrders } from "./pages/orders.js";
import { renderCustomers } from "./pages/customers.js";
import { renderProducts } from "./pages/products.js";
import { renderAnalytics } from "./pages/analytics.js";
import { renderInventory } from "./pages/inventory.js";
import { renderActivity } from "./pages/activity.js";
import { renderSettings } from "./pages/settings.js";
import { ADMIN_SYNC_EVENT, startRealtimeAnalyticsSync, stopRealtimeAnalyticsSync } from "./services/admin-data.service.js";

const pageMap = {
  dashboard: renderDashboard,
  enterprise: renderEnterprise,
  orders: renderOrders,
  customers: renderCustomers,
  products: renderProducts,
  analytics: renderAnalytics,
  inventory: renderInventory,
  activity: renderActivity,
  settings: renderSettings
};

let activeRenderToken = 0;
let activeRouteKey = "";
let activeRouteSignature = "";
let autoRefreshTimer = null;
let inAppSyncRefreshTimer = null;
let stopRealtimeSync = null;
let bootstrapFailureHandled = false;

const REFRESHABLE_ROUTES = new Set(["dashboard", "enterprise", "orders", "customers", "products", "analytics", "inventory", "activity"]);
const ROUTE_SCOPE_MAP = {
  dashboard: new Set(["dashboard", "orders", "customers", "products", "activity", "messages", "analytics", "inventory", "carts", "intelligence"]),
  enterprise: new Set(["dashboard", "orders", "customers", "products", "activity", "messages", "analytics", "inventory", "carts", "intelligence"]),
  orders: new Set(["orders", "intelligence"]),
  customers: new Set(["customers", "intelligence"]),
  products: new Set(["products", "intelligence"]),
  analytics: new Set(["analytics", "orders", "customers", "activity", "messages", "dashboard", "intelligence"]),
  inventory: new Set(["inventory", "products", "intelligence"]),
  activity: new Set(["activity", "messages", "intelligence"])
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

function getRouteSignature(routeKey) {
  const route = ROUTES[routeKey] || ROUTES.dashboard;
  return String(window.location.hash || route.path || `#/${route.key}`)
    .trim()
    .toLowerCase();
}

function installSessionRefreshGuard() {
  window.addEventListener("focus", async () => {
    const valid = await validateActiveSession();
    if (!valid) {
      logout();
    }
  });
}

function mountBootstrapFailure(message) {
  const fallbackMessage = String(message || "The admin dashboard could not initialize. Please reload the page.");
  const contentTarget = document.getElementById("appPageContent");
  if (contentTarget) {
    contentTarget.innerHTML = errorState(fallbackMessage);
    return;
  }

  const appRoot = document.getElementById("appRoot");
  if (appRoot) {
    appRoot.innerHTML = `
      <section class="admin-bootstrap-fallback" style="padding: 24px; font-family: Manrope, Segoe UI, sans-serif; color: #12212b;">
        ${errorState(fallbackMessage)}
      </section>
    `;
  }
}

function handleBootstrapFailure(message, error) {
  if (bootstrapFailureHandled) {
    return;
  }

  bootstrapFailureHandled = true;
  if (error) {
    console.error("[Admin] Bootstrap failed:", error);
  } else {
    console.error("[Admin] Bootstrap failed:", message);
  }
  mountBootstrapFailure(message);
}

function installGlobalRuntimeGuards() {
  const onWindowError = (event) => {
    if (bootstrapFailureHandled) {
      return;
    }

    const errorMessage = event?.error?.message || event?.message || "A runtime error interrupted dashboard startup.";
    handleBootstrapFailure(errorMessage, event?.error);
  };

  const onUnhandledRejection = (event) => {
    if (bootstrapFailureHandled) {
      return;
    }

    const reasonMessage = event?.reason?.message || String(event?.reason || "").trim();
    handleBootstrapFailure(reasonMessage || "An unexpected startup promise failed.", event?.reason);
  };

  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
}

async function renderRoute(routeKey, store, options = {}) {
  const route = ROUTES[routeKey] || ROUTES.dashboard;
  const force = Boolean(options?.force);
  const softRefresh = Boolean(options?.softRefresh);
  const routeSignature = getRouteSignature(route.key);
  if (!force && activeRouteKey === route.key && activeRouteSignature === routeSignature) {
    return;
  }

  activeRouteKey = route.key;
  activeRouteSignature = routeSignature;
  const renderToken = ++activeRenderToken;

  const contentShell = document.getElementById("appContent");
  const content = document.getElementById("appPageContent");
  const pageSurface = document.getElementById("appPageSurface");
  if (!contentShell || !content || !pageSurface) {
    return;
  }

  const validSession = await validateActiveSession();
  if (!validSession) {
    logout();
    return;
  }

  const renderer = pageMap[route.key] || renderDashboard;

  setRouteTitle(route.label);
  setActiveNav(route.key);
  store.setState({ route: route.key });
  pageSurface.dataset.route = route.key;
  pageSurface.dataset.routeVariant = routeSignature;

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
    }, 320);
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
  }, 120000);
}

async function bootstrap() {
  installGlobalRuntimeGuards();

  const appRoot = document.getElementById("appRoot");
  if (!appRoot) {
    throw new Error("Missing #appRoot mount container.");
  }

  if (!ensureAuthenticated()) {
    mountBootstrapFailure("Validating admin session and redirecting to login...");
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
  installAutoRefresh(store);
  stopRealtimeSync = startRealtimeAnalyticsSync({ intervalMs: 25000 });
}

window.addEventListener("beforeunload", () => {
  if (typeof stopRealtimeSync === "function") {
    stopRealtimeSync();
  } else {
    stopRealtimeAnalyticsSync();
  }
});

bootstrap().catch((error) => {
  handleBootstrapFailure("The admin dashboard could not initialize. Please reload the page.", error);
});
