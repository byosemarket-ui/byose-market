/**
 * DPO Pay provider definition.
 * STEP 2: TEST createToken / verifyToken integration uses these endpoint defaults.
 */

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
        help: 'DPO Service Type / Product Service ID used when creating payment tokens.'
    }
]);

const DEFAULT_ENDPOINTS = Object.freeze({
    test: {
        apiBaseUrl: 'https://secure.3gdirectpay.com/API/v6/',
        paymentPageUrl: 'https://secure.3gdirectpay.com/payv3.php?ID=token'
    },
    live: {
        apiBaseUrl: 'https://secure.3gdirectpay.com/API/v6/',
        paymentPageUrl: 'https://secure.3gdirectpay.com/payv3.php?ID=token'
    }
});

function normalizeText(value, fallback = '') {
    const text = String(value == null ? '' : value).trim();
    return text || fallback;
}

function sanitizeEndpoints(source = {}, fallback = DEFAULT_ENDPOINTS.test) {
    const raw = source && typeof source === 'object' ? source : {};
    return {
        apiBaseUrl: normalizeText(raw.apiBaseUrl, fallback.apiBaseUrl).slice(0, 300),
        paymentPageUrl: normalizeText(raw.paymentPageUrl, fallback.paymentPageUrl).slice(0, 300)
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
            test: sanitizeEndpoints(endpointsSource.test, DEFAULT_ENDPOINTS.test),
            live: sanitizeEndpoints(endpointsSource.live, DEFAULT_ENDPOINTS.live)
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
