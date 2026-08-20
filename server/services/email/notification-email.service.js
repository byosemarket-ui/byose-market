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
const { sendViaProvider, getProviderStatus, classifyEmailError, sanitizeEmailErrorMessage } = require('./email-provider.service');
const { buildAdminEventEmail, listEmailEventKeys, EVENT_TEMPLATE_DEFS } = require('./admin-email-templates');
const { buildNotificationDedupeKey, maskEmailAddress } = require('../notifications/notification-identity');

const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 60 * 1000;
const RETRY_WORKER_INTERVAL_MS = 60 * 1000;

let retryTimer = null;
let retryKickTimer = null;
let retryInFlight = false;
const inFlightDeliveries = new Set();

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

function resolveDeliveryRecipients(runtime = {}, delivery = {}) {
    const stored = normalizeText(delivery.recipient).toLowerCase();
    if (stored && isValidEmail(stored)) {
        return [stored];
    }
    const fromRuntime = Array.isArray(runtime.adminNotificationEmails)
        ? runtime.adminNotificationEmails
        : [runtime.adminNotificationEmail];
    const emails = [];
    for (const candidate of fromRuntime) {
        const email = normalizeText(candidate).toLowerCase();
        if (email && isValidEmail(email) && !emails.includes(email)) {
            emails.push(email);
        }
    }
    return emails;
}

function isRecipientCurrentlyActive(runtime = {}, recipient) {
    const email = normalizeText(recipient).toLowerCase();
    if (!email || !isValidEmail(email)) return false;
    const active = Array.isArray(runtime.adminNotificationRecipients)
        ? runtime.adminNotificationRecipients
        : [];
    if (active.some((slot) => normalizeText(slot.email).toLowerCase() === email)) {
        return true;
    }
    const emails = Array.isArray(runtime.adminNotificationEmails) ? runtime.adminNotificationEmails : [];
    return emails.map((value) => normalizeText(value).toLowerCase()).includes(email);
}

function recipientDedupeKey(baseKey, recipient) {
    return `${normalizeText(baseKey).toLowerCase()}:to:${normalizeText(recipient).toLowerCase()}`;
}

