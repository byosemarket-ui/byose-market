/**
 * DPO Pay API client (createToken + verifyToken).
 * Credentials and environment come from the DPO config resolver — never hard-code secrets.
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { escapeXml, extractTag, redactXmlSecrets } = require('./xml');
const { DEFAULT_API_BASE, DEFAULT_PAYMENT_PAGE } = require('./endpoints');
const { appLogger } = require('../../utils/logger');

let httpTransport = postXmlRequest;

function setHttpTransportForTests(fn) {
    httpTransport = typeof fn === 'function' ? fn : postXmlRequest;
}

function resetHttpTransport() {
    httpTransport = postXmlRequest;
}

function normalizeText(value, fallback = '') {
    const text = String(value == null ? '' : value).trim();
    return text || fallback;
}

function formatServiceDate(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function splitCustomerName(fullName) {
    const parts = normalizeText(fullName).split(/\s+/).filter(Boolean);
    if (!parts.length) {
        return { firstName: 'Customer', lastName: 'BYOSE' };
    }
    if (parts.length === 1) {
        return { firstName: parts[0], lastName: 'Customer' };
    }
    return {
        firstName: parts[0],
        lastName: parts.slice(1).join(' ').slice(0, 80)
    };
}

const ALL_BLOCKABLE_PAYMENTS = Object.freeze(['CC', 'MO', 'PP', 'BT', 'XP']);

/**
 * Official createToken hosted-page defaults.
 * DefaultPayment / DefaultPaymentCountry / DefaultPaymentMNO / BlockPayment
 * are documented DPO API v6 fields. They pre-select the method and hide
 * unused options so customers are not asked for details BYOSE already has.
 * BlockPayment codes are the official v6 set: CC, DD, BT, PP, XP, MO.
 * Do not send undocumented codes such as SE — LIVE DPO returns Result 930.
 */
function resolveHostedPaymentOptions(method) {
    const id = normalizeText(method).toLowerCase();
    if (id === 'mtn') {
        return {
            defaultPayment: 'MO',
            defaultPaymentCountry: 'rwanda',
            defaultPaymentMno: 'MTN',
            blockPayments: ALL_BLOCKABLE_PAYMENTS.filter((code) => code !== 'MO')
        };
    }
    return {
        defaultPayment: 'CC',
        defaultPaymentCountry: '',
        defaultPaymentMno: '',
        blockPayments: ALL_BLOCKABLE_PAYMENTS.filter((code) => code !== 'CC')
    };
}

function toDpoPhone(value) {
    const digits = String(value == null ? '' : value).replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('250') && digits.length >= 12) return digits.slice(0, 12);
    if (digits.startsWith('0') && digits.length === 10) return `250${digits.slice(1)}`;
    if (digits.length === 9) return `250${digits}`;
    return digits.slice(0, 15);
}

function buildPaymentPageUrl(paymentPageUrl, transToken) {
    const token = normalizeText(transToken);
    if (!token) {
        const error = new Error('Missing DPO transaction token for payment URL.');
        error.code = 'DPO_MISSING_TRANS_TOKEN';
        error.statusCode = 500;
        throw error;
    }

    const template = normalizeText(paymentPageUrl, DEFAULT_PAYMENT_PAGE);
    if (/ID=token/i.test(template)) {
        return template.replace(/ID=token/ig, `ID=${encodeURIComponent(token)}`);
    }
    if (template.includes('{token}') || template.includes('{ID}') || template.includes('{TransToken}')) {
        return template
            .replace(/\{token\}/g, encodeURIComponent(token))
            .replace(/\{ID\}/g, encodeURIComponent(token))
            .replace(/\{TransToken\}/g, encodeURIComponent(token));
    }

    try {
        const url = new URL(template);
        url.searchParams.set('ID', token);
        return url.toString();
    } catch (_error) {
        const sep = template.includes('?') ? '&' : '?';
        return `${template}${sep}ID=${encodeURIComponent(token)}`;
    }
}

