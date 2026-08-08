/**
 * Admin notification email delivery service.
 * Sends professional alert emails after in-app notifications are created.
 * Handles configuration checks, dedupe, retries, and non-blocking failures.
 */

const { appLogger } = require('../../utils/logger');
const { getRepositoryBundle } = require('../../repositories');
const notificationSettingsService = require('../notificationsettings.service');
const notificationService = require('../notification.service');
const {
    buildMailRuntimeConfig,
    normalizeText,
    normalizeBoolean,
    isValidEmail,
    resolveAdminEmailMasterEnabled
} = require('../../config/notification-mail.config');
const { sendViaProvider, getProviderStatus } = require('./email-provider.service');
const { buildAdminEventEmail, listEmailEventKeys, EVENT_TEMPLATE_DEFS } = require('./admin-email-templates');
const { buildNotificationDedupeKey } = require('../notifications/notification-identity');

const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 60 * 1000;
const RETRY_WORKER_INTERVAL_MS = 60 * 1000;

let retryTimer = null;
let retryInFlight = false;

const EMAIL_EVENT_KEYS = new Set(listEmailEventKeys());

function getDeliveryRepo() {
    return getRepositoryBundle().notificationEmailDeliveries;
}

function buildDedupeKey(eventKey, context = {}, notification = {}) {
    return buildNotificationDedupeKey(eventKey, context, notification);
}

function computeNextRetryAt(attempts) {
    const factor = Math.max(1, Number(attempts) || 1);
    const delay = Math.min(RETRY_BASE_MS * (2 ** (factor - 1)), 30 * 60 * 1000);
    return new Date(Date.now() + delay).toISOString();
}

function isEventEmailEnabled(settings = {}, eventKey) {
    const prefs = settings.emailEventPreferences && typeof settings.emailEventPreferences === 'object'
        ? settings.emailEventPreferences
        : {};
    if (Object.prototype.hasOwnProperty.call(prefs, eventKey)) {
        return normalizeBoolean(prefs[eventKey], true);
    }
    return true;
}

function masterEmailKillSwitchEnabled() {
    return resolveAdminEmailMasterEnabled();
}

async function patchNotificationEmailMeta(notificationId, emailMeta = {}) {
    if (!notificationId || typeof notificationService.updateNotificationMetadata !== 'function') {
        return null;
    }
    try {
        return await notificationService.updateNotificationMetadata(notificationId, {
            emailDelivery: emailMeta
        });
    } catch (error) {
        appLogger.warn('notification.email.meta_update_failed', {
            notificationId,
            error: String(error?.message || error)
        });
        return null;
    }
}

async function markDelivery(delivery, patch) {
    const repo = getDeliveryRepo();
    return repo.update(delivery.id, patch);
}

