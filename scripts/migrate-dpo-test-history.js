#!/usr/bin/env node
/**
 * Archive/remove proven synthetic DPO TEST payment history.
 *
 * Default is dry-run. Destructive apply requires --apply after a verified backup.
 *
 * Usage:
 *   node scripts/migrate-dpo-test-history.js --db /path/to/byosemarket.sqlite
 *   node scripts/migrate-dpo-test-history.js --db /path/to/byosemarket.sqlite --apply --backup-dir /var/backups/byose-market
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const Database = require('better-sqlite3');
const {
    classifyOrder,
    parseJson
} = require('../server/payments/dpo/test-history.classifier');

function argValue(name, fallback = '') {
    const index = process.argv.indexOf(name);
    if (index === -1 || !process.argv[index + 1]) return fallback;
    return String(process.argv[index + 1]);
}

function hasFlag(name) {
    return process.argv.includes(name);
}

function stamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function mapOrder(row, items = []) {
    return {
        ...row,
        orderId: row.order_id,
        customerName: row.customer_name,
        customerEmail: row.customer_email,
        userEmail: row.user_email,
        paymentMethod: row.payment_method,
        payment: parseJson(row.payment_json, {}),
        shippingAddress: parseJson(row.shipping_address_json, {}),
        items: items.map((item) => ({
            productId: item.product_catalog_id,
            id: item.product_catalog_id,
            quantity: item.quantity,
            color: item.color,
            size: item.size,
            attributes: parseJson(item.attributes_json, {})
        }))
    };
}

function summarize(db) {
    const rows = db.prepare('SELECT * FROM orders ORDER BY id ASC').all();
    const itemStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
    const groups = {};
    const removable = [];
    const preserved = [];

    rows.forEach((row) => {
        const items = itemStmt.all(Number(row.id));
        const classified = classifyOrder(mapOrder(row, items));
        groups[classified.className] = (groups[classified.className] || 0) + 1;
        const entry = {
            id: Number(row.id),
            orderId: row.order_id,
            customerName: row.customer_name,
            paymentMethod: row.payment_method,
            paymentStatus: row.payment_status,
            className: classified.className,
            reason: classified.reason,
            items
        };
        if (classified.removable) removable.push(entry);
        else preserved.push(entry);
    });

    return {
        totalOrders: rows.length,
        groups,
        removable,
        preserved,
        live: groups.LIVE || 0,
        ambiguousTest: groups.AMBIGUOUS_TEST || 0,
        ambiguous: groups.AMBIGUOUS || 0,
        syntheticTest: groups.SYNTHETIC_TEST || 0,
        syntheticCod: groups.SYNTHETIC_COD || 0
    };
}

function countByName(rows) {
    return rows.reduce((acc, row) => {
        const name = row.customerName || '(blank)';
        acc[name] = (acc[name] || 0) + 1;
        return acc;
    }, {});
}

function cloneTableSql(source, tableName) {
    const row = source.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
    if (!row?.sql) {
        throw new Error(`Cannot clone schema for ${tableName}`);
    }
    return row.sql;
}

async function backupDatabase(db, backupDir) {
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `byosemarket-sqlite-${stamp()}.sqlite`);
    await db.backup(backupPath);
    const verify = new Database(backupPath, { readonly: true, fileMustExist: true });
    const integrity = String(verify.pragma('integrity_check', { simple: true }) || '');
    const orderCount = verify.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
    verify.close();
    const stat = fs.statSync(backupPath);
    if (!/^ok$/i.test(integrity)) {
        throw new Error(`Backup integrity check failed: ${integrity}`);
    }
    if (!stat.size) {
        throw new Error('Backup file is empty.');
    }
    return {
        backupPath,
        bytes: stat.size,
        integrity,
        orderCount
    };
}

function clearLastTest(db) {
    const row = db.prepare('SELECT id, value_json FROM settings LIMIT 1').get();
    if (!row) return false;
    const value = parseJson(row.value_json, {});
    if (!value.payment || value.payment.lastTest == null) return false;
    value.payment.lastTest = null;
    db.prepare('UPDATE settings SET value_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(JSON.stringify(value), row.id);
    return true;
}

function tableExists(db, name) {
    return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name));
}

async function main() {
    const apply = hasFlag('--apply');
    const dbPath = argValue('--db', path.resolve(__dirname, '../server/database/byosemarket.sqlite'));
    const backupDir = argValue('--backup-dir', '/var/backups/byose-market');
    if (!fs.existsSync(dbPath)) {
        console.error(`[migrate-dpo-test-history] database not found: ${dbPath}`);
        process.exit(1);
    }

    if (apply) {
        process.env.SQLITE_DB_PATH = dbPath;
        const { connectDatabase } = require('../server/database');
        await connectDatabase();
    }

    const db = apply
        ? require('../server/database/sqlite/client').getClient()
        : new Database(dbPath, { readonly: true, fileMustExist: true });

    const report = summarize(db);
    const dryRun = {
        ok: true,
        mode: apply ? 'apply' : 'dry-run',
        totals: {
            orders: report.totalOrders,
            syntheticTest: report.syntheticTest,
            syntheticCod: report.syntheticCod,
            removable: report.removable.length,
            live: report.live,
            ambiguousTest: report.ambiguousTest,
            ambiguous: report.ambiguous,
            preserved: report.preserved.length
        },
        groups: report.groups,
        removableNames: countByName(report.removable),
        preservedNames: countByName(report.preserved)
    };

    if (!apply) {
        console.log(JSON.stringify(dryRun, null, 2));
        db.close();
        return;
    }

    if (report.ambiguous) {
        console.error('[migrate-dpo-test-history] STOP: unclassified gateway records exist. No records were deleted.');
        console.log(JSON.stringify(dryRun, null, 2));
        process.exit(2);
    }

    const backup = await backupDatabase(db, backupDir);
    const archivePath = path.join(backupDir, `dpo-test-history-archive-${stamp()}.sqlite`);
    if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
    const archive = new Database(archivePath);
    archive.pragma('foreign_keys = OFF');
    archive.exec(cloneTableSql(db, 'orders'));
    archive.exec(cloneTableSql(db, 'order_items'));
    archive.exec('CREATE TABLE IF NOT EXISTS cleanup_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');

    const orderCols = db.prepare('PRAGMA table_info(orders)').all().map((col) => col.name);
    const itemCols = db.prepare('PRAGMA table_info(order_items)').all().map((col) => col.name);
    const insertOrder = archive.prepare(`INSERT INTO orders (${orderCols.map((name) => `"${name}"`).join(', ')}) VALUES (${orderCols.map(() => '?').join(', ')})`);
    const insertItem = archive.prepare(`INSERT INTO order_items (${itemCols.map((name) => `"${name}"`).join(', ')}) VALUES (${itemCols.map(() => '?').join(', ')})`);
    const productRepository = require('../server/repositories/sqlite/product.repository');

    const copyToArchive = archive.transaction(() => {
        report.removable.forEach((entry) => {
            const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(entry.id);
            if (!row) return;
            insertOrder.run(...orderCols.map((col) => row[col]));
            entry.items.forEach((item) => {
                insertItem.run(...itemCols.map((col) => item[col]));
            });
        });
        archive.prepare('INSERT OR REPLACE INTO cleanup_meta(key, value) VALUES (?, ?)').run('removedCount', String(report.removable.length));
        archive.prepare('INSERT OR REPLACE INTO cleanup_meta(key, value) VALUES (?, ?)').run('removedAt', new Date().toISOString());
        archive.prepare('INSERT OR REPLACE INTO cleanup_meta(key, value) VALUES (?, ?)').run('sourceBackup', backup.backupPath);
    });
    copyToArchive();

    const applyTxn = db.transaction(() => {
        report.removable.forEach((entry) => {
            const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(entry.id);
            if (!row) return;
            productRepository.restoreStockForOrderItems(mapOrder(row, entry.items).items);
            if (tableExists(db, 'coupon_redemptions')) {
                db.prepare('DELETE FROM coupon_redemptions WHERE order_id = ?').run(entry.orderId);
            }
            db.prepare('DELETE FROM order_items WHERE order_id = ?').run(entry.id);
            db.prepare('DELETE FROM orders WHERE id = ?').run(entry.id);
        });
        clearLastTest(db);
    });

    applyTxn();
    archive.close();

    const after = summarize(db);
    console.log(JSON.stringify({
        ...dryRun,
        backup: {
            path: backup.backupPath,
            bytes: backup.bytes,
            integrity: backup.integrity,
            orderCount: backup.orderCount
        },
        archivePath,
        after: {
            orders: after.totalOrders,
            removable: after.removable.length,
            live: after.live,
            ambiguousTest: after.ambiguousTest,
            preserved: after.preserved.length,
            groups: after.groups
        }
    }, null, 2));
}

main().catch((error) => {
    console.error('[migrate-dpo-test-history] FAIL:', error.message);
    process.exit(1);
});
