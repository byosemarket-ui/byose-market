const SQLiteBaseRepository = require('./base.repository');

class SQLiteUserRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'users' });
    }

    mapRow(row) {
        if (!row) {
            return null;
        }

        return {
            recordId: Number(row.id),
            id: this.normalizeText(row.public_id),
            name: this.normalizeText(row.name),
            email: this.normalizeText(row.email).toLowerCase(),
            phone: this.normalizeText(row.phone),
            password: this.normalizeText(row.password_hash),
            role: this.normalizeText(row.role, 'user'),
            avatar: this.normalizeText(row.avatar),
            status: this.normalizeText(row.status, 'active'),
            verified: Boolean(row.verified),
            address: this.parseJson(row.address_json, {}),
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || null,
            lastLoginAt: row.last_login_at || null,
            failedLoginAttempts: Number(row.failed_login_attempts || 0) || 0,
            lockedUntil: row.locked_until || null
        };
    }

    async getNextPublicId() {
        const rows = this.db.prepare("SELECT public_id FROM users WHERE public_id LIKE 'BM%' ORDER BY public_id ASC").all();
        const max = rows.reduce((current, row) => {
            const numeric = Number(String(row.public_id || '').replace(/^BM0*/, '')) || 0;
            return Math.max(current, numeric);
        }, 0);
        return `BM${String(max + 1).padStart(5, '0')}`;
    }

    async findByPublicId(publicId) {
        return this.mapRow(this.db.prepare('SELECT * FROM users WHERE public_id = ? LIMIT 1').get(this.normalizeText(publicId)));
    }

    async findByRecordId(recordId) {
        return this.mapRow(this.db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(Number(recordId)));
    }

    async findByIdentifier(identifier, { includeAdmins = true } = {}) {
        const normalized = this.normalizeText(identifier);
        const lower = normalized.toLowerCase();
        const roleClause = includeAdmins ? '' : " AND role <> 'admin'";
        return this.mapRow(this.db.prepare(`
            SELECT * FROM users
            WHERE (public_id = ? OR email = ? OR phone = ?)
            ${roleClause}
            LIMIT 1
        `).get(normalized, lower, normalized));
    }

    async list({ includeAdmins = false, query = '', status = '' } = {}) {
        const params = [];
        let sql = 'SELECT * FROM users WHERE 1=1';

        if (!includeAdmins) {
            sql += " AND role <> 'admin'";
        }

        const normalizedStatus = this.normalizeText(status).toLowerCase();
        if (normalizedStatus) {
            sql += ' AND lower(status) = ?';
            params.push(normalizedStatus);
        }

        const normalizedQuery = this.normalizeText(query).toLowerCase();
        if (normalizedQuery) {
            const like = `%${normalizedQuery.replace(/[%_]/g, '')}%`;
            sql += ' AND (lower(name) LIKE ? OR lower(COALESCE(email, \'\')) LIKE ? OR lower(COALESCE(phone, \'\')) LIKE ? OR lower(public_id) LIKE ?)';
            params.push(like, like, like, like);
        }

        sql += ' ORDER BY created_at DESC';
        return this.db.prepare(sql).all(...params).map((row) => this.mapRow(row));
    }

    async existsByEmail(email, excludePublicId = '') {
        if (!this.normalizeText(email)) {
            return false;
        }

        const row = this.db.prepare('SELECT public_id FROM users WHERE email = ? AND public_id <> ? LIMIT 1').get(this.normalizeText(email).toLowerCase(), this.normalizeText(excludePublicId));
        return Boolean(row);
    }

    async existsByPhone(phone, excludePublicId = '') {
        if (!this.normalizeText(phone)) {
            return false;
        }

        const row = this.db.prepare('SELECT public_id FROM users WHERE phone = ? AND public_id <> ? LIMIT 1').get(this.normalizeText(phone), this.normalizeText(excludePublicId));
        return Boolean(row);
    }

    async create(user) {
        const now = this.now(user.createdAt);
        const result = this.db.prepare(`
            INSERT INTO users (
                public_id, name, email, phone, password_hash, role, avatar, status, verified, address_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            this.normalizeText(user.id),
            this.normalizeText(user.name),
            this.normalizeText(user.email).toLowerCase() || null,
            this.normalizeText(user.phone) || null,
            this.normalizeText(user.password),
            this.normalizeText(user.role, 'user'),
            this.normalizeText(user.avatar),
            this.normalizeText(user.status, 'active'),
            this.normalizeBoolean(user.verified),
            this.stringifyJson(user.address || {}, {}),
            now,
            this.now(user.updatedAt || now)
        );

        return this.findByRecordId(result.lastInsertRowid);
    }

    async update(publicId, updates) {
        const existing = await this.findByPublicId(publicId);
        if (!existing) {
            return null;
        }

        this.db.prepare(`
            UPDATE users
            SET name = ?, email = ?, phone = ?, password_hash = ?, role = ?, avatar = ?, status = ?, verified = ?, address_json = ?, updated_at = ?
            WHERE public_id = ?
        `).run(
            this.normalizeText(updates.name, existing.name),
            this.normalizeText(updates.email, existing.email).toLowerCase() || null,
            this.normalizeText(updates.phone, existing.phone) || null,
            this.normalizeText(updates.password, existing.password),
            this.normalizeText(updates.role, existing.role),
            this.normalizeText(updates.avatar, existing.avatar),
            this.normalizeText(updates.status, existing.status),
            this.normalizeBoolean(typeof updates.verified === 'boolean' ? updates.verified : existing.verified),
            this.stringifyJson(updates.address || existing.address || {}, {}),
            this.now(updates.updatedAt),
            existing.id
        );

        return this.findByPublicId(existing.id);
    }

    async recordSuccessfulLogin(publicId) {
        const existing = await this.findByPublicId(publicId);
        if (!existing) {
            return null;
        }

        const now = this.now();
        this.db.prepare(`
            UPDATE users
            SET last_login_at = ?, failed_login_attempts = 0, locked_until = NULL, updated_at = ?
            WHERE public_id = ?
        `).run(now, now, existing.id);

        return this.findByPublicId(existing.id);
    }

    async recordFailedLogin(publicId) {
        const existing = await this.findByPublicId(publicId);
        if (!existing) {
            return { attempts: 0, lockedUntil: null };
        }

        const attempts = Number(existing.failedLoginAttempts || 0) + 1;
        const lockedUntil = attempts >= 5
            ? new Date(Date.now() + (15 * 60 * 1000)).toISOString()
            : null;
        const now = this.now();

        this.db.prepare(`
            UPDATE users
            SET failed_login_attempts = ?, locked_until = ?, updated_at = ?
            WHERE public_id = ?
        `).run(attempts, lockedUntil, now, existing.id);

        return { attempts, lockedUntil };
    }

    async delete(publicId) {
        const existing = await this.findByPublicId(publicId);
        if (!existing) {
            return null;
        }

        this.db.prepare('DELETE FROM users WHERE public_id = ?').run(existing.id);
        return existing;
    }

    async upsertAdminUser({ email, passwordHash, name = 'Administrator', publicId }) {
        const normalizedEmail = this.normalizeText(email).toLowerCase();
        let existing = this.db.prepare("SELECT * FROM users WHERE email = ? AND role = 'admin' LIMIT 1").get(normalizedEmail);

        if (existing) {
            this.db.prepare(`
                UPDATE users
                SET name = ?, password_hash = ?, status = 'active', verified = 1, updated_at = ?
                WHERE id = ?
            `).run(this.normalizeText(name, 'Administrator'), this.normalizeText(passwordHash), this.now(), Number(existing.id));
            return this.findByRecordId(existing.id);
        }

        const result = this.db.prepare(`
            INSERT INTO users (
                public_id, name, email, phone, password_hash, role, avatar, status, verified, address_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'admin', '', 'active', 1, '{}', ?, ?)
        `).run(
            this.normalizeText(publicId || `ADMIN_${Buffer.from(normalizedEmail).toString('hex').slice(0, 16)}`),
            this.normalizeText(name, 'Administrator'),
            normalizedEmail,
            null,
            this.normalizeText(passwordHash),
            this.now(),
            this.now()
        );

        return this.findByRecordId(result.lastInsertRowid);
    }
}

module.exports = new SQLiteUserRepository();