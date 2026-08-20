/**
 * Admin in-app notification engine.
 * Separates event → notification mapping from business controllers.
 * Email/SMS delivery is handled by the automation worker + notification hub
 * after events are persisted. Controllers must only enqueue via the helpers below.
 */

const notificationService = require('./notification.service');
const getRealtimeEventService = require('./realtimeeventservice');
const { appLogger } = require('../utils/logger');
const {
    isPaidStatus,
    isFailedPayment,
    isCancelledPayment,
    isPendingPayment,
    mapStatusToEventKey,
    mapReturnActionToEventKey,
    listOrderCreatedEvents,
    listOrderStatusChangedEvents
} = require('./notification-lifecycle.map');

const LOW_STOCK_THRESHOLD = 5;

const EVENT_CATALOG = Object.freeze({
    ORDER_CREATED: {
        key: 'ORDER_CREATED',
        type: 'order',
        priority: 'high',
        title: 'New order received',
        icon: 'order'
    },
    PAYMENT_PENDING: {
        key: 'PAYMENT_PENDING',
        type: 'payment',
        priority: 'normal',
        title: 'Payment pending',
        icon: 'payment'
    },
    PAYMENT_RECEIVED: {
        key: 'PAYMENT_RECEIVED',
        type: 'payment',
        priority: 'high',
        title: 'Payment successful',
        icon: 'payment'
    },
    PAYMENT_FAILED: {
        key: 'PAYMENT_FAILED',
        type: 'payment',
        priority: 'high',
        title: 'Payment failed',
        icon: 'payment'
    },
    PAYMENT_CANCELLED: {
        key: 'PAYMENT_CANCELLED',
        type: 'payment',
        priority: 'high',
        title: 'Payment cancelled',
        icon: 'payment'
    },
    ORDER_CANCELLED: {
        key: 'ORDER_CANCELLED',
        type: 'order',
        priority: 'high',
        title: 'Order cancelled',
        icon: 'order'
    },
    ORDER_CONFIRMED: {
        key: 'ORDER_CONFIRMED',
        type: 'order',
        priority: 'normal',
        title: 'Order confirmed',
        icon: 'order'
    },
    ORDER_PROCESSING: {
        key: 'ORDER_PROCESSING',
        type: 'order',
        priority: 'normal',
        title: 'Order processing',
        icon: 'order'
    },
    ORDER_PACKED: {
        key: 'ORDER_PACKED',
        type: 'order',
        priority: 'normal',
        title: 'Order packed',
        icon: 'order'
    },
    ORDER_SHIPPED: {
        key: 'ORDER_SHIPPED',
        type: 'order',
        priority: 'normal',
        title: 'Order shipped',
        icon: 'order'
    },
    ORDER_DELIVERED: {
        key: 'ORDER_DELIVERED',
        type: 'order',
        priority: 'normal',
        title: 'Order delivered',
        icon: 'order'
    },
    REFUND_REQUESTED: {
        key: 'REFUND_REQUESTED',
        type: 'refund',
        priority: 'high',
        title: 'Refund requested',
        icon: 'refund'
    },
    REFUND_APPROVED: {
        key: 'REFUND_APPROVED',
        type: 'refund',
        priority: 'high',
        title: 'Refund completed',
        icon: 'refund'
    },
    REFUND_REJECTED: {
        key: 'REFUND_REJECTED',
        type: 'refund',
        priority: 'high',
        title: 'Refund rejected',
        icon: 'refund'
    },
    CUSTOMER_REGISTERED: {
        key: 'CUSTOMER_REGISTERED',
        type: 'customer',
        priority: 'normal',
        title: 'New customer registered',
        icon: 'customer'
    },
    LOW_STOCK: {
        key: 'LOW_STOCK',
        type: 'inventory',
        priority: 'high',
        title: 'Low stock alert',
        icon: 'inventory'
    },
    OUT_OF_STOCK: {
        key: 'OUT_OF_STOCK',
        type: 'inventory',
        priority: 'high',
        title: 'Out of stock alert',
        icon: 'inventory'
    },
    PRODUCT_PUBLISHED: {
        key: 'PRODUCT_PUBLISHED',
        type: 'product',
        priority: 'normal',
        title: 'Product published',
        icon: 'product'
    },
    PRODUCT_DISABLED: {
        key: 'PRODUCT_DISABLED',
        type: 'product',
        priority: 'normal',
        title: 'Product disabled',
        icon: 'product'
    }
});

