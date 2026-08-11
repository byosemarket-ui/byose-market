const settingsDataService = require('./settingsdataservice');
const {
    getDefaultProviderId,
    getProvider,
    isKnownProvider,
    listProviders
} = require('../payments/providers/registry');
const secretsStore = require('../payments/secrets.store');

const MODULE_KEY = 'payment';
const MODES = Object.freeze(['test', 'live']);

const DEFAULT_PAYMENT = Object.freeze({
    enabled: false,
    activeProvider: getDefaultProviderId(),
    mode: 'test',
    providers: {},
    updatedAt: null,
    updatedByAdminId: '',
    updatedByAdminEmail: ''
});

function normalizeText(value, fallback = '') {
    const text = String(value == null ? '' : value).trim();
    return text || fallback;
}

function normalizeEmail(value, fallback = '') {
    return normalizeText(value, fallback).toLowerCase();
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const text = String(value == null ? '' : value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(text)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(text)) return false;
    return Boolean(fallback);
}

function ValidationError(message, details = {}, code = 'PAYMENT_VALIDATION_FAILED', statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    error.details = details;
    return error;
}

function maskSecretHint(value) {
    const text = normalizeText(value);
    if (!text) return '';
    if (text.length <= 4) return '••••';
    return `••••${text.slice(-4)}`;
}

function buildDefaultProvidersConfig() {
    const providers = {};
    listProviders().forEach((provider) => {
        providers[provider.id] = provider.createDefaultConfig();
    });
    return providers;
}

function sanitizePaymentConfig(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const providersSource = source.providers && typeof source.providers === 'object' ? source.providers : {};
    const defaults = buildDefaultProvidersConfig();
    const providers = {};

    listProviders().forEach((provider) => {
        const incoming = providersSource[provider.id];
        providers[provider.id] = provider.sanitizeProviderConfig(incoming || defaults[provider.id] || {});
    });

    const activeProvider = normalizeText(source.activeProvider, DEFAULT_PAYMENT.activeProvider).toLowerCase();
    const mode = normalizeText(source.mode, DEFAULT_PAYMENT.mode).toLowerCase();

    return {
        enabled: normalizeBoolean(source.enabled, DEFAULT_PAYMENT.enabled),
        activeProvider: isKnownProvider(activeProvider) ? activeProvider : getDefaultProviderId(),
        mode: MODES.includes(mode) ? mode : 'test',
        providers,
        lastTest: source.lastTest && typeof source.lastTest === 'object' ? source.lastTest : null,
        updatedAt: source.updatedAt || null,
        updatedByAdminId: normalizeText(source.updatedByAdminId),
        updatedByAdminEmail: normalizeEmail(source.updatedByAdminEmail)
    };
}

function validatePaymentConfig(config) {
    const errors = {};
    if (!isKnownProvider(config.activeProvider)) {
        errors.activeProvider = 'Select a supported payment provider.';
    }
    if (!MODES.includes(config.mode)) {
        errors.mode = 'Mode must be TEST or LIVE.';
    }
    if (Object.keys(errors).length) {
        throw ValidationError('Please correct the highlighted payment fields.', errors);
    }
    return config;
}

function resolveModeSecrets(providerId, mode) {
    const provider = getProvider(providerId);
    if (!provider) return { secrets: {}, sources: {} };

    const stored = secretsStore.getProviderModeSecrets(providerId, mode);
    const envOverrides = typeof provider.getEnvCredentialOverrides === 'function'
        ? provider.getEnvCredentialOverrides(mode)
        : {};

    const secrets = {};
    const sources = {};
    (provider.credentialFields || []).forEach((field) => {
        const envValue = normalizeText(envOverrides[field.key]);
        const storedValue = normalizeText(stored[field.key]);
        if (envValue) {
            secrets[field.key] = envValue;
            sources[field.key] = 'environment';
        } else if (storedValue) {
            secrets[field.key] = storedValue;
            sources[field.key] = 'encrypted_store';
        } else {
            secrets[field.key] = '';
            sources[field.key] = null;
        }
    });

    return { secrets, sources };
}

