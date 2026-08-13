#!/usr/bin/env node
/**
 * DPO TEST/LIVE configuration architecture.
 * Confirms Operating Mode selects the complete environment, LIVE never falls
 * back to TEST, and LIVE checkout is activated only when Admin selects LIVE
 * with complete LIVE credentials.
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
    assert(config.includes('OPERATING_MODE_LIVE'), 'LIVE operating mode must activate LIVE checkout');
    assert(config.includes('DPO_LIVE_NOT_CONFIGURED'), 'missing LIVE credentials must have a dedicated error');
    assert(config.includes('DPO_LIVE_CREDENTIAL_MIX'), 'TEST/LIVE Company Token mix must be rejected');
    assert(!config.includes('LIVE_CHECKOUT_ENABLED = false'), 'hard LIVE checkout gate must be removed');
    assert(!/LIVE_CHECKOUT_ENABLED\s*=\s*true/.test(config), 'LIVE must not be hard-enabled regardless of Admin mode');

    const settings = read('server/services/paymentsettings.service.js');
    assert(!settings.includes('DPO_LIVE_CHECKOUT_DISABLED'), 'Admin Operating Mode must be allowed to activate LIVE checkout');
    assert(settings.includes('Do not copy the TEST Company Token into LIVE'), 'saving TEST token as LIVE must be rejected');
    assert(settings.includes('getCheckoutEnvironmentMode'), 'checkout environment must be server-decided');

    const admin = read('admin/app/pages/settings-payment.js');
    assert(admin.includes('window.confirm'), 'switching to LIVE operating mode needs confirmation');
    assert(admin.includes('Checkout ${escapeHtml(checkoutEnvironment.toUpperCase())}') || admin.includes('Checkout ${escapeHtml(checkoutEnvironment'), 'Admin must show checkout environment');
    assert(admin.includes('LIVE credentials'), 'Admin must show LIVE credential status');
    assert(!/Airtel Money/.test(admin), 'Admin payment page is not the customer method list');

    const dpoService = read('server/services/dpopayment.service.js');
    assert(dpoService.includes('getActiveDpoConfiguration'), 'payment service must use the environment resolver');
    assert(!dpoService.includes('FORCED_MODE'), 'payment service must not force TEST');
    assert(!dpoService.includes('loadTestRuntime'), 'TEST-only runtime alias must be removed from production service');

    const client = read('server/payments/dpo/client.js');
    assert(!client.includes('DPO-TEST'), 'DPO client User-Agent must not be TEST-specific');

    const constants = read('orders/core/constants.js');
    assert(constants.includes("id: 'mtn'"), 'customer methods still include MTN MoMo');
    assert(constants.includes("id: 'card'"), 'customer methods still include Card');
    assert(constants.includes("id: 'cod'"), 'customer methods still include Cash on Delivery');
    assert(!/id:\s*'dpo'/.test(constants), 'DPO must not return as a customer method');

    const env = read('server/config/env.js');
    assert(!env.includes('liveCheckoutEnabled: false'), 'env must not hard-block LIVE checkout');
    assert(!env.includes('liveCheckoutEnabled: true'), 'env must not hard-enable LIVE checkout');
}

function main() {
    console.log('[verify-dpo-environment-config] starting LIVE activation architecture checks');
    checkSources();

    const dpoConfig = require('../server/payments/dpo/config');
    assert(dpoConfig.LIVE_CHECKOUT_ENABLED === undefined, 'LIVE_CHECKOUT_ENABLED hard gate must be removed');
    const decision = dpoConfig.resolveCheckoutEnvironment();
    assert(decision.mode === 'test', 'default checkout environment must resolve to TEST');
    assert(decision.liveCheckoutEnabled === false, 'LIVE checkout flag must be false until Operating Mode is LIVE');
    assert(decision.liveAvailable === false, 'LIVE must not be available while Operating Mode is TEST');

    const liveDecision = dpoConfig.resolveCheckoutEnvironment({ operatingMode: 'live', liveConfigured: true });
    assert(liveDecision.mode === 'live', 'operating mode LIVE must select LIVE configuration');
    assert(liveDecision.customerCheckoutAllowed === true, 'complete LIVE configuration must allow customer checkout');
    assert(liveDecision.liveCheckoutEnabled === true, 'Operating Mode LIVE must enable LIVE checkout');

    const liveIncomplete = dpoConfig.resolveCheckoutEnvironment({ operatingMode: 'live', liveConfigured: false });
    assert(liveIncomplete.mode === 'live', 'incomplete LIVE must still select LIVE, not TEST');
    assert(liveIncomplete.customerCheckoutAllowed === false, 'incomplete LIVE must fail safely');
    assert(liveIncomplete.reason === 'LIVE_NOT_CONFIGURED', 'incomplete LIVE must not fall back to TEST');

    if (failures.length) {
        console.error('[verify-dpo-environment-config] FAIL:');
        failures.forEach((item) => console.error(` - ${item}`));
        process.exit(1);
    }

    console.log('[verify-dpo-environment-config] PASS');
    console.log(' Default checkout environment: TEST');
    console.log(' Operating Mode LIVE + complete credentials: LIVE checkout');
    console.log(' Incomplete LIVE: fail safely, no TEST fallback');
    console.log(' Customer methods unchanged: MTN MoMo, Card, Cash on Delivery');
}

main();
