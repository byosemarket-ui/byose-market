/**
 * Resolves notification email + SMTP configuration without hardcoding addresses.
 * Preference order for alert destination:
 * 1) Admin Notification Settings (DB)
 * 2) ADMIN_ALERT_EMAIL env
 * 3) EMAIL_FROM_ADDRESS env
 * 4) ADMIN_EMAIL env
 */
function normalizeText(value, fallback = '') {
    const text = String(value == null ? '' : value).trim();
    return text || fallback;
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const text = String(value == null ? '' : value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(text)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(text)) return false;
    return Boolean(fallback);
}

function normalizeEmail(value) {
    return normalizeText(value).toLowerCase();
}

function isValidEmail(value) {
    const email = normalizeEmail(value);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function resolveEmailProviderName() {
    const raw = normalizeText(process.env.EMAIL_PROVIDER || process.env.EMAIL_TRANSPORT || 'smtp').toLowerCase();
    if (raw === 'sendgrid' || raw === 'ses' || raw === 'mailgun') {
        // Reserved for future API providers; SMTP remains the VPS default transport.
        return raw;
    }
    return 'smtp';
}

function readEnvSmtpConfig() {
    return {
        provider: resolveEmailProviderName(),
        host: normalizeText(process.env.EMAIL_HOST),
        port: Number(process.env.EMAIL_PORT) || 587,
        secure: normalizeBoolean(process.env.EMAIL_SECURE, false),
        user: normalizeText(process.env.EMAIL_USER),
        pass: normalizeText(process.env.EMAIL_PASS),
        fromName: normalizeText(process.env.EMAIL_FROM_NAME, 'BYOSE Market'),
        fromAddress: normalizeEmail(process.env.EMAIL_FROM_ADDRESS),
        configured: Boolean(
            normalizeText(process.env.EMAIL_HOST)
            && normalizeText(process.env.EMAIL_USER)
            && normalizeText(process.env.EMAIL_PASS)
        )
    };
}

function resolveAdminNotificationEmail(settings = {}) {
    const fromSettings = normalizeEmail(settings.adminNotificationEmail);
    if (fromSettings && isValidEmail(fromSettings)) {
        return fromSettings;
    }

    const candidates = [
        process.env.ADMIN_ALERT_EMAIL,
        process.env.EMAIL_FROM_ADDRESS,
        process.env.ADMIN_EMAIL
    ];

    for (const candidate of candidates) {
        const email = normalizeEmail(candidate);
        if (email && isValidEmail(email)) {
            return email;
        }
    }

    return '';
}

function resolveAdminEmailMasterEnabled() {
    const adminFlag = process.env.ADMIN_EMAIL_NOTIFICATIONS_ENABLED;
    if (adminFlag != null && String(adminFlag).trim() !== '') {
        return normalizeBoolean(adminFlag, true);
    }
    const notifyFlag = process.env.NOTIFY_EMAIL_ENABLED;
    if (notifyFlag != null && String(notifyFlag).trim() !== '') {
        return normalizeBoolean(notifyFlag, false);
    }
    // When neither flag is set, allow settings + SMTP readiness to decide.
    return true;
}

function buildMailRuntimeConfig(settings = {}) {
    const smtp = readEnvSmtpConfig();
    const adminNotificationEmail = resolveAdminNotificationEmail(settings);
    const emailNotificationsEnabled = normalizeBoolean(settings.emailNotificationsEnabled, true);
    const masterEnabled = resolveAdminEmailMasterEnabled();
    return {
        adminNotificationEmail,
        emailNotificationsEnabled,
        browserNotificationsEnabled: normalizeBoolean(settings.browserNotificationsEnabled, true),
        soundNotificationsEnabled: normalizeBoolean(settings.soundNotificationsEnabled, false),
        emailEventPreferences: settings.emailEventPreferences && typeof settings.emailEventPreferences === 'object'
            ? settings.emailEventPreferences
            : {},
        notificationSoundId: settings.notificationSoundId || 'soft',
        smtp: {
            ...smtp,
            // Never expose password to clients — services may use this server-side only.
            pass: undefined,
            passConfigured: Boolean(smtp.pass)
        },
        provider: smtp.provider,
        masterEmailEnabled: masterEnabled,
        readyForEmailDelivery: Boolean(
            masterEnabled
            && emailNotificationsEnabled
            && adminNotificationEmail
            && smtp.configured
        )
    };
}

module.exports = {
    normalizeText,
    normalizeBoolean,
    normalizeEmail,
    isValidEmail,
    resolveEmailProviderName,
    readEnvSmtpConfig,
    resolveAdminNotificationEmail,
    resolveAdminEmailMasterEnabled,
    buildMailRuntimeConfig
};
