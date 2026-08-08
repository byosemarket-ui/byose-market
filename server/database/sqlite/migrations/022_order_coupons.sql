-- Order coupon fields + starter public coupons for customer My Coupons

ALTER TABLE orders ADD COLUMN coupon_code TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN coupon_discount REAL NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN coupon_id INTEGER REFERENCES coupons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_coupon_code ON orders(coupon_code);

INSERT OR IGNORE INTO coupons (
    code, title, description, discount_type, discount_value, min_order_amount, max_discount_amount,
    starts_at, expires_at, usage_limit, usage_count, per_user_limit, status, metadata_json, created_at, updated_at
) VALUES (
    'WELCOME10',
    'Welcome 10% Off',
    'Save 10% on your first eligible order of RWF 10,000 or more.',
    'percent',
    10,
    10000,
    5000,
    CURRENT_TIMESTAMP,
    datetime('now', '+180 days'),
    0,
    0,
    1,
    'active',
    '{"isPublic":true,"applicableProducts":"all","applicableCategories":"all"}',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO coupons (
    code, title, description, discount_type, discount_value, min_order_amount, max_discount_amount,
    starts_at, expires_at, usage_limit, usage_count, per_user_limit, status, metadata_json, created_at, updated_at
) VALUES (
    'SAVE2000',
    'Save RWF 2,000',
    'Get RWF 2,000 off when your cart reaches RWF 25,000.',
    'fixed',
    2000,
    25000,
    0,
    CURRENT_TIMESTAMP,
    datetime('now', '+120 days'),
    500,
    0,
    1,
    'active',
    '{"isPublic":true,"applicableProducts":"all","applicableCategories":"all"}',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);