function text(value, fallback = '') {
    const next = String(value == null ? '' : value).trim();
    return next || fallback;
}

function lower(value) {
    return text(value).toLowerCase();
}

function orderIdOf(order) {
    return text(order?.orderId || order?.id || order?._id);
}

function customerIdOf(orderOrUser) {
    return text(
        orderOrUser?.customerId
        || orderOrUser?.userId
        || orderOrUser?.id
        || orderOrUser?._id
    ) || null;
}

function customerLabel(orderOrUser) {
    return text(
        orderOrUser?.customerName
        || orderOrUser?.shippingAddress?.fullName
        || orderOrUser?.name
        || orderOrUser?.email
        || orderOrUser?.phone
        || 'Customer'
    );
}

function productIdOf(product) {
    return text(product?.catalogId || product?.id || product?._id);
}

function productNameOf(product) {
    return text(product?.name || product?.title || product?.catalogId || 'Product');
}

function isPublishedStatus(value) {
    const status = lower(value);
    return status === 'active' || status === 'published' || status === 'live';
}

function isDisabledStatus(value) {
    const status = lower(value);
    return status === 'inactive' || status === 'disabled' || status === 'archived' || status === 'draft';
}

function buildMessage(eventKey, context = {}) {
    const orderId = text(context.orderId || orderIdOf(context.order));
    const customer = text(context.customerName || customerLabel(context.order || context.customer));
    const productName = text(context.productName || productNameOf(context.product));
    const stock = context.stock;

    switch (eventKey) {
    case 'ORDER_CREATED': {
        const paymentLabel = text(
            context.order?.paymentStatusLabel
            || context.order?.payment?.statusLabel
            || context.order?.paymentStatus
            || context.order?.payment?.status,
            'pending'
        );
        return `Order ${orderId} was placed by ${customer}. Payment status: ${paymentLabel}.`;
    }
    case 'PAYMENT_PENDING':
        return `Payment is still pending for order ${orderId}.`;
    case 'PAYMENT_RECEIVED':
        return `Payment successful for order ${orderId}.`;
    case 'PAYMENT_FAILED':
        return `Payment failed for order ${orderId}.`;
    case 'PAYMENT_CANCELLED':
        return `Payment was cancelled for order ${orderId}.`;
    case 'ORDER_CANCELLED':
        return `Order ${orderId} was cancelled.`;
    case 'ORDER_CONFIRMED':
        return `Order ${orderId} is now confirmed.`;
    case 'ORDER_PROCESSING':
        return `Order ${orderId} is now processing.`;
    case 'ORDER_PACKED':
        return `Order ${orderId} has been packed.`;
    case 'ORDER_SHIPPED':
        return `Order ${orderId} has been shipped.`;
    case 'ORDER_DELIVERED':
        return `Order ${orderId} was delivered.`;
    case 'REFUND_REQUESTED':
        return `A refund/return was requested for order ${orderId}.`;
    case 'REFUND_APPROVED':
        return `Refund completed for order ${orderId}.`;
    case 'REFUND_REJECTED':
        return `Refund rejected for order ${orderId}.`;
    case 'CUSTOMER_REGISTERED':
        return `${customer} just created a customer account.`;
    case 'LOW_STOCK':
        return `${productName} is running low (${Number(stock)} left).`;
    case 'OUT_OF_STOCK':
        return `${productName} is out of stock.`;
    case 'PRODUCT_PUBLISHED':
        return `${productName} is now published to the storefront.`;
    case 'PRODUCT_DISABLED':
        return `${productName} was disabled / unpublished.`;
    default:
        return text(context.message, 'A platform event was recorded.');
    }
}

/**
 * Core executor — create DB notification + realtime fan-out.
 * Invoked by the background automation worker after an event is claimed.
 * Does not send email (email is handled by the automation/email pipeline).
 */
