const SQLiteBaseRepository = require('./base.repository');

const FALLBACK_DELIVERY_FEE = 2000;
const FALLBACK_COD_FEE = 0;

class SQLiteOrderRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'orders' });
    }

    mapOrderRow(row, items = []) {
        if (!row) {
            return null;
        }

        const normalizedItems = items.map((item) => {
            const attrs = this.parseJson(item.attributes_json, {});
            return {
                productId: this.normalizeText(item.product_catalog_id),
                productName: this.normalizeText(item.product_name),
                quantity: this.toNumber(item.quantity, 1),
                price: this.toNumber(item.price, 0),
                image: this.normalizeText(item.image),
                attributes: attrs,
                color: this.normalizeText(item.color),
                size: this.normalizeText(item.size),
                colorImage: this.normalizeText(attrs.colorImage),
                colorName: this.normalizeText(item.color),
                sizeLabel: this.normalizeText(item.size),
                sku: this.normalizeText(attrs.SKU || attrs.sku),
                category: this.normalizeText(attrs.Category || attrs.category),
                productUrl: this.normalizeText(attrs.productUrl || attrs.productLink),
                productLink: this.normalizeText(attrs.productUrl || attrs.productLink),
                attributeSummary: this.normalizeText(attrs.attributeSummary)
            };
        });

        const subtotal = this.toNumber(row.subtotal, 0);
        const shippingFee = this.toNumber(row.shipping_fee != null ? row.shipping_fee : row.delivery_fee, FALLBACK_DELIVERY_FEE);
        const deliveryFee = this.toNumber(row.delivery_fee != null ? row.delivery_fee : row.shipping_fee, shippingFee);
        const codFee = this.toNumber(row.cod_fee, FALLBACK_COD_FEE);
        const total = this.toNumber(row.total_amount, subtotal + deliveryFee + codFee);

        return {
            id: this.normalizeText(row.legacy_id || row.order_id),
            orderId: this.normalizeText(row.order_id),
            userId: this.normalizeText(row.user_public_id),
            accountId: this.normalizeText(row.account_id),
            customerId: this.normalizeText(row.customer_id),
            isGuest: Boolean(row.is_guest),
            userEmail: this.normalizeText(row.user_email),
            customerEmail: this.normalizeText(row.customer_email),
            customerPhone: this.normalizeText(row.customer_phone),
            phoneNumber: this.normalizeText(row.phone_number),
            customerName: this.normalizeText(row.customer_name),
            customerImage: this.normalizeText(row.customer_image),
            subtotal,
            shippingFee,
            deliveryFee,
            codFee,
            totalAmount: total,
            totalPrice: total,
            total,
            status: this.normalizeText(row.status, 'Pending'),
            orderStatus: this.normalizeText(row.order_status, 'pending'),
            paymentStatus: this.normalizeText(row.payment_status, 'pending'),
            paymentStatusLabel: this.normalizeText(row.payment_status_label),
            paymentMethod: this.normalizeText(row.payment_method),
            paymentType: this.normalizeText(row.payment_type),
            note: this.normalizeText(row.note),
            payment: this.parseJson(row.payment_json, {}),
            customer: this.parseJson(row.customer_json, {}),
            shippingAddress: this.parseJson(row.shipping_address_json, {}),
            fullAddress: this.parseJson(row.full_address_json, {}),
            gpsLocation: this.parseJson(row.gps_location_json, {}),
            deliveryMethod: this.normalizeText(row.delivery_method),
            deliveryLabel: this.normalizeText(row.delivery_label),
            statusHistory: this.parseJson(row.status_history_json, []),
            items: normalizedItems,
            products: normalizedItems,
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || null,
            recordId: Number(row.id)
        };
    }

    loadItems(orderIds) {
        if (!Array.isArray(orderIds) || !orderIds.length) {
            return new Map();
        }

        const placeholders = orderIds.map(() => '?').join(', ');
        const rows = this.db.prepare(`SELECT * FROM order_items WHERE order_id IN (${placeholders}) ORDER BY sort_order ASC, id ASC`).all(...orderIds);
        return rows.reduce((lookup, row) => {
            const key = Number(row.order_id);
            const current = lookup.get(key) || [];
            current.push(row);
            lookup.set(key, current);
            return lookup;
        }, new Map());
    }

    async findByIdentifier(identifier) {
        const normalized = this.normalizeText(identifier);
        const row = this.db.prepare('SELECT * FROM orders WHERE order_id = ? OR legacy_id = ? OR id = ? LIMIT 1').get(normalized, normalized, Number(identifier) || 0);
        if (!row) {
            return null;
        }

        const items = this.db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY sort_order ASC, id ASC').all(Number(row.id));
        return this.mapOrderRow(row, items);
    }

    async create(order) {
        const now = this.now(order.createdAt);
        const shippingFee = Math.max(0, this.toNumber(order.shippingFee != null ? order.shippingFee : order.deliveryFee, FALLBACK_DELIVERY_FEE));
        const deliveryFee = Math.max(0, this.toNumber(order.deliveryFee != null ? order.deliveryFee : order.shippingFee, shippingFee));
        const codFee = Math.max(0, this.toNumber(order.codFee, FALLBACK_COD_FEE));
        const subtotal = this.toNumber(order.subtotal, 0);
        const totalAmount = Math.max(0, this.toNumber(order.totalAmount != null ? order.totalAmount : order.total, subtotal + deliveryFee + codFee));
        const payload = {
            orderId: this.normalizeText(order.orderId),
            legacyId: this.normalizeText(order.id || order.orderId),
            userId: order.userRecordId ? Number(order.userRecordId) : null,
            userPublicId: this.normalizeText(order.userId),
            accountId: this.normalizeText(order.accountId),
            customerId: this.normalizeText(order.customerId),
            isGuest: this.normalizeBoolean(order.isGuest),
            userEmail: this.normalizeText(order.userEmail).toLowerCase(),
            customerEmail: this.normalizeText(order.customerEmail).toLowerCase(),
            customerPhone: this.normalizeText(order.customerPhone),
            phoneNumber: this.normalizeText(order.phoneNumber),
            customerName: this.normalizeText(order.customerName),
            customerImage: this.normalizeText(order.customerImage),
            subtotal,
            shippingFee,
            deliveryFee,
            codFee,
            totalAmount,
            totalPrice: totalAmount,
            status: this.normalizeText(order.status, 'Pending'),
            orderStatus: this.normalizeText(order.orderStatus, 'pending'),
            paymentStatus: this.normalizeText(order.paymentStatus, 'pending'),
            paymentStatusLabel: this.normalizeText(order.paymentStatusLabel),
            paymentMethod: this.normalizeText(order.paymentMethod),
            paymentType: this.normalizeText(order.paymentType),
            note: this.normalizeText(order.note),
            paymentJson: this.stringifyJson(order.payment || {}, {}),
            customerJson: this.stringifyJson(order.customer || {}, {}),
            shippingAddressJson: this.stringifyJson(order.shippingAddress || {}, {}),
            fullAddressJson: this.stringifyJson(order.fullAddress || {}, {}),
            gpsLocationJson: this.stringifyJson(order.gpsLocation || {}, {}),
            deliveryMethod: this.normalizeText(order.deliveryMethod),
            deliveryLabel: this.normalizeText(order.deliveryLabel),
            statusHistoryJson: this.stringifyJson(order.statusHistory || [], []),
            createdAt: now,
            updatedAt: this.now(order.updatedAt || now)
        };

        const transaction = this.db.transaction(() => {
            const productRepository = require('./product.repository');
            productRepository.decrementStockForOrderItems(Array.isArray(order.items) ? order.items : []);

            const result = this.db.prepare(`
                INSERT INTO orders (
                    order_id, legacy_id, user_id, user_public_id, account_id, customer_id, is_guest, user_email, customer_email, customer_phone, phone_number,
                    customer_name, customer_image, subtotal, shipping_fee, delivery_fee, cod_fee, total_amount, total_price, status, order_status,
                    payment_status, payment_status_label, payment_method, payment_type, note, payment_json, customer_json, shipping_address_json,
                    full_address_json, gps_location_json, delivery_method, delivery_label, status_history_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                payload.orderId,
                payload.legacyId,
                payload.userId,
                payload.userPublicId,
                payload.accountId,
                payload.customerId,
                payload.isGuest,
                payload.userEmail,
                payload.customerEmail,
                payload.customerPhone,
                payload.phoneNumber,
                payload.customerName,
                payload.customerImage,
                payload.subtotal,
                payload.shippingFee,
                payload.deliveryFee,
                payload.codFee,
                payload.totalAmount,
                payload.totalPrice,
                payload.status,
                payload.orderStatus,
                payload.paymentStatus,
                payload.paymentStatusLabel,
                payload.paymentMethod,
                payload.paymentType,
                payload.note,
                payload.paymentJson,
                payload.customerJson,
                payload.shippingAddressJson,
                payload.fullAddressJson,
                payload.gpsLocationJson,
                payload.deliveryMethod,
                payload.deliveryLabel,
                payload.statusHistoryJson,
                payload.createdAt,
                payload.updatedAt
            );

            const insertItem = this.db.prepare(`
                INSERT INTO order_items (
                    order_id, product_id, product_catalog_id, product_name, quantity, price, image, attributes_json, color, size, sort_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            (Array.isArray(order.items) ? order.items : []).forEach((item, index) => {
                insertItem.run(
                    result.lastInsertRowid,
                    item.productRecordId ? Number(item.productRecordId) : null,
                    this.normalizeText(item.productId || item.id),
                    this.normalizeText(item.productName || item.name),
                    Math.max(1, this.toNumber(item.quantity || item.qty, 1)),
                    this.toNumber(item.price, 0),
                    this.normalizeText(item.image),
                    this.stringifyJson(item.attributes || {}, {}),
                    this.normalizeText(item.color),
                    this.normalizeText(item.size),
                    index
                );
            });

            return Number(result.lastInsertRowid);
        });

        const recordId = transaction();
        return this.findByIdentifier(recordId);
    }

    async listForUser(user) {
        const clauses = [];
        const params = [];

        if (user?.id) {
            clauses.push('user_public_id = ?');
            params.push(this.normalizeText(user.id));
            clauses.push('customer_id = ?');
            params.push(this.normalizeText(user.id));
        }
        if (user?.email) {
            clauses.push('user_email = ?');
            params.push(this.normalizeText(user.email).toLowerCase());
            clauses.push('customer_email = ?');
            params.push(this.normalizeText(user.email).toLowerCase());
        }
        if (user?.phone) {
            const { rwandaPhoneVariants } = require('../../utils/phone');
            rwandaPhoneVariants(user.phone).forEach((variant) => {
                clauses.push('customer_phone = ?');
                params.push(variant);
                clauses.push('phone_number = ?');
                params.push(variant);
            });
        }

        if (!clauses.length) {
            return [];
        }

        const rows = this.db.prepare(`SELECT * FROM orders WHERE ${clauses.join(' OR ')} ORDER BY created_at DESC, updated_at DESC`).all(...params);
        const itemLookup = this.loadItems(rows.map((row) => Number(row.id)));
        return rows.map((row) => this.mapOrderRow(row, itemLookup.get(Number(row.id)) || []));
    }

    async listForAdmin({ limit = 100, offset = 0 } = {}) {
        const rows = this.db.prepare('SELECT * FROM orders ORDER BY created_at DESC, updated_at DESC LIMIT ? OFFSET ?').all(Math.max(1, Number(limit) || 100), Math.max(0, Number(offset) || 0));
        const itemLookup = this.loadItems(rows.map((row) => Number(row.id)));
        return rows.map((row) => this.mapOrderRow(row, itemLookup.get(Number(row.id)) || []));
    }

    async save(order) {
        const existing = await this.findByIdentifier(order.orderId || order.id);
        if (!existing) {
            return this.create(order);
        }

        const now = this.now(order.updatedAt);
        this.db.prepare(`
            UPDATE orders
            SET status = ?, order_status = ?, payment_status = ?, payment_status_label = ?, payment_method = ?, payment_type = ?, note = ?, payment_json = ?, customer_json = ?,
                shipping_address_json = ?, full_address_json = ?, gps_location_json = ?, delivery_method = ?, delivery_label = ?, status_history_json = ?, updated_at = ?
            WHERE id = ?
        `).run(
            this.normalizeText(order.status, existing.status),
            this.normalizeText(order.orderStatus, existing.orderStatus),
            this.normalizeText(order.paymentStatus, existing.paymentStatus),
            this.normalizeText(order.paymentStatusLabel, existing.paymentStatusLabel),
            this.normalizeText(order.paymentMethod, existing.paymentMethod),
            this.normalizeText(order.paymentType, existing.paymentType),
            this.normalizeText(order.note, existing.note),
            this.stringifyJson(order.payment || existing.payment || {}, {}),
            this.stringifyJson(order.customer || existing.customer || {}, {}),
            this.stringifyJson(order.shippingAddress || existing.shippingAddress || {}, {}),
            this.stringifyJson(order.fullAddress || existing.fullAddress || {}, {}),
            this.stringifyJson(order.gpsLocation || existing.gpsLocation || {}, {}),
            this.normalizeText(order.deliveryMethod, existing.deliveryMethod),
            this.normalizeText(order.deliveryLabel, existing.deliveryLabel),
            this.stringifyJson(order.statusHistory || existing.statusHistory || [], []),
            now,
            Number(existing.recordId)
        );

        return this.findByIdentifier(existing.orderId);
    }

    async remove(identifier) {
        const existing = await this.findByIdentifier(identifier);
        if (!existing) {
            return null;
        }

        this.db.prepare('DELETE FROM orders WHERE id = ?').run(Number(existing.recordId));
        return existing;
    }
}

module.exports = new SQLiteOrderRepository();