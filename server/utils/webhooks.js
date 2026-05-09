// =============================================================================
// WEBHOOK SERVICE
// =============================================================================
// Outbound webhook delivery for third-party integrations.
// When WEBHOOK_ENABLED=true and WEBHOOK_SECRET is set, this service will POST
// signed JSON payloads to WEBHOOK_URL on configurable events.
//
// Environment variables:
//   WEBHOOK_ENABLED   "true" to enable delivery
//   WEBHOOK_URL       Target endpoint URL
//   WEBHOOK_SECRET    HMAC-SHA256 signing secret (required when enabled)
//
// Signature: X-Byose-Signature: sha256=<hex-digest>
// Consumers verify the signature against their known secret before processing.
//
// Supported events (extend EVENT_TYPES as integrations grow):
//   order.created, order.status_changed, order.cancelled
//   customer.created
//   product.low_stock
//   payment.received
// =============================================================================

const crypto = require('crypto');
const { appLogger } = require('./logger');

const EVENT_TYPES = {
    ORDER_CREATED: 'order.created',
    ORDER_STATUS_CHANGED: 'order.status_changed',
    ORDER_CANCELLED: 'order.cancelled',
    CUSTOMER_CREATED: 'customer.created',
    PRODUCT_LOW_STOCK: 'product.low_stock',
    PAYMENT_RECEIVED: 'payment.received'
};

function isWebhookEnabled() {
    return String(process.env.WEBHOOK_ENABLED || 'false').toLowerCase() === 'true';
}

function getWebhookConfig() {
    return {
        url: String(process.env.WEBHOOK_URL || '').trim(),
        secret: String(process.env.WEBHOOK_SECRET || '').trim()
    };
}

function buildSignature(secret, payload) {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Delivers a signed webhook payload to the configured endpoint.
 * Returns silently on configuration errors — safe to call unconditionally.
 *
 * @param {string} eventType   - One of EVENT_TYPES values.
 * @param {object} data        - Event-specific payload data.
 * @returns {Promise<void>}
 */
async function deliverWebhook(eventType, data) {
    if (!isWebhookEnabled()) {
        return;
    }

    const { url, secret } = getWebhookConfig();
    if (!url || !secret) {
        appLogger.warn('webhook.not_configured', { eventType });
        return;
    }

    const envelope = {
        event: eventType,
        timestamp: new Date().toISOString(),
        data: data || {}
    };

    let body;
    try {
        body = JSON.stringify(envelope);
    } catch (error) {
        appLogger.warn('webhook.serialize_failed', { eventType, error });
        return;
    }

    const signature = buildSignature(secret, body);

    try {
        const { default: fetch } = await import('node-fetch').catch(() => ({ default: globalThis.fetch }));
        if (!fetch) {
            appLogger.warn('webhook.fetch_unavailable', { eventType });
            return;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Byose-Signature': signature,
                'X-Byose-Event': eventType,
                'User-Agent': 'ByoseMarket-Webhook/1.0'
            },
            body,
            signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined
        });

        appLogger.info('webhook.delivered', {
            eventType,
            statusCode: response.status,
            url
        });
    } catch (error) {
        appLogger.warn('webhook.delivery_failed', { eventType, url, error });
    }
}

module.exports = {
    EVENT_TYPES,
    deliverWebhook,
    isWebhookEnabled
};
