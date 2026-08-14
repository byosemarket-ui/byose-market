#!/usr/bin/env node
/**
 * STEP 1 — DPO LIVE production foundation.
 * Confirms customer checkout is LIVE-only, TEST is isolated from the
 * production payment path, secrets stay server-side, and a safe LIVE
 * configuration/connectivity check can run without a real-money charge.
 *
 * Run: node scripts/verify-dpo-live-foundation.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const {
    isolateVerifyCredentialStore,
    isRealCredentialsPath,
    resetUndecryptableStoreIfSafe,
    restorePaymentSettingsFlags,
    snapshotPaymentSettingsFlags
} = require('./lib/payment-verify-guard');

const root = path.resolve(__dirname, '..');
const failures = [];
const LIVE_API = 'https://secure.3gdirectpay.com/API/v6/';
const LIVE_PAY = 'https://secure.3gdirectpay.com/payv3.php?ID=token';
const LIVE_SERVICE_TYPE = '112815';
const TEST_SERVICE_TYPE = '54841';

function assert(condition, message) {
    if (!condition) failures.push(message);
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function serializedHasSecret(value) {
    const text = JSON.stringify(value || {});
    return /"companyToken"\s*:\s*"[^"]{8,}"/.test(text)
        || /"secrets"\s*:\s*\{/.test(text)
        || /PAYMENT_ENCRYPTION_KEY"\s*:\s*"[^"]+"/.test(text);
}

function checkSources() {
    const config = read('server/payments/dpo/config.js');
    assert(config.includes("CHECKOUT_MODE = 'live'"), 'production checkout mode must be LIVE');
    assert(config.includes("operatingMode: 'live'"), 'active checkout must force LIVE');
    assert(config.includes('getActiveDpoConfiguration'), 'resolver must be the production checkout entry');
    assert(!config.includes('OPERATING_MODE_TEST'), 'customer checkout resolver must not select TEST');
    assert(config.includes('DPO_LIVE_NOT_CONFIGURED'), 'incomplete LIVE must fail with a dedicated error');
    assert(config.includes("label: 'Pay Online'"), 'public checkout label must stay customer-safe');
    assert(!/if LIVE fails[\s\S]{0,80}use TEST/i.test(config), 'must not fall back from LIVE to TEST');

    const endpoints = read('server/payments/dpo/endpoints.js');
    assert(endpoints.includes(LIVE_API), 'LIVE API v6 must be the centralized endpoint');
    assert(endpoints.includes(LIVE_PAY), 'LIVE payment URL must be official payv3.php');
    assert(!/sandbox/i.test(endpoints), 'endpoint module must not point at sandbox');

    const provider = read('server/payments/providers/dpo.provider.js');
    assert(provider.includes(`LIVE_SERVICE_TYPE_ID = '${LIVE_SERVICE_TYPE}'`), 'LIVE Service Type must be 112815');
    assert(provider.includes(`TEST_SERVICE_TYPE_ID = '${TEST_SERVICE_TYPE}'`), 'TEST Service Type 54841 must stay rejected for LIVE');
    assert(provider.includes('live: { ...DEFAULT_ENDPOINTS.live }'), 'LIVE endpoints must stay centralized');

    const settings = read('server/services/paymentsettings.service.js');
    assert(settings.includes("checkoutEnvironment: 'live'"), 'Admin capabilities must report LIVE checkout');
    assert(settings.includes('function getCheckoutEnvironmentMode'), 'checkout environment helper must exist');
    assert(settings.includes("return 'live';"), 'checkout environment helper must be LIVE-only');
    assert(!/If LIVE credentials are missing, use TEST/i.test(settings), 'must not silently fall back from LIVE to TEST');
    assert(settings.includes('Do not copy the TEST Company Token into LIVE'), 'LIVE save must reject a copied TEST token');

    const service = read('server/services/dpopayment.service.js');
    assert(service.includes('getActiveDpoConfiguration'), 'initiate must use the LIVE resolver');
    assert(service.includes('mode: runtime.mode'), 'new transactions must store the runtime mode');
    assert(service.includes('serviceType: runtime.secrets.serviceType'), 'new transactions must store LIVE Service Type');
    assert(!service.includes('FORCED_MODE'), 'payment service must not force TEST');
    assert(!service.includes('loadTestRuntime'), 'TEST-only runtime alias must stay out of production service');

    const client = read('server/payments/dpo/client.js');
    assert(client.includes('redactXmlSecrets'), 'DPO client must redact Company Token from logs');
    assert(!client.includes('DPO-TEST'), 'DPO client User-Agent must not be TEST-specific');

    const controller = read('server/controllers/dpopaymentcontroller.js');
    assert(controller.includes('customerSafePaymentMessage'), 'customer errors must stay generic');
    assert(!/companyToken/i.test(controller), 'payment controller must not mention Company Token');

    const publicRoutes = read('server/routes/dpopayments.js');
    assert(publicRoutes.includes("router.get('/config'"), 'public DPO config route must exist');
    assert(publicRoutes.includes("router.post('/initiate'"), 'initiate route must exist');
    assert(publicRoutes.includes("router.get('/return'"), 'return URL must exist');
    assert(publicRoutes.includes("router.get('/callback'"), 'callback URL must exist');

    const adminRoutes = read('server/routes/adminpayment.js');
    assert(adminRoutes.includes('adminAccessDisabled'), 'Admin payment routes must require Admin auth');

    const adminUi = read('admin/app/pages/settings-payment.js');
    assert(adminUi.includes('LIVE Payment Control Center'), 'Admin must remain the LIVE control center');
    assert(adminUi.includes(LIVE_SERVICE_TYPE), 'Admin must name LIVE Service Type 112815');
    assert(adminUi.includes('payv3.php'), 'Admin must show official payv3.php');
    assert(!adminUi.includes('data-payment-mode-tab="test"'), 'Admin must not present TEST credential tabs');
    assert(!adminUi.includes('testAdminPaymentConnection'), 'Admin UI must not call the TEST probe');

    const gitignore = read('.gitignore');
    assert(gitignore.includes('.env'), '.env must be gitignored');
    assert(gitignore.includes('*.enc'), 'encrypted credential files must be gitignored');
    assert(gitignore.includes('server/secure/*'), 'payment credential store directory must be gitignored');

    const envExample = read('.env.example');
    assert(!/8A0[0-9A-F]{20,}/i.test(envExample), '.env.example must not contain a real Company Token');
    assert(envExample.includes('PAYMENT_ENCRYPTION_KEY='), 'encryption key placeholder must exist');
    assert(!/LIVE checkout is not activated/.test(envExample), 'env example must not say LIVE checkout is inactive by default');
}

function checkResolver() {
    const dpoConfig = require('../server/payments/dpo/config');
    const testConfigured = dpoConfig.resolveCheckoutEnvironment({ operatingMode: 'test', liveConfigured: true });
    assert(testConfigured.mode === 'live', 'TEST operating mode must not select TEST customer checkout');
    assert(testConfigured.reason !== 'OPERATING_MODE_TEST', 'resolver must not return OPERATING_MODE_TEST');

    const testIncomplete = dpoConfig.resolveCheckoutEnvironment({ operatingMode: 'test', liveConfigured: false });
    assert(testIncomplete.mode === 'live', 'incomplete LIVE with TEST operating mode must stay LIVE');
    assert(testIncomplete.customerCheckoutAllowed === false, 'incomplete LIVE must not open TEST checkout');
}

async function checkIsolatedNoFallback() {
    const verifyStore = isolateVerifyCredentialStore('verify-dpo-live-foundation');
    if (!String(process.env.PAYMENT_ENCRYPTION_KEY || '').trim()) {
        process.env.PAYMENT_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    }

    const secretsStore = require('../server/payments/secrets.store');
    assert(!isRealCredentialsPath(secretsStore.getCredentialsFilePath()), 'isolated no-fallback check must not use the real store');
    assert(
        path.resolve(secretsStore.getCredentialsFilePath()) === path.resolve(verifyStore.isolatedPath),
        'isolated credential path mismatch'
    );
    resetUndecryptableStoreIfSafe(secretsStore, 'verify-dpo-live-foundation');

    const { connectDatabase } = require('../server/database');
    await connectDatabase();
    const paymentSettingsService = require('../server/services/paymentsettings.service');
    const dpoConfig = require('../server/payments/dpo/config');
    const snapshot = await snapshotPaymentSettingsFlags(paymentSettingsService);
    const testToken = `LOCAL-VERIFY-${crypto.randomBytes(12).toString('hex')}`;

    try {
        await paymentSettingsService.updatePaymentSettings({
            enabled: true,
            activeProvider: 'dpo',
            mode: 'test',
            providerEnabled: true,
            credentials: {
                test: {
                    companyToken: testToken,
                    serviceType: TEST_SERVICE_TYPE
                }
            }
        }, { id: 'ADMIN_VERIFY_LIVE_FOUNDATION', email: 'admin@example.com' });

        let liveError = null;
        try {
            await dpoConfig.getActiveDpoConfiguration();
        } catch (error) {
            liveError = error;
        }
        assert(liveError && liveError.code === 'DPO_LIVE_NOT_CONFIGURED', 'TEST credentials must not satisfy LIVE checkout');
        assert(!String(liveError?.message || '').includes(testToken), 'LIVE failure must not leak the TEST Company Token');

        const publicConfig = await dpoConfig.getPublicCheckoutConfig();
        assert(publicConfig.enabled === false, 'public checkout must stay disabled without LIVE configuration');
        assert(publicConfig.label === 'Pay Online', 'public checkout label must stay customer-safe');
        assert(publicConfig.mode == null, 'public checkout must not expose mode');
        assert(!serializedHasSecret(publicConfig), 'public checkout must not expose secrets');
    } finally {
        await restorePaymentSettingsFlags(paymentSettingsService, snapshot, {
            id: 'ADMIN_VERIFY_LIVE_FOUNDATION',
            email: 'admin@example.com'
        });
    }
}

function inspectLocalLiveReadiness() {
    const env = require('../server/config/env');
    const secretsStore = require('../server/payments/secrets.store');
    const encryption = secretsStore.getEncryptionStatus();
    return {
        encryptionReady: Boolean(env.payment?.encryptionKeyConfigured || encryption.configured),
        encryptionSource: encryption.source || 'missing',
        storeReadable: encryption.storeReadable !== false,
        storeReadError: encryption.storeReadError || null
    };
}

async function inspectRealLiveConfiguration() {
    const previousPath = String(process.env.PAYMENT_CREDENTIALS_PATH || '').trim();
    if (previousPath) {
        delete process.env.PAYMENT_CREDENTIALS_PATH;
    }

    const { connectDatabase } = require('../server/database');
    await connectDatabase();
    const paymentSettingsService = require('../server/services/paymentsettings.service');
    const dpoClient = require('../server/payments/dpo/client');
    const local = inspectLocalLiveReadiness();
    const report = {
        encryptionReady: local.encryptionReady,
        encryptionSource: local.encryptionSource,
        storeReadable: local.storeReadable,
        liveConfigured: false,
        serviceType: '',
        apiBaseUrl: '',
        paymentPageUrl: '',
        dpoReached: false,
        dpoResult: '',
        dpoExplanation: '',
        note: ''
    };

    if (!local.encryptionReady) {
        report.note = 'PAYMENT_ENCRYPTION_KEY is not configured in this environment.';
        if (previousPath) process.env.PAYMENT_CREDENTIALS_PATH = previousPath;
        return report;
    }

    try {
        const runtime = await paymentSettingsService.getRuntimePaymentCredentials({
            providerId: 'dpo',
            mode: 'live'
        });
        const companyToken = String(runtime?.secrets?.companyToken || '').trim();
        const serviceType = String(runtime?.secrets?.serviceType || '').trim();
        report.serviceType = serviceType;
        report.apiBaseUrl = String(runtime?.endpoints?.apiBaseUrl || LIVE_API);
        report.paymentPageUrl = String(runtime?.endpoints?.paymentPageUrl || LIVE_PAY);
        report.liveConfigured = Boolean(companyToken && serviceType === LIVE_SERVICE_TYPE);

        if (!companyToken || serviceType !== LIVE_SERVICE_TYPE) {
            report.note = 'LIVE Company Token or Service Type 112815 is not stored in this environment.';
            return report;
        }

        assert(/API\/v6/i.test(report.apiBaseUrl), 'real LIVE API must be API v6');
        assert(/payv3\.php/i.test(report.paymentPageUrl), 'real LIVE payment URL must be payv3.php');

        const xml = dpoClient.buildCreateTokenXml({
            companyToken,
            serviceType,
            amount: 100,
            currency: 'RWF',
            companyRef: 'BYOSE-LIVE-CFG-CHECK',
            redirectUrl: 'https://byosemarket.com/orders/payment-result.html',
            backUrl: 'https://byosemarket.com/orders/payment-result.html',
            customerName: 'BYOSE LIVE Config Check',
            serviceDescription: 'BYOSE Market LIVE configuration check'
        });
        assert(xml.includes(`<ServiceType>${LIVE_SERVICE_TYPE}</ServiceType>`), 'LIVE request must use Service Type 112815');
        assert(!xml.includes(TEST_SERVICE_TYPE), 'LIVE request must not include TEST Service Type 54841');

        const verified = await dpoClient.verifyToken({
            companyToken,
            apiBaseUrl: report.apiBaseUrl || LIVE_API,
            transactionToken: 'BYOSE-LIVE-CFG-CHECK-NOCHARGE',
            companyRef: 'BYOSE-LIVE-CFG-CHECK'
        });
        report.dpoReached = true;
        report.dpoResult = String(verified.result || '');
        report.dpoExplanation = String(verified.resultExplanation || '').slice(0, 180);
        report.note = 'DPO LIVE responded to a dummy verifyToken. This is not a paid customer transaction.';
        assert(!String(report.dpoExplanation).includes(companyToken), 'DPO explanation must not echo the Company Token');
    } catch (error) {
        if (error?.code === 'DPO_LIVE_NOT_CONFIGURED' || error?.code === 'DPO_LIVE_NOT_ENABLED' || error?.code === 'DPO_CREDENTIALS_MISSING') {
            report.note = `LIVE configuration is incomplete in this environment (${error.code}).`;
        } else if (error?.code === 'PAYMENT_ENCRYPTION_KEY_MISSING' || error?.code === 'PAYMENT_CREDENTIALS_DECRYPT_FAILED') {
            report.note = `Encrypted LIVE credentials could not be loaded (${error.code}).`;
        } else {
            report.note = `LIVE connectivity check did not complete (${error?.code || error?.message || 'unknown'}).`;
            report.dpoReached = Boolean(error?.details?.httpStatus);
            report.dpoResult = String(error?.details?.result || error?.code || '');
            report.dpoExplanation = String(error?.details?.resultExplanation || error?.message || '').slice(0, 180);
        }
    } finally {
        if (previousPath) process.env.PAYMENT_CREDENTIALS_PATH = previousPath;
    }

    return report;
}

function fetchJson(url) {
    return new Promise((resolve) => {
        const req = https.get(url, { timeout: 15000 }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                let json = null;
                try { json = JSON.parse(raw); } catch (_error) { json = null; }
                resolve({ status: res.statusCode || 0, json, raw });
            });
        });
        req.on('timeout', () => {
            req.destroy();
            resolve({ status: 0, json: null, raw: '', error: 'timeout' });
        });
        req.on('error', (error) => resolve({ status: 0, json: null, raw: '', error: error.message }));
    });
}

async function checkProductionPublicSurface() {
    const health = await fetchJson('https://byosemarket.com/healthz');
    const config = await fetchJson('https://byosemarket.com/api/payments/dpo/config');
    return {
        healthStatus: health.status,
        healthOk: health.status === 200 && String(health.json?.status || '') !== '',
        paymentConfigStatus: config.status,
        paymentConfig: config.json?.dpo || null,
        leaked: serializedHasSecret(config.json)
    };
}

async function main() {
    console.log('[verify-dpo-live-foundation] starting STEP 1 LIVE foundation checks');
    checkSources();
    checkResolver();

    const production = await checkProductionPublicSurface();
    assert(production.healthOk, `production healthz must respond (HTTP ${production.healthStatus})`);
    assert(production.paymentConfigStatus === 200, `production public DPO config must respond (HTTP ${production.paymentConfigStatus})`);
    assert(production.paymentConfig && typeof production.paymentConfig.enabled === 'boolean', 'production public DPO config must expose enabled');
    assert(production.paymentConfig.label === 'Pay Online' || production.paymentConfig.label == null, 'production public DPO config must stay customer-safe');
    assert(!production.leaked, 'production public DPO config must not leak secrets');
    assert(production.paymentConfig.companyToken == null, 'production public DPO config must not expose Company Token');
    assert(production.paymentConfig.serviceType == null, 'production public DPO config must not expose Service Type');

    const liveInspect = await inspectRealLiveConfiguration();
    await checkIsolatedNoFallback();

    if (failures.length) {
        console.error('[verify-dpo-live-foundation] FAIL');
        failures.forEach((item) => console.error(` - ${item}`));
        process.exit(1);
    }

    console.log('[verify-dpo-live-foundation] PASS');
    console.log(` LIVE API: ${LIVE_API}`);
    console.log(` LIVE payment URL: ${LIVE_PAY}`);
    console.log(` LIVE Service Type: ${LIVE_SERVICE_TYPE}`);
    console.log(' No TEST fallback on customer checkout');
    console.log(` Encryption: ${liveInspect.encryptionReady ? 'Ready' : 'Not ready'} (${liveInspect.encryptionSource})`);
    console.log(` Local LIVE configuration: ${liveInspect.liveConfigured ? 'Ready' : 'Incomplete'}`);
    console.log(` Local LIVE Service Type: ${liveInspect.serviceType || 'Missing'}`);
    console.log(` Local LIVE API: ${liveInspect.apiBaseUrl || 'Missing'}`);
    console.log(` Local LIVE payment URL: ${liveInspect.paymentPageUrl || 'Missing'}`);
    console.log(` DPO LIVE dummy verify reached: ${liveInspect.dpoReached ? 'yes' : 'no'}${liveInspect.dpoResult ? ` (Result ${liveInspect.dpoResult})` : ''}`);
    console.log(` Note: ${liveInspect.note || 'No real-money LIVE customer transaction was performed.'}`);
    console.log(` Production public checkout enabled: ${production.paymentConfig.enabled}`);
    console.log(' No real-money LIVE customer transaction was performed.');
    process.exit(0);
}

main().catch((error) => {
    console.error('[verify-dpo-live-foundation] FAIL:', error.message);
    process.exit(1);
});
