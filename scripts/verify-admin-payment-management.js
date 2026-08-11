#!/usr/bin/env node
/**
 * Verifies Admin Payment Management (STEP 3).
 * Covers connection status, activity feed, provider toggles, and TEST-only connection tests.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const crypto = require('crypto');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const {
    assertNotWritingPlaceholderIntoRealStore,
    isolateVerifyCredentialStore,
    isRealCredentialsPath,
    resetUndecryptableStoreIfSafe
} = require('./lib/payment-verify-guard');

const verifyStore = isolateVerifyCredentialStore('verify-admin-payment-management');

let expectedCompanyToken = '';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function request(baseUrl, method, routePath, { token = '', body = null } = {}) {
    const http = require('http');
    return new Promise((resolve, reject) => {
        const url = new URL(routePath, `${baseUrl}/`);
        const payload = body == null ? null : Buffer.from(JSON.stringify(body));
        const req = http.request({
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port,
            path: `${url.pathname}${url.search}`,
            method,
            headers: {
                Accept: 'application/json',
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
                resolve({ status: res.statusCode || 0, json, raw });
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
        assert(!serialized.includes(runtimeToken), `${label} leaked env test token`);
    }
    assert(!/"secrets"\s*:\s*\{/.test(serialized), `${label} exposed secrets object`);
    assert(!/"transToken"\s*:\s*"[^"•][^"]+"/.test(serialized), `${label} leaked transToken`);
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
    expectedCompanyToken = String(process.env.DPO_TEST_COMPANY_TOKEN).trim();
    return {
        companyToken: expectedCompanyToken,
        serviceType: String(process.env.DPO_TEST_SERVICE_TYPE).trim()
    };
}

async function seed() {
    ensureEphemeralTestEnv();

    const secretsStore = require('../server/payments/secrets.store');
    assert(
        !isRealCredentialsPath(secretsStore.getCredentialsFilePath()),
        'verify must use an isolated credential store, not the real encrypted file'
    );
    resetUndecryptableStoreIfSafe(secretsStore, 'verify-admin-payment-management');

    const ephemeral = {
        companyToken: expectedCompanyToken,
        serviceType: String(process.env.DPO_TEST_SERVICE_TYPE || '54841').trim()
    };
    assertNotWritingPlaceholderIntoRealStore(ephemeral.companyToken, 'verify-admin-payment-management');

    const paymentSettingsService = require('../server/services/paymentsettings.service');
    await paymentSettingsService.updatePaymentSettings({
        enabled: true,
        activeProvider: 'dpo',
        mode: 'test',
        providerEnabled: true,
        credentials: {
            test: {
                companyToken: ephemeral.companyToken,
                serviceType: ephemeral.serviceType
            }
        }
    }, { id: 'ADMIN_VERIFY_STEP3', email: 'admin@example.com' });
}

async function verifyServiceLayer() {
    const paymentSettingsService = require('../server/services/paymentsettings.service');
    const dpoClient = require('../server/payments/dpo/client');

    const admin = await paymentSettingsService.getAdminPaymentSettings();
    assert(admin.connection?.code, 'connection status missing');
    assert(Array.isArray(admin.activity), 'activity missing');
    assert(admin.activityStats && typeof admin.activityStats === 'object', 'activityStats missing');
    assert(admin.capabilities?.canTestConnection === true, 'TEST mode should allow connection tests');
    assertNoSecretLeak(admin, 'admin payment view');

    // Disable provider
    const disabled = await paymentSettingsService.updatePaymentSettings({
        providerEnabled: false,
        activeProvider: 'dpo',
        mode: 'test'
    }, { id: 'ADMIN_VERIFY_STEP3', email: 'admin@example.com' });
    assert(disabled.providers[0].enabled === false, 'provider should be disabled');
    assert(disabled.connection.code === 'provider_disabled', `expected provider_disabled, got ${disabled.connection.code}`);

    await paymentSettingsService.updatePaymentSettings({
        providerEnabled: true,
        enabled: true,
        activeProvider: 'dpo',
        mode: 'test'
    }, { id: 'ADMIN_VERIFY_STEP3', email: 'admin@example.com' });

    // LIVE mode blocks connection test
    await paymentSettingsService.updatePaymentSettings({
        mode: 'live',
        enabled: false
    }, { id: 'ADMIN_VERIFY_STEP3', email: 'admin@example.com' });
    let blocked = false;
    try {
        await paymentSettingsService.testPaymentConfiguration(
            { id: 'ADMIN_VERIFY_STEP3', email: 'admin@example.com' },
            { providerId: 'dpo' }
        );
    } catch (error) {
        blocked = error?.code === 'PAYMENT_TEST_REQUIRES_TEST_MODE';
    }
    assert(blocked, 'LIVE mode must block connection tests');

    await paymentSettingsService.updatePaymentSettings({
        mode: 'test',
        enabled: true,
        providerEnabled: true
    }, { id: 'ADMIN_VERIFY_STEP3', email: 'admin@example.com' });

    dpoClient.setHttpTransportForTests(async (_url, xmlBody) => {
        assert(Boolean(expectedCompanyToken) && String(xmlBody).includes(expectedCompanyToken), 'test probe missing company token');
        return {
            statusCode: 200,
            body: `<?xml version="1.0" encoding="utf-8"?><API3G><Result>000</Result><ResultExplanation>Transaction created</ResultExplanation><TransToken>TOK-${crypto.randomBytes(4).toString('hex')}</TransToken><TransRef>REFTEST</TransRef></API3G>`
        };
    });

    const tested = await paymentSettingsService.testPaymentConfiguration(
        { id: 'ADMIN_VERIFY_STEP3', email: 'admin@example.com' },
        { providerId: 'dpo' }
    );
    assert(tested.test?.success === true, 'TEST connection should succeed with mock');
    assertNoSecretLeak(tested, 'test connection result');
    dpoClient.resetHttpTransport();

    return true;
}

async function verifyHttp() {
    const createApiRouter = require('../server/api');
    const { generateToken } = require('../server/utils/token');
    const dpoClient = require('../server/payments/dpo/client');

    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api', createApiRouter());
    const server = await new Promise((resolve, reject) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
        instance.on('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const adminEmail = String(process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
    const token = generateToken({
        id: `ADMIN_${Buffer.from(adminEmail).toString('hex').slice(0, 16)}`,
        email: adminEmail,
        role: 'admin',
        sid: 'sess_payment_step3'
    });

    try {
        const unauth = await request(baseUrl, 'GET', '/api/admin/payment');
        assert([401, 403].includes(unauth.status), `expected auth wall, got ${unauth.status}`);

        const getRes = await request(baseUrl, 'GET', '/api/admin/payment', { token });
        assert(getRes.status === 200 && getRes.json?.success, `GET payment failed: ${getRes.raw}`);
        assert(getRes.json.payment?.connection, 'connection missing in HTTP response');
        assert(Array.isArray(getRes.json.payment?.activity), 'activity missing in HTTP response');
        assertNoSecretLeak(getRes.json, 'GET /api/admin/payment');

        const activity = await request(baseUrl, 'GET', '/api/admin/payment/activity', { token });
        assert(activity.status === 200 && activity.json?.success, `activity failed: ${activity.raw}`);
        assertNoSecretLeak(activity.json, 'GET /api/admin/payment/activity');

        dpoClient.setHttpTransportForTests(async () => ({
            statusCode: 200,
            body: '<?xml version="1.0" encoding="utf-8"?><API3G><Result>000</Result><ResultExplanation>Transaction created</ResultExplanation><TransToken>TOKHTTP1234</TransToken></API3G>'
        }));

        const testRes = await request(baseUrl, 'POST', '/api/admin/payment/test', {
            token,
            body: { providerId: 'dpo' }
        });
        assert(testRes.status === 200 && testRes.json?.success, `test failed: ${testRes.raw}`);
        assert(testRes.json.test?.success === true, 'HTTP test should succeed');
        assertNoSecretLeak(testRes.json, 'POST /api/admin/payment/test');

        dpoClient.resetHttpTransport();
        return true;
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

async function main() {
    console.log('[verify-admin-payment-management] starting STEP 3 verification');
    [
        'admin/app/pages/settings-payment.js',
        'admin/app/core/navigation.js',
        'server/services/paymentsettings.service.js',
        'server/controllers/adminpaymentcontroller.js',
        'server/routes/adminpayment.js'
    ].forEach((rel) => {
        assert(fs.existsSync(path.resolve(__dirname, '..', rel)), `${rel} missing`);
    });

    const navigationSource = fs.readFileSync(path.resolve(__dirname, '../admin/app/core/navigation.js'), 'utf8');
    assert(
        /id:\s*"website-management"[\s\S]*?website-payment-management[\s\S]*?Payment Management[\s\S]*?\?panel=payment/.test(navigationSource),
        'Website Management sidebar must include Payment Management linking to ?panel=payment'
    );
    assert(
        navigationSource.includes('renderAdminPaymentPanel') === false,
        'navigation must not embed payment panel code'
    );

    const { connectDatabase } = require('../server/database');
    await connectDatabase();
    await seed();

    await verifyServiceLayer();
    console.log('[verify-admin-payment-management] service layer OK');

    await verifyHttp();
    console.log('[verify-admin-payment-management] HTTP layer OK');

    console.log('[verify-admin-payment-management] PASS');
}

main().catch((error) => {
    console.error('[verify-admin-payment-management] FAIL:', error.message);
    process.exitCode = 1;
});
