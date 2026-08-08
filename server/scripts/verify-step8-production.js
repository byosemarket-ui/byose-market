const { initializeClient, closeClient, getClient } = require('../database/sqlite/client');
const { applyMigrations } = require('../database/sqlite/migrate');
const config = require('../config/env');

initializeClient();
applyMigrations(getClient(), config.sqlite.migrationsDir);

const db = getClient();
const migrations = db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map((r) => r.name);
const requiredIndexes = [
    'idx_favorite_stores_store_id',
    'idx_coupon_redemptions_coupon_id',
    'idx_coupon_redemptions_user_coupon',
    'idx_customer_coupons_coupon_id',
    'idx_wishlist_items_user_created',
    'idx_recently_viewed_catalog',
    'idx_stores_slug',
    'idx_stores_public_id',
    'idx_coupon_redemptions_order_id_unique'
];

const indexes = db.prepare(`
  SELECT name FROM sqlite_master
  WHERE type='index' AND name IN (${requiredIndexes.map(() => '?').join(',')})
`).all(...requiredIndexes).map((r) => r.name);

const missing = requiredIndexes.filter((name) => !indexes.includes(name));

console.log('has_026', migrations.includes('026_account_features_production.sql'));
console.log('indexes_ok', missing.length === 0, missing.length ? missing : undefined);

const coupons = require('../repositories/sqlite/coupon.repository');
Promise.resolve(coupons.releaseRedemptionForOrder('__step8_missing_order__'))
    .then((released) => {
        console.log('release_noop_ok', released == null);
        closeClient();
        if (!migrations.includes('026_account_features_production.sql') || missing.length) {
            process.exitCode = 1;
            console.error('STEP8_VERIFY_FAILED');
            return;
        }
        console.log('STEP8_VERIFY_OK');
    })
    .catch((error) => {
        console.error('STEP8_VERIFY_FAILED', error);
        closeClient();
        process.exitCode = 1;
    });
