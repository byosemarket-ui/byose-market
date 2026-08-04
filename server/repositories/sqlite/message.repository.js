const SQLiteBaseRepository = require('./base.repository');

class SQLiteMessageRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'contact_messages' });
    }

    mapRow(row) {
        if (!row) {
            return null;
        }

        return {
            id: this.normalizeText(row.message_id),
            messageId: this.normalizeText(row.message_id),
            recordId: Number(row.id),
            userRecordId: row.user_record_id ? Number(row.user_record_id) : null,
            userId: this.normalizeText(row.user_public_id),
            name: this.normalizeText(row.name) || 'Unknown sender',
            email: this.normalizeText(row.email).toLowerCase(),
            phone: this.normalizeText(row.phone),
            message: this.normalizeText(row.message),
            source: this.normalizeText(row.source, 'contact-form'),
            status: this.normalizeText(row.status, 'New'),
            meta: this.parseJson(row.meta_json, {}),
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || row.created_at || null
        };
    }

    async create(payload) {
        const now = this.now(payload.createdAt);
        const messageId = this.normalizeText(payload.messageId) || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        this.db.prepare(`
            INSERT INTO contact_messages (
                message_id, user_record_id, user_public_id, name, email, phone, message, source, status, meta_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            messageId,
            payload.userRecordId ? Number(payload.userRecordId) : null,
            this.normalizeText(payload.userId),
            this.normalizeText(payload.name),
            this.normalizeText(payload.email).toLowerCase(),
            this.normalizeText(payload.phone),
            this.normalizeText(payload.message),
            this.normalizeText(payload.source, 'contact-form'),
            this.normalizeText(payload.status, 'New'),
            this.stringifyJson(payload.meta || {}, {}),
            now,
            this.now(payload.updatedAt || now)
        );

        return this.findByMessageId(messageId);
    }

    async findByMessageId(messageId) {
        return this.mapRow(
            this.db.prepare('SELECT * FROM contact_messages WHERE message_id = ? LIMIT 1')
                .get(this.normalizeText(messageId))
        );
    }

    async findByRecordId(recordId) {
        return this.mapRow(
            this.db.prepare('SELECT * FROM contact_messages WHERE id = ? LIMIT 1')
                .get(Number(recordId))
        );
    }

    async list(options = {}) {
        const limit = Math.min(300, Math.max(1, Number(options.limit || 100) || 100));
        const page = Math.max(1, Number(options.page || 1) || 1);
        const offset = (page - 1) * limit;
        const status = this.normalizeText(options.status);
        const search = this.normalizeText(options.search);
        const clauses = [];
        const params = [];

        if (status && status.toLowerCase() !== 'all') {
            clauses.push('status = ?');
            params.push(status);
        }

        if (search) {
            const like = `%${search}%`;
            clauses.push('(message_id LIKE ? OR name LIKE ? OR email LIKE ? OR phone LIKE ? OR message LIKE ?)');
            params.push(like, like, like, like, like);
        }

        const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
        const rows = this.db.prepare(`
            SELECT * FROM contact_messages
            ${where}
            ORDER BY created_at DESC, updated_at DESC
            LIMIT ? OFFSET ?
        `).all(...params, limit, offset);

        return rows.map((row) => this.mapRow(row));
    }

    async update(messageId, updates = {}) {
        const existing = await this.findByMessageId(messageId);
        if (!existing) {
            return null;
        }

        const next = {
            name: Object.prototype.hasOwnProperty.call(updates, 'name')
                ? this.normalizeText(updates.name) || existing.name
                : existing.name,
            email: Object.prototype.hasOwnProperty.call(updates, 'email')
                ? this.normalizeText(updates.email).toLowerCase()
                : existing.email,
            phone: Object.prototype.hasOwnProperty.call(updates, 'phone')
                ? this.normalizeText(updates.phone)
                : existing.phone,
            message: Object.prototype.hasOwnProperty.call(updates, 'message')
                ? this.normalizeText(updates.message) || existing.message
                : existing.message,
            status: Object.prototype.hasOwnProperty.call(updates, 'status')
                ? this.normalizeText(updates.status, existing.status)
                : existing.status,
            meta: Object.prototype.hasOwnProperty.call(updates, 'meta')
                ? (updates.meta && typeof updates.meta === 'object' ? updates.meta : existing.meta)
                : existing.meta
        };

        this.db.prepare(`
            UPDATE contact_messages
            SET name = ?, email = ?, phone = ?, message = ?, status = ?, meta_json = ?, updated_at = ?
            WHERE message_id = ?
        `).run(
            next.name,
            next.email,
            next.phone,
            next.message,
            next.status,
            this.stringifyJson(next.meta || {}, {}),
            this.now(),
            this.normalizeText(messageId)
        );

        return this.findByMessageId(messageId);
    }

    async deleteByMessageId(messageId) {
        const existing = await this.findByMessageId(messageId);
        if (!existing) {
            return null;
        }

        this.db.prepare('DELETE FROM contact_messages WHERE message_id = ?').run(this.normalizeText(messageId));
        return existing;
    }

    async count(options = {}) {
        const status = this.normalizeText(options.status);
        if (status && status.toLowerCase() !== 'all') {
            const row = this.db.prepare('SELECT COUNT(*) AS total FROM contact_messages WHERE status = ?').get(status);
            return Number(row?.total || 0);
        }

        const row = this.db.prepare('SELECT COUNT(*) AS total FROM contact_messages').get();
        return Number(row?.total || 0);
    }
}

module.exports = new SQLiteMessageRepository();
