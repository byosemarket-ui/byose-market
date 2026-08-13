/**
 * Seed a color/size variant product into local SQLite for checkout E2E.
 * Run: node scripts/seed-local-variant-product.mjs
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const db = new Database('server/database/byosemarket.sqlite');
const catalogId = 12012;
const name = 'PRECIOUS AH+H Premium White Breathable Sports Walking Sneakers for Men & Women';
const variants = {
  enabled: true,
  optionMode: 'structured',
  colorVariants: [
    {
      id: 'white-with-grey-details-black',
      colorName: 'White with Grey Details & Black',
      image: '/img/logo.png',
      sizes: [
        { size: '42', value: '42', stock: 5, label: '42' },
        { size: '43', value: '43', stock: 5, label: '43' }
      ],
      totalStock: 10
    }
  ]
};

const existing = db.prepare('SELECT id FROM products WHERE catalog_id = ?').get(catalogId);
const now = new Date().toISOString();
if (existing) {
  db.prepare(`
    UPDATE products
    SET name = ?, title = ?, stock = 10, price = 25000, old_price = 30000,
        variants_json = ?, metadata_json = ?, visibility = 'both', status = 'active',
        updated_at = ?
    WHERE catalog_id = ?
  `).run(name, name, JSON.stringify(variants), JSON.stringify({ colorVariants: variants.colorVariants }), now, catalogId);
  console.log('UPDATED catalog_id', catalogId, 'row', existing.id);
} else {
  const info = db.prepare(`
    INSERT INTO products (
      catalog_id, category_id, category_slug, name, title, description, short_description,
      price, old_price, stock, image, main_image, variants_json, metadata_json,
      visibility, status, created_at, updated_at
    ) VALUES (?, NULL, 'sneakers', ?, ?, '', '', 25000, 30000, 10, '/img/logo.png', '/img/logo.png', ?, ?, 'both', 'active', ?, ?)
  `).run(
    catalogId,
    name,
    name,
    JSON.stringify(variants),
    JSON.stringify({ colorVariants: variants.colorVariants }),
    now,
    now
  );
  console.log('INSERTED catalog_id', catalogId, 'row', info.lastInsertRowid);
}

db.close();
console.log(JSON.stringify({ catalogId, name, colorId: 'white-with-grey-details-black', size: '42', extraSize: '43', stock: 5 }, null, 2));