async function attemptSend(delivery, context = {}) {
    const settings = await notificationSettingsService.getNotificationSettings();
    const runtime = buildMailRuntimeConfig(settings);
    const provider = getProviderStatus();

    if (!masterEmailKillSwitchEnabled() || !runtime.emailNotificationsEnabled) {
        await markDelivery(delivery, {
            status: 'skipped',
            lastError: 'Email notifications disabled',
            nextRetryAt: null,
            provider: provider.provider
        });
        await patchNotificationEmailMeta(delivery.notificationId, {
            status: 'skipped',
            reason: 'disabled',
            updatedAt: new Date().toISOString()
        });
        return { success: false, skipped: true, reason: 'disabled', provider: provider.provider };
    }

    if (!isEventEmailEnabled(settings, delivery.eventKey)) {
        await markDelivery(delivery, {
            status: 'skipped',
            lastError: `Event ${delivery.eventKey} disabled in settings`,
            nextRetryAt: null,
            provider: provider.provider
        });
        await patchNotificationEmailMeta(delivery.notificationId, {
            status: 'skipped',
            reason: 'event_disabled',
            updatedAt: new Date().toISOString()
        });
        return { success: false, skipped: true, reason: 'event_disabled', provider: provider.provider };
    }

    const recipient = normalizeText(runtime.adminNotificationEmail || delivery.recipient).toLowerCase();
    if (!recipient || !isValidEmail(recipient)) {
        await markDelivery(delivery, {
            status: 'failed',
            attempts: delivery.attempts + 1,
            lastError: 'Admin notification email is not configured',
            nextRetryAt: null,
            provider: provider.provider
        });
        await patchNotificationEmailMeta(delivery.notificationId, {
            status: 'failed',
            reason: 'missing_recipient',
            updatedAt: new Date().toISOString()
        });
        return { success: false, reason: 'missing_recipient', provider: provider.provider };
    }

    if (!provider.configured) {
        const attempts = delivery.attempts + 1;
        const exhausted = attempts >= (delivery.maxAttempts || MAX_ATTEMPTS);
        await markDelivery(delivery, {
            status: exhausted ? 'failed' : 'pending',
            attempts,
            lastError: 'Email provider is not configured',
            nextRetryAt: exhausted ? null : computeNextRetryAt(attempts),
            provider: provider.provider
        });
        await patchNotificationEmailMeta(delivery.notificationId, {
            status: exhausted ? 'failed' : 'pending',
            reason: 'provider_not_configured',
            attempts,
            updatedAt: new Date().toISOString()
        });
        return {
            success: false,
            retrying: !exhausted,
            reason: 'provider_not_configured',
            provider: provider.provider
        };
    }

    const template = buildAdminEventEmail(delivery.eventKey, {
        ...context,
        notification: context.notification || { id: delivery.notificationId, title: delivery.subject, message: '' }
    }, {
        appBaseUrl: process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || ''
    });

    if (!template) {
        await markDelivery(delivery, {
            status: 'skipped',
            lastError: 'No email template for event',
            nextRetryAt: null,
            provider: provider.provider
        });
        return { success: false, skipped: true, reason: 'no_template', provider: provider.provider };
    }

    const result = await sendViaProvider({
        to: recipient,
        subject: template.subject,
        html: template.html,
        text: template.text,
        headers: {
            'X-BYOSE-Event': delivery.eventKey,
            'X-BYOSE-Notification-Id': delivery.notificationId,
            'X-BYOSE-Dedupe-Key': delivery.dedupeKey
        }
    });

    const attempts = delivery.attempts + 1;

    if (result.success) {
        await markDelivery(delivery, {
            status: 'sent',
            attempts,
            lastError: null,
            provider: result.provider,
            messageId: result.messageId || null,
            subject: template.subject,
            sentAt: new Date().toISOString(),
            nextRetryAt: null
        });
        await patchNotificationEmailMeta(delivery.notificationId, {
            status: 'sent',
            provider: result.provider,
            messageId: result.messageId || null,
            recipient,
            sentAt: new Date().toISOString(),
            attempts
        });
        appLogger.info('notification.email.sent', {
            eventKey: delivery.eventKey,
            notificationId: delivery.notificationId,
            recipient,
            provider: result.provider
        });
        try {
            const monitoring = require('../notification-monitoring.service');
            void monitoring.recordOpsLog({
                eventType: 'EMAIL_SENT',
                status: 'success',
                channel: 'email',
                message: `Email sent for ${delivery.eventKey}.`,
                details: {
                    eventKey: delivery.eventKey,
                    provider: result.provider,
                    recipientDomain: recipient.includes('@') ? recipient.split('@')[1] : null
                },
                relatedNotificationId: delivery.notificationId,
                relatedDeliveryId: delivery.id
            });
        } catch (_error) {
            // non-blocking
        }
        await syncHubEmailDelivery(delivery, {
            status: 'sent',
            provider: result.provider,
            messageId: result.messageId || null,
            recipient,
            subject: template.subject,
            sentAt: new Date().toISOString()
        });
        return {
            success: true,
            provider: result.provider,
            messageId: result.messageId || null,
            recipient,
            subject: template.subject
        };
    }

    const exhausted = attempts >= (delivery.maxAttempts || MAX_ATTEMPTS);
    const errorMessage = String(result.error?.message || result.error || 'Email send failed');
    await markDelivery(delivery, {
        status: exhausted ? 'failed' : 'pending',
        attempts,
        lastError: errorMessage.slice(0, 1000),
        provider: result.provider || provider.provider,
        subject: template.subject,
        nextRetryAt: exhausted ? null : computeNextRetryAt(attempts)
    });
    await patchNotificationEmailMeta(delivery.notificationId, {
        status: exhausted ? 'failed' : 'retry_scheduled',
        reason: errorMessage.slice(0, 300),
        attempts,
        nextRetryAt: exhausted ? null : computeNextRetryAt(attempts),
        updatedAt: new Date().toISOString()
    });
    appLogger.warn('notification.email.send_failed', {
        eventKey: delivery.eventKey,
        notificationId: delivery.notificationId,
        attempts,
        error: errorMessage
    });
    try {
        const monitoring = require('../notification-monitoring.service');
        void monitoring.recordOpsLog({
            eventType: exhausted ? 'EMAIL_FAILED' : 'RETRY_ATTEMPT',
            status: exhausted ? 'error' : 'warning',
            channel: 'email',
            message: exhausted
                ? `Email delivery failed for ${delivery.eventKey}.`
                : `Email retry scheduled for ${delivery.eventKey} (attempt ${attempts}).`,
            details: {
                eventKey: delivery.eventKey,
                attempts,
                exhausted,
                error: errorMessage.slice(0, 300)
            },
            relatedNotificationId: delivery.notificationId,
            relatedDeliveryId: delivery.id
        });
    } catch (_error) {
        // non-blocking
    }
    await syncHubEmailDelivery(delivery, {
        status: exhausted ? 'failed' : 'retrying',
        provider: result.provider || provider.provider,
        recipient,
        subject: template.subject,
        reason: errorMessage.slice(0, 300),
        nextRetryAt: exhausted ? null : computeNextRetryAt(attempts)
    });
    return {
        success: false,
        retrying: !exhausted,
        error: result.error,
        reason: errorMessage.slice(0, 300),
        provider: result.provider || provider.provider,
        recipient,
        subject: template.subject
    };
}

