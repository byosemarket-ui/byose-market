/**
 * Authoritative DPO configuration resolver.
 *
 * Admin Payment Settings + the encrypted secrets store hold TEST and LIVE
 * credentials separately. This module is the only place checkout decides
 * which environment to use, then returns that environment's Company Token,
 * Service Type, and endpoints to the DPO payment service.
 *
 * LIVE checkout stays gated off until official LIVE credentials are provided
 * and a later step explicitly enables LIVE. Do not invent LIVE values here.
 * CHECKOUT_MODE is the selected environment while that gate is closed — not
 * a TEST-only payment implementation.
 */

const paymentSettingsService = require('../../services/paymentsettings.service');
const envConfig = require('../../config/env');
const { DEFAULT_API_BASE, DEFAULT_PAYMENT_PAGE } = require('./endpoints');
const { appLogger } = require('../../utils/logger');

const PROVIDER_ID = 'dpo';
const CHECKOUT_MODE = 'test';
/** Hard gate. Do not flip this on until official LIVE credentials are activated. */
const LIVE_CHECKOUT_ENABLED = false;

function normalizeText(value, fallback = '') {
    const text = String(value == null ? '' : value).trim();
    return text || fallback;
}

function ValidationError(message, details = {}, code = 'DPO_PAYMENT_VALIDATION_FAILED', statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    error.details = details;
    return error;
}

function isLiveCheckoutGateOpen() {
    return LIVE_CHECKOUT_ENABLED === true
        && envConfig.payment?.liveCheckoutEnabled === true;
}

function resolvePaymentPageUrl(configured) {
    const value = normalizeText(configured, DEFAULT_PAYMENT_PAGE);
    if (/payv2\.php/i.test(value)) {
        return DEFAULT_PAYMENT_PAGE;
    }
    return value || DEFAULT_PAYMENT_PAGE;
}

function customerSafeMessage(mode) {
    if (mode === 'live') {
        return 'Online payment is temporarily unavailable. Please try again shortly.';
    }
    return 'Online payment is not available right now. Please try again shortly.';
}

/**
 * Server-side checkout environment decision.
 * Admin operating mode is not trusted for customer checkout.
 */
function resolveCheckoutEnvironment({ liveConfigured = false } = {}) {
    if (!isLiveCheckoutGateOpen()) {
        return {
            mode: 'test',
            liveCheckoutEnabled: false,
            liveAvailable: false,
            liveConfigured: Boolean(liveConfigured),
            reason: 'LIVE_CHECKOUT_DISABLED'
        };
    }

    return {
        mode: 'live',
        liveCheckoutEnabled: true,
        liveAvailable: true,
        liveConfigured: Boolean(liveConfigured),
        reason: 'LIVE_CHECKOUT_ENABLED'
    };
}

function getCheckoutEnvironment() {
    return resolveCheckoutEnvironment();
}

function assertNoCredentialMix(mode, secrets, otherSecrets) {
    const token = normalizeText(secrets?.companyToken);
    const otherToken = normalizeText(otherSecrets?.companyToken);
    if (mode === 'live' && token && otherToken && token === otherToken) {
        throw ValidationError(
            customerSafeMessage('live'),
            { mixed: true },
            'DPO_LIVE_CREDENTIAL_MIX',
            503
        );
    }
}

/**
 * Load configuration for one environment only. Never substitutes the other.
 */
