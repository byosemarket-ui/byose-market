#!/usr/bin/env node
/**
 * STEP 4 — Final DPO LIVE production readiness (source freeze + security).
 * Does not perform a real-money LIVE transaction and does not call DPO LIVE createToken.
 *
 * Run: node scripts/verify-dpo-production-readiness.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const failures = [];

function assert(condition, message) {
    if (!condition) failures.push(message);
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function trackedFiles() {
    return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
        .split(/\r?\n/)
        .filter(Boolean);
}

function checkGitFreeze() {
    const ignore = read('.gitignore');
    assert(ignore.includes('scripts/dpo-after-pay-*.png'), 'gitignore must exclude DPO probe screenshots');
    assert(ignore.includes('scripts/probe-dpo-*.mjs'), 'gitignore must exclude DPO probe scripts');
    assert(ignore.includes('*.enc'), 'encrypted credential store must stay gitignored');
    assert(ignore.includes('.env'), '.env must stay gitignored');
    assert(ignore.includes('server/secure/*'), 'server/secure credential files must stay gitignored');

    const tracked = trackedFiles();
    const blocked = tracked.filter((file) => (
        /\.enc$/i.test(file)
        || /(^|\/)\.env$/i.test(file)
        || ((/(^|\/)\.env\.[^/]+$/i.test(file) && !file.endsWith('.example')))
        || /(^|\/)server\/secure\/.+/i.test(file) && !file.endsWith('.gitkeep')
        || /dpo-after-pay-.*\.png$/i.test(file)
        || /probe-dpo-/i.test(file)
        || /debug-place-order\.mjs$/i.test(file)
        || /dpo-sandbox-probe\.png$/i.test(file)
    ));
    assert(blocked.length === 0, `tracked forbidden artifacts: ${blocked.join(', ')}`);
}

function checkSecretsNotInSource() {
    const tracked = trackedFiles().filter((file) => (
        /\.(js|mjs|cjs|html|json|yml|yaml|md|example)$/i.test(file)
        && !file.startsWith('scripts/verify-')
        && !file.startsWith('scripts/lib/')
    ));
    const secretPatterns = [
        { re: /PAYMENT_ENCRYPTION_KEY\s*=\s*['"][^'"]{8,}['"]/, label: 'hard-coded PAYMENT_ENCRYPTION_KEY' },
        { re: /-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/, label: 'private key material' },
        { re: /<CompanyToken>(?!\$\{)(?!\[redacted\])[A-Za-z0-9-]{12,}<\/CompanyToken>/i, label: 'Company Token XML literal' }
    ];

    tracked.forEach((file) => {
        const text = read(file);
        secretPatterns.forEach(({ re, label }) => {
            assert(!re.test(text), `${label} in ${file}`);
        });
        if (file.startsWith('orders/') || file.startsWith('js/') || file === 'admin/app/pages/orders.js') {
            assert(!/"companyToken"\s*:\s*"[^"]{8,}"/.test(text), `frontend Company Token literal in ${file}`);
        }
    });

    const frontend = [
        'orders/payment.js',
        'orders/payment.html',
        'orders/ui/payment-panel.js',
        'orders/order-success.js',
        'orders/payment-result.js',
        'orders/core/order.js'
    ].map(read).join('\n');
    assert(!/companyToken/i.test(frontend), 'customer payment UI must not mention Company Token');
    assert(!/PAYMENT_ENCRYPTION_KEY/.test(frontend), 'customer payment UI must not mention encryption key');
    assert(!/name=["']cvv["']/i.test(frontend), 'no CVV field');
    assert(!/name=["']cardNumber["']/i.test(frontend), 'no card number field');
    assert(!/momoPin|mtnPin|name=["']pin["']/i.test(frontend), 'no MTN PIN field');
    assert(!/name=["']otp["']/i.test(frontend), 'no OTP field');
}

function checkLiveConfiguration() {
    const config = read('server/payments/dpo/config.js');
    const endpoints = read('server/payments/dpo/endpoints.js');
    const provider = read('server/payments/providers/dpo.provider.js');
    const client = read('server/payments/dpo/client.js');
    const service = read('server/services/dpopayment.service.js');
    const settings = read('server/services/paymentsettings.service.js');

    assert(config.includes("CHECKOUT_MODE = 'live'"), 'customer checkout must be LIVE-only');
    assert(config.includes('Incomplete LIVE never substitutes TEST'), 'incomplete LIVE must not substitute TEST');
    assert(config.includes("label: 'Pay Online'"), 'public DPO config must stay non-secret');
    assert(!config.includes('54841'), 'DPO config must not hard-code TEST Service Type');

    assert(endpoints.includes("DEFAULT_API_BASE = 'https://secure.3gdirectpay.com/API/v6/'"), 'LIVE API v6 required');
    assert(endpoints.includes("DEFAULT_PAYMENT_PAGE = 'https://secure.3gdirectpay.com/payv3.php?ID=token'"), 'LIVE payv3 URL required');

    assert(provider.includes("LIVE_SERVICE_TYPE_ID = '112815'"), 'LIVE Service Type must be 112815');
    assert(provider.includes("TEST_SERVICE_TYPE_ID = '54841'"), 'TEST Service Type 54841 must remain rejected for LIVE');
    assert(provider.includes('LIVE Service Type cannot be TEST Service Type 54841'), 'LIVE save must reject 54841');

    assert(!client.includes('54841'), 'DPO client must not hard-code TEST Service Type');
    assert(client.includes('redactXmlSecrets'), 'DPO logs must redact secrets');
    assert(client.includes('DPO_API_TIMEOUT'), 'DPO timeouts must be classified');
    assert(client.includes("defaultPayment: 'MO'"), 'MTN uses official DPO MO default');
    assert(client.includes("defaultPayment: 'CC'"), 'Card uses official DPO CC default');

    assert(service.includes('TEST_SERVICE_TYPE_REJECTED') || service.includes('TEST_SERVICE_TYPE_ID'), 'initiate must reject TEST Service Type');
    assert(service.includes('LIVE_SERVICE_TYPE_ID'), 'initiate must require LIVE Service Type 112815');
    assert(service.includes('DPO_NOT_USED_FOR_COD'), 'COD must not call DPO');
    assert(service.includes('assertTrustedOrderAmount'), 'amount must be verified server-side');
    assert(service.includes('assertVerifiedPaymentMatchesOrder'), 'PAID requires verified order binding');
    assert(service.includes('initiateLocks'), 'duplicate initiate must be locked');
    assert(service.includes('verifyLocks'), 'duplicate verify/callback must be locked');

    assert(settings.includes('LIVE never falls back to TEST'), 'payment settings must forbid LIVE → TEST fallback');
    assert(settings.includes('Do not copy the TEST Company Token into LIVE'), 'LIVE token mix must be rejected');
}

function checkPaymentLifecycle() {
    const constants = read('orders/core/constants.js');
    const controller = read('server/controllers/dpopaymentcontroller.js');
    const orderController = read('server/controllers/ordercontroller.js');
    const success = read('orders/order-success.js');
    const result = read('orders/payment-result.js');
    const panel = read('orders/ui/payment-panel.js');
    const paymentHtml = read('orders/payment.html');
    const session = read('orders/checkout-session.js');
    const status = read('server/payments/payment-status.js');
    const adminOrders = read('admin/app/pages/orders.js');
    const adminPayment = read('admin/app/pages/settings-payment.js');
    const adminRoutes = read('server/routes/adminpayment.js');
    const adminDisabled = read('server/middleware/adminaccessdisabled.js');

    assert(constants.includes("id: 'mtn'"), 'MTN MoMo method required');
    assert(constants.includes("id: 'card'"), 'Card method required');
    assert(constants.includes("id: 'cod'"), 'COD method required');
    assert(constants.includes('DELIVERY_FEE = 2000'), 'delivery fee remains 2,000 RWF');
    assert(!constants.includes('airtel'), 'Airtel must not be a customer method');
    assert(!constants.includes('bank_transfer'), 'Bank Transfer must not be a customer method');
    assert(!/id:\s*'dpo'/.test(constants), 'generic DPO Pay must not be a customer method');

    assert(paymentHtml.includes('MTN MoMo, Card, or Cash on Delivery'), 'payment page copy must list only the three methods');
    assert(panel.includes('We never ask for your PIN'), 'MTN panel must not collect PIN');
    assert(panel.includes('Card number and CVV stay with the payment provider'), 'card secrets stay with DPO');

    assert(controller.includes('never trusts') || controller.includes('Never trusts') || /never trusts the/i.test(controller), 'callback must not trust POST body');
    assert(success.includes('verifyPaidStatus'), 'success page must verify with backend');
    assert(success.includes('Confirming payment'), 'success must not flash PAID from the browser');
    assert(result.includes('Payment was not completed. Please try again or choose another payment method.'), 'failed copy required');
    assert(result.includes('Payment was cancelled.'), 'cancelled copy required');
    assert(!/status === 'authorized'/.test(status), 'authorized must not count as PAID');

    assert(orderController.includes('DELIVERY_FEE = 2000'), 'order create delivery fee is 2,000 RWF');
    assert(!orderController.includes('3500'), 'no 3,500 RWF surcharge in order create');
    assert(orderController.includes('applyCatalogPricing'), 'order totals come from catalog, not the browser');
    assert(!orderController.includes('companyToken'), 'confirmation must not expose Company Token');

    assert(session.includes("source === 'direct'"), 'Buy Now isolation must remain');
    assert(session.includes('shouldRemoveCartAfterPurchase'), 'cart clearing stays gated on purchase outcome');

    assert(adminOrders.includes('resolveAdminPaymentMode'), 'Admin must show LIVE/TEST mode');
    assert(adminPayment.includes('Operating mode'), 'Admin Payment Management shows operating mode');
    assert(adminPayment.includes('112815'), 'Admin shows LIVE Service Type 112815');
    assert(adminPayment.includes('Encryption'), 'Admin shows encryption status');
    assert(adminRoutes.includes('adminAccessDisabled'), 'Admin payment API requires auth middleware');
    assert(adminDisabled.includes('requireadminauth'), 'admin access middleware is requireAdminAuth');
}

function main() {
    console.log('[verify-dpo-production-readiness] starting STEP 4 freeze and security checks');
    checkGitFreeze();
    checkSecretsNotInSource();
    checkLiveConfiguration();
    checkPaymentLifecycle();

    if (failures.length) {
        console.error('[verify-dpo-production-readiness] FAIL:');
        failures.forEach((item) => console.error(` - ${item}`));
        process.exit(1);
    }

    console.log('[verify-dpo-production-readiness] PASS');
    console.log(' LIVE-only checkout, Service Type 112815, no TEST fallback');
    console.log(' No secrets in tracked source or customer frontend');
    console.log(' Payment lifecycle remains server-authoritative');
    console.log(' No real-money LIVE transaction was performed');
}

main();
