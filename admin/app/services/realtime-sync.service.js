/**
 * Realtime Sync Service
 * Manages live ecommerce data synchronization between backend and admin dashboard
 * Handles SSE connection, event processing, cache updates, and multi-device consistency
 */

import * as api from "../core/api.js";
import { publishRealtime } from "../core/realtime-adapter.js";

const REALTIME_CONFIG = {
  SSE_TIMEOUT_MS: 45000,
  POLLING_INTERVAL_MS: 8000,
  RECONNECT_BACKOFF_BASE_MS: 1000,
  RECONNECT_BACKOFF_MAX_MS: 60000,
  EVENT_DEBOUNCE_MS: 300,
  BROADCAST_CHANNEL_NAME: "byose_admin_sync"
};

class RealtimeSyncService {
  constructor() {
    this.isConnected = false;
    this.useSSE = typeof window !== "undefined" && typeof window.EventSource === "function";
    this.sseConnection = null;
    this.pollingInterval = null;
    this.reconnectBackoff = REALTIME_CONFIG.RECONNECT_BACKOFF_BASE_MS;
    this.activeTransport = this.useSSE ? "sse" : "polling";
    this.eventDebounceTimer = null;
    this.pendingEvents = [];
    this.eventListeners = new Map();
    this.broadcastChannel = null;
    this.connectionAttempts = 0;
    this.lastPollTimestamp = 0;
    this.reconnectTimer = null;
    this.pollingInFlight = false;
    this.processedEventIds = new Map();
    this.maxProcessedEvents = 1200;

    this.initializeBroadcastChannel();
  }

  /**
   * Initialize cross-tab communication via Broadcast Channel API
   */
  initializeBroadcastChannel() {
    try {
      if ("BroadcastChannel" in window) {
        this.broadcastChannel = new BroadcastChannel(REALTIME_CONFIG.BROADCAST_CHANNEL_NAME);
        this.broadcastChannel.onmessage = (event) => {
          this.handleCrossTabMessage(event.data);
        };
      }
    } catch (error) {
      console.warn("BroadcastChannel not available:", error.message);
    }
  }

  /**
   * Handle messages from other admin tabs
   */
  handleCrossTabMessage(message) {
    if (!message || typeof message !== "object") return;

    const { type, event, connectionStatus } = message;

    // Handle connection status sync
    if (type === "connection-status") {
      console.log(`[Realtime] Cross-tab connection status: ${connectionStatus}`);
      return;
    }

    // Handle event propagation from other tabs
    if (type === "event" && event) {
      this.processEvent(event, "cross-tab");
    }
  }

  buildEventKey(event) {
    const id = String(event?.id || "").trim();
    if (id) {
      return `id:${id}`;
    }

    return [
      String(event?.type || ""),
      String(event?.scope || ""),
      Number(event?.timestamp || 0),
      JSON.stringify(event?.payload || {})
    ].join("|");
  }

  hasProcessedEvent(event) {
    const key = this.buildEventKey(event);
    if (!key) {
      return false;
    }

    const existing = this.processedEventIds.get(key);
    if (existing && (Date.now() - existing) < 120000) {
      return true;
    }

    this.processedEventIds.set(key, Date.now());
    if (this.processedEventIds.size > this.maxProcessedEvents) {
      const overflow = this.processedEventIds.size - this.maxProcessedEvents;
      const keys = this.processedEventIds.keys();
      for (let index = 0; index < overflow; index += 1) {
        const next = keys.next();
        if (next.done) {
          break;
        }
        this.processedEventIds.delete(next.value);
      }
    }

    return false;
  }

  /**
   * Broadcast connection status to other tabs
   */
  broadcastConnectionStatus(status) {
    if (!this.broadcastChannel) return;

    try {
      this.broadcastChannel.postMessage({
        type: "connection-status",
        connectionStatus: status,
        timestamp: Date.now()
      });
    } catch (error) {
      console.warn("Failed to broadcast connection status:", error.message);
    }
  }

  /**
   * Broadcast event to other tabs
   */
  broadcastEvent(event) {
    if (!this.broadcastChannel) return;

    try {
      this.broadcastChannel.postMessage({
        type: "event",
        event,
        timestamp: Date.now()
      });
    } catch (error) {
      console.warn("Failed to broadcast event:", error.message);
    }
  }

