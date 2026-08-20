/**
 * Notification Communication Hub — multi-channel dispatch orchestration.
 * Never blocks business controllers; failures are isolated per channel.
 */

const { appLogger } = require('../../utils/logger');
const { getRepositoryBundle } = require('../../repositories');
const notificationSettingsService = require('../notificationsettings.service');
const {
    CHANNELS,
    CHANNEL_ORDER,
    DELIVERY_STATUSES,
    listChannels
} = require('./channels/channel.registry');
const { getAdapter, listAdapterStatus } = require('./channels/channel.adapters');
const { buildEventContent } = require('./notification-content.service');
const { buildNotificationDedupeKey, text } = require('./notification-identity');

function opsLog(payload) {
    try {
        const monitoring = require('../notification-monitoring.service');
        void monitoring.recordOpsLog(payload);
    } catch (_error) {
        // non-blocking
    }
}

function getDeliveryRepo() {
    return getRepositoryBundle().notificationChannelDeliveries;
}

function buildDedupeKey(eventKey, context = {}, notification = {}) {
    return buildNotificationDedupeKey(eventKey, context, notification);
}

function defaultChannelMatrixForEvent(eventKey, settings = {}) {
    const emailPref = settings.emailEventPreferences?.[eventKey];
    const emailEnabled = emailPref !== false && settings.emailNotificationsEnabled !== false;
    return {
        [CHANNELS.IN_APP]: true,
        [CHANNELS.EMAIL]: Boolean(emailEnabled),
        [CHANNELS.BROWSER]: settings.browserNotificationsEnabled !== false,
        [CHANNELS.SOUND]: Boolean(settings.soundNotificationsEnabled),
        [CHANNELS.SMS]: false,
        [CHANNELS.WHATSAPP]: false,
        [CHANNELS.PUSH]: false
    };
}

function resolveEventChannelPreferences(settings = {}, eventKey) {
    const key = text(eventKey).toUpperCase();
    const defaults = defaultChannelMatrixForEvent(key, settings);
    const matrix = settings.eventChannelPreferences && typeof settings.eventChannelPreferences === 'object'
        ? settings.eventChannelPreferences
        : {};
    const eventPrefs = matrix[key] && typeof matrix[key] === 'object' ? matrix[key] : {};
    const resolved = { ...defaults };
    for (const channel of CHANNEL_ORDER) {
        if (Object.prototype.hasOwnProperty.call(eventPrefs, channel)) {
            resolved[channel] = Boolean(eventPrefs[channel]);
        }
    }
    // Legacy mirror: emailEventPreferences still wins for email when present.
    if (settings.emailEventPreferences && Object.prototype.hasOwnProperty.call(settings.emailEventPreferences, key)) {
        resolved[CHANNELS.EMAIL] = Boolean(settings.emailEventPreferences[key])
            && settings.emailNotificationsEnabled !== false;
    }
    if (settings.emailNotificationsEnabled === false) {
        resolved[CHANNELS.EMAIL] = false;
    }
    if (settings.browserNotificationsEnabled === false) {
        resolved[CHANNELS.BROWSER] = false;
    }
    if (!settings.soundNotificationsEnabled) {
        resolved[CHANNELS.SOUND] = false;
    }
    resolved[CHANNELS.SMS] = false;
    resolved[CHANNELS.WHATSAPP] = false;
    resolved[CHANNELS.PUSH] = false;
    return resolved;
}

async function ensureDeliveryRecord({
    notification,
    eventKey,
    channel,
    dedupeKey,
    status = DELIVERY_STATUSES.PENDING,
    payload = {}
}) {
    const repo = getDeliveryRepo();
    const existing = await repo.findByDedupeAndChannel(dedupeKey, channel);
    if (existing) {
        if (['sent', 'delivered', 'skipped'].includes(existing.status)) {
            return { delivery: existing, duplicate: true };
        }
        return { delivery: existing, duplicate: false };
    }
    const delivery = await repo.create({
        notificationId: notification?.id || null,
        eventKey,
        channel,
        dedupeKey,
        status,
        attempts: 0,
        maxAttempts: 5,
        payload
    });
    return { delivery, duplicate: false };
}

async function applyDeliveryResult(delivery, result = {}) {
    const repo = getDeliveryRepo();
    const now = new Date().toISOString();
    const attempts = Number(delivery.attempts || 0) + (result.skipped ? 0 : 1);
    const patch = {
        attempts,
        status: result.status || (result.success ? DELIVERY_STATUSES.SENT : DELIVERY_STATUSES.FAILED),
        lastError: result.reason || result.error || null,
        provider: result.provider || null,
        messageId: result.messageId || null,
        recipient: result.recipient || null,
        subject: result.subject || null,
        payload: result.payload || delivery.payload || {},
        notificationId: delivery.notificationId,
        sentAt: result.sentAt || (result.success ? now : delivery.sentAt),
        deliveredAt: result.deliveredAt || (result.status === DELIVERY_STATUSES.DELIVERED ? now : delivery.deliveredAt),
        nextRetryAt: result.nextRetryAt || null
    };
    return repo.update(delivery.id, patch);
}

