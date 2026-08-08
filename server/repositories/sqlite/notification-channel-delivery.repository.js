const crypto = require('crypto');
const SQLiteBaseRepository = require('./base.repository');

const ALLOWED_STATUSES = new Set(['pending', 'sent', 'delivered', 'failed', 'retrying', 'skipped']);

class SQLiteNotificationChannelDeliveryRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'notification_channel_deliveries' });
    }

    createId() {
        return `ncd_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    }

    mapRow(row) {
        if (!row) return null;
        return {
            id: this.normalizeText(row.id),
            notificationId: this.normalizeText(row.notification_id) || null,
            eventKey: this.normalizeText(row.event_key),
            channel: this.normalizeText(row.channel),
            dedupeKey: this.normalizeText(row.dedupe_key),
            status: this.normalizeText(row.status, 'pending'),
            attempts: this.toNumber(row.attempts, 0),
            maxAttempts: this.toNumber(row.max_attempts, 5),
            lastError: this.normalizeText(row.last_error) || null,
            provider: this.normalizeText(row.provider) || null,
            messageId: this.normalizeText(row.message_id) || null,
            recipient: this.normalizeText(row.recipient) || null,
            subject: this.normalizeText(row.subject) || null,
            payload: this.parseJson(row.payload_json, {}),
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || null,
            sentAt: row.sent_at || null,
            deliveredAt: row.delivered_at || null,
            nextRetryAt: row.next_retry_at || null
        };
    }

    normalizeStatus(value) {
        const status = this.normalizeText(value, 'pending').toLowerCase();
        return ALLOWED_STATUSES.has(status) ? status : 'pending';
    }

    async findByDedupeAndChannel(dedupeKey, channel) {
        const row = this.db.prepare(`
            SELECT * FROM notification_channel_deliveries
            WHERE dedupe_key = ? AND channel = ?
            LIMIT 1
        `).get(this.normalizeText(dedupeKey), this.normalizeText(channel).toLowerCase());
        return this.mapRow(row);
    }

    async findByNotificationAndChannel(notificationId, channel) {
        const row = this.db.prepare(`
            SELECT * FROM notification_channel_deliveries
            WHERE notification_id = ? AND channel = ?
            LIMIT 1
        `).get(this.normalizeText(notificationId), this.normalizeText(channel).toLowerCase());
        return this.mapRow(row);
    }

    async create(payload = {}) {
        const id = this.normalizeText(payload.id) || this.createId();
        const now = this.now();
        const status = this.normalizeStatus(payload.status || 'pending');

        try {
            this.db.prepare(`
                INSERT INTO notification_channel_deliveries (
                    id, notification_id, event_key, channel, dedupe_key, status,
                    attempts, max_attempts, last_error, provider, message_id, recipient, subject,
                    payload_json, created_at, updated_at, sent_at, delivered_at, next_retry_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                id,
                this.normalizeText(payload.notificationId) || null,
                this.normalizeText(payload.eventKey).toUpperCase().slice(0, 64),
                this.normalizeText(payload.channel).toLowerCase().slice(0, 32),
                this.normalizeText(payload.dedupeKey).slice(0, 190),
                status,
                this.toNumber(payload.attempts, 0),
                this.toNumber(payload.maxAttempts, 5),
                this.normalizeText(payload.lastError) || null,
                this.normalizeText(payload.provider) || null,
                this.normalizeText(payload.messageId) || null,
                this.normalizeText(payload.recipient) || null,
                this.normalizeText(payload.subject) || null,
                this.stringifyJson(payload.payload && typeof payload.payload === 'object' ? payload.payload : {}, {}),
                now,
                now,
                payload.sentAt || null,
                payload.deliveredAt || null,
                payload.nextRetryAt || null
            );
            return this.findById(id);
        } catch (error) {
            if (String(error?.message || '').toLowerCase().includes('unique')) {
                const existing = await this.findByDedupeAndChannel(payload.dedupeKey, payload.channel);
                if (existing) return existing;
            }
            throw error;
        }
    }

    async findById(id) {
        const row = this.db.prepare(`
            SELECT * FROM notification_channel_deliveries WHERE id = ? LIMIT 1
        `).get(this.normalizeText(id));
        return this.mapRow(row);
    }

    async update(id, patch = {}) {
        const existing = await this.findById(id);
        if (!existing) return null;
        const now = this.now();
        this.db.prepare(`
            UPDATE notification_channel_deliveries
            SET
                notification_id = ?,
                status = ?,
                attempts = ?,
                max_attempts = ?,
                last_error = ?,
                provider = ?,
                message_id = ?,
                recipient = ?,
                subject = ?,
                payload_json = ?,
                updated_at = ?,
                sent_at = ?,
                delivered_at = ?,
                next_retry_at = ?
            WHERE id = ?
        `).run(
            this.normalizeText(patch.notificationId != null ? patch.notificationId : existing.notificationId) || null,
            this.normalizeStatus(patch.status != null ? patch.status : existing.status),
            this.toNumber(patch.attempts != null ? patch.attempts : existing.attempts, existing.attempts),
            this.toNumber(patch.maxAttempts != null ? patch.maxAttempts : existing.maxAttempts, existing.maxAttempts),
            patch.lastError !== undefined ? (this.normalizeText(patch.lastError) || null) : existing.lastError,
            patch.provider !== undefined ? (this.normalizeText(patch.provider) || null) : existing.provider,
            patch.messageId !== undefined ? (this.normalizeText(patch.messageId) || null) : existing.messageId,
            patch.recipient !== undefined ? (this.normalizeText(patch.recipient) || null) : existing.recipient,
            patch.subject !== undefined ? (this.normalizeText(patch.subject) || null) : existing.subject,
            this.stringifyJson(
                patch.payload && typeof patch.payload === 'object' ? patch.payload : existing.payload,
                existing.payload || {}
            ),
            now,
            patch.sentAt !== undefined ? patch.sentAt : existing.sentAt,
            patch.deliveredAt !== undefined ? patch.deliveredAt : existing.deliveredAt,
            patch.nextRetryAt !== undefined ? patch.nextRetryAt : existing.nextRetryAt,
            this.normalizeText(id)
        );
        return this.findById(id);
    }

    async listDueRetries({ limit = 20 } = {}) {
        const now = this.now();
        const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
        const rows = this.db.prepare(`
            SELECT * FROM notification_channel_deliveries
            WHERE status IN ('pending', 'retrying', 'failed')
              AND attempts < max_attempts
              AND (next_retry_at IS NULL OR next_retry_at <= ?)
            ORDER BY COALESCE(next_retry_at, created_at) ASC
            LIMIT ?
        `).all(now, safeLimit);
        return rows.map((row) => this.mapRow(row));
    }

    async getStatsByChannel() {
        const rows = this.db.prepare(`
            SELECT channel, status, COUNT(*) AS total
            FROM notification_channel_deliveries
            GROUP BY channel, status
        `).all();
        const stats = {};
        for (const row of rows) {
            const channel = this.normalizeText(row.channel, 'unknown');
            if (!stats[channel]) {
                stats[channel] = {
                    pending: 0,
                    sent: 0,
                    delivered: 0,
                    failed: 0,
                    retrying: 0,
                    skipped: 0,
                    total: 0
                };
            }
            const status = this.normalizeStatus(row.status);
            const count = this.toNumber(row.total, 0);
            if (Object.prototype.hasOwnProperty.call(stats[channel], status)) {
                stats[channel][status] = count;
            }
            stats[channel].total += count;
        }
        return stats;
    }

    async findLatestByChannel(channel) {
        const row = this.db.prepare(`
            SELECT * FROM notification_channel_deliveries
            WHERE channel = ?
            ORDER BY COALESCE(delivered_at, sent_at, updated_at, created_at) DESC
            LIMIT 1
        `).get(this.normalizeText(channel).toLowerCase());
        return this.mapRow(row);
    }
}

module.exports = new SQLiteNotificationChannelDeliveryRepository();
