/**
 * Realtime Event Service
 * Centralized event emitter for all ecommerce data changes
 * Enables live admin dashboard updates across devices
 */

const EventEmitter = require('events');

class RealtimeEventService extends EventEmitter {
  constructor() {
    super();
    this.maxListeners = 100;
    this.subscribers = new Set();
    this.eventHistory = [];
    this.maxHistorySize = 500;
    this.streamStartTime = Date.now();
  }

  /**
   * Register a subscriber for realtime events
   * @param {Function} callback - Event handler function
   * @returns {Function} Unsubscribe function
   */
  subscribe(callback) {
    if (typeof callback !== 'function') {
      return () => {};
    }

    this.subscribers.add(callback);
    this.on('event', callback);

    return () => {
      this.subscribers.delete(callback);
      this.removeListener('event', callback);
    };
  }

  /**
   * Emit a realtime event to all subscribers
   * @param {Object} event - Event data { type, scope, payload, timestamp }
   */
  broadcast(event) {
    const envelope = {
      id: this.generateEventId(),
      type: event.type || 'update',
      scope: event.scope || 'unknown',
      payload: event.payload || {},
      timestamp: Date.now(),
      sourcedAt: event.sourcedAt || Date.now()
    };

    // Store in history for catchup/replay
    this.eventHistory.push(envelope);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Emit to all subscribers
    this.emit('event', envelope);

    return envelope;
  }

  /**
   * Emit order-related event
   */
  emitOrderCreated(order) {
    return this.broadcast({
      type: 'order:created',
      scope: 'orders',
      payload: {
        orderId: order._id || order.id,
        order,
        action: 'created'
      }
    });
  }

  emitOrderUpdated(orderId, updates) {
    return this.broadcast({
      type: 'order:updated',
      scope: 'orders',
      payload: {
        orderId,
        updates,
        action: 'updated'
      }
    });
  }

  emitOrderStatusChanged(orderId, oldStatus, newStatus) {
    return this.broadcast({
      type: 'order:status-changed',
      scope: 'orders',
      payload: {
        orderId,
        oldStatus,
        newStatus,
        action: 'status-changed'
      }
    });
  }

  /**
   * Emit product-related events
   */
  emitProductUpdated(productId, updates) {
    return this.broadcast({
      type: 'product:updated',
      scope: 'products',
      payload: {
        productId,
        updates,
        action: 'updated'
      }
    });
  }

  emitProductStockChanged(productId, oldStock, newStock) {
    return this.broadcast({
      type: 'product:stock-changed',
      scope: 'products',
      payload: {
        productId,
        oldStock,
        newStock,
        action: 'stock-changed'
      }
    });
  }

  emitInventoryAlert(alert) {
    return this.broadcast({
      type: 'inventory:alert',
      scope: 'products',
      payload: {
        alert,
        action: 'alert'
      }
    });
  }

  /**
   * Emit customer-related events
   */
  emitCustomerRegistered(customer) {
    return this.broadcast({
      type: 'customer:registered',
      scope: 'customers',
      payload: {
        customerId: customer._id || customer.id,
        customer,
        action: 'registered'
      }
    });
  }

  emitCustomerUpdated(customerId, updates) {
    return this.broadcast({
      type: 'customer:updated',
      scope: 'customers',
      payload: {
        customerId,
        updates,
        action: 'updated'
      }
    });
  }

  /**
   * Emit cart-related events
   */
  emitCartUpdated(cartId, updates) {
    return this.broadcast({
      type: 'cart:updated',
      scope: 'carts',
      payload: {
        cartId,
        updates,
        action: 'updated'
      }
    });
  }

  emitCartAbandoned(cartId, cart) {
    return this.broadcast({
      type: 'cart:abandoned',
      scope: 'carts',
      payload: {
        cartId,
        cart,
        action: 'abandoned'
      }
    });
  }

  /**
   * Emit activity-related events
   */
  emitActivityLogged(activity) {
    return this.broadcast({
      type: 'activity:logged',
      scope: 'activity',
      payload: {
        activity,
        action: 'logged'
      }
    });
  }

  emitCustomerActivity(userId, activityType, details) {
    return this.broadcast({
      type: 'customer:activity',
      scope: 'activity',
      payload: {
        userId,
        activityType,
        details,
        action: 'activity'
      }
    });
  }

  /**
   * Emit analytics event (aggregated update)
   */
  emitAnalyticsUpdated(metrics) {
    return this.broadcast({
      type: 'analytics:updated',
      scope: 'analytics',
      payload: {
        metrics,
        action: 'updated'
      }
    });
  }

  /**
   * Get event history since timestamp
   * @param {number} since - Timestamp to retrieve events since
   * @returns {Array} Array of events since timestamp
   */
  getEventsSince(since) {
    const timestamp = Number(since) || this.streamStartTime;
    return this.eventHistory.filter(event => event.sourcedAt >= timestamp);
  }

  /**
   * Get recent events
   * @param {number} limit - Maximum number of events to return
   * @returns {Array} Recent events
   */
  getRecentEvents(limit = 50) {
    const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 500);
    return this.eventHistory.slice(-safeLimit);
  }

  /**
   * Get event statistics
   */
  getStats() {
    const eventCounts = {};
    this.eventHistory.forEach(event => {
      eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
    });

    return {
      totalEvents: this.eventHistory.length,
      subscriberCount: this.subscribers.size,
      eventTypes: eventCounts,
      uptime: Date.now() - this.streamStartTime,
      maxHistorySize: this.maxHistorySize
    };
  }

  /**
   * Clear event history
   */
  clearHistory() {
    this.eventHistory = [];
  }

  /**
   * Generate unique event ID
   */
  generateEventId() {
    return `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Cleanup and teardown
   */
  destroy() {
    this.subscribers.clear();
    this.removeAllListeners();
    this.eventHistory = [];
  }
}

// Singleton instance
let instance = null;

function getRealtimeEventService() {
  if (!instance) {
    instance = new RealtimeEventService();
  }
  return instance;
}

module.exports = getRealtimeEventService;
