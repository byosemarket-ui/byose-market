-- STEP 7: Integration hardening — coupon redemption uniqueness + customer notifications

CREATE UNIQUE INDEX IF NOT EXISTS idx_coupon_redemptions_order_id_unique
ON coupon_redemptions(order_id)
WHERE order_id IS NOT NULL AND order_id != '';

CREATE TABLE IF NOT EXISTS customer_notification_prefs (
    user_id INTEGER PRIMARY KEY,
    orders INTEGER NOT NULL DEFAULT 1,
    shipping INTEGER NOT NULL DEFAULT 1,
    promo INTEGER NOT NULL DEFAULT 1,
    system INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    deeplink TEXT NOT NULL DEFAULT '',
    entity_type TEXT NOT NULL DEFAULT '',
    entity_id TEXT NOT NULL DEFAULT '',
    dedupe_key TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_notifications_user_created
ON customer_notifications(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_notifications_dedupe
ON customer_notifications(user_id, dedupe_key)
WHERE dedupe_key IS NOT NULL AND dedupe_key != '';
