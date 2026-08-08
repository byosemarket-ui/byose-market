const SQLiteBaseRepository = require('./base.repository');

class SQLiteStoreRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'stores' });
    }

    mapStore(row) {
        if (!row) {
            return null;
        }

        return {
            id: Number(row.id),
            publicId: this.normalizeText(row.public_id),
            name: this.normalizeText(row.name),
            slug: this.normalizeText(row.slug),
            description: this.normalizeText(row.description),
            logo: this.normalizeText(row.logo),
            banner: this.normalizeText(row.banner),
            status: this.normalizeText(row.status, 'active'),
            category: this.normalizeText(row.category, 'Marketplace'),
            location: this.normalizeText(row.location),
            rating: this.toNumber(row.rating, 0),
            reviewCount: this.toNumber(row.review_count, 0),
            metadata: this.parseJson(row.metadata_json, {}),
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || null
        };
    }

    mapFavorite(row) {
        if (!row) {
            return null;
        }

        return {
            id: Number(row.id),
            userId: Number(row.user_id),
            storeId: Number(row.store_id),
            createdAt: row.created_at || null,
            notifyNewProducts: this.normalizeBoolean(row.notify_new_products != null ? row.notify_new_products : 1),
            notifyOffers: this.normalizeBoolean(row.notify_offers != null ? row.notify_offers : 1),
            notifyAnnouncements: this.normalizeBoolean(row.notify_announcements != null ? row.notify_announcements : 1),
            store: row.store_public_id ? this.mapStore({
                id: row.store_id,
                public_id: row.store_public_id,
                name: row.store_name,
                slug: row.store_slug,
                description: row.store_description,
                logo: row.store_logo,
                banner: row.store_banner,
                status: row.store_status,
                category: row.store_category,
                location: row.store_location,
                rating: row.store_rating,
                review_count: row.store_review_count,
                metadata_json: row.store_metadata_json,
                created_at: row.store_created_at,
                updated_at: row.store_updated_at
            }) : null
        };
    }

    async findById(storeId) {
        return this.mapStore(this.db.prepare('SELECT * FROM stores WHERE id = ? LIMIT 1').get(Number(storeId)));
    }

    async findByPublicIdOrSlug(identifier) {
        const value = this.normalizeText(identifier);
        if (!value) {
            return null;
        }

        return this.mapStore(this.db.prepare(`
            SELECT * FROM stores
            WHERE public_id = ? OR slug = ? OR CAST(id AS TEXT) = ?
            LIMIT 1
        `).get(value, value, value));
    }

    async listActive() {
        return this.db.prepare(`
            SELECT * FROM stores
            WHERE status = 'active'
            ORDER BY name ASC, id ASC
        `).all().map((row) => this.mapStore(row));
    }

    async countFollowers(storeId) {
        const row = this.db.prepare('SELECT COUNT(*) AS total FROM favorite_stores WHERE store_id = ?').get(Number(storeId));
        return Number(row?.total || 0);
    }

    async listFavoritesByUserId(userId) {
        return this.db.prepare(`
            SELECT
                fs.*,
                s.public_id AS store_public_id,
                s.name AS store_name,
                s.slug AS store_slug,
                s.description AS store_description,
                s.logo AS store_logo,
                s.banner AS store_banner,
                s.status AS store_status,
                s.category AS store_category,
                s.location AS store_location,
                s.rating AS store_rating,
                s.review_count AS store_review_count,
                s.metadata_json AS store_metadata_json,
                s.created_at AS store_created_at,
                s.updated_at AS store_updated_at
            FROM favorite_stores fs
            INNER JOIN stores s ON s.id = fs.store_id
            WHERE fs.user_id = ?
            ORDER BY fs.created_at DESC, fs.id DESC
        `).all(Number(userId)).map((row) => this.mapFavorite(row));
    }

    async findFavorite(userId, storeId) {
        return this.mapFavorite(this.db.prepare(`
            SELECT
                fs.*,
                s.public_id AS store_public_id,
                s.name AS store_name,
                s.slug AS store_slug,
                s.description AS store_description,
                s.logo AS store_logo,
                s.banner AS store_banner,
                s.status AS store_status,
                s.category AS store_category,
                s.location AS store_location,
                s.rating AS store_rating,
                s.review_count AS store_review_count,
                s.metadata_json AS store_metadata_json,
                s.created_at AS store_created_at,
                s.updated_at AS store_updated_at
            FROM favorite_stores fs
            INNER JOIN stores s ON s.id = fs.store_id
            WHERE fs.user_id = ? AND fs.store_id = ?
            LIMIT 1
        `).get(Number(userId), Number(storeId)));
    }

    async follow(userId, storeId) {
        const now = this.now();
        try {
            this.db.prepare(`
                INSERT OR IGNORE INTO favorite_stores (
                    user_id, store_id, created_at, notify_new_products, notify_offers, notify_announcements
                ) VALUES (?, ?, ?, 1, 1, 1)
            `).run(Number(userId), Number(storeId), now);
        } catch (_error) {
            // Fall through to read existing
        }

        return this.findFavorite(userId, storeId);
    }

    async unfollow(userId, storeId) {
        const result = this.db.prepare(`
            DELETE FROM favorite_stores
            WHERE user_id = ? AND store_id = ?
        `).run(Number(userId), Number(storeId));
        return Number(result.changes || 0) > 0;
    }

    async updateNotificationPrefs(userId, storeId, prefs = {}) {
        const existing = await this.findFavorite(userId, storeId);
        if (!existing) {
            return null;
        }

        const notifyNewProducts = prefs.notifyNewProducts != null
            ? (prefs.notifyNewProducts ? 1 : 0)
            : (existing.notifyNewProducts ? 1 : 0);
        const notifyOffers = prefs.notifyOffers != null
            ? (prefs.notifyOffers ? 1 : 0)
            : (existing.notifyOffers ? 1 : 0);
        const notifyAnnouncements = prefs.notifyAnnouncements != null
            ? (prefs.notifyAnnouncements ? 1 : 0)
            : (existing.notifyAnnouncements ? 1 : 0);

        this.db.prepare(`
            UPDATE favorite_stores
            SET notify_new_products = ?, notify_offers = ?, notify_announcements = ?
            WHERE user_id = ? AND store_id = ?
        `).run(notifyNewProducts, notifyOffers, notifyAnnouncements, Number(userId), Number(storeId));

        return this.findFavorite(userId, storeId);
    }

    async countFavoritesByUserId(userId) {
        const row = this.db.prepare('SELECT COUNT(*) AS total FROM favorite_stores WHERE user_id = ?').get(Number(userId));
        return Number(row?.total || 0);
    }
}

module.exports = new SQLiteStoreRepository();
