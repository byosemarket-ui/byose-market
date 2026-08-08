/**
 * Shared notification identity helpers (dedupe keys, masking).
 */

function text(value, fallback = '') {
    const next = String(value == null ? '' : value).trim();
    return next || fallback;
}

function buildNotificationDedupeKey(eventKey, context = {}, notification = {}) {
    const key = text(eventKey).toUpperCase();
    const orderId = text(
        context.orderId
        || context.order?.orderId
        || context.order?.id
        || notification.relatedOrderId
    );
    const customerId = text(
        context.customerId
        || context.customer?.id
        || context.customer?._id
        || notification.relatedCustomerId
    );
    const productId = text(
        context.productId
        || context.product?.catalogId
        || context.product?.id
        || notification?.metadata?.relatedProductId
    );

    if (orderId) return `${key}:order:${orderId}`.toLowerCase();
    if (customerId) return `${key}:customer:${customerId}`.toLowerCase();
    if (productId) return `${key}:product:${productId}`.toLowerCase();
    return `${key}:notification:${text(notification.id) || 'na'}`.toLowerCase();
}

function maskEmailAddress(email) {
    const value = text(email).toLowerCase();
    const at = value.indexOf('@');
    if (at <= 0) return value ? '***' : '';
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    const visible = local.slice(0, Math.min(1, local.length));
    return `${visible}***@${domain}`;
}

module.exports = {
    buildNotificationDedupeKey,
    maskEmailAddress,
    text
};
