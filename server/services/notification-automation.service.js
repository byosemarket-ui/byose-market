/**
 * Notification Automation Engine — background event processing.
 *
 * Controllers enqueue validated business events; a background worker:
 * 1) claims jobs
 * 2) creates in-app notifications
 * 3) fans out realtime updates
 * 4) triggers email delivery when enabled
 *
 * Never blocks HTTP request handlers. Failures are logged and retried.
 */

const { appLogger } = require('../utils/logger');
const { getRepositoryBundle } = require('../repositories');

const WORKER_INTERVAL_MS = Number(process.env.NOTIFICATION_AUTOMATION_INTERVAL_MS) || 2000;
const BATCH_SIZE = Number(process.env.NOTIFICATION_AUTOMATION_BATCH_SIZE) || 12;
const MAX_ATTEMPTS = Number(process.env.NOTIFICATION_AUTOMATION_MAX_ATTEMPTS) || 5;
const RETRY_BASE_MS = 15 * 1000;

let workerTimer = null;
let workerInFlight = false;
let kickTimer = null;

function getJobRepo() {
    return getRepositoryBundle().notificationAutomationJobs;
}

function text(value, fallback = '') {
    const next = String(value == null ? '' : value).trim();
    return next || fallback;
}

function opsLog(payload) {
    try {
        const monitoring = require('./notification-monitoring.service');
        void monitoring.recordOpsLog(payload);
    } catch (_error) {
        // never block automation on monitoring failures
    }
}

function pickPlain(source, keys = []) {
    if (!source || typeof source !== 'object') return null;
    const out = {};
    for (const key of keys) {
        if (source[key] !== undefined) {
            out[key] = source[key];
        }
    }
    return Object.keys(out).length ? out : null;
}

function serializeOrderItem(item = {}) {
    if (!item || typeof item !== 'object') return null;
    const quantity = Number(item.quantity ?? item.qty);
    const price = Number(item.price ?? item.unitPrice);
    return {
        productId: text(item.productId || item.id || item.catalogId) || undefined,
        productName: text(item.productName || item.name) || undefined,
        name: text(item.productName || item.name) || undefined,
        quantity: Number.isFinite(quantity) ? quantity : undefined,
        qty: Number.isFinite(quantity) ? quantity : undefined,
        price: Number.isFinite(price) ? price : undefined,
        sku: text(item.sku || item.variantSku || item.attributes?.SKU || item.attributes?.sku) || undefined,
        variantSku: text(item.variantSku || item.sku) || undefined,
        color: text(item.color || item.colorName) || undefined,
        colorName: text(item.colorName || item.color) || undefined,
        size: text(item.size || item.sizeLabel) || undefined,
        sizeLabel: text(item.sizeLabel || item.size) || undefined,
        variantKey: text(item.variantKey) || undefined,
        attributeSummary: text(item.attributeSummary) || undefined
    };
}

function serializeOrderForNotification(order) {
    if (!order || typeof order !== 'object') return null;
    const items = (Array.isArray(order.items) && order.items.length
        ? order.items
        : (Array.isArray(order.products) ? order.products : [])
    ).map(serializeOrderItem).filter(Boolean);

    const snapshot = pickPlain(order, [
        'orderId', 'id', '_id', 'status', 'orderStatus', 'paymentStatus', 'paymentStatusLabel',
        'paymentMethod', 'paymentMethodLabel', 'paymentType', 'currency',
        'subtotal', 'deliveryFee', 'shippingFee', 'codFee', 'couponDiscount', 'couponCode',
        'totalAmount', 'totalPrice', 'total',
        'customerName', 'customerEmail', 'customerPhone', 'customerId', 'userId', 'userEmail',
        'phoneNumber', 'note', 'deliveryNotes', 'deliveryLabel', 'createdAt', 'updatedAt',
        'paymentReference', 'transactionReference', 'transactionId', 'cancellationReason',
        'shippingAddress', 'fullAddress', 'payment'
    ]);

    if (snapshot) {
        return { ...snapshot, items, products: items };
    }
    return items.length ? { items, products: items } : null;
}

function serializeContext(context = {}) {
    const order = serializeOrderForNotification(context.order);
    const customer = context.customer && typeof context.customer === 'object'
        ? pickPlain(context.customer, [
            'id', '_id', 'customerId', 'name', 'email', 'phone'
        ])
        : null;
    const product = context.product && typeof context.product === 'object'
        ? pickPlain(context.product, [
            'id', '_id', 'catalogId', 'name', 'title', 'stock', 'status', 'visibility'
        ])
        : null;

    return {
        title: context.title || null,
        message: context.message || null,
        priority: context.priority || null,
        orderId: context.orderId || null,
        customerId: context.customerId || null,
        customerName: context.customerName || null,
        productId: context.productId || null,
        productName: context.productName || null,
        stock: context.stock != null ? context.stock : null,
        relatedOrderId: context.relatedOrderId || null,
        relatedCustomerId: context.relatedCustomerId || null,
        relatedProductId: context.relatedProductId || null,
        order,
        customer,
        product,
        metadata: context.metadata && typeof context.metadata === 'object' ? context.metadata : {}
    };
}

