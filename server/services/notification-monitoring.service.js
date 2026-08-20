/**
 * Notification Monitoring, Security helpers, and Recovery orchestration.
 * Aggregates health across engine / email / queue / database and records ops logs.
 */

const { appLogger } = require('../utils/logger');
const { getRepositoryBundle } = require('../repositories');
const { getProviderStatus } = require('./email/email-provider.service');
const {
    buildMailRuntimeConfig,
    resolveAdminEmailMasterEnabled
} = require('../config/notification-mail.config');
const notificationSettingsService = require('./notificationsettings.service');
const { maskEmailAddress } = require('./notifications/notification-identity');

const MONITOR_INTERVAL_MS = Number(process.env.NOTIFICATION_MONITOR_INTERVAL_MS) || 60 * 1000;
const STUCK_JOB_MS = Number(process.env.NOTIFICATION_STUCK_JOB_MS) || 5 * 60 * 1000;
const ALERT_WINDOW_MS = 15 * 60 * 1000;
const REPEATED_FAILURE_THRESHOLD = 5;

let monitorTimer = null;
let monitorInFlight = false;
const recentAlertKeys = new Map();

function getRepos() {
    return getRepositoryBundle();
}

function text(value, fallback = '') {
    const next = String(value == null ? '' : value).trim();
    return next || fallback;
}

