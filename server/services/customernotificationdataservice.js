const { getRepositoryBundle } = require('../repositories');
const { appLogger } = require('../utils/logger');

const PREF_GATES = {
    COUPON_RECEIVED: 'promo',
    COUPON_EXPIRING: 'promo',
    FAVORITE_STORE_PROMOTION: 'promo',
    FAVORITE_STORE_NEW_PRODUCT: 'promo',
    WISHLIST_PRODUCT_PROMOTION: 'promo',
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

async function listNotifications(user, { limit = 30 } = {}) {
    const { customerNotifications } = getRepos();
    const items = await customerNotifications.listForUser(user.recordId, { limit });
    const unreadCount = await customerNotifications.countUnread(user.recordId);
    return { items, unreadCount, count: items.length };
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
    PREF_GATES
};
