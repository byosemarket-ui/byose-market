const settingsDataService = require('./settingsdataservice');
const {
    buildMailRuntimeConfig,
    isValidEmail,
    normalizeBoolean,
    normalizeEmail,
    normalizeText,
    readEnvSmtpConfig,
    resolveAdminNotificationRecipientSlots,
    resolveActiveAdminNotificationRecipients,
    resolveEmailProviderName
} = require('../config/notification-mail.config');
const { listEmailEventKeys, buildAdminEmailShell } = require('./email/admin-email-templates');
const { sendViaProvider, getProviderStatus } = require('./email/email-provider.service');
const { maskEmailAddress } = require('./notifications/notification-identity');
const { appLogger } = require('../utils/logger');
const {
    CHANNEL_ORDER,
    CHANNELS,
    listChannels
} = require('./notifications/channels/channel.registry');

const MODULE_KEY = 'notificationSettings';

const ALLOWED_NOTIFICATION_SOUNDS = new Set(['soft', 'chime', 'alert']);

function getDefaultEmailEventPreferences() {
    const prefs = {};
    for (const key of listEmailEventKeys()) {
        prefs[key] = true;
    }
    return prefs;
}

function getDefaultChannelPrefsForEvent(eventKey, globals = {}) {
    const emailDefault = globals.emailEventPreferences?.[eventKey] !== false;
    return {
        [CHANNELS.IN_APP]: true,
        [CHANNELS.EMAIL]: Boolean(emailDefault),
        [CHANNELS.BROWSER]: globals.browserNotificationsEnabled !== false,
        [CHANNELS.SOUND]: Boolean(globals.soundNotificationsEnabled),
        [CHANNELS.SMS]: false,
        [CHANNELS.WHATSAPP]: false,
        [CHANNELS.PUSH]: false
    };
}

function getDefaultEventChannelPreferences(globals = {}) {
    const prefs = {};
    for (const key of listEmailEventKeys()) {
        prefs[key] = getDefaultChannelPrefsForEvent(key, globals);
    }
    return prefs;
}

function normalizeEventChannelPreferences(raw = {}, globals = {}) {
    const defaults = getDefaultEventChannelPreferences(globals);
    const source = raw && typeof raw === 'object' ? raw : {};
    const next = {};

    for (const eventKey of Object.keys(defaults)) {
        const base = { ...defaults[eventKey] };
        const incoming = source[eventKey] && typeof source[eventKey] === 'object' ? source[eventKey] : {};
        for (const channel of CHANNEL_ORDER) {
            if (Object.prototype.hasOwnProperty.call(incoming, channel)) {
                base[channel] = Boolean(incoming[channel]);
            }
        }
        // Keep emailEventPreferences as source of truth when provided on globals.
        if (globals.emailEventPreferences && Object.prototype.hasOwnProperty.call(globals.emailEventPreferences, eventKey)) {
            base[CHANNELS.EMAIL] = Boolean(globals.emailEventPreferences[eventKey]);
        }
        next[eventKey] = {
            ...base,
            [CHANNELS.SMS]: false,
            [CHANNELS.WHATSAPP]: false,
            [CHANNELS.PUSH]: false
        };
    }
    return next;
}

function deriveEmailEventPreferencesFromChannels(eventChannelPreferences = {}, emailNotificationsEnabled = true) {
    const prefs = {};
    for (const [eventKey, channels] of Object.entries(eventChannelPreferences || {})) {
        prefs[eventKey] = Boolean(channels?.[CHANNELS.EMAIL]);
    }
    for (const key of listEmailEventKeys()) {
        if (!Object.prototype.hasOwnProperty.call(prefs, key)) {
            prefs[key] = true;
        }
    }
    return prefs;
}

const DEFAULT_NOTIFICATION_SETTINGS = Object.freeze({
    adminNotificationEmail: '',
    adminNotificationEmail2: '',
    adminNotificationEmailEnabled: true,
    adminNotificationEmail2Enabled: true,
    emailNotificationsEnabled: true,
    browserNotificationsEnabled: true,
    soundNotificationsEnabled: false,
    notificationSoundId: 'soft',
    emailEventPreferences: getDefaultEmailEventPreferences(),
    eventChannelPreferences: getDefaultEventChannelPreferences({
        emailNotificationsEnabled: true,
        browserNotificationsEnabled: true,
        soundNotificationsEnabled: false,
        emailEventPreferences: getDefaultEmailEventPreferences()
    }),
    updatedAt: null,
    updatedByAdminId: '',
    updatedByAdminEmail: ''
});

