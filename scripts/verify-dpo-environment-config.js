#!/usr/bin/env node
/**
 * STEP 3 — DPO TEST/LIVE configuration architecture.
 * Confirms TEST remains the active checkout environment, LIVE stays
 * unconfigured/inactive, and TEST/LIVE credentials cannot mix.
 *
 * Run: node scripts/verify-dpo-environment-config.js
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];

function assert(condition, message) {
    if (!condition) failures.push(message);
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function checkSources() {
    const config = read('server/payments/dpo/config.js');
    assert(config.includes('getActiveDpoConfiguration'), 'resolver must expose getActiveDpoConfiguration');
    assert(config.includes('getEnvironmentConfiguration'), 'resolver must load one environment at a time');
    assert(config.includes('LIVE_CHECKOUT_ENABLED = false'), 'LIVE checkout must stay gated off');
    assert(config.includes('DPO_LIVE_NOT_CONFIGURED'), 'missing LIVE credentials must have a dedicated error');
    assert(config.includes('DPO_LIVE_CREDENTIAL_MIX'), 'TEST/LIVE Company Token mix must be rejected');
    assert(!/LIVE_CHECKOUT_ENABLED\s*=\s*true/.test(config), 'LIVE must not be hard-enabled');

    const settings = read('server/services/paymentsettings.service.js');
    assert(settings.includes('DPO_LIVE_CHECKOUT_DISABLED'), 'Admin must not activate LIVE checkout yet');
    assert(settings.includes('Do not copy the TEST Company Token into LIVE'), 'saving TEST token as LIVE must be rejected');
    assert(settings.includes('getCheckoutEnvironmentMode'), 'checkout environment must be server-decided');

    const admin = read('admin/app/pages/settings-payment.js');
    assert(admin.includes('window.confirm'), 'switching to LIVE operating mode needs confirmation');
    assert(admin.includes('Checkout ${escapeHtml(checkoutEnvironment.toUpperCase())}') || admin.includes('Checkout ${escapeHtml(checkoutEnvironment'), 'Admin must show checkout environment');
    assert(admin.includes('LIVE credentials'), 'Admin must show LIVE credential status');
    assert(!/Airtel Money/.test(admin), 'Admin payment page is not the customer method list');

    const constants = read('orders/core/constants.js');
    assert(constants.includes("id: 'mtn'"), 'customer methods still include MTN MoMo');
    assert(constants.includes("id: 'card'"), 'customer methods still include Card');
    assert(constants.includes("id: 'cod'"), 'customer methods still include Cash on Delivery');
    assert(!/id:\s*'dpo'/.test(constants), 'DPO must not return as a customer method');

    const env = read('server/config/env.js');
    assert(env.includes('liveCheckoutEnabled: false'), 'env must not activate LIVE checkout');
}

function main() {
    console.log('[verify-dpo-environment-config] starting STEP 3 source checks');
    checkSources();

    const dpoConfig = require('../server/payments/dpo/config');
    assert(dpoConfig.LIVE_CHECKOUT_ENABLED === false, 'LIVE_CHECKOUT_ENABLED export must be false');
    assert(dpoConfig.isLiveCheckoutGateOpen() === false, 'LIVE gate must be closed');
    const decision = dpoConfig.resolveCheckoutEnvironment();
    assert(decision.mode === 'test', 'checkout environment must resolve to TEST');
    assert(decision.liveCheckoutEnabled === false, 'LIVE checkout flag must be false');
    assert(decision.liveAvailable === false, 'LIVE must not be available to customers');

    if (failures.length) {
        console.error('[verify-dpo-environment-config] FAIL:');
        failures.forEach((item) => console.error(` - ${item}`));
        process.exit(1);
    }

    console.log('[verify-dpo-environment-config] PASS');
    console.log(' Checkout environment: TEST');
    console.log(' LIVE checkout: inactive / not configured');
    console.log(' Customer methods unchanged: MTN MoMo, Card, Cash on Delivery');
}

main();
