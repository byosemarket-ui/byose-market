const { getRepositoryBundle } = require('../repositories');
const { appLogger } = require('../utils/logger');

const PREF_GATES = {
    COUPON_RECEIVED: 'promo',
    COUPON_EXPIRING: 'promo',
    FAVORITE_STORE_PROMOTION: 'promo',
    FAVORITE_STORE_NEW_PRODUCT: 'promo',
    WISHLIST_PRODUCT_PROMOTION: 'promo',
    NEW_PRODUCT: 'promo',
    ORDER_UPDATE: 'orders',
    SHIPPING_UPDATE: 'shipping',
    SYSTEM: 'system'
};

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.customerNotifications) {
        throw new Error('Customer notification service requires the SQLite repository bundle.');
    }
    return repositories;
}

function isPrefEnabled(prefs, type) {
    const gate = PREF_GATES[String(type || '').toUpperCase()] || 'system';
    if (gate === 'system') return true;
    return Boolean(prefs?.[gate]);
}

async function getPrefs(user) {
    const { customerNotifications } = getRepos();
    return customerNotifications.getPrefs(user.recordId);
}

async function updatePrefs(user, prefs) {
    const { customerNotifications } = getRepos();
    return customerNotifications.upsertPrefs(user.recordId, prefs || {});
}

async function listNotifications(user, { limit = 30, offset = 0 } = {}) {
    const { customerNotifications } = getRepos();
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 30));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const [items, unreadCount, total] = await Promise.all([
        customerNotifications.listForUser(user.recordId, { limit: safeLimit, offset: safeOffset }),
        customerNotifications.countUnread(user.recordId),
        customerNotifications.countForUser(user.recordId)
    ]);
    return {
        items,
        unreadCount,
        count: items.length,
        total,
        limit: safeLimit,
        offset: safeOffset,
        hasMore: safeOffset + items.length < total
    };
}

async function markRead(user, notificationId) {
    const { customerNotifications } = getRepos();
    await customerNotifications.markRead(user.recordId, notificationId);
    return listNotifications(user, { limit: 30 });
}

async function markAllRead(user) {
    const { customerNotifications } = getRepos();
    await customerNotifications.markAllRead(user.recordId);
    return listNotifications(user, { limit: 30 });
}

/**
 * Best-effort customer inbox event. Never throws to callers.
 * Respects customer_notification_prefs and dedupe keys.
 */
async function enqueueEventSafe({
    userId,
    type,
    title,
    body = '',
    deeplink = '',
    entityType = '',
    entityId = '',
    dedupeKey = ''
}) {
    try {
        if (!userId || !type || !title) return null;

        const { customerNotifications } = getRepos();
        const prefs = await customerNotifications.getPrefs(userId);
        if (!isPrefEnabled(prefs, type)) {
            return null;
        }

        return customerNotifications.create({
            userId,
            type: String(type).toUpperCase(),
            title,
            body,
            deeplink,
            entityType,
            entityId,
            dedupeKey
        });
    } catch (error) {
        appLogger.warn('customer_notifications.enqueue_failed', {
            error,
            type,
            userId,
            entityId
        });
        return null;
    }
}

async function notifyCouponReceived(userId, coupon) {
    if (!userId || !coupon) return null;
    const code = String(coupon.code || '').trim().toUpperCase();
    return enqueueEventSafe({
        userId,
        type: 'COUPON_RECEIVED',
        title: 'New coupon available',
        body: code
            ? `${coupon.title || code} is ready to use at checkout.`
            : 'A new discount coupon was added to your account.',
        deeplink: '/account/pages/coupons.html',
        entityType: 'coupon',
        entityId: String(coupon.id || code),
        dedupeKey: `COUPON_RECEIVED:${userId}:${coupon.id || code}`
    });
}

async function notifyCouponExpiring(userId, coupon, bucket = '72h') {
    if (!userId || !coupon) return null;
    return enqueueEventSafe({
        userId,
        type: 'COUPON_EXPIRING',
        title: 'Coupon expiring soon',
        body: `${coupon.code || coupon.title || 'Your coupon'} expires soon. Use it before checkout.`,
        deeplink: '/account/pages/coupons.html',
        entityType: 'coupon',
        entityId: String(coupon.id || coupon.code || ''),
        dedupeKey: `COUPON_EXPIRING:${userId}:${coupon.id || coupon.code}:${bucket}`
    });
}

async function notifyFavoriteStorePromotion(userId, store, campaignId = '') {
    if (!userId || !store) return null;
    return enqueueEventSafe({
        userId,
        type: 'FAVORITE_STORE_PROMOTION',
        title: `${store.name || 'Store'} has a new offer`,
        body: 'A store you follow posted a promotion.',
        deeplink: store.url || `/store.html?slug=${encodeURIComponent(store.slug || '')}`,
        entityType: 'store',
        entityId: String(store.id || store.publicId || ''),
        dedupeKey: `FAV_STORE_PROMO:${userId}:${store.id || store.publicId}:${campaignId || 'default'}`
    });
}