function ValidationError(message, details = {}) {
    const error = new Error(message);
    error.statusCode = 400;
    error.code = 'NOTIFICATION_SETTINGS_VALIDATION_FAILED';
    error.details = details;
    return error;
}

function normalizeNotificationSoundId(value) {
    const sound = normalizeText(value, 'soft').toLowerCase();
    return ALLOWED_NOTIFICATION_SOUNDS.has(sound) ? sound : 'soft';
}

function normalizeEmailEventPreferences(raw = {}) {
    const defaults = getDefaultEmailEventPreferences();
    const source = raw && typeof raw === 'object' ? raw : {};
    const next = { ...defaults };
    for (const key of Object.keys(defaults)) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            next[key] = normalizeBoolean(source[key], defaults[key]);
        }
    }
    return next;
}

function normalizeSettings(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const adminNotificationEmail = normalizeEmail(source.adminNotificationEmail);
    const adminNotificationEmail2 = normalizeEmail(source.adminNotificationEmail2);
    const adminNotificationEmailEnabled = Object.prototype.hasOwnProperty.call(source, 'adminNotificationEmailEnabled')
        ? normalizeBoolean(source.adminNotificationEmailEnabled, true)
        : true;
    const adminNotificationEmail2Enabled = Object.prototype.hasOwnProperty.call(source, 'adminNotificationEmail2Enabled')
        ? normalizeBoolean(source.adminNotificationEmail2Enabled, true)
        : true;
    const emailNotificationsEnabled = normalizeBoolean(
        source.emailNotificationsEnabled,
        DEFAULT_NOTIFICATION_SETTINGS.emailNotificationsEnabled
    );
    const browserNotificationsEnabled = normalizeBoolean(
        source.browserNotificationsEnabled,
        DEFAULT_NOTIFICATION_SETTINGS.browserNotificationsEnabled
    );
    const soundNotificationsEnabled = normalizeBoolean(
        source.soundNotificationsEnabled,
        DEFAULT_NOTIFICATION_SETTINGS.soundNotificationsEnabled
    );
    const notificationSoundId = normalizeNotificationSoundId(
        source.notificationSoundId || DEFAULT_NOTIFICATION_SETTINGS.notificationSoundId
    );

    let emailEventPreferences = normalizeEmailEventPreferences(source.emailEventPreferences);
    const hasChannelMatrix = source.eventChannelPreferences
        && typeof source.eventChannelPreferences === 'object'
        && Object.keys(source.eventChannelPreferences).length > 0;

    const globalsForChannels = {
        emailNotificationsEnabled,
        browserNotificationsEnabled,
        soundNotificationsEnabled,
        emailEventPreferences
    };

    let eventChannelPreferences = normalizeEventChannelPreferences(
        source.eventChannelPreferences,
        globalsForChannels
    );

    // When the client submits a channel matrix, mirror email toggles from it.
    if (hasChannelMatrix && source.eventChannelPreferences) {
        emailEventPreferences = deriveEmailEventPreferencesFromChannels(
            eventChannelPreferences,
            emailNotificationsEnabled
        );
        eventChannelPreferences = normalizeEventChannelPreferences(
            eventChannelPreferences,
            {
                emailNotificationsEnabled,
                browserNotificationsEnabled,
                soundNotificationsEnabled,
                emailEventPreferences
            }
        );
    }

    return {
        adminNotificationEmail,
        adminNotificationEmail2,
        adminNotificationEmailEnabled,
        adminNotificationEmail2Enabled,
        emailNotificationsEnabled,
        browserNotificationsEnabled,
        soundNotificationsEnabled,
        notificationSoundId,
        emailEventPreferences,
        eventChannelPreferences,
        updatedAt: source.updatedAt || null,
        updatedByAdminId: normalizeText(source.updatedByAdminId),
        updatedByAdminEmail: normalizeEmail(source.updatedByAdminEmail)
    };
}

function validateForSave(payload = {}) {
    const next = normalizeSettings(payload);
    const details = {};

    if (next.adminNotificationEmail && !isValidEmail(next.adminNotificationEmail)) {
        details.adminNotificationEmail = 'Enter a valid notification email address.';
    }

    if (next.adminNotificationEmail2 && !isValidEmail(next.adminNotificationEmail2)) {
        details.adminNotificationEmail2 = 'Enter a valid second notification email address.';
    }

    if (next.adminNotificationEmailEnabled && next.adminNotificationEmail && !isValidEmail(next.adminNotificationEmail)) {
        details.adminNotificationEmail = 'Recipient 1 must be a valid email address before it can be enabled.';
    }

    if (next.adminNotificationEmail2Enabled && next.adminNotificationEmail2 && !isValidEmail(next.adminNotificationEmail2)) {
        details.adminNotificationEmail2 = 'Recipient 2 must be a valid email address before it can be enabled.';
    }

    if (Object.keys(details).length) {
        throw ValidationError('Notification settings validation failed.', details);
    }

    return next;
}