function buildAutomationDedupeKey(eventKey, context = {}) {
    const orderId = text(
        context.orderId
        || context.relatedOrderId
        || context.order?.orderId
        || context.order?.id
        || context.order?._id
    );
    const customerId = text(
        context.customerId
        || context.relatedCustomerId
        || context.customer?.id
        || context.customer?._id
        || context.customer?.customerId
    );
    const productId = text(
        context.productId
        || context.relatedProductId
        || context.product?.catalogId
        || context.product?.id
        || context.product?._id
    );

    if (eventKey === 'LOW_STOCK' || eventKey === 'OUT_OF_STOCK') {
        const stock = Number(context.stock != null ? context.stock : context.product?.stock);
        const stockPart = Number.isFinite(stock) ? String(stock) : 'na';
        if (productId) return `${eventKey}:product:${productId}:stock:${stockPart}`.toLowerCase();
    }

    if (orderId) return `${eventKey}:order:${orderId}`.toLowerCase();
    if (customerId) return `${eventKey}:customer:${customerId}`.toLowerCase();
    if (productId) return `${eventKey}:product:${productId}`.toLowerCase();

    // Last-resort uniqueness for rare events without entity ids.
    const fingerprint = text(JSON.stringify({
        title: context.title,
        message: context.message,
        metadata: context.metadata || {}
    })).slice(0, 120);
    return `${eventKey}:hash:${fingerprint || Date.now()}`.toLowerCase();
}

function computeNextRetryAt(attempts) {
    const factor = Math.max(1, Number(attempts) || 1);
    const delay = Math.min(RETRY_BASE_MS * (2 ** (factor - 1)), 15 * 60 * 1000);
    return new Date(Date.now() + delay).toISOString();
}

function validateEvent(eventKey, context = {}) {
    const notificationEngine = require('./notification-engine.service');
    const catalog = notificationEngine.EVENT_CATALOG || {};
    if (!catalog[eventKey]) {
        return { ok: false, reason: `Unknown event key: ${eventKey}` };
    }

    if (eventKey.startsWith('ORDER_') || eventKey.startsWith('PAYMENT_') || eventKey.startsWith('REFUND_')) {
        const orderId = text(
            context.orderId
            || context.relatedOrderId
            || context.order?.orderId
            || context.order?.id
            || context.order?._id
        );
        if (!orderId) {
            return { ok: false, reason: 'Order event requires related order id' };
        }
    }

    if (eventKey === 'CUSTOMER_REGISTERED') {
        const customerId = text(
            context.customerId
            || context.relatedCustomerId
            || context.customer?.id
            || context.customer?._id
        );
        if (!customerId && !text(context.customer?.email || context.customerName)) {
            return { ok: false, reason: 'Customer event requires customer identity' };
        }
    }

    if (eventKey === 'LOW_STOCK' || eventKey === 'OUT_OF_STOCK') {
        const productId = text(
            context.productId
            || context.relatedProductId
            || context.product?.catalogId
            || context.product?.id
        );
        if (!productId) {
            return { ok: false, reason: 'Inventory event requires product id' };
        }
    }

    return { ok: true };
}

/**
 * Enqueue a business event for background notification processing.
 * Returns quickly; never throws to callers when used via enqueueEventSafe.
 */
async function enqueueEvent(eventKey, context = {}) {
    const key = text(eventKey).toUpperCase();
    const validation = validateEvent(key, context);
    if (!validation.ok) {
        appLogger.warn('notification.automation.event_rejected', {
            eventKey: key,
            reason: validation.reason
        });
        return { enqueued: false, rejected: true, reason: validation.reason };
    }

    const dedupeKey = buildAutomationDedupeKey(key, context);
    const repo = getJobRepo();
    const result = await repo.enqueue({
        eventKey: key,
        dedupeKey,
        payload: serializeContext(context),
        maxAttempts: MAX_ATTEMPTS,
        availableAt: new Date().toISOString()
    });

    if (result.duplicate) {
        appLogger.info('notification.automation.duplicate_skipped', {
            eventKey: key,
            dedupeKey,
            jobId: result.job?.id || null,
            status: result.job?.status || null
        });
        opsLog({
            eventType: 'DUPLICATE_SKIPPED',
            status: 'info',
            channel: 'automation',
            message: `Duplicate automation event skipped (${key}).`,
            details: { eventKey: key, dedupeKey },
            relatedJobId: result.job?.id || null
        });
        return {
            enqueued: false,
            duplicate: true,
            job: result.job
        };
    }

    appLogger.info('notification.automation.enqueued', {
        eventKey: key,
        dedupeKey,
        jobId: result.job?.id || null
    });
    opsLog({
        eventType: 'EVENT_ENQUEUED',
        status: 'info',
        channel: 'automation',
        message: `Automation event enqueued (${key}).`,
        details: { eventKey: key, dedupeKey },
        relatedJobId: result.job?.id || null
    });

    scheduleImmediateProcess();
    return {
        enqueued: true,
        duplicate: false,
        job: result.job
    };
}