async function notifyWishlistProductPromotion(userId, product, priceFingerprint = '') {
    if (!userId || !product) return null;
    return enqueueEventSafe({
        userId,
        type: 'WISHLIST_PRODUCT_PROMOTION',
        title: 'Wishlist item on sale',
        body: `${product.name || 'A saved product'} now has a better price.`,
        deeplink: `/details/product-details1.html?id=${encodeURIComponent(product.id || product.catalogId || '')}`,
        entityType: 'product',
        entityId: String(product.id || product.catalogId || ''),
        dedupeKey: `WISHLIST_PROMO:${userId}:${product.id || product.catalogId}:${priceFingerprint || 'sale'}`
    });
}

function normalizeStatusKey(status) {
    return String(status || '').toLowerCase().replace(/\s+/g, '_').trim();
}

function formatOrderTag(orderId) {
    const id = String(orderId || '').trim();
    return id ? `#${id}` : '';
}

function buildOrderStatusNotificationCopy(orderId, status) {
    const tag = formatOrderTag(orderId);
    const value = String(status || '').toLowerCase();

    if (value.includes('confirm')) {
        return {
            type: 'ORDER_UPDATE',
            title: 'Order confirmed',
            body: tag ? `Your order ${tag} has been confirmed.` : 'Your order has been confirmed.'
        };
    }
    if (value.includes('process')) {
        return {
            type: 'ORDER_UPDATE',
            title: 'Order processing',
            body: tag ? `Your order ${tag} is now being processed.` : 'Your order is now being processed.'
        };
    }
    if (value.includes('pack')) {
        return {
            type: 'ORDER_UPDATE',
            title: 'Order packed',
            body: tag ? `Your order ${tag} has been packed and is ready for shipping.` : 'Your order has been packed and is ready for shipping.'
        };
    }
    if (value.includes('out for delivery') || value.includes('out_for_delivery')) {
        return {
            type: 'SHIPPING_UPDATE',
            title: 'Out for delivery',
            body: tag ? `Your order ${tag} is out for delivery.` : 'Your order is out for delivery.'
        };
    }
    if (value.includes('ship')) {
        return {
            type: 'SHIPPING_UPDATE',
            title: 'Order shipped',
            body: tag ? `Your order ${tag} is on the way.` : 'Your order is on the way.'
        };
    }
    if (value.includes('deliver') || value === 'completed' || value === 'complete') {
        return {
            type: 'ORDER_UPDATE',
            title: 'Order delivered',
            body: tag ? `Your order ${tag} has been delivered successfully.` : 'Your order has been delivered successfully.'
        };
    }
    if (value.includes('cancel')) {
        return {
            type: 'ORDER_UPDATE',
            title: 'Order cancelled',
            body: tag ? `Your order ${tag} has been cancelled.` : 'Your order has been cancelled.'
        };
    }
    if (value.includes('return')) {
        return {
            type: 'ORDER_UPDATE',
            title: 'Return update',
            body: tag ? `There is an update on your return for order ${tag}.` : 'There is an update on your order return.'
        };
    }
    if (value.includes('refund')) {
        return {
            type: 'ORDER_UPDATE',
            title: 'Refund update',
            body: tag ? `There is a refund update for order ${tag}.` : 'There is a refund update on your order.'
        };
    }

    return null;
}

async function resolveCustomerRecordIdForOrder(order) {
    if (!order || order.isGuest) return null;

    const publicId = String(
        order.customerId
        || order.userId
        || order.customer?.id
        || order.accountId
        || ''
    ).trim();
    if (!publicId) return null;

    const { getRepositoryBundle } = require('../repositories');
    const user = await getRepositoryBundle().users.findByPublicId(publicId);
    return user?.recordId ? Number(user.recordId) : null;
}

/**
 * Create a customer inbox notification after a meaningful order-status transition.
 * Skips guests, unchanged statuses, and duplicate status keys (dedupeKey).
 */
const ADMIN_CATEGORY_TYPES = {
    general: 'SYSTEM',
    important: 'SYSTEM',
    promotion: 'SYSTEM',
    order: 'ORDER_UPDATE',
    account: 'SYSTEM',
    product: 'SYSTEM'
};

function resolveAdminNotificationType(category, { orderId = '', productId = '' } = {}) {
    const key = String(category || 'general').toLowerCase();
    if (key === 'order' && !orderId) return 'SYSTEM';
    if (key === 'product' && !productId) return 'SYSTEM';
    return ADMIN_CATEGORY_TYPES[key] || 'SYSTEM';
}

/**
 * Admin-composed customer inbox notification. Bypasses customer prefs so manual
 * admin messages always reach the selected customer inbox.
 */
