#!/usr/bin/env node
/**
 * Verifies DPO Pay TEST API integration (STEP 2 — Option A).
 * Mocks DPO XML responses so the full Create Token → Verify → Order Update
 * flow can be tested without calling the live gateway or embedding secrets.
 *
 * Usage: node scripts/verify-dpo-payment-test.js [baseUrl]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

let expectedCompanyToken = '';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function request(baseUrl, method, routePath, { token = '', body = null, redirect = false } = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(routePath, `${baseUrl}/`);
        const transport = url.protocol === 'https:' ? https : http;
        const payload = body == null ? null : Buffer.from(JSON.stringify(body));
        const req = transport.request({
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port,
            path: `${url.pathname}${url.search}`,
            method,
            headers: {
                Accept: 'application/json, text/html',
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            }
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                let json = null;
                try { json = JSON.parse(raw); } catch (_error) { json = null; }
                resolve({
                    status: res.statusCode || 0,
                    headers: res.headers,
                    json,
                    raw,
                    location: res.headers.location || ''
                });
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function assertNoSecretLeak(payload, label, runtimeToken = expectedCompanyToken) {
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    assert(!/"companyToken"\s*:\s*"[^"]{8,}"/.test(serialized), `${label} leaked companyToken`);
    if (runtimeToken) {
        assert(!serialized.includes(runtimeToken), `${label} leaked runtime test company token`);
    }
    assert(!/"secrets"\s*:\s*\{/.test(serialized), `${label} exposed secrets object`);
}

function ensureEphemeralTestEnv() {
    if (!String(process.env.PAYMENT_ENCRYPTION_KEY || '').trim()) {
        process.env.PAYMENT_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    }
    if (!String(process.env.DPO_TEST_COMPANY_TOKEN || '').trim()) {
        process.env.DPO_TEST_COMPANY_TOKEN = `LOCAL-VERIFY-${crypto.randomBytes(12).toString('hex')}`;
    }
    if (!String(process.env.DPO_TEST_SERVICE_TYPE || '').trim()) {
        process.env.DPO_TEST_SERVICE_TYPE = '54841';
    }
    return {
        companyToken: String(process.env.DPO_TEST_COMPANY_TOKEN).trim(),
        serviceType: String(process.env.DPO_TEST_SERVICE_TYPE).trim()
    };
}

async function seedTestCredentials() {
    const ephemeral = ensureEphemeralTestEnv();

    const secretsStore = require('../server/payments/secrets.store');
    try {
        secretsStore.readStore();
    } catch (error) {
        if (
            error?.code === 'PAYMENT_CREDENTIALS_DECRYPT_FAILED'
            || error?.code === 'PAYMENT_CREDENTIALS_CORRUPT'
            || error?.code === 'PAYMENT_ENCRYPTION_KEY_MISSING'
        ) {
            const storePath = path.resolve(__dirname, '../server/secure/payment-credentials.enc');
            if (fs.existsSync(storePath)) {
                fs.unlinkSync(storePath);
                console.log('[verify-dpo-payment-test] reset undecryptable payment-credentials.enc');
            }
        } else {
            throw error;
        }
    }

    const paymentSettingsService = require('../server/services/paymentsettings.service');
    await paymentSettingsService.updatePaymentSettings({
        enabled: true,
        activeProvider: 'dpo',
        mode: 'test',
        credentials: {
            test: {
                companyToken: ephemeral.companyToken,
                serviceType: ephemeral.serviceType
            }
        }
    }, { id: 'ADMIN_VERIFY_DPO', email: 'admin@example.com' });

    expectedCompanyToken = ephemeral.companyToken;
    return ephemeral;
}

function installDpoMock(scenario = 'success') {
    const dpoClient = require('../server/payments/dpo/client');
    const transToken = `TOK-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;

    dpoClient.setHttpTransportForTests(async (_url, xmlBody) => {
        const body = String(xmlBody || '');
        if (body.includes('<Request>createToken</Request>')) {
            assert(Boolean(expectedCompanyToken) && body.includes(expectedCompanyToken), 'createToken missing company token in request XML');
            return {
                statusCode: 200,
                body: `<?xml version="1.0" encoding="utf-8"?><API3G><Result>000</Result><ResultExplanation>Transaction created</ResultExplanation><TransToken>${transToken}</TransToken><TransRef>REF123</TransRef></API3G>`
            };
        }

        if (body.includes('<Request>verifyToken</Request>')) {
            if (scenario === 'invalid') {
                return {
                    statusCode: 200,
                    body: '<?xml version="1.0" encoding="utf-8"?><API3G><Result>802</Result><ResultExplanation>Company token does not exist</ResultExplanation></API3G>'
                };
            }
            if (scenario === 'cancelled') {
                return {
                    statusCode: 200,
                    body: '<?xml version="1.0" encoding="utf-8"?><API3G><Result>904</Result><ResultExplanation>Transaction cancelled</ResultExplanation></API3G>'
                };
            }
            if (scenario === 'failed') {
                return {
                    statusCode: 200,
                    body: '<?xml version="1.0" encoding="utf-8"?><API3G><Result>901</Result><ResultExplanation>Transaction declined</ResultExplanation></API3G>'
                };
            }
            if (scenario === 'pending') {
                return {
                    statusCode: 200,
                    body: '<?xml version="1.0" encoding="utf-8"?><API3G><Result>900</Result><ResultExplanation>Transaction not paid yet</ResultExplanation></API3G>'
                };
            }
            return {
                statusCode: 200,
                body: `<?xml version="1.0" encoding="utf-8"?><API3G><Result>000</Result><ResultExplanation>Transaction Paid</ResultExplanation><TransToken>${transToken}</TransToken><TransRef>REF123</TransRef><TransactionAmount>15000.00</TransactionAmount><TransactionCurrency>RWF</TransactionCurrency></API3G>`
            };
        }

        throw new Error('Unexpected DPO request in mock transport');
    });

    return { transToken, dpoClient };
}

async function createFixtureOrder(orderId) {
    const orderDataService = require('../server/services/orderdataservice');
    // Empty items avoid stock decrement during verification fixtures.
    const order = {
        orderId,
        id: orderId,
        customerName: 'Verify Customer',
        customerEmail: 'verify@example.com',
        customerPhone: '0780000000',
        isGuest: true,
        status: 'Pending',
        orderStatus: 'pending',
        paymentStatus: 'awaiting_payment',
        paymentStatusLabel: 'Awaiting Payment',
        paymentMethod: 'dpo',
        paymentMethodLabel: 'DPO Pay',
        paymentType: 'pay_now',
        currency: 'RWF',
        subtotal: 13000,
        deliveryFee: 2000,
        total: 15000,
        totalAmount: 15000,
        items: [],
        products: [],
        shippingAddress: {
            fullName: 'Verify Customer',
            phone: '0780000000',
            provinceCity: 'Kigali',
            district: 'Gasabo',
            sector: 'Remera',
            cell: 'Rukiri',
            village: 'Test'
        },
        payment: {
            type: 'pay_now',
            method: 'dpo',
            methodLabel: 'DPO Pay',
            status: 'awaiting_payment',
            statusLabel: 'Awaiting Payment'
        },
        statusHistory: [],
        createdAt: new Date().toISOString()
    };

    const existing = await orderDataService.findOrderByIdentifier(orderId);
    if (existing) {
        await orderDataService.saveOrder({ ...existing, ...order, orderId, id: orderId });
        return orderId;
    }
    await orderDataService.createOrder(order);
    return orderId;
}

async function verifyClientHelpers() {
    const dpoClient = require('../server/payments/dpo/client');
    const { extractTag, redactXmlSecrets } = require('../server/payments/dpo/xml');

    const url = dpoClient.buildPaymentPageUrl('https://secure.3gdirectpay.com/payv3.php?ID=token', 'ABC123');
    assert(url === 'https://secure.3gdirectpay.com/payv3.php?ID=ABC123', 'payment URL template failed');

    const redacted = redactXmlSecrets('<API3G><CompanyToken>SECRET-VALUE</CompanyToken></API3G>');
    assert(!redacted.includes('SECRET-VALUE'), 'xml redaction failed');
    assert(extractTag('<A><Result>000</Result></A>', 'Result') === '000', 'extractTag failed');

    const paid = dpoClient.mapVerifyResultToPaymentStatus('000');
    const failed = dpoClient.mapVerifyResultToPaymentStatus('901');
    const cancelled = dpoClient.mapVerifyResultToPaymentStatus('904');
    const invalid = dpoClient.mapVerifyResultToPaymentStatus('802');
    assert(paid.outcome === 'success' && paid.paymentStatus === 'paid', 'paid mapping failed');
    assert(failed.outcome === 'failed', 'failed mapping failed');
    assert(cancelled.outcome === 'cancelled', 'cancelled mapping failed');
    assert(invalid.outcome === 'invalid_token', 'invalid mapping failed');
}

async function verifyServiceFlows() {
    const dpoPaymentService = require('../server/services/dpopayment.service');
    const orderDataService = require('../server/services/orderdataservice');

    // Success path
    const { dpoClient } = installDpoMock('success');
    const orderId = `DPO-TEST-${Date.now().toString().slice(-8)}`;
    await createFixtureOrder(orderId);

    const initiated = await dpoPaymentService.initiatePayment({
        orderId,
        req: { get: () => '', protocol: 'http' }
    });
    assert(initiated.paymentUrl.includes('payv3.php?ID='), 'initiate should return payv3 URL');
    assertNoSecretLeak(initiated, 'initiate result');

    const verified = await dpoPaymentService.verifyAndUpdateOrder({
        orderId,
        req: { get: () => '', protocol: 'http' }
    });
    assert(verified.outcome === 'success', `expected success, got ${verified.outcome}`);
    assert(verified.paymentStatus === 'paid', 'order should be paid');
    assertNoSecretLeak(verified, 'verify success');

    const paidOrder = await orderDataService.findOrderByIdentifier(orderId);
    assert(String(paidOrder.paymentStatus).toLowerCase() === 'paid', 'persisted paymentStatus paid');
    assert(paidOrder.payment?.gateway?.provider === 'dpo', 'gateway provider missing');
    assert(paidOrder.payment?.gateway?.mode === 'test', 'gateway mode should be test');
    assertNoSecretLeak(paidOrder.payment, 'saved order payment');

    // Failed path
    installDpoMock('failed');
    const failId = `${orderId}-F`;
    await createFixtureOrder(failId);
    await dpoPaymentService.initiatePayment({ orderId: failId, req: { get: () => '', protocol: 'http' } });
    const failed = await dpoPaymentService.verifyAndUpdateOrder({ orderId: failId, req: { get: () => '', protocol: 'http' } });
    assert(failed.outcome === 'failed', 'failed outcome expected');

    // Cancelled path (back URL)
    installDpoMock('success');
    const cancelId = `${orderId}-C`;
    await createFixtureOrder(cancelId);
    await dpoPaymentService.initiatePayment({ orderId: cancelId, req: { get: () => '', protocol: 'http' } });
    const cancelled = await dpoPaymentService.verifyAndUpdateOrder({
        orderId: cancelId,
        markCancelled: true,
        req: { get: () => '', protocol: 'http' }
    });
    assert(cancelled.outcome === 'cancelled', 'cancelled outcome expected');

    // Invalid token path
    installDpoMock('invalid');
    const invalidId = `${orderId}-I`;
    await createFixtureOrder(invalidId);
    await dpoPaymentService.initiatePayment({ orderId: invalidId, req: { get: () => '', protocol: 'http' } });
    const invalid = await dpoPaymentService.verifyAndUpdateOrder({ orderId: invalidId, req: { get: () => '', protocol: 'http' } });
    assert(invalid.outcome === 'invalid_token', 'invalid_token outcome expected');

    dpoClient.resetHttpTransport();
    return { orderId };
}

async function verifyHttpInProcess() {
    const express = require('express');
    const createApiRouter = require('../server/api');
    const dpoClient = require('../server/payments/dpo/client');

    installDpoMock('success');

    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api', createApiRouter());

    const server = await new Promise((resolve, reject) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
        instance.on('error', reject);
    });
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
        const configRes = await request(baseUrl, 'GET', '/api/payments/dpo/config');
        assert(configRes.status === 200 && configRes.json?.success, `config failed: ${configRes.raw}`);
        assertNoSecretLeak(configRes.json, 'public config');
        assert(configRes.json.dpo?.mode === 'test', 'public config mode should be test');
        assert(configRes.json.dpo?.liveAvailable === false, 'live should not be available');

        const orderId = `DPO-HTTP-${Date.now().toString().slice(-8)}`;
        await createFixtureOrder(orderId);

        const initiated = await request(baseUrl, 'POST', '/api/payments/dpo/initiate', {
            body: { orderId }
        });
        assert(initiated.status === 200 && initiated.json?.success, `initiate HTTP failed: ${initiated.raw}`);
        assert(String(initiated.json.paymentUrl || '').includes('payv3.php?ID='), 'HTTP initiate URL missing');
        assertNoSecretLeak(initiated.json, 'HTTP initiate');

        const verified = await request(baseUrl, 'POST', '/api/payments/dpo/verify', {
            body: { orderId }
        });
        assert(verified.status === 200 && verified.json?.success, `verify HTTP failed: ${verified.raw}`);
        assert(verified.json.outcome === 'success', 'HTTP verify should succeed');
        assertNoSecretLeak(verified.json, 'HTTP verify');

        // Cancelled / back redirect for a fresh order
        installDpoMock('success');
        const cancelId = `${orderId}-BACK`;
        await createFixtureOrder(cancelId);
        await request(baseUrl, 'POST', '/api/payments/dpo/initiate', { body: { orderId: cancelId } });
        const back = await request(baseUrl, 'GET', `/api/payments/dpo/back?orderId=${encodeURIComponent(cancelId)}`);
        assert([301, 302].includes(back.status), `expected redirect from back, got ${back.status}`);
        assert(String(back.location).includes('status=cancelled'), `back redirect missing cancelled status: ${back.location}`);
        assertNoSecretLeak(back.raw, 'HTTP back');

        // Invalid token verify outcome
        installDpoMock('invalid');
        const invalidId = `${orderId}-INV`;
        await createFixtureOrder(invalidId);
        await request(baseUrl, 'POST', '/api/payments/dpo/initiate', { body: { orderId: invalidId } });
        const invalid = await request(baseUrl, 'POST', '/api/payments/dpo/verify', { body: { orderId: invalidId } });
        assert(invalid.status === 200 && invalid.json?.outcome === 'invalid_token', `invalid verify failed: ${invalid.raw}`);
        assertNoSecretLeak(invalid.json, 'HTTP invalid verify');

        return true;
    } finally {
        dpoClient.resetHttpTransport();
        await new Promise((resolve) => server.close(resolve));
    }
}

async function main() {
    console.log('[verify-dpo-payment-test] starting STEP 2 verification');

    [
        'server/payments/dpo/client.js',
        'server/payments/dpo/xml.js',
        'server/services/dpopayment.service.js',
        'server/controllers/dpopaymentcontroller.js',
        'server/routes/dpopayments.js',
        'orders/payment.js',
        'orders/payment-result.js'
    ].forEach((rel) => {
        assert(fs.existsSync(path.resolve(__dirname, '..', rel)), `${rel} missing`);
    });

    const { connectDatabase } = require('../server/database');
    await connectDatabase();
    await seedTestCredentials();

    await verifyClientHelpers();
    console.log('[verify-dpo-payment-test] client helpers OK');

    await verifyServiceFlows();
    console.log('[verify-dpo-payment-test] service flows OK (success/failed/cancelled/invalid)');

    await verifyHttpInProcess();
    console.log('[verify-dpo-payment-test] HTTP layer OK');

    console.log('[verify-dpo-payment-test] PASS');
}

main().catch((error) => {
    console.error('[verify-dpo-payment-test] FAIL:', error.message);
    process.exitCode = 1;
});