async function executeEvent(eventKey, context = {}) {
    const def = EVENT_CATALOG[eventKey];
    if (!def) {
        appLogger.warn('notification.engine.unknown_event', { eventKey });
        return null;
    }

    const title = text(context.title, def.title);
    const message = text(context.message, buildMessage(eventKey, context));
    const relatedOrderId = text(context.relatedOrderId || context.orderId || orderIdOf(context.order)) || null;
    const relatedCustomerId = text(context.relatedCustomerId || context.customerId || customerIdOf(context.order || context.customer)) || null;
    const relatedProductId = text(context.relatedProductId || context.productId || productIdOf(context.product)) || null;

    const notification = await notificationService.createNotification({
        type: def.type,
        title,
        message,
        relatedOrderId,
        relatedCustomerId,
        priority: text(context.priority, def.priority),
        status: 'unread',
        metadata: {
            eventKey: def.key,
            icon: def.icon,
            relatedProductId,
            relatedProductName: text(context.productName || productNameOf(context.product)) || null,
            relatedCustomerName: text(context.customerName || customerLabel(context.order || context.customer)) || null,
            automation: true,
            ...(context.metadata && typeof context.metadata === 'object' ? context.metadata : {})
        }
    });

    appLogger.info('notification.engine.created', {
        eventKey,
        notificationId: notification?.id || null,
        relatedOrderId,
        relatedCustomerId
    });

    try {
        const realtime = getRealtimeEventService();
        if (typeof realtime.emitNotificationCreated === 'function') {
            realtime.emitNotificationCreated(notification);
        } else {
            realtime.broadcast({
                type: 'notification:created',
                scope: 'notifications',
                payload: {
                    notification,
                    action: 'created',
                    unreadDelta: 1
                }
            });
        }
    } catch (error) {
        appLogger.warn('notification.engine.realtime_failed', { error, eventKey });
    }

    return notification;
}

/**
 * @deprecated Prefer enqueue via automation. Kept as a direct execute path for workers/tests.
 */
async function publishEvent(eventKey, context = {}) {
    return executeEvent(eventKey, context);
}

/**
 * Fire-and-forget entry point for controllers.
 * Enqueues the event into the background automation queue (non-blocking).
 */
function safePublish(eventKey, context = {}) {
    try {
        const automation = require('./notification-automation.service');
        return automation.enqueueEventSafe(eventKey, context);
    } catch (error) {
        appLogger.warn('notification.engine.enqueue_unavailable', {
            eventKey,
            error: String(error?.message || error)
        });
        // Last-resort fallback: execute inline without blocking caller on email.
        return executeEvent(eventKey, context).catch((execError) => {
            appLogger.warn('notification.engine.publish_failed', { error: execError, eventKey });
            return null;
        });
    }
}

async function notifyOrderCreated(order) {
    if (!order) return [];
    const tasks = listOrderCreatedEvents(order).map((eventKey) => {
        if (eventKey === 'ORDER_CREATED') {
            return safePublish('ORDER_CREATED', { order, title: 'New order received' });
        }
        if (eventKey.startsWith('ORDER_')) {
            return safePublish(eventKey, {
                order,
                metadata: { source: 'order_create', nextStatus: order.status || order.orderStatus || '' }
            });
        }
        return safePublish(eventKey, { order });
    });
    return Promise.all(tasks);
}

async function notifyOrderStatusChanged(order, previousStatus = '', options = {}) {
    if (!order) return [];
    const nextStatus = order.status || order.orderStatus || '';
    const tasks = listOrderStatusChangedEvents(order, previousStatus, options).map((eventKey) => {
        if (eventKey.startsWith('REFUND_')) {
            return safePublish(eventKey, {
                order,
                metadata: {
                    returnAction: text(options.returnAction) || 'refund_required',
                    refundRequested: true
                }
            });
        }
        if (eventKey.startsWith('ORDER_')) {
            return safePublish(eventKey, { order, metadata: { previousStatus, nextStatus } });
        }
        return safePublish(eventKey, { order });
    });
    return Promise.all(tasks);
}

async function notifyCustomerRegistered(customer) {
    if (!customer) return null;
    return safePublish('CUSTOMER_REGISTERED', {
        customer,
        customerId: customerIdOf(customer),
        customerName: customerLabel(customer)
    });
}