  /**
   * Subscribe to realtime events for a specific scope
   */
  subscribe(scope, callback) {
    if (typeof callback !== "function") {
      return () => {};
    }

    if (!this.eventListeners.has(scope)) {
      this.eventListeners.set(scope, new Set());
    }

    this.eventListeners.get(scope).add(callback);

    return () => {
      const listeners = this.eventListeners.get(scope);
      if (listeners) {
        listeners.delete(callback);
      }
    };
  }

  /**
   * Process incoming realtime event
   */
  processEvent(event, source = "sse") {
    if (!event || typeof event !== "object") return;

    if (this.hasProcessedEvent(event)) {
      return;
    }

    const { type, scope, payload, id, timestamp } = event;

    // Broadcast to cross-tab if from SSE
    if (source === "sse") {
      this.broadcastEvent(event);
    }

    // Call registered listeners for this scope
    const listeners = this.eventListeners.get(scope);
    if (listeners && listeners.size > 0) {
      listeners.forEach((callback) => {
        try {
          callback({
            type,
            scope,
            payload,
            id,
            timestamp,
            source
          });
        } catch (error) {
          console.error(`[Realtime] Event listener error (${scope}):`, error);
        }
      });
    }

    // Emit via global realtime adapter
    publishRealtime(event);
  }

  /**
   * Connect via SSE (Server-Sent Events)
   */
  async connectSSE() {
    if (this.sseConnection) {
      return;
    }

    try {
      console.log("[Realtime] Connecting via SSE...");
      const apiBase = String(
        window.AdminConfig?.apiBaseUrl
        || window.AdminSecurity?.getApiBaseUrl?.()
        || "https://byosemarket.com/api"
      ).replace(/\/+$/, "");
      const adminToken = String(window.localStorage.getItem("adminToken") || "").trim();
      const eventSourceUrl = adminToken
        ? `${apiBase}/realtime/stream?access_token=${encodeURIComponent(adminToken)}`
        : `${apiBase}/realtime/stream`;
      this.activeTransport = "sse";

      this.sseConnection = new EventSource(eventSourceUrl);

      this.sseConnection.onopen = () => {
        console.log("[Realtime] SSE connected");
        this.isConnected = true;
        this.reconnectBackoff = REALTIME_CONFIG.RECONNECT_BACKOFF_BASE_MS;
        this.connectionAttempts = 0;
        this.broadcastConnectionStatus("connected");
      };

      this.sseConnection.onmessage = (event) => {
        const data = event.data?.trim();
        if (!data || data === ":heartbeat" || data === ":connected") {
          return; // Ignore heartbeats and connection messages
        }

        try {
          const message = JSON.parse(data);
          this.processEvent(message, "sse");
        } catch (error) {
          console.warn("[Realtime] Failed to parse SSE message:", error.message);
        }
      };

      this.sseConnection.onerror = (error) => {
        console.error("[Realtime] SSE error:", error);
        this.isConnected = false;
        this.broadcastConnectionStatus("disconnected");
        this.sseConnection?.close();
        this.sseConnection = null;
        void this.fallbackToPolling();
      };
    } catch (error) {
      console.error("[Realtime] SSE connection failed:", error.message);
      this.isConnected = false;
      await this.fallbackToPolling();
    }
  }

  async fallbackToPolling() {
    if (this.pollingInterval) {
      return;
    }

    this.useSSE = false;
    this.activeTransport = "polling";

    try {
      await this.connectPolling();
    } catch (error) {
      console.error("[Realtime] Polling fallback failed:", error.message);
      this.scheduleReconnect();
    }
  }