function enqueueEventSafe(eventKey, context = {}) {
    return enqueueEvent(eventKey, context).catch((error) => {
        appLogger.warn('notification.automation.enqueue_failed', {
            eventKey,
            error: String(error?.message || error)
        });
        return { enqueued: false, error };
    });
}

async function processJob(job) {
    const notificationEngine = require('./notification-engine.service');
    const notificationEmailService = require('./email/notification-email.service');
    const notificationSettingsService = require('./notificationsettings.service');
    const hub = require('./notifications/notification-hub.service');
    const repo = getJobRepo();

    const eventKey = text(job.eventKey).toUpperCase();
    const context = job.payload && typeof job.payload === 'object' ? job.payload : {};
    const validation = validateEvent(eventKey, context);

    if (!validation.ok) {
        await repo.markSkipped(job.id, validation.reason);
        appLogger.warn('notification.automation.job_skipped', {
            jobId: job.id,
            eventKey,
            reason: validation.reason
        });
        return { skipped: true };
    }

    try {
        let settings = {};
        try {
            settings = await notificationSettingsService.getNotificationSettings();
        } catch (_error) {
            settings = {};
        }
        const channelPrefs = hub.resolveEventChannelPreferences(settings, eventKey);
        const createInApp = channelPrefs.in_app !== false;

        let notification = null;
        if (createInApp) {
            notification = await notificationEngine.executeEvent(eventKey, context);
            if (!notification?.id) {
                throw new Error('Notification creation returned empty result');
            }
            opsLog({
                eventType: 'NOTIFICATION_CREATED',
                status: 'success',
                channel: 'in_app',
                message: `Notification created for ${eventKey}.`,
                details: { eventKey },
                relatedNotificationId: notification.id,
                relatedJobId: job.id
            });
        } else {
            // Persist a silent audit notification so email/hub deliveries keep a stable id
            // without surfacing in the unread Dashboard feed.
            const content = hub.buildEventContent(eventKey, context);
            const notificationService = require('./notification.service');
            const engine = require('./notification-engine.service');
            const def = engine.EVENT_CATALOG?.[eventKey] || {};
            notification = await notificationService.createNotification({
                type: def.type || 'system',
                title: content.title || def.title || eventKey,
                message: content.summary || content.textBody || eventKey,
                relatedOrderId: context.orderId || context.order?.orderId || context.order?.id || null,
                relatedCustomerId: context.customerId || context.customer?.id || null,
                priority: content.priority || def.priority || 'normal',
                status: 'archived',
                metadata: {
                    eventKey,
                    icon: def.icon || 'system',
                    silent: true,
                    inAppChannelDisabled: true,
                    automation: true
                }
            });
            opsLog({
                eventType: 'CHANNEL_SKIPPED',
                status: 'info',
                channel: 'in_app',
                message: `In-app display skipped for ${eventKey}; silent audit record created for other channels.`,
                details: { eventKey, silent: true },
                relatedNotificationId: notification?.id || null,
                relatedJobId: job.id
            });
        }

        await repo.markCompleted(job.id, { notificationId: notification?.id || null });
        appLogger.info('notification.automation.notification_created', {
            jobId: job.id,
            eventKey,
            notificationId: notification?.id || null,
            inApp: createInApp
        });

        // Multi-channel hub dispatch (email + client markers + future SMS/WhatsApp/Push).
        // Failures are isolated per channel and never fail the automation job.
        void (async () => {
            try {
                const dispatch = await hub.safeDispatchChannels(notification, eventKey, context);
                appLogger.info('notification.automation.hub_dispatched', {
                    jobId: job.id,
                    eventKey,
                    notificationId: notification?.id || null,
                    channels: Array.isArray(dispatch?.results)
                        ? dispatch.results.map((item) => `${item.channel}:${item.status || (item.skipped ? 'skipped' : 'unknown')}`)
                        : []
                });
            } catch (hubError) {
                appLogger.warn('notification.automation.hub_dispatch_failed', {
                    jobId: job.id,
                    eventKey,
                    notificationId: notification?.id || null,
                    error: String(hubError?.message || hubError)
                });
                // Fallback: preserve legacy email path if hub is unavailable.
                if (channelPrefs.email !== false) {
                    try {
                        await notificationEmailService.safeDeliverNotificationEmail(notification, eventKey, context);
                    } catch (emailError) {
                        appLogger.warn('notification.automation.email_fallback_failed', {
                            jobId: job.id,
                            eventKey,
                            error: String(emailError?.message || emailError)
                        });
                    }
                }
            }
        })();

        return { completed: true, notification };
    } catch (error) {
        const attempts = Number(job.attempts || 0);
        const exhausted = attempts >= Number(job.maxAttempts || MAX_ATTEMPTS);
        const message = String(error?.message || error);
        await repo.markFailed(job.id, {
            error: message,
            availableAt: exhausted ? null : computeNextRetryAt(attempts),
            exhausted
        });
        appLogger.warn('notification.automation.job_failed', {
            jobId: job.id,
            eventKey,
            attempts,
            exhausted,
            error: message
        });
        opsLog({
            eventType: exhausted ? 'PROCESSING_FAILED' : 'RETRY_ATTEMPT',
            status: exhausted ? 'error' : 'warning',
            channel: 'automation',
            message: exhausted
                ? `Automation job exhausted retries for ${eventKey}.`
                : `Automation retry scheduled for ${eventKey} (attempt ${attempts}).`,
            details: { eventKey, attempts, exhausted, error: message.slice(0, 300) },
            relatedJobId: job.id
        });
        return { failed: true, exhausted, error };
    }
}

