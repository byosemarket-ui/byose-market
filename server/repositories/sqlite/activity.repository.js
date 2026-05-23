const SQLiteBaseRepository = require('./base.repository');

class SQLiteActivityRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'customer_activities' });
    }

    mapRow(row) {
        if (!row) {
            return null;
        }

        return {
            id: String(row.id),
            recordId: Number(row.id),
            clientActivityId: this.normalizeText(row.client_activity_id),
            userRecordId: row.user_id ? Number(row.user_id) : null,
            userId: this.normalizeText(row.user_public_id),
            email: this.normalizeText(row.email).toLowerCase(),
            phone: this.normalizeText(row.phone),
            sessionId: this.normalizeText(row.session_id),
            eventType: this.normalizeText(row.event_type),
            path: this.normalizeText(row.path),
            referrer: this.normalizeText(row.referrer),
            userAgent: this.normalizeText(row.user_agent),
            device: this.normalizeText(row.device),
            ip: this.normalizeText(row.ip),
            city: this.normalizeText(row.city),
            country: this.normalizeText(row.country),
            org: this.normalizeText(row.org),
            duration: this.toNumber(row.duration, 0),
            meta: this.parseJson(row.meta_json, {}),
            startedAt: row.started_at || row.created_at || null,
            endedAt: row.ended_at || null,
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || null
        };
    }

    async create(payload) {
        const now = this.now(payload.createdAt);
        const result = this.db.prepare(`
            INSERT INTO customer_activities (
                client_activity_id, user_id, user_public_id, email, phone, session_id, event_type, path, referrer, user_agent, device, ip, city, country, org, duration, meta_json, started_at, ended_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            this.normalizeText(payload.clientActivityId) || null,
            payload.userRecordId ? Number(payload.userRecordId) : null,
            this.normalizeText(payload.userId),
            this.normalizeText(payload.email).toLowerCase(),
            this.normalizeText(payload.phone),
            this.normalizeText(payload.sessionId),
            this.normalizeText(payload.eventType, 'visit'),
            this.normalizeText(payload.path),
            this.normalizeText(payload.referrer),
            this.normalizeText(payload.userAgent),
            this.normalizeText(payload.device),
            this.normalizeText(payload.ip),
            this.normalizeText(payload.city),
            this.normalizeText(payload.country),
            this.normalizeText(payload.org),
            this.toNumber(payload.duration, 0),
            this.stringifyJson(payload.meta || {}, {}),
            payload.startedAt || now,
            payload.endedAt || null,
            now,
            this.now(payload.updatedAt || now)
        );

        return this.findByRecordId(result.lastInsertRowid);
    }

    async findByRecordId(recordId) {
        return this.mapRow(this.db.prepare('SELECT * FROM customer_activities WHERE id = ? LIMIT 1').get(Number(recordId)));
    }

    async findByClientActivityId(clientActivityId) {
        return this.mapRow(this.db.prepare('SELECT * FROM customer_activities WHERE client_activity_id = ? ORDER BY created_at DESC LIMIT 1').get(this.normalizeText(clientActivityId)));
    }

    async upsertByClientActivity(payload) {
        const existing = payload.clientActivityId ? await this.findByClientActivityId(payload.clientActivityId) : null;
        if (!existing) {
            return this.create(payload);
        }

        const now = this.now();
        this.db.prepare(`
            UPDATE customer_activities
            SET user_id = ?, user_public_id = ?, email = ?, phone = ?, session_id = ?, event_type = ?, path = ?, referrer = ?, user_agent = ?, device = ?, ip = ?, city = ?, country = ?, org = ?, duration = ?, meta_json = ?, started_at = ?, ended_at = ?, updated_at = ?
            WHERE id = ?
        `).run(
            payload.userRecordId ? Number(payload.userRecordId) : existing.userRecordId,
            this.normalizeText(payload.userId, existing.userId),
            this.normalizeText(payload.email, existing.email).toLowerCase(),
            this.normalizeText(payload.phone, existing.phone),
            this.normalizeText(payload.sessionId, existing.sessionId),
            this.normalizeText(payload.eventType, existing.eventType || 'visit'),
            this.normalizeText(payload.path, existing.path),
            this.normalizeText(payload.referrer, existing.referrer),
            this.normalizeText(payload.userAgent, existing.userAgent),
            this.normalizeText(payload.device, existing.device),
            this.normalizeText(payload.ip, existing.ip),
            this.normalizeText(payload.city, existing.city),
            this.normalizeText(payload.country, existing.country),
            this.normalizeText(payload.org, existing.org),
            this.toNumber(payload.duration, existing.duration),
            this.stringifyJson(payload.meta || existing.meta || {}, {}),
            payload.startedAt || existing.startedAt,
            payload.endedAt || existing.endedAt,
            now,
            Number(existing.recordId)
        );

        return this.findByRecordId(existing.recordId);
    }

    async updateByClientActivityId(clientActivityId, updates) {
        return this.upsertByClientActivity({ ...(await this.findByClientActivityId(clientActivityId)), ...updates, clientActivityId });
    }

    async list({ eventType = '', limit = 50, offset = 0 } = {}) {
        const rows = eventType
            ? this.db.prepare('SELECT * FROM customer_activities WHERE event_type = ? ORDER BY created_at DESC, updated_at DESC LIMIT ? OFFSET ?').all(this.normalizeText(eventType), Math.max(1, Number(limit) || 50), Math.max(0, Number(offset) || 0))
            : this.db.prepare('SELECT * FROM customer_activities ORDER BY created_at DESC, updated_at DESC LIMIT ? OFFSET ?').all(Math.max(1, Number(limit) || 50), Math.max(0, Number(offset) || 0));
        return rows.map((row) => this.mapRow(row));
    }
}

module.exports = new SQLiteActivityRepository();