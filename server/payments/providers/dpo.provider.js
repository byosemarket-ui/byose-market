/**
 * DPO Pay provider definition.
 * Endpoint defaults come from the shared DPO endpoints module.
 * LIVE uses the official DPO API v6 host; Company Token + Service Type select TEST vs LIVE.
 * Customer checkout is LIVE-only and never falls back to TEST.
 */

const { DEFAULT_API_BASE, DEFAULT_PAYMENT_PAGE } = require('../dpo/endpoints');

const PROVIDER_ID = 'dpo';
const TEST_SERVICE_TYPE_ID = '54841';
const LIVE_SERVICE_TYPE_ID = '112815';

const CREDENTIAL_FIELDS = Object.freeze([
    {
        key: 'companyToken',
        label: 'Company Token',
        secret: true,
        required: true,
        inputType: 'password',
        autocomplete: 'off',
        help: 'Official DPO LIVE Company Token. Never share publicly. Stored encrypted server-side only.'
    },
    {
        key: 'serviceType',
        label: 'Service Type ID',
        secret: false,
        required: true,
        inputType: 'text',
        autocomplete: 'off',
        help: 'Numeric DPO Service Type ID. LIVE uses 112815 (112815-Shoes). Do not use TEST Service Type 54841.'
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
    // Legacy payv2 hosted pages are upgraded to the official payv3 template.
    // LIVE and TEST both use DPO's confirmed payv3.php URL unless Admin stored
    // a later official URL. Do not rewrite to dpopayment.php.
    if (options.upgradeLegacyPayV2 && /payv2\.php/i.test(paymentPageUrl)) {
        paymentPageUrl = fallback.paymentPageUrl || DEFAULT_ENDPOINTS.test.paymentPageUrl;
    }
    return {
        apiBaseUrl: normalizeText(raw.apiBaseUrl, fallback.apiBaseUrl).slice(0, 300),
        paymentPageUrl
    };
}

/**
 * DPO LIVE labels the product as "112815-Shoes". The API expects the numeric ID.
 */
function normalizeServiceTypeId(value) {
    const text = normalizeText(value);
    const match = text.match(/^(\d{1,12})(?:\s*[-–].*)?$/);
    return match ? match[1] : text;
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
            live: { ...DEFAULT_ENDPOINTS.live }
        }
    };
}

function validateCredentials(modeSecrets = {}, { requireConfigured = false, mode = '' } = {}) {
    const errors = {};
    const companyToken = normalizeText(modeSecrets.companyToken);
    const serviceType = normalizeServiceTypeId(modeSecrets.serviceType);
    const resolvedMode = normalizeText(mode).toLowerCase();

    if (requireConfigured || companyToken || serviceType) {
        if (!companyToken) {
            errors.companyToken = 'Company Token is required for DPO Pay.';
        } else if (companyToken.length < 8) {
            errors.companyToken = 'Company Token looks too short.';
        }
        if (!serviceType) {
            errors.serviceType = 'Service Type ID is required for DPO Pay.';
        } else if (!/^\d{1,12}$/.test(serviceType)) {
            errors.serviceType = 'Service Type ID must be a numeric ID.';
        } else if (resolvedMode === 'live' && serviceType === TEST_SERVICE_TYPE_ID) {
            errors.serviceType = 'LIVE Service Type cannot be TEST Service Type 54841. Use 112815.';
        } else if (resolvedMode === 'live' && serviceType !== LIVE_SERVICE_TYPE_ID) {
            errors.serviceType = 'LIVE Service Type ID must be 112815.';
        } else if (resolvedMode === 'test' && serviceType === LIVE_SERVICE_TYPE_ID) {
            errors.serviceType = 'TEST Service Type cannot be LIVE Service Type 112815. Use the TEST Service Type for this Company Token.';
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
    TEST_SERVICE_TYPE_ID,
    LIVE_SERVICE_TYPE_ID,
    DEFAULT_ENDPOINTS,
    createDefaultConfig,
    normalizeServiceTypeId,
    sanitizeProviderConfig,
    validateCredentials,
    getEnvCredentialOverrides
};