async function notifyProductLifecycle(previousProduct, nextProduct) {
    if (!nextProduct) return [];
    const tasks = [];
    const prevStatus = lower(previousProduct?.status || previousProduct?.visibility || '');
    const nextStatus = lower(nextProduct.status || nextProduct.visibility || '');

    if (isPublishedStatus(nextStatus) && !isPublishedStatus(prevStatus)) {
        tasks.push(safePublish('PRODUCT_PUBLISHED', { product: nextProduct }));
    } else if (isDisabledStatus(nextStatus) && isPublishedStatus(prevStatus)) {
        tasks.push(safePublish('PRODUCT_DISABLED', { product: nextProduct }));
    } else if (isDisabledStatus(nextStatus) && !prevStatus) {
        // created as draft/inactive — no publish noise
    } else if (!previousProduct && isPublishedStatus(nextStatus)) {
        tasks.push(safePublish('PRODUCT_PUBLISHED', { product: nextProduct }));
    } else if (!previousProduct && isDisabledStatus(nextStatus)) {
        tasks.push(safePublish('PRODUCT_DISABLED', { product: nextProduct }));
    }

    const prevStock = Number(previousProduct?.stock);
    const nextStock = Number(nextProduct.stock);
    if (Number.isFinite(nextStock)) {
        tasks.push(...await notifyStockLevel(nextProduct, {
            previousStock: Number.isFinite(prevStock) ? prevStock : null
        }));
    }

    return Promise.all(tasks);
}

async function notifyStockLevel(product, { previousStock = null } = {}) {
    if (!product) return [];
    const stock = Number(product.stock);
    if (!Number.isFinite(stock)) return [];

    const tasks = [];
    const crossedOut = stock <= 0 && (previousStock == null || previousStock > 0);
    const crossedLow = stock > 0
        && stock <= LOW_STOCK_THRESHOLD
        && (previousStock == null || previousStock > LOW_STOCK_THRESHOLD);

    if (crossedOut) {
        tasks.push(safePublish('OUT_OF_STOCK', {
            product,
            stock,
            metadata: { previousStock, stock }
        }));
    } else if (crossedLow) {
        tasks.push(safePublish('LOW_STOCK', {
            product,
            stock,
            metadata: { previousStock, stock }
        }));
    }

    return Promise.all(tasks);
}

/**
 * After an order depletes stock, inspect affected products for alerts.
 * Prefer passing `orderItems` so previousStock = postStock + qtyOrdered (accurate low-stock crossings).
 */
async function notifyStockFromOrderItems(products = [], orderItems = []) {
    const list = Array.isArray(products) ? products : [];
    const items = Array.isArray(orderItems) ? orderItems : [];
    const qtyByKey = new Map();

    for (const item of items) {
        const key = text(item?.productId || item?.catalogId || item?.id);
        if (!key) continue;
        const qty = Math.max(1, Number(item?.quantity || item?.qty || 1) || 1);
        qtyByKey.set(key, (qtyByKey.get(key) || 0) + qty);
        const numeric = String(Number(key) || '');
        if (numeric && numeric !== key) {
            qtyByKey.set(numeric, (qtyByKey.get(numeric) || 0) + qty);
        }
    }

    const tasks = list.map((product) => {
        const keys = [
            text(product?.catalogId),
            text(product?.id),
            text(product?._id),
            String(Number(product?.catalogId) || ''),
            String(Number(product?.id) || '')
        ].filter(Boolean);
        let qtyOrdered = 0;
        for (const key of keys) {
            if (qtyByKey.has(key)) {
                qtyOrdered = qtyByKey.get(key);
                break;
            }
        }
        const stock = Number(product?.stock);
        const previousStock = Number.isFinite(stock)
            ? stock + Math.max(1, qtyOrdered || 1)
            : null;
        return notifyStockLevel(product, { previousStock });
    });
    return Promise.all(tasks);
}

module.exports = {
    EVENT_CATALOG,
    LOW_STOCK_THRESHOLD,
    publishEvent,
    executeEvent,
    safePublish,
    notifyOrderCreated,
    notifyOrderStatusChanged,
    notifyCustomerRegistered,
    notifyProductLifecycle,
    notifyStockLevel,
    notifyStockFromOrderItems,
    mapStatusToEventKey,
    mapReturnActionToEventKey,
    isPaidStatus,
    isFailedPayment,
    isPendingPayment,
    isCancelledPayment
};
