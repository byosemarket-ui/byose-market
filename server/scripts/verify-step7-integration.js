const { initializeClient, closeClient, getClient } = require('../database/sqlite/client');
const { applyMigrations } = require('../database/sqlite/migrate');
const config = require('../config/env');

initializeClient();
applyMigrations(getClient(), config.sqlite.migrationsDir);

const migrations = getClient().prepare('SELECT name FROM schema_migrations ORDER BY name').all().map((r) => r.name);
console.log('has_025', migrations.includes('025_account_features_integration.sql'));
console.log('tables', getClient().prepare(`
  SELECT name FROM sqlite_master
  WHERE type='table' AND name IN ('customer_notifications','customer_notification_prefs')
`).all());
console.log('indexes', getClient().prepare(`
  SELECT name FROM sqlite_master
  WHERE type='index' AND name LIKE '%coupon_redemptions%' OR name LIKE '%customer_notifications%'
`).all());

closeClient();
console.log('OK');