  /**
   * Connect via polling (fallback)
   */
  async connectPolling() {
    if (this.pollingInterval) {
      return;
    }

    console.log("[Realtime] Connecting via polling...");

    this.activeTransport = "polling";
    this.isConnected = true;
    this.reconnectBackoff = REALTIME_CONFIG.RECONNECT_BACKOFF_BASE_MS;
    this.connectionAttempts = 0;
    this.broadcastConnectionStatus("connected");

    const poll = async () => {
      if (this.pollingInFlight) {
        return;
      }

      this.pollingInFlight = true;
      try {
        const response = await api.get(`realtime/events?since=${this.lastPollTimestamp}&limit=100`);
        if (response && response.events && Array.isArray(response.events)) {
          response.events.forEach((event) => {
            this.processEvent(event, "polling");
          });

          if (response.events.length > 0) {
            this.lastPollTimestamp = Math.max(
              ...response.events.map((e) => e.timestamp || 0)
            );
          }
        }
      } catch (error) {
        console.warn("[Realtime] Polling error:", error.message);
        this.isConnected = false;
        this.broadcastConnectionStatus("disconnected");
        if (this.pollingInterval) {
          clearInterval(this.pollingInterval);
          this.pollingInterval = null;
        }
        this.scheduleReconnect();
      } finally {
        this.pollingInFlight = false;
      }
    };

    // Initial poll
    await poll();

    // Schedule regular polling
    this.pollingInterval = setInterval(poll, REALTIME_CONFIG.POLLING_INTERVAL_MS);
  }

  /**
   * Attempt to connect to realtime stream
   */
  async connect() {
    if (this.isConnected) {
      return;
    }

    this.connectionAttempts += 1;

    try {
      const canUseSSE = typeof window !== "undefined" && typeof window.EventSource === "function";
      this.useSSE = canUseSSE;

      if (this.useSSE) {
        await this.connectSSE();
      } else {
        await this.connectPolling();
      }
    } catch (error) {
      console.error("[Realtime] Connection failed:", error.message);
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    const backoff = Math.min(
      this.reconnectBackoff * (1 + Math.random()),
      REALTIME_CONFIG.RECONNECT_BACKOFF_MAX_MS
    );

    console.log(`[Realtime] Reconnecting in ${Math.round(backoff)}ms (attempt ${this.connectionAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, backoff);

    this.reconnectBackoff = Math.min(
      this.reconnectBackoff * 2,
      REALTIME_CONFIG.RECONNECT_BACKOFF_MAX_MS
    );
  }

  /**
   * Disconnect from realtime stream
   */
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.sseConnection) {
      this.sseConnection.close();
      this.sseConnection = null;
    }

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    if (this.sseTimeoutHandle) {
      clearTimeout(this.sseTimeoutHandle);
      this.sseTimeoutHandle = null;
    }

    this.isConnected = false;
    this.useSSE = typeof window !== "undefined" && typeof window.EventSource === "function";
    this.activeTransport = this.useSSE ? "sse" : "polling";
    this.pollingInFlight = false;
    this.broadcastConnectionStatus("disconnected");
  }

  /**
   * Check realtime service health
   */
  async checkHealth() {
    try {
      const response = await api.get("realtime/ping");
      return response?.success === true;
    } catch (error) {
      console.warn("[Realtime] Health check failed:", error.message);
      return false;
    }
  }

  /**
   * Get realtime service statistics
   */
  async getStats() {
    try {
      const response = await api.get("realtime/stats");
      return response?.stats || null;
    } catch (error) {
      console.warn("[Realtime] Failed to get stats:", error.message);
      return null;
    }
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      useSSE: this.useSSE,
      activeTransport: this.activeTransport,
      connectionAttempts: this.connectionAttempts,
      reconnectBackoff: this.reconnectBackoff,
      subscriberCount: Array.from(this.eventListeners.values()).reduce(
        (sum, set) => sum + set.size,
        0
      ),
      lastEventTime: this.lastEventTime
    };
  }

  /**
   * Cleanup and teardown
   */
  destroy() {
    this.disconnect();
    this.eventListeners.clear();

    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
  }
}

// Singleton instance
let instance = null;

export function getRealtimeSyncService() {
  if (!instance) {
    instance = new RealtimeSyncService();
  }
  return instance;
}

export async function startRealtimeSync() {
  const service = getRealtimeSyncService();
  if (!service.isConnected) {
    await service.connect();
  }
  return service;
}

export function stopRealtimeSync() {
  const service = getRealtimeSyncService();
  service.disconnect();
}

export function subscribeToRealtimeEvents(scope, callback) {
  const service = getRealtimeSyncService();
  return service.subscribe(scope, callback);
}
