-- Admin Security Center: sessions, trusted devices, richer login history, 2FA placeholders.

ALTER TABLE admin_login_history ADD COLUMN browser TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_login_history ADD COLUMN os TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_login_history ADD COLUMN country TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_login_history ADD COLUMN city TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_login_history ADD COLUMN device_name TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_login_history ADD COLUMN device_fingerprint TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_login_history ADD COLUMN logout_at TEXT;

CREATE INDEX IF NOT EXISTS idx_admin_login_history_status_created
    ON admin_login_history (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_login_history_fingerprint
    ON admin_login_history (device_fingerprint, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL UNIQUE,
    admin_public_id TEXT NOT NULL DEFAULT '',
    admin_email TEXT NOT NULL DEFAULT '',
    token_fingerprint TEXT NOT NULL DEFAULT '',
    device_fingerprint TEXT NOT NULL DEFAULT '',
    device_name TEXT NOT NULL DEFAULT '',
    browser TEXT NOT NULL DEFAULT '',
    os TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT,
    revoked_at TEXT,
    revoke_reason TEXT NOT NULL DEFAULT '',
    meta_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_active
    ON admin_sessions (admin_public_id, revoked_at, last_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_token_fingerprint
    ON admin_sessions (token_fingerprint);

CREATE TABLE IF NOT EXISTS admin_trusted_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_public_id TEXT NOT NULL DEFAULT '',
    admin_email TEXT NOT NULL DEFAULT '',
    device_fingerprint TEXT NOT NULL DEFAULT '',
    device_name TEXT NOT NULL DEFAULT '',
    browser TEXT NOT NULL DEFAULT '',
    os TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    meta_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE (admin_public_id, device_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_admin_trusted_devices_admin
    ON admin_trusted_devices (admin_public_id, last_activity_at DESC);

ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN two_factor_method TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN two_factor_updated_at TEXT;
