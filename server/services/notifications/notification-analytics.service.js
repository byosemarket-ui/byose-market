/**
 * Notification Analytics & Reporting service.
 * Aggregates in-app, email, channel, and automation metrics with efficient SQL.
 */

const { getRepositoryBundle } = require('../../repositories');
const { appLogger } = require('../../utils/logger');

const EVENT_LABELS = Object.freeze({
    ORDER_CREATED: 'New Orders',
    PAYMENT_PENDING: 'Payments Pending',
    PAYMENT_RECEIVED: 'Payments Successful',
    PAYMENT_FAILED: 'Payments Failed',
    PAYMENT_CANCELLED: 'Payments Cancelled',
    ORDER_CONFIRMED: 'Order Confirmed',
    ORDER_PROCESSING: 'Order Processing',
    ORDER_PACKED: 'Order Packed',
    ORDER_SHIPPED: 'Shipments',
    ORDER_DELIVERED: 'Deliveries',
    ORDER_CANCELLED: 'Cancellations',
    REFUND_REQUESTED: 'Refund Requests',
    REFUND_APPROVED: 'Refunds Completed',
    REFUND_REJECTED: 'Refunds Rejected',
    CUSTOMER_REGISTERED: 'Customer Registrations',
    LOW_STOCK: 'Low Stock Alerts',
    OUT_OF_STOCK: 'Out of Stock Alerts',
    PRODUCT_PUBLISHED: 'Products Published',
    PRODUCT_DISABLED: 'Products Disabled',
    SYSTEM_ALERT: 'System Alerts'
});

function text(value, fallback = '') {
    const next = String(value == null ? '' : value).trim();
    return next || fallback;
}

function toDateOnly(value) {
    const raw = text(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const date = new Date(raw);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date = new Date()) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date, days) {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}

function resolveRange(query = {}) {
    const preset = text(query.preset || query.range || 'this_month').toLowerCase();
    const now = new Date();
    const today = startOfUtcDay(now);
    let from = toDateOnly(query.from || query.startDate);
    let to = toDateOnly(query.to || query.endDate);

    if (!from || !to) {
        if (preset === 'today') {
            from = today.toISOString().slice(0, 10);
            to = from;
        } else if (preset === 'yesterday') {
            const y = addDays(today, -1);
            from = y.toISOString().slice(0, 10);
            to = from;
        } else if (preset === 'this_week' || preset === 'week' || preset === 'weekly') {
            const day = today.getUTCDay() || 7;
            const weekStart = addDays(today, 1 - day);
            from = weekStart.toISOString().slice(0, 10);
            to = today.toISOString().slice(0, 10);
        } else if (preset === 'last_7_days' || preset === '7d') {
            from = addDays(today, -6).toISOString().slice(0, 10);
            to = today.toISOString().slice(0, 10);
        } else if (preset === 'this_month' || preset === 'month' || preset === 'monthly') {
            from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);
            to = today.toISOString().slice(0, 10);
        } else if (preset === 'last_30_days' || preset === '30d') {
            from = addDays(today, -29).toISOString().slice(0, 10);
            to = today.toISOString().slice(0, 10);
        } else if (preset === 'custom' && from && to) {
            // keep provided
        } else {
            from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);
            to = today.toISOString().slice(0, 10);
        }
    }

    if (from > to) {
        const swap = from;
        from = to;
        to = swap;
    }

    return {
        preset: from && to && query.from ? 'custom' : preset,
        from,
        to,
        fromIso: `${from}T00:00:00.000Z`,
        toIso: `${to}T23:59:59.999Z`
    };
}

function getDb() {
    return getRepositoryBundle().notifications.db;
}

function countScalar(sql, params = []) {
    const row = getDb().prepare(sql).get(...params);
    return Number(row?.total || 0);
}

function averageScalar(sql, params = []) {
    const row = getDb().prepare(sql).get(...params);
    return Number(row?.avgMs || 0);
}

function buildNotificationWhere(filters = {}, range, alias = '') {
    const prefix = alias ? `${alias}.` : '';
    const clauses = [`${prefix}deleted_at IS NULL`];
    const params = [];

    if (range?.from) {
        clauses.push(`${prefix}created_date >= ?`);
        params.push(range.from);
    }
    if (range?.to) {
        clauses.push(`${prefix}created_date <= ?`);
        params.push(range.to);
    }

    const type = text(filters.type || filters.notificationType).toLowerCase();
    if (type) {
        clauses.push(`LOWER(${prefix}type) = ?`);
        params.push(type);
    }

    const status = text(filters.status || filters.deliveryStatus).toLowerCase();
    if (status && ['unread', 'read', 'archived'].includes(status)) {
        clauses.push(`${prefix}status = ?`);
        params.push(status);
    }

    const eventKey = text(filters.eventKey || filters.event).toUpperCase();
    if (eventKey) {
        clauses.push(`UPPER(COALESCE(json_extract(${prefix}metadata_json, '$.eventKey'), '')) = ?`);
        params.push(eventKey);
    }

    return { clause: clauses.join(' AND '), params };
}