function sanitizeDetails(details = {}) {
    if (!details || typeof details !== 'object') return {};
    const blocked = /pass(word)?|secret|token|api[_-]?key|authorization|credential/i;
    const out = {};
    for (const [key, value] of Object.entries(details)) {
        if (blocked.test(String(key))) {
            out[key] = '[redacted]';
            continue;
        }
        if (typeof value === 'string') {
            out[key] = value
                .replace(/(pass(word)?|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=[redacted]')
                .slice(0, 500);
        } else if (typeof value === 'number' || typeof value === 'boolean' || value == null) {
            out[key] = value;
        } else if (Array.isArray(value)) {
            out[key] = value.slice(0, 20).map((item) => (typeof item === 'string' ? item.slice(0, 120) : item));
        } else if (typeof value === 'object') {
            out[key] = sanitizeDetails(value);
        }
    }
    return out;
}

async function recordOpsLog({
    eventType,
    status = 'info',
    channel = 'system',
    message,
    details = {},
    relatedNotificationId = null,
    relatedJobId = null,
    relatedDeliveryId = null
} = {}) {
    try {
        const repo = getRepos().notificationOpsLogs;
        const entry = await repo.create({
            eventType: text(eventType, 'SYSTEM').toUpperCase(),
            status,
            channel: text(channel, 'system').toLowerCase(),
            message: text(message, 'Notification ops event'),
            details: sanitizeDetails(details),
            relatedNotificationId,
            relatedJobId,
            relatedDeliveryId
        });
        const level = status === 'error' ? 'error' : status === 'warning' ? 'warn' : 'info';
        appLogger[level](`notification.ops.${String(eventType || 'event').toLowerCase()}`, {
            status,
            channel,
            message: entry.message,
            logId: entry.id
        });
        return entry;
    } catch (error) {
        appLogger.warn('notification.ops.log_failed', {
            eventType,
            error: String(error?.message || error)
        });
        return null;
    }
}

function healthLevel(code) {
    if (code === 'healthy') return 'healthy';
    if (code === 'warning') return 'warning';
    return 'error';
}

async function probeDatabase() {
    try {
        const notifications = getRepos().notifications;
        const unread = await notifications.countUnread();
        return {
            code: 'healthy',
            label: 'Healthy',
            detail: `Notification database reachable (${unread} unread).`,
            unreadCount: unread
        };
    } catch (error) {
        return {
            code: 'error',
            label: 'Error',
            detail: `Notification database unavailable: ${String(error?.message || error)}`
        };
    }
}

async function probeEmailService() {
    const provider = getProviderStatus();
    try {
        const settings = await notificationSettingsService.getNotificationSettings();
        const runtime = buildMailRuntimeConfig(settings);
        const master = resolveAdminEmailMasterEnabled();

        if (!provider.configured) {
            return {
                code: 'warning',
                label: 'Not configured',
                detail: 'SMTP host, user, and password are not fully set on the server.',
                provider: provider.provider,
                configured: false,
                ready: false
            };
        }
        if (!master || !runtime.emailNotificationsEnabled) {
            return {
                code: 'warning',
                label: 'Disabled',
                detail: 'Email transport is configured but admin email delivery is disabled.',
                provider: provider.provider,
                configured: true,
                ready: false
            };
        }
        if (!runtime.readyForEmailDelivery) {
            const noRecipients = !(Array.isArray(runtime.adminNotificationEmails) && runtime.adminNotificationEmails.length);
            return {
                code: 'warning',
                label: 'Not ready',
                detail: noRecipients
                    ? 'No active email recipients. Order emails will not be sent until Recipient 1 or Recipient 2 is enabled.'
                    : 'Email service is not fully ready (destination or settings missing).',
                provider: provider.provider,
                configured: true,
                ready: false
            };
        }
        return {
            code: 'healthy',
            label: 'Ready',
            detail: `SMTP is configured via ${provider.provider}. Last successful send is shown below when available.`,
            provider: provider.provider,
            configured: true,
            ready: true
        };
    } catch (error) {
        return {
            code: 'error',
            label: 'Error',
            detail: `Email service check failed: ${String(error?.message || error)}`,
            provider: provider.provider,
            configured: provider.configured,
            ready: false
        };
    }
}

async function probeBackgroundProcessing() {
    try {
        const automation = require('./notification-automation.service');
        const status = await automation.getAutomationStatus();
        if (!status.workerRunning) {
            return {
                code: 'error',
                label: 'Error',
                detail: 'Background automation worker is not running.',
                workerRunning: false,
                jobs: status.jobs || null
            };
        }
        const failed = Number(status.jobs?.failed || 0);
        const pending = Number(status.jobs?.pending || 0);
        if (failed >= REPEATED_FAILURE_THRESHOLD) {
            return {
                code: 'warning',
                label: 'Warning',
                detail: `Background worker running with ${failed} failed jobs.`,
                workerRunning: true,
                jobs: status.jobs
            };
        }
        if (pending > 200) {
            return {
                code: 'warning',
                label: 'Warning',
                detail: `Queue backlog is high (${pending} pending jobs).`,
                workerRunning: true,
                jobs: status.jobs
            };
        }
        return {
            code: 'healthy',
            label: 'Healthy',
            detail: 'Background processing worker is running.',
            workerRunning: true,
            jobs: status.jobs
        };
    } catch (error) {
        return {
            code: 'error',
            label: 'Error',
            detail: `Background processing check failed: ${String(error?.message || error)}`,
            workerRunning: false
        };
    }
}

async function probeQueue() {
    try {
        const jobs = await getRepos().notificationAutomationJobs.getStats();
        const email = await getRepos().notificationEmailDeliveries.getStats();
        const processing = Number(jobs.processing || 0);
        const pending = Number(jobs.pending || 0);
        if (processing > 25) {
            return {
                code: 'warning',
                label: 'Warning',
                detail: `Unusual number of jobs stuck in processing (${processing}).`,
                jobs,
                email
            };
        }
        if (pending > 200) {
            return {
                code: 'warning',
                label: 'Warning',
                detail: `Notification queue backlog: ${pending} pending.`,
                jobs,
                email
            };
        }
        return {
            code: 'healthy',
            label: 'Healthy',
            detail: `Queue healthy (${jobs.total} automation jobs, ${email.total} email deliveries tracked).`,
            jobs,
            email
        };
    } catch (error) {
        return {
            code: 'error',
            label: 'Error',
            detail: `Queue check failed: ${String(error?.message || error)}`
        };
    }
}

async function probeEngine() {
    try {
        const engine = require('./notification-engine.service');
        const catalogSize = Object.keys(engine.EVENT_CATALOG || {}).length;
        if (!catalogSize) {
            return {
                code: 'error',
                label: 'Error',
                detail: 'Notification engine catalog is empty.'
            };
        }
        return {
            code: 'healthy',
            label: 'Running',
            detail: `Notification engine loaded with ${catalogSize} event types.`,
            eventTypes: catalogSize
        };
    } catch (error) {
        return {
            code: 'error',
            label: 'Error',
            detail: `Notification engine unavailable: ${String(error?.message || error)}`
        };
    }
}

function overallFromComponents(components) {
    const codes = Object.values(components).map((item) => item.code);
    if (codes.includes('error')) return { code: 'error', label: 'Error' };
    if (codes.includes('warning')) return { code: 'warning', label: 'Warning' };
    return { code: 'healthy', label: 'Healthy' };
}

async function getHealthSnapshot() {
    const [engine, email, background, database, queue] = await Promise.all([
        probeEngine(),
        probeEmailService(),
        probeBackgroundProcessing(),
        probeDatabase(),
        probeQueue()
    ]);
    const components = { engine, email, background, database, queue };
    const overall = overallFromComponents(components);
    return {
        overall,
        checkedAt: new Date().toISOString(),
        components
    };
}

function publicDeliveryStatus(row = {}) {
    const status = text(row.status, 'pending').toLowerCase();
    if (status === 'pending' && Number(row.attempts || 0) > 0) return 'retrying';
    return status;
}

function toPublicDelivery(row, channel = 'email') {
    if (!row) return null;
    const recipient = maskEmailAddress(row.recipient);
    return {
        id: row.id,
        notificationId: row.notificationId,
        eventKey: row.eventKey,
        orderId: row.relatedOrderId || null,
        recipient,
        channel,
        status: publicDeliveryStatus(row),
        attempts: Number(row.attempts || 0),
        maxAttempts: Number(row.maxAttempts || 0),
        error: row.lastError || null,
        errorCategory: row.errorCategory || null,
        createdAt: row.createdAt,
        lastAttemptAt: row.lastAttemptAt || row.updatedAt,
        sentAt: row.sentAt || null,
        retryable: publicDeliveryStatus(row) === 'failed'
    };
}

async function getMonitoringDashboard() {
    const repos = getRepos();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
        health,
        jobStats,
        emailStats,
        unreadCount,
        lastSent,
        lastFailed,
        recentLogs,
        failedJobs24h,
        failedEmails24h,
        recentDeliveries,
        failedDeliveries
    ] = await Promise.all([
        getHealthSnapshot(),
        repos.notificationAutomationJobs.getStats(),
        repos.notificationEmailDeliveries.getStats(),
        repos.notifications.countUnread(),
        repos.notificationEmailDeliveries.findLatestByStatus('sent'),
        repos.notificationEmailDeliveries.findLatestByStatus('failed'),
        repos.notificationOpsLogs.list({ limit: 40, offset: 0 }),
        repos.notificationAutomationJobs.countFailedSince(since24h),
        repos.notificationEmailDeliveries.countFailedSince(since24h),
        repos.notificationEmailDeliveries.listRecent({ limit: 20 }),
        repos.notificationEmailDeliveries.listFailed({ limit: 15 })
    ]);

    let eventCatalog = [];
    try {
        const engine = require('./notification-engine.service');
        eventCatalog = Object.keys(engine.EVENT_CATALOG || {});
    } catch (_error) {
        eventCatalog = [];
    }

    const requiredEvents = [
        'ORDER_CREATED',
        'PAYMENT_PENDING',
        'PAYMENT_RECEIVED',
        'PAYMENT_FAILED',
        'PAYMENT_CANCELLED',
        'ORDER_CONFIRMED',
        'ORDER_PROCESSING',
        'ORDER_PACKED',
        'ORDER_SHIPPED',
        'ORDER_DELIVERED',
        'ORDER_CANCELLED',
        'REFUND_REQUESTED',
        'REFUND_APPROVED',
        'REFUND_REJECTED',
        'CUSTOMER_REGISTERED',
        'LOW_STOCK',
        'OUT_OF_STOCK'
    ];

    const channelDeliveryStats = await safeChannelDeliveryStats(repos);
    const channels = await resolveChannelHubStatus(repos, channelDeliveryStats);

    return {
        health,
        metrics: {
            totalNotificationsProcessed: Number(jobStats.completed || 0),
            totalAutomationJobs: Number(jobStats.total || 0),
            emailsSent: Number(emailStats.sent || 0),
            failedEmails: Number(emailStats.failed || 0),
            pendingEmails: Number(emailStats.pending || 0),
            retryingEmails: Number(emailStats.retrying || 0),
            skippedEmails: Number(emailStats.skipped || 0),
            retryCount: Number(emailStats.retryAttempts || 0),
            unreadNotifications: Number(unreadCount || 0),
            queuePending: Number(jobStats.pending || 0),
            queueProcessing: Number(jobStats.processing || 0),
            queueFailed: Number(jobStats.failed || 0),
            failedJobsLast24h: Number(failedJobs24h || 0),
            failedEmailsLast24h: Number(failedEmails24h || 0)
        },
        queue: jobStats,
        emailDeliveries: emailStats,
        lastSuccessfulEmail: lastSent
            ? {
                id: lastSent.id,
                recipient: maskEmailAddress(lastSent.recipient),
                subject: lastSent.subject,
                sentAt: lastSent.sentAt || lastSent.updatedAt,
                eventKey: lastSent.eventKey
            }
            : null,
        lastFailedEmail: lastFailed
            ? {
                id: lastFailed.id,
                recipient: maskEmailAddress(lastFailed.recipient),
                subject: lastFailed.subject,
                error: lastFailed.lastError,
                updatedAt: lastFailed.updatedAt,
                eventKey: lastFailed.eventKey,
                attempts: lastFailed.attempts
            }
            : null,
        recentDeliveries: (Array.isArray(recentDeliveries) ? recentDeliveries : []).map((row) => toPublicDelivery(row, 'email')),
        failedDeliveries: (Array.isArray(failedDeliveries) ? failedDeliveries : []).map((row) => toPublicDelivery(row, 'email')),
        recentLogs: recentLogs.items,
        integration: {
            requiredEvents,
            catalogEvents: eventCatalog,
            coverage: requiredEvents.map((key) => ({
                eventKey: key,
                inCatalog: eventCatalog.includes(key),
                modules: ({
                    ORDER_CREATED: ['Orders'],
                    PAYMENT_PENDING: ['Orders', 'Payments'],
                    PAYMENT_RECEIVED: ['Orders', 'Payments'],
                    PAYMENT_FAILED: ['Orders', 'Payments'],
                    PAYMENT_CANCELLED: ['Orders', 'Payments'],
                    ORDER_CONFIRMED: ['Orders'],
                    ORDER_PROCESSING: ['Orders'],
                    ORDER_PACKED: ['Orders'],
                    ORDER_SHIPPED: ['Orders'],
                    ORDER_DELIVERED: ['Orders', 'Payments'],
                    ORDER_CANCELLED: ['Orders'],
                    REFUND_REQUESTED: ['Orders', 'Payments'],
                    REFUND_APPROVED: ['Orders', 'Payments'],
                    REFUND_REJECTED: ['Orders', 'Payments'],
                    CUSTOMER_REGISTERED: ['Customers'],
                    LOW_STOCK: ['Products', 'Inventory'],
                    OUT_OF_STOCK: ['Products', 'Inventory']
                })[key] || []
            })),
            complete: requiredEvents.every((key) => eventCatalog.includes(key))
        },
        channels,
        channelDeliveries: channelDeliveryStats,
        generatedAt: new Date().toISOString()
    };
}

async function resolveChannelHubStatus(repos, preloadedStats = null) {
    try {
        const hub = require('./notifications/notification-hub.service');
        const settings = await notificationSettingsService.getNotificationSettings();
        const status = hub.getHubStatus(settings);
        const stats = preloadedStats || await safeChannelDeliveryStats(repos);
        return {
            inApp: { enabled: true, planned: false, stats: stats.in_app || null },
            email: { enabled: true, planned: false, stats: stats.email || null },
            browser: { enabled: settings.browserNotificationsEnabled !== false, planned: false, stats: stats.browser || null },
            sound: { enabled: Boolean(settings.soundNotificationsEnabled), planned: false, stats: stats.sound || null },
            sms: { enabled: false, planned: true, stats: stats.sms || null },
            whatsapp: { enabled: false, planned: true, stats: stats.whatsapp || null },
            push: { enabled: false, planned: true, stats: stats.push || null },
            catalog: status.channels,
            adapters: status.adapters
        };
    } catch (_error) {
        return {
            inApp: { enabled: true },
            email: { enabled: true },
            browser: { enabled: true },
            sound: { enabled: false },
            sms: { enabled: false, planned: true },
            whatsapp: { enabled: false, planned: true },
            push: { enabled: false, planned: true }
        };
    }
}

async function safeChannelDeliveryStats(repos) {
    try {
        if (!repos.notificationChannelDeliveries?.getStatsByChannel) return {};
        return await repos.notificationChannelDeliveries.getStatsByChannel();
    } catch (_error) {
        return {};
    }
}

async function listOpsLogs(query = {}) {
    return getRepos().notificationOpsLogs.list(query);
}

function canRaiseAlert(alertKey) {
    const previous = Number(recentAlertKeys.get(alertKey) || 0);
    if (previous && (Date.now() - previous) < ALERT_WINDOW_MS) {
        return false;
    }
    recentAlertKeys.set(alertKey, Date.now());
    return true;
}

async function raiseAdminAlert({ key, title, message, priority = 'high' }) {
    if (!canRaiseAlert(key)) return null;

    await recordOpsLog({
        eventType: 'SYSTEM_ALERT',
        status: 'warning',
        channel: 'monitor',
        message: title,
        details: { key, message }
    });

    try {
        const notificationService = require('./notification.service');
        const notification = await notificationService.createNotification({
            type: 'system',
            title: text(title).slice(0, 200),
            message: text(message).slice(0, 4000),
            priority,
            status: 'unread',
            metadata: {
                eventKey: 'SYSTEM_ALERT',
                icon: 'system',
                monitorAlertKey: key,
                automation: false
            }
        });
        try {
            const getRealtimeEventService = require('./realtimeeventservice');
            const realtime = getRealtimeEventService();
            if (typeof realtime.emitNotificationCreated === 'function') {
                realtime.emitNotificationCreated(notification);
            }
        } catch (_error) {
            // non-blocking
        }
        return notification;
    } catch (error) {
        appLogger.warn('notification.monitor.alert_failed', {
            key,
            error: String(error?.message || error)
        });
        return null;
    }
}

async function runRecoveryPass() {
    const results = {
        recoveredJobs: 0,
        workerRestarted: false,
        retriedEmails: 0,
        alerts: []
    };

    try {
        results.recoveredJobs = await getRepos().notificationAutomationJobs.recoverStuckProcessing({
            olderThanMs: STUCK_JOB_MS
        });
        if (results.recoveredJobs > 0) {
            await recordOpsLog({
                eventType: 'RECOVERY',
                status: 'warning',
                channel: 'automation',
                message: `Recovered ${results.recoveredJobs} stuck automation job(s).`,
                details: { recoveredJobs: results.recoveredJobs }
            });
        }
    } catch (error) {
        await recordOpsLog({
            eventType: 'RECOVERY',
            status: 'error',
            channel: 'automation',
            message: 'Failed to recover stuck automation jobs.',
            details: { error: String(error?.message || error) }
        });
    }

    try {
        const automation = require('./notification-automation.service');
        const status = await automation.getAutomationStatus();
        if (!status.workerRunning) {
            automation.startNotificationAutomationWorker();
            results.workerRestarted = true;
            await recordOpsLog({
                eventType: 'RECOVERY',
                status: 'warning',
                channel: 'automation',
                message: 'Background automation worker was restarted by the monitor.',
                details: {}
            });
            await raiseAdminAlert({
                key: 'worker_stopped',
                title: 'Notification background processing restarted',
                message: 'The notification automation worker was not running and has been restarted automatically.'
            });
            results.alerts.push('worker_stopped');
        }
    } catch (error) {
        await recordOpsLog({
            eventType: 'RECOVERY',
            status: 'error',
            channel: 'automation',
            message: 'Unable to verify/restart automation worker.',
            details: { error: String(error?.message || error) }
        });
    }

    try {
        const emailService = require('./email/notification-email.service');
        emailService.startNotificationEmailRetryWorker();
        const retryResult = await emailService.processEmailRetries(25, { includeStuck: true });
        results.retriedEmails = Number(retryResult?.processed || 0);
        if (results.retriedEmails > 0) {
            await recordOpsLog({
                eventType: 'RECOVERY',
                status: 'info',
                channel: 'email',
                message: `Processed ${results.retriedEmails} retryable email delivery(ies).`,
                details: { processed: results.retriedEmails }
            });
        }
    } catch (error) {
        await recordOpsLog({
            eventType: 'RECOVERY',
            status: 'error',
            channel: 'email',
            message: 'Unable to process email retries during recovery.',
            details: { error: String(error?.message || error) }
        });
    }

    // Prune old ops logs occasionally (keep table lean).
    try {
        const pruned = await getRepos().notificationOpsLogs.pruneOlderThanDays(45);
        if (pruned > 0) {
            await recordOpsLog({
                eventType: 'MAINTENANCE',
                status: 'info',
                channel: 'monitor',
                message: `Pruned ${pruned} old notification ops log rows.`,
                details: { pruned }
            });
        }
    } catch (_error) {
        // non-blocking
    }

    return results;
}

async function evaluateAlerts(health) {
    const alerts = [];
    const email = health.components.email;
    const database = health.components.database;
    const background = health.components.background;
    const queue = health.components.queue;

    if (email.code === 'error') {
        const raised = await raiseAdminAlert({
            key: 'email_unavailable',
            title: 'Email service unavailable',
            message: email.detail || 'The notification email service is unavailable.'
        });
        if (raised) alerts.push('email_unavailable');
    }

    if (database.code === 'error') {
        const raised = await raiseAdminAlert({
            key: 'notification_db_unavailable',
            title: 'Notification database unavailable',
            message: database.detail || 'The notification database could not be reached.'
        });
        if (raised) alerts.push('notification_db_unavailable');
    }

    if (background.code === 'error') {
        const raised = await raiseAdminAlert({
            key: 'background_stopped',
            title: 'Notification background processing stopped',
            message: background.detail || 'Background notification processing is not running.'
        });
        if (raised) alerts.push('background_stopped');
    }

    const since = new Date(Date.now() - ALERT_WINDOW_MS).toISOString();
    try {
        const failedEmails = await getRepos().notificationEmailDeliveries.countFailedSince(since);
        if (failedEmails >= REPEATED_FAILURE_THRESHOLD) {
            const raised = await raiseAdminAlert({
                key: 'repeated_email_failures',
                title: 'Repeated email delivery failures',
                message: `${failedEmails} email deliveries failed in the last 15 minutes.`
            });
            if (raised) alerts.push('repeated_email_failures');
        }
        const failedJobs = await getRepos().notificationAutomationJobs.countFailedSince(since);
        if (failedJobs >= REPEATED_FAILURE_THRESHOLD) {
            const raised = await raiseAdminAlert({
                key: 'repeated_processing_failures',
                title: 'Repeated notification processing failures',
                message: `${failedJobs} automation jobs failed in the last 15 minutes.`
            });
            if (raised) alerts.push('repeated_processing_failures');
        }
    } catch (_error) {
        // non-blocking
    }

    if (queue.code === 'error') {
        const raised = await raiseAdminAlert({
            key: 'queue_error',
            title: 'Notification queue error',
            message: queue.detail || 'The notification queue could not be inspected.'
        });
        if (raised) alerts.push('queue_error');
    }

    return alerts;
}

async function runMonitorCycle() {
    if (monitorInFlight) return null;
    monitorInFlight = true;
    try {
        const recovery = await runRecoveryPass();
        const health = await getHealthSnapshot();
        const alerts = await evaluateAlerts(health);
        return { recovery, health, alerts };
    } catch (error) {
        appLogger.warn('notification.monitor.cycle_failed', {
            error: String(error?.message || error)
        });
        return null;
    } finally {
        monitorInFlight = false;
    }
}

function startNotificationMonitor() {
    if (monitorTimer) return;
    monitorTimer = setInterval(() => {
        void runMonitorCycle();
    }, MONITOR_INTERVAL_MS);
    if (typeof monitorTimer.unref === 'function') {
        monitorTimer.unref();
    }
    // Initial pass shortly after boot.
    const bootTimer = setTimeout(() => {
        void runMonitorCycle();
    }, 2500);
    if (typeof bootTimer.unref === 'function') {
        bootTimer.unref();
    }
    appLogger.info('notification.monitor.started', { intervalMs: MONITOR_INTERVAL_MS });
    void recordOpsLog({
        eventType: 'MONITOR_STARTED',
        status: 'info',
        channel: 'monitor',
        message: 'Notification monitoring service started.',
        details: { intervalMs: MONITOR_INTERVAL_MS }
    });
}

function stopNotificationMonitor() {
    if (!monitorTimer) return;
    clearInterval(monitorTimer);
    monitorTimer = null;
}

module.exports = {
    recordOpsLog,
    getHealthSnapshot,
    getMonitoringDashboard,
    listOpsLogs,
    runRecoveryPass,
    runMonitorCycle,
    startNotificationMonitor,
    stopNotificationMonitor,
    sanitizeDetails,
    healthLevel
};
