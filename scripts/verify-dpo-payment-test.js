#!/usr/bin/env node
/**
 * Verifies DPO Pay TEST API integration (STEP 2 — Option A).
 * Mocks DPO XML responses so the full Create Token → Verify → Order Update
 * flow can be tested without calling the live gateway or embedding secrets.
 *
 * Usage: node scripts/verify-dpo-payment-test.js [baseUrl]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
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

const verifyStore = isolateVerifyCredentialStore('verify-dpo-payment-test');

let expectedCompanyToken = '';
let expectedTestCompanyToken = '';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function request(baseUrl, method, routePath, { token = '', body = null, redirect = false } = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(routePath, `${baseUrl}/`);
        const transport = url.protocol === 'https:' ? https : http;
        const payload = body == null ? null : Buffer.from(JSON.stringify(body));
        const req = transport.request({
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port,
            path: `${url.pathname}${url.search}`,
            method,
            headers: {
                Accept: 'application/json, text/html',
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            }
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                let json = null;
                try { json = JSON.parse(raw); } catch (_error) { json = null; }
                resolve({
                    status: res.statusCode || 0,
                    headers: res.headers,
                    json,
                    raw,
                    location: res.headers.location || ''
                });
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function assertNoSecretLeak(payload, label, runtimeToken = expectedCompanyToken) {
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    assert(!/"companyToken"\s*:\s*"[^"]{8,}"/.test(serialized), `${label} leaked companyToken`);
    if (runtimeToken) {
        assert(!serialized.includes(runtimeToken), `${label} leaked runtime test company token`);
    }
    assert(!/"secrets"\s*:\s*\{/.test(serialized), `${label} exposed secrets object`);
}

function ensureEphemeralTestEnv() {
    if (!String(process.env.PAYMENT_ENCRYPTION_KEY || '').trim()) {
        process.env.PAYMENT_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    }
    if (!String(process.env.DPO_TEST_COMPANY_TOKEN || '').trim()) {
        process.env.DPO_TEST_COMPANY_TOKEN = `LOCAL-VERIFY-${crypto.randomBytes(12).toString('hex')}`;
    }
    if (!String(process.env.DPO_TEST_SERVICE_TYPE || '').trim()) {
        process.env.DPO_TEST_SERVICE_TYPE = '54841';
    }
    return {
        companyToken: String(process.env.DPO_TEST_COMPANY_TOKEN).trim(),
        serviceType: String(process.env.DPO_TEST_SERVICE_TYPE).trim()
    };
}

async function seedTestCredentials() {
    const ephemeral = ensureEphemeralTestEnv();

    const secretsStore = require('../server/payments/secrets.store');
    assert(
        !isRealCredentialsPath(secretsStore.getCredentialsFilePath()),
        'verify must use an isolated credential store, not the real encrypted file'
    );
    assert(
        path.resolve(secretsStore.getCredentialsFilePath()) === path.resolve(verifyStore.isolatedPath),
        'verify credential path mismatch'
    );
    resetUndecryptableStoreIfSafe(secretsStore, 'verify-dpo-payment-test');
    assertNotWritingPlaceholderIntoRealStore(ephemeral.companyToken, 'verify-dpo-payment-test');

    const paymentSettingsService = require('../server/services/paymentsettings.service');
    const settingsSnapshot = await snapshotPaymentSettingsFlags(paymentSettingsService);
    const liveToken = `LIVE-VERIFY-${crypto.randomBytes(12).toString('hex')}`;
    await paymentSettingsService.updatePaymentSettings({
        enabled: true,
        activeProvider: 'dpo',
        mode: 'live',
        credentials: {
            test: {
                companyToken: ephemeral.companyToken,
                serviceType: ephemeral.serviceType
            },
            live: {
                companyToken: liveToken,
                serviceType: '112815'
            }
        }
    }, { id: 'ADMIN_VERIFY_DPO', email: 'admin@example.com' });

    expectedCompanyToken = liveToken;
    expectedTestCompanyToken = ephemeral.companyToken;
    return { ephemeral, settingsSnapshot, liveToken };
}

function installDpoMock(scenario = 'success') {
    const dpoClient = require('../server/payments/dpo/client');
    const transToken = `TOK-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    let createCount = 0;

    dpoClient.setHttpTransportForTests(async (_url, xmlBody) => {
        const body = String(xmlBody || '');
        if (body.includes('<Request>createToken</Request>')) {
            createCount += 1;
            assert(Boolean(expectedCompanyToken) && body.includes(expectedCompanyToken), 'createToken missing company token in request XML');
            return {
                statusCode: 200,
                body: `<?xml version="1.0" encoding="utf-8"?><API3G><Result>000</Result><ResultExplanation>Transaction created</ResultExplanation><TransToken>${transToken}</TransToken><TransRef>REF123</TransRef></API3G>`
            };
        }

        if (body.includes('<Request>verifyToken</Request>')) {
            if (scenario === 'invalid') {
                return {
                    statusCode: 200,
                    body: '<?xml version="1.0" encoding="utf-8"?><API3G><Result>802</Result><ResultExplanation>Company token does not exist</ResultExplanation></API3G>'
                };
            }
            if (scenario === 'cancelled') {
                return {
                    statusCode: 200,
                    body: '<?xml version="1.0" encoding="utf-8"?><API3G><Result>904</Result><ResultExplanation>Transaction cancelled</ResultExplanation></API3G>'
                };
            }
            if (scenario === 'failed') {
                return {
                    statusCode: 200,
                    body: '<?xml version="1.0" encoding="utf-8"?><API3G><Result>901</Result><ResultExplanation>Transaction declined</ResultExplanation></API3G>'
                };
            }
            if (scenario === 'pending') {
                return {
                    statusCode: 200,
                    body: '<?xml version="1.0" encoding="utf-8"?><API3G><Result>900</Result><ResultExplanation>Transaction not paid yet</ResultExplanation></API3G>'
                };
            }
            const refMatch = body.match(/<CompanyRef>([^<]+)<\/CompanyRef>/i);
            const companyRef = refMatch ? refMatch[1] : 'BM-REF';
            return {
                statusCode: 200,
                body: `<?xml version="1.0" encoding="utf-8"?><API3G><Result>000</Result><ResultExplanation>Transaction Paid</ResultExplanation><TransToken>${transToken}</TransToken><TransRef>REF123</TransRef><CompanyRef>${companyRef}</CompanyRef><TransactionAmount>15000.00</TransactionAmount><TransactionCurrency>RWF</TransactionCurrency></API3G>`
            };
        }

        throw new Error('Unexpected DPO request in mock transport');
    });

    return { transToken, dpoClient, getCreateCount: () => createCount };
}

async function createFixtureOrder(orderId, overrides = {}) {
    const orderDataService = require('../server/services/orderdataservice');
    const paymentMethod = String(overrides.paymentMethod || 'dpo').trim().toLowerCase() || 'dpo';
    const paymentType = String(overrides.paymentType || (paymentMethod === 'cod' ? 'cod' : 'pay_now'));
    const paymentStatus = String(overrides.paymentStatus || (paymentMethod === 'cod' ? 'awaiting_delivery_payment' : 'awaiting_payment'));
    const paymentMethodLabel = String(
        overrides.paymentMethodLabel
        || (paymentMethod === 'mtn' ? 'MTN MoMo' : paymentMethod === 'card' ? 'Card' : paymentMethod === 'cod' ? 'Cash on Delivery' : 'DPO Pay')
    );
    // Empty items avoid stock decrement during verification fixtures.
    const order = {
        orderId,
        id: orderId,
        customerName: 'Verify Customer',
        customerEmail: 'verify@example.com',
        customerPhone: '0780000000',
        isGuest: true,
        status: 'Pending',
        orderStatus: 'pending',
        paymentStatus,
        paymentStatusLabel: paymentMethod === 'cod' ? 'Awaiting Delivery Payment' : 'Awaiting Payment',
        paymentMethod,
        paymentMethodLabel,
        paymentType,
        currency: 'RWF',
        subtotal: overrides.subtotal != null ? Number(overrides.subtotal) : 13000,
        deliveryFee: overrides.deliveryFee != null ? Number(overrides.deliveryFee) : 2000,
        total: overrides.total != null ? Number(overrides.total) : 15000,
        totalAmount: overrides.totalAmount != null ? Number(overrides.totalAmount) : (overrides.total != null ? Number(overrides.total) : 15000),
        items: [],
        products: [],
        shippingAddress: {
            fullName: 'Verify Customer',
            phone: '0780000000',
            provinceCity: 'Kigali',
            district: 'Gasabo',
            sector: 'Remera',
            cell: 'Rukiri',
            village: 'Test'
        },
        payment: {
            type: paymentType,
            method: paymentMethod,
            methodLabel: paymentMethodLabel,
            status: paymentStatus,
            statusLabel: paymentMethod === 'cod' ? 'Awaiting Delivery Payment' : 'Awaiting Payment'
        },
        statusHistory: [],
        createdAt: new Date().toISOString()
    };

    const existing = await orderDataService.findOrderByIdentifier(orderId);
    if (existing) {
        await orderDataService.saveOrder({ ...existing, ...order, orderId, id: orderId });
        return orderId;
    }
    await orderDataService.createOrder(order);
    return orderId;
}

async function verifyPaidStatusMatching() {
    const { isSettledPaidStatus } = require('../server/payments/payment-status');
    assert(isSettledPaidStatus('paid') === true, 'paid should be settled');
    assert(isSettledPaidStatus('unpaid') === false, 'unpaid must not match paid');
    assert(isSettledPaidStatus('awaiting_payment') === false, 'awaiting_payment must not match paid');
    assert(isSettledPaidStatus('failed') === false, 'failed must not match paid');
    assert(isSettledPaidStatus('cancelled') === false, 'cancelled must not match paid');
    assert(isSettledPaidStatus('authorized') === false, 'authorized must not match paid');
}

async function verifyClientHelpers() {
    const dpoClient = require('../server/payments/dpo/client');
    const { extractTag, redactXmlSecrets } = require('../server/payments/dpo/xml');

    const url = dpoClient.buildPaymentPageUrl('https://secure.3gdirectpay.com/payv3.php?ID=token', 'ABC123');
    assert(url === 'https://secure.3gdirectpay.com/payv3.php?ID=ABC123', 'payment URL template failed');

    const redacted = redactXmlSecrets('<API3G><CompanyToken>SECRET-VALUE</CompanyToken></API3G>');
    assert(!redacted.includes('SECRET-VALUE'), 'xml redaction failed');
    assert(extractTag('<A><Result>000</Result></A>', 'Result') === '000', 'extractTag failed');

    const mtnHosted = dpoClient.resolveHostedPaymentOptions('mtn');
    assert(mtnHosted.defaultPayment === 'MO', 'MTN hosted default must be MO');
    assert(mtnHosted.defaultPaymentCountry === 'rwanda', 'MTN hosted country must be rwanda');
    assert(mtnHosted.defaultPaymentMno === 'MTN', 'MTN hosted operator must be MTN');
    assert(mtnHosted.blockPayments.includes('PP') && mtnHosted.blockPayments.includes('BT') && mtnHosted.blockPayments.includes('XP'), 'unused DPO methods must stay blocked');
    assert(!mtnHosted.blockPayments.includes('CC') && !mtnHosted.blockPayments.includes('MO'), 'DPO hosted page must keep Card and MTN available');

    const cardHosted = dpoClient.resolveHostedPaymentOptions('card');
    assert(cardHosted.defaultPayment === 'CC', 'Card hosted default must be CC');
    assert(!cardHosted.defaultPaymentMno, 'Card must not set a mobile operator');
    assert(!cardHosted.blockPayments.includes('MO') && !cardHosted.blockPayments.includes('CC'), 'Card path must keep MTN available on DPO');

    const mtnXml = dpoClient.buildCreateTokenXml({
        companyToken: 'COMPANY-TOKEN',
        serviceType: '112815',
        amount: 25000,
        currency: 'RWF',
        companyRef: 'BM123456',
        redirectUrl: 'https://byosemarket.com/return',
        backUrl: 'https://byosemarket.com/back',
        customerName: 'Jane Doe',
        customerEmail: 'jane@example.com',
        customerPhone: '0788123456',
        customerAddress: 'Kacyiru',
        customerCity: 'Kigali',
        paymentMethod: 'mtn'
    });
    assert(mtnXml.includes('<DefaultPayment>MO</DefaultPayment>'), 'MTN XML must default to mobile money');
    assert(mtnXml.includes('<DefaultPaymentCountry>rwanda</DefaultPaymentCountry>'), 'MTN XML must set Rwanda');
    assert(mtnXml.includes('<DefaultPaymentMNO>MTN</DefaultPaymentMNO>'), 'MTN XML must set MTN');
    assert(mtnXml.includes('<customerFirstName>Jane</customerFirstName>'), 'customer name must be reused');
    assert(mtnXml.includes('<customerPhone>250788123456</customerPhone>'), 'customer phone must be reused');
    assert(mtnXml.includes('<customerCity>Kigali</customerCity>'), 'customer city must be reused');
    assert(mtnXml.includes('<customerCountry>RW</customerCountry>'), 'customer country must be RW');
    assert(!mtnXml.includes('<BlockPayment>CC</BlockPayment>'), 'MTN XML must not hide card on DPO');
    assert(!mtnXml.includes('<BlockPayment>MO</BlockPayment>'), 'MTN XML must not block mobile');
    assert(!mtnXml.includes('<BlockPayment>SE</BlockPayment>'), 'MTN XML must not send undocumented BlockPayment SE');
    assert((mtnXml.match(/<BlockPayment>/g) || []).length === 3, 'MTN XML must block only unused DPO methods');
    assert(mtnXml.includes('<ServiceType>112815</ServiceType>'), 'LIVE Service Type 112815 required');
    assert(!mtnXml.includes('54841'), 'TEST Service Type 54841 must not appear');

    const cardXml = dpoClient.buildCreateTokenXml({
        companyToken: 'COMPANY-TOKEN',
        serviceType: '112815',
        amount: 25000,
        currency: 'RWF',
        companyRef: 'BM123456',
        redirectUrl: 'https://byosemarket.com/return',
        backUrl: 'https://byosemarket.com/back',
        customerName: 'Jane Doe',
        customerPhone: '0788123456',
        paymentMethod: 'card'
    });
    assert(cardXml.includes('<DefaultPayment>CC</DefaultPayment>'), 'Card XML must default to card');
    assert(!cardXml.includes('<DefaultPaymentMNO>'), 'Card XML must not set an MNO');
    assert(!cardXml.includes('<BlockPayment>MO</BlockPayment>'), 'Card XML must not hide mobile on DPO');
    assert(!cardXml.includes('<BlockPayment>CC</BlockPayment>'), 'Card XML must not block card');
    assert(!cardXml.includes('<BlockPayment>SE</BlockPayment>'), 'Card XML must not send undocumented BlockPayment SE');
    assert((cardXml.match(/<BlockPayment>/g) || []).length === 3, 'Card XML must block only unused DPO methods');
    assert(cardXml.includes('<ServiceType>112815</ServiceType>'), 'Card LIVE Service Type 112815 required');
    assert(!cardXml.includes('54841'), 'Card XML must not include TEST Service Type');
    assert(dpoClient.toDpoPhone('+250788123456') === '250788123456', 'toDpoPhone must strip plus');

    const paidXml = dpoClient.parseVerifyTokenResponse(
        '<API3G><Result>000</Result><CompanyRef>BM-1</CompanyRef><TransactionAmount>15000.00</TransactionAmount><TransactionCurrency>RWF</TransactionCurrency></API3G>'
    );
    assert(paidXml.companyRef === 'BM-1', 'verify XML must expose CompanyRef');
    assert(paidXml.transactionAmount === '15000.00', 'verify XML must expose amount');
    assert(paidXml.transactionCurrency === 'RWF', 'verify XML must expose currency');
    const paid = dpoClient.mapVerifyResultToPaymentStatus('000');
    const failed = dpoClient.mapVerifyResultToPaymentStatus('901');
    const cancelled = dpoClient.mapVerifyResultToPaymentStatus('904');
    const invalid = dpoClient.mapVerifyResultToPaymentStatus('802');
    assert(paid.outcome === 'success' && paid.paymentStatus === 'paid', 'paid mapping failed');
    assert(failed.outcome === 'failed', 'failed mapping failed');
    assert(cancelled.outcome === 'cancelled', 'cancelled mapping failed');
    assert(invalid.outcome === 'invalid_token', 'invalid mapping failed');
}

async function verifyServiceFlows() {
    const dpoPaymentService = require('../server/services/dpopayment.service');
    const orderDataService = require('../server/services/orderdataservice');

    // Success path
    const { dpoClient, getCreateCount } = installDpoMock('success');
    const orderId = `DPO-TEST-${Date.now().toString().slice(-8)}`;
    await createFixtureOrder(orderId);

    const initiated = await dpoPaymentService.initiatePayment({
        orderId,
        req: { get: () => '', protocol: 'http' }
    });
    assert(initiated.paymentUrl.includes('payv3.php?ID='), 'initiate should return payv3 URL');
    assertNoSecretLeak(initiated, 'initiate result');

    const reused = await dpoPaymentService.initiatePayment({
        orderId,
        req: { get: () => '', protocol: 'http' }
    });
    assert(reused.reused === true, 'awaiting_payment retry must reuse the existing DPO token');
    assert(reused.paymentUrl === initiated.paymentUrl, 'reused initiate must keep the same payment URL');
    assert(getCreateCount() === 1, `createToken should run once on retry, ran ${getCreateCount()}`);

    const verified = await dpoPaymentService.verifyAndUpdateOrder({
        orderId,
        req: { get: () => '', protocol: 'http' }
    });
    assert(verified.outcome === 'success', `expected success, got ${verified.outcome}`);
    assert(verified.paymentStatus === 'paid', 'order should be paid');
    assertNoSecretLeak(verified, 'verify success');

    const paidOrder = await orderDataService.findOrderByIdentifier(orderId);
    assert(String(paidOrder.paymentStatus).toLowerCase() === 'paid', 'persisted paymentStatus paid');
    assert(String(paidOrder.orderStatus || '').toLowerCase() === 'processing', 'paid online order status must become processing');
    assert(String(paidOrder.status || '').toLowerCase() === 'processing', 'paid online fulfillment label must become Processing');
    assert(paidOrder.payment?.gateway?.provider === 'dpo', 'gateway provider missing');
    assert(paidOrder.payment?.gateway?.mode === 'live', 'gateway mode should be LIVE');
    assert(
        paidOrder.payment?.gateway?.transRef === 'REF123'
        || paidOrder.payment?.transaction?.reference === 'REF123'
        || paidOrder.paymentReference === 'REF123'
        || paidOrder.transactionReference === 'REF123',
        'paid order must store DPO transRef for Admin'
    );
    assertNoSecretLeak(paidOrder.payment, 'saved order payment');

    // Failed path
    installDpoMock('failed');
    const failId = `${orderId}-F`;
    await createFixtureOrder(failId);
    await dpoPaymentService.initiatePayment({ orderId: failId, req: { get: () => '', protocol: 'http' } });
    const failed = await dpoPaymentService.verifyAndUpdateOrder({ orderId: failId, req: { get: () => '', protocol: 'http' } });
    assert(failed.outcome === 'failed', 'failed outcome expected');
    const failedOrder = await orderDataService.findOrderByIdentifier(failId);
    assert(String(failedOrder.paymentStatus).toLowerCase() !== 'paid', 'failed payment must not persist as paid');

    // Cancelled path (back URL) — DPO still unpaid / pending
    installDpoMock('pending');
    const cancelId = `${orderId}-C`;
    await createFixtureOrder(cancelId);
    await dpoPaymentService.initiatePayment({ orderId: cancelId, req: { get: () => '', protocol: 'http' } });
    const cancelled = await dpoPaymentService.verifyAndUpdateOrder({
        orderId: cancelId,
        markCancelled: true,
        req: { get: () => '', protocol: 'http' }
    });
    assert(cancelled.outcome === 'cancelled', 'cancelled outcome expected');
    const cancelledOrder = await orderDataService.findOrderByIdentifier(cancelId);
    assert(String(cancelledOrder.paymentStatus).toLowerCase() !== 'paid', 'cancelled payment must not persist as paid');

    // Back URL after DPO has already captured payment must stay PAID
    installDpoMock('success');
    const paidBackId = `${orderId}-PB`;
    await createFixtureOrder(paidBackId);
    await dpoPaymentService.initiatePayment({ orderId: paidBackId, req: { get: () => '', protocol: 'http' } });
    const paidBack = await dpoPaymentService.verifyAndUpdateOrder({
        orderId: paidBackId,
        markCancelled: true,
        req: { get: () => '', protocol: 'http' }
    });
    assert(paidBack.outcome === 'success' && paidBack.paymentStatus === 'paid', 'back after paid DPO result must stay paid');
    const paidBackOrder = await orderDataService.findOrderByIdentifier(paidBackId);
    assert(String(paidBackOrder.paymentStatus).toLowerCase() === 'paid', 'paid order must not become cancelled from back URL');
    assert(String(paidBackOrder.orderStatus || paidBackOrder.status).toLowerCase() !== 'paid', 'fulfillment status must stay independent of payment');
    assert(String(paidBackOrder.orderStatus || '').toLowerCase() === 'processing', 'paid back URL must set order processing');

    // Invalid token path
    installDpoMock('invalid');
    const invalidId = `${orderId}-I`;
    await createFixtureOrder(invalidId);
    await dpoPaymentService.initiatePayment({ orderId: invalidId, req: { get: () => '', protocol: 'http' } });
    const invalid = await dpoPaymentService.verifyAndUpdateOrder({ orderId: invalidId, req: { get: () => '', protocol: 'http' } });
    assert(invalid.outcome === 'invalid_token', 'invalid_token outcome expected');

    // Amount mismatch must not mark the order paid.
    dpoClient.setHttpTransportForTests(async (_url, xmlBody) => {
        const body = String(xmlBody || '');
        if (body.includes('<Request>createToken</Request>')) {
            return {
                statusCode: 200,
                body: '<?xml version="1.0" encoding="utf-8"?><API3G><Result>000</Result><TransToken>TOK-MISMATCH</TransToken><TransRef>REF-LOW</TransRef></API3G>'
            };
        }
        return {
            statusCode: 200,
            body: '<?xml version="1.0" encoding="utf-8"?><API3G><Result>000</Result><ResultExplanation>Transaction Paid</ResultExplanation><CompanyRef>OTHER-ORDER</CompanyRef><TransactionAmount>1.00</TransactionAmount><TransactionCurrency>RWF</TransactionCurrency><TransRef>REF-LOW</TransRef></API3G>'
        };
    });
    const mismatchId = `${orderId}-M`;
    await createFixtureOrder(mismatchId);
    await dpoPaymentService.initiatePayment({ orderId: mismatchId, req: { get: () => '', protocol: 'http' } });
    const mismatched = await dpoPaymentService.verifyAndUpdateOrder({
        orderId: mismatchId,
        req: { get: () => '', protocol: 'http' }
    });
    assert(mismatched.outcome !== 'success', 'mismatched DPO payment must not succeed');
    const mismatchedOrder = await orderDataService.findOrderByIdentifier(mismatchId);
    assert(String(mismatchedOrder.paymentStatus).toLowerCase() !== 'paid', 'amount/ref mismatch must not persist as paid');

    const duplicate = await dpoPaymentService.verifyAndUpdateOrder({
        orderId,
        req: { get: () => '', protocol: 'http' }
    });
    assert(duplicate.outcome === 'success' && duplicate.paymentStatus === 'paid', 'duplicate verify must remain paid');
    const duplicateOrder = await orderDataService.findOrderByIdentifier(orderId);
    assert(String(duplicateOrder.paymentStatus).toLowerCase() === 'paid', 'duplicate callback must not change paid');
    assert(String(duplicateOrder.orderStatus).toLowerCase() === 'processing', 'duplicate callback must keep processing');

    const timeoutId = `${orderId}-TO`;
    await createFixtureOrder(timeoutId);
    installDpoMock('success');
    await dpoPaymentService.initiatePayment({
        orderId: timeoutId,
        req: { get: () => '', protocol: 'http' }
    });
    dpoClient.setHttpTransportForTests(async () => {
        const error = new Error('DPO API request timed out.');
        error.code = 'DPO_API_TIMEOUT';
        throw error;
    });
    const timedOut = await dpoPaymentService.verifyAndUpdateOrder({
        orderId: timeoutId,
        req: { get: () => '', protocol: 'http' }
    });
    assert(timedOut.outcome === 'pending', `timeout must stay pending, got ${timedOut.outcome}`);
    const timedOutOrder = await orderDataService.findOrderByIdentifier(timeoutId);
    assert(String(timedOutOrder.paymentStatus).toLowerCase() !== 'paid', 'timeout must not mark paid');
    assert(String(timedOutOrder.paymentStatus).toLowerCase() !== 'failed', 'timeout must not mark failed');

    const tamperId = `${orderId}-TAMPER`;
    await createFixtureOrder(tamperId, { total: 25000, totalAmount: 25000 });
    installDpoMock('success');
    let tamperCode = '';
    try {
        await dpoPaymentService.initiatePayment({
            orderId: tamperId,
            req: { get: () => '', protocol: 'http' }
        });
    } catch (error) {
        tamperCode = String(error?.code || '');
    }
    assert(tamperCode === 'DPO_AMOUNT_MISMATCH', `tampered total must be rejected, got ${tamperCode}`);

    dpoClient.resetHttpTransport();
    return { orderId };
}

async function verifyStorefrontMethodsUseDpo() {
    const dpoPaymentService = require('../server/services/dpopayment.service');
    const orderDataService = require('../server/services/orderdataservice');
    const dpoClient = require('../server/payments/dpo/client');
    const stamp = Date.now().toString().slice(-8);

    installDpoMock('success');
    const mtnId = `DPO-MTN-${stamp}`;
    await createFixtureOrder(mtnId, { paymentMethod: 'mtn', paymentMethodLabel: 'MTN MoMo' });
    const mtnInit = await dpoPaymentService.initiatePayment({
        orderId: mtnId,
        req: { get: () => '', protocol: 'http' }
    });
    assert(String(mtnInit.paymentUrl || '').includes('payv3.php?ID='), 'MTN MoMo must start DPO hosted payment');
    const mtnOrder = await orderDataService.findOrderByIdentifier(mtnId);
    assert(String(mtnOrder.paymentMethod).toLowerCase() === 'mtn', 'DPO initiate must preserve MTN MoMo method');

    installDpoMock('success');
    const cardId = `DPO-CARD-${stamp}`;
    await createFixtureOrder(cardId, { paymentMethod: 'card', paymentMethodLabel: 'Card' });
    const cardInit = await dpoPaymentService.initiatePayment({
        orderId: cardId,
        req: { get: () => '', protocol: 'http' }
    });
    assert(String(cardInit.paymentUrl || '').includes('payv3.php?ID='), 'Card must start DPO hosted payment');
    const cardOrder = await orderDataService.findOrderByIdentifier(cardId);
    assert(String(cardOrder.paymentMethod).toLowerCase() === 'card', 'DPO initiate must preserve Card method');

    let dpoCalled = false;
    dpoClient.setHttpTransportForTests(async () => {
        dpoCalled = true;
        throw new Error('DPO must not be called for Cash on Delivery');
    });
    const codId = `DPO-COD-${stamp}`;
    await createFixtureOrder(codId, {
        paymentMethod: 'cod',
        paymentMethodLabel: 'Cash on Delivery',
        paymentType: 'cod',
        paymentStatus: 'awaiting_delivery_payment'
    });
    let initiateError = null;
    try {
        await dpoPaymentService.initiatePayment({
            orderId: codId,
            req: { get: () => '', protocol: 'http' }
        });
    } catch (error) {
        initiateError = error;
    }
    assert(initiateError && initiateError.code === 'DPO_NOT_USED_FOR_COD', 'COD initiate must be rejected without DPO');
    assert(!dpoCalled, 'COD initiate must not call DPO createToken');

    let verifyError = null;
    try {
        await dpoPaymentService.verifyAndUpdateOrder({
            orderId: codId,
            req: { get: () => '', protocol: 'http' }
        });
    } catch (error) {
        verifyError = error;
    }
    assert(verifyError && verifyError.code === 'DPO_NOT_USED_FOR_COD', 'COD verify must be rejected without DPO');
    assert(!dpoCalled, 'COD verify must not call DPO verifyToken');
    const codOrder = await orderDataService.findOrderByIdentifier(codId);
    assert(String(codOrder.paymentStatus).toLowerCase() === 'awaiting_delivery_payment', 'COD must stay unpaid/pending');
    assert(String(codOrder.paymentStatus).toLowerCase() !== 'paid', 'COD must not be marked paid');

    dpoClient.resetHttpTransport();
}

async function verifyLiveUnconfiguredAndNoMix() {
    const dpoConfig = require('../server/payments/dpo/config');
    const paymentSettingsService = require('../server/services/paymentsettings.service');

    assert(dpoConfig.resolveCheckoutEnvironment().mode === 'live', 'checkout environment decision must be LIVE by default');

    const active = await dpoConfig.getActiveDpoConfiguration();
    assert(active.mode === 'live', 'active checkout must be LIVE');
    assert(active.secrets.companyToken === expectedCompanyToken, 'active checkout must use the LIVE Company Token');
    assert(active.secrets.companyToken !== expectedTestCompanyToken, 'LIVE checkout must not fall back to TEST');
    assert(active.secrets.serviceType === '112815', 'LIVE checkout must use Service Type 112815');

    let copied = null;
    try {
        await paymentSettingsService.updatePaymentSettings({
            credentials: {
                live: {
                    companyToken: expectedTestCompanyToken,
                    serviceType: '112815'
                }
            }
        }, { id: 'ADMIN_VERIFY_DPO', email: 'admin@example.com' });
    } catch (error) {
        copied = error;
    }
    assert(copied, 'copying TEST Company Token into LIVE must be rejected');

    await paymentSettingsService.updatePaymentSettings({
        liveCheckoutEnabled: true
    }, { id: 'ADMIN_VERIFY_DPO', email: 'admin@example.com' });
    const stillLive = await dpoConfig.getActiveDpoConfiguration();
    assert(stillLive.mode === 'live', 'liveCheckoutEnabled payload must not take checkout off LIVE');
    assert(stillLive.secrets.companyToken === expectedCompanyToken, 'LIVE token must remain the Admin-saved LIVE value');
}

async function verifyCheckoutUsesLiveWhenAdminModeIsLive() {
    const paymentSettingsService = require('../server/services/paymentsettings.service');
    const dpoPaymentService = require('../server/services/dpopayment.service');

    try {
        await paymentSettingsService.updatePaymentSettings({
            enabled: true,
            activeProvider: 'dpo',
            mode: 'live',
            credentials: {
                live: {
                    companyToken: `LIVE-UNUSED-${crypto.randomBytes(6).toString('hex')}`,
                    serviceType: '112815'
                }
            }
        }, { id: 'ADMIN_VERIFY_DPO', email: 'admin@example.com' });

        const liveRuntime = await dpoPaymentService.loadCheckoutRuntime();
        assert(liveRuntime.mode === 'live', 'LIVE operating mode must activate LIVE checkout');
        assert(liveRuntime.secrets.companyToken !== expectedCompanyToken, 'LIVE resolver must not use TEST Company Token');
        assert(String(liveRuntime.secrets.companyToken).startsWith('LIVE-UNUSED-'), 'LIVE resolver must use the stored LIVE token');
        assert(liveRuntime.secrets.serviceType === '112815', 'LIVE resolver must use Service Type 112815');
        assert(/API\/v6/i.test(String(liveRuntime.endpoints.apiBaseUrl || '')), 'LIVE API endpoint must be API v6');
        assert(/payv3\.php/i.test(String(liveRuntime.endpoints.paymentPageUrl || '')), 'LIVE payment URL must be official payv3.php');

        const publicConfig = await dpoPaymentService.getPublicConfig();
        assert(publicConfig.enabled === true, 'customer checkout must be enabled when LIVE is complete');
        assert(publicConfig.label === 'Pay Online', 'public checkout label must stay customer-safe');
        assert(publicConfig.mode == null, 'public checkout must not expose Operating Mode');
        assert(publicConfig.liveCheckoutEnabled == null, 'public checkout must not expose LIVE checkout flags');
        assertNoSecretLeak(publicConfig, 'public config while admin mode is live');
    } finally {
        await paymentSettingsService.updatePaymentSettings({
            mode: 'live',
            enabled: true,
            credentials: {
                live: {
                    companyToken: expectedCompanyToken,
                    serviceType: '112815'
                }
            }
        }, { id: 'ADMIN_VERIFY_DPO', email: 'admin@example.com' });
    }
}

async function verifyHttpInProcess() {
    const express = require('express');
    const createApiRouter = require('../server/api');
    const dpoClient = require('../server/payments/dpo/client');

    installDpoMock('success');

    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api', createApiRouter());

    const server = await new Promise((resolve, reject) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
        instance.on('error', reject);
    });
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
        const configRes = await request(baseUrl, 'GET', '/api/payments/dpo/config');
        assert(configRes.status === 200 && configRes.json?.success, `config failed: ${configRes.raw}`);
        assertNoSecretLeak(configRes.json, 'public config');
        assert(configRes.json.dpo?.label === 'Pay Online', 'public checkout label must stay customer-safe');
        assert(configRes.json.dpo?.mode == null, 'public config must not expose Operating Mode');
        assert(configRes.json.dpo?.liveAvailable == null, 'public config must not expose LIVE availability');
        assert(configRes.json.dpo?.liveCheckoutEnabled == null, 'public config must not expose LIVE checkout flags');

        const orderId = `DPO-HTTP-${Date.now().toString().slice(-8)}`;
        await createFixtureOrder(orderId);

        const initiated = await request(baseUrl, 'POST', '/api/payments/dpo/initiate', {
            body: { orderId }
        });
        assert(initiated.status === 200 && initiated.json?.success, `initiate HTTP failed: ${initiated.raw}`);
        assert(String(initiated.json.paymentUrl || '').includes('payv3.php?ID='), 'HTTP initiate URL missing');
        assertNoSecretLeak(initiated.json, 'HTTP initiate');

        const reusedInitiate = await request(baseUrl, 'POST', '/api/payments/dpo/initiate', {
            body: { orderId }
        });
        assert(reusedInitiate.status === 200 && reusedInitiate.json?.success, `reused initiate HTTP failed: ${reusedInitiate.raw}`);
        assert(reusedInitiate.json.reused === true, 'HTTP initiate retry must reuse the existing DPO token');
        assert(reusedInitiate.json.paymentUrl === initiated.json.paymentUrl, 'reused HTTP initiate must keep the same payment URL');

        const verified = await request(baseUrl, 'POST', '/api/payments/dpo/verify', {
            body: { orderId }
        });
        assert(verified.status === 200 && verified.json?.success, `verify HTTP failed: ${verified.raw}`);
        assert(verified.json.outcome === 'success', 'HTTP verify should succeed');
        assertNoSecretLeak(verified.json, 'HTTP verify');

        const confirmation = await request(baseUrl, 'GET', `/api/orders/confirmation/${encodeURIComponent(orderId)}`);
        assert(confirmation.status === 200 && confirmation.json?.success, `confirmation HTTP failed: ${confirmation.raw}`);
        assert(confirmation.json.confirmation?.orderId === orderId, 'confirmation must return the same order');
        assert(Number(confirmation.json.confirmation?.total) === 15000, 'confirmation total must match the order');
        assert(String(confirmation.json.confirmation?.paymentStatus).toLowerCase() === 'paid', 'confirmation payment status must be paid after verify');
        assert(String(confirmation.json.confirmation?.orderStatus).toLowerCase() === 'processing', 'confirmation order status must be processing after paid');
        assert(
            confirmation.json.confirmation?.paymentReference === 'REF123'
            || confirmation.json.confirmation?.payment?.reference === 'REF123',
            'confirmation must expose the safe DPO reference'
        );
        assert(!JSON.stringify(confirmation.json).includes('transToken'), 'confirmation must not expose the raw DPO token');
        assertNoSecretLeak(confirmation.json, 'HTTP confirmation');

        // Cancelled / back redirect for a still-unpaid order
        installDpoMock('pending');
        const cancelId = `${orderId}-BACK`;
        await createFixtureOrder(cancelId);
        await request(baseUrl, 'POST', '/api/payments/dpo/initiate', { body: { orderId: cancelId } });
        const back = await request(baseUrl, 'GET', `/api/payments/dpo/back?orderId=${encodeURIComponent(cancelId)}`);
        assert([301, 302].includes(back.status), `expected redirect from back, got ${back.status}`);
        assert(String(back.location).includes('status=cancelled'), `back redirect missing cancelled status: ${back.location}`);
        assertNoSecretLeak(back.raw, 'HTTP back');

        // Back URL after DPO reports paid must go to Success, not Cancelled
        installDpoMock('success');
        const paidBackId = `${orderId}-PAIDBACK`;
        await createFixtureOrder(paidBackId);
        await request(baseUrl, 'POST', '/api/payments/dpo/initiate', { body: { orderId: paidBackId } });
        const paidBack = await request(baseUrl, 'GET', `/api/payments/dpo/back?orderId=${encodeURIComponent(paidBackId)}`);
        assert([301, 302].includes(paidBack.status), `expected redirect from paid back, got ${paidBack.status}`);
        assert(String(paidBack.location).includes('order-success.html'), `paid back must go to success: ${paidBack.location}`);
        assert(!String(paidBack.location).includes('status=cancelled'), `paid back must not be cancelled: ${paidBack.location}`);

        // Invalid token verify outcome
        installDpoMock('invalid');
        const invalidId = `${orderId}-INV`;
        await createFixtureOrder(invalidId);
        await request(baseUrl, 'POST', '/api/payments/dpo/initiate', { body: { orderId: invalidId } });
        const invalid = await request(baseUrl, 'POST', '/api/payments/dpo/verify', { body: { orderId: invalidId } });
        assert(invalid.status === 200 && invalid.json?.outcome === 'invalid_token', `invalid verify failed: ${invalid.raw}`);
        assertNoSecretLeak(invalid.json, 'HTTP invalid verify');

        installDpoMock('success');
        const callbackId = `${orderId}-CB`;
        await createFixtureOrder(callbackId);
        await request(baseUrl, 'POST', '/api/payments/dpo/initiate', { body: { orderId: callbackId } });
        const callback = await request(baseUrl, 'POST', `/api/payments/dpo/callback?orderId=${encodeURIComponent(callbackId)}`);
        assert(callback.status === 200 && callback.json?.success, `callback HTTP failed: ${callback.raw}`);
        assert(callback.json.outcome === 'success', 'callback must verify via existing DPO verifyToken path');
        assert(callback.json.paymentStatus === 'paid', 'callback paid status must come from verify, not from visiting the URL');
        assertNoSecretLeak(callback.json, 'HTTP callback');

        const callbackAgain = await request(baseUrl, 'POST', `/api/payments/dpo/callback?orderId=${encodeURIComponent(callbackId)}`);
        assert(callbackAgain.status === 200 && callbackAgain.json?.paymentStatus === 'paid', 'duplicate callback must stay paid');

        const mtnHttpId = `${orderId}-MTN`;
        await createFixtureOrder(mtnHttpId, { paymentMethod: 'mtn', paymentMethodLabel: 'MTN MoMo' });
        installDpoMock('success');
        const mtnHttp = await request(baseUrl, 'POST', '/api/payments/dpo/initiate', { body: { orderId: mtnHttpId } });
        assert(mtnHttp.status === 200 && mtnHttp.json?.success, `MTN HTTP initiate failed: ${mtnHttp.raw}`);
        assert(String(mtnHttp.json.paymentUrl || '').includes('payv3.php?ID='), 'MTN HTTP initiate must return DPO URL');

        const cardHttpId = `${orderId}-CARD`;
        await createFixtureOrder(cardHttpId, { paymentMethod: 'card', paymentMethodLabel: 'Card' });
        const cardHttp = await request(baseUrl, 'POST', '/api/payments/dpo/initiate', { body: { orderId: cardHttpId } });
        assert(cardHttp.status === 200 && cardHttp.json?.success, `Card HTTP initiate failed: ${cardHttp.raw}`);

        const codHttpId = `${orderId}-COD`;
        await createFixtureOrder(codHttpId, {
            paymentMethod: 'cod',
            paymentMethodLabel: 'Cash on Delivery',
            paymentType: 'cod',
            paymentStatus: 'awaiting_delivery_payment'
        });
        const codHttp = await request(baseUrl, 'POST', '/api/payments/dpo/initiate', { body: { orderId: codHttpId } });
        assert(codHttp.status === 400, `COD HTTP initiate must be rejected, got ${codHttp.status}`);
        assert(codHttp.json?.code === 'DPO_NOT_USED_FOR_COD', `COD HTTP initiate code: ${codHttp.raw}`);

        const unsupported = await request(baseUrl, 'POST', '/api/orders', { body: { paymentMethod: 'airtel' } });
        assert(unsupported.status === 400, `unsupported method must be rejected, got ${unsupported.status}: ${unsupported.raw}`);
        assert(unsupported.json?.code === 'UNSUPPORTED_PAYMENT_METHOD', `airtel must return UNSUPPORTED_PAYMENT_METHOD: ${unsupported.raw}`);

        const bankRejected = await request(baseUrl, 'POST', '/api/orders', { body: { paymentMethod: 'bank' } });
        assert(bankRejected.status === 400 && bankRejected.json?.code === 'UNSUPPORTED_PAYMENT_METHOD', `bank must be rejected: ${bankRejected.raw}`);

        const dpoRejected = await request(baseUrl, 'POST', '/api/orders', { body: { paymentMethod: 'dpo' } });
        assert(dpoRejected.status === 400 && dpoRejected.json?.code === 'UNSUPPORTED_PAYMENT_METHOD', `standalone DPO must be rejected: ${dpoRejected.raw}`);

        return true;
    } finally {
        dpoClient.resetHttpTransport();
        await new Promise((resolve) => server.close(resolve));
    }
}

async function main() {
    const requested = [process.argv[2], process.env.BYOSE_SITE_ORIGIN, process.env.APP_BASE_URL]
        .map((value) => String(value || '').trim())
        .filter(Boolean);
    if (requested.some((value) => /byosemarket\.com/i.test(value))) {
        console.error('[verify-dpo-payment-test] REFUSED: this script mocks DPO success and must not run against production.');
        process.exit(1);
    }

    console.log('[verify-dpo-payment-test] starting isolated local verification');

    [
        'server/payments/dpo/client.js',
        'server/payments/dpo/xml.js',
        'server/payments/dpo/config.js',
        'server/payments/dpo/endpoints.js',
        'server/services/dpopayment.service.js',
        'server/controllers/dpopaymentcontroller.js',
        'server/routes/dpopayments.js',
        'orders/payment.js',
        'orders/payment-result.js'
    ].forEach((rel) => {
        assert(fs.existsSync(path.resolve(__dirname, '..', rel)), `${rel} missing`);
    });

    const { connectDatabase } = require('../server/database');
    await connectDatabase();
    const { settingsSnapshot } = await seedTestCredentials();

    try {
        await verifyPaidStatusMatching();
        console.log('[verify-dpo-payment-test] paid-status matching OK');

        await verifyClientHelpers();
        console.log('[verify-dpo-payment-test] client helpers OK');

        await verifyServiceFlows();
        console.log('[verify-dpo-payment-test] service flows OK (success/failed/cancelled/invalid)');

        await verifyStorefrontMethodsUseDpo();
        console.log('[verify-dpo-payment-test] MTN MoMo/Card use DPO LIVE; COD does not call DPO');

        await verifyLiveUnconfiguredAndNoMix();
        console.log('[verify-dpo-payment-test] LIVE checkout does not fall back to TEST; credentials do not mix');

        await verifyCheckoutUsesLiveWhenAdminModeIsLive();
        console.log('[verify-dpo-payment-test] LIVE operating mode uses LIVE configuration; no TEST fallback');

        await verifyHttpInProcess();
        console.log('[verify-dpo-payment-test] HTTP layer OK');

        console.log('[verify-dpo-payment-test] PASS');
    } finally {
        const paymentSettingsService = require('../server/services/paymentsettings.service');
        await restorePaymentSettingsFlags(paymentSettingsService, settingsSnapshot, {
            id: 'ADMIN_VERIFY_DPO',
            email: 'admin@example.com'
        });
    }
}

main().catch((error) => {
    console.error('[verify-dpo-payment-test] FAIL:', error.message);
    process.exitCode = 1;
});
