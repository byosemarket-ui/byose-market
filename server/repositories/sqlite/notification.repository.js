const crypto = require('crypto');
const SQLiteBaseRepository = require('./base.repository');

const ALLOWED_STATUSES = new Set(['unread', 'read', 'archived']);
const ALLOWED_PRIORITIES = new Set(['high', 'normal', 'low']);
const ALLOWED_SORTS = new Set(['newest', 'oldest', 'priority', 'type']);
const ALLOWED_DATE_PRESETS = new Set(['today', 'yesterday', 'this_week', 'this_month']);

class SQLiteNotificationRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'admin_notifications' });
    }

    createId() {
        return `ntf_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    }

    splitDateParts(isoValue) {
        const date = new Date(isoValue || Date.now());
        const safe = Number.isFinite(date.getTime()) ? date : new Date();
        const iso = safe.toISOString();
        return {
            createdAt: iso,
            createdDate: iso.slice(0, 10),
            createdTime: iso.slice(11, 19)
        };
    }

    mapRow(row) {
        if (!row) return null;
        const metadata = this.parseJson(row.metadata_json, {});
        return {
            id: this.normalizeText(row.id),
            type: this.normalizeText(row.type, 'system'),
            title: this.normalizeText(row.title),
            message: this.normalizeText(row.message),
            relatedOrderId: this.normalizeText(row.related_order_id) || null,
            relatedCustomerId: this.normalizeText(row.related_customer_id) || null,
            relatedCustomerName: this.normalizeText(metadata?.relatedCustomerName) || null,
            relatedProductId: this.normalizeText(metadata?.relatedProductId) || null,
            relatedProductName: this.normalizeText(metadata?.relatedProductName) || null,
            icon: this.normalizeText(metadata?.icon || row.type, 'system'),
            eventKey: this.normalizeText(metadata?.eventKey) || null,
            priority: this.normalizeText(row.priority, 'normal'),
            status: this.normalizeText(row.status, 'unread'),
            metadata,
            createdAt: row.created_at || null,
            createdDate: row.created_date || null,
            createdTime: row.created_time || null,
            readAt: row.read_at || null,
            archivedAt: row.archived_at || null,
            deletedAt: row.deleted_at || null
        };
    }

    normalizePriority(value) {
        let priority = this.normalizeText(value, 'normal').toLowerCase();
        if (priority === 'medium') priority = 'normal';
        return ALLOWED_PRIORITIES.has(priority) ? priority : 'normal';
    }

    normalizeStatus(value) {
        const status = this.normalizeText(value, 'unread').toLowerCase();
        return ALLOWED_STATUSES.has(status) ? status : 'unread';
    }

    normalizeSort(value) {
        const sort = this.normalizeText(value, 'newest').toLowerCase();
        return ALLOWED_SORTS.has(sort) ? sort : 'newest';
    }

    toDateOnly(value) {
        const text = this.normalizeText(value);
        if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
        const date = new Date(text);
        if (!Number.isFinite(date.getTime())) return '';
        return date.toISOString().slice(0, 10);
    }

    resolveDatePreset(preset) {
        const key = this.normalizeText(preset).toLowerCase();
        if (!ALLOWED_DATE_PRESETS.has(key)) {
            return { fromDate: '', toDate: '' };
        }

        const now = new Date();
        const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

        const format = (date) => date.toISOString().slice(0, 10);

        if (key === 'today') {
            const day = format(today);
            return { fromDate: day, toDate: day };
        }

        if (key === 'yesterday') {
            const yesterday = new Date(today);
            yesterday.setUTCDate(yesterday.getUTCDate() - 1);
            const day = format(yesterday);
            return { fromDate: day, toDate: day };
        }

        if (key === 'this_week') {
            const day = today.getUTCDay(); // 0 Sun
            const mondayOffset = day === 0 ? -6 : 1 - day;
            const start = new Date(today);
            start.setUTCDate(start.getUTCDate() + mondayOffset);
            return { fromDate: format(start), toDate: format(today) };
        }

        // this_month
        const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
        return { fromDate: format(start), toDate: format(today) };
    }

    buildListFilters(query = {}) {
        const clauses = ['deleted_at IS NULL'];
        const params = [];

        const includeArchived = ['1', 'true', 'yes', 'on'].includes(
            String(query.includeArchived == null ? '' : query.includeArchived).trim().toLowerCase()
        );
        const normalizedStatus = this.normalizeText(query.status).toLowerCase();
        if (normalizedStatus && ALLOWED_STATUSES.has(normalizedStatus)) {
            clauses.push('status = ?');
            params.push(normalizedStatus);
        } else if (!includeArchived) {
            clauses.push("status != 'archived'");
        }

        const normalizedPriority = this.normalizePriority(query.priority || '');
        if (this.normalizeText(query.priority) && ALLOWED_PRIORITIES.has(normalizedPriority)) {
            clauses.push('priority = ?');
            params.push(normalizedPriority);
        }

        const normalizedType = this.normalizeText(query.type).toLowerCase();
        if (normalizedType) {
            clauses.push('type = ?');
            params.push(normalizedType.slice(0, 64));
        }

        const orderId = this.normalizeText(query.orderId || query.relatedOrderId);
        if (orderId) {
            clauses.push('related_order_id LIKE ?');
            params.push(`%${orderId.slice(0, 120)}%`);
        }

        const customer = this.normalizeText(query.customer || query.customerName || query.relatedCustomerId);
        if (customer) {
            clauses.push('(related_customer_id LIKE ? OR metadata_json LIKE ? OR title LIKE ? OR message LIKE ?)');
            const like = `%${customer.slice(0, 120)}%`;
            params.push(like, like, like, like);
        }

        const preset = this.resolveDatePreset(query.datePreset || query.period);
        let fromDate = this.toDateOnly(query.dateFrom || query.from || preset.fromDate);
        let toDate = this.toDateOnly(query.dateTo || query.to || preset.toDate);
        const exactDate = this.toDateOnly(query.date);
        if (exactDate) {
            fromDate = exactDate;
            toDate = exactDate;
        }
        if (fromDate) {
            clauses.push('created_date >= ?');
            params.push(fromDate);
        }
        if (toDate) {
            clauses.push('created_date <= ?');
            params.push(toDate);
        }

        const q = this.normalizeText(query.q || query.search || query.keyword);
        if (q) {
            const like = `%${q.slice(0, 160)}%`;
            clauses.push(`(
                title LIKE ?
                OR message LIKE ?
                OR type LIKE ?
                OR related_order_id LIKE ?
                OR related_customer_id LIKE ?
                OR metadata_json LIKE ?
            )`);
            params.push(like, like, like, like, like, like);
        }

        return {
            whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
            params,
            sort: this.normalizeSort(query.sort || query.sortBy)
        };
    }

    buildOrderBy(sort) {
        switch (sort) {
        case 'oldest':
            return 'ORDER BY created_at ASC, id ASC';
        case 'priority':
            return `ORDER BY CASE priority
                WHEN 'high' THEN 1
                WHEN 'normal' THEN 2
                WHEN 'low' THEN 3
                ELSE 4
            END ASC, created_at DESC, id DESC`;
        case 'type':
            return 'ORDER BY type ASC, created_at DESC, id DESC';
        case 'newest':
        default:
            return 'ORDER BY created_at DESC, id DESC';
        }
    }

    async create(payload = {}) {
        const id = this.normalizeText(payload.id) || this.createId();
        const parts = this.splitDateParts(payload.createdAt);
        const status = this.normalizeStatus(payload.status || 'unread');
        const now = parts.createdAt;

        this.db.prepare(`
            INSERT INTO admin_notifications (
                id, type, title, message, related_order_id, related_customer_id,
                priority, status, metadata_json, created_at, created_date, created_time,
                read_at, archived_at, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            this.normalizeText(payload.type, 'system').toLowerCase().slice(0, 64),
            this.normalizeText(payload.title).slice(0, 200),
            this.normalizeText(payload.message).slice(0, 4000),
            this.normalizeText(payload.relatedOrderId) || null,
            this.normalizeText(payload.relatedCustomerId) || null,
            this.normalizePriority(payload.priority),
            status,
            this.stringifyJson(payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}, {}),
            parts.createdAt,
            parts.createdDate,
            parts.createdTime,
            status === 'read' ? (payload.readAt || now) : null,
            status === 'archived' ? (payload.archivedAt || now) : null,
            null
        );

        return this.findById(id);
    }

    async findById(id) {
        const row = this.db.prepare(`
            SELECT * FROM admin_notifications
            WHERE id = ? AND deleted_at IS NULL
            LIMIT 1
        `).get(this.normalizeText(id));
        return this.mapRow(row);
    }

    async list(query = {}) {
        const { whereSql, params, sort } = this.buildListFilters(query);
        const safeLimit = Math.min(Math.max(Number(query.limit) || 40, 1), 200);
        const safeOffset = Math.max(Number(query.offset) || 0, 0);
        const orderBy = this.buildOrderBy(sort);

        const rows = this.db.prepare(`
            SELECT * FROM admin_notifications
            ${whereSql}
            ${orderBy}
            LIMIT ? OFFSET ?
        `).all(...params, safeLimit, safeOffset);

        const totalRow = this.db.prepare(`
            SELECT COUNT(*) AS total FROM admin_notifications
            ${whereSql}
        `).get(...params);

        const unreadRow = this.db.prepare(`
            SELECT COUNT(*) AS total FROM admin_notifications
            WHERE deleted_at IS NULL AND status = 'unread'
        `).get();

        return {
            items: rows.map((row) => this.mapRow(row)),
            total: Number(totalRow?.total || 0),
            unreadCount: Number(unreadRow?.total || 0),
            limit: safeLimit,
            offset: safeOffset,
            sort
        };
    }

    async countUnread() {
        const row = this.db.prepare(`
            SELECT COUNT(*) AS total
            FROM admin_notifications
            WHERE deleted_at IS NULL AND status = 'unread'
        `).get();
        return Number(row?.total || 0);
    }

    async markRead(id) {
        const now = this.now();
        this.db.prepare(`
            UPDATE admin_notifications
            SET status = 'read',
                read_at = COALESCE(read_at, ?),
                archived_at = NULL
            WHERE id = ? AND deleted_at IS NULL AND status != 'archived'
        `).run(now, this.normalizeText(id));
        return this.findById(id);
    }

    async markUnread(id) {
        this.db.prepare(`
            UPDATE admin_notifications
            SET status = 'unread',
                read_at = NULL,
                archived_at = NULL
            WHERE id = ? AND deleted_at IS NULL
        `).run(this.normalizeText(id));
        return this.findById(id);
    }

    async markAllRead() {
        const now = this.now();
        const result = this.db.prepare(`
            UPDATE admin_notifications
            SET status = 'read',
                read_at = COALESCE(read_at, ?)
            WHERE deleted_at IS NULL AND status = 'unread'
        `).run(now);
        return Number(result?.changes || 0);
    }

    async archive(id) {
        const now = this.now();
        this.db.prepare(`
            UPDATE admin_notifications
            SET status = 'archived',
                archived_at = ?,
                read_at = COALESCE(read_at, ?)
            WHERE id = ? AND deleted_at IS NULL
        `).run(now, now, this.normalizeText(id));
        return this.findById(id);
    }

    async softDelete(id) {
        const now = this.now();
        const result = this.db.prepare(`
            UPDATE admin_notifications
            SET deleted_at = ?
            WHERE id = ? AND deleted_at IS NULL
        `).run(now, this.normalizeText(id));
        return Number(result?.changes || 0) > 0;
    }

    async softDeleteMany(ids = []) {
        const list = Array.isArray(ids)
            ? ids.map((id) => this.normalizeText(id)).filter(Boolean).slice(0, 200)
            : [];
        if (!list.length) return 0;

        const now = this.now();
        const placeholders = list.map(() => '?').join(', ');
        const result = this.db.prepare(`
            UPDATE admin_notifications
            SET deleted_at = ?
            WHERE deleted_at IS NULL AND id IN (${placeholders})
        `).run(now, ...list);
        return Number(result?.changes || 0);
    }

    async archiveMany(ids = []) {
        const list = Array.isArray(ids)
            ? ids.map((id) => this.normalizeText(id)).filter(Boolean).slice(0, 200)
            : [];
        if (!list.length) return 0;

        const now = this.now();
        const placeholders = list.map(() => '?').join(', ');
        const result = this.db.prepare(`
            UPDATE admin_notifications
            SET status = 'archived',
                archived_at = ?,
                read_at = COALESCE(read_at, ?)
            WHERE deleted_at IS NULL AND id IN (${placeholders})
        `).run(now, now, ...list);
        return Number(result?.changes || 0);
    }

    async markManyRead(ids = []) {
        const list = Array.isArray(ids)
            ? ids.map((id) => this.normalizeText(id)).filter(Boolean).slice(0, 200)
            : [];
        if (!list.length) return 0;

        const now = this.now();
        const placeholders = list.map(() => '?').join(', ');
        const result = this.db.prepare(`
            UPDATE admin_notifications
            SET status = 'read',
                read_at = COALESCE(read_at, ?),
                archived_at = NULL
            WHERE deleted_at IS NULL
              AND status = 'unread'
              AND id IN (${placeholders})
        `).run(now, ...list);
        return Number(result?.changes || 0);
    }

    async markManyUnread(ids = []) {
        const list = Array.isArray(ids)
            ? ids.map((id) => this.normalizeText(id)).filter(Boolean).slice(0, 200)
            : [];
        if (!list.length) return 0;

        const placeholders = list.map(() => '?').join(', ');
        const result = this.db.prepare(`
            UPDATE admin_notifications
            SET status = 'unread',
                read_at = NULL,
                archived_at = NULL
            WHERE deleted_at IS NULL
              AND id IN (${placeholders})
        `).run(...list);
        return Number(result?.changes || 0);
    }

    async clearOlderThanDays(days = 90) {
        const safeDays = Math.min(Math.max(Number(days) || 90, 1), 3650);
        const cutoff = new Date(Date.now() - (safeDays * 24 * 60 * 60 * 1000)).toISOString();
        const now = this.now();
        const result = this.db.prepare(`
            UPDATE admin_notifications
            SET deleted_at = ?
            WHERE deleted_at IS NULL
              AND created_at < ?
        `).run(now, cutoff);
        return {
            deleted: Number(result?.changes || 0),
            olderThanDays: safeDays,
            cutoff
        };
    }

    async updateMetadata(id, metadata = {}) {
        const existing = await this.findById(id);
        if (!existing) return null;
        const nextMeta = {
            ...(existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}),
            ...(metadata && typeof metadata === 'object' ? metadata : {})
        };
        this.db.prepare(`
            UPDATE admin_notifications
            SET metadata_json = ?
            WHERE id = ? AND deleted_at IS NULL
        `).run(this.stringifyJson(nextMeta, {}), this.normalizeText(id));
        return this.findById(id);
    }
}

module.exports = new SQLiteNotificationRepository();
