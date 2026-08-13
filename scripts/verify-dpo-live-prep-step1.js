#!/usr/bin/env node
/**
 * STEP 1 — DPO TEST-to-LIVE migration preparation.
 * Confirms the payment architecture is LIVE-ready while LIVE checkout stays
 * inactive, TEST-only customer behavior is gone, and no LIVE credentials
 * are hard-coded.
 *
 * Run: node scripts/verify-dpo-live-prep-step1.js
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

function checkCustomerPaymentUi() {
    const constants = read('orders/core/constants.js');
    assert(constants.includes("id: 'mtn'"), 'MTN MoMo must remain a customer method');
    assert(constants.includes("id: 'card'"), 'Card must remain a customer method');
    assert(constants.includes("id: 'cod'"), 'Cash on Delivery must remain a customer method');
    assert(constants.includes('DELIVERY_FEE = 2000'), 'delivery fee fallback must remain 2,000 RWF');
    assert(!constants.includes("id: 'airtel'"), 'Airtel must not be a customer method');
    assert(!constants.includes("id: 'bank'"), 'Bank Transfer must not be a customer method');
    assert(!/id:\s*'dpo'/.test(constants), 'standalone DPO Pay must not be a customer method');
    assert(!/TEST MODE|SANDBOX|Test card|test card|DPO test/i.test(constants), 'customer constants must not show TEST labels');

    const paymentJs = read('orders/payment.js');
    assert(paymentJs.includes('initiateDpoPayment'), 'MTN/Card must still start DPO');
    assert(paymentJs.includes('isCodPaymentMethod'), 'COD path must remain');
    assert(!/TEST MODE|SANDBOX|Test card|sandbox payment/i.test(paymentJs), 'payment.js must not show TEST labels');

    const layout = read('orders/ui/layout.js');
    assert(!/Airtel/i.test(layout), 'Airtel must not appear in payment layout');
    assert(!/Bank Transfer/i.test(layout), 'Bank Transfer must not appear in payment layout');
    assert(!/DPO Pay/i.test(layout), 'DPO Pay must not appear in payment layout');
    assert(!/TEST MODE|SANDBOX|Test card/i.test(layout), 'payment layout must not show TEST labels');

    const result = read('orders/payment-result.js');
    assert(!/DPO payment/i.test(result), 'customer payment-result must not mention DPO as the payment method');
    assert(!/TEST MODE|SANDBOX|Test card/i.test(result), 'payment-result must not show TEST labels');

    const orderJs = read('orders/core/order.js');
    assert(!orderJs.includes('Unable to start DPO payment'), 'customer initiate errors must not say DPO payment');
    assert(orderJs.includes('Unable to start online payment'), 'customer initiate errors must stay generic');

    const contact = read('contact.html');
    assert(!/bank transfer/i.test(contact), 'contact FAQ must not advertise bank transfer');
    assert(/MTN MoMo/i.test(contact), 'contact FAQ must mention MTN MoMo');
}

function checkArchitecturePreserved() {
    const dpoService = read('server/services/dpopayment.service.js');
    assert(dpoService.includes('getActiveDpoConfiguration'), 'payment service must use the environment resolver');
    assert(dpoService.includes('loadRuntimeForOrder'), 'verify must use the environment stored on the order');
    assert(dpoService.includes('sameEnvironment'), 'token reuse must not cross TEST/LIVE');
    assert(!dpoService.includes('FORCED_MODE'), 'payment service must not force TEST');
    assert(!dpoService.includes('loadTestRuntime'), 'payment service must not expose a TEST-only runtime alias');
    assert(dpoService.includes('DPO_NOT_USED_FOR_COD'), 'COD must not create a DPO transaction');
    assert(dpoService.includes('createToken'), 'createToken path must remain');
    assert(dpoService.includes('verifyAndUpdateOrder'), 'verification path must remain');

    const client = read('server/payments/dpo/client.js');
    assert(!client.includes('DPO-TEST'), 'DPO HTTP client must not advertise TEST in the User-Agent');
    assert(!client.includes('DPO TEST credentials are not configured'), 'client errors must be environment-neutral');
    assert(client.includes('DPO credentials are not configured for this payment environment'), 'missing credentials must fail for the selected environment');

    const config = read('server/payments/dpo/config.js');
    assert(config.includes('OPERATING_MODE_LIVE'), 'LIVE operating mode must activate LIVE checkout');
    assert(!config.includes('LIVE_CHECKOUT_ENABLED = false'), 'hard LIVE gate must be removed');
    assert(config.includes('getEnvironmentConfiguration'), 'TEST and LIVE config must load separately');
    assert(config.includes('DPO_LIVE_CREDENTIAL_MIX'), 'copied TEST tokens must not be used as LIVE');
    assert(config.includes("label: 'Pay Online'"), 'public checkout config must not expose DPO Pay as a customer label');

    const settings = read('server/services/paymentsettings.service.js');
    assert(!settings.includes('DPO_LIVE_CHECKOUT_DISABLED'), 'Admin Operating Mode must be allowed to activate LIVE checkout');
    assert(settings.includes("mode: resolvedMode"), 'runtime credentials must stay on the requested mode');
    assert(!/If LIVE credentials are missing, use TEST/i.test(settings), 'must not silently fall back from LIVE to TEST');

    const routes = read('server/routes/dpopayments.js');
    assert(routes.includes('/callback'), 'DPO callback route must remain');
    assert(routes.includes('/return'), 'DPO return route must remain');
    assert(routes.includes('/verify'), 'DPO verify route must remain');

    const secrets = read('server/payments/secrets.store.js');
    assert(secrets.includes('aes-256-gcm'), 'encrypted credential store must remain');
    assert(secrets.includes('payment-credentials.enc'), 'existing secret store path must remain');

    const admin = read('admin/app/pages/settings-payment.js');
    assert(admin.includes('LIVE credentials'), 'Admin must keep LIVE credential fields');
    assert(admin.includes('Company Token'), 'Admin must keep Company Token fields');
    assert(admin.includes('Service Type'), 'Admin must keep Service Type fields');
    assert(admin.includes('data-payment-cred-panel="live"'), 'Admin LIVE credential panel must remain');
    assert(!admin.includes('data-payment-cred-panel="test"'), 'Admin must not present TEST credential UI');
    assert(!admin.includes('Test TEST credentials'), 'Admin must not present TEST probe controls');
}

function checkNoHardCodedSecrets() {
    const scanRoots = [
        'server/payments',
        'server/services/dpopayment.service.js',
        'server/services/paymentsettings.service.js',
        'server/config/env.js',
        'orders',
        'admin/app/pages/settings-payment.js',
        '.github/workflows/deploy.yml',
        '.env.example',
        'deploy/env.production.example'
    ];

    scanRoots.forEach((rel) => {
        const target = path.join(root, rel);
        const stat = fs.statSync(target);
        const files = stat.isDirectory()
            ? fs.readdirSync(target).map((name) => path.join(rel, name)).filter((entry) => /\.(js|yml|example)$/.test(entry))
            : [rel];
        files.forEach((file) => {
            const source = read(file);
            assert(!/companyToken\s*[:=]\s*['"][A-Za-z0-9]{16,}['"]/.test(source), `${file} must not hard-code a Company Token`);
            assert(!/DPO_LIVE_COMPANY_TOKEN\s*=\s*[^\s#]+/.test(source), `${file} must not contain a LIVE Company Token value`);
        });
    });
}

async function checkRuntimeGate() {
    require('dotenv').config({ path: path.join(root, '.env') });
    const { connectDatabase } = require('../server/database');
    await connectDatabase();

    const dpoConfig = require('../server/payments/dpo/config');
    assert(dpoConfig.LIVE_CHECKOUT_ENABLED === undefined, 'LIVE_CHECKOUT_ENABLED hard gate must be removed');
    const decision = dpoConfig.resolveCheckoutEnvironment();
    assert(decision.mode === 'live', 'default checkout environment must resolve to LIVE');
    assert(decision.liveCheckoutEnabled === true, 'LIVE is the production checkout environment');
    assert(decision.customerCheckoutAllowed === false, 'incomplete LIVE must keep customer checkout inactive');

    const liveOn = dpoConfig.resolveCheckoutEnvironment({ operatingMode: 'live', liveConfigured: true });
    assert(liveOn.mode === 'live', 'Operating Mode LIVE must select LIVE checkout');
    assert(liveOn.customerCheckoutAllowed === true, 'complete LIVE configuration must allow customer checkout');
    assert(liveOn.liveCheckoutEnabled === true, 'Operating Mode LIVE must enable LIVE checkout');

    const publicConfig = await dpoConfig.getPublicCheckoutConfig();
    const serialized = JSON.stringify(publicConfig);
    assert(!/"companyToken"\s*:\s*"[^"]+"/.test(serialized), 'public DPO config must not include companyToken');
    assert(!/"serviceType"\s*:\s*"/.test(serialized), 'public DPO config must not include serviceType value');
    assert(publicConfig.label === 'Pay Online', 'public checkout label must stay customer-safe');
    assert(publicConfig.mode == null, 'public checkout must not expose Operating Mode');
    assert(publicConfig.liveCheckoutEnabled == null, 'public checkout must not expose LIVE checkout flags');
}

async function main() {
    console.log('[verify-dpo-live-prep-step1] starting STEP 1 source and runtime checks');
    checkCustomerPaymentUi();
    checkArchitecturePreserved();
    checkNoHardCodedSecrets();
    await checkRuntimeGate();

    if (failures.length) {
        console.error('[verify-dpo-live-prep-step1] FAIL');
        failures.forEach((message) => console.error(` - ${message}`));
        process.exitCode = 1;
        return;
    }

    console.log('[verify-dpo-live-prep-step1] PASS');
    console.log(' Customer methods: MTN MoMo, Card, Cash on Delivery');
    console.log(' TEST-only customer payment labels: removed');
    console.log(' Payment architecture: LIVE checkout follows Admin Operating Mode');
    console.log(' LIVE credentials: not entered in source');
    console.log(' LIVE checkout: activated when Operating Mode is LIVE');
}

main().catch((error) => {
    console.error('[verify-dpo-live-prep-step1] FAIL:', error.message);
    process.exitCode = 1;
});
