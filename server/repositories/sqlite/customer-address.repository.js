const SQLiteBaseRepository = require('./base.repository');

class SQLiteCustomerAddressRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'customer_addresses' });
        this._tableReady = false;
    }

    ensureTable() {
        if (this._tableReady) return;
        try {
            const row = this.db.prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'customer_addresses' LIMIT 1"
            ).get();
            this._tableReady = Boolean(row);
        } catch (_error) {
            this._tableReady = false;
        }
    }

    mapRow(row) {
        if (!row) {
            return null;
        }

        return {
            id: this.normalizeText(row.address_id),
            userPublicId: this.normalizeText(row.user_public_id),
            fullName: this.normalizeText(row.full_name),
            phone: this.normalizeText(row.phone),
            provinceCity: this.normalizeText(row.province_city),
            district: this.normalizeText(row.district),
            sector: this.normalizeText(row.sector),
            cell: this.normalizeText(row.cell),
            village: this.normalizeText(row.village),
            street: this.normalizeText(row.street),
            note: this.normalizeText(row.note),
            latitude: this.normalizeText(row.latitude),
            longitude: this.normalizeText(row.longitude),
            mapLink: this.normalizeText(row.map_link),
            locationAccuracy: this.normalizeText(row.location_accuracy),
            locationCapturedAt: this.normalizeText(row.location_captured_at),
            isDefault: Boolean(row.is_default),
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || null
        };
    }

    listByUser(userPublicId) {
        this.ensureTable();
        if (!this._tableReady) return [];
        return this.db.prepare(`
            SELECT * FROM customer_addresses
            WHERE user_public_id = ?
            ORDER BY is_default DESC, updated_at DESC, id DESC
        `).all(this.normalizeText(userPublicId)).map((row) => this.mapRow(row));
    }

    findByAddressId(addressId) {
        this.ensureTable();
        if (!this._tableReady) return null;
        return this.mapRow(
            this.db.prepare('SELECT * FROM customer_addresses WHERE address_id = ? LIMIT 1')
                .get(this.normalizeText(addressId))
        );
    }

    findOwned(userPublicId, addressId) {
        this.ensureTable();
        if (!this._tableReady) return null;
        return this.mapRow(
            this.db.prepare(`
                SELECT * FROM customer_addresses
                WHERE address_id = ? AND user_public_id = ?
                LIMIT 1
            `).get(this.normalizeText(addressId), this.normalizeText(userPublicId))
        );
    }

    create(address = {}) {
        this.ensureTable();
        if (!this._tableReady) {
            throw new Error('customer_addresses table is not available');
        }

        const now = this.now();
        this.db.prepare(`
            INSERT INTO customer_addresses (
                address_id, user_public_id, full_name, phone, province_city, district, sector,
                cell, village, street, note, latitude, longitude, map_link, location_accuracy,
                location_captured_at, is_default, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            this.normalizeText(address.id),
            this.normalizeText(address.userPublicId),
            this.normalizeText(address.fullName),
            this.normalizeText(address.phone),
            this.normalizeText(address.provinceCity),
            this.normalizeText(address.district),
            this.normalizeText(address.sector),
            this.normalizeText(address.cell),
            this.normalizeText(address.village),
            this.normalizeText(address.street),
            this.normalizeText(address.note),
            this.normalizeText(address.latitude),
            this.normalizeText(address.longitude),
            this.normalizeText(address.mapLink),
            this.normalizeText(address.locationAccuracy),
            this.normalizeText(address.locationCapturedAt),
            address.isDefault ? 1 : 0,
            now,
            now
        );

        return this.findByAddressId(address.id);
    }

    update(userPublicId, addressId, address = {}) {
        this.ensureTable();
        if (!this._tableReady) return null;
        const now = this.now();
        this.db.prepare(`
            UPDATE customer_addresses
            SET full_name = ?, phone = ?, province_city = ?, district = ?, sector = ?,
                cell = ?, village = ?, street = ?, note = ?, latitude = ?, longitude = ?,
                map_link = ?, location_accuracy = ?, location_captured_at = ?, updated_at = ?
            WHERE address_id = ? AND user_public_id = ?
        `).run(
            this.normalizeText(address.fullName),
            this.normalizeText(address.phone),
            this.normalizeText(address.provinceCity),
            this.normalizeText(address.district),
            this.normalizeText(address.sector),
            this.normalizeText(address.cell),
            this.normalizeText(address.village),
            this.normalizeText(address.street),
            this.normalizeText(address.note),
            this.normalizeText(address.latitude),
            this.normalizeText(address.longitude),
            this.normalizeText(address.mapLink),
            this.normalizeText(address.locationAccuracy),
            this.normalizeText(address.locationCapturedAt),
            now,
            this.normalizeText(addressId),
            this.normalizeText(userPublicId)
        );
        return this.findOwned(userPublicId, addressId);
    }

    clearDefault(userPublicId) {
        this.ensureTable();
        if (!this._tableReady) return;
        this.db.prepare(`
            UPDATE customer_addresses
            SET is_default = 0, updated_at = ?
            WHERE user_public_id = ? AND is_default = 1
        `).run(this.now(), this.normalizeText(userPublicId));
    }

    setDefault(userPublicId, addressId) {
        this.ensureTable();
        if (!this._tableReady) return null;
        const now = this.now();
        const transaction = this.db.transaction(() => {
            this.db.prepare(`
                UPDATE customer_addresses
                SET is_default = 0, updated_at = ?
                WHERE user_public_id = ?
            `).run(now, this.normalizeText(userPublicId));
            this.db.prepare(`
                UPDATE customer_addresses
                SET is_default = 1, updated_at = ?
                WHERE address_id = ? AND user_public_id = ?
            `).run(now, this.normalizeText(addressId), this.normalizeText(userPublicId));
        });
        transaction();
        return this.findOwned(userPublicId, addressId);
    }

    remove(userPublicId, addressId) {
        this.ensureTable();
        if (!this._tableReady) return { changes: 0 };
        const result = this.db.prepare(`
            DELETE FROM customer_addresses
            WHERE address_id = ? AND user_public_id = ?
        `).run(this.normalizeText(addressId), this.normalizeText(userPublicId));
        return { changes: Number(result.changes || 0) };
    }

    countByUser(userPublicId) {
        this.ensureTable();
        if (!this._tableReady) return 0;
        const row = this.db.prepare(
            'SELECT COUNT(*) AS total FROM customer_addresses WHERE user_public_id = ?'
        ).get(this.normalizeText(userPublicId));
        return Number(row?.total || 0);
    }
}

module.exports = new SQLiteCustomerAddressRepository();
