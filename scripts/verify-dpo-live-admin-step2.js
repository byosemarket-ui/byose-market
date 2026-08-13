#!/usr/bin/env node
/**
 * STEP 2 — Admin is the source of truth for DPO LIVE configuration.
 * Saves LIVE Service Type 112815 into the isolated encrypted store, confirms
 * operating mode selects TEST vs LIVE without mixing. Operating Mode LIVE
 * activates customer LIVE checkout when LIVE credentials are complete.
 *
 * Run: node scripts/verify-dpo-live-admin-step2.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const {
    assertNotWritingPlaceholderIntoRealStore,
    isolateVerifyCredentialStore,
    isRealCredentialsPath,
    resetUndecryptableStoreIfSafe,
    restorePaymentSettingsFlags,
    snapshotPaymentSettingsFlags
} = require('./lib/payment-verify-guard');

const verifyStore = isolateVerifyCredentialStore('verify-dpo-live-admin-step2');
const failures = [];

function assert(condition, message) {
    if (!condition) failures.push(message);
}

function read(rel) {
    return fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
}

function checkSources() {
    const provider = read('server/payments/providers/dpo.provider.js');
    assert(provider.includes("LIVE_SERVICE_TYPE_ID = '112815'"), 'LIVE Service Type 112815 must be defined');
    assert(provider.includes("TEST_SERVICE_TYPE_ID = '54841'"), 'TEST Service Type 54841 must stay isolated');
    assert(provider.includes('normalizeServiceTypeId'), '112815-Shoes must normalize to 112815');

    const endpoints = read('server/payments/dpo/endpoints.js');
    assert(endpoints.includes('https://secure.3gdirectpay.com/API/v6/'), 'official LIVE API v6 endpoint must be configured');
    assert(endpoints.includes("DEFAULT_PAYMENT_PAGE = 'https://secure.3gdirectpay.com/payv3.php?ID=token'"), 'default payment URL must be official payv3.php');
    assert(!/DEFAULT_PAYMENT_PAGE\s*=\s*'[^']*dpopayment\.php/.test(endpoints), 'must not set dpopayment.php as the default payment URL');

    const config = read('server/payments/dpo/config.js');
    assert(config.includes('OPERATING_MODE_LIVE'), 'LIVE operating mode must activate LIVE checkout');
    assert(config.includes('operatingMode'), 'resolver must honor Admin operating mode');
    assert(config.includes('customerCheckoutAllowed'), 'incomplete LIVE must fail safely without TEST fallback');
    assert(!config.includes('LIVE_CHECKOUT_ENABLED = false'), 'hard LIVE gate must be removed');

    const admin = read('admin/app/pages/settings-payment.js');
    assert(admin.includes('data-payment-cred-panel="live"'), 'Admin LIVE credential panel must remain');
    assert(admin.includes('Official LIVE Service Type ID is 112815'), 'Admin LIVE help must name 112815');
    assert(admin.includes('Not yet verified'), 'Admin must not claim LIVE connection is verified');
    assert(!/Airtel Money/.test(admin), 'Admin is not the customer method list');

    const constants = read('orders/core/constants.js');
    assert(constants.includes("id: 'mtn'") && constants.includes("id: 'card'") && constants.includes("id: 'cod'"), 'customer methods stay MTN, Card, COD');
    assert(!/id:\s*'dpo'/.test(constants), 'standalone DPO Pay must stay removed');
}

async function checkAdminSaveReload() {
    if (!String(process.env.PAYMENT_ENCRYPTION_KEY || '').trim()) {
        process.env.PAYMENT_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    }

    const secretsStore = require('../server/payments/secrets.store');
    assert(!isRealCredentialsPath(secretsStore.getCredentialsFilePath()), 'must use isolated credential store');
    resetUndecryptableStoreIfSafe(secretsStore, 'verify-dpo-live-admin-step2');

    const { connectDatabase } = require('../server/database');
    await connectDatabase();

    const paymentSettingsService = require('../server/services/paymentsettings.service');
    const dpoConfig = require('../server/payments/dpo/config');
    const dpoProvider = require('../server/payments/providers/dpo.provider');
    const settingsSnapshot = await snapshotPaymentSettingsFlags(paymentSettingsService);

    const testToken = `LOCAL-VERIFY-${crypto.randomBytes(12).toString('hex')}`;
    const liveToken = `LIVE-STEP2-${crypto.randomBytes(12).toString('hex')}`;
    assertNotWritingPlaceholderIntoRealStore(testToken, 'verify-dpo-live-admin-step2');
    assertNotWritingPlaceholderIntoRealStore(liveToken, 'verify-dpo-live-admin-step2');

    try {
        assert(dpoProvider.normalizeServiceTypeId('112815-Shoes') === '112815', '112815-Shoes must store as 112815');
        assert(dpoProvider.LIVE_SERVICE_TYPE_ID === '112815', 'exported LIVE Service Type must be 112815');

        await paymentSettingsService.updatePaymentSettings({
            enabled: true,
            activeProvider: 'dpo',
            mode: 'test',
            providerEnabled: true,
            credentials: {
                test: {
                    companyToken: testToken,
                    serviceType: '54841'
                }
            }
        }, { id: 'ADMIN_VERIFY_STEP2', email: 'admin@example.com' });

        let rejectedTestType = null;
        try {
            await paymentSettingsService.updatePaymentSettings({
                credentials: {
                    live: {
                        companyToken: liveToken,
                        serviceType: '54841'
                    }
                }
            }, { id: 'ADMIN_VERIFY_STEP2', email: 'admin@example.com' });
        } catch (error) {
            rejectedTestType = error;
        }
        assert(rejectedTestType, 'LIVE save must reject TEST Service Type 54841');

        const saved = await paymentSettingsService.updatePaymentSettings({
            mode: 'test',
            enabled: true,
            credentials: {
                live: {
                    companyToken: liveToken,
                    serviceType: '112815-Shoes'
                }
            }
        }, { id: 'ADMIN_VERIFY_STEP2', email: 'admin@example.com' });

        const serialized = JSON.stringify(saved);
        assert(!serialized.includes(liveToken), 'Admin reload must not return the LIVE Company Token');
        assert(saved.providers[0].credentials.live.fields.companyToken.configured === true, 'LIVE Company Token must show as stored');
        assert(saved.providers[0].credentials.live.fields.companyToken.hint.endsWith(liveToken.slice(-4)), 'LIVE token hint must be masked');
        assert(saved.providers[0].credentials.live.fields.serviceType.value === '112815', 'LIVE Service Type must persist as 112815');
        assert(saved.capabilities.liveCredentialsConfigured === true, 'LIVE credentials must be marked stored');
        assert(saved.capabilities.liveServiceType === '112815', 'capabilities must report LIVE Service Type 112815');
        assert(/API\/v6/i.test(saved.capabilities.liveApiEndpoint || ''), 'LIVE API endpoint must be API v6');
        assert(/payv3\.php/i.test(saved.capabilities.livePaymentPageUrl || ''), 'LIVE payment URL must be payv3.php');
        assert(saved.capabilities.liveConnectionVerified === false, 'LIVE connection must not be marked verified');
        assert(saved.capabilities.liveCheckoutActive === false, 'LIVE checkout must stay inactive while Operating Mode is TEST');
        assert(saved.capabilities.liveCheckoutEnabled === false, 'LIVE checkout must stay off while Operating Mode is TEST');

        const reloaded = await paymentSettingsService.getAdminPaymentSettings();
        assert(reloaded.providers[0].credentials.live.fields.companyToken.configured === true, 'reload must keep LIVE token configured');
        assert(!JSON.stringify(reloaded).includes(liveToken), 'reload must not reveal the LIVE Company Token');
        assert(reloaded.providers[0].credentials.live.fields.serviceType.value === '112815', 'reload must keep Service Type 112815');

        const testRuntime = await dpoConfig.getEnvironmentConfiguration('test');
        assert(testRuntime.mode === 'test', 'TEST operating path must load TEST config');
        assert(testRuntime.secrets.companyToken === testToken, 'TEST path must use TEST Company Token');
        assert(testRuntime.secrets.serviceType === '54841', 'TEST path must keep Service Type 54841');

        const liveRuntime = await dpoConfig.getEnvironmentConfiguration('live');
        assert(liveRuntime.mode === 'live', 'LIVE operating path must load LIVE config');
        assert(liveRuntime.secrets.companyToken === liveToken, 'LIVE path must use Admin-saved LIVE Company Token');
        assert(liveRuntime.secrets.serviceType === '112815', 'LIVE path must use Admin-saved Service Type 112815');
        assert(liveRuntime.secrets.companyToken !== testRuntime.secrets.companyToken, 'TEST and LIVE tokens must stay isolated');
        assert(/API\/v6/i.test(liveRuntime.endpoints.apiBaseUrl || ''), 'LIVE requests must use API v6');
        assert(/payv3\.php/i.test(liveRuntime.endpoints.paymentPageUrl || ''), 'LIVE redirect must use official payv3.php');

        const activeTest = await dpoConfig.getActiveDpoConfiguration();
        assert(activeTest.mode === 'test', 'default operating mode TEST must keep customer checkout on TEST');

        await paymentSettingsService.updatePaymentSettings({
            mode: 'live',
            enabled: true
        }, { id: 'ADMIN_VERIFY_STEP2', email: 'admin@example.com' });

        const activeLive = await dpoConfig.getActiveDpoConfiguration();
        assert(activeLive.mode === 'live', 'Operating Mode LIVE must activate LIVE checkout');
        assert(activeLive.secrets.companyToken === liveToken, 'LIVE checkout must use the Admin-saved LIVE token');
        assert(activeLive.secrets.serviceType === '112815', 'LIVE checkout must use Service Type 112815');
        assert(activeLive.secrets.companyToken !== testToken, 'LIVE checkout must not fall back to TEST');

        const publicConfig = await dpoConfig.getPublicCheckoutConfig();
        assert(publicConfig.enabled === true, 'customer checkout must be on when LIVE is complete');
        assert(publicConfig.label === 'Pay Online', 'public checkout label must stay customer-safe');
        assert(publicConfig.mode == null, 'public checkout must not expose Operating Mode');
        assert(publicConfig.liveCheckoutEnabled == null, 'public checkout must not expose LIVE checkout flags');
        assert(!JSON.stringify(publicConfig).includes(liveToken), 'public config must not include LIVE Company Token');
        assert(!/"serviceType"\s*:\s*"/.test(JSON.stringify(publicConfig)), 'public config must not include Service Type');

        await paymentSettingsService.updatePaymentSettings({
            liveCheckoutEnabled: true
        }, { id: 'ADMIN_VERIFY_STEP2', email: 'admin@example.com' });
        const stillLive = await dpoConfig.getActiveDpoConfiguration();
        assert(stillLive.mode === 'live', 'liveCheckoutEnabled payload must not replace Operating Mode');
    } finally {
        await paymentSettingsService.updatePaymentSettings({
            mode: 'test',
            enabled: true
        }, { id: 'ADMIN_VERIFY_STEP2', email: 'admin@example.com' }).catch(() => {});
        await restorePaymentSettingsFlags(paymentSettingsService, settingsSnapshot);
    }
}

async function main() {
    console.log('[verify-dpo-live-admin-step2] starting STEP 2 Admin LIVE configuration checks');
    console.log(`[verify-dpo-live-admin-step2] isolated store: ${verifyStore.isolatedPath}`);
    checkSources();
    await checkAdminSaveReload();

    if (failures.length) {
        console.error('[verify-dpo-live-admin-step2] FAIL');
        failures.forEach((message) => console.error(` - ${message}`));
        process.exitCode = 1;
        return;
    }

    console.log('[verify-dpo-live-admin-step2] PASS');
    console.log(' Admin is the LIVE configuration source of truth');
    console.log(' LIVE Service Type: 112815');
    console.log(' LIVE API: https://secure.3gdirectpay.com/API/v6/');
    console.log(' LIVE payment URL: payv3.php (official DPO LIVE email / API v6)');
    console.log(' LIVE checkout: activated by Operating Mode LIVE');
}

main().catch((error) => {
    console.error('[verify-dpo-live-admin-step2] FAIL:', error.message);
    process.exitCode = 1;
});