function buildCreateTokenXml({
    companyToken,
    serviceType,
    amount,
    currency = 'RWF',
    companyRef,
    redirectUrl,
    backUrl,
    customerName,
    customerEmail,
    customerPhone,
    customerAddress,
    customerCity,
    paymentMethod,
    serviceDescription,
    serviceDate
}) {
    const names = splitCustomerName(customerName);
    const safeAmount = Number(amount);
    if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
        const error = new Error('Payment amount must be greater than zero.');
        error.code = 'DPO_INVALID_AMOUNT';
        error.statusCode = 400;
        throw error;
    }

    const hosted = resolveHostedPaymentOptions(paymentMethod);
    const phone = toDpoPhone(customerPhone);
    const city = normalizeText(customerCity).slice(0, 80);
    const address = normalizeText(customerAddress).slice(0, 120);
    const orderNumber = normalizeText(companyRef).slice(0, 15);

    const additional = (hosted.blockPayments || []).map(
        (code) => `    <BlockPayment>${escapeXml(code)}</BlockPayment>`
    );

    return [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<API3G>',
        `  <CompanyToken>${escapeXml(companyToken)}</CompanyToken>`,
        '  <Request>createToken</Request>',
        '  <Transaction>',
        `    <PaymentAmount>${escapeXml(safeAmount.toFixed(2))}</PaymentAmount>`,
        `    <PaymentCurrency>${escapeXml(currency || 'RWF')}</PaymentCurrency>`,
        `    <CompanyRef>${escapeXml(companyRef)}</CompanyRef>`,
        orderNumber ? `    <OrderNumber>${escapeXml(orderNumber)}</OrderNumber>` : '',
        `    <RedirectURL>${escapeXml(redirectUrl)}</RedirectURL>`,
        `    <BackURL>${escapeXml(backUrl)}</BackURL>`,
        '    <CompanyRefUnique>0</CompanyRefUnique>',
        '    <PTL>24</PTL>',
        `    <customerFirstName>${escapeXml(names.firstName)}</customerFirstName>`,
        `    <customerLastName>${escapeXml(names.lastName)}</customerLastName>`,
        customerEmail ? `    <customerEmail>${escapeXml(customerEmail)}</customerEmail>` : '',
        address ? `    <customerAddress>${escapeXml(address)}</customerAddress>` : '',
        city ? `    <customerCity>${escapeXml(city)}</customerCity>` : '',
        '    <customerCountry>RW</customerCountry>',
        '    <customerDialCode>RW</customerDialCode>',
        phone ? `    <customerPhone>${escapeXml(phone)}</customerPhone>` : '',
        `    <DefaultPayment>${escapeXml(hosted.defaultPayment)}</DefaultPayment>`,
        hosted.defaultPaymentCountry
            ? `    <DefaultPaymentCountry>${escapeXml(hosted.defaultPaymentCountry)}</DefaultPaymentCountry>`
            : '',
        hosted.defaultPaymentMno
            ? `    <DefaultPaymentMNO>${escapeXml(hosted.defaultPaymentMno)}</DefaultPaymentMNO>`
            : '',
        '    <TransactionSource>Website</TransactionSource>',
        '  </Transaction>',
        '  <Services>',
        '    <Service>',
        `      <ServiceType>${escapeXml(serviceType)}</ServiceType>`,
        `      <ServiceDescription>${escapeXml(serviceDescription || `BYOSE Market order ${companyRef}`).slice(0, 120)}</ServiceDescription>`,
        `      <ServiceDate>${escapeXml(serviceDate || formatServiceDate())}</ServiceDate>`,
        '    </Service>',
        '  </Services>',
        additional.length ? '  <Additional>' : '',
        ...additional,
        additional.length ? '  </Additional>' : '',
        '</API3G>'
    ].filter(Boolean).join('\n');
}

function buildVerifyTokenXml({ companyToken, transactionToken, companyRef }) {
    const lines = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<API3G>',
        `  <CompanyToken>${escapeXml(companyToken)}</CompanyToken>`,
        '  <Request>verifyToken</Request>'
    ];
    if (transactionToken) {
        lines.push(`  <TransactionToken>${escapeXml(transactionToken)}</TransactionToken>`);
    }
    if (companyRef) {
        lines.push(`  <CompanyRef>${escapeXml(companyRef)}</CompanyRef>`);
    }
    lines.push('</API3G>');
    return lines.join('\n');
}

