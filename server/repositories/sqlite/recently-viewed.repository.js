const SQLiteBaseRepository = require('./base.repository');

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

class SQLiteRecentlyViewedRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'recently_viewed_products' });
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
            viewedAt: row.viewed_at || null
        };
    }

    async listByUserId(userId, { limit = DEFAULT_LIMIT } = {}) {
        const safeLimit = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || DEFAULT_LIMIT));
        return this.db.prepare(`
            SELECT * FROM recently_viewed_products
            WHERE user_id = ?
            ORDER BY viewed_at DESC, id DESC
            LIMIT ?
        `).all(Number(userId), safeLimit).map((row) => this.mapRow(row));
    }

    async findByUserAndCatalogId(userId, productCatalogId) {
        return this.mapRow(this.db.prepare(`
            SELECT * FROM recently_viewed_products
            WHERE user_id = ? AND product_catalog_id = ?
            LIMIT 1
        `).get(Number(userId), this.normalizeText(productCatalogId)));
    }

    async upsertView(userId, { productId = null, productCatalogId, viewedAt = null }) {
        const catalogId = this.normalizeText(productCatalogId);
        if (!catalogId) {
            return null;
        }

        const now = this.now(viewedAt);
        this.db.prepare(`
            INSERT INTO recently_viewed_products (user_id, product_id, product_catalog_id, viewed_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, product_catalog_id) DO UPDATE SET
                product_id = excluded.product_id,
                viewed_at = excluded.viewed_at
        `).run(
            Number(userId),
            productId ? Number(productId) : null,
            catalogId,
            now
        );

        return this.mapRow(this.db.prepare(`
            SELECT * FROM recently_viewed_products
            WHERE user_id = ? AND product_catalog_id = ?
            LIMIT 1
        `).get(Number(userId), catalogId));
    }

    async removeItem(userId, productCatalogId) {
        const result = this.db.prepare(`
            DELETE FROM recently_viewed_products
            WHERE user_id = ? AND product_catalog_id = ?
        `).run(Number(userId), this.normalizeText(productCatalogId));
        return Number(result.changes || 0) > 0;
    }

    async clearForUser(userId) {
        const result = this.db.prepare('DELETE FROM recently_viewed_products WHERE user_id = ?').run(Number(userId));
        return Number(result.changes || 0);
    }

    async trimForUser(userId, keep = DEFAULT_LIMIT) {
        const safeKeep = Math.min(MAX_LIMIT, Math.max(1, Number(keep) || DEFAULT_LIMIT));
        this.db.prepare(`
            DELETE FROM recently_viewed_products
            WHERE user_id = ?
              AND id NOT IN (
                SELECT id FROM recently_viewed_products
                WHERE user_id = ?
                ORDER BY viewed_at DESC, id DESC
                LIMIT ?
              )
        `).run(Number(userId), Number(userId), safeKeep);
    }

    async countByUserId(userId) {
        const row = this.db.prepare('SELECT COUNT(*) AS total FROM recently_viewed_products WHERE user_id = ?').get(Number(userId));
        return Number(row?.total || 0);
    }
}

module.exports = new SQLiteRecentlyViewedRepository();
