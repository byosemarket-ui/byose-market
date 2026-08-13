#!/usr/bin/env node
/**
 * STEP 4 — Admin Payment Management is the LIVE production control center.
 * Covers save/reload, Operating Mode TEST vs LIVE, master switches, and
 * Admin/backend synchronization without performing a real LIVE transaction.
 *
 * Run: node scripts/verify-dpo-live-admin-step4.js
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

const verifyStore = isolateVerifyCredentialStore('verify-dpo-live-admin-step4');
const failures = [];

function assert(condition, message) {
    if (!condition) failures.push(message);
}

function read(rel) {
    return fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
}

function checkSources() {
    const admin = read('admin/app/pages/settings-payment.js');
    assert(admin.includes('LIVE credentials'), 'Admin must show LIVE credential status');
    assert(admin.includes('LIVE configuration'), 'Admin must distinguish configuration from credentials');
    assert(admin.includes('LIVE checkout'), 'Admin must show LIVE checkout as a separate state');
    assert(admin.includes('Official LIVE Service Type ID is 112815'), 'Admin LIVE help must name 112815');
    assert(!admin.includes('data-payment-mode-tab="test"'), 'Admin must not present TEST credential tabs');
    assert(!admin.includes('Test TEST credentials'), 'Admin must not present TEST probe controls');
    assert(admin.includes('Save LIVE payment settings'), 'Admin save must persist LIVE settings');
    assert(admin.includes('payv3.php'), 'Admin must name the official payv3.php payment URL');
    assert(!/Airtel Money/.test(admin), 'Admin payment page is not the customer method list');
    assert(admin.includes('paymentMethodLabel') || admin.includes('Method'), 'activity must show payment method');

    const settings = read('server/services/paymentsettings.service.js');
    assert(settings.includes('liveCredentialsStored'), 'LIVE credentials stored must be a distinct capability');
    assert(settings.includes('liveConfigurationComplete'), 'LIVE configuration ready must be a distinct capability');
    assert(settings.includes('liveCheckoutActive'), 'LIVE checkout active must be a distinct capability');
    assert(settings.includes('describePaymentSettingChanges'), 'payment configuration changes must be audited');
    assert(settings.includes('paymentMethodLabel'), 'activity must retain customer payment method');
    assert(!/If LIVE credentials are missing, use TEST/i.test(settings), 'must not silently fall back from LIVE to TEST');

    const controller = read('server/controllers/adminpaymentcontroller.js');
    assert(controller.includes('auditEvents'), 'Admin payment updates must record audit events');

    const routes = read('server/routes/adminpayment.js');
    assert(routes.includes('adminAccessDisabled'), 'payment configuration routes must require Admin auth');

    const publicConfig = read('server/payments/dpo/config.js');
    assert(publicConfig.includes("label: 'Pay Online'"), 'public checkout label must stay customer-safe');
    assert(publicConfig.includes('choose Cash on Delivery'), 'LIVE fail-safe must offer Cash on Delivery');

    const constants = read('orders/core/constants.js');
    assert(constants.includes("id: 'mtn'") && constants.includes("id: 'card'") && constants.includes("id: 'cod'"), 'customer methods stay MTN, Card, COD');
    assert(constants.includes('DELIVERY_FEE = 2000'), 'delivery fee must remain 2,000 RWF');
}

async function checkAdminControlFlow() {
    if (!String(process.env.PAYMENT_ENCRYPTION_KEY || '').trim()) {
        process.env.PAYMENT_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    }

    const secretsStore = require('../server/payments/secrets.store');
    assert(!isRealCredentialsPath(secretsStore.getCredentialsFilePath()), 'must use isolated credential store');
    resetUndecryptableStoreIfSafe(secretsStore, 'verify-dpo-live-admin-step4');

    const { connectDatabase } = require('../server/database');
    await connectDatabase();

    const paymentSettingsService = require('../server/services/paymentsettings.service');
    const dpoConfig = require('../server/payments/dpo/config');
    const settingsSnapshot = await snapshotPaymentSettingsFlags(paymentSettingsService);

    const testToken = `LOCAL-VERIFY-${crypto.randomBytes(12).toString('hex')}`;
    const liveToken = `LIVE-STEP4-${crypto.randomBytes(12).toString('hex')}`;

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
        }, { id: 'ADMIN_VERIFY_STEP4', email: 'admin@example.com' });

        // Test A — save LIVE credentials
        const savedLive = await paymentSettingsService.updatePaymentSettings({
            mode: 'test',
            enabled: true,
            credentials: {
                live: {
                    companyToken: liveToken,
                    serviceType: '112815-Shoes'
                }
            }
        }, { id: 'ADMIN_VERIFY_STEP4', email: 'admin@example.com' });
        assert(!JSON.stringify(savedLive).includes(liveToken), 'save response must not return the LIVE Company Token');
        assert(savedLive.providers[0].credentials.live.fields.companyToken.configured === true, 'LIVE credentials must show as stored');
        assert(String(savedLive.providers[0].credentials.live.fields.companyToken.hint).includes(liveToken.slice(-4)), 'LIVE token must be masked');
        assert(savedLive.capabilities.liveCredentialsStored === true, 'LIVE credentials stored must be true after save');
        assert(savedLive.capabilities.liveServiceType === '112815', 'LIVE Service Type must persist as 112815');
        assert(savedLive.capabilities.liveConfigurationComplete === true, 'LIVE configuration must be ready after save');
        assert(savedLive.capabilities.liveCheckoutActive === true, 'LIVE checkout must activate when LIVE configuration is complete');
        assert(savedLive.mode === 'live', 'Admin Payment Management must report LIVE operating mode');
        assert(/API\/v6/i.test(savedLive.capabilities.liveApiEndpoint || ''), 'LIVE API must be API v6');
        assert(/payv3\.php/i.test(savedLive.capabilities.livePaymentPageUrl || ''), 'LIVE payment URL must be payv3.php');
        assert(Array.isArray(savedLive.auditEvents) && savedLive.auditEvents.some((event) => event.eventType === 'payment_live_credentials_updated'), 'saving LIVE credentials must create an audit event');
        assert(!JSON.stringify(savedLive.auditEvents).includes(liveToken), 'audit events must not record the LIVE Company Token');

        // Test B — reload
        const reloaded = await paymentSettingsService.getAdminPaymentSettings();
        assert(reloaded.mode === 'live', 'reload must keep LIVE as the production operating mode');
        assert(reloaded.providers[0].credentials.live.fields.companyToken.configured === true, 'reload must keep LIVE credentials stored');
        assert(reloaded.capabilities.liveServiceType === '112815', 'reload must keep LIVE Service Type 112815');
        assert(!JSON.stringify(reloaded).includes(liveToken), 'reload must not reveal the LIVE Company Token');
        assert(reloaded.encryption.configured === true, 'encryption must remain ready');
        assert(!reloaded.encryption.storePath, 'admin view must not expose the secret store filesystem path');

        // Test C — Operating Mode LIVE selects LIVE backend
        const liveMode = await paymentSettingsService.updatePaymentSettings({
            mode: 'live',
            enabled: true
        }, { id: 'ADMIN_VERIFY_STEP4', email: 'admin@example.com' });
        assert(liveMode.mode === 'live', 'Operating Mode LIVE must persist');
        assert(liveMode.capabilities.checkoutEnvironment === 'live', 'checkout environment must be LIVE');
        assert(liveMode.capabilities.liveCheckoutActive === true, 'LIVE checkout must be active when requirements are complete');
        assert(liveMode.capabilities.liveConnectionVerified === false, 'LIVE connection must stay unverified without a real LIVE check');
        const liveRuntime = await dpoConfig.getActiveDpoConfiguration();
        assert(liveRuntime.mode === 'live', 'backend must use LIVE configuration');
        assert(liveRuntime.secrets.companyToken === liveToken, 'backend must use the Admin-saved LIVE token');
        assert(liveRuntime.secrets.serviceType === '112815', 'backend must use Service Type 112815');
        assert(liveRuntime.secrets.companyToken !== testToken, 'LIVE backend must not use TEST Company Token');
        const publicLive = await dpoConfig.getPublicCheckoutConfig();
        assert(publicLive.enabled === true, 'customer online checkout must be available when LIVE is active');
        assert(publicLive.mode == null, 'customer config must not expose Operating Mode');

        // Test D — stored TEST mode must not take customer checkout off LIVE
        await paymentSettingsService.updatePaymentSettings({
            mode: 'test',
            enabled: true
        }, { id: 'ADMIN_VERIFY_STEP4', email: 'admin@example.com' });
        const adminAfterTestMode = await paymentSettingsService.getAdminPaymentSettings();
        assert(adminAfterTestMode.mode === 'live', 'Admin Payment Management must still present LIVE');
        const liveAfterTestMode = await dpoConfig.getActiveDpoConfiguration();
        assert(liveAfterTestMode.mode === 'live', 'customer checkout must stay on LIVE');
        assert(liveAfterTestMode.secrets.companyToken === liveToken, 'LIVE backend must keep the LIVE Company Token');
        assert(liveAfterTestMode.secrets.companyToken !== testToken, 'LIVE checkout must not fall back to TEST');
        const isolatedTest = await dpoConfig.getEnvironmentConfiguration('test');
        assert(isolatedTest.secrets.companyToken === testToken, 'TEST credentials may remain stored for isolation');
        assert(isolatedTest.secrets.serviceType === '54841', 'TEST Service Type 54841 must stay isolated from LIVE');

        // Test E — disable online payments
        const disabledOnline = await paymentSettingsService.updatePaymentSettings({
            enabled: false,
            mode: 'live'
        }, { id: 'ADMIN_VERIFY_STEP4', email: 'admin@example.com' });
        assert(disabledOnline.enabled === false, 'online payments must disable');
        assert(disabledOnline.capabilities.liveCheckoutActive === false, 'LIVE checkout must be inactive when online payments are off');
        const publicDisabled = await dpoConfig.getPublicCheckoutConfig();
        assert(publicDisabled.enabled === false, 'customer online checkout must be unavailable when payments are off');
        let disabledError = null;
        try {
            await dpoConfig.getActiveDpoConfiguration();
        } catch (error) {
            disabledError = error;
        }
        assert(disabledError, 'LIVE checkout must fail safely when online payments are disabled');
        assert(
            disabledError.code === 'DPO_LIVE_NOT_ENABLED' || disabledError.code === 'DPO_LIVE_NOT_CONFIGURED',
            `disabled LIVE must fail as LIVE, not TEST, got ${disabledError.code || disabledError.message}`
        );

        // Test F — enable online payments
        const enabledOnline = await paymentSettingsService.updatePaymentSettings({
            enabled: true,
            mode: 'live',
            providerEnabled: true
        }, { id: 'ADMIN_VERIFY_STEP4', email: 'admin@example.com' });
        assert(enabledOnline.enabled === true, 'online payments must enable');
        assert(enabledOnline.capabilities.liveCheckoutActive === true, 'LIVE checkout must become active again when configuration is complete');
        const publicEnabled = await dpoConfig.getPublicCheckoutConfig();
        assert(publicEnabled.enabled === true, 'customer online checkout must return when payments are enabled');
        const enabledRuntime = await dpoConfig.getActiveDpoConfiguration();
        assert(enabledRuntime.mode === 'live', 're-enabled checkout must stay on LIVE');

        // Test G — disable DPO provider
        const disabledProvider = await paymentSettingsService.updatePaymentSettings({
            providerEnabled: false,
            mode: 'live',
            enabled: true
        }, { id: 'ADMIN_VERIFY_STEP4', email: 'admin@example.com' });
        assert(disabledProvider.providers[0].enabled === false, 'provider must disable');
        assert(disabledProvider.capabilities.liveCheckoutActive === false, 'LIVE checkout must be inactive when the provider is disabled');
        const publicProviderOff = await dpoConfig.getPublicCheckoutConfig();
        assert(publicProviderOff.enabled === false, 'customer online checkout must be unavailable when the provider is disabled');

        const activity = await paymentSettingsService.getRecentPaymentActivity({ limit: 5 });
        assert(Array.isArray(activity), 'payment activity must remain available');
        activity.forEach((row) => {
            assert(row.mode === 'test' || row.mode === 'live', 'activity mode must stay TEST or LIVE');
            assert(!Object.prototype.hasOwnProperty.call(row, 'companyToken'), 'activity must not include Company Token');
        });
    } finally {
        await paymentSettingsService.updatePaymentSettings({
            mode: 'test',
            enabled: true,
            providerEnabled: true
        }, { id: 'ADMIN_VERIFY_STEP4', email: 'admin@example.com' }).catch(() => {});
        await restorePaymentSettingsFlags(paymentSettingsService, settingsSnapshot);
    }
}

async function main() {
    console.log('[verify-dpo-live-admin-step4] starting STEP 4 Admin LIVE control checks');
    console.log(`[verify-dpo-live-admin-step4] isolated store: ${verifyStore.isolatedPath}`);
    checkSources();
    await checkAdminControlFlow();

    if (failures.length) {
        console.error('[verify-dpo-live-admin-step4] FAIL');
        failures.forEach((message) => console.error(` - ${message}`));
        process.exitCode = 1;
        return;
    }

    console.log('[verify-dpo-live-admin-step4] PASS');
    console.log(' Admin Payment Management is the LIVE control center');
    console.log(' LIVE credentials stored / configuration ready / checkout active are distinct');
    console.log(' Admin save updates backend checkout without a code change');
    console.log(' No real LIVE transaction performed');
}

main().catch((error) => {
    console.error('[verify-dpo-live-admin-step4] FAIL:', error.message);
    process.exitCode = 1;
});
