CREATE TABLE IF NOT EXISTS customer_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address_id TEXT NOT NULL UNIQUE,
    user_public_id TEXT NOT NULL,
    full_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    province_city TEXT NOT NULL DEFAULT '',
    district TEXT NOT NULL DEFAULT '',
    sector TEXT NOT NULL DEFAULT '',
    cell TEXT NOT NULL DEFAULT '',
    village TEXT NOT NULL DEFAULT '',
    street TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    latitude TEXT NOT NULL DEFAULT '',
    longitude TEXT NOT NULL DEFAULT '',
    map_link TEXT NOT NULL DEFAULT '',
    location_accuracy TEXT NOT NULL DEFAULT '',
    location_captured_at TEXT NOT NULL DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_user
    ON customer_addresses (user_public_id, is_default DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_address_id
    ON customer_addresses (address_id);
