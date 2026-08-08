const SQLiteBaseRepository = require('./base.repository');

class SQLiteCouponRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'coupons' });
    }

    mapCoupon(row) {
        if (!row) {
            return null;
        }

        return {
            id: Number(row.id),
            code: this.normalizeText(row.code).toUpperCase(),
            title: this.normalizeText(row.title),
            description: this.normalizeText(row.description),
            discountType: this.normalizeText(row.discount_type, 'percent'),
            discountValue: this.toNumber(row.discount_value, 0),
            minOrderAmount: this.toNumber(row.min_order_amount, 0),
            maxDiscountAmount: this.toNumber(row.max_discount_amount, 0),
            startsAt: row.starts_at || null,
            expiresAt: row.expires_at || null,
            usageLimit: this.toNumber(row.usage_limit, 0),
            usageCount: this.toNumber(row.usage_count, 0),
            perUserLimit: this.toNumber(row.per_user_limit, 1),
            status: this.normalizeText(row.status, 'active'),
            metadata: this.parseJson(row.metadata_json, {}),
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || null
        };
    }

    mapCustomerCoupon(row) {
        if (!row) {
            return null;
        }

        return {
            id: Number(row.id),
            userId: Number(row.user_id),
            couponId: Number(row.coupon_id),
            status: this.normalizeText(row.status, 'available'),
            assignedAt: row.assigned_at || null,
            usedAt: row.used_at || null,
            orderId: this.normalizeText(row.order_id),
            coupon: row.code ? this.mapCoupon({
                id: row.coupon_id,
                code: row.code,
                title: row.title,
                description: row.description,
                discount_type: row.discount_type,
                discount_value: row.discount_value,
                min_order_amount: row.min_order_amount,
                max_discount_amount: row.max_discount_amount,
                starts_at: row.starts_at,
                expires_at: row.expires_at,
                usage_limit: row.usage_limit,
                usage_count: row.usage_count,
                per_user_limit: row.per_user_limit,
                status: row.coupon_status,
                metadata_json: row.metadata_json,
                created_at: row.coupon_created_at,
                updated_at: row.coupon_updated_at
            }) : null
        };
    }

    async findByCode(code) {
        return this.mapCoupon(this.db.prepare(`
            SELECT * FROM coupons WHERE UPPER(code) = UPPER(?) LIMIT 1
        `).get(this.normalizeText(code)));
    }

    async findById(couponId) {
        return this.mapCoupon(this.db.prepare('SELECT * FROM coupons WHERE id = ? LIMIT 1').get(Number(couponId)));
    }

    async listActivePublic() {
        const now = this.now();
        return this.db.prepare(`
            SELECT * FROM coupons
            WHERE status = 'active'
              AND (starts_at IS NULL OR starts_at <= ?)
              AND (expires_at IS NULL OR expires_at >= ?)
              AND (usage_limit = 0 OR usage_count < usage_limit)
            ORDER BY expires_at ASC, id ASC
        `).all(now, now).map((row) => this.mapCoupon(row));
    }

    async hasRedemptionForOrder(orderId) {
        const row = this.db.prepare(`
            SELECT id FROM coupon_redemptions WHERE order_id = ? LIMIT 1
        `).get(this.normalizeText(orderId));
        return Boolean(row);
    }

    async listCustomerCoupons(userId, { status = null } = {}) {
        const params = [Number(userId)];
        let statusFilter = '';
        if (status && status !== 'all') {
            statusFilter = ' AND cc.status = ?';
            params.push(this.normalizeText(status));
        }

        return this.db.prepare(`
            SELECT
                cc.*,
                c.code,
                c.title,
                c.description,
                c.discount_type,
                c.discount_value,
                c.min_order_amount,
                c.max_discount_amount,
                c.starts_at,
                c.expires_at,
                c.usage_limit,
                c.usage_count,
                c.per_user_limit,
                c.status AS coupon_status,
                c.metadata_json,
                c.created_at AS coupon_created_at,
                c.updated_at AS coupon_updated_at
            FROM customer_coupons cc
            INNER JOIN coupons c ON c.id = cc.coupon_id
            WHERE cc.user_id = ?${statusFilter}
            ORDER BY cc.assigned_at DESC, cc.id DESC
        `).all(...params).map((row) => this.mapCustomerCoupon(row));
    }

    async findCustomerCoupon(userId, couponId) {
        return this.mapCustomerCoupon(this.db.prepare(`
            SELECT
                cc.*,
                c.code,
                c.title,
                c.description,
                c.discount_type,
                c.discount_value,
                c.min_order_amount,
                c.max_discount_amount,
                c.starts_at,
                c.expires_at,
                c.usage_limit,
                c.usage_count,
                c.per_user_limit,
                c.status AS coupon_status,
                c.metadata_json,
                c.created_at AS coupon_created_at,
                c.updated_at AS coupon_updated_at
            FROM customer_coupons cc
            INNER JOIN coupons c ON c.id = cc.coupon_id
            WHERE cc.user_id = ? AND cc.coupon_id = ?
            LIMIT 1
        `).get(Number(userId), Number(couponId)));
    }

    async assignToUser(userId, couponId, { status = 'available' } = {}) {
        const existing = await this.findCustomerCoupon(userId, couponId);
        if (existing) {
            return existing;
        }

        const now = this.now();
        try {
            this.db.prepare(`
                INSERT OR IGNORE INTO customer_coupons (user_id, coupon_id, status, assigned_at)
                VALUES (?, ?, ?, ?)
            `).run(Number(userId), Number(couponId), this.normalizeText(status, 'available'), now);
        } catch (_error) {
            // Concurrent assign — fall through to read
        }

        return this.findCustomerCoupon(userId, couponId);
    }

    async markCustomerCouponUsed(userId, couponId, { orderId = '', usedAt = null } = {}) {
        const now = this.now(usedAt);
        this.db.prepare(`
            UPDATE customer_coupons
            SET status = 'used', used_at = ?, order_id = ?
            WHERE user_id = ? AND coupon_id = ?
        `).run(now, this.normalizeText(orderId), Number(userId), Number(couponId));
        return this.findCustomerCoupon(userId, couponId);
    }

    async markExpiredForUser(userId) {
        const now = this.now();
        this.db.prepare(`
            UPDATE customer_coupons
            SET status = 'expired'
            WHERE user_id = ?
              AND status = 'available'
              AND coupon_id IN (
                SELECT id FROM coupons
                WHERE (expires_at IS NOT NULL AND expires_at < ?)
                   OR status = 'inactive'
              )
        `).run(Number(userId), now);
    }

    async incrementUsage(couponId) {
        const now = this.now();
        const result = this.db.prepare(`
            UPDATE coupons
            SET usage_count = usage_count + 1, updated_at = ?
            WHERE id = ?
              AND (usage_limit = 0 OR usage_count < usage_limit)
        `).run(now, Number(couponId));
        if (!Number(result.changes || 0)) {
            return null;
        }
        return this.findById(couponId);
    }

    async decrementUsage(couponId) {
        const now = this.now();
        this.db.prepare(`
            UPDATE coupons
            SET usage_count = CASE WHEN usage_count > 0 THEN usage_count - 1 ELSE 0 END,
                updated_at = ?
            WHERE id = ?
        `).run(now, Number(couponId));
        return this.findById(couponId);
    }

    async findRedemptionByOrderId(orderId) {
        const row = this.db.prepare(`
            SELECT * FROM coupon_redemptions WHERE order_id = ? LIMIT 1
        `).get(this.normalizeText(orderId));
        if (!row) return null;
        return {
            id: Number(row.id),
            userId: Number(row.user_id),
            couponId: Number(row.coupon_id),
            orderId: this.normalizeText(row.order_id),
            discountAmount: this.toNumber(row.discount_amount, 0),
            redeemedAt: row.redeemed_at || null
        };
    }

    async createRedemption({ userId, couponId, orderId = '', discountAmount = 0 }) {
        const now = this.now();
        const result = this.db.prepare(`
            INSERT INTO coupon_redemptions (user_id, coupon_id, order_id, discount_amount, redeemed_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            Number(userId),
            Number(couponId),
            this.normalizeText(orderId),
            this.toNumber(discountAmount, 0),
            now
        );

        return {
            id: Number(result.lastInsertRowid),
            userId: Number(userId),
            couponId: Number(couponId),
            orderId: this.normalizeText(orderId),
            discountAmount: this.toNumber(discountAmount, 0),
            redeemedAt: now
        };
    }

    async markCustomerCouponAvailable(userId, couponId) {
        this.db.prepare(`
            UPDATE customer_coupons
            SET status = 'available', used_at = NULL, order_id = ''
            WHERE user_id = ? AND coupon_id = ? AND status = 'used'
        `).run(Number(userId), Number(couponId));
        return this.findCustomerCoupon(userId, couponId);
    }

    /**
     * Atomic redeem: redemption row + mark used + usage increment with limit guard.
     */
    async redeemForOrderAtomic({ userId, couponId, orderId, discountAmount = 0 }) {
        const normalizedOrderId = this.normalizeText(orderId);
        const txn = this.db.transaction(() => {
            const existing = this.db.prepare(`
                SELECT id FROM coupon_redemptions WHERE order_id = ? LIMIT 1
            `).get(normalizedOrderId);
            if (existing) {
                return { alreadyRedeemed: true, couponId: Number(couponId) };
            }

            const usage = this.db.prepare(`
                UPDATE coupons
                SET usage_count = usage_count + 1, updated_at = ?
                WHERE id = ?
                  AND (usage_limit = 0 OR usage_count < usage_limit)
            `).run(this.now(), Number(couponId));

            if (!Number(usage.changes || 0)) {
                const err = new Error('Coupon usage limit reached.');
                err.code = 'COUPON_USAGE_LIMIT';
                throw err;
            }

            this.db.prepare(`
                INSERT INTO coupon_redemptions (user_id, coupon_id, order_id, discount_amount, redeemed_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                Number(userId),
                Number(couponId),
                normalizedOrderId,
                this.toNumber(discountAmount, 0),
                this.now()
            );

            this.db.prepare(`
                UPDATE customer_coupons
                SET status = 'used', used_at = ?, order_id = ?
                WHERE user_id = ? AND coupon_id = ?
            `).run(this.now(), normalizedOrderId, Number(userId), Number(couponId));

            return { alreadyRedeemed: false, couponId: Number(couponId) };
        });

        return txn();
    }

    async releaseRedemptionForOrder(orderId) {
        const normalizedOrderId = this.normalizeText(orderId);
        if (!normalizedOrderId) return null;

        const txn = this.db.transaction(() => {
            const row = this.db.prepare(`
                SELECT * FROM coupon_redemptions WHERE order_id = ? LIMIT 1
            `).get(normalizedOrderId);
            if (!row) return null;

            this.db.prepare('DELETE FROM coupon_redemptions WHERE id = ?').run(Number(row.id));
            this.db.prepare(`
                UPDATE customer_coupons
                SET status = 'available', used_at = NULL, order_id = ''
                WHERE user_id = ? AND coupon_id = ? AND order_id = ?
            `).run(Number(row.user_id), Number(row.coupon_id), normalizedOrderId);
            this.db.prepare(`
                UPDATE coupons
                SET usage_count = CASE WHEN usage_count > 0 THEN usage_count - 1 ELSE 0 END,
                    updated_at = ?
                WHERE id = ?
            `).run(this.now(), Number(row.coupon_id));

            return {
                id: Number(row.id),
                userId: Number(row.user_id),
                couponId: Number(row.coupon_id),
                orderId: normalizedOrderId
            };
        });

        return txn();
    }

    async countCustomerRedemptions(userId, couponId) {
        const row = this.db.prepare(`
            SELECT COUNT(*) AS total FROM coupon_redemptions
            WHERE user_id = ? AND coupon_id = ?
        `).get(Number(userId), Number(couponId));
        return Number(row?.total || 0);
    }

    async countByUserAndStatus(userId, status) {
        const row = this.db.prepare(`
            SELECT COUNT(*) AS total FROM customer_coupons
            WHERE user_id = ? AND status = ?
        `).get(Number(userId), this.normalizeText(status));
        return Number(row?.total || 0);
    }
}

module.exports = new SQLiteCouponRepository();
