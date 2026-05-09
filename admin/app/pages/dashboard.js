import { errorState, panel, table } from "../components/ui.js";
import { getDashboardBundle } from "../services/admin-data.service.js";
import { buildDashboardMarkup, buildDashboardModel } from "./dashboard-view.js";
import { subscribeToLiveFeeds } from "../services/live-feeds.service.js";

const DASHBOARD_REFRESH_DEBOUNCE_MS = 250;

function skeletonTable(columns) {
  const rows = new Array(5).fill(0).map(() => columns.map(() => ({ html: '<span class="skeleton-line"></span>' })));
  return table(columns, rows);
}

function renderLoading(container) {
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

export async function renderDashboard(container) {
  if (typeof container._dashboardCleanup === "function") {
    container._dashboardCleanup();
  }

  container._dashboardRefreshToken = Number(container._dashboardRefreshToken || 0) + 1;
  const refreshToken = container._dashboardRefreshToken;

  renderLoading(container);

  let unsubscribers = [];
  let refreshTimer = null;

  const queueRefresh = () => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(() => {
      void refreshDashboard(container, refreshToken, { force: true, allowCacheFallback: true });
    }, DASHBOARD_REFRESH_DEBOUNCE_MS);
  };

  // Subscribe to live updates
  unsubscribers.push(
    subscribeToLiveFeeds("orders", () => {
      console.log("[Dashboard] Live order update received");
      queueRefresh();
    })
  );

  unsubscribers.push(
    subscribeToLiveFeeds("products", () => {
      console.log("[Dashboard] Live product update received");
      queueRefresh();
    })
  );

  unsubscribers.push(
    subscribeToLiveFeeds("carts", () => {
      console.log("[Dashboard] Live cart update received");
      queueRefresh();
    })
  );

  unsubscribers.push(
    subscribeToLiveFeeds("customers", () => {
      console.log("[Dashboard] Live customer update received");
      queueRefresh();
    })
  );

  unsubscribers.push(
    subscribeToLiveFeeds("activity", () => {
      console.log("[Dashboard] Live activity update received");
      queueRefresh();
    })
  );

  // Initial dashboard render
  await refreshDashboard(container, refreshToken, { preferCache: true, allowCacheFallback: true });

  // Store cleanup function on container for later cleanup
  container._dashboardCleanup = () => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }

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

async function refreshDashboard(container, refreshToken, options = {}) {
  if (refreshToken !== container._dashboardRefreshToken) {
    return;
  }

  if (container._dashboardRefreshInFlight) {
    return;
  }

  container._dashboardRefreshInFlight = true;
  try {
    const bundle = await getDashboardBundle(options);
    const snapshot = bundle?.snapshot || {};
    const analytics = bundle?.analytics || {};
    const orders = bundle?.orders || [];
    const customers = bundle?.customers || [];
    const products = bundle?.products || [];
    const activityLogs = bundle?.activityLogs || [];
    const carts = bundle?.carts || [];
    const failedSources = Array.isArray(bundle?.failedSources) ? bundle.failedSources : [];

    const model = buildDashboardModel({
      snapshot,
      analytics,
      orders,
      customers,
      products,
      activityLogs,
      carts,
      failedSources
    });

    // Update dashboard container with new markup
    if (refreshToken !== container._dashboardRefreshToken) {
      return;
    }

    container.innerHTML = buildDashboardMarkup(model);

    // Add realtime status indicator
    addRealtimeStatusIndicator(container);

    if (!bundle?.snapshot) {
      const errorBanner = document.createElement("div");
      errorBanner.innerHTML = errorState("Dashboard snapshot API is currently unavailable. Showing best available centralized data feeds.");
      container.prepend(errorBanner.firstElementChild);
    }
  } catch (error) {
    console.error("[Dashboard] Refresh error:", error);
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
  indicator.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: rgba(16, 185, 129, 0.9);
    color: white;
    border-radius: 8px;
    font-size: 13px;
    z-index: 1000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    animation: fadeInUp 0.3s ease-out;
  `;
  
  indicator.innerHTML = `
    <div style="width: 8px; height: 8px; background: white; border-radius: 50%; animation: pulse 2s infinite;"></div>
    <span>Live Updates Active</span>
  `;

  container.appendChild(indicator);

  // Add CSS animation
  if (!document.querySelector("style[data-realtime-animations]")) {
    const style = document.createElement("style");
    style.setAttribute("data-realtime-animations", "true");
    style.textContent = `
      @keyframes fadeInUp {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
    `;
    document.head.appendChild(style);
  }
}
