const crypto = require('crypto');
const SQLiteBaseRepository = require('./base.repository');

const ALLOWED_STATUSES = new Set(['pending', 'sent', 'failed', 'skipped']);

class SQLiteNotificationEmailDeliveryRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'notification_email_deliveries' });
    }

    createId() {
        return `ned_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    }

    mapRow(row) {
        if (!row) return null;
        return {
            id: this.normalizeText(row.id),
            notificationId: this.normalizeText(row.notification_id),
            eventKey: this.normalizeText(row.event_key),
            dedupeKey: this.normalizeText(row.dedupe_key),
            recipient: this.normalizeText(row.recipient),
            status: this.normalizeText(row.status, 'pending'),
            attempts: this.toNumber(row.attempts, 0),
            maxAttempts: this.toNumber(row.max_attempts, 5),
            lastError: this.normalizeText(row.last_error) || null,
            provider: this.normalizeText(row.provider) || null,
            messageId: this.normalizeText(row.message_id) || null,
            subject: this.normalizeText(row.subject) || null,
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || null,
            sentAt: row.sent_at || null,
            nextRetryAt: row.next_retry_at || null
        };
    }

    normalizeStatus(value) {
        const status = this.normalizeText(value, 'pending').toLowerCase();
        return ALLOWED_STATUSES.has(status) ? status : 'pending';
    }

    async findByNotificationId(notificationId) {
        const row = this.db.prepare(`
            SELECT * FROM notification_email_deliveries
            WHERE notification_id = ?
            LIMIT 1
        `).get(this.normalizeText(notificationId));
        return this.mapRow(row);
    }

    async findByDedupeKey(dedupeKey) {
        const row = this.db.prepare(`
            SELECT * FROM notification_email_deliveries
            WHERE dedupe_key = ?
            LIMIT 1
        `).get(this.normalizeText(dedupeKey));
        return this.mapRow(row);
    }

    async findSentByDedupeKey(dedupeKey) {
        const row = this.db.prepare(`
            SELECT * FROM notification_email_deliveries
            WHERE dedupe_key = ? AND status = 'sent'
            LIMIT 1
        `).get(this.normalizeText(dedupeKey));
        return this.mapRow(row);
    }

    async create(payload = {}) {
        const id = this.normalizeText(payload.id) || this.createId();
        const now = this.now();
        const status = this.normalizeStatus(payload.status || 'pending');

        try {
            this.db.prepare(`
                INSERT INTO notification_email_deliveries (
                    id, notification_id, event_key, dedupe_key, recipient, status,
                    attempts, max_attempts, last_error, provider, message_id, subject,
                    created_at, updated_at, sent_at, next_retry_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                id,
                this.normalizeText(payload.notificationId),
                this.normalizeText(payload.eventKey).slice(0, 64),
                this.normalizeText(payload.dedupeKey).slice(0, 255),
                this.normalizeText(payload.recipient).toLowerCase().slice(0, 255),
                status,
                this.toNumber(payload.attempts, 0),
                this.toNumber(payload.maxAttempts, 5),
                this.normalizeText(payload.lastError) || null,
                this.normalizeText(payload.provider) || null,
                this.normalizeText(payload.messageId) || null,
                this.normalizeText(payload.subject).slice(0, 255) || null,
                now,
                now,
                status === 'sent' ? (payload.sentAt || now) : null,
                payload.nextRetryAt || null
            );
        } catch (error) {
            // Unique notification_id / dedupe_key — return existing row instead of throwing.
            const existingByNotification = await this.findByNotificationId(payload.notificationId);
            if (existingByNotification) return existingByNotification;
            const existingByDedupe = await this.findByDedupeKey(payload.dedupeKey);
            if (existingByDedupe) return existingByDedupe;
            throw error;
        }

        return this.findById(id);
    }

    async findById(id) {
        const row = this.db.prepare(`
            SELECT * FROM notification_email_deliveries WHERE id = ? LIMIT 1
        `).get(this.normalizeText(id));
        return this.mapRow(row);
    }

    async update(id, patch = {}) {
        const existing = await this.findById(id);
        if (!existing) return null;

        const next = {
            status: patch.status != null ? this.normalizeStatus(patch.status) : existing.status,
            attempts: patch.attempts != null ? this.toNumber(patch.attempts, existing.attempts) : existing.attempts,
            maxAttempts: patch.maxAttempts != null ? this.toNumber(patch.maxAttempts, existing.maxAttempts) : existing.maxAttempts,
            lastError: patch.lastError !== undefined ? (this.normalizeText(patch.lastError) || null) : existing.lastError,
            provider: patch.provider !== undefined ? (this.normalizeText(patch.provider) || null) : existing.provider,
            messageId: patch.messageId !== undefined ? (this.normalizeText(patch.messageId) || null) : existing.messageId,
            subject: patch.subject !== undefined ? (this.normalizeText(patch.subject).slice(0, 255) || null) : existing.subject,
            sentAt: patch.sentAt !== undefined ? patch.sentAt : existing.sentAt,
            nextRetryAt: patch.nextRetryAt !== undefined ? patch.nextRetryAt : existing.nextRetryAt
        };

        const now = this.now();
        this.db.prepare(`
            UPDATE notification_email_deliveries
            SET status = ?,
                attempts = ?,
                max_attempts = ?,
                last_error = ?,
                provider = ?,
                message_id = ?,
                subject = ?,
                updated_at = ?,
                sent_at = ?,
                next_retry_at = ?
            WHERE id = ?
        `).run(
            next.status,
            next.attempts,
            next.maxAttempts,
            next.lastError,
            next.provider,
            next.messageId,
            next.subject,
            now,
            next.sentAt,
            next.nextRetryAt,
            this.normalizeText(id)
        );

        return this.findById(id);
    }

    async listRetryCandidates({ limit = 25, nowIso = null } = {}) {
        const now = nowIso || this.now();
        const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
        const rows = this.db.prepare(`
            SELECT * FROM notification_email_deliveries
            WHERE status IN ('pending', 'failed')
              AND attempts < max_attempts
              AND (next_retry_at IS NULL OR next_retry_at <= ?)
            ORDER BY updated_at ASC
            LIMIT ?
        `).all(now, safeLimit);
        return rows.map((row) => this.mapRow(row));
    }

    async getStats() {
        const rows = this.db.prepare(`
            SELECT status, COUNT(*) AS total, COALESCE(SUM(attempts), 0) AS attempts
            FROM notification_email_deliveries
            GROUP BY status
        `).all();
        const stats = {
            pending: 0,
            sent: 0,
            failed: 0,
            skipped: 0,
            total: 0,
            retryAttempts: 0
        };
        for (const row of rows) {
            const key = this.normalizeText(row.status, 'pending');
            const count = this.toNumber(row.total, 0);
            if (Object.prototype.hasOwnProperty.call(stats, key)) {
                stats[key] = count;
            }
            stats.total += count;
            stats.retryAttempts += this.toNumber(row.attempts, 0);
        }
        return stats;
    }

    async findLatestByStatus(status) {
        const row = this.db.prepare(`
            SELECT * FROM notification_email_deliveries
            WHERE status = ?
            ORDER BY COALESCE(sent_at, updated_at, created_at) DESC
            LIMIT 1
        `).get(this.normalizeStatus(status));
        return this.mapRow(row);
    }

    async countFailedSince(isoSince) {
        const row = this.db.prepare(`
            SELECT COUNT(*) AS total
            FROM notification_email_deliveries
            WHERE status = 'failed' AND updated_at >= ?
        `).get(this.normalizeText(isoSince) || '1970-01-01T00:00:00.000Z');
        return this.toNumber(row?.total, 0);
    }
}

module.exports = new SQLiteNotificationEmailDeliveryRepository();
