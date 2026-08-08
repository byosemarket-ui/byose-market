/**
 * Email provider abstraction for admin + transactional mail.
 * Default provider: SMTP (nodemailer). Designed so additional providers
 * (SendGrid API, SES, etc.) can be added without changing callers.
 */

const { appLogger } = require('../../utils/logger');
const { readEnvSmtpConfig, normalizeText, normalizeBoolean } = require('../../config/notification-mail.config');

const PROVIDERS = Object.freeze({
    SMTP: 'smtp'
});

let transporterCache = {
    key: '',
    transporter: null
};

function resolveProviderName() {
    const raw = normalizeText(process.env.EMAIL_PROVIDER || process.env.EMAIL_TRANSPORT || 'smtp').toLowerCase();
    if (raw === 'smtp' || raw === 'nodemailer') {
        return PROVIDERS.SMTP;
    }
    // Unknown providers fall back to SMTP transport config for VPS setups.
    return PROVIDERS.SMTP;
}

function buildSmtpTransportKey(smtp) {
    return [
        resolveProviderName(),
        smtp.host,
        smtp.port,
        smtp.secure ? '1' : '0',
        smtp.user,
        smtp.pass ? '***' : ''
    ].join('|');
}

function createSmtpTransporter(smtp) {
    // Lazy require keeps boot light when email is unused.
    // eslint-disable-next-line global-require
    const nodemailer = require('nodemailer');
    return nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: Boolean(smtp.secure),
        auth: smtp.user
            ? { user: smtp.user, pass: smtp.pass }
            : undefined,
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000
    });
}

function getProviderStatus() {
    const smtp = readEnvSmtpConfig();
    const provider = resolveProviderName();
    const configured = Boolean(smtp.host && smtp.user && smtp.pass);
    return {
        provider,
        configured,
        host: smtp.host || null,
        port: smtp.port || null,
        secure: Boolean(smtp.secure),
        fromName: smtp.fromName || null,
        fromAddress: smtp.fromAddress || smtp.user || null,
        userConfigured: Boolean(smtp.user),
        passConfigured: Boolean(smtp.pass),
        source: 'environment'
    };
}

function getTransporter() {
    const status = getProviderStatus();
    if (!status.configured) {
        return null;
    }

    const smtp = readEnvSmtpConfig();
    const key = buildSmtpTransportKey(smtp);
    if (transporterCache.transporter && transporterCache.key === key) {
        return transporterCache.transporter;
    }

    try {
        const transporter = createSmtpTransporter(smtp);
        transporterCache = { key, transporter };
        return transporter;
    } catch (error) {
        appLogger.warn('email.provider.init_failed', {
            provider: status.provider,
            error: String(error?.message || error)
        });
        transporterCache = { key: '', transporter: null };
        return null;
    }
}

function resetTransporter() {
    transporterCache = { key: '', transporter: null };
}

/**
 * Send an email through the configured provider.
 * Never throws — returns { success, error?, messageId? }.
 */
async function sendViaProvider({
    to,
    subject,
    text = '',
    html = '',
    replyTo = '',
    headers = {}
} = {}) {
    const recipient = normalizeText(to).toLowerCase();
    const emailSubject = normalizeText(subject);
    const textBody = normalizeText(text);
    const htmlBody = String(html || '').trim();
    const status = getProviderStatus();

    if (!recipient || !emailSubject || (!textBody && !htmlBody)) {
        return {
            success: false,
            provider: status.provider,
            error: new Error('Missing required email fields')
        };
    }

    if (!status.configured) {
        return {
            success: false,
            provider: status.provider,
            error: new Error('Email provider is not configured')
        };
    }

    const transporter = getTransporter();
    if (!transporter) {
        return {
            success: false,
            provider: status.provider,
            error: new Error('Email transporter unavailable')
        };
    }

    const fromName = status.fromName || 'BYOSE Market';
    const fromAddress = status.fromAddress;
    const from = `"${fromName}" <${fromAddress}>`;

    try {
        const info = await transporter.sendMail({
            from,
            to: recipient,
            subject: emailSubject,
            text: textBody || undefined,
            html: htmlBody || undefined,
            replyTo: normalizeText(replyTo) || undefined,
            headers: headers && typeof headers === 'object' ? headers : undefined
        });

        return {
            success: true,
            provider: status.provider,
            messageId: String(info?.messageId || ''),
            accepted: Array.isArray(info?.accepted) ? info.accepted : [],
            rejected: Array.isArray(info?.rejected) ? info.rejected : []
        };
    } catch (error) {
        resetTransporter();
        appLogger.error('email.provider.send_failed', {
            provider: status.provider,
            recipient,
            subject: emailSubject,
            error: String(error?.message || error)
        });
        return {
            success: false,
            provider: status.provider,
            error
        };
    }
}

module.exports = {
    PROVIDERS,
    resolveProviderName,
    getProviderStatus,
    getTransporter,
    resetTransporter,
    sendViaProvider,
    // Compatibility helpers used by legacy utils/email.js consumers
    isProviderConfigured: () => getProviderStatus().configured,
    normalizeBoolean
};
