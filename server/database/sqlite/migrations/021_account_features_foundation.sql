-- Account features foundation: wishlist, recently viewed, coupons, favorite stores

CREATE TABLE IF NOT EXISTS wishlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    product_catalog_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, product_catalog_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wishlist_items_user_id ON wishlist_items(user_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_catalog_id ON wishlist_items(product_catalog_id);

CREATE TABLE IF NOT EXISTS recently_viewed_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    product_catalog_id TEXT NOT NULL,
    viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, product_catalog_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recently_viewed_user_viewed ON recently_viewed_products(user_id, viewed_at DESC);

CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    discount_type TEXT NOT NULL DEFAULT 'percent',
    discount_value REAL NOT NULL DEFAULT 0,
    min_order_amount REAL NOT NULL DEFAULT 0,
    max_discount_amount REAL NOT NULL DEFAULT 0,
    starts_at TEXT,
    expires_at TEXT,
    usage_limit INTEGER NOT NULL DEFAULT 0,
    usage_count INTEGER NOT NULL DEFAULT 0,
    per_user_limit INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_status_expires ON coupons(status, expires_at);

CREATE TABLE IF NOT EXISTS customer_coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    coupon_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'available',
    assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    used_at TEXT,
    order_id TEXT NOT NULL DEFAULT '',
    UNIQUE(user_id, coupon_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_coupons_user_status ON customer_coupons(user_id, status);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    coupon_id INTEGER NOT NULL,
    order_id TEXT NOT NULL DEFAULT '',
    discount_amount REAL NOT NULL DEFAULT 0,
    redeemed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_user ON coupon_redemptions(user_id);

CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    logo TEXT NOT NULL DEFAULT '',
    banner TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stores_status ON stores(status);

CREATE TABLE IF NOT EXISTS favorite_stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    store_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, store_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_favorite_stores_user ON favorite_stores(user_id);

INSERT OR IGNORE INTO stores (
    public_id, name, slug, description, logo, status, metadata_json, created_at, updated_at
) VALUES (
    'STORE-BYOSE',
    'BYOSE Market',
    'byose-market',
    'Rwanda''s trusted online marketplace for fashion, shoes, electronics and everyday essentials.',
    '/img/logo.png',
    'active',
    '{"isPlatformStore":true}',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);
