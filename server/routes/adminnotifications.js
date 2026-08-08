const express = require('express');

const adminAccessDisabled = require('../middleware/adminaccessdisabled');
const adminNotificationsController = require('../controllers/adminnotificationscontroller');

const router = express.Router();

router.use(adminAccessDisabled);

router.get('/center', adminNotificationsController.getCenter);
router.get('/unread-count', adminNotificationsController.getUnreadCount);
router.get('/settings', adminNotificationsController.getSettings);
router.put('/settings', adminNotificationsController.mutationLimiter, adminNotificationsController.updateSettings);
router.post('/settings/test-email', adminNotificationsController.mutationLimiter, adminNotificationsController.sendTestEmail);
router.get('/automation/status', adminNotificationsController.getAutomationStatus);
router.get('/monitoring', adminNotificationsController.getMonitoringDashboard);
router.get('/monitoring/health', adminNotificationsController.getMonitoringHealth);
router.get('/monitoring/logs', adminNotificationsController.listOpsLogs);
router.post('/monitoring/recover', adminNotificationsController.mutationLimiter, adminNotificationsController.runRecovery);
router.get('/analytics', adminNotificationsController.getAnalyticsDashboard);
router.get('/analytics/report', adminNotificationsController.getAnalyticsReport);

router.get('/', adminNotificationsController.listNotifications);
router.post('/', adminNotificationsController.mutationLimiter, adminNotificationsController.createNotification);
router.put('/read-all', adminNotificationsController.mutationLimiter, adminNotificationsController.markAllRead);
router.post('/bulk-delete', adminNotificationsController.mutationLimiter, adminNotificationsController.bulkDelete);
router.post('/bulk-archive', adminNotificationsController.mutationLimiter, adminNotificationsController.bulkArchive);
router.post('/bulk-read', adminNotificationsController.mutationLimiter, adminNotificationsController.bulkMarkRead);
router.post('/bulk-unread', adminNotificationsController.mutationLimiter, adminNotificationsController.bulkMarkUnread);
router.post('/clear-old', adminNotificationsController.mutationLimiter, adminNotificationsController.clearOld);

router.get('/:id', adminNotificationsController.getNotification);
router.put('/:id/read', adminNotificationsController.mutationLimiter, adminNotificationsController.markRead);
router.put('/:id/unread', adminNotificationsController.mutationLimiter, adminNotificationsController.markUnread);
router.put('/:id/archive', adminNotificationsController.mutationLimiter, adminNotificationsController.archiveNotification);
router.delete('/:id', adminNotificationsController.mutationLimiter, adminNotificationsController.deleteNotification);

module.exports = router;
