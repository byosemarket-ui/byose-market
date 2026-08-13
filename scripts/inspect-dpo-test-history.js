#!/usr/bin/env node
/**
 * Read-only classification of DPO TEST vs LIVE payment history.
 * Does not modify the database. Does not print secrets.
 *
 * Usage:
 *   node scripts/inspect-dpo-test-history.js --db /path/to/byosemarket.sqlite
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { classifyOrder, isGatewayMethod, parseJson } = require('../server/payments/dpo/test-history.classifier');

function argValue(name, fallback = '') {
    const index = process.argv.indexOf(name);
    if (index === -1 || !process.argv[index + 1]) return fallback;
    return String(process.argv[index + 1]);
}

function normalize(value) {
    return String(value == null ? '' : value).trim();
}

function maskRef(value) {
    const text = normalize(value);
    if (!text) return '';
    if (text.length <= 4) return '••••';
    return `${text.slice(0, 2)}…${text.slice(-4)}`;
}

function main() {
    const dbPath = argValue('--db', path.resolve(__dirname, '../server/database/byosemarket.sqlite'));
    if (!fs.existsSync(dbPath)) {
        console.error(`[inspect-dpo-test-history] database not found: ${dbPath}`);
        process.exit(1);
    }

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name);
    const orders = db.prepare(`
        SELECT id, order_id, customer_name, customer_email, user_email, payment_method, payment_status, status,
               payment_json, shipping_address_json, user_id, created_at, updated_at
        FROM orders
        ORDER BY datetime(coalesce(updated_at, created_at)) DESC
    `).all();

    const counts = {};
    const samples = {};
    const reasons = {};
    const nameCounts = {};
    let live = 0;
    let syntheticTest = 0;
    let ambiguousTest = 0;
    let ambiguous = 0;
    let syntheticCod = 0;
    let gateway = 0;

    orders.forEach((row) => {
        const payment = parseJson(row.payment_json, {});
        const gatewayObj = payment.gateway && typeof payment.gateway === 'object' ? payment.gateway : {};
        const classified = classifyOrder(row);
        counts[classified.className] = (counts[classified.className] || 0) + 1;
        reasons[classified.reason] = (reasons[classified.reason] || 0) + 1;
        nameCounts[normalize(row.customer_name) || '(blank)'] = (nameCounts[normalize(row.customer_name) || '(blank)'] || 0) + 1;
        if (isGatewayMethod(row.payment_method, gatewayObj)) gateway += 1;
        if (classified.className === 'LIVE') live += 1;
        if (classified.className === 'SYNTHETIC_TEST') syntheticTest += 1;
        if (classified.className === 'AMBIGUOUS_TEST') ambiguousTest += 1;
        if (classified.className === 'AMBIGUOUS') ambiguous += 1;
        if (classified.className === 'SYNTHETIC_COD') syntheticCod += 1;
        if (!samples[classified.className]) samples[classified.className] = [];
        if (samples[classified.className].length < 8) {
            samples[classified.className].push({
                orderId: row.order_id,
                customerName: row.customer_name || '',
                method: row.payment_method || '',
                paymentStatus: row.payment_status || '',
                orderStatus: row.status || '',
                mode: normalize(gatewayObj.mode) || '(missing)',
                serviceType: normalize(gatewayObj.serviceType) || '(missing)',
                transRef: maskRef(gatewayObj.transRef),
                reason: classified.reason,
                removable: classified.removable,
                createdAt: row.created_at
            });
        }
    });

    const itemCount = db.prepare('SELECT COUNT(*) AS n FROM order_items').get().n;
    const users = db.prepare('SELECT role, status, name FROM users').all();
    const settingsHasLastTest = Boolean(
        parseJson(
            db.prepare('SELECT value_json FROM settings LIMIT 1').get()?.value_json,
            {}
        )?.payment?.lastTest
    );

    console.log(JSON.stringify({
        ok: true,
        readonly: true,
        database: path.basename(dbPath),
        tables,
        totals: {
            orders: orders.length,
            orderItems: itemCount,
            users: users.length,
            gatewayOrders: gateway,
            live,
            syntheticTest,
            ambiguousTest,
            ambiguous,
            syntheticCod,
            settingsHasLastTest
        },
        classCounts: counts,
        reasons,
        nameCounts,
        users,
        samples
    }, null, 2));
}

main();