function resolveProviderConnectionStatus(settings, runtime, smtp) {
    if (!smtp?.configured) {
        return {
            code: 'configuration_required',
            label: 'Configuration Required',
            detail: 'Set EMAIL_HOST, EMAIL_USER, and EMAIL_PASS in the server environment.'
        };
    }

    if (!runtime?.masterEmailEnabled) {
        return {
            code: 'not_connected',
            label: 'Not Connected',
            detail: 'Email master switch is disabled in environment variables.'
        };
    }

    if (!runtime?.emailNotificationsEnabled) {
        return {
            code: 'not_connected',
            label: 'Not Connected',
            detail: 'Email notifications are disabled in Notification Settings.'
        };
    }

    if (!runtime?.adminNotificationEmails?.length) {
        return {
            code: 'not_connected',
            label: 'No Active Recipients',
            detail: 'Enable Recipient 1 or Recipient 2 and enter a valid email to receive order notifications.'
        };
    }

    if (runtime?.readyForEmailDelivery) {
        return {
            code: 'connected',
            label: 'Connected',
            detail: 'SMTP is configured and ready to deliver admin alert emails.'
        };
    }

    return {
        code: 'not_connected',
        label: 'Not Connected',
        detail: 'Email transport is configured but delivery is not ready yet.'
    };
}

function toPublicSettings(settings) {
    const smtp = readEnvSmtpConfig();
    const runtime = buildMailRuntimeConfig(settings);
    const connection = resolveProviderConnectionStatus(settings, runtime, smtp);
    let hubStatus = { channels: listChannels(), adapters: [] };
    try {
        const hub = require('./notifications/notification-hub.service');
        hubStatus = hub.getHubStatus(settings);
    } catch (_error) {
        // non-blocking
    }
    return {
        ...settings,
        emailRecipients: resolveAdminNotificationRecipientSlots(settings).map((slot) => ({
            slot: slot.slot,
            label: slot.label,
            email: slot.configuredEmail || '',
            enabled: Boolean(slot.enabled),
            active: Boolean(slot.enabled && slot.email),
            effectiveEmail: slot.email || '',
            source: slot.source || ''
        })),
        effectiveAdminNotificationEmail: runtime.adminNotificationEmail,
        effectiveAdminNotificationEmails: Array.isArray(runtime.adminNotificationEmails)
            ? runtime.adminNotificationEmails
            : (runtime.adminNotificationEmail ? [runtime.adminNotificationEmail] : []),
        activeEmailRecipientCount: Array.isArray(runtime.adminNotificationEmails)
            ? runtime.adminNotificationEmails.length
            : 0,
        emailEventCatalog: Object.keys(getDefaultEmailEventPreferences()).map((key) => ({
            key,
            enabled: Boolean(settings.emailEventPreferences?.[key] !== false),
            channels: settings.eventChannelPreferences?.[key] || getDefaultChannelPrefsForEvent(key, settings)
        })),
        channelCatalog: listChannels(),
        communicationHub: hubStatus,
        availableNotificationSounds: [
            { id: 'soft', label: 'Soft Tone' },
            { id: 'chime', label: 'Chime' },
            { id: 'alert', label: 'Alert Pulse' }
        ],
        emailTransport: {
            provider: resolveEmailProviderName(),
            configured: smtp.configured,
            host: smtp.host || null,
            port: smtp.port || null,
            secure: smtp.secure,
            fromName: smtp.fromName || null,
            fromAddress: smtp.fromAddress || null,
            userConfigured: Boolean(smtp.user),
            passConfigured: Boolean(smtp.pass),
            source: 'environment',
            connectionStatus: connection.code,
            connectionLabel: connection.label,
            connectionDetail: connection.detail
        },
        masterEmailEnabled: runtime.masterEmailEnabled,
        readyForEmailDelivery: runtime.readyForEmailDelivery
    };
}

async function getNotificationSettings() {
    const settingsDoc = await settingsDataService.getSettings();
    const raw = settingsDoc?.value?.[MODULE_KEY] || {};
    return normalizeSettings(raw);
}

