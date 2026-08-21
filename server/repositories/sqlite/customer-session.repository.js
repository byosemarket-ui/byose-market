const SQLiteBaseRepository = require('./base.repository');

class SQLiteCustomerSessionRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'customer_sessions' });
        this._tableReady = false;
    }

    ensureTable() {
        if (this._tableReady) return;
        try {
            const row = this.db.prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'customer_sessions' LIMIT 1"
            ).get();
            this._tableReady = Boolean(row);
        } catch (_error) {
            this._tableReady = false;
        }
    }

    mapRow(row) {
        if (!row) {
            return null;
        }

        return {
            id: Number(row.id) || 0,
            sessionId: this.normalizeText(row.session_id),
            userPublicId: this.normalizeText(row.user_public_id),
            refreshTokenHash: this.normalizeText(row.refresh_token_hash),
            remember: Boolean(row.remember),
            userAgent: this.normalizeText(row.user_agent),
            ip: this.normalizeText(row.ip),
            createdAt: row.created_at || null,
            lastSeenAt: row.last_seen_at || null,
            expiresAt: row.expires_at || null,
            revokedAt: row.revoked_at || null,
            revokeReason: this.normalizeText(row.revoke_reason)
        };
    }

    create(session = {}) {
        this.ensureTable();
        if (!this._tableReady) {
            throw new Error('customer_sessions table is not available');
        }

        this.db.prepare(`
            INSERT INTO customer_sessions (
                session_id, user_public_id, refresh_token_hash, remember, user_agent, ip,
                created_at, last_seen_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            this.normalizeText(session.sessionId),
            this.normalizeText(session.userPublicId),
            this.normalizeText(session.refreshTokenHash),
            session.remember ? 1 : 0,
            this.normalizeText(session.userAgent),
            this.normalizeText(session.ip),
            this.now(session.createdAt),
            this.now(session.lastSeenAt || session.createdAt),
            this.normalizeText(session.expiresAt)
        );

        return this.findBySessionId(session.sessionId);
    }

    findBySessionId(sessionId) {
        this.ensureTable();
        if (!this._tableReady) return null;
        return this.mapRow(
            this.db.prepare('SELECT * FROM customer_sessions WHERE session_id = ? LIMIT 1')
                .get(this.normalizeText(sessionId))
        );
    }

    findByRefreshTokenHash(refreshTokenHash) {
        this.ensureTable();
        if (!this._tableReady) return null;
        return this.mapRow(
            this.db.prepare(`
                SELECT * FROM customer_sessions
                WHERE refresh_token_hash = ?
                ORDER BY id DESC
                LIMIT 1
            `).get(this.normalizeText(refreshTokenHash))
        );
    }

    touch(sessionId, { expiresAt } = {}) {
        this.ensureTable();
        if (!this._tableReady) return null;
        const now = this.now();
        if (expiresAt) {
            this.db.prepare(`
                UPDATE customer_sessions
                SET last_seen_at = ?, expires_at = ?
                WHERE session_id = ? AND revoked_at IS NULL
            `).run(now, this.normalizeText(expiresAt), this.normalizeText(sessionId));
        } else {
            this.db.prepare(`
                UPDATE customer_sessions
                SET last_seen_at = ?
                WHERE session_id = ? AND revoked_at IS NULL
            `).run(now, this.normalizeText(sessionId));
        }
        return this.findBySessionId(sessionId);
    }

    rotateRefreshToken(sessionId, refreshTokenHash, expiresAt) {
        this.ensureTable();
        if (!this._tableReady) return null;
        this.db.prepare(`
            UPDATE customer_sessions
            SET refresh_token_hash = ?, last_seen_at = ?, expires_at = ?
            WHERE session_id = ? AND revoked_at IS NULL
        `).run(
            this.normalizeText(refreshTokenHash),
            this.now(),
            this.normalizeText(expiresAt),
            this.normalizeText(sessionId)
        );
        return this.findBySessionId(sessionId);
    }

    revoke(sessionId, reason = 'logout') {
        this.ensureTable();
        if (!this._tableReady) return { changes: 0 };
        return this.db.prepare(`
            UPDATE customer_sessions
            SET revoked_at = ?, revoke_reason = ?
            WHERE session_id = ? AND revoked_at IS NULL
        `).run(this.now(), this.normalizeText(reason, 'logout'), this.normalizeText(sessionId));
    }

    revokeAllForUser(userPublicId, { exceptSessionId = '', reason = 'revoked' } = {}) {
        this.ensureTable();
        if (!this._tableReady) return { changes: 0 };
        const except = this.normalizeText(exceptSessionId);
        if (except) {
            return this.db.prepare(`
                UPDATE customer_sessions
                SET revoked_at = ?, revoke_reason = ?
                WHERE user_public_id = ? AND session_id <> ? AND revoked_at IS NULL
            `).run(this.now(), this.normalizeText(reason, 'revoked'), this.normalizeText(userPublicId), except);
        }
        return this.db.prepare(`
            UPDATE customer_sessions
            SET revoked_at = ?, revoke_reason = ?
            WHERE user_public_id = ? AND revoked_at IS NULL
        `).run(this.now(), this.normalizeText(reason, 'revoked'), this.normalizeText(userPublicId));
    }
}

module.exports = new SQLiteCustomerSessionRepository();
