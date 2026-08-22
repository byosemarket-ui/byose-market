#!/usr/bin/env node
/**
 * Point products at the storefront placeholder when their upload files are missing.
 * Safe to re-run; only updates rows whose managed image path is absent on disk.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config/env');
const { normalizeManagedPath, resolveManagedAbsolutePath } = require('../services/uploadstorage.service');

const PLACEHOLDER = 'img/logo.png';
const uploadsRoot = path.resolve(config.uploads?.rootDir || process.env.UPLOADS_DIR || path.join(__dirname, '../uploads'));
const dbPath = path.resolve(
  process.env.SQLITE_DB_PATH
  || config.sqlite?.databasePath
  || path.join(__dirname, '../database/byosemarket.sqlite')
);

function managedExists(value) {
    const managed = normalizeManagedPath(value);
    if (!managed || managed === PLACEHOLDER) {
        return true;
    }
    const absolute = resolveManagedAbsolutePath(managed);
    return Boolean(absolute && fs.existsSync(absolute) && fs.statSync(absolute).size > 0);
}

const db = new Database(dbPath);
const rows = db.prepare(`
  SELECT p.id, p.catalog_id, p.image, p.main_image
  FROM products p
  ORDER BY p.catalog_id
`).all();

let updated = 0;
const updateProduct = db.prepare(`
  UPDATE products
  SET image = ?, main_image = ?, updated_at = datetime('now')
  WHERE id = ?
`);
const deleteImages = db.prepare('DELETE FROM product_images WHERE product_id = ?');

for (const row of rows) {
    const raw = row.main_image || row.image || '';
    if (!raw || raw === PLACEHOLDER || managedExists(raw)) {
        continue;
    }

    updateProduct.run(PLACEHOLDER, PLACEHOLDER, row.id);
    deleteImages.run(row.id);
    updated += 1;
    process.stdout.write(`fixed catalog_id=${row.catalog_id} missing=${raw}\n`);
}

process.stdout.write(JSON.stringify({ updated, uploadsRoot, dbPath }) + '\n');