async function getAdminNotificationSettings() {
    const settings = await getNotificationSettings();
    return toPublicSettings(settings);
}

async function updateNotificationSettings(payload = {}, admin = {}) {
    const current = await getNotificationSettings();
    const merged = {
        ...current,
        ...payload
    };
    const validated = validateForSave(merged);
    const next = {
        ...validated,
        updatedAt: new Date().toISOString(),
        updatedByAdminId: normalizeText(admin?.id),
        updatedByAdminEmail: normalizeEmail(admin?.email)
    };

    const row = await settingsDataService.getSettings();
    const existingValue = row?.value && typeof row.value === 'object' ? row.value : {};
    const fallbackSupportEmail = normalizeEmail(
        process.env.ADMIN_EMAIL || process.env.EMAIL_FROM_ADDRESS || ''
    );

    await settingsDataService.updateSettings({
        storeName: normalizeText(row?.storeName || existingValue.storeName, 'BYOSE Market'),
        supportEmail: normalizeEmail(row?.supportEmail || existingValue.supportEmail, fallbackSupportEmail),
        supportPhone: normalizeText(row?.supportPhone || existingValue.supportPhone),
        currency: normalizeText(row?.currency || existingValue.currency, 'RWF'),
        updatedByAdminId: next.updatedByAdminId,
        updatedByAdminEmail: next.updatedByAdminEmail,
        touchedModules: [MODULE_KEY],
        value: {
            ...existingValue,
            [MODULE_KEY]: next,
            branding: existingValue.branding,
            delivery: existingValue.delivery,
            seo: existingValue.seo,
            sessionManagement: existingValue.sessionManagement
        }
    });

    try {
        const monitoring = require('./notification-monitoring.service');
        void monitoring.recordOpsLog({
            eventType: 'CONFIGURATION_CHANGED',
            status: 'info',
            channel: 'settings',
            message: 'Notification settings were updated.',
            details: {
                emailEnabled: next.emailNotificationsEnabled,
                browserEnabled: next.browserNotificationsEnabled,
                soundEnabled: next.soundNotificationsEnabled,
                hasAdminEmail: Boolean(next.adminNotificationEmail),
                hasAdminEmail2: Boolean(next.adminNotificationEmail2),
                recipient1Enabled: next.adminNotificationEmailEnabled !== false,
                recipient2Enabled: next.adminNotificationEmail2Enabled !== false,
                channelEvents: Object.keys(next.eventChannelPreferences || {}).length,
                updatedByAdminId: next.updatedByAdminId || null
            }
        });
    } catch (_error) {
        // non-blocking
    }

    return toPublicSettings(next);
}

async function getMailRuntimeConfig() {
    const settings = await getNotificationSettings();
    return buildMailRuntimeConfig(settings);
}

/**
 * Send a test email using current saved settings + env SMTP.
 * Sends separately to each active recipient so mixed results are reported honestly.
 * Never exposes SMTP secrets. Never sends unless explicitly requested.
 */