function buildCredentialStatus(provider, mode) {
    const { secrets, sources } = resolveModeSecrets(provider.id, mode);
    const fields = {};
    (provider.credentialFields || []).forEach((field) => {
        const value = normalizeText(secrets[field.key]);
        const configured = Boolean(value);
        const entry = {
            configured,
            hint: field.secret ? maskSecretHint(value) : '',
            source: sources[field.key]
        };
        // Non-secret fields may be shown so admins can confirm Service Type IDs.
        if (!field.secret && configured) {
            entry.value = value;
        }
        fields[field.key] = entry;
    });

    const requiredOk = (provider.credentialFields || [])
        .filter((field) => field.required)
        .every((field) => fields[field.key]?.configured);

    return {
        mode,
        ready: requiredOk,
        fields
    };
}

function toAdminPaymentView(config) {
    const encryption = secretsStore.getEncryptionStatus();
    const providers = listProviders().map((provider) => {
        const providerConfig = config.providers[provider.id] || provider.createDefaultConfig();
        return {
            id: provider.id,
            label: providerConfig.label || provider.label,
            description: provider.description || '',
            enabled: providerConfig.enabled !== false,
            supportsModes: [...(provider.supportsModes || MODES)],
            credentialFields: (provider.credentialFields || []).map((field) => ({
                key: field.key,
                label: field.label,
                secret: Boolean(field.secret),
                required: Boolean(field.required),
                inputType: field.inputType || (field.secret ? 'password' : 'text'),
                autocomplete: field.autocomplete || 'off',
                help: field.help || ''
            })),
            endpoints: providerConfig.endpoints,
            credentials: {
                test: buildCredentialStatus(provider, 'test'),
                live: buildCredentialStatus(provider, 'live')
            }
        };
    });

    const active = providers.find((entry) => entry.id === config.activeProvider) || providers[0] || null;
    const activeModeStatus = active?.credentials?.[config.mode] || null;
    const ready = Boolean(
        config.enabled
        && active
        && active.enabled
        && activeModeStatus?.ready
        && encryption.configured
    );

    return {
        enabled: config.enabled,
        activeProvider: config.activeProvider,
        mode: config.mode,
        providers,
        encryption,
        ready,
        statusSummary: {
            label: ready
                ? `${String(config.mode).toUpperCase()} · ${active?.label || config.activeProvider} ready`
                : config.enabled
                    ? 'Enabled but credentials incomplete'
                    : 'Payments disabled',
            code: ready ? 'ready' : (config.enabled ? 'incomplete' : 'disabled')
        },
        updatedAt: config.updatedAt,
        updatedByAdminId: config.updatedByAdminId,
        updatedByAdminEmail: config.updatedByAdminEmail
    };
}

/**
 * Public/checkout-safe payment summary — never includes credentials.
 */
function toPublicPaymentView(config) {
    const active = getProvider(config.activeProvider);
    const providerConfig = config.providers[config.activeProvider] || active?.createDefaultConfig?.() || {};
    const modeStatus = active ? buildCredentialStatus(active, config.mode) : { ready: false };

    return {
        enabled: Boolean(config.enabled && providerConfig.enabled !== false && modeStatus.ready),
        mode: config.mode,
        provider: active
            ? {
                id: active.id,
                label: providerConfig.label || active.label
            }
            : null
    };
}

async function getPaymentConfig() {
    const row = await settingsDataService.getSettings();
    const value = row?.value && typeof row.value === 'object' ? row.value : {};
    return sanitizePaymentConfig(value[MODULE_KEY] || {});
}

async function persistPaymentConfig(nextConfig, admin = {}) {
    const row = await settingsDataService.getSettings();
    const existingValue = row?.value && typeof row.value === 'object' ? row.value : {};
    const now = new Date().toISOString();
    const stamped = {
        ...nextConfig,
        updatedAt: now,
        updatedByAdminId: normalizeText(admin.id),
        updatedByAdminEmail: normalizeEmail(admin.email)
    };

    await settingsDataService.updateSettings({
        storeName: normalizeText(row?.storeName || existingValue.storeName, 'BYOSE Market'),
        supportEmail: normalizeEmail(row?.supportEmail || existingValue.supportEmail, 'byosemarket@gmail.com'),
        supportPhone: normalizeText(row?.supportPhone || existingValue.supportPhone),
        currency: normalizeText(row?.currency || existingValue.currency, 'RWF'),
        updatedByAdminId: normalizeText(admin.id),
        updatedByAdminEmail: normalizeEmail(admin.email),
        touchedModules: [MODULE_KEY],
        value: {
            ...existingValue,
            [MODULE_KEY]: stamped,
            branding: existingValue.branding,
            delivery: existingValue.delivery,
            seo: existingValue.seo,
            sessionManagement: existingValue.sessionManagement,
            notificationSettings: existingValue.notificationSettings
        }
    });

    return stamped;
}

