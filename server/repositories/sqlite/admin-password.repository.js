const SQLiteBaseRepository = require('./base.repository');

class SQLiteAdminPasswordRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'admin_password_history' });
    }

    mapHistoryRow(row) {
        if (!row) return null;
        return {
            id: Number(row.id),
            adminPublicId: this.normalizeText(row.admin_public_id),
            passwordHash: this.normalizeText(row.password_hash),
            passwordVersion: Number(row.password_version || 1) || 1,
            createdAt: row.created_at || null,
            meta: this.parseJson(row.meta_json, {})
        };
    }

    async addHistory({ adminPublicId, passwordHash, passwordVersion = 1, meta = {} } = {}) {
        const result = this.db.prepare(`
            INSERT INTO admin_password_history (
                admin_public_id, password_hash, password_version, created_at, meta_json
            ) VALUES (?, ?, ?, ?, ?)
        `).run(
            this.normalizeText(adminPublicId),
            this.normalizeText(passwordHash),
            Math.max(1, Number(passwordVersion) || 1),
            this.now(),
            this.stringifyJson(meta || {}, {})
        );

        return this.mapHistoryRow(
            this.db.prepare('SELECT * FROM admin_password_history WHERE id = ? LIMIT 1').get(result.lastInsertRowid)
        );
    }

    async listHistory(adminPublicId, { limit = 20 } = {}) {
        const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
        return this.db.prepare(`
            SELECT id, admin_public_id, password_hash, password_version, created_at, meta_json
            FROM admin_password_history
            WHERE admin_public_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
        `).all(this.normalizeText(adminPublicId), safeLimit).map((row) => this.mapHistoryRow(row));
    }

    async listHistoryMetadata(adminPublicId, { limit = 20 } = {}) {
        const rows = await this.listHistory(adminPublicId, { limit });
        return rows.map((row) => ({
            id: row.id,
            passwordVersion: row.passwordVersion,
            changedAt: row.createdAt,
            source: row.meta?.source || 'admin_settings'
        }));
    }

    async pruneHistory(adminPublicId, keep = 8) {
        const safeKeep = Math.max(1, Number(keep) || 8);
        const rows = this.db.prepare(`
            SELECT id FROM admin_password_history
            WHERE admin_public_id = ?
            ORDER BY created_at DESC, id DESC
        `).all(this.normalizeText(adminPublicId));

        const removable = rows.slice(safeKeep).map((row) => Number(row.id));
        if (!removable.length) {
            return 0;
        }

        const placeholders = removable.map(() => '?').join(', ');
        this.db.prepare(`DELETE FROM admin_password_history WHERE id IN (${placeholders})`).run(...removable);
        return removable.length;
    }
}

module.exports = new SQLiteAdminPasswordRepository();
