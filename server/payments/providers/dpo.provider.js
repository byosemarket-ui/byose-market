/**
 * DPO Pay provider definition.
 * Endpoint defaults come from the shared DPO endpoints module.
 * LIVE uses the same documented DPO host; the Company Token selects TEST vs LIVE.
 * LIVE checkout is gated off until a later step.
 */

const { DEFAULT_API_BASE, DEFAULT_PAYMENT_PAGE } = require('../dpo/endpoints');

const PROVIDER_ID = 'dpo';

const CREDENTIAL_FIELDS = Object.freeze([
    {
        key: 'companyToken',
        label: 'Company Token',
        secret: true,
        required: true,
        inputType: 'password',
        autocomplete: 'off',
        help: 'Issued by DPO Pay. Never share publicly. Stored encrypted server-side only.'
    },
    {
        key: 'serviceType',
        label: 'Service Type ID',
        secret: false,
        required: true,
        inputType: 'text',
        autocomplete: 'off',
        help: 'DPO Service Type / Product Service ID for this Company Token. TEST and LIVE Service Types can differ — save the ID that belongs to that environment\'s Company Token. Do not copy TEST into LIVE unless DPO confirms they are the same.'
    }
]);

const DEFAULT_ENDPOINTS = Object.freeze({
    test: {
        apiBaseUrl: DEFAULT_API_BASE,
        paymentPageUrl: DEFAULT_PAYMENT_PAGE
    },
    live: {
        apiBaseUrl: DEFAULT_API_BASE,
        paymentPageUrl: DEFAULT_PAYMENT_PAGE
    }
});

function normalizeText(value, fallback = '') {
    const text = String(value == null ? '' : value).trim();
    return text || fallback;
}

function sanitizeEndpoints(source = {}, fallback = DEFAULT_ENDPOINTS.test, options = {}) {
    const raw = source && typeof source === 'object' ? source : {};
    let paymentPageUrl = normalizeText(raw.paymentPageUrl, fallback.paymentPageUrl).slice(0, 300);
    // Option A / STEP 4: TEST hosted page must use payv3.php?ID=token.
    // Do not rewrite LIVE endpoints here.
    if (options.upgradeLegacyPayV2 && /payv2\.php/i.test(paymentPageUrl)) {
        paymentPageUrl = fallback.paymentPageUrl || DEFAULT_ENDPOINTS.test.paymentPageUrl;
    }
    return {
        apiBaseUrl: normalizeText(raw.apiBaseUrl, fallback.apiBaseUrl).slice(0, 300),
        paymentPageUrl
    };
}

function createDefaultConfig() {
    return {
        enabled: true,
        label: 'DPO Pay',
        endpoints: {
            test: { ...DEFAULT_ENDPOINTS.test },
            live: { ...DEFAULT_ENDPOINTS.live }
        }
    };
}

function sanitizeProviderConfig(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const endpointsSource = source.endpoints && typeof source.endpoints === 'object' ? source.endpoints : {};
    return {
        enabled: source.enabled !== false,
        label: normalizeText(source.label, 'DPO Pay').slice(0, 80),
        endpoints: {
            test: sanitizeEndpoints(endpointsSource.test, DEFAULT_ENDPOINTS.test, { upgradeLegacyPayV2: true }),
            live: sanitizeEndpoints(endpointsSource.live, DEFAULT_ENDPOINTS.live, { upgradeLegacyPayV2: false })
        }
    };
}

function validateCredentials(modeSecrets = {}, { requireConfigured = false } = {}) {
    const errors = {};
    const companyToken = normalizeText(modeSecrets.companyToken);
    const serviceType = normalizeText(modeSecrets.serviceType);

    if (requireConfigured || companyToken || serviceType) {
        if (!companyToken) {
            errors.companyToken = 'Company Token is required for DPO Pay.';
        }
        if (!serviceType) {
            errors.serviceType = 'Service Type ID is required for DPO Pay.';
        } else if (!/^\d{1,12}$/.test(serviceType)) {
            errors.serviceType = 'Service Type ID must be a numeric ID.';
        }
    }

    return {
        valid: Object.keys(errors).length === 0,
        errors,
        normalized: {
            companyToken,
            serviceType
        }
    };
}

function getEnvCredentialOverrides(mode) {
    const prefix = mode === 'live' ? 'DPO_LIVE_' : 'DPO_TEST_';
    return {
        companyToken: normalizeText(process.env[`${prefix}COMPANY_TOKEN`]),
        serviceType: normalizeText(process.env[`${prefix}SERVICE_TYPE`])
    };
}

module.exports = {
    id: PROVIDER_ID,
    label: 'DPO Pay',
    description: 'DPO Pay (Direct Pay Online) card and mobile money gateway.',
    supportsModes: Object.freeze(['test', 'live']),
    credentialFields: CREDENTIAL_FIELDS,
    DEFAULT_ENDPOINTS,
    createDefaultConfig,
    sanitizeProviderConfig,
    validateCredentials,
    getEnvCredentialOverrides
};
