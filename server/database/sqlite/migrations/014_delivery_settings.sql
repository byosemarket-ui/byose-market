-- Delivery zones for zone-based shipping configuration.
CREATE TABLE IF NOT EXISTS delivery_zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'Rwanda',
    province_city TEXT NOT NULL DEFAULT '',
    district TEXT NOT NULL DEFAULT '',
    sector TEXT NOT NULL DEFAULT '',
    cell TEXT NOT NULL DEFAULT '',
    village TEXT NOT NULL DEFAULT '',
    fee REAL NOT NULL DEFAULT 2000,
    estimated_days_min INTEGER NOT NULL DEFAULT 1,
    estimated_days_max INTEGER NOT NULL DEFAULT 3,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_delivery_zones_enabled ON delivery_zones (enabled, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_delivery_zones_location ON delivery_zones (country, province_city, district);

-- Seed a default Kigali home-delivery zone matching the historical flat fee.
INSERT OR IGNORE INTO delivery_zones (
    public_id, name, country, province_city, district, sector, cell, village,
    fee, estimated_days_min, estimated_days_max, enabled, sort_order, notes
) VALUES (
    'zone_kigali_default',
    'Kigali Metro',
    'Rwanda',
    'Kigali',
    '',
    '',
    '',
    '',
    2000,
    1,
    2,
    1,
    10,
    'Default seeded zone for Kigali deliveries'
);

INSERT OR IGNORE INTO delivery_zones (
    public_id, name, country, province_city, district, sector, cell, village,
    fee, estimated_days_min, estimated_days_max, enabled, sort_order, notes
) VALUES (
    'zone_rwanda_default',
    'Rest of Rwanda',
    'Rwanda',
    '',
    '',
    '',
    '',
    '',
    3500,
    2,
    5,
    1,
    100,
    'Fallback national coverage zone'
);
