const SQLiteBaseRepository = require('./base.repository');

class SQLiteSettingsRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'settings' });
    }

    mapRow(row) {
        if (!row) {
            return null;
        }

        return {
            id: Number(row.id),
            key: this.normalizeText(row.key),
            storeName: this.normalizeText(row.store_name),
            supportEmail: this.normalizeText(row.support_email),
            supportPhone: this.normalizeText(row.support_phone),
            currency: this.normalizeText(row.currency, 'RWF'),
            value: this.parseJson(row.value_json, {}),
            updatedByAdminId: this.normalizeText(row.updated_by_admin_id),
            updatedByAdminEmail: this.normalizeText(row.updated_by_admin_email),
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || null
        };
    }

    async findByKey(key) {
        return this.mapRow(this.db.prepare('SELECT * FROM settings WHERE key = ? LIMIT 1').get(this.normalizeText(key, 'global')));
    }

    async upsert(key, payload) {
        const normalizedKey = this.normalizeText(key, 'global');
        const now = this.now();
        const existing = await this.findByKey(normalizedKey);

        if (existing) {
            this.db.prepare(`
                UPDATE settings
                SET store_name = ?, support_email = ?, support_phone = ?, currency = ?, value_json = ?, updated_by_admin_id = ?, updated_by_admin_email = ?, updated_at = ?
                WHERE key = ?
            `).run(
                this.normalizeText(payload.storeName),
                this.normalizeText(payload.supportEmail),
                this.normalizeText(payload.supportPhone),
                this.normalizeText(payload.currency, 'RWF'),
                this.stringifyJson(payload.value || {}, {}),
                this.normalizeText(payload.updatedByAdminId),
                this.normalizeText(payload.updatedByAdminEmail).toLowerCase(),
                now,
                normalizedKey
            );
        } else {
            this.db.prepare(`
                INSERT INTO settings (
                    key, store_name, support_email, support_phone, currency, value_json, updated_by_admin_id, updated_by_admin_email, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                normalizedKey,
                this.normalizeText(payload.storeName),
                this.normalizeText(payload.supportEmail),
                this.normalizeText(payload.supportPhone),
                this.normalizeText(payload.currency, 'RWF'),
                this.stringifyJson(payload.value || {}, {}),
                this.normalizeText(payload.updatedByAdminId),
                this.normalizeText(payload.updatedByAdminEmail).toLowerCase(),
                now,
                now
            );
        }

        return this.findByKey(normalizedKey);
    }
}

module.exports = new SQLiteSettingsRepository();