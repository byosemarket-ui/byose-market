const SQLiteBaseRepository = require('./base.repository');

class SQLiteStorefrontStateRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'storefront_states' });
    }

    mapRow(row) {
        if (!row) {
            return null;
        }

        return {
            id: Number(row.id),
            userId: Number(row.user_id),
            userPublicId: this.normalizeText(row.user_public_id),
            email: this.normalizeText(row.email).toLowerCase(),
            phone: this.normalizeText(row.phone),
            cartItems: this.parseJson(row.cart_items_json, []),
            savedItems: this.parseJson(row.saved_items_json, []),
            directCheckout: this.parseJson(row.direct_checkout_json, null),
            checkoutDraft: this.parseJson(row.checkout_draft_json, null),
            checkoutConfirmation: this.parseJson(row.checkout_confirmation_json, null),
            lastCartSyncedAt: row.last_cart_synced_at || null,
            lastDraftSyncedAt: row.last_draft_synced_at || null,
            lastCheckoutSyncedAt: row.last_checkout_synced_at || null,
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || null
        };
    }

    async findByUserId(userId) {
        return this.mapRow(this.db.prepare('SELECT * FROM storefront_states WHERE user_id = ? LIMIT 1').get(Number(userId)));
    }

    async upsert(payload) {
        const existing = await this.findByUserId(payload.userId);
        const now = this.now();
        const values = {
            userId: Number(payload.userId),
            userPublicId: this.normalizeText(payload.userPublicId),
            email: this.normalizeText(payload.email).toLowerCase(),
            phone: this.normalizeText(payload.phone),
            cartItems: this.stringifyJson(payload.cartItems || [], []),
            savedItems: this.stringifyJson(payload.savedItems || [], []),
            directCheckout: this.stringifyJson(payload.directCheckout ?? null, null),
            checkoutDraft: this.stringifyJson(payload.checkoutDraft ?? null, null),
            checkoutConfirmation: this.stringifyJson(payload.checkoutConfirmation ?? null, null),
            lastCartSyncedAt: payload.lastCartSyncedAt || null,
            lastDraftSyncedAt: payload.lastDraftSyncedAt || null,
            lastCheckoutSyncedAt: payload.lastCheckoutSyncedAt || null,
            updatedAt: now
        };

        if (existing) {
            this.db.prepare(`
                UPDATE storefront_states
                SET user_public_id = ?, email = ?, phone = ?, cart_items_json = ?, saved_items_json = ?, direct_checkout_json = ?, checkout_draft_json = ?, checkout_confirmation_json = ?,
                    last_cart_synced_at = ?, last_draft_synced_at = ?, last_checkout_synced_at = ?, updated_at = ?
                WHERE user_id = ?
            `).run(
                values.userPublicId,
                values.email,
                values.phone,
                values.cartItems,
                values.savedItems,
                values.directCheckout,
                values.checkoutDraft,
                values.checkoutConfirmation,
                values.lastCartSyncedAt,
                values.lastDraftSyncedAt,
                values.lastCheckoutSyncedAt,
                values.updatedAt,
                values.userId
            );
        } else {
            this.db.prepare(`
                INSERT INTO storefront_states (
                    user_id, user_public_id, email, phone, cart_items_json, saved_items_json, direct_checkout_json, checkout_draft_json, checkout_confirmation_json,
                    last_cart_synced_at, last_draft_synced_at, last_checkout_synced_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                values.userId,
                values.userPublicId,
                values.email,
                values.phone,
                values.cartItems,
                values.savedItems,
                values.directCheckout,
                values.checkoutDraft,
                values.checkoutConfirmation,
                values.lastCartSyncedAt,
                values.lastDraftSyncedAt,
                values.lastCheckoutSyncedAt,
                now,
                now
            );
        }

        return this.findByUserId(values.userId);
    }
}

module.exports = new SQLiteStorefrontStateRepository();