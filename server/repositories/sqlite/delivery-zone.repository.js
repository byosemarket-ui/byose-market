const crypto = require('crypto');
const SQLiteBaseRepository = require('./base.repository');

class SQLiteDeliveryZoneRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'delivery_zones' });
    }

    mapRow(row) {
        if (!row) return null;
        return {
            id: Number(row.id),
            publicId: this.normalizeText(row.public_id),
            name: this.normalizeText(row.name),
            country: this.normalizeText(row.country, 'Rwanda'),
            provinceCity: this.normalizeText(row.province_city),
            district: this.normalizeText(row.district),
            sector: this.normalizeText(row.sector),
            cell: this.normalizeText(row.cell),
            village: this.normalizeText(row.village),
            fee: this.toNumber(row.fee, 2000),
            estimatedDaysMin: Math.max(0, this.toNumber(row.estimated_days_min, 1)),
            estimatedDaysMax: Math.max(0, this.toNumber(row.estimated_days_max, 3)),
            enabled: Boolean(this.normalizeBoolean(row.enabled)),
            sortOrder: this.toNumber(row.sort_order, 0),
            notes: this.normalizeText(row.notes),
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || null
        };
    }

    async list({ includeDisabled = true } = {}) {
        const rows = includeDisabled
            ? this.db.prepare('SELECT * FROM delivery_zones ORDER BY sort_order ASC, id ASC').all()
            : this.db.prepare('SELECT * FROM delivery_zones WHERE enabled = 1 ORDER BY sort_order ASC, id ASC').all();
        return rows.map((row) => this.mapRow(row));
    }

    async findByPublicId(publicId) {
        return this.mapRow(
            this.db.prepare('SELECT * FROM delivery_zones WHERE public_id = ? LIMIT 1').get(this.normalizeText(publicId))
        );
    }

    async create(payload = {}) {
        const now = this.now();
        const publicId = this.normalizeText(payload.publicId) || `zone_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        this.db.prepare(`
            INSERT INTO delivery_zones (
                public_id, name, country, province_city, district, sector, cell, village,
                fee, estimated_days_min, estimated_days_max, enabled, sort_order, notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            publicId,
            this.normalizeText(payload.name, 'Delivery Zone'),
            this.normalizeText(payload.country, 'Rwanda'),
            this.normalizeText(payload.provinceCity),
            this.normalizeText(payload.district),
            this.normalizeText(payload.sector),
            this.normalizeText(payload.cell),
            this.normalizeText(payload.village),
            this.toNumber(payload.fee, 2000),
            Math.max(0, this.toNumber(payload.estimatedDaysMin, 1)),
            Math.max(0, this.toNumber(payload.estimatedDaysMax, 3)),
            this.normalizeBoolean(payload.enabled !== false) ? 1 : 0,
            this.toNumber(payload.sortOrder, 0),
            this.normalizeText(payload.notes),
            now,
            now
        );
        return this.findByPublicId(publicId);
    }

    async update(publicId, payload = {}) {
        const existing = await this.findByPublicId(publicId);
        if (!existing) return null;

        const now = this.now();
        this.db.prepare(`
            UPDATE delivery_zones
            SET name = ?, country = ?, province_city = ?, district = ?, sector = ?, cell = ?, village = ?,
                fee = ?, estimated_days_min = ?, estimated_days_max = ?, enabled = ?, sort_order = ?, notes = ?, updated_at = ?
            WHERE public_id = ?
        `).run(
            this.normalizeText(payload.name, existing.name),
            this.normalizeText(payload.country, existing.country),
            this.normalizeText(payload.provinceCity, existing.provinceCity),
            this.normalizeText(payload.district, existing.district),
            this.normalizeText(payload.sector, existing.sector),
            this.normalizeText(payload.cell, existing.cell),
            this.normalizeText(payload.village, existing.village),
            this.toNumber(payload.fee, existing.fee),
            Math.max(0, this.toNumber(payload.estimatedDaysMin, existing.estimatedDaysMin)),
            Math.max(0, this.toNumber(payload.estimatedDaysMax, existing.estimatedDaysMax)),
            this.normalizeBoolean(payload.enabled != null ? payload.enabled : existing.enabled) ? 1 : 0,
            this.toNumber(payload.sortOrder, existing.sortOrder),
            this.normalizeText(payload.notes, existing.notes),
            now,
            this.normalizeText(publicId)
        );

        return this.findByPublicId(publicId);
    }

    async remove(publicId) {
        const existing = await this.findByPublicId(publicId);
        if (!existing) return false;
        this.db.prepare('DELETE FROM delivery_zones WHERE public_id = ?').run(this.normalizeText(publicId));
        return true;
    }
}

module.exports = new SQLiteDeliveryZoneRepository();
