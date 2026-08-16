import { errorState, panel, table } from "../components/ui.js";
import { getActivityLogs, getAnalytics, getCarts, getCustomers, getDashboard, getOrders, getProducts } from "../services/admin-data.service.js";
import { buildDashboardMarkup, buildDashboardModel } from "./dashboard-view.js";
import { bindOverviewActions, buildOverviewMarkup, buildOverviewModel, renderOverviewLoading } from "./dashboard-overview.js";
import { bindStatisticsActions, buildStatisticsMarkup, buildStatisticsModel, renderStatisticsLoading } from "./dashboard-statistics.js";
import { bindQuickAnalyticsActions, buildQuickAnalyticsMarkup, buildQuickAnalyticsModel, renderQuickAnalyticsLoading } from "./dashboard-quick-analytics.js";
import { startRealtimeSync } from "../services/realtime-sync.service.js";
import { startLiveFeeds, subscribeToLiveFeeds } from "../services/live-feeds.service.js";

function skeletonTable(columns) {
  const rows = new Array(5).fill(0).map(() => columns.map(() => ({ html: '<span class="skeleton-line"></span>' })));
  return table(columns, rows);
}

function getDashboardPanel() {
  const hash = String(window.location.hash || "");
  const queryStart = hash.indexOf("?");
  if (queryStart < 0) {
    return "overview";
  }
  const requested = String(new URLSearchParams(hash.slice(queryStart + 1)).get("panel") || "overview").trim().toLowerCase();
  return requested || "overview";
}

function isOverviewPanel() {
  const requested = getDashboardPanel();
  return requested === "overview" || requested === "";
}

function isStatisticsPanel() {
  return getDashboardPanel() === "statistics";
}

function isQuickAnalyticsPanel() {
  return getDashboardPanel() === "quick-analytics";
}

function renderLoading(container) {
  if (isOverviewPanel()) {
    container.innerHTML = renderOverviewLoading();
    return;
  }

  if (isStatisticsPanel()) {
    container.innerHTML = renderStatisticsLoading();
    return;
  }

  if (isQuickAnalyticsPanel()) {
    container.innerHTML = renderQuickAnalyticsLoading();
    return;
  }

  container.innerHTML = `
    <section class="hero-overview hero-overview-skeleton card">
      <div>
        <span class="skeleton-line skeleton-line-lg"></span>
        <span class="skeleton-line"></span>
      </div>
      <div class="hero-chip-grid">
        <span class="skeleton-pill"></span>
        <span class="skeleton-pill"></span>
        <span class="skeleton-pill"></span>
      </div>
    </section>
    <section class="stats-grid stats-grid-premium">
      <article class="card stat-card"><span class="skeleton-line"></span><span class="skeleton-line skeleton-line-lg"></span></article>
      <article class="card stat-card"><span class="skeleton-line"></span><span class="skeleton-line skeleton-line-lg"></span></article>
      <article class="card stat-card"><span class="skeleton-line"></span><span class="skeleton-line skeleton-line-lg"></span></article>
      <article class="card stat-card"><span class="skeleton-line"></span><span class="skeleton-line skeleton-line-lg"></span></article>
    </section>
    <section class="content-grid">
      ${panel("Loading dashboard", "Preparing live ecommerce panels", skeletonTable(["Order", "Customer", "Amount", "Status", "Date"]))}
    </section>
  `;
}

function normalizeSettledPayload(result) {
  if (result.status === "fulfilled") {
    return result.value;
  }

  return null;
}

export async function renderDashboard(container) {
  if (typeof container._dashboardCleanup === "function") {
    container._dashboardCleanup();
  }

  renderLoading(container);

  void startRealtimeSync().catch((error) => {
    console.warn("[Dashboard] Realtime sync unavailable:", error?.message || error);
  });
  try {
    startLiveFeeds();
  } catch (error) {
    console.warn("[Dashboard] Live feeds unavailable:", error?.message || error);
  }

  let unsubscribers = [];

  unsubscribers.push(
    subscribeToLiveFeeds("orders", async () => {
      await refreshDashboard(container, unsubscribers);
    })
  );

  unsubscribers.push(
    subscribeToLiveFeeds("products", async () => {
      await refreshDashboard(container, unsubscribers);
    })
  );

  unsubscribers.push(
    subscribeToLiveFeeds("carts", async () => {
      await refreshDashboard(container, unsubscribers);
    })
  );

  unsubscribers.push(
    subscribeToLiveFeeds("customers", async () => {
      await refreshDashboard(container, unsubscribers);
    })
  );

  unsubscribers.push(
    subscribeToLiveFeeds("activity", async () => {
      await refreshDashboard(container, unsubscribers);
    })
  );

  await refreshDashboard(container, unsubscribers, { force: true });

  container._dashboardCleanup = () => {
    unsubscribers.forEach((unsub) => {
      try {
        unsub?.();
      } catch (error) {
        console.error("[Dashboard] Cleanup error:", error);
      }
    });
    unsubscribers = [];
  };
}