function applyCredentialUpdates(providerId, credentialsPayload = {}) {
    const provider = getProvider(providerId);
    if (!provider) {
        throw ValidationError('Unknown payment provider.', { activeProvider: 'Unsupported provider.' });
    }

    if (!secretsStore.isEncryptionConfigured()) {
        const error = new Error(
            'Set PAYMENT_ENCRYPTION_KEY in the server environment before saving payment credentials.'
        );
        error.statusCode = 503;
        error.code = 'PAYMENT_ENCRYPTION_KEY_MISSING';
        throw error;
    }

    const errors = {};
    MODES.forEach((mode) => {
        const modePayload = credentialsPayload[mode];
        if (!modePayload || typeof modePayload !== 'object') {
            return;
        }

        const incoming = {};
        (provider.credentialFields || []).forEach((field) => {
            if (!Object.prototype.hasOwnProperty.call(modePayload, field.key)) {
                return;
            }
            const raw = modePayload[field.key];
            // Empty string = keep existing secret (UI sends blanks for unchanged secrets).
            if (raw == null || String(raw).trim() === '') {
                return;
            }
            incoming[field.key] = String(raw).trim();
        });

        if (!Object.keys(incoming).length) {
            return;
        }

        // When rotating a Company Token, require Service Type in the same save
        // so TEST/LIVE pairs stay a matched credential set.
        if (incoming.companyToken && !incoming.serviceType) {
            errors[`${mode}.serviceType`] = mode === 'test'
                ? 'Enter the TEST Service Type ID that belongs to this Company Token in the same save.'
                : 'Enter the LIVE Service Type ID that belongs to this Company Token in the same save.';
            return;
        }

        const existing = resolveModeSecrets(providerId, mode).secrets;
        const mergedForValidation = { ...existing, ...incoming };
        const validated = provider.validateCredentials(mergedForValidation, { requireConfigured: false });
        if (!validated.valid) {
            Object.entries(validated.errors).forEach(([key, message]) => {
                errors[`${mode}.${key}`] = message;
            });
            return;
        }

        // Persist the matched set together when both values are present in this save.
        const toStore = incoming.companyToken && incoming.serviceType
            ? { companyToken: incoming.companyToken, serviceType: incoming.serviceType }
            : incoming;
        secretsStore.upsertProviderModeSecrets(providerId, mode, toStore);
    });

    if (Object.keys(errors).length) {
        throw ValidationError('Please correct the payment credential fields.', errors);
    }
}

async function getAdminPaymentSettings() {
    const config = await getPaymentConfig();
    const view = toAdminPaymentView(config);
    const [activity, stats] = await Promise.all([
        getRecentPaymentActivity({ limit: 12 }),
        getPaymentActivityStats()
    ]);
    return {
        ...view,
        connection: buildConnectionStatus(view),
        activity,
        activityStats: stats,
        lastTest: sanitizeLastTest(config.lastTest),
        capabilities: {
            canTestConnection: view.mode === 'test',
            supportsLiveMode: true,
            providerExtensible: true
        }
    };
}

function sanitizeLastTest(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        at: source.at || null,
        providerId: normalizeText(source.providerId),
        mode: normalizeText(source.mode),
        success: Boolean(source.success),
        resultCode: normalizeText(source.resultCode),
        message: normalizeText(source.message).slice(0, 240),
        durationMs: Number.isFinite(Number(source.durationMs)) ? Number(source.durationMs) : null,
        tokenHint: normalizeText(source.tokenHint)
    };
}

