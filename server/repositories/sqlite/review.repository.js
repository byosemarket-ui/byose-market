const SQLiteBaseRepository = require('./base.repository');

class SQLiteReviewRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'reviews' });
    }

    mapRow(row) {
        if (!row) {
            return null;
        }

        return {
            id: Number(row.id),
            publicId: this.normalizeText(row.public_id),
            productId: Number(row.product_id || 0) || null,
            userId: Number(row.user_id || 0) || null,
            rating: Number(row.rating || 0) || 0,
            title: this.normalizeText(row.title),
            body: this.normalizeText(row.body),
            status: this.normalizeText(row.status, 'pending'),
            meta: this.parseJson(row.meta_json, {}),
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || null
        };
    }

    async listForProduct(productId) {
        return this.db.prepare('SELECT * FROM reviews WHERE product_id = ? AND status = ? ORDER BY created_at DESC').all(Number(productId), 'published').map((row) => this.mapRow(row));
    }

    async create(review) {
        const now = this.now(review.createdAt);
        const result = this.db.prepare(`
            INSERT INTO reviews (
                public_id, product_id, user_id, rating, title, body, status, meta_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            this.normalizeText(review.publicId),
            review.productId ? Number(review.productId) : null,
            review.userId ? Number(review.userId) : null,
            this.toNumber(review.rating, 0),
            this.normalizeText(review.title),
            this.normalizeText(review.body),
            this.normalizeText(review.status, 'pending'),
            this.stringifyJson(review.meta || {}, {}),
            now,
            now
        );

        return this.mapRow(this.db.prepare('SELECT * FROM reviews WHERE id = ? LIMIT 1').get(result.lastInsertRowid));
    }
}

module.exports = new SQLiteReviewRepository();