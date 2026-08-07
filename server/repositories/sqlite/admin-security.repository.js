const crypto = require('crypto');
const SQLiteBaseRepository = require('./base.repository');

class SQLiteAdminSecurityRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'admin_sessions' });
    }

    createSessionId() {
        return `sess_${crypto.randomBytes(16).toString('hex')}`;
    }

    mapLoginRow(row) {
        if (!row) return null;
        return {
            id: Number(row.id),
            adminPublicId: this.normalizeText(row.admin_public_id),
            adminEmail: this.normalizeText(row.admin_email).toLowerCase(),
            sessionId: this.normalizeText(row.session_id),
            ip: this.normalizeText(row.ip),
            userAgent: this.normalizeText(row.user_agent),
            device: this.normalizeText(row.device),
            deviceName: this.normalizeText(row.device_name || row.device),
            browser: this.normalizeText(row.browser),
            os: this.normalizeText(row.os),
            country: this.normalizeText(row.country),
            city: this.normalizeText(row.city),
            deviceFingerprint: this.normalizeText(row.device_fingerprint),
            status: this.normalizeText(row.status, 'success'),
            logoutAt: row.logout_at || null,
            meta: this.parseJson(row.meta_json, {}),
            createdAt: row.created_at || null
        };
    }

    mapSessionRow(row) {
        if (!row) return null;
        return {
            id: Number(row.id),
            sessionId: this.normalizeText(row.session_id),
            adminPublicId: this.normalizeText(row.admin_public_id),
            adminEmail: this.normalizeText(row.admin_email).toLowerCase(),
            tokenFingerprint: this.normalizeText(row.token_fingerprint),
            deviceFingerprint: this.normalizeText(row.device_fingerprint),
            deviceName: this.normalizeText(row.device_name),
            browser: this.normalizeText(row.browser),
            os: this.normalizeText(row.os),
            ip: this.normalizeText(row.ip),
            userAgent: this.normalizeText(row.user_agent),
            country: this.normalizeText(row.country),
            city: this.normalizeText(row.city),
            createdAt: row.created_at || null,
            lastActivityAt: row.last_activity_at || null,
            expiresAt: row.expires_at || null,
            revokedAt: row.revoked_at || null,
            revokeReason: this.normalizeText(row.revoke_reason),
            meta: this.parseJson(row.meta_json, {}),
            isActive: !row.revoked_at
        };
    }

    mapTrustedDeviceRow(row) {
        if (!row) return null;
        return {
            id: Number(row.id),
            adminPublicId: this.normalizeText(row.admin_public_id),
            adminEmail: this.normalizeText(row.admin_email).toLowerCase(),
            deviceFingerprint: this.normalizeText(row.device_fingerprint),
            deviceName: this.normalizeText(row.device_name),
            browser: this.normalizeText(row.browser),
            os: this.normalizeText(row.os),
            ip: this.normalizeText(row.ip),
            userAgent: this.normalizeText(row.user_agent),
            createdAt: row.created_at || null,
            lastActivityAt: row.last_activity_at || null,
            meta: this.parseJson(row.meta_json, {})
        };
    }

    async recordLoginHistory(payload = {}) {
        const now = this.now();
        const sessionId = this.normalizeText(payload.sessionId) || this.createSessionId();
        const result = this.db.prepare(`
            INSERT INTO admin_login_history (
                admin_public_id, admin_email, session_id, ip, user_agent, device,
                browser, os, country, city, device_name, device_fingerprint,
                status, logout_at, meta_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        `).run(
            this.normalizeText(payload.adminPublicId),
            this.normalizeText(payload.adminEmail).toLowerCase(),
            sessionId,
            this.normalizeText(payload.ip),
            this.normalizeText(payload.userAgent),
            this.normalizeText(payload.device, 'Unknown'),
            this.normalizeText(payload.browser),
            this.normalizeText(payload.os),
            this.normalizeText(payload.country),
            this.normalizeText(payload.city),
            this.normalizeText(payload.deviceName, this.normalizeText(payload.device, 'Unknown')),
            this.normalizeText(payload.deviceFingerprint),
            this.normalizeText(payload.status, 'success'),
            this.stringifyJson(payload.meta || {}, {}),
            now
        );

        return this.mapLoginRow(
            this.db.prepare('SELECT * FROM admin_login_history WHERE id = ? LIMIT 1').get(result.lastInsertRowid)
        );
    }

    async markLoginLogout(sessionId, logoutAt = null) {
        const sid = this.normalizeText(sessionId);
        if (!sid) return null;
        const when = this.now(logoutAt);
        this.db.prepare(`
            UPDATE admin_login_history
            SET logout_at = COALESCE(logout_at, ?)
            WHERE session_id = ? AND logout_at IS NULL
        `).run(when, sid);
        return this.mapLoginRow(
            this.db.prepare(`
                SELECT * FROM admin_login_history WHERE session_id = ? ORDER BY id DESC LIMIT 1
            `).get(sid)
        );
    }

    async listLoginHistory(adminPublicId, {
        query = '',
        status = '',
        page = 1,
        limit = 20,
        sort = 'created_at_desc'
    } = {}) {
        const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
        const safePage = Math.max(1, Number(page) || 1);
        const offset = (safePage - 1) * safeLimit;
        const params = [this.normalizeText(adminPublicId)];
        let where = 'WHERE admin_public_id = ?';

        const normalizedStatus = this.normalizeText(status).toLowerCase();
        if (normalizedStatus && normalizedStatus !== 'all') {
            where += ' AND lower(status) = ?';
            params.push(normalizedStatus);
        }

        const normalizedQuery = this.normalizeText(query).toLowerCase();
        if (normalizedQuery) {
            const like = `%${normalizedQuery.replace(/[%_]/g, '')}%`;
            where += ` AND (
                lower(COALESCE(ip, '')) LIKE ?
                OR lower(COALESCE(device, '')) LIKE ?
                OR lower(COALESCE(device_name, '')) LIKE ?
                OR lower(COALESCE(browser, '')) LIKE ?
                OR lower(COALESCE(os, '')) LIKE ?
                OR lower(COALESCE(country, '')) LIKE ?
                OR lower(COALESCE(city, '')) LIKE ?
                OR lower(COALESCE(status, '')) LIKE ?
            )`;
            params.push(like, like, like, like, like, like, like, like);
        }

        const orderMap = {
            created_at_asc: 'created_at ASC, id ASC',
            created_at_desc: 'created_at DESC, id DESC',
            status_asc: 'lower(status) ASC, created_at DESC',
            status_desc: 'lower(status) DESC, created_at DESC',
            ip_asc: 'ip ASC, created_at DESC',
            ip_desc: 'ip DESC, created_at DESC'
        };
        const orderBy = orderMap[this.normalizeText(sort).toLowerCase()] || orderMap.created_at_desc;

        const total = Number(
            this.db.prepare(`SELECT COUNT(*) AS total FROM admin_login_history ${where}`).get(...params)?.total || 0
        );

        const items = this.db.prepare(`
            SELECT * FROM admin_login_history
            ${where}
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
        `).all(...params, safeLimit, offset).map((row) => this.mapLoginRow(row));

        return {
            items,
            pagination: {
                page: safePage,
                limit: safeLimit,
                total,
                totalPages: Math.max(1, Math.ceil(total / safeLimit))
            }
        };
    }

    async createSession(payload = {}) {
        const now = this.now();
        const sessionId = this.normalizeText(payload.sessionId) || this.createSessionId();
        this.db.prepare(`
            INSERT INTO admin_sessions (
                session_id, admin_public_id, admin_email, token_fingerprint, device_fingerprint,
                device_name, browser, os, ip, user_agent, country, city,
                created_at, last_activity_at, expires_at, revoked_at, revoke_reason, meta_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '', ?)
        `).run(
            sessionId,
            this.normalizeText(payload.adminPublicId),
            this.normalizeText(payload.adminEmail).toLowerCase(),
            this.normalizeText(payload.tokenFingerprint),
            this.normalizeText(payload.deviceFingerprint),
            this.normalizeText(payload.deviceName, 'Unknown device'),
            this.normalizeText(payload.browser),
            this.normalizeText(payload.os),
            this.normalizeText(payload.ip),
            this.normalizeText(payload.userAgent),
            this.normalizeText(payload.country),
            this.normalizeText(payload.city),
            now,
            now,
            payload.expiresAt ? this.now(payload.expiresAt) : null,
            this.stringifyJson(payload.meta || {}, {})
        );

        return this.findSessionById(sessionId);
    }

    async findSessionById(sessionId) {
        return this.mapSessionRow(
            this.db.prepare('SELECT * FROM admin_sessions WHERE session_id = ? LIMIT 1')
                .get(this.normalizeText(sessionId))
        );
    }

    async listActiveSessions(adminPublicId) {
        const now = this.now();
        return this.db.prepare(`
            SELECT * FROM admin_sessions
            WHERE admin_public_id = ?
              AND revoked_at IS NULL
              AND (expires_at IS NULL OR expires_at > ?)
            ORDER BY last_activity_at DESC, id DESC
        `).all(this.normalizeText(adminPublicId), now).map((row) => this.mapSessionRow(row));
    }

    async touchSession(sessionId, { ip = '', minIntervalMs = 120000 } = {}) {
        const existing = await this.findSessionById(sessionId);
        if (!existing || existing.revokedAt) {
            return existing;
        }

        const last = existing.lastActivityAt ? new Date(existing.lastActivityAt).getTime() : 0;
        if (Number.isFinite(last) && Date.now() - last < minIntervalMs) {
            return existing;
        }

        const now = this.now();
        this.db.prepare(`
            UPDATE admin_sessions
            SET last_activity_at = ?, ip = CASE WHEN ? <> '' THEN ? ELSE ip END
            WHERE session_id = ? AND revoked_at IS NULL
        `).run(now, this.normalizeText(ip), this.normalizeText(ip), this.normalizeText(sessionId));

        return this.findSessionById(sessionId);
    }

    async revokeSession(sessionId, { reason = 'terminated', logoutHistory = true } = {}) {
        const existing = await this.findSessionById(sessionId);
        if (!existing) {
            return null;
        }
        if (existing.revokedAt) {
            return existing;
        }

        const now = this.now();
        this.db.prepare(`
            UPDATE admin_sessions
            SET revoked_at = ?, revoke_reason = ?, last_activity_at = ?
            WHERE session_id = ?
        `).run(now, this.normalizeText(reason, 'terminated'), now, this.normalizeText(sessionId));

        if (logoutHistory) {
            await this.markLoginLogout(sessionId, now);
        }

        return this.findSessionById(sessionId);
    }

    async revokeOtherSessions(adminPublicId, currentSessionId, reason = 'logout_others') {
        const sessions = await this.listActiveSessions(adminPublicId);
        const revoked = [];
        for (const session of sessions) {
            if (session.sessionId === this.normalizeText(currentSessionId)) {
                continue;
            }
            const next = await this.revokeSession(session.sessionId, { reason });
            if (next) revoked.push(next);
        }
        return revoked;
    }

    async revokeAllSessions(adminPublicId, reason = 'logout_all') {
        const sessions = await this.listActiveSessions(adminPublicId);
        const revoked = [];
        for (const session of sessions) {
            const next = await this.revokeSession(session.sessionId, { reason });
            if (next) revoked.push(next);
        }
        return revoked;
    }

    async purgeExpiredSessions(adminPublicId = '') {
        const now = this.now();
        const params = [now];
        let sql = `
            SELECT * FROM admin_sessions
            WHERE revoked_at IS NULL
              AND expires_at IS NOT NULL
              AND expires_at <= ?
        `;
        if (adminPublicId) {
            sql += ' AND admin_public_id = ?';
            params.push(this.normalizeText(adminPublicId));
        }
        const rows = this.db.prepare(sql).all(...params).map((row) => this.mapSessionRow(row));
        const purged = [];
        for (const session of rows) {
            const next = await this.revokeSession(session.sessionId, { reason: 'session_expired' });
            if (next) purged.push(next);
        }
        return purged;
    }

    async isSessionActive(sessionId) {
        const session = await this.findSessionById(sessionId);
        if (!session || session.revokedAt) {
            return false;
        }
        if (session.expiresAt) {
            const expires = new Date(session.expiresAt).getTime();
            if (Number.isFinite(expires) && expires <= Date.now()) {
                return false;
            }
        }
        return true;
    }

    async listTrustedDevices(adminPublicId) {
        return this.db.prepare(`
            SELECT * FROM admin_trusted_devices
            WHERE admin_public_id = ?
            ORDER BY last_activity_at DESC, id DESC
        `).all(this.normalizeText(adminPublicId)).map((row) => this.mapTrustedDeviceRow(row));
    }

    async findTrustedDevice(adminPublicId, deviceFingerprint) {
        return this.mapTrustedDeviceRow(this.db.prepare(`
            SELECT * FROM admin_trusted_devices
            WHERE admin_public_id = ? AND device_fingerprint = ?
            LIMIT 1
        `).get(this.normalizeText(adminPublicId), this.normalizeText(deviceFingerprint)));
    }

    async findTrustedDeviceById(adminPublicId, deviceId) {
        return this.mapTrustedDeviceRow(this.db.prepare(`
            SELECT * FROM admin_trusted_devices
            WHERE admin_public_id = ? AND id = ?
            LIMIT 1
        `).get(this.normalizeText(adminPublicId), Number(deviceId)));
    }

    async upsertTrustedDevice(payload = {}) {
        const existing = await this.findTrustedDevice(payload.adminPublicId, payload.deviceFingerprint);
        const now = this.now();

        if (existing) {
            this.db.prepare(`
                UPDATE admin_trusted_devices
                SET device_name = ?, browser = ?, os = ?, ip = ?, user_agent = ?,
                    last_activity_at = ?, meta_json = ?
                WHERE id = ?
            `).run(
                this.normalizeText(payload.deviceName, existing.deviceName),
                this.normalizeText(payload.browser, existing.browser),
                this.normalizeText(payload.os, existing.os),
                this.normalizeText(payload.ip, existing.ip),
                this.normalizeText(payload.userAgent, existing.userAgent),
                now,
                this.stringifyJson(payload.meta || existing.meta || {}, {}),
                existing.id
            );
            return this.findTrustedDeviceById(payload.adminPublicId, existing.id);
        }

        const result = this.db.prepare(`
            INSERT INTO admin_trusted_devices (
                admin_public_id, admin_email, device_fingerprint, device_name,
                browser, os, ip, user_agent, created_at, last_activity_at, meta_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            this.normalizeText(payload.adminPublicId),
            this.normalizeText(payload.adminEmail).toLowerCase(),
            this.normalizeText(payload.deviceFingerprint),
            this.normalizeText(payload.deviceName, 'Trusted device'),
            this.normalizeText(payload.browser),
            this.normalizeText(payload.os),
            this.normalizeText(payload.ip),
            this.normalizeText(payload.userAgent),
            now,
            now,
            this.stringifyJson(payload.meta || {}, {})
        );

        return this.findTrustedDeviceById(payload.adminPublicId, result.lastInsertRowid);
    }

    async renameTrustedDevice(adminPublicId, deviceId, deviceName) {
        const existing = await this.findTrustedDeviceById(adminPublicId, deviceId);
        if (!existing) return null;
        this.db.prepare(`
            UPDATE admin_trusted_devices SET device_name = ? WHERE id = ? AND admin_public_id = ?
        `).run(this.normalizeText(deviceName, existing.deviceName), Number(deviceId), this.normalizeText(adminPublicId));
        return this.findTrustedDeviceById(adminPublicId, deviceId);
    }

    async removeTrustedDevice(adminPublicId, deviceId) {
        const existing = await this.findTrustedDeviceById(adminPublicId, deviceId);
        if (!existing) return null;
        this.db.prepare(`
            DELETE FROM admin_trusted_devices WHERE id = ? AND admin_public_id = ?
        `).run(Number(deviceId), this.normalizeText(adminPublicId));
        return existing;
    }

    async touchTrustedDevice(adminPublicId, deviceFingerprint, ip = '') {
        const existing = await this.findTrustedDevice(adminPublicId, deviceFingerprint);
        if (!existing) return null;
        const now = this.now();
        this.db.prepare(`
            UPDATE admin_trusted_devices
            SET last_activity_at = ?, ip = CASE WHEN ? <> '' THEN ? ELSE ip END
            WHERE id = ?
        `).run(now, this.normalizeText(ip), this.normalizeText(ip), existing.id);
        return this.findTrustedDeviceById(adminPublicId, existing.id);
    }
}

module.exports = new SQLiteAdminSecurityRepository();