function buildConnectionStatus(adminView) {
    const active = (adminView.providers || []).find((entry) => entry.id === adminView.activeProvider) || null;
    const mode = adminView.mode === 'live' ? 'live' : 'test';
    const creds = active?.credentials?.[mode] || {};
    const encryptionOk = Boolean(adminView.encryption?.configured);
    const providerEnabled = active?.enabled !== false;
    const credentialsReady = Boolean(creds.ready);
    const onlineEnabled = Boolean(adminView.enabled);

    let code = 'not_ready';
    let label = 'Not ready';
    let detail = 'Complete provider credentials and enable payments when ready.';

    if (!encryptionOk) {
        code = 'encryption_missing';
        label = 'Encryption key required';
        detail = 'Set PAYMENT_ENCRYPTION_KEY before saving or testing credentials.';
    } else if (!providerEnabled) {
        code = 'provider_disabled';
        label = 'Provider disabled';
        detail = `${active?.label || 'Provider'} is disabled for checkout.`;
    } else if (!credentialsReady) {
        code = 'credentials_incomplete';
        label = `${String(mode).toUpperCase()} credentials incomplete`;
        detail = `Add required ${String(mode).toUpperCase()} credentials for ${active?.label || 'the provider'}.`;
    } else if (!onlineEnabled) {
        code = 'configured_disabled';
        label = 'Configured · payments off';
        detail = 'Credentials look complete. Enable online payments to offer checkout.';
    } else {
        code = 'connected';
        label = `${String(mode).toUpperCase()} ready`;
        detail = `${active?.label || 'Provider'} is configured for ${String(mode).toUpperCase()} checkout.`;
    }

    return {
        code,
        label,
        detail,
        mode,
        providerId: active?.id || adminView.activeProvider || null,
        providerLabel: active?.label || null,
        encryptionOk,
        providerEnabled,
        credentialsReady,
        onlineEnabled,
        checkoutReady: code === 'connected'
    };
}

function isGatewayOrder(order) {
    const method = normalizeText(order?.paymentMethod || order?.payment?.method).toLowerCase();
    const gateway = order?.payment?.gateway && typeof order.payment.gateway === 'object'
        ? order.payment.gateway
        : {};
    const provider = normalizeText(gateway.provider || order?.payment?.transaction?.provider).toLowerCase();
    return method === 'dpo' || provider === 'dpo' || Boolean(gateway.transToken) || Boolean(gateway.companyRef && provider);
}

function summarizePaymentActivityRow(order) {
    const gateway = order?.payment?.gateway && typeof order.payment.gateway === 'object'
        ? order.payment.gateway
        : {};
    const status = normalizeText(order.paymentStatus || order.payment?.status, 'pending').toLowerCase();
    return {
        orderId: normalizeText(order.orderId || order.id),
        customerName: normalizeText(order.customerName || order.customer?.name, 'Customer'),
        amount: Number(order.totalAmount ?? order.total) || 0,
        currency: normalizeText(order.currency, 'RWF') || 'RWF',
        paymentStatus: status,
        paymentStatusLabel: normalizeText(order.paymentStatusLabel || order.payment?.statusLabel, status),
        provider: normalizeText(gateway.provider || order.paymentMethod, 'dpo') || 'dpo',
        mode: normalizeText(gateway.mode, 'test') || 'test',
        outcome: normalizeText(gateway.lastOutcome),
        resultCode: normalizeText(gateway.lastResult),
        tokenHint: gateway.transToken
            ? maskSecretHint(gateway.transToken)
            : normalizeText(order.payment?.transaction?.tokenHint),
        updatedAt: order.updatedAt || order.createdAt || null,
        createdAt: order.createdAt || null
    };
}

async function getRecentPaymentActivity({ limit = 12 } = {}) {
    try {
        const orderDataService = require('./orderdataservice');
        const rows = await orderDataService.listAdminOrders({ limit: Math.max(40, limit * 3), page: 1 });
        const list = Array.isArray(rows) ? rows : [];
        return list
            .filter((order) => isGatewayOrder(order))
            .slice(0, Math.max(1, Math.min(50, Number(limit) || 12)))
            .map(summarizePaymentActivityRow);
    } catch (_error) {
        return [];
    }
}

async function getPaymentActivityStats() {
    try {
        const activity = await getRecentPaymentActivity({ limit: 50 });
        const stats = {
            total: activity.length,
            paid: 0,
            awaiting: 0,
            failed: 0,
            cancelled: 0
        };
        activity.forEach((row) => {
            const status = String(row.paymentStatus || '').toLowerCase();
            if (status === 'paid' || status === 'authorized') stats.paid += 1;
            else if (status.includes('awaiting') || status === 'pending') stats.awaiting += 1;
            else if (status === 'cancelled') stats.cancelled += 1;
            else if (status === 'failed' || status.includes('invalid')) stats.failed += 1;
        });
        return stats;
    } catch (_error) {
        return { total: 0, paid: 0, awaiting: 0, failed: 0, cancelled: 0 };
    }
}

