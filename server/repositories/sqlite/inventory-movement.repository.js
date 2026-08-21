const SQLiteBaseRepository = require('./base.repository');

class SQLiteInventoryMovementRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'inventory_movements' });
        this._tableReady = false;
    }

    ensureTable() {
        if (this._tableReady) return;
        try {
            const row = this.db.prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'inventory_movements' LIMIT 1"
            ).get();
            this._tableReady = Boolean(row);
        } catch (_error) {
            this._tableReady = false;
        }
    }

    insert(movement = {}) {
        this.ensureTable();
        if (!this._tableReady) return null;

        const result = this.db.prepare(`
            INSERT INTO inventory_movements (
                product_id, catalog_id, product_name, sku, variant_key, color, size, order_id, payment_status,
                movement_type, quantity_before, quantity_changed, quantity_after, reserved_before, reserved_changed,
                reserved_after, reason, reference_id, metadata_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            movement.productId ? Number(movement.productId) : null,
            this.normalizeText(movement.catalogId),
            this.normalizeText(movement.productName),
            this.normalizeText(movement.sku),
            this.normalizeText(movement.variantKey),
            this.normalizeText(movement.color),
            this.normalizeText(movement.size),
            this.normalizeText(movement.orderId),
            this.normalizeText(movement.paymentStatus),
            this.normalizeText(movement.movementType || movement.reason, 'adjustment'),
            Math.trunc(this.toNumber(movement.quantityBefore, 0)),
            Math.trunc(this.toNumber(movement.quantityChanged, 0)),
            Math.trunc(this.toNumber(movement.quantityAfter, 0)),
            Math.trunc(this.toNumber(movement.reservedBefore, 0)),
            Math.trunc(this.toNumber(movement.reservedChanged, 0)),
            Math.trunc(this.toNumber(movement.reservedAfter, 0)),
            this.normalizeText(movement.reason || movement.movementType),
            this.normalizeText(movement.referenceId || movement.orderId),
            this.stringifyJson(movement.metadata || {}, {}),
            this.now(movement.createdAt)
        );

        return Number(result.lastInsertRowid);
    }

    listByOrderId(orderId, limit = 50) {
        this.ensureTable();
        if (!this._tableReady) return [];
        return this.db.prepare(`
            SELECT * FROM inventory_movements
            WHERE order_id = ?
            ORDER BY id DESC
            LIMIT ?
        `).all(this.normalizeText(orderId), Math.max(1, Math.min(200, Number(limit) || 50)));
    }
}

module.exports = new SQLiteInventoryMovementRepository();