async function processAutomationBatch(limit = BATCH_SIZE) {
    if (workerInFlight) return { processed: 0 };
    workerInFlight = true;
    try {
        const repo = getJobRepo();
        const jobs = await repo.claimNextBatch({ limit });
        let processed = 0;
        for (const job of jobs) {
            await processJob(job);
            processed += 1;
        }
        if (processed > 0) {
            appLogger.info('notification.automation.batch_processed', { processed });
        }
        return { processed };
    } catch (error) {
        appLogger.warn('notification.automation.batch_failed', {
            error: String(error?.message || error)
        });
        return { processed: 0, error };
    } finally {
        workerInFlight = false;
    }
}

function scheduleImmediateProcess() {
    if (kickTimer) return;
    kickTimer = setTimeout(() => {
        kickTimer = null;
        void processAutomationBatch();
    }, 25);
    if (typeof kickTimer.unref === 'function') {
        kickTimer.unref();
    }
}

function startNotificationAutomationWorker() {
    if (workerTimer) return;

    workerTimer = setInterval(() => {
        void processAutomationBatch();
    }, WORKER_INTERVAL_MS);
    if (typeof workerTimer.unref === 'function') {
        workerTimer.unref();
    }

    // Also keep email retry loop alive from the automation bootstrap.
    try {
        const { startNotificationEmailRetryWorker } = require('./email/notification-email.service');
        startNotificationEmailRetryWorker();
    } catch (error) {
        appLogger.warn('notification.automation.email_worker_attach_failed', {
            error: String(error?.message || error)
        });
    }

    scheduleImmediateProcess();
    appLogger.info('notification.automation.worker_started', {
        intervalMs: WORKER_INTERVAL_MS,
        batchSize: BATCH_SIZE,
        maxAttempts: MAX_ATTEMPTS
    });
}

function stopNotificationAutomationWorker() {
    if (workerTimer) {
        clearInterval(workerTimer);
        workerTimer = null;
    }
    if (kickTimer) {
        clearTimeout(kickTimer);
        kickTimer = null;
    }
}

async function getAutomationStatus() {
    try {
        const stats = await getJobRepo().getStats();
        return {
            workerRunning: Boolean(workerTimer),
            intervalMs: WORKER_INTERVAL_MS,
            batchSize: BATCH_SIZE,
            maxAttempts: MAX_ATTEMPTS,
            jobs: stats
        };
    } catch (error) {
        return {
            workerRunning: Boolean(workerTimer),
            error: String(error?.message || error)
        };
    }
}

module.exports = {
    enqueueEvent,
    enqueueEventSafe,
    processAutomationBatch,
    startNotificationAutomationWorker,
    stopNotificationAutomationWorker,
    getAutomationStatus,
    buildAutomationDedupeKey,
    serializeContext,
    serializeOrderForNotification,
    validateEvent
};