/**
 * Safe TEST-mode credential probe via createToken.
 * Never returns Company Token or full TransToken values.
 */
async function testPaymentConfiguration(admin = {}, options = {}) {
    const config = await getPaymentConfig();
    const providerId = normalizeText(options.providerId, config.activeProvider).toLowerCase();
    const provider = getProvider(providerId);

    if (!provider) {
        throw ValidationError('Unknown payment provider.', { providerId: 'Unsupported provider.' });
    }
    if (config.mode !== 'test') {
        throw ValidationError(
            'Connection tests are only allowed while Payment Settings are in TEST mode.',
            { mode: 'Switch to TEST mode before testing.' },
            'PAYMENT_TEST_REQUIRES_TEST_MODE'
        );
    }
    if (!secretsStore.isEncryptionConfigured()) {
        const error = new Error('PAYMENT_ENCRYPTION_KEY must be set before testing payment credentials.');
        error.statusCode = 503;
        error.code = 'PAYMENT_ENCRYPTION_KEY_MISSING';
        throw error;
    }

    const runtime = await getRuntimePaymentCredentials({ providerId, mode: 'test' });
    const companyToken = normalizeText(runtime?.secrets?.companyToken);
    const serviceType = normalizeText(runtime?.secrets?.serviceType);
    if (!companyToken || !serviceType) {
        throw ValidationError(
            'TEST credentials are incomplete. Save Company Token and Service Type first.',
            { companyToken: Boolean(companyToken), serviceType: Boolean(serviceType) },
            'PAYMENT_TEST_CREDENTIALS_MISSING'
        );
    }

    if (providerId !== 'dpo') {
        throw ValidationError(
            `Connection testing for provider "${providerId}" is not implemented yet.`,
            { providerId: 'Add a test adapter for this provider.' },
            'PAYMENT_TEST_UNSUPPORTED_PROVIDER',
            501
        );
    }

    const dpoClient = require('../payments/dpo/client');
    const started = Date.now();
    const companyRef = `ADMIN-CFG-TEST-${Date.now().toString(36).toUpperCase()}`;
    let testResult;

    try {
        const created = await dpoClient.createToken({
            companyToken,
            serviceType,
            apiBaseUrl: runtime.endpoints?.apiBaseUrl || dpoClient.DEFAULT_API_BASE,
            paymentPageUrl: runtime.endpoints?.paymentPageUrl || dpoClient.DEFAULT_PAYMENT_PAGE,
            amount: 100,
            currency: 'RWF',
            companyRef,
            redirectUrl: 'https://localhost/admin-payment-test/return',
            backUrl: 'https://localhost/admin-payment-test/back',
            customerName: 'BYOSE Config Test',
            customerEmail: normalizeEmail(admin.email, 'admin@byosemarket.com'),
            customerPhone: '0780000000',
            serviceDescription: 'BYOSE Market admin configuration test'
        });

        testResult = {
            at: new Date().toISOString(),
            providerId,
            mode: 'test',
            success: true,
            resultCode: normalizeText(created.result, '000'),
            message: normalizeText(created.resultExplanation, 'TEST credentials accepted by DPO.'),
            durationMs: Date.now() - started,
            tokenHint: maskSecretHint(created.transToken)
        };
    } catch (error) {
        testResult = {
            at: new Date().toISOString(),
            providerId,
            mode: 'test',
            success: false,
            resultCode: normalizeText(error?.details?.result || error?.code, 'FAILED'),
            message: normalizeText(error?.message, 'TEST connection failed.'),
            durationMs: Date.now() - started,
            tokenHint: ''
        };
    }

    const stamped = await persistPaymentConfig({
        ...config,
        lastTest: testResult
    }, admin);

    const view = await getAdminPaymentSettings();
    return {
        test: sanitizeLastTest(stamped.lastTest || testResult),
        payment: view
    };
}

async function getPublicPaymentSettings() {
    const config = await getPaymentConfig();
    return toPublicPaymentView(config);
}