async function sendTestNotificationEmail(admin = {}, options = {}) {
    const settings = await getNotificationSettings();
    const publicSettings = toPublicSettings(settings);
    const runtime = buildMailRuntimeConfig(settings);
    const provider = getProviderStatus();

    const overrideTo = normalizeEmail(options.to);
    const active = resolveActiveAdminNotificationRecipients(settings);
    const recipients = (overrideTo && isValidEmail(overrideTo))
        ? [{ slot: 0, label: 'Override', email: overrideTo, enabled: true }]
        : active;

    if (!recipients.length) {
        throw ValidationError('Enable at least one recipient with a valid email before sending a test.', {
            adminNotificationEmail: 'No active email recipients are configured.'
        });
    }

    if (!provider.configured) {
        const error = new Error('Email provider is not configured on the server.');
        error.statusCode = 503;
        error.code = 'EMAIL_PROVIDER_NOT_CONFIGURED';
        error.details = {
            connectionStatus: 'configuration_required',
            detail: publicSettings.emailTransport.connectionDetail
        };
        throw error;
    }

    if (!runtime.masterEmailEnabled) {
        const error = new Error('Admin email notifications are disabled by environment configuration.');
        error.statusCode = 503;
        error.code = 'EMAIL_MASTER_DISABLED';
        throw error;
    }

    const appBaseUrl = normalizeText(process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL, 'https://byosemarket.com');
    const results = [];

    for (const slot of recipients) {
        const shell = buildAdminEmailShell({
            title: 'Test Notification Email',
            preview: 'This is a test notification from BYOSE Market.',
            summary: 'This is a test notification from BYOSE Market. If you received this message, Notification Settings can deliver emails to this recipient.',
            details: [
                { label: 'Requested By', value: normalizeText(admin.email || admin.id || 'Admin') },
                { label: 'Recipient', value: slot.email },
                { label: 'Recipient Slot', value: slot.label || `Recipient ${slot.slot || ''}`.trim() },
                { label: 'Provider', value: provider.provider || 'smtp' },
                { label: 'From', value: [provider.fromName, provider.fromAddress].filter(Boolean).join(' · ') }
            ],
            ctaLabel: 'Open Notification Settings',
            ctaUrl: `${appBaseUrl.replace(/\/+$/, '')}/admin/dashboard.html#/settings?panel=notifications`,
            accent: '#0f766e'
        });

        const result = await sendViaProvider({
            to: slot.email,
            subject: '[BYOSE] Test Notification Email',
            html: shell.html,
            text: shell.text,
            headers: {
                'X-BYOSE-Event': 'TEST_EMAIL',
                'X-BYOSE-Source': 'notification-settings',
                'X-BYOSE-Recipient-Slot': String(slot.slot || '')
            }
        });

        results.push({
            slot: slot.slot || null,
            label: slot.label || '',
            recipient: slot.email,
            success: Boolean(result.success),
            status: result.success ? 'sent' : 'failed',
            provider: result.provider || provider.provider,
            messageId: result.messageId || null,
            error: result.success ? null : String(result.error?.message || result.error || 'Unable to send test email.')
        });
    }

    const sent = results.filter((item) => item.success);
    const failed = results.filter((item) => !item.success);

    try {
        const monitoring = require('./notification-monitoring.service');
        void monitoring.recordOpsLog({
            eventType: failed.length && sent.length
                ? 'TEST_EMAIL_PARTIAL'
                : failed.length
                    ? 'TEST_EMAIL_FAILED'
                    : 'TEST_EMAIL_SENT',
            status: failed.length && !sent.length ? 'error' : failed.length ? 'warning' : 'success',
            channel: 'email',
            message: failed.length && sent.length
                ? 'Test notification partially delivered.'
                : failed.length
                    ? 'Test notification failed.'
                    : 'Test notification sent.',
            details: {
                sent: sent.map((item) => maskEmailAddress(item.recipient)),
                failed: failed.map((item) => ({ recipient: maskEmailAddress(item.recipient), error: item.error }))
            }
        });
    } catch (_error) {
        // non-blocking
    }

    if (!sent.length) {
        appLogger.warn('notification.settings.test_email_failed', {
            recipients: results.map((item) => maskEmailAddress(item.recipient)),
            provider: provider.provider,
            error: failed[0]?.error || 'send_failed',
            adminId: admin.id || ''
        });
        const error = new Error('Test email failed.');
        error.statusCode = 502;
        error.code = 'TEST_EMAIL_SEND_FAILED';
        error.details = { results, error: failed[0]?.error || 'send_failed' };
        throw error;
    }

    appLogger.info('notification.settings.test_email_sent', {
        recipients: sent.map((item) => maskEmailAddress(item.recipient)),
        failed: failed.length,
        provider: provider.provider,
        adminId: admin.id || ''
    });

    return {
        success: sent.length > 0,
        partial: Boolean(sent.length && failed.length),
        recipient: sent[0]?.recipient || recipients[0].email,
        recipients: sent.map((item) => item.recipient),
        results,
        provider: provider.provider,
        messageId: sent[0]?.messageId || null,
        connectionStatus: publicSettings.emailTransport.connectionStatus,
        sentAt: new Date().toISOString(),
        message: failed.length
            ? `Test email sent to ${sent.map((item) => item.recipient).join(', ')}. Failed for ${failed.map((item) => item.recipient).join(', ')}.`
            : 'Test email sent successfully.'
    };
}

module.exports = {
    MODULE_KEY,
    DEFAULT_NOTIFICATION_SETTINGS,
    ALLOWED_NOTIFICATION_SOUNDS,
    getNotificationSettings,
    getAdminNotificationSettings,
    updateNotificationSettings,
    getMailRuntimeConfig,
    sendTestNotificationEmail,
    toPublicSettings,
    normalizeSettings,
    getDefaultEmailEventPreferences,
    resolveProviderConnectionStatus
};