async function getEnvironmentConfiguration(mode) {
    const resolvedMode = normalizeText(mode).toLowerCase();
    if (resolvedMode !== 'test' && resolvedMode !== 'live') {
        throw ValidationError(
            'Payment environment is invalid.',
            { mode: resolvedMode },
            'DPO_ENVIRONMENT_INVALID',
            500
        );
    }

    const runtime = await paymentSettingsService.getRuntimePaymentCredentials({
        providerId: PROVIDER_ID,
        mode: resolvedMode
    });

    if (!runtime) {
        throw ValidationError(
            customerSafeMessage(resolvedMode),
            { mode: resolvedMode },
            resolvedMode === 'live' ? 'DPO_LIVE_NOT_CONFIGURED' : 'DPO_NOT_ENABLED',
            503
        );
    }

    if (normalizeText(runtime.mode) !== resolvedMode) {
        throw ValidationError(
            customerSafeMessage(resolvedMode),
            { requested: resolvedMode, resolved: runtime.mode },
            'DPO_ENVIRONMENT_MISMATCH',
            503
        );
    }

    const otherMode = resolvedMode === 'live' ? 'test' : 'live';
    const otherRuntime = await paymentSettingsService.getRuntimePaymentCredentials({
        providerId: PROVIDER_ID,
        mode: otherMode
    });
    assertNoCredentialMix(resolvedMode, runtime.secrets, otherRuntime?.secrets);

    if (!runtime.enabled) {
        throw ValidationError(
            customerSafeMessage(resolvedMode),
            { enabled: false, mode: resolvedMode },
            resolvedMode === 'live' ? 'DPO_LIVE_NOT_ENABLED' : 'DPO_NOT_ENABLED',
            503
        );
    }

    const companyToken = normalizeText(runtime.secrets?.companyToken);
    const serviceType = normalizeText(runtime.secrets?.serviceType);
    if (!companyToken || !serviceType) {
        throw ValidationError(
            customerSafeMessage(resolvedMode),
            {
                mode: resolvedMode,
                configured: false
            },
            resolvedMode === 'live' ? 'DPO_LIVE_NOT_CONFIGURED' : 'DPO_CREDENTIALS_MISSING',
            503
        );
    }

    return {
        providerId: PROVIDER_ID,
        mode: resolvedMode,
        enabled: true,
        liveCheckoutEnabled: isLiveCheckoutGateOpen(),
        secrets: { companyToken, serviceType },
        sources: runtime.sources || {},
        endpoints: {
            apiBaseUrl: normalizeText(runtime.endpoints?.apiBaseUrl, DEFAULT_API_BASE) || DEFAULT_API_BASE,
            paymentPageUrl: resolvePaymentPageUrl(runtime.endpoints?.paymentPageUrl)
        }
    };
}

async function inspectEnvironmentStatus(mode) {
    try {
        const runtime = await paymentSettingsService.getRuntimePaymentCredentials({
            providerId: PROVIDER_ID,
            mode
        });
        const companyToken = Boolean(normalizeText(runtime?.secrets?.companyToken));
        const serviceType = Boolean(normalizeText(runtime?.secrets?.serviceType));
        return {
            mode,
            enabled: Boolean(runtime?.enabled),
            configured: Boolean(companyToken && serviceType),
            companyTokenConfigured: companyToken,
            serviceTypeConfigured: serviceType
        };
    } catch (_error) {
        return {
            mode,
            enabled: false,
            configured: false,
            companyTokenConfigured: false,
            serviceTypeConfigured: false
        };
    }
}

/**
 * Active checkout configuration. Payment service should call this, not
 * pick TEST/LIVE credentials itself.
 */
async function getActiveDpoConfiguration() {
    const liveStatus = await inspectEnvironmentStatus('live');
    const environment = resolveCheckoutEnvironment({ liveConfigured: liveStatus.configured });
    const resolved = await getEnvironmentConfiguration(environment.mode);

    appLogger.info('dpo.config.resolved', {
        mode: resolved.mode,
        reason: environment.reason,
        liveCheckoutEnabled: environment.liveCheckoutEnabled,
        liveConfigured: liveStatus.configured,
        credentialsPresent: true
    });

    return {
        ...resolved,
        liveCheckoutEnabled: environment.liveCheckoutEnabled,
        liveAvailable: environment.liveAvailable,
        liveConfigured: liveStatus.configured,
        reason: environment.reason
    };
}

async function getCheckoutRuntime() {
    return getActiveDpoConfiguration();
}

async function getPublicCheckoutConfig() {
    const liveStatus = await inspectEnvironmentStatus('live');
    const environment = resolveCheckoutEnvironment({ liveConfigured: liveStatus.configured });
    let credentialsReady = false;
    let enabled = false;

    try {
        const runtime = await getEnvironmentConfiguration(environment.mode);
        credentialsReady = Boolean(runtime.secrets?.companyToken && runtime.secrets?.serviceType);
        enabled = Boolean(runtime.enabled && credentialsReady);
    } catch (_error) {
        enabled = false;
        credentialsReady = false;
    }

    return {
        provider: PROVIDER_ID,
        mode: environment.mode,
        enabled,
        label: 'Pay Online',
        liveAvailable: environment.liveAvailable,
        liveCheckoutEnabled: environment.liveCheckoutEnabled,
        liveConfigured: liveStatus.configured
    };
}

module.exports = {
    CHECKOUT_MODE,
    LIVE_CHECKOUT_ENABLED,
    PROVIDER_ID,
    getActiveDpoConfiguration,
    getCheckoutEnvironment,
    getCheckoutRuntime,
    getEnvironmentConfiguration,
    getPublicCheckoutConfig,
    inspectEnvironmentStatus,
    isLiveCheckoutGateOpen,
    resolveCheckoutEnvironment
};
