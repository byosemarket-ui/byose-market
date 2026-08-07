const crypto = require('crypto');
const SQLiteBaseRepository = require('./base.repository');

class SQLiteAdminProfileRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'admin_login_history' });
    }

    mapLoginRow(row) {
        if (!row) {
            return null;
        }

        return {
            id: Number(row.id),
            adminPublicId: this.normalizeText(row.admin_public_id),
            adminEmail: this.normalizeText(row.admin_email).toLowerCase(),
            sessionId: this.normalizeText(row.session_id),
            ip: this.normalizeText(row.ip),
            userAgent: this.normalizeText(row.user_agent),
            device: this.normalizeText(row.device),
            status: this.normalizeText(row.status, 'success'),
            meta: this.parseJson(row.meta_json, {}),
            createdAt: row.created_at || null
        };
    }

    mapActivityRow(row) {
        if (!row) {
            return null;
        }

        return {
            id: Number(row.id),
            adminPublicId: this.normalizeText(row.admin_public_id),
            adminEmail: this.normalizeText(row.admin_email).toLowerCase(),
            eventType: this.normalizeText(row.event_type, 'profile_update'),
            category: this.normalizeText(row.category, 'profile'),
            summary: this.normalizeText(row.summary),
            meta: this.parseJson(row.meta_json, {}),
            ip: this.normalizeText(row.ip),
            userAgent: this.normalizeText(row.user_agent),
            createdAt: row.created_at || null
        };
    }

    createSessionId() {
        return `sess_${crypto.randomBytes(16).toString('hex')}`;
    }

    async recordLogin({
        adminPublicId,
        adminEmail,
        sessionId = '',
        ip = '',
        userAgent = '',
        device = '',
        status = 'success',
        meta = {}
    } = {}) {
        const now = this.now();
        const resolvedSessionId = this.normalizeText(sessionId) || this.createSessionId();
        const result = this.db.prepare(`
            INSERT INTO admin_login_history (
                admin_public_id, admin_email, session_id, ip, user_agent, device, status, meta_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            this.normalizeText(adminPublicId),
            this.normalizeText(adminEmail).toLowerCase(),
            resolvedSessionId,
            this.normalizeText(ip),
            this.normalizeText(userAgent),
            this.normalizeText(device, 'Unknown'),
            this.normalizeText(status, 'success'),
            this.stringifyJson(meta || {}, {}),
            now
        );

        return this.mapLoginRow(
            this.db.prepare('SELECT * FROM admin_login_history WHERE id = ? LIMIT 1').get(result.lastInsertRowid)
        );
    }

    async listLoginHistory(adminPublicId, { limit = 20 } = {}) {
        const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
        return this.db.prepare(`
            SELECT * FROM admin_login_history
            WHERE admin_public_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
        `).all(this.normalizeText(adminPublicId), safeLimit).map((row) => this.mapLoginRow(row));
    }

    async findLatestSuccessfulLogin(adminPublicId) {
        return this.mapLoginRow(this.db.prepare(`
            SELECT * FROM admin_login_history
            WHERE admin_public_id = ? AND lower(status) = 'success'
            ORDER BY created_at DESC, id DESC
            LIMIT 1
        `).get(this.normalizeText(adminPublicId)));
    }

    async recordActivity({
        adminPublicId,
        adminEmail,
        eventType = 'profile_update',
        category = 'profile',
        summary = '',
        meta = {},
        ip = '',
        userAgent = ''
    } = {}) {
        const now = this.now();
        const result = this.db.prepare(`
            INSERT INTO admin_activity_events (
                admin_public_id, admin_email, event_type, category, summary, meta_json, ip, user_agent, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            this.normalizeText(adminPublicId),
            this.normalizeText(adminEmail).toLowerCase(),
            this.normalizeText(eventType, 'profile_update'),
            this.normalizeText(category, 'profile'),
            this.normalizeText(summary),
            this.stringifyJson(meta || {}, {}),
            this.normalizeText(ip),
            this.normalizeText(userAgent),
            now
        );

        return this.mapActivityRow(
            this.db.prepare('SELECT * FROM admin_activity_events WHERE id = ? LIMIT 1').get(result.lastInsertRowid)
        );
    }

    async listActivity(adminPublicId, { limit = 30, category = '' } = {}) {
        const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30));
        const normalizedCategory = this.normalizeText(category).toLowerCase();
        const params = [this.normalizeText(adminPublicId)];
        let sql = `
            SELECT * FROM admin_activity_events
            WHERE admin_public_id = ?
        `;

        if (normalizedCategory) {
            sql += ' AND lower(category) = ?';
            params.push(normalizedCategory);
        }

        sql += ' ORDER BY created_at DESC, id DESC LIMIT ?';
        params.push(safeLimit);

        return this.db.prepare(sql).all(...params).map((row) => this.mapActivityRow(row));
    }
}

module.exports = new SQLiteAdminProfileRepository();
