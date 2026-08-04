const Database = require('better-sqlite3');
const env = require('../config/env');

const db = new Database(env.sqlite.databasePath, { readonly: true });
const migrations = db.prepare('SELECT name FROM schema_migrations ORDER BY name').all();
const cols = db.prepare('PRAGMA table_info(products)').all().map((row) => row.name);
const indexes = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'products' ORDER BY name"
).all();
const fts = db.prepare("SELECT name FROM sqlite_master WHERE name = 'products_fts'").get();
const integrity = db.prepare('PRAGMA integrity_check').get();
const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
const count = db.prepare('SELECT COUNT(*) AS c FROM products').get();
const publishedCount = cols.includes('is_published')
    ? db.prepare('SELECT COUNT(*) AS c FROM products WHERE is_published = 1').get().c
    : 'n/a';
const orphanImages = db.prepare(`
    SELECT COUNT(*) AS c FROM product_images
    WHERE product_id NOT IN (SELECT id FROM products)
`).get().c;

console.log(JSON.stringify({
    db: env.sqlite.databasePath,
    migrations: migrations.map((row) => row.name),
    hasIsPublished: cols.includes('is_published'),
    fts: Boolean(fts),
    integrity,
    foreignKeyViolations: foreignKeys.length,
    productCount: count.c,
    publishedCount,
    orphanImages,
    productIndexes: indexes.map((row) => row.name)
}, null, 2));

db.close();