function getOverviewMetrics(range) {
    const today = startOfUtcDay(new Date()).toISOString().slice(0, 10);
    const weekStart = (() => {
        const d = startOfUtcDay(new Date());
        const day = d.getUTCDay() || 7;
        return addDays(d, 1 - day).toISOString().slice(0, 10);
    })();
    const monthStart = (() => {
        const d = startOfUtcDay(new Date());
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
    })();

    const totalNotifications = countScalar(`
        SELECT COUNT(*) AS total FROM admin_notifications WHERE deleted_at IS NULL
    `);
    const sentToday = countScalar(`
        SELECT COUNT(*) AS total FROM admin_notifications
        WHERE deleted_at IS NULL AND created_date = ?
    `, [today]);
    const sentThisWeek = countScalar(`
        SELECT COUNT(*) AS total FROM admin_notifications
        WHERE deleted_at IS NULL AND created_date >= ? AND created_date <= ?
    `, [weekStart, today]);
    const sentThisMonth = countScalar(`
        SELECT COUNT(*) AS total FROM admin_notifications
        WHERE deleted_at IS NULL AND created_date >= ? AND created_date <= ?
    `, [monthStart, today]);

    const unread = countScalar(`
        SELECT COUNT(*) AS total FROM admin_notifications
        WHERE deleted_at IS NULL AND status = 'unread'
    `);
    const read = countScalar(`
        SELECT COUNT(*) AS total FROM admin_notifications
        WHERE deleted_at IS NULL AND status = 'read'
    `);
    const archived = countScalar(`
        SELECT COUNT(*) AS total FROM admin_notifications
        WHERE deleted_at IS NULL AND status = 'archived'
    `);

    const emailsSent = countScalar(`
        SELECT COUNT(*) AS total FROM notification_email_deliveries WHERE status = 'sent'
    `);
    const emailsFailed = countScalar(`
        SELECT COUNT(*) AS total FROM notification_email_deliveries WHERE status = 'failed'
    `);
    const emailsPending = countScalar(`
        SELECT COUNT(*) AS total FROM notification_email_deliveries WHERE status IN ('pending', 'failed') AND attempts < max_attempts
    `);
    const retryAttempts = countScalar(`
        SELECT COALESCE(SUM(CASE WHEN attempts > 1 THEN attempts - 1 ELSE 0 END), 0) AS total
        FROM notification_email_deliveries
    `);

    const pendingJobs = countScalar(`
        SELECT COUNT(*) AS total FROM notification_automation_jobs WHERE status IN ('pending', 'processing')
    `);

    const rangeTotal = countScalar(`
        SELECT COUNT(*) AS total FROM admin_notifications
        WHERE deleted_at IS NULL AND created_date >= ? AND created_date <= ?
    `, [range.from, range.to]);

    return {
        totalNotifications,
        notificationsSentToday: sentToday,
        notificationsSentThisWeek: sentThisWeek,
        notificationsSentThisMonth: sentThisMonth,
        emailsSuccessfullySent: emailsSent,
        failedEmails: emailsFailed,
        pendingNotifications: pendingJobs + emailsPending,
        pendingJobs,
        pendingEmails: emailsPending,
        unreadNotifications: unread,
        readNotifications: read,
        archivedNotifications: archived,
        retryAttempts,
        rangeTotal
    };
}

function getEventAnalytics(range, filters = {}) {
    const where = buildNotificationWhere(filters, range);
    const rows = getDb().prepare(`
        SELECT
            UPPER(COALESCE(NULLIF(json_extract(metadata_json, '$.eventKey'), ''), UPPER(type), 'SYSTEM')) AS event_key,
            type,
            COUNT(*) AS total
        FROM admin_notifications
        WHERE ${where.clause}
        GROUP BY event_key
        ORDER BY total DESC
        LIMIT 40
    `).all(...where.params);

    return rows.map((row) => {
        const eventKey = text(row.event_key, 'SYSTEM').toUpperCase();
        return {
            eventKey,
            type: text(row.type, 'system'),
            label: EVENT_LABELS[eventKey] || eventKey.replace(/_/g, ' '),
            total: Number(row.total || 0)
        };
    });
}