async function syncHubEmailDelivery(delivery, patch = {}) {
    try {
        const repos = getRepositoryBundle();
        if (!repos.notificationChannelDeliveries) return;
        const channelRepo = repos.notificationChannelDeliveries;
        let row = null;
        if (delivery.notificationId) {
            row = await channelRepo.findByNotificationAndChannel(delivery.notificationId, 'email');
        }
        if (!row && delivery.dedupeKey) {
            row = await channelRepo.findByDedupeAndChannel(delivery.dedupeKey, 'email');
        }
        if (!row) return;
        await channelRepo.update(row.id, {
            status: patch.status || row.status,
            provider: patch.provider || row.provider,
            messageId: patch.messageId !== undefined ? patch.messageId : row.messageId,
            recipient: patch.recipient || row.recipient,
            subject: patch.subject || row.subject,
            lastError: patch.reason !== undefined ? patch.reason : row.lastError,
            sentAt: patch.sentAt !== undefined ? patch.sentAt : row.sentAt,
            nextRetryAt: patch.nextRetryAt !== undefined ? patch.nextRetryAt : row.nextRetryAt,
            attempts: Number(row.attempts || 0) + (patch.status === 'sent' || patch.status === 'failed' || patch.status === 'retrying' ? 0 : 0)
        });
    } catch (_error) {
        // never block email path on hub sync
    }
}

/**
 * Queue + send admin email for a created in-app notification.
 * Never throws to callers. Always returns a normalized delivery DTO.
 */
async function deliverNotificationEmail(notification, eventKey, context = {}) {
    try {
        if (!notification?.id) {
            return { success: false, skipped: true, reason: 'missing_notification_id' };
        }
        if (!EMAIL_EVENT_KEYS.has(eventKey)) {
            return { success: false, skipped: true, reason: 'unsupported_event' };
        }

        const settings = await notificationSettingsService.getNotificationSettings();
        const runtime = buildMailRuntimeConfig(settings);
        const dedupeKey = buildDedupeKey(eventKey, context, notification);
        const repo = getDeliveryRepo();

        const existing = await repo.findByNotificationId(notification.id);
        if (existing?.status === 'sent') {
            return {
                success: true,
                skipped: false,
                provider: existing.provider || 'smtp',
                messageId: existing.messageId || null,
                recipient: existing.recipient || null,
                subject: existing.subject || null,
                duplicate: true
            };
        }

        const alreadySent = await repo.findSentByDedupeKey(dedupeKey);
        if (alreadySent && (!existing || existing.id !== alreadySent.id)) {
            if (!existing) {
                await patchNotificationEmailMeta(notification.id, {
                    status: 'skipped',
                    reason: 'duplicate',
                    duplicateOf: alreadySent.id,
                    updatedAt: new Date().toISOString()
                });
            } else {
                await markDelivery(existing, {
                    status: 'skipped',
                    lastError: `Duplicate of delivery ${alreadySent.id}`,
                    nextRetryAt: null
                });
                await patchNotificationEmailMeta(notification.id, {
                    status: 'skipped',
                    reason: 'duplicate',
                    duplicateOf: alreadySent.id,
                    updatedAt: new Date().toISOString()
                });
            }
            return { success: false, skipped: true, reason: 'duplicate' };
        }

        const existingDedupe = await repo.findByDedupeKey(dedupeKey);
        if (existingDedupe && existingDedupe.notificationId !== notification.id) {
            await patchNotificationEmailMeta(notification.id, {
                status: 'skipped',
                reason: 'duplicate_in_flight',
                duplicateOf: existingDedupe.id,
                updatedAt: new Date().toISOString()
            });
            return { success: false, skipped: true, reason: 'duplicate_in_flight' };
        }

        let delivery = existing;
        if (!delivery) {
            delivery = await repo.create({
                notificationId: notification.id,
                eventKey,
                dedupeKey,
                recipient: runtime.adminNotificationEmail || '',
                status: 'pending',
                attempts: 0,
                maxAttempts: MAX_ATTEMPTS,
                nextRetryAt: new Date().toISOString()
            });
        }

        if (delivery.notificationId && delivery.notificationId !== notification.id) {
            await patchNotificationEmailMeta(notification.id, {
                status: 'skipped',
                reason: 'duplicate',
                duplicateOf: delivery.id,
                updatedAt: new Date().toISOString()
            });
            return { success: false, skipped: true, reason: 'duplicate' };
        }

        return attemptSend(delivery, {
            ...context,
            notification
        });
    } catch (error) {
        appLogger.warn('notification.email.deliver_failed', {
            eventKey,
            notificationId: notification?.id,
            error: String(error?.message || error)
        });
        return { success: false, reason: String(error?.message || error) };
    }
}