async function notifyNewProductPublished(userId, product) {
    if (!userId || !product) return null;

    const catalogId = String(product.catalogId || product.id || '').trim();
    if (!catalogId) return null;

    const productName = String(product.name || product.title || 'New product').trim();
    const body = productName
        ? `New product available: ${productName}.`
        : 'A new product has just been added to BYOSE Market.';

    return enqueueEventSafe({
        userId,
        type: 'NEW_PRODUCT',
        title: 'New Product Available',
        body,
        deeplink: `/details/product-details1.html?id=${encodeURIComponent(catalogId)}`,
        entityType: 'product',
        entityId: catalogId,
        dedupeKey: `NEW_PRODUCT:${userId}:${catalogId}`
    });
}

/**
 * Notify all eligible registered customers about a newly published product.
 * Uses per-customer dedupe keys so retries and duplicate publish requests are safe.
 */
async function broadcastNewProductPublished(product) {
    if (!product || !isProductPublished(product)) {
        return { sent: 0, skipped: 0 };
    }

    const userDataService = require('./userdataservice');
    const customers = await userDataService.listCustomers();
    let sent = 0;
    let skipped = 0;

    for (const customer of customers) {
        if (!customer?.recordId) {
            skipped += 1;
            continue;
        }
        if (String(customer.role || '').toLowerCase() === 'admin') {
            skipped += 1;
            continue;
        }
        if (String(customer.status || 'active').toLowerCase() === 'blocked') {
            skipped += 1;
            continue;
        }

        const created = await notifyNewProductPublished(Number(customer.recordId), product);
        if (created) {
            sent += 1;
        } else {
            skipped += 1;
        }
    }

    return { sent, skipped };
}

function isProductPublished(product) {
    const { isProductPublished: checkPublished } = require('../utils/product-visibility');
    return checkPublished(product);
}

async function sendAdminCustomerNotification({
    userId,
    category = 'general',
    title,
    body = '',
    orderId = '',
    productId = '',
    idempotencyKey = ''
} = {}) {
    if (!userId || !title || !String(body || '').trim()) {
        return null;
    }

    const normalizedOrderId = String(orderId || '').trim();
    const normalizedProductId = String(productId || '').trim();
    const type = resolveAdminNotificationType(category, {
        orderId: normalizedOrderId,
        productId: normalizedProductId
    });

    let deeplink = '';
    let entityType = '';
    let entityId = '';

    if (normalizedOrderId) {
        deeplink = `/account/order-details.html?id=${encodeURIComponent(normalizedOrderId)}`;
        entityType = 'order';
        entityId = normalizedOrderId;
    } else if (normalizedProductId) {
        deeplink = `/details/product-details1.html?id=${encodeURIComponent(normalizedProductId)}`;
        entityType = 'product';
        entityId = normalizedProductId;
    }

    const dedupeKey = idempotencyKey
        ? `ADMIN_MSG:${userId}:${String(idempotencyKey).trim()}`
        : '';

    const { customerNotifications } = getRepos();
    return customerNotifications.create({
        userId,
        type,
        title,
        body,
        deeplink,
        entityType,
        entityId,
        dedupeKey
    });
}

async function notifyOrderStatusUpdate({ order, previousStatus, nextStatus } = {}) {
    if (!order) return null;

    const previousKey = normalizeStatusKey(previousStatus);
    const nextKey = normalizeStatusKey(nextStatus || order.orderStatus || order.status);
    if (!nextKey || previousKey === nextKey) return null;

    const userId = await resolveCustomerRecordIdForOrder(order);
    if (!userId) return null;

    const orderId = String(order.orderId || order.id || '').trim();
    const copy = buildOrderStatusNotificationCopy(orderId, nextStatus || order.status || order.orderStatus);
    if (!copy) return null;

    return enqueueEventSafe({
        userId,
        type: copy.type,
        title: copy.title,
        body: copy.body,
        deeplink: orderId
            ? `/account/order-details.html?id=${encodeURIComponent(orderId)}`
            : '/account/orders/all.html',
        entityType: 'order',
        entityId: orderId,
        dedupeKey: `ORDER_STATUS:${userId}:${orderId}:${nextKey}`
    });
}

module.exports = {
    getPrefs,
    updatePrefs,
    listNotifications,
    markRead,
    markAllRead,
    enqueueEventSafe,
    notifyCouponReceived,
    notifyCouponExpiring,
    notifyFavoriteStorePromotion,
    notifyWishlistProductPromotion,
    notifyOrderStatusUpdate,
    notifyNewProductPublished,
    broadcastNewProductPublished,
    sendAdminCustomerNotification,
    resolveAdminNotificationType,
    buildOrderStatusNotificationCopy,
    resolveCustomerRecordIdForOrder,
    PREF_GATES
};