/**
 * Server-only accessor for future gateway integration.
 * Never expose return value over HTTP.
 */
async function getRuntimePaymentCredentials({ providerId, mode } = {}) {
    const config = await getPaymentConfig();
    const id = normalizeText(providerId, config.activeProvider).toLowerCase();
    const resolvedMode = normalizeText(mode, config.mode).toLowerCase();
    const provider = getProvider(id);
    if (!provider || !MODES.includes(resolvedMode)) {
        return null;
    }
    const { secrets, sources } = resolveModeSecrets(id, resolvedMode);
    const providerConfig = config.providers[id] || provider.createDefaultConfig();
    return {
        providerId: id,
        mode: resolvedMode,
        enabled: Boolean(config.enabled && providerConfig.enabled !== false),
        endpoints: providerConfig.endpoints?.[resolvedMode] || null,
        secrets,
        sources
    };
}

async function updatePaymentSettings(payload = {}, admin = {}) {
    const current = await getPaymentConfig();
    const source = payload && typeof payload === 'object' ? payload : {};

    const nextProviders = { ...current.providers };
    if (source.providers && typeof source.providers === 'object') {
        Object.keys(source.providers).forEach((providerId) => {
            if (!isKnownProvider(providerId)) return;
            const provider = getProvider(providerId);
            nextProviders[providerId] = provider.sanitizeProviderConfig({
                ...current.providers[providerId],
                ...source.providers[providerId]
            });
        });
    }

    // Convenience: allow updating the active provider block without nested providers map.
    if (source.providerConfig && typeof source.providerConfig === 'object' && isKnownProvider(source.activeProvider || current.activeProvider)) {
        const targetId = normalizeText(source.activeProvider, current.activeProvider).toLowerCase();
        const provider = getProvider(targetId);
        nextProviders[targetId] = provider.sanitizeProviderConfig({
            ...current.providers[targetId],
            ...source.providerConfig
        });
    }

    // Top-level providerEnabled toggle for the active provider.
    if (source.providerEnabled != null && isKnownProvider(source.activeProvider || current.activeProvider)) {
        const targetId = normalizeText(source.activeProvider, current.activeProvider).toLowerCase();
        const provider = getProvider(targetId);
        nextProviders[targetId] = provider.sanitizeProviderConfig({
            ...current.providers[targetId],
            enabled: source.providerEnabled
        });
    }

    const merged = sanitizePaymentConfig({
        ...current,
        enabled: source.enabled != null ? source.enabled : current.enabled,
        activeProvider: source.activeProvider != null ? source.activeProvider : current.activeProvider,
        mode: source.mode != null ? source.mode : current.mode,
        providers: nextProviders,
        lastTest: current.lastTest
    });

    const validated = validatePaymentConfig(merged);

    if (source.credentials && typeof source.credentials === 'object') {
        applyCredentialUpdates(validated.activeProvider, source.credentials);
    }

    // If enabling payments, require credentials for the selected mode.
    if (validated.enabled) {
        const provider = getProvider(validated.activeProvider);
        const { secrets } = resolveModeSecrets(validated.activeProvider, validated.mode);
        const check = provider.validateCredentials(secrets, { requireConfigured: true });
        if (!check.valid) {
            throw ValidationError(
                `Cannot enable payments: complete ${String(validated.mode).toUpperCase()} credentials for ${provider.label}.`,
                check.errors
            );
        }
        if (!secretsStore.isEncryptionConfigured()) {
            const error = new Error('PAYMENT_ENCRYPTION_KEY must be set before enabling payments.');
            error.statusCode = 503;
            error.code = 'PAYMENT_ENCRYPTION_KEY_MISSING';
            throw error;
        }
    }

    const saved = await persistPaymentConfig(validated, admin);
    void saved;
    return getAdminPaymentSettings();
}

module.exports = {
    MODULE_KEY,
    DEFAULT_PAYMENT,
    MODES,
    buildConnectionStatus,
    getAdminPaymentSettings,
    getPaymentActivityStats,
    getPaymentConfig,
    getPublicPaymentSettings,
    getRecentPaymentActivity,
    getRuntimePaymentCredentials,
    sanitizePaymentConfig,
    testPaymentConfiguration,
    toAdminPaymentView,
    toPublicPaymentView,
    updatePaymentSettings,
    validatePaymentConfig
};
