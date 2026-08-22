const SQLiteBaseRepository = require('./base.repository');

class SQLiteCustomerNotificationRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'customer_notifications' });
    }

    mapNotification(row) {
        if (!row) return null;
        return {
            id: Number(row.id),
            userId: Number(row.user_id),
            type: this.normalizeText(row.type),
            title: this.normalizeText(row.title),
            body: this.normalizeText(row.body),
            deeplink: this.normalizeText(row.deeplink),
            entityType: this.normalizeText(row.entity_type),
            entityId: this.normalizeText(row.entity_id),
            dedupeKey: this.normalizeText(row.dedupe_key),
            createdAt: row.created_at || null,
            readAt: row.read_at || null,
            isRead: Boolean(row.read_at)
        };
    }

    mapPrefs(row, userId) {
        if (!row) {
            return {
                userId: Number(userId),
                orders: true,
                shipping: true,
                promo: true,
                system: true,
                updatedAt: null
            };
        }

        return {
            userId: Number(row.user_id),
            orders: Boolean(Number(row.orders)),
            shipping: Boolean(Number(row.shipping)),
            promo: Boolean(Number(row.promo)),
            system: true,
            updatedAt: row.updated_at || null
        };
    }

    async getPrefs(userId) {
        const row = this.db.prepare(`
            SELECT * FROM customer_notification_prefs WHERE user_id = ? LIMIT 1
        `).get(Number(userId));
        return this.mapPrefs(row, userId);
    }

    async upsertPrefs(userId, prefs = {}) {
        const existing = await this.getPrefs(userId);
        const next = {
            orders: prefs.orders != null ? Boolean(prefs.orders) : existing.orders,
            shipping: prefs.shipping != null ? Boolean(prefs.shipping) : existing.shipping,
            promo: prefs.promo != null ? Boolean(prefs.promo) : existing.promo,
            // Account/system alerts stay enabled for security and account reliability.
            system: true
        };
        const now = this.now();

        this.db.prepare(`
            INSERT INTO customer_notification_prefs (user_id, orders, shipping, promo, system, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                orders = excluded.orders,
                shipping = excluded.shipping,
                promo = excluded.promo,
                system = excluded.system,
                updated_at = excluded.updated_at
        `).run(
            Number(userId),
            next.orders ? 1 : 0,
            next.shipping ? 1 : 0,
            next.promo ? 1 : 0,
            next.system ? 1 : 0,
            now
        );

        return this.getPrefs(userId);
    }

    async findByDedupe(userId, dedupeKey) {
        const key = this.normalizeText(dedupeKey);
        if (!key) return null;
        return this.mapNotification(this.db.prepare(`
            SELECT * FROM customer_notifications
            WHERE user_id = ? AND dedupe_key = ?
            LIMIT 1
        `).get(Number(userId), key));
    }

    async create({
        userId,
        type,
        title,
        body = '',
        deeplink = '',
        entityType = '',
        entityId = '',
        dedupeKey = ''
    }) {
        const key = this.normalizeText(dedupeKey);
        if (key) {
            const existing = await this.findByDedupe(userId, key);
            if (existing) return existing;
        }

        try {
            const result = this.db.prepare(`
                INSERT INTO customer_notifications (
                    user_id, type, title, body, deeplink, entity_type, entity_id, dedupe_key, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                Number(userId),
                this.normalizeText(type),
                this.normalizeText(title),
                this.normalizeText(body),
                this.normalizeText(deeplink),
                this.normalizeText(entityType),
                this.normalizeText(entityId),
                key,
                this.now()
            );

            return this.mapNotification(this.db.prepare(`
                SELECT * FROM customer_notifications WHERE id = ? LIMIT 1
            `).get(Number(result.lastInsertRowid)));
        } catch (error) {
            if (String(error?.message || '').includes('UNIQUE') && key) {
                return this.findByDedupe(userId, key);
            }
            throw error;
        }
    }

    async listForUser(userId, { limit = 30, offset = 0 } = {}) {
        const safeLimit = Math.min(50, Math.max(1, Number(limit) || 30));
        const safeOffset = Math.max(0, Number(offset) || 0);
        return this.db.prepare(`
            SELECT * FROM customer_notifications
            WHERE user_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?
        `).all(Number(userId), safeLimit, safeOffset).map((row) => this.mapNotification(row));
    }

    async countForUser(userId) {
        const row = this.db.prepare(`
            SELECT COUNT(*) AS total FROM customer_notifications
            WHERE user_id = ?
        `).get(Number(userId));
        return Number(row?.total || 0);
    }

    async findForUser(userId, notificationId) {
        return this.mapNotification(this.db.prepare(`
            SELECT * FROM customer_notifications
            WHERE user_id = ? AND id = ?
            LIMIT 1
        `).get(Number(userId), Number(notificationId)));
    }

    async countUnread(userId) {
        const row = this.db.prepare(`
            SELECT COUNT(*) AS total FROM customer_notifications
            WHERE user_id = ? AND read_at IS NULL
        `).get(Number(userId));
        return Number(row?.total || 0);
    }

    async markRead(userId, notificationId) {
        this.db.prepare(`
            UPDATE customer_notifications
            SET read_at = ?
            WHERE id = ? AND user_id = ? AND read_at IS NULL
        `).run(this.now(), Number(notificationId), Number(userId));
        return true;
    }

    async markAllRead(userId) {
        this.db.prepare(`
            UPDATE customer_notifications
            SET read_at = ?
            WHERE user_id = ? AND read_at IS NULL
        `).run(this.now(), Number(userId));
        return true;
    }
}

module.exports = new SQLiteCustomerNotificationRepository();