function getTypeAnalytics(range, filters = {}) {
    const where = buildNotificationWhere(filters, range);
    const rows = getDb().prepare(`
        SELECT type, COUNT(*) AS total
        FROM admin_notifications
        WHERE ${where.clause}
        GROUP BY type
        ORDER BY total DESC
    `).all(...where.params);
    return rows.map((row) => ({
        type: text(row.type, 'system'),
        label: text(row.type, 'system').replace(/_/g, ' '),
        total: Number(row.total || 0)
    }));
}

function getDeliveryAnalytics(range, filters = {}) {
    const emailStatus = text(filters.emailStatus || filters.deliveryStatus).toLowerCase();
    const clauses = ['1 = 1'];
    const params = [];

    if (range?.fromIso) {
        clauses.push('created_at >= ?');
        params.push(range.fromIso);
    }
    if (range?.toIso) {
        clauses.push('created_at <= ?');
        params.push(range.toIso);
    }
    if (emailStatus && ['sent', 'failed', 'pending', 'skipped'].includes(emailStatus)) {
        clauses.push('status = ?');
        params.push(emailStatus);
    }

    const where = clauses.join(' AND ');
    const byStatus = getDb().prepare(`
        SELECT status, COUNT(*) AS total, COALESCE(SUM(attempts), 0) AS attempts
        FROM notification_email_deliveries
        WHERE ${where}
        GROUP BY status
    `).all(...params);

    const statusMap = {
        sent: 0,
        failed: 0,
        pending: 0,
        skipped: 0
    };
    let attempts = 0;
    for (const row of byStatus) {
        const key = text(row.status, 'pending').toLowerCase();
        if (Object.prototype.hasOwnProperty.call(statusMap, key)) {
            statusMap[key] = Number(row.total || 0);
        }
        attempts += Number(row.attempts || 0);
    }

    const avgMs = averageScalar(`
        SELECT AVG(
            CASE
                WHEN sent_at IS NOT NULL AND created_at IS NOT NULL
                THEN (julianday(sent_at) - julianday(created_at)) * 86400000.0
                ELSE NULL
            END
        ) AS avgMs
        FROM notification_email_deliveries
        WHERE status = 'sent'
          AND created_at >= ?
          AND created_at <= ?
    `, [range.fromIso, range.toIso]);

    let channelStats = {};
    try {
        const channelRows = getDb().prepare(`
            SELECT channel, status, COUNT(*) AS total
            FROM notification_channel_deliveries
            WHERE created_at >= ? AND created_at <= ?
            GROUP BY channel, status
        `).all(range.fromIso, range.toIso);
        for (const row of channelRows) {
            const channel = text(row.channel, 'unknown');
            if (!channelStats[channel]) {
                channelStats[channel] = { sent: 0, failed: 0, pending: 0, skipped: 0, delivered: 0, retrying: 0, total: 0 };
            }
            const status = text(row.status, 'pending').toLowerCase();
            const count = Number(row.total || 0);
            if (Object.prototype.hasOwnProperty.call(channelStats[channel], status)) {
                channelStats[channel][status] = count;
            }
            channelStats[channel].total += count;
        }
    } catch (_error) {
        channelStats = {};
    }

    const retried = countScalar(`
        SELECT COUNT(*) AS total FROM notification_email_deliveries
        WHERE attempts > 1
          AND created_at >= ?
          AND created_at <= ?
    `, [range.fromIso, range.toIso]);

    return {
        successfullyDelivered: statusMap.sent,
        failed: statusMap.failed,
        pending: statusMap.pending,
        skipped: statusMap.skipped,
        retried,
        totalAttempts: attempts,
        averageDeliveryTimeMs: Math.round(avgMs || 0),
        averageDeliveryTimeSeconds: Number(((avgMs || 0) / 1000).toFixed(1)),
        channels: channelStats
    };
}

function getTrendSeries(range) {
    const rows = getDb().prepare(`
        SELECT created_date AS day, COUNT(*) AS total
        FROM admin_notifications
        WHERE deleted_at IS NULL
          AND created_date >= ?
          AND created_date <= ?
        GROUP BY created_date
        ORDER BY created_date ASC
    `).all(range.from, range.to);

    const emailRows = getDb().prepare(`
        SELECT substr(COALESCE(sent_at, created_at), 1, 10) AS day, COUNT(*) AS total
        FROM notification_email_deliveries
        WHERE status = 'sent'
          AND COALESCE(sent_at, created_at) >= ?
          AND COALESCE(sent_at, created_at) <= ?
        GROUP BY day
        ORDER BY day ASC
    `).all(range.fromIso, range.toIso);

    const map = new Map();
    for (const row of rows) {
        map.set(row.day, { label: row.day.slice(5), value: Number(row.total || 0), emails: 0 });
    }
    for (const row of emailRows) {
        const existing = map.get(row.day) || { label: String(row.day).slice(5), value: 0, emails: 0 };
        existing.emails = Number(row.total || 0);
        map.set(row.day, existing);
    }

    const notificationSeries = Array.from(map.entries())
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .map(([, item]) => ({ label: item.label, value: item.value }));

    const emailSeries = Array.from(map.entries())
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .map(([, item]) => ({ label: item.label, value: item.emails }));

    return { notificationSeries, emailSeries };
}

