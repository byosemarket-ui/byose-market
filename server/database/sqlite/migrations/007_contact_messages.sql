CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE,
    user_record_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_public_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'contact-form',
    status TEXT NOT NULL DEFAULT 'New',
    meta_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_status_created ON contact_messages (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_source_created ON contact_messages (source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_user_public_id ON contact_messages (user_public_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_email ON contact_messages (email);
CREATE INDEX IF NOT EXISTS idx_contact_messages_phone ON contact_messages (phone);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created_updated ON contact_messages (created_at DESC, updated_at DESC);