async function hydrateEmailContext(eventKey, context = {}) {
    const next = { ...context };
    const isOrderEvent = /^ORDER_|^PAYMENT_|^REFUND_/.test(String(eventKey || ''));
    if (!isOrderEvent) return next;

    const orderId = normalizeText(
        next.order?.orderId
        || next.order?.id
        || next.orderId
        || next.relatedOrderId
        || next.notification?.relatedOrderId
    );
    if (!orderId) return next;

    try {
        const orderDataService = require('../orderdataservice');
        const { serializeOrderForNotification } = require('../notification-automation.service');
        const fresh = await orderDataService.findOrderByIdentifier(orderId);
        if (fresh) {
            const snapshot = serializeOrderForNotification(fresh) || {};
            next.order = {
                ...(next.order && typeof next.order === 'object' ? next.order : {}),
                ...snapshot
            };
            next.orderId = next.orderId || snapshot.orderId || orderId;
        }
    } catch (error) {
        appLogger.warn('notification.email.order_hydrate_failed', {
            eventKey,
            orderId,
            error: String(error?.message || error)
        });
    }
    return next;
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

async function attemptSend(delivery, context = {}, options = {}) {
    const deliveryId = normalizeText(delivery?.id);
    if (deliveryId && inFlightDeliveries.has(deliveryId)) {
        return { success: false, skipped: true, reason: 'in_flight', retrying: true };
    }
    if (deliveryId) inFlightDeliveries.add(deliveryId);
    try {
        return await attemptSendUnlocked(delivery, context, options);
    } finally {
        if (deliveryId) inFlightDeliveries.delete(deliveryId);
    }
}

async function attemptSendUnlocked(delivery, context = {}, options = {}) {
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

    const recipientList = resolveDeliveryRecipients(runtime, delivery);
    const recipient = recipientList[0] || '';
    if (!recipient) {
        const classified = classifyEmailError(new Error('Admin notification email is not configured'), {
            reason: 'missing_recipient'
        });
        await markDelivery(delivery, {
            status: 'failed',
            attempts: delivery.attempts + 1,
            lastError: 'Admin notification email is not configured',
            nextRetryAt: null,
            lastAttemptAt: new Date().toISOString(),
            errorCategory: classified.category,
            provider: provider.provider
        });
        await patchNotificationEmailMeta(delivery.notificationId, {
            status: 'failed',
            reason: 'missing_recipient',
            errorCategory: classified.category,
            updatedAt: new Date().toISOString()
        });
        return { success: false, reason: 'missing_recipient', retrying: false, provider: provider.provider };
    }

    if (!options.manual && !isRecipientCurrentlyActive(runtime, recipient)) {
        await markDelivery(delivery, {
            status: 'skipped',
            lastError: 'Recipient is no longer active in Notification Settings',
            nextRetryAt: null,
            provider: provider.provider
        });
        return { success: false, skipped: true, reason: 'recipient_disabled', provider: provider.provider, recipient };
    }

    if (!provider.configured) {
        const classified = classifyEmailError(new Error('Email provider is not configured'), {
            reason: 'provider_not_configured'
        });
        const attempts = delivery.attempts + 1;
        await markDelivery(delivery, {
            status: 'failed',
            attempts,
            lastError: 'Email provider is not configured',
            nextRetryAt: null,
            lastAttemptAt: new Date().toISOString(),
            errorCategory: classified.category,
            provider: provider.provider
        });
        await patchNotificationEmailMeta(delivery.notificationId, {
            status: 'failed',
            reason: 'provider_not_configured',
            errorCategory: classified.category,
            attempts,
            updatedAt: new Date().toISOString()
        });
        return {
            success: false,
            retrying: false,
            reason: 'provider_not_configured',
            provider: provider.provider
        };
    }

    const hydratedContext = await hydrateEmailContext(delivery.eventKey, {
        ...context,
        notification: context.notification || { id: delivery.notificationId, title: delivery.subject, message: '' }
    });
    const template = buildAdminEventEmail(delivery.eventKey, hydratedContext, {
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
            errorCategory: null,
            provider: result.provider,
            messageId: result.messageId || null,
            subject: template.subject,
            sentAt: new Date().toISOString(),
            lastAttemptAt: new Date().toISOString(),
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
            orderId: hydratedContext.order?.orderId || hydratedContext.orderId || delivery.relatedOrderId || null,
            recipient: maskEmailAddress(recipient),
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

    const classified = classifyEmailError(result.error, { reason: result.reason });
    const retryable = Boolean(classified.retryable) && attempts < (delivery.maxAttempts || MAX_ATTEMPTS);
    const errorMessage = sanitizeEmailErrorMessage(result.error || result.reason || 'Email send failed');
    await markDelivery(delivery, {
        status: retryable ? 'pending' : 'failed',
        attempts,
        lastError: errorMessage,
        errorCategory: classified.category,
        provider: result.provider || provider.provider,
        subject: template.subject,
        lastAttemptAt: new Date().toISOString(),
        nextRetryAt: retryable ? computeNextRetryAt(attempts) : null
    });
    await patchNotificationEmailMeta(delivery.notificationId, {
        status: retryable ? 'retry_scheduled' : 'failed',
        reason: errorMessage.slice(0, 300),
        errorCategory: classified.category,
        attempts,
        nextRetryAt: retryable ? computeNextRetryAt(attempts) : null,
        updatedAt: new Date().toISOString()
    });
    appLogger.warn('notification.email.send_failed', {
        eventKey: delivery.eventKey,
        notificationId: delivery.notificationId,
        orderId: hydratedContext.order?.orderId || hydratedContext.orderId || null,
        recipient: maskEmailAddress(recipient),
        attempts,
        errorCategory: classified.category,
        retryable,
        error: errorMessage
    });
    try {
        const monitoring = require('../notification-monitoring.service');
        void monitoring.recordOpsLog({
            eventType: retryable ? 'RETRY_ATTEMPT' : 'EMAIL_FAILED',
            status: retryable ? 'warning' : 'error',
            channel: 'email',
            message: retryable
                ? `Email retry scheduled for ${delivery.eventKey} (attempt ${attempts}).`
                : `Email delivery failed for ${delivery.eventKey}.`,
            details: {
                eventKey: delivery.eventKey,
                attempts,
                retryable,
                errorCategory: classified.category,
                error: errorMessage.slice(0, 300)
            },
            relatedNotificationId: delivery.notificationId,
            relatedDeliveryId: delivery.id
        });
    } catch (_error) {
        // non-blocking
    }
    await syncHubEmailDelivery(delivery, {
        status: retryable ? 'retrying' : 'failed',
        provider: result.provider || provider.provider,
        recipient,
        subject: template.subject,
        reason: errorMessage.slice(0, 300),
        nextRetryAt: retryable ? computeNextRetryAt(attempts) : null
    });
    return {
        success: false,
        retrying: retryable,
        error: result.error,
        reason: errorMessage.slice(0, 300),
        errorCategory: classified.category,
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

async function summarizeNotificationEmailMeta(notificationId) {
    if (!notificationId) return null;
    try {
        const rows = await getDeliveryRepo().listByNotificationId(notificationId);
        const recipients = rows.map((row) => ({
            recipient: row.recipient,
            status: row.status,
            error: row.lastError || null,
            sentAt: row.sentAt || null
        }));
        const sent = recipients.filter((item) => item.status === 'sent').length;
        const failed = recipients.filter((item) => item.status === 'failed').length;
        const skipped = recipients.filter((item) => item.status === 'skipped').length;
        const pending = recipients.filter((item) => item.status === 'pending').length;
        const status = failed && sent
            ? 'partial'
            : sent && !failed && !pending
                ? 'sent'
                : failed && !sent && !pending
                    ? 'failed'
                    : skipped && !sent && !failed && !pending
                        ? 'skipped'
                        : pending && recipients.some((item) => item.status === 'pending')
                            ? 'retrying'
                            : 'pending';
        return patchNotificationEmailMeta(notificationId, {
            status,
            recipients,
            sent,
            failed,
            skipped,
            pending,
            updatedAt: new Date().toISOString()
        });
    } catch (_error) {
        return null;
    }
}

/**
 * Queue + send admin email for a created in-app notification.
 * Sends independently to each active recipient. Never throws to callers.
 */
async function deliverNotificationEmail(notification, eventKey, context = {}) {
    try {
        if (!notification?.id) {
            return { success: false, skipped: true, reason: 'missing_notification_id', results: [] };
        }
        if (!EMAIL_EVENT_KEYS.has(eventKey)) {
            return { success: false, skipped: true, reason: 'unsupported_event', results: [] };
        }

        const settings = await notificationSettingsService.getNotificationSettings();
        const runtime = buildMailRuntimeConfig(settings);

        if (!masterEmailKillSwitchEnabled() || !runtime.emailNotificationsEnabled) {
            await patchNotificationEmailMeta(notification.id, {
                status: 'skipped',
                reason: 'disabled',
                updatedAt: new Date().toISOString()
            });
            return { success: false, skipped: true, reason: 'disabled', results: [] };
        }

        if (!isEventEmailEnabled(settings, eventKey)) {
            await patchNotificationEmailMeta(notification.id, {
                status: 'skipped',
                reason: 'event_disabled',
                updatedAt: new Date().toISOString()
            });
            return { success: false, skipped: true, reason: 'event_disabled', results: [] };
        }

        const activeRecipients = Array.isArray(runtime.adminNotificationRecipients)
            ? runtime.adminNotificationRecipients
            : [];

        if (!activeRecipients.length) {
            appLogger.info('notification.email.no_active_recipients', {
                eventKey,
                notificationId: notification.id
            });
            await patchNotificationEmailMeta(notification.id, {
                status: 'skipped',
                reason: 'no_active_recipients',
                updatedAt: new Date().toISOString()
            });
            try {
                const monitoring = require('../notification-monitoring.service');
                void monitoring.recordOpsLog({
                    eventType: 'NO_ACTIVE_RECIPIENTS',
                    status: 'warning',
                    channel: 'email',
                    message: `No active email recipients for ${eventKey}. Order notification email was not sent.`,
                    details: { eventKey },
                    relatedNotificationId: notification.id
                });
            } catch (_error) {
                // non-blocking
            }
            return {
                success: false,
                skipped: true,
                reason: 'no_active_recipients',
                results: []
            };
        }

        const repo = getDeliveryRepo();
        const baseDedupe = buildDedupeKey(eventKey, context, notification);
        const results = [];

        for (const slot of activeRecipients) {
            const recipient = normalizeText(slot.email).toLowerCase();
            if (!recipient || !isValidEmail(recipient)) continue;
            const dedupeKey = recipientDedupeKey(baseDedupe, recipient);

            const alreadySent = await repo.findSentByDedupeKey(dedupeKey);
            if (alreadySent) {
                results.push({
                    slot: slot.slot,
                    recipient,
                    success: true,
                    skipped: false,
                    duplicate: true,
                    status: 'sent',
                    provider: alreadySent.provider || 'smtp',
                    messageId: alreadySent.messageId || null
                });
                continue;
            }

            let delivery = await repo.findByNotificationAndRecipient(notification.id, recipient);
            if (!delivery) {
                delivery = await repo.findByDedupeKey(dedupeKey);
            }
            if (!delivery) {
                delivery = await repo.create({
                    notificationId: notification.id,
                    eventKey,
                    dedupeKey,
                    recipient,
                    status: 'pending',
                    attempts: 0,
                    maxAttempts: MAX_ATTEMPTS,
                    nextRetryAt: null
                });
            }

            if (delivery.status === 'sent') {
                results.push({
                    slot: slot.slot,
                    recipient,
                    success: true,
                    duplicate: true,
                    status: 'sent',
                    provider: delivery.provider || 'smtp',
                    messageId: delivery.messageId || null
                });
                continue;
            }

            const sendResult = await attemptSend(delivery, {
                ...context,
                notification
            });
            results.push({
                slot: slot.slot,
                recipient,
                success: Boolean(sendResult.success),
                skipped: Boolean(sendResult.skipped),
                retrying: Boolean(sendResult.retrying),
                status: sendResult.success
                    ? 'sent'
                    : sendResult.skipped
                        ? 'skipped'
                        : sendResult.retrying
                            ? 'pending'
                            : 'failed',
                reason: sendResult.reason || null,
                provider: sendResult.provider || null,
                messageId: sendResult.messageId || null,
                subject: sendResult.subject || null
            });
        }

        await summarizeNotificationEmailMeta(notification.id);

        const sent = results.filter((item) => item.success);
        const failed = results.filter((item) => !item.success && !item.skipped);
        const skipped = results.filter((item) => item.skipped);

        return {
            success: sent.length > 0 && failed.length === 0,
            partial: sent.length > 0 && failed.length > 0,
            skipped: skipped.length > 0 && !sent.length && !failed.length,
            reason: !results.length
                ? 'no_active_recipients'
                : failed.length && sent.length
                    ? 'partial'
                    : failed.length
                        ? (failed[0].reason || 'email_failed')
                        : skipped.length
                            ? (skipped[0].reason || 'skipped')
                            : null,
            results,
            recipient: sent.map((item) => item.recipient).join(', ') || activeRecipients.map((slot) => slot.email).join(', '),
            subject: sent[0]?.subject || failed[0]?.subject || null,
            provider: sent[0]?.provider || failed[0]?.provider || null,
            messageId: sent[0]?.messageId || null
        };
    } catch (error) {
        appLogger.warn('notification.email.deliver_failed', {
            eventKey,
            notificationId: notification?.id,
            error: String(error?.message || error)
        });
        return { success: false, reason: String(error?.message || error), results: [] };
    }
}

function safeDeliverNotificationEmail(notification, eventKey, context = {}) {
    return deliverNotificationEmail(notification, eventKey, context).catch((error) => {
        appLogger.warn('notification.email.safe_deliver_failed', {
            eventKey,
            notificationId: notification?.id,
            error: sanitizeEmailErrorMessage(error)
        });
        return { success: false, reason: String(error?.message || error) };
    });
}

async function loadDeliveryContext(delivery) {
    let notification = null;
    try {
        notification = await notificationService.getNotification(delivery.notificationId);
    } catch (_error) {
        notification = { id: delivery.notificationId, relatedOrderId: delivery.relatedOrderId || null };
    }
    return {
        notification,
        order: (notification?.relatedOrderId || delivery.relatedOrderId)
            ? { orderId: notification?.relatedOrderId || delivery.relatedOrderId }
            : {},
        customer: notification?.relatedCustomerId ? { id: notification.relatedCustomerId } : {},
        product: notification?.metadata?.relatedProductId
            ? {
                catalogId: notification.metadata.relatedProductId,
                name: notification.metadata.relatedProductName,
                stock: notification.metadata.stock
            }
            : {}
    };
}

/**
 * Admin/manual retry of an existing delivery row.
 * Never creates a new ORDER_CREATED (or other) event.
 */
async function retryEmailDelivery(deliveryId, { admin = {} } = {}) {
    const id = normalizeText(deliveryId);
    if (!id) {
        const error = new Error('Delivery id is required.');
        error.statusCode = 400;
        error.code = 'DELIVERY_ID_REQUIRED';
        throw error;
    }

    const repo = getDeliveryRepo();
    const delivery = await repo.findById(id);
    if (!delivery) {
        const error = new Error('Notification delivery was not found.');
        error.statusCode = 404;
        error.code = 'DELIVERY_NOT_FOUND';
        throw error;
    }

    if (delivery.status === 'sent') {
        return {
            success: true,
            duplicate: true,
            retried: false,
            delivery,
            message: 'This notification was already sent.'
        };
    }

    const prepared = await repo.update(delivery.id, {
        status: 'pending',
        maxAttempts: Math.max(Number(delivery.maxAttempts) || MAX_ATTEMPTS, Number(delivery.attempts || 0) + 1),
        nextRetryAt: new Date().toISOString(),
        lastError: delivery.lastError,
        errorCategory: delivery.errorCategory
    });

    const context = await loadDeliveryContext(prepared || delivery);
    const result = await attemptSend(prepared || delivery, context, { manual: true });
    await summarizeNotificationEmailMeta(delivery.notificationId);

    try {
        const monitoring = require('../notification-monitoring.service');
        void monitoring.recordOpsLog({
            eventType: 'EMAIL_RETRY_MANUAL',
            status: result.success ? 'success' : result.retrying ? 'warning' : 'error',
            channel: 'email',
            message: result.success
                ? `Admin retried ${delivery.eventKey} successfully.`
                : `Admin retried ${delivery.eventKey}.`,
            details: {
                eventKey: delivery.eventKey,
                deliveryId: delivery.id,
                success: Boolean(result.success),
                retrying: Boolean(result.retrying),
                adminId: admin.id || ''
            },
            relatedNotificationId: delivery.notificationId,
            relatedDeliveryId: delivery.id
        });
    } catch (_error) {
        // non-blocking
    }

    const latest = await repo.findById(delivery.id);
    return {
        success: Boolean(result.success),
        retried: true,
        duplicate: false,
        retrying: Boolean(result.retrying),
        delivery: latest,
        reason: result.reason || null,
        message: result.success
            ? 'Retry sent successfully.'
            : (result.retrying ? 'Retry attempted. Delivery is waiting for another automatic retry.' : 'Retry failed.')
    };
}

async function processEmailRetries(limit = 25, options = {}) {
    if (retryInFlight) return { processed: 0 };
    retryInFlight = true;
    try {
        const repo = getDeliveryRepo();
        const candidates = await repo.listRetryCandidates({
            limit,
            includeStuck: Boolean(options.includeStuck)
        });
        let processed = 0;
        for (const delivery of candidates) {
            if (delivery.status === 'sent' || delivery.status === 'skipped') continue;
            const context = await loadDeliveryContext(delivery);
            await attemptSend(delivery, context);
            await summarizeNotificationEmailMeta(delivery.notificationId);
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
    retryKickTimer = setTimeout(() => {
        retryKickTimer = null;
        void processEmailRetries(25, { includeStuck: true });
    }, 3500);
    if (typeof retryKickTimer.unref === 'function') {
        retryKickTimer.unref();
    }
    appLogger.info('notification.email.retry_worker_started', {
        intervalMs: RETRY_WORKER_INTERVAL_MS
    });
}

function stopNotificationEmailRetryWorker() {
    if (retryTimer) {
        clearInterval(retryTimer);
        retryTimer = null;
    }
    if (retryKickTimer) {
        clearTimeout(retryKickTimer);
        retryKickTimer = null;
    }
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
    retryEmailDelivery,
    processEmailRetries,
    startNotificationEmailRetryWorker,
    stopNotificationEmailRetryWorker,
    getDefaultEmailEventPreferences,
    buildDedupeKey,
    masterEmailKillSwitchEnabled
};
