import { errorState, panel, table } from "../components/ui.js";
import { getActivityLogs, getAnalytics, getCarts, getCustomers, getDashboard, getOrders, getProducts } from "../services/admin-data.service.js";
import { buildDashboardMarkup, buildDashboardModel } from "./dashboard-view.js";
import { startRealtimeSync, subscribeToRealtimeEvents } from "../services/realtime-sync.service.js";
import { startLiveFeeds, subscribeToLiveFeeds } from "../services/live-feeds.service.js";

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

  // Start realtime synchronization
  const realtimeService = await startRealtimeSync();
  
  // Start live feeds handler
  const liveFeeds = startLiveFeeds();

  let unsubscribers = [];

  // Subscribe to live updates
  unsubscribers.push(
    subscribeToLiveFeeds("orders", async () => {
      console.log("[Dashboard] Live order update received");
      await refreshDashboard(container, unsubscribers);
    })
  );

  unsubscribers.push(
    subscribeToLiveFeeds("products", async () => {
      console.log("[Dashboard] Live product update received");
      await refreshDashboard(container, unsubscribers);
    })
  );

  unsubscribers.push(
    subscribeToLiveFeeds("carts", async () => {
      console.log("[Dashboard] Live cart update received");
      await refreshDashboard(container, unsubscribers);
    })
  );

  unsubscribers.push(
    subscribeToLiveFeeds("customers", async () => {
      console.log("[Dashboard] Live customer update received");
      await refreshDashboard(container, unsubscribers);
    })
  );

  unsubscribers.push(
    subscribeToLiveFeeds("activity", async () => {
      console.log("[Dashboard] Live activity update received");
      await refreshDashboard(container, unsubscribers);
    })
  );

  // Initial dashboard render
  await refreshDashboard(container, unsubscribers);

  // Store cleanup function on container for later cleanup
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

async function refreshDashboard(container, unsubscribers) {
  if (container._dashboardRefreshInFlight) {
    return;
  }

  container._dashboardRefreshInFlight = true;
  try {
    const [snapshotResult, analyticsResult, ordersResult, customersResult, productsResult, logsResult, cartsResult] = await Promise.allSettled([
      getDashboard(),
      getAnalytics(),
      getOrders(),
      getCustomers(),
      getProducts(),
      getActivityLogs(),
      getCarts()
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
    container.innerHTML = buildDashboardMarkup(model);

    // Add realtime status indicator
    addRealtimeStatusIndicator(container);

    if (!snapshotResult || snapshotResult.status === "rejected") {
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
