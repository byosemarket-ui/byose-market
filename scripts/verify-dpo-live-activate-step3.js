#!/usr/bin/env node
/**
 * STEP 3 — Activate DPO LIVE payment flow from Admin Operating Mode.
 * Confirms production checkout uses Admin-stored LIVE credentials when
 * Operating Mode is LIVE, never falls back to TEST, and keeps COD off DPO.
 *
 * Run: node scripts/verify-dpo-live-activate-step3.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const {
    isolateVerifyCredentialStore,
    isRealCredentialsPath,
    resetUndecryptableStoreIfSafe,
    restorePaymentSettingsFlags,
    snapshotPaymentSettingsFlags
} = require('./lib/payment-verify-guard');

const verifyStore = isolateVerifyCredentialStore('verify-dpo-live-activate-step3');
const failures = [];

function assert(condition, message) {
    if (!condition) failures.push(message);
}

function read(rel) {
    return fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
}

function checkSources() {
    const config = read('server/payments/dpo/config.js');
    assert(config.includes('OPERATING_MODE_LIVE'), 'LIVE operating mode must activate LIVE checkout');
    assert(!config.includes('LIVE_CHECKOUT_ENABLED = false'), 'hard LIVE gate must be removed');
    assert(config.includes('LIVE_NOT_CONFIGURED'), 'incomplete LIVE must fail safely');

    const endpoints = read('server/payments/dpo/endpoints.js');
    assert(endpoints.includes('https://secure.3gdirectpay.com/API/v6/'), 'LIVE API must be API v6');
    assert(endpoints.includes("DEFAULT_PAYMENT_PAGE = 'https://secure.3gdirectpay.com/payv3.php?ID=token'"), 'LIVE payment URL must be payv3.php');

    const provider = read('server/payments/providers/dpo.provider.js');
    assert(provider.includes("LIVE_SERVICE_TYPE_ID = '112815'"), 'LIVE Service Type must be 112815');
    assert(provider.includes("TEST_SERVICE_TYPE_ID = '54841'"), 'TEST Service Type 54841 must stay isolated');

    const dpoService = read('server/services/dpopayment.service.js');
    assert(dpoService.includes('getActiveDpoConfiguration'), 'initiate must use Admin-selected configuration');
    assert(dpoService.includes('loadRuntimeForOrder'), 'verify must use the environment stored on the order');
    assert(dpoService.includes('DPO_NOT_USED_FOR_COD'), 'COD must not create a DPO transaction');
    assert(!dpoService.includes('FORCED_MODE'), 'payment service must not force TEST');

    const settings = read('server/services/paymentsettings.service.js');
    assert(!settings.includes('DPO_LIVE_CHECKOUT_DISABLED'), 'Operating Mode LIVE must be allowed to activate checkout');

    const constants = read('orders/core/constants.js');
    assert(constants.includes("id: 'mtn'") && constants.includes("id: 'card'") && constants.includes("id: 'cod'"), 'customer methods stay MTN, Card, COD');
    assert(!/id:\s*'dpo'/.test(constants), 'standalone DPO Pay must stay removed');
    assert(constants.includes('DELIVERY_FEE = 2000'), 'delivery fee must remain 2,000 RWF');
}

async function checkLiveCheckoutActivation() {
    if (!String(process.env.PAYMENT_ENCRYPTION_KEY || '').trim()) {
        process.env.PAYMENT_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    }

    const secretsStore = require('../server/payments/secrets.store');
    assert(!isRealCredentialsPath(secretsStore.getCredentialsFilePath()), 'must use isolated credential store');
    resetUndecryptableStoreIfSafe(secretsStore, 'verify-dpo-live-activate-step3');

    const { connectDatabase } = require('../server/database');
    await connectDatabase();

    const paymentSettingsService = require('../server/services/paymentsettings.service');
    const dpoConfig = require('../server/payments/dpo/config');
    const dpoPaymentService = require('../server/services/dpopayment.service');
    const settingsSnapshot = await snapshotPaymentSettingsFlags(paymentSettingsService);

    const testToken = `LOCAL-VERIFY-${crypto.randomBytes(12).toString('hex')}`;
    const liveToken = `LIVE-STEP3-${crypto.randomBytes(12).toString('hex')}`;

    try {
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
        }, { id: 'ADMIN_VERIFY_STEP3', email: 'admin@example.com' });

        const activeTest = await dpoConfig.getActiveDpoConfiguration();
        assert(activeTest.mode === 'test', 'TEST operating mode must use TEST configuration');
        assert(activeTest.secrets.companyToken === testToken, 'TEST checkout must use TEST Company Token');
        assert(activeTest.secrets.serviceType === '54841', 'TEST checkout must use TEST Service Type');

        await paymentSettingsService.updatePaymentSettings({
            mode: 'live',
            enabled: false
        }, { id: 'ADMIN_VERIFY_STEP3', email: 'admin@example.com' });

        let incomplete = null;
        try {
            await dpoConfig.getActiveDpoConfiguration();
        } catch (error) {
            incomplete = error;
        }
        assert(incomplete && incomplete.code === 'DPO_LIVE_NOT_CONFIGURED', 'LIVE without credentials must fail safely');
        assert(incomplete.code !== 'DPO_NOT_ENABLED' || incomplete.details?.mode === 'live', 'LIVE failure must not load TEST');

        await paymentSettingsService.updatePaymentSettings({
            mode: 'test',
            enabled: true,
            credentials: {
                live: {
                    companyToken: liveToken,
                    serviceType: '112815-Shoes'
                }
            }
        }, { id: 'ADMIN_VERIFY_STEP3', email: 'admin@example.com' });

        const stillTest = await dpoConfig.getActiveDpoConfiguration();
        assert(stillTest.mode === 'test', 'saving LIVE credentials must not switch checkout off TEST');
        assert(stillTest.secrets.companyToken === testToken, 'TEST checkout must keep TEST Company Token until Operating Mode is LIVE');

        await paymentSettingsService.updatePaymentSettings({
            mode: 'live',
            enabled: true
        }, { id: 'ADMIN_VERIFY_STEP3', email: 'admin@example.com' });

        const liveRuntime = await dpoPaymentService.loadCheckoutRuntime();
        assert(liveRuntime.mode === 'live', 'Operating Mode LIVE must select LIVE checkout');
        assert(liveRuntime.secrets.companyToken === liveToken, 'LIVE checkout must use Admin-saved LIVE Company Token');
        assert(liveRuntime.secrets.serviceType === '112815', 'LIVE checkout must use Service Type 112815');
        assert(liveRuntime.secrets.companyToken !== testToken, 'LIVE checkout must not use TEST Company Token');
        assert(/API\/v6/i.test(liveRuntime.endpoints.apiBaseUrl || ''), 'LIVE API must be API v6');
        assert(/payv3\.php/i.test(liveRuntime.endpoints.paymentPageUrl || ''), 'LIVE payment URL must be payv3.php');
        assert(!/dpopayment\.php/i.test(liveRuntime.endpoints.paymentPageUrl || ''), 'LIVE must not use dpopayment.php');

        const publicConfig = await dpoConfig.getPublicCheckoutConfig();
        assert(publicConfig.enabled === true, 'public LIVE checkout must be enabled when configuration is complete');
        assert(publicConfig.label === 'Pay Online', 'public checkout label must stay customer-safe');
        assert(publicConfig.mode == null, 'public checkout must not expose Operating Mode');
        assert(publicConfig.liveCheckoutEnabled == null, 'public checkout must not expose LIVE checkout flags');
        assert(!JSON.stringify(publicConfig).includes(liveToken), 'public config must not include LIVE Company Token');
        assert(!/"serviceType"\s*:\s*"/.test(JSON.stringify(publicConfig)), 'public config must not include Service Type');

        const admin = await paymentSettingsService.getAdminPaymentSettings();
        assert(admin.mode === 'live', 'Admin operating mode must persist LIVE');
        assert(admin.capabilities.liveCheckoutEnabled === true, 'Admin must show LIVE checkout enabled');
        assert(admin.capabilities.liveCheckoutActive === true, 'Admin must show LIVE checkout active');
        assert(admin.capabilities.liveConnectionVerified === false, 'LIVE connection must stay unverified until a real LIVE check');
        assert(admin.capabilities.liveServiceType === '112815', 'Admin must show LIVE Service Type 112815');
        assert(!JSON.stringify(admin).includes(liveToken), 'Admin view must not return the LIVE Company Token');

        await paymentSettingsService.updatePaymentSettings({
            liveCheckoutEnabled: true
        }, { id: 'ADMIN_VERIFY_STEP3', email: 'admin@example.com' });
        const ignoredFlag = await dpoConfig.getActiveDpoConfiguration();
        assert(ignoredFlag.mode === 'live', 'liveCheckoutEnabled payload must not replace Operating Mode');
    } finally {
        await paymentSettingsService.updatePaymentSettings({
            mode: 'test',
            enabled: true
        }, { id: 'ADMIN_VERIFY_STEP3', email: 'admin@example.com' }).catch(() => {});
        await restorePaymentSettingsFlags(paymentSettingsService, settingsSnapshot);
    }
}

async function main() {
    console.log('[verify-dpo-live-activate-step3] starting STEP 3 LIVE payment-flow checks');
    console.log(`[verify-dpo-live-activate-step3] isolated store: ${verifyStore.isolatedPath}`);
    checkSources();
    await checkLiveCheckoutActivation();

    if (failures.length) {
        console.error('[verify-dpo-live-activate-step3] FAIL');
        failures.forEach((message) => console.error(` - ${message}`));
        process.exitCode = 1;
        return;
    }

    console.log('[verify-dpo-live-activate-step3] PASS');
    console.log(' Operating Mode LIVE → DPO LIVE');
    console.log(' LIVE Service Type: 112815');
    console.log(' LIVE API: https://secure.3gdirectpay.com/API/v6/');
    console.log(' LIVE payment URL: payv3.php');
    console.log(' No TEST fallback');
    console.log(' No real LIVE transaction performed');
}

main().catch((error) => {
    console.error('[verify-dpo-live-activate-step3] FAIL:', error.message);
    process.exitCode = 1;
});
