const { getRepositoryBundle } = require('../repositories');
const notificationSettingsService = require('./notificationsettings.service');

function ValidationError(message, details = {}) {
    const error = new Error(message);
    error.statusCode = 400;
    error.code = 'NOTIFICATION_VALIDATION_FAILED';
    error.details = details;
    return error;
}

function NotFoundError(message = 'Notification not found.') {
    const error = new Error(message);
    error.statusCode = 404;
    error.code = 'NOTIFICATION_NOT_FOUND';
    return error;
}

function getRepo() {
    return getRepositoryBundle().notifications;
}

function sanitizeCreatePayload(payload = {}) {
    const title = String(payload.title || '').trim();
    const message = String(payload.message || '').trim();
    const details = {};

    if (!title) details.title = 'Title is required.';
    if (!message) details.message = 'Message is required.';
    if (Object.keys(details).length) {
        throw ValidationError('Unable to create notification.', details);
    }

    return {
        type: String(payload.type || 'system').trim().toLowerCase() || 'system',
        title: title.slice(0, 200),
        message: message.slice(0, 4000),
        relatedOrderId: String(payload.relatedOrderId || payload.orderId || '').trim() || null,
        relatedCustomerId: String(payload.relatedCustomerId || payload.customerId || '').trim() || null,
        priority: String(payload.priority || 'normal').trim().toLowerCase() || 'normal',
        status: String(payload.status || 'unread').trim().toLowerCase() || 'unread',
        metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}
    };
}

function sanitizeIds(ids) {
    const list = Array.isArray(ids) ? ids : [];
    return [...new Set(list.map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 200);
}

/**
 * Reusable creator for event engine + API.
 * Controllers should prefer notification-engine.service helpers over calling this directly.
 */
async function createNotification(payload = {}) {
    const repo = getRepo();
    return repo.create(sanitizeCreatePayload(payload));
}

async function listNotifications(query = {}) {
    const repo = getRepo();
    return repo.list(query || {});
}

async function getNotification(id) {
    const repo = getRepo();
    const item = await repo.findById(id);
    if (!item) throw NotFoundError();
    return item;
}

async function getUnreadCount() {
    const repo = getRepo();
    return repo.countUnread();
}

async function markNotificationRead(id) {
    const repo = getRepo();
    const existing = await repo.findById(id);
    if (!existing) throw NotFoundError();
    if (existing.status === 'archived') {
        return existing;
    }
    return repo.markRead(id);
}

async function markNotificationUnread(id) {
    const repo = getRepo();
    const existing = await repo.findById(id);
    if (!existing) throw NotFoundError();
    return repo.markUnread(id);
}

async function markAllNotificationsRead() {
    const repo = getRepo();
    const updated = await repo.markAllRead();
    return { updated };
}

async function archiveNotification(id) {
    const repo = getRepo();
    const existing = await repo.findById(id);
    if (!existing) throw NotFoundError();
    return repo.archive(id);
}

async function deleteNotification(id) {
    const repo = getRepo();
    const existing = await repo.findById(id);
    if (!existing) throw NotFoundError();
    const deleted = await repo.softDelete(id);
    if (!deleted) throw NotFoundError();
    return { id: String(id), deleted: true };
}

async function bulkDeleteNotifications(ids = []) {
    const list = sanitizeIds(ids);
    if (!list.length) {
        throw ValidationError('Select at least one notification to delete.', { ids: 'Required' });
    }
    const repo = getRepo();
    const deleted = await repo.softDeleteMany(list);
    return { deleted, ids: list };
}

async function bulkArchiveNotifications(ids = []) {
    const list = sanitizeIds(ids);
    if (!list.length) {
        throw ValidationError('Select at least one notification to archive.', { ids: 'Required' });
    }
    const repo = getRepo();
    const updated = await repo.archiveMany(list);
    return { updated, ids: list };
}

async function bulkMarkNotificationsRead(ids = []) {
    const list = sanitizeIds(ids);
    if (!list.length) {
        throw ValidationError('Select at least one notification.', { ids: 'Required' });
    }
    const repo = getRepo();
    const updated = await repo.markManyRead(list);
    return { updated, ids: list };
}

async function bulkMarkNotificationsUnread(ids = []) {
    const list = sanitizeIds(ids);
    if (!list.length) {
        throw ValidationError('Select at least one notification.', { ids: 'Required' });
    }
    const repo = getRepo();
    const updated = await repo.markManyUnread(list);
    return { updated, ids: list };
}

async function clearOldNotifications(olderThanDays = 90) {
    const days = Number(olderThanDays);
    if (!Number.isFinite(days) || days < 1) {
        throw ValidationError('olderThanDays must be a positive number.', {
            olderThanDays: 'Must be >= 1'
        });
    }
    const repo = getRepo();
    return repo.clearOlderThanDays(days);
}

async function getCenterSummary(limit = 8) {
    const repo = getRepo();
    const [unreadCount, list] = await Promise.all([
        repo.countUnread(),
        repo.list({ status: '', includeArchived: false, limit, offset: 0 })
    ]);
    return {
        unreadCount,
        items: list.items,
        total: list.total
    };
}

async function updateNotificationMetadata(id, metadataPatch = {}) {
    const repo = getRepo();
    const existing = await repo.findById(id);
    if (!existing) throw NotFoundError();
    return repo.updateMetadata(id, metadataPatch);
}

async function getNotificationRuntime() {
    return notificationSettingsService.getMailRuntimeConfig();
}

module.exports = {
    createNotification,
    listNotifications,
    getNotification,
    getUnreadCount,
    markNotificationRead,
    markNotificationUnread,
    markAllNotificationsRead,
    archiveNotification,
    deleteNotification,
    bulkDeleteNotifications,
    bulkArchiveNotifications,
    bulkMarkNotificationsRead,
    bulkMarkNotificationsUnread,
    clearOldNotifications,
    getCenterSummary,
    getNotificationRuntime,
    updateNotificationMetadata
};
