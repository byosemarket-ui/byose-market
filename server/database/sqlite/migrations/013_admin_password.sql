-- Admin password management: versioning, expiration architecture, hashed history only.

ALTER TABLE users ADD COLUMN password_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN password_expires_at TEXT;

CREATE TABLE IF NOT EXISTS admin_password_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_public_id TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    password_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    meta_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_admin_password_history_admin_created
    ON admin_password_history (admin_public_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_password_history_admin_version
    ON admin_password_history (admin_public_id, password_version DESC);
