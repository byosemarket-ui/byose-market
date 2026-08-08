const notificationService = require('../services/notification.service');
const notificationSettingsService = require('../services/notificationsettings.service');
const adminSecurityService = require('../services/adminsecurityservice');
const { createRateLimiter } = require('../middleware/ratelimiter');
const { appLogger } = require('../utils/logger');

const mutationLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 90,
    code: 'NOTIFICATION_RATE_LIMITED',
    message: 'Too many notification updates. Please retry shortly.'
});

function sendError(req, res, error, eventName) {
    const statusCode = Number(error?.statusCode || 500) || 500;
    if (statusCode >= 500) {
        (req.log || appLogger).error(eventName, { error });
    } else {
        (req.log || appLogger).warn(eventName, {
            code: error?.code || '',
            message: error?.message || '',
            details: error?.details || null
        });
    }

    return res.status(statusCode).json({
        success: false,
        code: error?.code || (statusCode >= 500 ? 'ADMIN_NOTIFICATION_ERROR' : 'NOTIFICATION_VALIDATION_FAILED'),
        message: error?.message || 'Unable to process notification request',
        details: error?.details || undefined
    });
}

async function recordAudit(req, summary, meta = {}, eventType = 'notification_settings_updated') {
    try {
        await adminSecurityService.recordSecurityEvent(
            { id: req.admin?.id, email: req.admin?.email },
            {
                eventType,
                summary,
                meta,
                ip: adminSecurityService.buildRequestContext(req).ip,
                userAgent: adminSecurityService.buildRequestContext(req).userAgent
            }
        );
    } catch (_error) {
        // non-blocking
    }
}

exports.mutationLimiter = mutationLimiter;

exports.getCenter = async (req, res) => {
    try {
        const limit = Number(req.query?.limit) || 8;
        const center = await notificationService.getCenterSummary(limit);
        const settings = await notificationSettingsService.getAdminNotificationSettings();
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            unreadCount: center.unreadCount,
            notifications: center.items,
            total: center.total,
            settings: {
                browserNotificationsEnabled: settings.browserNotificationsEnabled,
                soundNotificationsEnabled: settings.soundNotificationsEnabled,
                notificationSoundId: settings.notificationSoundId || 'soft',
                emailNotificationsEnabled: settings.emailNotificationsEnabled,
                eventChannelPreferences: settings.eventChannelPreferences || {}
            }
        });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.center_failed');
    }
};

exports.listNotifications = async (req, res) => {
    try {
        const result = await notificationService.listNotifications(req.query || {});
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            notifications: result.items,
            total: result.total,
            unreadCount: result.unreadCount,
            limit: result.limit,
            offset: result.offset,
            sort: result.sort
        });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.list_failed');
    }
};

exports.getUnreadCount = async (req, res) => {
    try {
        const unreadCount = await notificationService.getUnreadCount();
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, unreadCount });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.unread_count_failed');
    }
};

exports.createNotification = async (req, res) => {
    try {
        const notification = await notificationService.createNotification(req.body || {});
        res.setHeader('Cache-Control', 'no-store');
        return res.status(201).json({ success: true, notification });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.create_failed');
    }
};

exports.getNotification = async (req, res) => {
    try {
        const notification = await notificationService.getNotification(req.params.id);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, notification });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.get_failed');
    }
};

exports.markRead = async (req, res) => {
    try {
        const notification = await notificationService.markNotificationRead(req.params.id);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, notification });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.mark_read_failed');
    }
};

exports.markUnread = async (req, res) => {
    try {
        const notification = await notificationService.markNotificationUnread(req.params.id);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, notification });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.mark_unread_failed');
    }
};

exports.markAllRead = async (req, res) => {
    try {
        const result = await notificationService.markAllNotificationsRead();
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.mark_all_read_failed');
    }
};

exports.bulkDelete = async (req, res) => {
    try {
        const result = await notificationService.bulkDeleteNotifications(req.body?.ids || []);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.bulk_delete_failed');
    }
};

exports.bulkArchive = async (req, res) => {
    try {
        const result = await notificationService.bulkArchiveNotifications(req.body?.ids || []);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.bulk_archive_failed');
    }
};

