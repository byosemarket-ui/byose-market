#!/usr/bin/env node
/**
 * STEP 4 safety checks — no DPO API calls, no Admin connection tests.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const {
    isolateVerifyCredentialStore,
    isPlaceholderCompanyToken,
    isRealCredentialsPath,
    REAL_CREDENTIALS_FILE
} = require('./lib/payment-verify-guard');

const realExistsBefore = fs.existsSync(REAL_CREDENTIALS_FILE);
const realStatBefore = realExistsBefore ? fs.statSync(REAL_CREDENTIALS_FILE) : null;

const isolated = isolateVerifyCredentialStore('verify-step4-guard');
assert.strictEqual(isRealCredentialsPath(isolated.isolatedPath), false);
assert.ok(isPlaceholderCompanyToken('LOCAL-VERIFY-abc'));
assert.ok(isPlaceholderCompanyToken('verify-token-abc'));
assert.strictEqual(isPlaceholderCompanyToken('B3F59BE7-0756-420E-BB88-1D98E7A6B040'), false);

const secretsStore = require('../server/payments/secrets.store');
assert.strictEqual(
    path.resolve(secretsStore.getCredentialsFilePath()),
    path.resolve(isolated.isolatedPath)
);

const dpoProvider = require('../server/payments/providers/dpo.provider');
const sanitized = dpoProvider.sanitizeProviderConfig({
    endpoints: {
        test: {
            apiBaseUrl: 'https://secure.3gdirectpay.com/API/v6/',
            paymentPageUrl: 'https://secure.3gdirectpay.com/payv2.php'
        },
        live: {
            apiBaseUrl: 'https://secure.3gdirectpay.com/API/v6/',
            paymentPageUrl: 'https://secure.3gdirectpay.com/payv2.php'
        }
    }
});
assert.match(sanitized.endpoints.test.paymentPageUrl, /payv3\.php\?ID=token/i);
assert.match(sanitized.endpoints.live.paymentPageUrl, /payv2\.php/i, 'LIVE payv2 must remain unchanged');

const realExistsAfter = fs.existsSync(REAL_CREDENTIALS_FILE);
assert.strictEqual(realExistsAfter, realExistsBefore, 'real credential store existence must not change');
if (realStatBefore) {
    const realStatAfter = fs.statSync(REAL_CREDENTIALS_FILE);
    assert.strictEqual(
        realStatAfter.mtimeMs,
        realStatBefore.mtimeMs,
        'real payment-credentials.enc must not be modified'
    );
}

console.log(JSON.stringify({
    ok: true,
    isolatedPath: isolated.isolatedPath,
    realStoreUntouched: true,
    testPaymentPageUpgradedToPayV3: true,
    livePaymentPageUnchanged: true,
    dpoConnectionTestExecuted: false
}, null, 2));
