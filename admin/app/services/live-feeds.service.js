/**
 * Live Feeds Handler Service
 * Processes realtime events and updates dashboard data in real-time
 * Manages live orders, inventory, customer activity, and analytics streams
 */

import { subscribeToRealtimeEvents } from "./realtime-sync.service.js";
import {
  getDashboard,
  getOrders,
  getCarts,
  getProducts,
  getCustomers,
  getActivityLogs,
  getAnalytics,
  refreshRealtimeIntelligence,
  ADMIN_SYNC_EVENT
} from "./admin-data.service.js";

const DEBOUNCE_TIME_MS = 500;
const MIN_SCOPE_REFRESH_INTERVAL_MS = 900;

class LiveFeedsHandler {
  constructor() {
    this.listeners = new Map();
    this.debounceTimers = new Map();
    this.updateQueues = new Map();
    this.lastUpdates = new Map();
    this.scopeRefreshInFlight = new Map();
    this.isCriticalUpdate = false;
  }

  /**
   * Start listening to live feed for specific scope
   */
  subscribe(scope, callback) {
    if (typeof callback !== "function") {
      return () => {};
    }

    if (!this.listeners.has(scope)) {
      this.listeners.set(scope, new Set());
    }

    this.listeners.get(scope).add(callback);

    // Subscribe to realtime events
    const unsubscribeRealtime = subscribeToRealtimeEvents(scope, (event) => {
      this.handleLiveUpdate(scope, event);
    });

    return () => {
      const listeners = this.listeners.get(scope);
      if (listeners) {
        listeners.delete(callback);
      }
      unsubscribeRealtime?.();
    };
  }

  /**
   * Handle live update event
   */
  async handleLiveUpdate(scope, event) {
    const { type, payload, timestamp } = event;

    // Queue update to debounce rapid changes
    if (!this.updateQueues.has(scope)) {
      this.updateQueues.set(scope, []);
    }

    this.updateQueues.get(scope).push({
      type,
      payload,
      timestamp
    });

    // Clear existing debounce timer
    if (this.debounceTimers.has(scope)) {
      clearTimeout(this.debounceTimers.get(scope));
    }

    // Set new debounce timer
    const timer = setTimeout(async () => {
      await this.flushUpdates(scope);
    }, DEBOUNCE_TIME_MS);

    this.debounceTimers.set(scope, timer);
  }

  /**
   * Process queued updates
   */
  async flushUpdates(scope) {
    const updates = this.updateQueues.get(scope) || [];
    if (updates.length === 0) return;

    const lastUpdatedAt = Number(this.lastUpdates.get(scope) || 0);
    if ((Date.now() - lastUpdatedAt) < MIN_SCOPE_REFRESH_INTERVAL_MS) {
      return;
    }

    const existing = this.scopeRefreshInFlight.get(scope);
    if (existing) {
      return;
    }

    this.updateQueues.set(scope, []);
    this.lastUpdates.set(scope, Date.now());

    const promise = (async () => {
      // Process based on scope
      switch (scope) {
        case "orders":
          await this.processOrderUpdates(updates);
          break;
        case "products":
          await this.processProductUpdates(updates);
          break;
        case "carts":
          await this.processCartUpdates(updates);
          break;
        case "customers":
          await this.processCustomerUpdates(updates);
          break;
        case "activity":
          await this.processActivityUpdates(updates);
          break;
        case "analytics":
          await this.processAnalyticsUpdates(updates);
          break;
        default:
          console.log(`[LiveFeeds] Unknown scope: ${scope}`);
      }

      this.notifyListeners(scope, updates);
    } catch (error) {
      console.error(`[LiveFeeds] Error processing ${scope} updates:`, error);
    } finally {
      this.scopeRefreshInFlight.delete(scope);
    }
    })();

