#!/usr/bin/env node
/**
 * Production HTTP probe for DPO LIVE checkout.
 *
 * CONFIRM 404 for a nonexistent order ID is expected application behavior.
 * This probe fails only if confirmation is missing (nginx HTML 404) or
 * returns an unexpected status/body.
 *
 * Does not create orders, initiate DPO tokens, or perform a real-money charge.
 *
 * Run: node scripts/verify-dpo-production-probe.js
 */

const https = require('https');
const { URL } = require('url');

const ORIGIN = String(process.env.BYOSE_SITE_ORIGIN || 'https://byosemarket.com').replace(/\/+$/, '');
const failures = [];

function assert(condition, message) {
    if (!condition) failures.push(message);
}

function request(method, pathname, { body = null, headers = {} } = {}) {
    const url = new URL(pathname, `${ORIGIN}/`);
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    return new Promise((resolve) => {
        const req = https.request({
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || 443,
            path: `${url.pathname}${url.search}`,
            method,
            headers: {
                Accept: 'application/json, text/html;q=0.8',
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}),
                ...headers
            },
            timeout: 20000
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                let json = null;
                try { json = JSON.parse(raw); } catch (_error) { json = null; }
                resolve({
                    status: res.statusCode || 0,
                    contentType: String(res.headers['content-type'] || ''),
                    json,
                    raw
                });
            });
        });
        req.on('timeout', () => {
            req.destroy();
            resolve({ status: 0, contentType: '', json: null, raw: '', error: 'timeout' });
        });
        req.on('error', (error) => resolve({ status: 0, contentType: '', json: null, raw: '', error: error.message }));
        if (payload) req.write(payload);
        req.end();
    });
}

async function main() {
    console.log(`[verify-dpo-production-probe] ${ORIGIN}`);

    const health = await request('GET', '/healthz');
    assert(health.status === 200 && health.json?.status === 'ok', `healthz expected 200 ok, got ${health.status} ${health.raw}`);
    assert(health.json?.dbConnected === true, 'database must be connected');

    const config = await request('GET', '/api/payments/dpo/config');
    assert(config.status === 200 && config.json?.dpo?.enabled === true, `DPO config expected enabled, got ${config.status} ${config.raw}`);
    assert(config.json?.dpo?.label === 'Pay Online', 'public DPO config must stay customer-safe');
    assert(config.json?.dpo?.companyToken == null, 'public DPO config must not expose Company Token');

    const pages = [
        ['/', 'HOME'],
        ['/orders/payment.html', 'PAYMENT'],
        ['/orders/order-success.html', 'SUCCESS'],
        ['/admin/', 'ADMIN']
    ];
    for (const [path, label] of pages) {
        const page = await request('GET', path);
        assert(page.status === 200, `${label} expected 200, got ${page.status}`);
    }

    const paymentHtml = await request('GET', '/orders/payment.html');
    assert(/MTN MoMo, Card, or Cash on Delivery/i.test(paymentHtml.raw), 'payment page must list MTN MoMo, Card, COD');
    assert(!/id=["']couponBlock["']/.test(paymentHtml.raw), 'payment page must not show a Coupon section');
    assert(!/Airtel Money|Sandbox|TEST Service Type/i.test(paymentHtml.raw), 'payment page must not show TEST/Airtel');

    const adminPay = await request('GET', '/api/admin/payment');
    assert(adminPay.status === 401, `ADMIN_PAY_API expected 401 without auth, got ${adminPay.status}`);
    assert(adminPay.json?.code === 'ADMIN_TOKEN_MISSING' || /token|unauthor/i.test(String(adminPay.json?.message || '')), 'Admin payment API must stay authenticated');

    const confirm = await request('GET', '/api/orders/confirmation/DOES-NOT-EXIST');
    assert(confirm.status === 404, `CONFIRM missing order expected 404, got ${confirm.status}`);
    assert(/application\/json/i.test(confirm.contentType), `CONFIRM must be application JSON, got ${confirm.contentType}`);
    assert(confirm.json?.success === false, 'CONFIRM missing order must return success=false');
    assert(String(confirm.json?.message || '').toLowerCase() === 'order not found', `CONFIRM missing order must say Order not found, got ${confirm.raw}`);
    assert(!/<html/i.test(confirm.raw), 'CONFIRM 404 must come from the Node API, not an nginx HTML miss');

    const verify = await request('POST', '/api/payments/dpo/verify', { body: {} });
    assert(verify.status === 400, `DPO verify without orderId expected 400, got ${verify.status}`);
    assert(verify.json?.success === false, 'DPO verify without orderId must fail safely');
    assert(verify.status !== 404, 'DPO verify route must exist');

    const initiate = await request('POST', '/api/payments/dpo/initiate', { body: {} });
    assert(initiate.status === 400, `DPO initiate without orderId expected 400, got ${initiate.status}`);
    assert(initiate.status !== 404, 'DPO initiate route must exist');

    if (failures.length) {
        console.error('[verify-dpo-production-probe] FAIL:');
        failures.forEach((item) => console.error(` - ${item}`));
        process.exit(1);
    }

    console.log('[verify-dpo-production-probe] PASS');
    console.log(' CONFIRM GET /api/orders/confirmation/:id exists; missing order → 404 JSON Order not found');
    console.log(' ADMIN_PAY_API unauthenticated → 401');
    console.log(' DPO verify/initiate exist (400 without orderId, not 404)');
    console.log(' No real-money LIVE transaction was performed');
}

main().catch((error) => {
    console.error('[verify-dpo-production-probe] FAIL:', error.message);
    process.exit(1);
});