function safeDeliverNotificationEmail(notification, eventKey, context = {}) {
    return deliverNotificationEmail(notification, eventKey, context).catch((error) => {
        appLogger.warn('notification.email.safe_deliver_failed', {
            eventKey,
            notificationId: notification?.id,
            error: String(error?.message || error)
        });
        return { success: false, reason: String(error?.message || error) };
    });
}

async function processEmailRetries(limit = 25) {
    if (retryInFlight) return { processed: 0 };
    retryInFlight = true;
    try {
        const repo = getDeliveryRepo();
        const candidates = await repo.listRetryCandidates({ limit });
        let processed = 0;
        for (const delivery of candidates) {
            if (delivery.status === 'sent' || delivery.status === 'skipped') continue;
            // Rebuild minimal context from notification metadata when available.
            let notification = null;
            try {
                notification = await notificationService.getNotification(delivery.notificationId);
            } catch (_error) {
                notification = { id: delivery.notificationId };
            }
            await attemptSend(delivery, {
                notification,
                order: notification?.relatedOrderId ? { orderId: notification.relatedOrderId } : {},
                customer: notification?.relatedCustomerId ? { id: notification.relatedCustomerId } : {},
                product: notification?.metadata?.relatedProductId
                    ? {
                        catalogId: notification.metadata.relatedProductId,
                        name: notification.metadata.relatedProductName,
                        stock: notification.metadata.stock
                    }
                    : {}
            });
            processed += 1;
        }
        return { processed };
    } catch (error) {
        appLogger.warn('notification.email.retry_cycle_failed', {
            error: String(error?.message || error)
        });
        return { processed: 0, error };
    } finally {
        retryInFlight = false;
    }
}

function startNotificationEmailRetryWorker() {
    if (retryTimer) return;
    retryTimer = setInterval(() => {
        void processEmailRetries();
    }, RETRY_WORKER_INTERVAL_MS);
    if (typeof retryTimer.unref === 'function') {
        retryTimer.unref();
    }
    appLogger.info('notification.email.retry_worker_started', {
        intervalMs: RETRY_WORKER_INTERVAL_MS
    });
}

function stopNotificationEmailRetryWorker() {
    if (!retryTimer) return;
    clearInterval(retryTimer);
    retryTimer = null;
}

function getDefaultEmailEventPreferences() {
    const prefs = {};
    for (const key of EMAIL_EVENT_KEYS) {
        prefs[key] = true;
    }
    return prefs;
}

module.exports = {
    EMAIL_EVENT_KEYS,
    EVENT_TEMPLATE_DEFS,
    deliverNotificationEmail,
    safeDeliverNotificationEmail,
    processEmailRetries,
    startNotificationEmailRetryWorker,
    stopNotificationEmailRetryWorker,
    getDefaultEmailEventPreferences,
    buildDedupeKey,
    masterEmailKillSwitchEnabled
};
