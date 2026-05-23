CREATE TABLE IF NOT EXISTS customer_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_activity_id TEXT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_public_id TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    session_id TEXT NOT NULL DEFAULT '',
    event_type TEXT NOT NULL DEFAULT 'visit',
    path TEXT NOT NULL DEFAULT '',
    referrer TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    device TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    org TEXT NOT NULL DEFAULT '',
    duration INTEGER NOT NULL DEFAULT 0,
    meta_json TEXT NOT NULL DEFAULT '{}',
    started_at TEXT,
    ended_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_activities_client_event ON customer_activities (client_activity_id, event_type);
CREATE INDEX IF NOT EXISTS idx_customer_activities_event_created ON customer_activities (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_activities_user_public_id ON customer_activities (user_public_id, created_at DESC);
