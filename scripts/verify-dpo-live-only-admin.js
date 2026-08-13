#!/usr/bin/env node
/**
 * Convert Admin Payment Management to a LIVE-only production control center.
 * Confirms TEST management UI is gone, LIVE is the active configuration path,
 * secrets stay server-side, and historical payment records are not deleted.
 *
 * Run: node scripts/verify-dpo-live-only-admin.js
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

const verifyStore = isolateVerifyCredentialStore('verify-dpo-live-only-admin');
const failures = [];

function assert(condition, message) {
    if (!condition) failures.push(message);
}

function read(rel) {
    return fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
}

function checkSources() {
    const admin = read('admin/app/pages/settings-payment.js');
    assert(admin.includes('LIVE Payment Control Center'), 'Admin must title the LIVE control center');
    assert(admin.includes('Save LIVE payment settings'), 'Admin must save LIVE payment settings');
    assert(admin.includes('data-payment-cred-panel="live"'), 'LIVE credential panel must remain');
    assert(admin.includes('Official LIVE Service Type ID is 112815'), 'LIVE Service Type 112815 must be named');
    assert(admin.includes('112815 — Shoes') || admin.includes('112815 - Shoes'), 'LIVE Service Type label may show 112815 — Shoes');
    assert(admin.includes('payv3.php'), 'LIVE payment URL must be payv3.php');
    assert(admin.includes('https://secure.3gdirectpay.com/API/v6/'), 'LIVE API v6 must be displayed');
    assert(!admin.includes('data-payment-mode-tab="test"'), 'TEST credential tab must be removed');
    assert(!admin.includes('data-payment-cred-panel="test"'), 'TEST credential panel must be removed');
    assert(!admin.includes('Test TEST credentials'), 'TEST probe button must be removed');
    assert(!admin.includes('Last TEST probe'), 'Last TEST probe UI must be removed');
    assert(!admin.includes('TEST endpoints'), 'TEST endpoints section must be removed');
    assert(!admin.includes('Checkout TEST'), 'Checkout TEST label must be removed');
    assert(!admin.includes('TEST operating'), 'TEST operating label must be removed');
    assert(!admin.includes('testAdminPaymentConnection'), 'Admin page must not call the TEST probe from the UI');
    assert(admin.includes('window.confirm'), 'saving a LIVE Company Token needs confirmation');
    assert(admin.includes('mode: "live"'), 'Admin save must persist LIVE operating mode');
    assert(admin.includes('No LIVE gateway payment activity yet'), 'Admin activity empty state must be LIVE-only');
    assert(!admin.includes('Last TEST Probe'), 'Admin must not display Last TEST Probe');

    const settings = read('server/services/paymentsettings.service.js');
    assert(settings.includes("checkoutEnvironment: 'live'"), 'Admin capabilities must report LIVE checkout');
    assert(settings.includes("operatingMode: 'live'"), 'Admin capabilities must report LIVE operating mode');
    assert(settings.includes('LIVE Company Token is not configured'), 'incomplete LIVE must explain the missing token');
    assert(settings.includes("mode: 'live'"), 'payment activity query must request LIVE records');
    assert(settings.includes('listAdminPaymentActivity'), 'payment activity must use a dedicated LIVE query');
    assert(!/If LIVE credentials are missing, use TEST/i.test(settings), 'must not silently fall back from LIVE to TEST');

    const config = read('server/payments/dpo/config.js');
    assert(config.includes("CHECKOUT_MODE = 'live'"), 'production checkout mode must be LIVE');
    assert(config.includes("operatingMode: 'live'"), 'active checkout must force LIVE');
    assert(config.includes("label: 'Pay Online'"), 'public checkout label must stay customer-safe');
    assert(config.includes('choose Cash on Delivery'), 'LIVE fail-safe must offer Cash on Delivery');

    const provider = read('server/payments/providers/dpo.provider.js');
    assert(provider.includes("LIVE_SERVICE_TYPE_ID = '112815'"), 'LIVE Service Type must be 112815');
    assert(provider.includes("TEST_SERVICE_TYPE_ID = '54841'"), 'TEST Service Type 54841 must stay rejected for LIVE');

    const routes = read('server/routes/adminpayment.js');
    assert(routes.includes('adminAccessDisabled'), 'payment configuration routes must require Admin auth');

    const navigation = read('admin/app/core/navigation.js');
    assert(navigation.includes('Payment Management'), 'Payment Management navigation must remain');
    assert(!/TEST\/LIVE mode/.test(navigation), 'navigation must not describe TEST/LIVE as the active workflow');
}

async function checkLiveOnlyControlFlow() {
    if (!String(process.env.PAYMENT_ENCRYPTION_KEY || '').trim()) {
        process.env.PAYMENT_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    }

    const secretsStore = require('../server/payments/secrets.store');
    assert(!isRealCredentialsPath(secretsStore.getCredentialsFilePath()), 'must use isolated credential store');
    resetUndecryptableStoreIfSafe(secretsStore, 'verify-dpo-live-only-admin');

    const { connectDatabase } = require('../server/database');
    await connectDatabase();

    const paymentSettingsService = require('../server/services/paymentsettings.service');
    const dpoConfig = require('../server/payments/dpo/config');
    const settingsSnapshot = await snapshotPaymentSettingsFlags(paymentSettingsService);
    const liveToken = `LIVE-ONLY-${crypto.randomBytes(12).toString('hex')}`;
    const testToken = `LOCAL-VERIFY-${crypto.randomBytes(12).toString('hex')}`;

    try {
        const before = await paymentSettingsService.getAdminPaymentSettings();
        assert(before.mode === 'live', 'Admin view must report LIVE before credentials are saved');
        assert(before.capabilities.checkoutEnvironment === 'live', 'checkout environment must be LIVE');
        assert(before.capabilities.liveConnectionVerified === false, 'LIVE connection must stay unverified');
        if (!before.capabilities.liveCredentialsStored) {
            assert(before.capabilities.liveCheckoutActive === false, 'LIVE checkout must stay inactive until configuration is complete');
            let incomplete = null;
            try {
                await dpoConfig.getActiveDpoConfiguration();
            } catch (error) {
                incomplete = error;
            }
            assert(incomplete && incomplete.code === 'DPO_LIVE_NOT_CONFIGURED', 'incomplete LIVE must fail safely before credentials are saved');
            assert(/Cash on Delivery/i.test(incomplete.message || ''), 'customer failure must offer Cash on Delivery');
        }
        assert(!JSON.stringify(before).includes(liveToken), 'Admin view must not invent a LIVE Company Token');

        let rejected = null;
        try {
            await paymentSettingsService.updatePaymentSettings({
                mode: 'live',
                credentials: {
                    live: {
                        companyToken: liveToken,
                        serviceType: '54841'
                    }
                }
            }, { id: 'ADMIN_VERIFY_LIVE_ONLY', email: 'admin@example.com' });
        } catch (error) {
            rejected = error;
        }
        assert(rejected, 'LIVE save must reject TEST Service Type 54841');

        const saved = await paymentSettingsService.updatePaymentSettings({
            enabled: true,
            providerEnabled: true,
            activeProvider: 'dpo',
            mode: 'live',
            credentials: {
                test: {
                    companyToken: testToken,
                    serviceType: '54841'
                },
                live: {
                    companyToken: liveToken,
                    serviceType: '112815-Shoes'
                }
            }
        }, { id: 'ADMIN_VERIFY_LIVE_ONLY', email: 'admin@example.com' });

        assert(!JSON.stringify(saved).includes(liveToken), 'save response must not return the LIVE Company Token');
        assert(saved.mode === 'live', 'saved Admin view must stay LIVE');
        assert(saved.capabilities.liveCredentialsStored === true, 'LIVE credentials must show as stored');
        assert(String(saved.providers[0].credentials.live.fields.companyToken.hint).includes(liveToken.slice(-4)), 'LIVE token must be masked');
        assert(saved.capabilities.liveServiceType === '112815', 'LIVE Service Type must persist as 112815');
        assert(saved.capabilities.liveConfigurationComplete === true, 'LIVE configuration must be ready');
        assert(saved.capabilities.liveCheckoutActive === true, `LIVE checkout must activate when configuration is complete (${saved.capabilities.liveActivationBlockedReason || 'no reason'})`);
        assert(/API\/v6/i.test(saved.capabilities.liveApiEndpoint || ''), 'LIVE API must be API v6');
        assert(/payv3\.php/i.test(saved.capabilities.livePaymentPageUrl || ''), 'LIVE payment URL must be payv3.php');

        const reloaded = await paymentSettingsService.getAdminPaymentSettings();
        assert(reloaded.mode === 'live', 'reload must keep LIVE operating mode');
        assert(reloaded.capabilities.liveServiceType === '112815', 'reload must keep Service Type 112815');
        assert(reloaded.providers[0].credentials.live.fields.companyToken.configured === true, 'reload must keep the masked LIVE token');
        assert(!JSON.stringify(reloaded).includes(liveToken), 'reload must not reveal the LIVE Company Token');

        const runtime = await dpoConfig.getActiveDpoConfiguration();
        assert(runtime.mode === 'live', 'backend checkout must use LIVE');
        assert(runtime.secrets.companyToken === liveToken, 'backend must use the Admin-saved LIVE token');
        assert(runtime.secrets.serviceType === '112815', 'backend must use Service Type 112815');
        assert(runtime.secrets.companyToken !== testToken, 'backend must not fall back to TEST');

        const publicConfig = await dpoConfig.getPublicCheckoutConfig();
        assert(publicConfig.enabled === true, 'customer online checkout must be available when LIVE is complete');
        assert(publicConfig.label === 'Pay Online', 'customer label must stay Pay Online');
        assert(publicConfig.mode == null, 'customer API must not expose Operating Mode');
        assert(publicConfig.companyToken == null, 'customer API must not expose Company Token');
        assert(!JSON.stringify(publicConfig).includes(liveToken), 'customer API must not include the LIVE Company Token');
        assert(!/"serviceType"\s*:\s*"/.test(JSON.stringify(publicConfig)), 'customer API must not include Service Type');

        await paymentSettingsService.updatePaymentSettings({
            enabled: false,
            mode: 'live'
        }, { id: 'ADMIN_VERIFY_LIVE_ONLY', email: 'admin@example.com' });
        const disabled = await paymentSettingsService.getAdminPaymentSettings();
        assert(disabled.capabilities.liveCheckoutActive === false, 'LIVE checkout must go inactive when online payments are off');
        const publicDisabled = await dpoConfig.getPublicCheckoutConfig();
        assert(publicDisabled.enabled === false, 'customer online checkout must be unavailable when payments are off');
        assert(disabled.lastTest == null, 'Admin LIVE view must not include Last TEST Probe data');

        const activity = await paymentSettingsService.getRecentPaymentActivity({ limit: 5 });
        assert(Array.isArray(activity), 'historical payment activity must remain available');
        activity.forEach((row) => {
            assert(row.mode === 'live', 'production payment activity must be LIVE-only');
            assert(!Object.prototype.hasOwnProperty.call(row, 'companyToken'), 'activity must not include Company Token');
        });
    } finally {
        await restorePaymentSettingsFlags(paymentSettingsService, settingsSnapshot);
    }
}

async function main() {
    console.log('[verify-dpo-live-only-admin] starting LIVE-only Admin Payment Management checks');
    console.log(`[verify-dpo-live-only-admin] isolated store: ${verifyStore.isolatedPath}`);
    checkSources();
    await checkLiveOnlyControlFlow();

    if (failures.length) {
        console.error('[verify-dpo-live-only-admin] FAIL');
        failures.forEach((message) => console.error(` - ${message}`));
        process.exitCode = 1;
        return;
    }

    console.log('[verify-dpo-live-only-admin] PASS');
    console.log(' Admin Payment Management is LIVE-only');
    console.log(' LIVE Service Type: 112815');
    console.log(' LIVE API: https://secure.3gdirectpay.com/API/v6/');
    console.log(' LIVE payment URL: payv3.php');
    console.log(' No TEST fallback');
    console.log(' Historical payment records were not deleted');
    console.log(' No real LIVE transaction performed');
}

main().catch((error) => {
    console.error('[verify-dpo-live-only-admin] FAIL:', error.message);
    process.exitCode = 1;
});