/**
 * Fan-out delivery across enabled channels. Failures never throw to callers.
 */
async function dispatchChannels(notification, eventKey, context = {}) {
    const key = text(eventKey).toUpperCase();
    const results = [];

    let settings = {};
    try {
        settings = await notificationSettingsService.getNotificationSettings();
    } catch (error) {
        appLogger.warn('notification.hub.settings_failed', {
            eventKey: key,
            error: String(error?.message || error)
        });
    }

    const prefs = resolveEventChannelPreferences(settings, key);
    const content = buildEventContent(key, { ...context, notification });
    const dedupeKey = buildDedupeKey(key, context, notification || {});

    const enabledChannels = CHANNEL_ORDER.filter((channel) => {
        if (channel === CHANNELS.SMS || channel === CHANNELS.WHATSAPP || channel === CHANNELS.PUSH) {
            return false;
        }
        return Boolean(prefs[channel]);
    });

    for (const channel of enabledChannels) {
        try {
            const adapter = getAdapter(channel);
            if (!adapter) {
                results.push(skippedResult(channel, 'adapter_missing'));
                continue;
            }

            const { delivery, duplicate } = await ensureDeliveryRecord({
                notification,
                eventKey: key,
                channel,
                dedupeKey,
                payload: { title: content.title }
            });

            if (duplicate && ['sent', 'delivered', 'skipped'].includes(delivery.status)) {
                results.push({
                    channel,
                    success: delivery.status !== 'skipped',
                    skipped: delivery.status === 'skipped',
                    status: delivery.status,
                    duplicate: true
                });
                continue;
            }

            const result = await adapter({
                notification,
                eventKey: key,
                context,
                content,
                settings
            });

            await applyDeliveryResult(delivery, result);
            opsLog({
                eventType: result.skipped
                    ? 'CHANNEL_SKIPPED'
                    : result.success
                        ? 'CHANNEL_SENT'
                        : 'CHANNEL_FAILED',
                status: result.skipped ? 'info' : result.success ? 'success' : 'error',
                channel,
                message: result.skipped
                    ? `${channel} skipped for ${key}: ${result.reason || 'skipped'}`
                    : result.success
                        ? `${channel} delivered for ${key}`
                        : `${channel} failed for ${key}: ${result.reason || 'error'}`,
                details: {
                    eventKey: key,
                    reason: result.reason || null,
                    status: result.status
                },
                relatedNotificationId: notification?.id || null,
                relatedDeliveryId: delivery.id
            });

            results.push({ ...result, deliveryId: delivery.id });
        } catch (error) {
            const message = String(error?.message || error);
            appLogger.warn('notification.hub.channel_failed', {
                eventKey: key,
                channel,
                error: message
            });
            opsLog({
                eventType: 'CHANNEL_FAILED',
                status: 'error',
                channel,
                message: `${channel} crashed for ${key}`,
                details: { eventKey: key, error: message.slice(0, 300) },
                relatedNotificationId: notification?.id || null
            });
            results.push({
                channel,
                success: false,
                skipped: false,
                status: DELIVERY_STATUSES.FAILED,
                reason: message
            });
        }
    }

    return {
        eventKey: key,
        prefs,
        results,
        content
    };
}

function skippedResult(channel, reason) {
    return {
        channel,
        success: false,
        skipped: true,
        status: DELIVERY_STATUSES.SKIPPED,
        reason
    };
}

function safeDispatchChannels(notification, eventKey, context = {}) {
    return dispatchChannels(notification, eventKey, context).catch((error) => {
        appLogger.warn('notification.hub.dispatch_failed', {
            eventKey,
            error: String(error?.message || error)
        });
        return { eventKey, results: [], error };
    });
}

function getHubStatus(settings = {}) {
    const channels = listChannels().map((meta) => {
        const samplePrefs = resolveEventChannelPreferences(settings, 'ORDER_CREATED');
        return {
            ...meta,
            enabledByDefault: Boolean(samplePrefs[meta.id]),
            adapter: listAdapterStatus().find((item) => item.channel === meta.id) || null
        };
    });
    return {
        channels,
        adapters: listAdapterStatus()
    };
}

module.exports = {
    CHANNELS,
    CHANNEL_ORDER,
    dispatchChannels,
    safeDispatchChannels,
    resolveEventChannelPreferences,
    defaultChannelMatrixForEvent,
    buildDedupeKey,
    getHubStatus,
    listChannels,
    buildEventContent
};
