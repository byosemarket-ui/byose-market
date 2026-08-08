-- STEP 8 production hardening indexes (safe, additive)

CREATE INDEX IF NOT EXISTS idx_favorite_stores_store_id ON favorite_stores(store_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon_id ON coupon_redemptions(coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_user_coupon ON coupon_redemptions(user_id, coupon_id);
CREATE INDEX IF NOT EXISTS idx_customer_coupons_coupon_id ON customer_coupons(coupon_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_user_created ON wishlist_items(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recently_viewed_catalog ON recently_viewed_products(product_catalog_id);
CREATE INDEX IF NOT EXISTS idx_stores_slug ON stores(slug);
CREATE INDEX IF NOT EXISTS idx_stores_public_id ON stores(public_id);