const DASHBOARD_MIN_REFRESH_MS = 15000;

async function refreshDashboard(container, unsubscribers, options = {}) {
  if (container._dashboardRefreshInFlight) {
    return;
  }

  const now = Date.now();
  if (!options.force && container._dashboardHasRendered && container._dashboardLastRefreshAt
    && (now - container._dashboardLastRefreshAt) < DASHBOARD_MIN_REFRESH_MS) {
    return;
  }

  container._dashboardRefreshInFlight = true;
  try {
    const wantsLegacyFallback = !isOverviewPanel() && !isStatisticsPanel() && !isQuickAnalyticsPanel();
    const [snapshotResult, analyticsResult, ordersResult, customersResult, productsResult, logsResult, cartsResult] = await Promise.allSettled([
      getDashboard({ emit: false, silent: true }),
      isOverviewPanel() ? getAnalytics({ emit: false, silent: true }) : Promise.resolve({}),
      getOrders({ emit: false }),
      getCustomers({ emit: false }),
      getProducts({ emit: false }),
      getActivityLogs({ emit: false }),
      wantsLegacyFallback ? getCarts({ emit: false }) : Promise.resolve([])
    ]);

    const failedSources = [
      ["dashboard", snapshotResult],
      ["analytics", analyticsResult],
      ["orders", ordersResult],
      ["customers", customersResult],
      ["products", productsResult],
      ["activity", logsResult],
      ["carts", cartsResult]
    ]
      .filter(([, result]) => result.status === "rejected")
      .map(([name, result]) => `${name}: ${String(result.reason?.message || "Request failed")}`);

    const snapshot = normalizeSettledPayload(snapshotResult) || {};
    const analytics = normalizeSettledPayload(analyticsResult) || {};
    const orders = normalizeSettledPayload(ordersResult) || [];
    const customers = normalizeSettledPayload(customersResult) || [];
    const products = normalizeSettledPayload(productsResult) || [];
    const activityLogs = normalizeSettledPayload(logsResult) || [];
    const carts = normalizeSettledPayload(cartsResult) || [];

    const payload = {
      snapshot,
      analytics,
      orders,
      customers,
      products,
      activityLogs,
      carts,
      failedSources
    };

    if (isOverviewPanel()) {
      const range = container._overviewRange || "week";
      const overviewModel = buildOverviewModel(payload, range);
      container.innerHTML = buildOverviewMarkup(overviewModel);
      bindOverviewActions(container, {
        payload,
        onRefresh: (refreshOptions) => refreshDashboard(container, unsubscribers, refreshOptions)
      });
    } else if (isStatisticsPanel()) {
      const period = container._statisticsPeriod || { key: "month", from: "", to: "" };
      const statisticsModel = buildStatisticsModel(payload, period);
      container.innerHTML = buildStatisticsMarkup(statisticsModel);
      bindStatisticsActions(container, {
        payload,
        onRefresh: (refreshOptions) => refreshDashboard(container, unsubscribers, refreshOptions)
      });
    } else if (isQuickAnalyticsPanel()) {
      const periodKey = container._quickPeriod || "today";
      const quickModel = buildQuickAnalyticsModel(payload, periodKey);
      container.innerHTML = buildQuickAnalyticsMarkup(quickModel);
      bindQuickAnalyticsActions(container, {
        payload,
        onRefresh: (refreshOptions) => refreshDashboard(container, unsubscribers, refreshOptions)
      });
    } else {
      const model = buildDashboardModel(payload);
      container.innerHTML = buildDashboardMarkup(model);
      addRealtimeStatusIndicator(container);

      if (!snapshotResult || snapshotResult.status === "rejected") {
        const errorBanner = document.createElement("div");
        errorBanner.innerHTML = errorState("Dashboard snapshot API is currently unavailable. Showing best available centralized data feeds.");
        container.prepend(errorBanner.firstElementChild);
      }
    }

    container._dashboardHasRendered = true;
    container._dashboardLastRefreshAt = Date.now();
    container._overviewPayload = payload;
  } catch (error) {
    console.error("[Dashboard] Refresh error:", error);
    if (!container._dashboardHasRendered) {
      container.innerHTML = errorState("Unable to load Dashboard data. Please refresh or try again.");
    }
  } finally {
    container._dashboardRefreshInFlight = false;
  }
}

function addRealtimeStatusIndicator(container) {
  const existingIndicator = container.querySelector("[data-realtime-indicator]");
  if (existingIndicator) {
    existingIndicator.remove();
  }

  const indicator = document.createElement("div");
  indicator.setAttribute("data-realtime-indicator", "true");
  indicator.className = "dashboard-realtime-indicator";

  indicator.innerHTML = `
    <span class="dashboard-realtime-indicator-dot" aria-hidden="true"></span>
    <span>Live Updates Active</span>
  `;

  const dashboardGrid = container.querySelector(".dashboard-grid");
  if (dashboardGrid) {
    dashboardGrid.prepend(indicator);
    return;
  }

  container.prepend(indicator);
}
