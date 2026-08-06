CREATE TABLE IF NOT EXISTS hero_slides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slide_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    subtitle TEXT NOT NULL DEFAULT '',
    button_text TEXT NOT NULL DEFAULT '',
    button_link TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    image_path TEXT NOT NULL DEFAULT '',
    display_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    meta_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hero_slides_status_order ON hero_slides (status, display_order ASC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hero_slides_display_order ON hero_slides (display_order ASC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_hero_slides_created_updated ON hero_slides (created_at DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_hero_slides_title ON hero_slides (title);
