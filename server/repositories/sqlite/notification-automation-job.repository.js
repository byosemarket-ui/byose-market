const crypto = require('crypto');
const SQLiteBaseRepository = require('./base.repository');

const ALLOWED_STATUSES = new Set(['pending', 'processing', 'completed', 'failed', 'skipped']);

class SQLiteNotificationAutomationJobRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'notification_automation_jobs' });
    }

    createId() {
        return `naj_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    }

    mapRow(row) {
        if (!row) return null;
        return {
            id: this.normalizeText(row.id),
            eventKey: this.normalizeText(row.event_key),
            dedupeKey: this.normalizeText(row.dedupe_key),
            payload: this.parseJson(row.payload_json, {}),
            status: this.normalizeText(row.status, 'pending'),
            attempts: this.toNumber(row.attempts, 0),
            maxAttempts: this.toNumber(row.max_attempts, 5),
            lastError: this.normalizeText(row.last_error) || null,
            notificationId: this.normalizeText(row.notification_id) || null,
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || null,
            availableAt: row.available_at || null,
            startedAt: row.started_at || null,
            processedAt: row.processed_at || null
        };
    }

    normalizeStatus(value) {
        const status = this.normalizeText(value, 'pending').toLowerCase();
        return ALLOWED_STATUSES.has(status) ? status : 'pending';
    }

    async findById(id) {
        const row = this.db.prepare(`
            SELECT * FROM notification_automation_jobs WHERE id = ? LIMIT 1
        `).get(this.normalizeText(id));
        return this.mapRow(row);
    }

    async findByDedupeKey(dedupeKey) {
        const row = this.db.prepare(`
            SELECT * FROM notification_automation_jobs WHERE dedupe_key = ? LIMIT 1
        `).get(this.normalizeText(dedupeKey));
        return this.mapRow(row);
    }

    /**
     * Insert a pending job. Returns existing row when dedupe_key already exists.
     */
    async enqueue(payload = {}) {
        const id = this.normalizeText(payload.id) || this.createId();
        const now = this.now();
        const availableAt = payload.availableAt || now;
        const dedupeKey = this.normalizeText(payload.dedupeKey).slice(0, 255);
        const eventKey = this.normalizeText(payload.eventKey).slice(0, 64);

        try {
            this.db.prepare(`
                INSERT INTO notification_automation_jobs (
                    id, event_key, dedupe_key, payload_json, status, attempts, max_attempts,
                    last_error, notification_id, created_at, updated_at, available_at,
                    started_at, processed_at
                ) VALUES (?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ?, ?, NULL, NULL)
            `).run(
                id,
                eventKey,
                dedupeKey,
                this.stringifyJson(payload.payload && typeof payload.payload === 'object' ? payload.payload : {}, {}),
                this.toNumber(payload.maxAttempts, 5),
                now,
                now,
                availableAt
            );
            return {
                job: await this.findById(id),
                created: true,
                duplicate: false
            };
        } catch (error) {
            const existing = await this.findByDedupeKey(dedupeKey);
            if (existing) {
                return { job: existing, created: false, duplicate: true };
            }
            throw error;
        }
    }

    async claimNextBatch({ limit = 10, nowIso = null } = {}) {
        const now = nowIso || this.now();
        const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
        const candidates = this.db.prepare(`
            SELECT id FROM notification_automation_jobs
            WHERE status IN ('pending', 'failed')
              AND attempts < max_attempts
              AND available_at <= ?
            ORDER BY available_at ASC, created_at ASC
            LIMIT ?
        `).all(now, safeLimit);

        const claimed = [];
        const claimStmt = this.db.prepare(`
            UPDATE notification_automation_jobs
            SET status = 'processing',
                started_at = ?,
                updated_at = ?,
                attempts = attempts + 1
            WHERE id = ?
              AND status IN ('pending', 'failed')
              AND attempts < max_attempts
              AND available_at <= ?
        `);

        for (const row of candidates) {
            const result = claimStmt.run(now, now, row.id, now);
            if (Number(result?.changes || 0) > 0) {
                const job = await this.findById(row.id);
                if (job) claimed.push(job);
            }
        }

        return claimed;
    }

    async markCompleted(id, { notificationId = null } = {}) {
        const now = this.now();
        this.db.prepare(`
            UPDATE notification_automation_jobs
            SET status = 'completed',
                notification_id = COALESCE(?, notification_id),
                last_error = NULL,
                processed_at = ?,
                updated_at = ?
            WHERE id = ?
        `).run(this.normalizeText(notificationId) || null, now, now, this.normalizeText(id));
        return this.findById(id);
    }

    async markSkipped(id, reason = '') {
        const now = this.now();
        this.db.prepare(`
            UPDATE notification_automation_jobs
            SET status = 'skipped',
                last_error = ?,
                processed_at = ?,
                updated_at = ?
            WHERE id = ?
        `).run(this.normalizeText(reason).slice(0, 1000) || null, now, now, this.normalizeText(id));
        return this.findById(id);
    }

    async markFailed(id, { error = '', availableAt = null, exhausted = false } = {}) {
        const now = this.now();
        const status = exhausted ? 'failed' : 'failed';
        this.db.prepare(`
            UPDATE notification_automation_jobs
            SET status = ?,
                last_error = ?,
                available_at = COALESCE(?, available_at),
                updated_at = ?,
                processed_at = CASE WHEN ? THEN ? ELSE processed_at END
            WHERE id = ?
        `).run(
            status,
            this.normalizeText(error).slice(0, 1000) || null,
            availableAt,
            now,
            exhausted ? 1 : 0,
            exhausted ? now : null,
            this.normalizeText(id)
        );
        return this.findById(id);
    }

    async getStats() {
        const rows = this.db.prepare(`
            SELECT status, COUNT(*) AS total
            FROM notification_automation_jobs
            GROUP BY status
        `).all();
        const stats = {
            pending: 0,
            processing: 0,
            completed: 0,
            failed: 0,
            skipped: 0,
            total: 0
        };
        for (const row of rows) {
            const key = this.normalizeText(row.status, 'pending');
            const count = this.toNumber(row.total, 0);
            if (Object.prototype.hasOwnProperty.call(stats, key)) {
                stats[key] = count;
            }
            stats.total += count;
        }
        return stats;
    }

    /**
     * Recover jobs stuck in processing (crash / hard kill mid-batch).
     */
    async recoverStuckProcessing({ olderThanMs = 5 * 60 * 1000 } = {}) {
        const cutoff = new Date(Date.now() - Math.max(Number(olderThanMs) || 0, 30 * 1000)).toISOString();
        const now = this.now();
        const result = this.db.prepare(`
            UPDATE notification_automation_jobs
            SET status = 'failed',
                last_error = COALESCE(last_error, 'Recovered stuck processing job'),
                available_at = ?,
                updated_at = ?
            WHERE status = 'processing'
              AND started_at IS NOT NULL
              AND started_at < ?
              AND attempts < max_attempts
        `).run(now, now, cutoff);
        return Number(result?.changes || 0);
    }

    async countFailedSince(isoSince) {
        const row = this.db.prepare(`
            SELECT COUNT(*) AS total
            FROM notification_automation_jobs
            WHERE status = 'failed' AND updated_at >= ?
        `).get(this.normalizeText(isoSince) || '1970-01-01T00:00:00.000Z');
        return this.toNumber(row?.total, 0);
    }
}

module.exports = new SQLiteNotificationAutomationJobRepository();