function getReportRows(range, filters = {}) {
    const where = buildNotificationWhere(filters, range, 'n');
    const emailStatus = text(filters.emailStatus).toLowerCase();
    const limit = Math.min(5000, Math.max(1, Number(filters.limit) || 2000));

    const rows = getDb().prepare(`
        SELECT
            n.id,
            n.type,
            n.title,
            n.message,
            n.priority,
            n.status,
            n.related_order_id,
            n.created_at,
            n.created_date,
            COALESCE(json_extract(n.metadata_json, '$.eventKey'), '') AS event_key,
            COALESCE(json_extract(n.metadata_json, '$.emailDelivery.status'), e.status, '') AS email_status,
            e.attempts AS email_attempts,
            e.sent_at AS email_sent_at,
            e.last_error AS email_error
        FROM admin_notifications n
        LEFT JOIN notification_email_deliveries e ON e.notification_id = n.id
        WHERE ${where.clause}
        ${emailStatus ? "AND LOWER(COALESCE(e.status, json_extract(n.metadata_json, '$.emailDelivery.status'), '')) = ?" : ''}
        ORDER BY n.created_at DESC
        LIMIT ?
    `).all(
        ...where.params,
        ...(emailStatus ? [emailStatus] : []),
        limit
    );

    return rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        message: row.message,
        priority: row.priority,
        status: row.status,
        relatedOrderId: row.related_order_id || '',
        createdAt: row.created_at,
        createdDate: row.created_date,
        eventKey: text(row.event_key).toUpperCase(),
        eventLabel: EVENT_LABELS[text(row.event_key).toUpperCase()] || text(row.event_key) || row.type,
        emailStatus: text(row.email_status) || 'n/a',
        emailAttempts: Number(row.email_attempts || 0),
        emailSentAt: row.email_sent_at || '',
        emailError: row.email_error || ''
    }));
}

async function getAnalyticsDashboard(query = {}) {
    try {
        const range = resolveRange(query);
        const filters = {
            type: query.type || query.notificationType || '',
            status: query.status || '',
            eventKey: query.eventKey || query.event || '',
            emailStatus: query.emailStatus || query.deliveryStatus || ''
        };

        const overview = getOverviewMetrics(range);
        const events = getEventAnalytics(range, filters);
        const types = getTypeAnalytics(range, filters);
        const delivery = getDeliveryAnalytics(range, filters);
        const trends = getTrendSeries(range);

        return {
            range,
            filters,
            overview,
            events,
            types,
            delivery,
            trends,
            eventSeries: events.slice(0, 12).map((item) => ({
                label: item.label.length > 12 ? item.eventKey.replace(/_/g, ' ').slice(0, 10) : item.label.slice(0, 12),
                value: item.total
            })),
            typeSeries: types.map((item) => ({
                label: item.label.slice(0, 12),
                value: item.total
            })),
            deliverySeries: [
                { label: 'Sent', value: delivery.successfullyDelivered },
                { label: 'Failed', value: delivery.failed },
                { label: 'Pending', value: delivery.pending },
                { label: 'Skipped', value: delivery.skipped },
                { label: 'Retried', value: delivery.retried }
            ],
            generatedAt: new Date().toISOString()
        };
    } catch (error) {
        appLogger.warn('notification.analytics.dashboard_failed', {
            error: String(error?.message || error)
        });
        throw error;
    }
}

async function getAnalyticsReport(query = {}) {
    const range = resolveRange(query);
    const filters = {
        type: query.type || query.notificationType || '',
        status: query.status || '',
        eventKey: query.eventKey || query.event || '',
        emailStatus: query.emailStatus || query.deliveryStatus || '',
        limit: query.limit
    };
    const dashboard = await getAnalyticsDashboard(query);
    const rows = getReportRows(range, filters);

    return {
        ...dashboard,
        rows,
        summary: {
            title: `Notification Report (${range.from} → ${range.to})`,
            totalRows: rows.length,
            overview: dashboard.overview,
            delivery: dashboard.delivery
        },
        generatedAt: new Date().toISOString()
    };
}

module.exports = {
    EVENT_LABELS,
    resolveRange,
    getAnalyticsDashboard,
    getAnalyticsReport
};
