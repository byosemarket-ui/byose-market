CREATE TABLE IF NOT EXISTS customer_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL UNIQUE,
    user_public_id TEXT NOT NULL,
    refresh_token_hash TEXT NOT NULL,
    remember INTEGER NOT NULL DEFAULT 1,
    user_agent TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    revoke_reason TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_user_active
    ON customer_sessions (user_public_id, revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_refresh_hash
    ON customer_sessions (refresh_token_hash);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_session_id
    ON customer_sessions (session_id);