exports.bulkMarkRead = async (req, res) => {
    try {
        const result = await notificationService.bulkMarkNotificationsRead(req.body?.ids || []);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.bulk_mark_read_failed');
    }
};

exports.bulkMarkUnread = async (req, res) => {
    try {
        const result = await notificationService.bulkMarkNotificationsUnread(req.body?.ids || []);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.bulk_mark_unread_failed');
    }
};

exports.clearOld = async (req, res) => {
    try {
        const olderThanDays = req.body?.olderThanDays ?? req.body?.days ?? 90;
        const result = await notificationService.clearOldNotifications(olderThanDays);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.clear_old_failed');
    }
};

exports.archiveNotification = async (req, res) => {
    try {
        const notification = await notificationService.archiveNotification(req.params.id);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, notification });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.archive_failed');
    }
};

exports.deleteNotification = async (req, res) => {
    try {
        const result = await notificationService.deleteNotification(req.params.id);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.delete_failed');
    }
};

exports.getSettings = async (req, res) => {
    try {
        const settings = await notificationSettingsService.getAdminNotificationSettings();
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, settings });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.settings_fetch_failed');
    }
};

exports.updateSettings = async (req, res) => {
    try {
        const settings = await notificationSettingsService.updateNotificationSettings(req.body || {}, {
            id: req.admin?.id,
            email: req.admin?.email
        });
        await recordAudit(req, 'Notification settings updated', {
            emailEnabled: settings.emailNotificationsEnabled,
            browserEnabled: settings.browserNotificationsEnabled,
            soundEnabled: settings.soundNotificationsEnabled,
            soundId: settings.notificationSoundId || 'soft',
            hasAdminEmail: Boolean(settings.adminNotificationEmail)
        });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, settings });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.settings_update_failed');
    }
};

exports.sendTestEmail = async (req, res) => {
    try {
        const result = await notificationSettingsService.sendTestNotificationEmail(
            { id: req.admin?.id, email: req.admin?.email },
            { to: req.body?.to || req.body?.email || '' }
        );
        await recordAudit(req, 'Notification test email sent', {
            recipientDomain: String(result.recipient || '').includes('@')
                ? String(result.recipient).split('@')[1]
                : null,
            provider: result.provider
        }, 'notification_test_email_sent');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.test_email_failed');
    }
};

exports.getAutomationStatus = async (req, res) => {
    try {
        const automation = require('../services/notification-automation.service');
        const status = await automation.getAutomationStatus();
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, automation: status });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.automation_status_failed');
    }
};

exports.getMonitoringDashboard = async (req, res) => {
    try {
        const monitoring = require('../services/notification-monitoring.service');
        const dashboard = await monitoring.getMonitoringDashboard();
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, monitoring: dashboard });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.monitoring_failed');
    }
};

exports.getMonitoringHealth = async (req, res) => {
    try {
        const monitoring = require('../services/notification-monitoring.service');
        const health = await monitoring.getHealthSnapshot();
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, health });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.health_failed');
    }
};

exports.listOpsLogs = async (req, res) => {
    try {
        const monitoring = require('../services/notification-monitoring.service');
        const result = await monitoring.listOpsLogs(req.query || {});
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            logs: result.items,
            total: result.total,
            limit: result.limit,
            offset: result.offset
        });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.ops_logs_failed');
    }
};

exports.runRecovery = async (req, res) => {
    try {
        const monitoring = require('../services/notification-monitoring.service');
        const result = await monitoring.runMonitorCycle();
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, result });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.recovery_failed');
    }
};

exports.getAnalyticsDashboard = async (req, res) => {
    try {
        const analytics = require('../services/notifications/notification-analytics.service');
        const dashboard = await analytics.getAnalyticsDashboard(req.query || {});
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, analytics: dashboard });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.analytics_failed');
    }
};

exports.getAnalyticsReport = async (req, res) => {
    try {
        const analytics = require('../services/notifications/notification-analytics.service');
        const report = await analytics.getAnalyticsReport(req.query || {});
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, report });
    } catch (error) {
        return sendError(req, res, error, 'admin.notifications.analytics_report_failed');
    }
};
