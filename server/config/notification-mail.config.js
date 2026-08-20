/**
 * Resolves notification email + SMTP configuration without hardcoding addresses.
 * Preference order for alert destination 1:
 * 1) Admin Notification Settings recipient 1 (DB)
 * 2) ADMIN_ALERT_EMAIL env
 * 3) EMAIL_FROM_ADDRESS env
 * 4) ADMIN_EMAIL env
 *
 * Recipient 2 is optional:
 * 1) Admin Notification Settings recipient 2 (DB)
 * 2) ADMIN_ALERT_EMAIL_2 env
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

function firstValidEnvEmail(candidates = []) {
    for (const candidate of candidates) {
        const email = normalizeEmail(candidate);
        if (email && isValidEmail(email)) {
            return email;
        }
    }
    return '';
}

function resolveAdminNotificationRecipientSlots(settings = {}) {
    const slot1Enabled = Object.prototype.hasOwnProperty.call(settings, 'adminNotificationEmailEnabled')
        ? normalizeBoolean(settings.adminNotificationEmailEnabled, true)
        : true;
    const slot2Enabled = Object.prototype.hasOwnProperty.call(settings, 'adminNotificationEmail2Enabled')
        ? normalizeBoolean(settings.adminNotificationEmail2Enabled, true)
        : true;

    const slot1Configured = normalizeEmail(settings.adminNotificationEmail);
    const slot2Configured = normalizeEmail(settings.adminNotificationEmail2);

    const slot1 = {
        slot: 1,
        label: 'Recipient 1',
        enabled: slot1Enabled,
        configuredEmail: slot1Configured,
        email: '',
        source: ''
    };
    const slot2 = {
        slot: 2,
        label: 'Recipient 2',
        enabled: slot2Enabled,
        configuredEmail: slot2Configured,
        email: '',
        source: ''
    };

    if (slot1Enabled) {
        if (slot1Configured && isValidEmail(slot1Configured)) {
            slot1.email = slot1Configured;
            slot1.source = 'settings';
        } else {
            const fallback = firstValidEnvEmail([
                process.env.ADMIN_ALERT_EMAIL,
                process.env.EMAIL_FROM_ADDRESS,
                process.env.ADMIN_EMAIL
            ]);
            if (fallback) {
                slot1.email = fallback;
                slot1.source = 'environment';
            }
        }
    }

    if (slot2Enabled) {
        if (slot2Configured && isValidEmail(slot2Configured)) {
            slot2.email = slot2Configured;
            slot2.source = 'settings';
        } else {
            const fallback = firstValidEnvEmail([process.env.ADMIN_ALERT_EMAIL_2]);
            if (fallback && fallback !== slot1.email) {
                slot2.email = fallback;
                slot2.source = 'environment';
            }
        }
    }

    return [slot1, slot2];
}

function resolveActiveAdminNotificationRecipients(settings = {}) {
    const seen = new Set();
    return resolveAdminNotificationRecipientSlots(settings).filter((slot) => {
        if (!slot.enabled || !slot.email || !isValidEmail(slot.email) || seen.has(slot.email)) {
            return false;
        }
        seen.add(slot.email);
        return true;
    });
}

function resolveAdminNotificationEmails(settings = {}) {
    return resolveActiveAdminNotificationRecipients(settings).map((slot) => slot.email);
}

function resolveAdminNotificationEmail(settings = {}) {
    return resolveAdminNotificationEmails(settings)[0] || '';
}

function resolveAdminEmailMasterEnabled() {
    const adminFlag = process.env.ADMIN_EMAIL_NOTIFICATIONS_ENABLED;
    if (adminFlag != null && String(adminFlag).trim() !== '') {
        return normalizeBoolean(adminFlag, true);
    }
    // Admin order/alert emails are controlled by Notification Settings + SMTP.
    // NOTIFY_EMAIL_ENABLED remains the customer-email switch in utils/notifications.js.
    return true;
}

function buildMailRuntimeConfig(settings = {}) {
    const smtp = readEnvSmtpConfig();
    const adminNotificationEmails = resolveAdminNotificationEmails(settings);
    const adminNotificationEmail = adminNotificationEmails[0] || '';
    const emailNotificationsEnabled = normalizeBoolean(settings.emailNotificationsEnabled, true);
    const masterEnabled = resolveAdminEmailMasterEnabled();
    return {
        adminNotificationEmail,
        adminNotificationEmails,
        adminNotificationRecipients: resolveActiveAdminNotificationRecipients(settings),
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
    resolveAdminNotificationEmails,
    resolveAdminNotificationRecipientSlots,
    resolveActiveAdminNotificationRecipients,
    resolveAdminEmailMasterEnabled,
    buildMailRuntimeConfig
};
