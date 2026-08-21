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
            username: this.normalizeText(row.username),
            email: this.normalizeText(row.email).toLowerCase(),
            phone: this.normalizeText(row.phone),
            password: this.normalizeText(row.password_hash),
            role: this.normalizeText(row.role, 'user'),
            avatar: this.normalizeText(row.avatar),
            status: this.normalizeText(row.status, 'active'),
            verified: Boolean(row.verified),
            jobTitle: this.normalizeText(row.job_title),
            department: this.normalizeText(row.department),
            preferredLanguage: this.normalizeText(row.preferred_language, 'en'),
            timeZone: this.normalizeText(row.time_zone, 'Africa/Kigali'),
            address: this.parseJson(row.address_json, {}),
            preferences: this.parseJson(row.preferences_json, {}),
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || null,
            lastLoginAt: row.last_login_at || null,
            lastPasswordChangeAt: row.last_password_change_at || null,
            loginCount: Number(row.login_count || 0) || 0,
            failedLoginAttempts: Number(row.failed_login_attempts || 0) || 0,
            lockedUntil: row.locked_until || null,
            twoFactorEnabled: Boolean(row.two_factor_enabled),
            twoFactorMethod: this.normalizeText(row.two_factor_method),
            twoFactorUpdatedAt: row.two_factor_updated_at || null,
            passwordVersion: Number(row.password_version || 1) || 1,
            passwordExpiresAt: row.password_expires_at || null
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
        const { rwandaPhoneVariants, normalizeRwandaPhone } = require('../../utils/phone');
        const normalized = this.normalizeText(identifier);
        const lower = normalized.toLowerCase();
        const roleClause = includeAdmins ? '' : " AND role <> 'admin'";
        const phoneCandidates = rwandaPhoneVariants(identifier);
        const placeholders = phoneCandidates.map(() => '?').join(', ') || '?';
        const phoneParams = phoneCandidates.length ? phoneCandidates : [normalized];

        return this.mapRow(this.db.prepare(`
            SELECT * FROM users
            WHERE (
                public_id = ?
                OR email = ?
                OR phone = ?
                OR phone IN (${placeholders})
            )
            ${roleClause}
            LIMIT 1
        `).get(normalized, lower, normalizeRwandaPhone(identifier) || normalized, ...phoneParams));
    }

    async existsByPhone(phone, excludePublicId = '') {
        const { rwandaPhoneVariants } = require('../../utils/phone');
        const variants = rwandaPhoneVariants(phone);
        if (!variants.length) {
            return false;
        }

        const placeholders = variants.map(() => '?').join(', ');
        const row = this.db.prepare(`
            SELECT public_id FROM users
            WHERE phone IN (${placeholders}) AND public_id <> ?
            LIMIT 1
        `).get(...variants, this.normalizeText(excludePublicId));
        return Boolean(row);
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

    async existsByUsername(username, excludePublicId = '') {
        const normalized = this.normalizeText(username).toLowerCase();
        if (!normalized) {
            return false;
        }

        const row = this.db.prepare(`
            SELECT public_id FROM users
            WHERE lower(COALESCE(username, '')) = ? AND public_id <> ?
            LIMIT 1
        `).get(normalized, this.normalizeText(excludePublicId));
        return Boolean(row);
    }

    async findAdminByPublicIdOrEmail({ publicId = '', email = '' } = {}) {
        const normalizedId = this.normalizeText(publicId);
        const normalizedEmail = this.normalizeText(email).toLowerCase();

        if (normalizedId) {
            const byId = this.mapRow(this.db.prepare(`
                SELECT * FROM users WHERE public_id = ? AND role = 'admin' LIMIT 1
            `).get(normalizedId));
            if (byId) {
                return byId;
            }
        }

        if (normalizedEmail) {
            const byEmail = this.mapRow(this.db.prepare(`
                SELECT * FROM users WHERE email = ? AND role = 'admin' LIMIT 1
            `).get(normalizedEmail));
            if (byEmail) {
                return byEmail;
            }
        }

        return this.mapRow(this.db.prepare(`
            SELECT * FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1
        `).get());
    }

    async create(user) {
        const now = this.now(user.createdAt);
        const result = this.db.prepare(`
            INSERT INTO users (
                public_id, name, username, email, phone, password_hash, role, avatar, status, verified,
                job_title, department, preferred_language, time_zone, address_json, preferences_json,
                last_password_change_at, login_count, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            this.normalizeText(user.id),
            this.normalizeText(user.name),
            this.normalizeText(user.username) || null,
            this.normalizeText(user.email).toLowerCase() || null,
            this.normalizeText(user.phone) || null,
            this.normalizeText(user.password),
            this.normalizeText(user.role, 'user'),
            this.normalizeText(user.avatar),
            this.normalizeText(user.status, 'active'),
            this.normalizeBoolean(user.verified),
            this.normalizeText(user.jobTitle),
            this.normalizeText(user.department),
            this.normalizeText(user.preferredLanguage, 'en'),
            this.normalizeText(user.timeZone, 'Africa/Kigali'),
            this.stringifyJson(user.address || {}, {}),
            this.stringifyJson(user.preferences || {}, {}),
            this.now(user.lastPasswordChangeAt || now),
            Math.max(0, Number(user.loginCount || 0) || 0),
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

        const nextUsername = Object.prototype.hasOwnProperty.call(updates, 'username')
            ? (this.normalizeText(updates.username) || null)
            : (existing.username || null);

        this.db.prepare(`
            UPDATE users
            SET name = ?, username = ?, email = ?, phone = ?, password_hash = ?, role = ?, avatar = ?, status = ?, verified = ?,
                job_title = ?, department = ?, preferred_language = ?, time_zone = ?, address_json = ?, preferences_json = ?,
                last_password_change_at = ?, login_count = ?, updated_at = ?
            WHERE public_id = ?
        `).run(
            this.normalizeText(updates.name, existing.name),
            nextUsername,
            this.normalizeText(updates.email, existing.email).toLowerCase() || null,
            this.normalizeText(updates.phone, existing.phone) || null,
            this.normalizeText(updates.password, existing.password),
            this.normalizeText(updates.role, existing.role),
            Object.prototype.hasOwnProperty.call(updates, 'avatar')
                ? this.normalizeText(updates.avatar)
                : this.normalizeText(existing.avatar),
            this.normalizeText(updates.status, existing.status),
            this.normalizeBoolean(typeof updates.verified === 'boolean' ? updates.verified : existing.verified),
            this.normalizeText(
                Object.prototype.hasOwnProperty.call(updates, 'jobTitle') ? updates.jobTitle : existing.jobTitle
            ),
            this.normalizeText(
                Object.prototype.hasOwnProperty.call(updates, 'department') ? updates.department : existing.department
            ),
            this.normalizeText(
                Object.prototype.hasOwnProperty.call(updates, 'preferredLanguage')
                    ? updates.preferredLanguage
                    : existing.preferredLanguage,
                'en'
            ),
            this.normalizeText(
                Object.prototype.hasOwnProperty.call(updates, 'timeZone') ? updates.timeZone : existing.timeZone,
                'Africa/Kigali'
            ),
            this.stringifyJson(updates.address || existing.address || {}, {}),
            this.stringifyJson(
                Object.prototype.hasOwnProperty.call(updates, 'preferences')
                    ? updates.preferences
                    : (existing.preferences || {}),
                {}
            ),
            Object.prototype.hasOwnProperty.call(updates, 'lastPasswordChangeAt')
                ? this.now(updates.lastPasswordChangeAt)
                : (existing.lastPasswordChangeAt || null),
            Object.prototype.hasOwnProperty.call(updates, 'loginCount')
                ? Math.max(0, Number(updates.loginCount) || 0)
                : Math.max(0, Number(existing.loginCount || 0) || 0),
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
            SET last_login_at = ?, failed_login_attempts = 0, locked_until = NULL,
                login_count = COALESCE(login_count, 0) + 1, updated_at = ?
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

    async upsertAdminUser({ email, passwordHash, name = 'Administrator', publicId, username }) {
        const normalizedEmail = this.normalizeText(email).toLowerCase();
        const resolvedPublicId = this.normalizeText(publicId || `ADMIN_${Buffer.from(normalizedEmail).toString('hex').slice(0, 16)}`);
        let existing = this.db.prepare("SELECT * FROM users WHERE public_id = ? AND role = 'admin' LIMIT 1").get(resolvedPublicId);

        if (!existing) {
            existing = this.db.prepare("SELECT * FROM users WHERE email = ? AND role = 'admin' LIMIT 1").get(normalizedEmail);
        }

        if (existing) {
            const incomingHash = this.normalizeText(passwordHash);
            const existingHash = this.normalizeText(existing.password_hash);
            const managedPassword = Boolean(existing.last_password_change_at)
                && Number(existing.password_version || 1) > 1
                && existingHash
                && incomingHash
                && incomingHash !== existingHash;
            const nextHash = managedPassword ? existingHash : (incomingHash || existingHash);
            const passwordChanged = Boolean(incomingHash) && nextHash === incomingHash && incomingHash !== existingHash;
            const now = this.now();
            this.db.prepare(`
                UPDATE users
                SET password_hash = ?, status = 'active', verified = 1,
                    last_password_change_at = CASE WHEN ? THEN ? ELSE last_password_change_at END,
                    username = COALESCE(NULLIF(TRIM(username), ''), ?),
                    updated_at = ?
                WHERE id = ?
            `).run(
                nextHash,
                passwordChanged ? 1 : 0,
                now,
                this.normalizeText(username) || this.normalizeText(existing.username) || normalizedEmail.split('@')[0] || 'admin',
                now,
                Number(existing.id)
            );
            return this.findByRecordId(existing.id);
        }

        const now = this.now();
        const defaultUsername = this.normalizeText(username) || normalizedEmail.split('@')[0] || 'admin';
        const result = this.db.prepare(`
            INSERT INTO users (
                public_id, name, username, email, phone, password_hash, role, avatar, status, verified,
                job_title, department, preferred_language, time_zone, address_json,
                last_password_change_at, login_count, created_at, updated_at
            ) VALUES (?, ?, ?, ?, NULL, ?, 'admin', '', 'active', 1, '', '', 'en', 'Africa/Kigali', '{}', ?, 0, ?, ?)
        `).run(
            resolvedPublicId,
            this.normalizeText(name, 'Administrator'),
            defaultUsername,
            normalizedEmail,
            this.normalizeText(passwordHash),
            now,
            now,
            now
        );

        return this.findByRecordId(result.lastInsertRowid);
    }
}

module.exports = new SQLiteUserRepository();