function postXmlRequest(apiBaseUrl, xmlBody, { timeoutMs = 20000 } = {}) {
    return new Promise((resolve, reject) => {
        let target;
        try {
            target = new URL(normalizeText(apiBaseUrl, DEFAULT_API_BASE));
        } catch (error) {
            reject(error);
            return;
        }

        const payload = Buffer.from(String(xmlBody || ''), 'utf8');
        const transport = target.protocol === 'http:' ? http : https;
        const req = transport.request({
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port || (target.protocol === 'http:' ? 80 : 443),
            path: `${target.pathname}${target.search}` || '/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/xml; charset=utf-8',
                Accept: 'application/xml',
                'User-Agent': 'BYOSE-Market/1.0 (+https://byosemarket.com)',
                'Content-Length': payload.length
            },
            timeout: timeoutMs
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode || 0,
                    body: Buffer.concat(chunks).toString('utf8')
                });
            });
        });

        req.on('timeout', () => {
            const error = new Error('DPO API request timed out.');
            error.code = 'DPO_API_TIMEOUT';
            error.statusCode = 504;
            req.destroy(error);
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

function parseCreateTokenResponse(xml) {
    const result = extractTag(xml, 'Result');
    const resultExplanation = extractTag(xml, 'ResultExplanation');
    const transToken = extractTag(xml, 'TransToken') || extractTag(xml, 'TransactionToken');
    const transRef = extractTag(xml, 'TransRef');

    return {
        result,
        resultExplanation,
        transToken,
        transRef,
        raw: xml
    };
}

function mapVerifyResultToPaymentStatus(resultCode) {
    const code = normalizeText(resultCode);
    switch (code) {
        case '000':
            return { paymentStatus: 'paid', outcome: 'success', label: 'Paid' };
        case '001':
        case '005':
            return { paymentStatus: 'authorized', outcome: 'pending', label: 'Authorized' };
        case '003':
        case '007':
        case '900':
            return { paymentStatus: 'awaiting_payment', outcome: 'pending', label: 'Awaiting Payment' };
        case '901':
        case '902':
        case '903':
            return { paymentStatus: 'failed', outcome: 'failed', label: 'Failed' };
        case '904':
            return { paymentStatus: 'cancelled', outcome: 'cancelled', label: 'Cancelled' };
        case '801':
        case '802':
        case '803':
        case '804':
        case '950':
            return { paymentStatus: 'failed', outcome: 'invalid_token', label: 'Invalid Token' };
        default:
            if (!code) {
                return { paymentStatus: 'failed', outcome: 'invalid_token', label: 'Invalid Token' };
            }
            return { paymentStatus: 'failed', outcome: 'failed', label: 'Failed' };
    }
}

function parseVerifyTokenResponse(xml) {
    const result = extractTag(xml, 'Result');
    const resultExplanation = extractTag(xml, 'ResultExplanation');
    const mapped = mapVerifyResultToPaymentStatus(result);

    return {
        result,
        resultExplanation,
        transToken: extractTag(xml, 'TransToken') || extractTag(xml, 'TransactionToken'),
        transRef: extractTag(xml, 'TransRef'),
        companyRef: extractTag(xml, 'CompanyRef') || extractTag(xml, 'AccRef'),
        transactionAmount: extractTag(xml, 'TransactionAmount') || extractTag(xml, 'PaymentAmount'),
        transactionCurrency: extractTag(xml, 'TransactionCurrency') || extractTag(xml, 'PaymentCurrency'),
        transactionApproval: extractTag(xml, 'TransactionApproval'),
        customerName: extractTag(xml, 'CustomerName'),
        customerEmail: extractTag(xml, 'CustomerEmail') || extractTag(xml, 'customerEmail'),
        ...mapped,
        raw: xml
    };
}

async function createToken(options = {}) {
    const companyToken = normalizeText(options.companyToken);
    const serviceType = normalizeText(options.serviceType);
    const apiBaseUrl = normalizeText(options.apiBaseUrl, DEFAULT_API_BASE);

    if (!companyToken || !serviceType) {
        const error = new Error('DPO credentials are not configured for this payment environment.');
        error.code = 'DPO_CREDENTIALS_MISSING';
        error.statusCode = 503;
        throw error;
    }

    const xml = buildCreateTokenXml({
        companyToken,
        serviceType,
        amount: options.amount,
        currency: options.currency || 'RWF',
        companyRef: options.companyRef,
        redirectUrl: options.redirectUrl,
        backUrl: options.backUrl,
        customerName: options.customerName,
        customerEmail: options.customerEmail,
        customerPhone: options.customerPhone,
        customerAddress: options.customerAddress,
        customerCity: options.customerCity,
        paymentMethod: options.paymentMethod,
        serviceDescription: options.serviceDescription,
        serviceDate: options.serviceDate
    });

    appLogger.info('dpo.create_token.request', {
        apiBaseUrl,
        companyRef: options.companyRef,
        amount: options.amount,
        currency: options.currency || 'RWF',
        xml: redactXmlSecrets(xml)
    });

    const response = await httpTransport(apiBaseUrl, xml);
    const parsed = parseCreateTokenResponse(response.body || '');
    const bodyPreview = String(response.body || '')
        .replace(/<CompanyToken>[\s\S]*?<\/CompanyToken>/gi, '<CompanyToken>[redacted]</CompanyToken>')
        .replace(/<Trans(?:action)?Token>[\s\S]*?<\/Trans(?:action)?Token>/gi, '<TransToken>[redacted]</TransToken>')
        .slice(0, 400);

    appLogger.info('dpo.create_token.response', {
        statusCode: response.statusCode,
        result: parsed.result,
        resultExplanation: parsed.resultExplanation,
        hasTransToken: Boolean(parsed.transToken),
        xml: redactXmlSecrets(response.body || '')
    });

    if (parsed.result !== '000' || !parsed.transToken) {
        const explanation = parsed.resultExplanation
            || (!String(response.body || '').trim()
                ? `DPO returned an empty body (HTTP ${response.statusCode || 0}).`
                : (!parsed.result
                    ? `DPO response was not parseable XML (HTTP ${response.statusCode || 0}).`
                    : 'Unable to create DPO payment token.'));
        const error = new Error(explanation);
        error.code = 'DPO_CREATE_TOKEN_FAILED';
        error.statusCode = 502;
        error.details = {
            result: parsed.result || null,
            resultExplanation: parsed.resultExplanation || null,
            httpStatus: response.statusCode || null,
            bodyPreview: bodyPreview || null
        };
        throw error;
    }

    return {
        result: parsed.result,
        resultExplanation: parsed.resultExplanation,
        transToken: parsed.transToken,
        transRef: parsed.transRef,
        paymentUrl: buildPaymentPageUrl(options.paymentPageUrl || DEFAULT_PAYMENT_PAGE, parsed.transToken)
    };
}

async function verifyToken(options = {}) {
    const companyToken = normalizeText(options.companyToken);
    const transactionToken = normalizeText(options.transactionToken || options.transToken);
    const companyRef = normalizeText(options.companyRef);
    const apiBaseUrl = normalizeText(options.apiBaseUrl, DEFAULT_API_BASE);

    if (!companyToken) {
        const error = new Error('DPO credentials are not configured for this payment environment.');
        error.code = 'DPO_CREDENTIALS_MISSING';
        error.statusCode = 503;
        throw error;
    }
    if (!transactionToken && !companyRef) {
        const error = new Error('Transaction token or company reference is required to verify payment.');
        error.code = 'DPO_VERIFY_INPUT_MISSING';
        error.statusCode = 400;
        throw error;
    }

    const xml = buildVerifyTokenXml({
        companyToken,
        transactionToken,
        companyRef
    });

    appLogger.info('dpo.verify_token.request', {
        apiBaseUrl,
        companyRef: companyRef || null,
        hasTransToken: Boolean(transactionToken),
        xml: redactXmlSecrets(xml)
    });

    let response;
    try {
        response = await httpTransport(apiBaseUrl, xml);
    } catch (error) {
        const code = String(error?.code || '');
        const message = String(error?.message || '');
        if (code === 'DPO_API_TIMEOUT' || /timed out|timeout|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(`${code} ${message}`)) {
            const unavailable = new Error('Payment confirmation is still pending. Please wait and try again.');
            unavailable.code = 'DPO_VERIFY_UNAVAILABLE';
            unavailable.statusCode = 503;
            throw unavailable;
        }
        throw error;
    }
    const parsed = parseVerifyTokenResponse(response.body || '');

    appLogger.info('dpo.verify_token.response', {
        statusCode: response.statusCode,
        result: parsed.result,
        resultExplanation: parsed.resultExplanation,
        outcome: parsed.outcome,
        paymentStatus: parsed.paymentStatus,
        xml: redactXmlSecrets(response.body || '')
    });

    return parsed;
}

module.exports = {
    DEFAULT_API_BASE,
    DEFAULT_PAYMENT_PAGE,
    buildCreateTokenXml,
    resolveHostedPaymentOptions,
    toDpoPhone,
    buildPaymentPageUrl,
    buildVerifyTokenXml,
    createToken,
    formatServiceDate,
    mapVerifyResultToPaymentStatus,
    parseCreateTokenResponse,
    parseVerifyTokenResponse,
    resetHttpTransport,
    setHttpTransportForTests,
    verifyToken
};
