-- Admin Profile enrichment on the shared users table (role = 'admin').
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN job_title TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN department TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN preferred_language TEXT NOT NULL DEFAULT 'en';
ALTER TABLE users ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'Africa/Kigali';
ALTER TABLE users ADD COLUMN last_password_change_at TEXT;
ALTER TABLE users ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
    ON users (username)
    WHERE username IS NOT NULL AND TRIM(username) <> '';

CREATE INDEX IF NOT EXISTS idx_users_role_email
    ON users (role, email);

-- Persistent admin login history (replaces in-memory attempt map for successful logins).
CREATE TABLE IF NOT EXISTS admin_login_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_public_id TEXT NOT NULL DEFAULT '',
    admin_email TEXT NOT NULL DEFAULT '',
    session_id TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    device TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'success',
    meta_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_login_history_admin_created
    ON admin_login_history (admin_public_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_login_history_session
    ON admin_login_history (session_id);

-- Admin profile / security activity trail.
CREATE TABLE IF NOT EXISTS admin_activity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_public_id TEXT NOT NULL DEFAULT '',
    admin_email TEXT NOT NULL DEFAULT '',
    event_type TEXT NOT NULL DEFAULT 'profile_update',
    category TEXT NOT NULL DEFAULT 'profile',
    summary TEXT NOT NULL DEFAULT '',
    meta_json TEXT NOT NULL DEFAULT '{}',
    ip TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_activity_events_admin_created
    ON admin_activity_events (admin_public_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_activity_events_category_created
    ON admin_activity_events (category, created_at DESC);
