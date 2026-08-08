const SQLiteBaseRepository = require('./base.repository');

class SQLiteWishlistRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'wishlist_items' });
    }

    mapRow(row) {
        if (!row) {
            return null;
        }

        return {
            id: Number(row.id),
            userId: Number(row.user_id),
            productId: row.product_id ? Number(row.product_id) : null,
            productCatalogId: this.normalizeText(row.product_catalog_id),
            createdAt: row.created_at || null
        };
    }

    async listByUserId(userId) {
        return this.db.prepare(`
            SELECT * FROM wishlist_items
            WHERE user_id = ?
            ORDER BY created_at DESC, id DESC
        `).all(Number(userId)).map((row) => this.mapRow(row));
    }

    async findByUserAndCatalogId(userId, productCatalogId) {
        return this.mapRow(this.db.prepare(`
            SELECT * FROM wishlist_items
            WHERE user_id = ? AND product_catalog_id = ?
            LIMIT 1
        `).get(Number(userId), this.normalizeText(productCatalogId)));
    }

    async addItem(userId, { productId = null, productCatalogId }) {
        const catalogId = this.normalizeText(productCatalogId);
        if (!catalogId) {
            return null;
        }

        const now = this.now();
        try {
            this.db.prepare(`
                INSERT OR IGNORE INTO wishlist_items (user_id, product_id, product_catalog_id, created_at)
                VALUES (?, ?, ?, ?)
            `).run(
                Number(userId),
                productId ? Number(productId) : null,
                catalogId,
                now
            );
        } catch (_error) {
            // Fall through to read existing
        }

        return this.findByUserAndCatalogId(userId, catalogId);
    }

    async removeItem(userId, productCatalogId) {
        const result = this.db.prepare(`
            DELETE FROM wishlist_items
            WHERE user_id = ? AND product_catalog_id = ?
        `).run(Number(userId), this.normalizeText(productCatalogId));
        return Number(result.changes || 0) > 0;
    }

    async clearForUser(userId) {
        const result = this.db.prepare('DELETE FROM wishlist_items WHERE user_id = ?').run(Number(userId));
        return Number(result.changes || 0);
    }

    async countByUserId(userId) {
        const row = this.db.prepare('SELECT COUNT(*) AS total FROM wishlist_items WHERE user_id = ?').get(Number(userId));
        return Number(row?.total || 0);
    }
}

module.exports = new SQLiteWishlistRepository();
