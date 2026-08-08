const crypto = require('crypto');
const SQLiteBaseRepository = require('./base.repository');

const ALLOWED_STATUSES = new Set(['info', 'success', 'warning', 'error']);

class SQLiteNotificationOpsLogRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'notification_ops_logs' });
    }

    createId() {
        return `nol_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    }

    mapRow(row) {
        if (!row) return null;
        return {
            id: this.normalizeText(row.id),
            eventType: this.normalizeText(row.event_type),
            status: this.normalizeText(row.status, 'info'),
            channel: this.normalizeText(row.channel, 'system'),
            message: this.normalizeText(row.message),
            details: this.parseJson(row.details_json, {}),
            relatedNotificationId: this.normalizeText(row.related_notification_id) || null,
            relatedJobId: this.normalizeText(row.related_job_id) || null,
            relatedDeliveryId: this.normalizeText(row.related_delivery_id) || null,
            createdAt: row.created_at || null
        };
    }

    normalizeStatus(value) {
        const status = this.normalizeText(value, 'info').toLowerCase();
        return ALLOWED_STATUSES.has(status) ? status : 'info';
    }

    async create(payload = {}) {
        const id = this.normalizeText(payload.id) || this.createId();
        const now = this.now();
        this.db.prepare(`
            INSERT INTO notification_ops_logs (
                id, event_type, status, channel, message, details_json,
                related_notification_id, related_job_id, related_delivery_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            this.normalizeText(payload.eventType || payload.type, 'SYSTEM').slice(0, 64),
            this.normalizeStatus(payload.status),
            this.normalizeText(payload.channel, 'system').slice(0, 32),
            this.normalizeText(payload.message).slice(0, 1000),
            this.stringifyJson(payload.details && typeof payload.details === 'object' ? payload.details : {}, {}),
            this.normalizeText(payload.relatedNotificationId) || null,
            this.normalizeText(payload.relatedJobId) || null,
            this.normalizeText(payload.relatedDeliveryId) || null,
            now
        );
        return this.findById(id);
    }

    async findById(id) {
        const row = this.db.prepare(`
            SELECT * FROM notification_ops_logs WHERE id = ? LIMIT 1
        `).get(this.normalizeText(id));
        return this.mapRow(row);
    }

    async list({
        eventType = '',
        status = '',
        channel = '',
        limit = 50,
        offset = 0
    } = {}) {
        const clauses = [];
        const params = [];

        const type = this.normalizeText(eventType).toUpperCase();
        if (type) {
            clauses.push('event_type = ?');
            params.push(type.slice(0, 64));
        }

        const normalizedStatus = this.normalizeText(status).toLowerCase();
        if (normalizedStatus && ALLOWED_STATUSES.has(normalizedStatus)) {
            clauses.push('status = ?');
            params.push(normalizedStatus);
        }

        const normalizedChannel = this.normalizeText(channel).toLowerCase();
        if (normalizedChannel) {
            clauses.push('channel = ?');
            params.push(normalizedChannel.slice(0, 32));
        }

        const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
        const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
        const safeOffset = Math.max(Number(offset) || 0, 0);

        const rows = this.db.prepare(`
            SELECT * FROM notification_ops_logs
            ${whereSql}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `).all(...params, safeLimit, safeOffset);

        const totalRow = this.db.prepare(`
            SELECT COUNT(*) AS total FROM notification_ops_logs
            ${whereSql}
        `).get(...params);

        return {
            items: rows.map((row) => this.mapRow(row)),
            total: Number(totalRow?.total || 0),
            limit: safeLimit,
            offset: safeOffset
        };
    }

    async countByStatusSince(isoSince) {
        const rows = this.db.prepare(`
            SELECT status, COUNT(*) AS total
            FROM notification_ops_logs
            WHERE created_at >= ?
            GROUP BY status
        `).all(this.normalizeText(isoSince) || '1970-01-01T00:00:00.000Z');
        const out = { info: 0, success: 0, warning: 0, error: 0 };
        for (const row of rows) {
            const key = this.normalizeText(row.status, 'info');
            if (Object.prototype.hasOwnProperty.call(out, key)) {
                out[key] = this.toNumber(row.total, 0);
            }
        }
        return out;
    }

    async countEventTypeSince(eventType, isoSince) {
        const row = this.db.prepare(`
            SELECT COUNT(*) AS total
            FROM notification_ops_logs
            WHERE event_type = ? AND created_at >= ?
        `).get(
            this.normalizeText(eventType).toUpperCase().slice(0, 64),
            this.normalizeText(isoSince) || '1970-01-01T00:00:00.000Z'
        );
        return this.toNumber(row?.total, 0);
    }

    async pruneOlderThanDays(days = 30) {
        const safeDays = Math.min(Math.max(Number(days) || 30, 1), 3650);
        const cutoff = new Date(Date.now() - (safeDays * 24 * 60 * 60 * 1000)).toISOString();
        const result = this.db.prepare(`
            DELETE FROM notification_ops_logs WHERE created_at < ?
        `).run(cutoff);
        return Number(result?.changes || 0);
    }
}

module.exports = new SQLiteNotificationOpsLogRepository();