    this.scopeRefreshInFlight.set(scope, promise);
    await promise;
  }

  /**
   * Process order updates
   */
  async processOrderUpdates(updates) {
    const criticalTypes = [
      "order:created",
      "order:status-changed",
      "order:deleted"
    ];

    const hasCritical = updates.some((u) => criticalTypes.includes(u.type));

    console.log(
      `[LiveFeeds] Processing ${updates.length} order updates${hasCritical ? " (CRITICAL)" : ""}`
    );

    // Refresh orders data
    try {
      await getOrders({ force: true, emit: false });

      // Trigger full dashboard refresh if critical
      if (hasCritical) {
        await refreshRealtimeIntelligence();
      }
    } catch (error) {
      console.error("[LiveFeeds] Failed to refresh orders:", error.message);
    }
  }

  /**
   * Process product/inventory updates
   */
  async processProductUpdates(updates) {
    const criticalTypes = [
      "product:stock-changed",
      "inventory:alert"
    ];

    const hasCritical = updates.some((u) => criticalTypes.includes(u.type));

    console.log(
      `[LiveFeeds] Processing ${updates.length} product updates${hasCritical ? " (CRITICAL)" : ""}`
    );

    try {
      await getProducts({ force: true, emit: false });

      if (hasCritical) {
        await refreshRealtimeIntelligence();
      }
    } catch (error) {
      console.error("[LiveFeeds] Failed to refresh products:", error.message);
    }
  }

  /**
   * Process cart updates
   */
  async processCartUpdates(updates) {
    console.log(`[LiveFeeds] Processing ${updates.length} cart updates`);

    try {
      await getCarts({ force: true, emit: false });
      await refreshRealtimeIntelligence();
    } catch (error) {
      console.error("[LiveFeeds] Failed to refresh carts:", error.message);
    }
  }

  /**
   * Process customer updates
   */
  async processCustomerUpdates(updates) {
    console.log(`[LiveFeeds] Processing ${updates.length} customer updates`);

    try {
      await getCustomers({ force: true, emit: false });
      await refreshRealtimeIntelligence();
    } catch (error) {
      console.error("[LiveFeeds] Failed to refresh customers:", error.message);
    }
  }

  /**
   * Process activity updates
   */
  async processActivityUpdates(updates) {
    console.log(`[LiveFeeds] Processing ${updates.length} activity updates`);

    try {
      await getActivityLogs({ force: true, emit: false });
    } catch (error) {
      console.error("[LiveFeeds] Failed to refresh activity:", error.message);
    }
  }

  /**
   * Process analytics updates
   */
  async processAnalyticsUpdates(updates) {
    console.log(`[LiveFeeds] Processing ${updates.length} analytics updates`);

    try {
      await getAnalytics();
      await refreshRealtimeIntelligence();
    } catch (error) {
      console.error("[LiveFeeds] Failed to refresh analytics:", error.message);
    }
  }

  /**
   * Notify all listeners for a scope
   */
  notifyListeners(scope, updates) {
    const listeners = this.listeners.get(scope);
    if (!listeners || listeners.size === 0) return;

    listeners.forEach((callback) => {
      try {
        callback({
          scope,
          updates,
          timestamp: Date.now()
        });
      } catch (error) {
        console.error(`[LiveFeeds] Listener error for ${scope}:`, error);
      }
    });
  }

  /**
   * Get live feed status
   */
  getStatus() {
    const scopes = Array.from(this.listeners.keys());
    return {
      subscribedScopes: scopes,
      totalListeners: Array.from(this.listeners.values()).reduce(
        (sum, set) => sum + set.size,
        0
      ),
      pendingUpdates: Array.from(this.updateQueues.values()).reduce(
        (sum, queue) => sum + queue.length,
        0
      ),
      lastUpdates: Object.fromEntries(this.lastUpdates)
    };
  }

  /**
   * Cleanup and teardown
   */
  destroy() {
    this.listeners.clear();
    this.updateQueues.clear();

    Array.from(this.debounceTimers.values()).forEach((timer) => {
      clearTimeout(timer);
    });
    this.debounceTimers.clear();

    this.lastUpdates.clear();
  }
}

// Singleton instance
let instance = null;

export function getLiveFeedsHandler() {
  if (!instance) {
    instance = new LiveFeedsHandler();
  }
  return instance;
}

export function subscribeToLiveFeeds(scope, callback) {
  const handler = getLiveFeedsHandler();
  return handler.subscribe(scope, callback);
}

export function startLiveFeeds(scopes = ["orders", "products", "carts", "customers", "activity"]) {
  const handler = getLiveFeedsHandler();
  scopes.forEach((scope) => {
    handler.subscribe(scope, () => {
      // Just subscribe to trigger updates
    });
  });
  return handler;
}

export function stopLiveFeeds() {
  const handler = getLiveFeedsHandler();
  handler.destroy();
}
