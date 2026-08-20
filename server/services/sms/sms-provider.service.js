/**
 * SMS provider abstraction. Default: Africa's Talking (already in the project).
 * Secrets stay in environment variables and are never returned to clients.
 */

const { appLogger } = require('../../utils/logger');
const { maskPhoneNumber, normalizeNotificationPhone } = require('../../utils/phone');

function normalizeText(value) {
    return String(value == null ? '' : value).trim();
}

function resolveSmsProviderName() {
    const raw = normalizeText(process.env.SMS_PROVIDER || process.env.SMS_TRANSPORT || 'africastalking').toLowerCase();
    if (raw === 'twilio' || raw === 'vonage') {
        return raw;
    }
    return 'africastalking';
}

function readEnvSmsConfig() {
    const apiKey = normalizeText(process.env.AFRICASTALKING_API_KEY);
    const username = normalizeText(process.env.AFRICASTALKING_USERNAME);
    const senderId = normalizeText(
        process.env.AFRICASTALKING_FROM || process.env.AFRICASTALKING_SENDER_ID
    );
    return {
        provider: resolveSmsProviderName(),
        apiKeyConfigured: Boolean(apiKey),
        username,
        senderId,
        configured: Boolean(apiKey && username)
    };
}

const PROVIDERS = Object.freeze({
    AFRICASTALKING: 'africastalking'
});

let clientCache = {
    key: '',
    sms: null
};

function getProviderStatus() {
    const env = readEnvSmsConfig();
    return {
        provider: env.provider,
        configured: env.configured,
        username: env.username || null,
        senderId: env.senderId || null,
        apiKeyConfigured: env.apiKeyConfigured,
        fromName: env.senderId || 'BYOSE Market'
    };
}

function resetSmsClient() {
    clientCache = { key: '', sms: null };
}

function getSmsClient() {
    const env = readEnvSmsConfig();
    if (env.provider !== PROVIDERS.AFRICASTALKING || !env.configured) {
        return null;
    }
    const apiKey = String(process.env.AFRICASTALKING_API_KEY || '').trim();
    const cacheKey = `${env.username}:${apiKey.slice(0, 6)}:${env.senderId}`;
    if (clientCache.sms && clientCache.key === cacheKey) {
        return clientCache.sms;
    }
    const sms = require('africastalking')({
        apiKey,
        username: env.username
    }).SMS;
    clientCache = { key: cacheKey, sms };
    return sms;
}

function sanitizeSmsErrorMessage(error) {
    return String(error?.message || error || 'SMS send failed')
        .replace(/(api[_-]?key|secret|token|password|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]')
        .slice(0, 500);
}

function classifySmsError(error, extras = {}) {
    const message = String(error?.message || error || '').toLowerCase();
    const code = String(error?.code || extras.code || '').toUpperCase();
    const statusCode = Number(extras.statusCode || error?.statusCode || 0);

    if (extras.permanent === true) {
        return { category: extras.category || 'permanent', retryable: false, code: extras.code || 'permanent' };
    }

    if (
        extras.reason === 'invalid_recipient'
        || extras.reason === 'missing_recipient'
        || statusCode === 402
        || /invalid (phone|number)|user unknown|not a valid/.test(message)
    ) {
        return { category: 'permanent', retryable: false, code: 'invalid_recipient' };
    }

    if (
        extras.reason === 'provider_not_configured'
        || /not configured/.test(message)
    ) {
        return { category: 'config', retryable: false, code: 'not_configured' };
    }

    if (
        statusCode === 401
        || statusCode === 403
        || statusCode === 404
        || statusCode === 407
        || /invalid sender|authentication|not allowed|account/.test(message)
    ) {
        return { category: 'permanent', retryable: false, code: extras.code || 'auth_or_sender' };
    }

    if (
        ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'].includes(code)
        || statusCode === 405
        || statusCode === 406
        || /timed out|timeout|temporarily|try again|unavailable|gateway|insufficient/.test(message)
        || (statusCode >= 500 && statusCode < 600)
    ) {
        return { category: 'temporary', retryable: true, code: code || 'temporary' };
    }

    return { category: 'temporary', retryable: true, code: code || 'unknown' };
}

function parseAfricasTalkingResult(response) {
    const recipients = Array.isArray(response?.SMSMessageData?.Recipients)
        ? response.SMSMessageData.Recipients
        : [];
    const first = recipients[0] || {};
    const statusCode = Number(first.statusCode || 0);
    const statusText = String(first.status || '').toLowerCase();
    const success = statusText === 'success' || statusCode === 100 || statusCode === 101 || statusCode === 102;
    return {
        success,
        statusCode,
        statusText: first.status || '',
        messageId: first.messageId || null,
        cost: first.cost || null,
        providerMessage: String(response?.SMSMessageData?.Message || '').slice(0, 200)
    };
}

async function sendViaProvider({ to, message } = {}) {
    const status = getProviderStatus();
    const recipient = normalizeNotificationPhone(to);
    const body = String(message || '').trim();

    if (!recipient) {
        const error = new Error('Invalid SMS recipient');
        return {
            success: false,
            provider: status.provider,
            error,
            errorCategory: 'permanent',
            retryable: false,
            reason: 'invalid_recipient'
        };
    }

    if (!body) {
        const error = new Error('SMS message is empty');
        return {
            success: false,
            provider: status.provider,
            error,
            errorCategory: 'permanent',
            retryable: false,
            reason: 'malformed'
        };
    }

    if (!status.configured) {
        const error = new Error('SMS provider is not configured');
        return {
            success: false,
            provider: status.provider,
            error,
            errorCategory: 'config',
            retryable: false,
            reason: 'provider_not_configured'
        };
    }

    if (status.provider !== PROVIDERS.AFRICASTALKING) {
        const error = new Error(`SMS provider "${status.provider}" is not implemented`);
        return {
            success: false,
            provider: status.provider,
            error,
            errorCategory: 'config',
            retryable: false,
            reason: 'provider_not_configured'
        };
    }

    const sms = getSmsClient();
    if (!sms) {
        const error = new Error('SMS provider is not configured');
        return {
            success: false,
            provider: status.provider,
            error,
            errorCategory: 'config',
            retryable: false,
            reason: 'provider_not_configured'
        };
    }

    try {
        const payload = {
            to: [recipient],
            message: body
        };
        if (status.senderId) {
            payload.from = status.senderId;
        }
        const response = await sms.send(payload);
        const parsed = parseAfricasTalkingResult(response);
        if (!parsed.success) {
            const error = new Error(parsed.statusText || parsed.providerMessage || 'SMS provider rejected the message');
            const classified = classifySmsError(error, {
                statusCode: parsed.statusCode,
                reason: parsed.statusCode === 402 ? 'invalid_recipient' : ''
            });
            appLogger.warn('sms.provider.send_rejected', {
                provider: status.provider,
                recipient: maskPhoneNumber(recipient),
                statusCode: parsed.statusCode,
                error: sanitizeSmsErrorMessage(error),
                errorCategory: classified.category
            });
            return {
                success: false,
                provider: status.provider,
                error,
                errorCategory: classified.category,
                retryable: classified.retryable,
                statusCode: parsed.statusCode,
                messageId: parsed.messageId || null
            };
        }

        appLogger.info('sms.provider.sent', {
            provider: status.provider,
            recipient: maskPhoneNumber(recipient),
            messageId: parsed.messageId || null
        });

        return {
            success: true,
            provider: status.provider,
            messageId: parsed.messageId || null,
            statusCode: parsed.statusCode,
            recipient
        };
    } catch (error) {
        resetSmsClient();
        const classified = classifySmsError(error);
        appLogger.error('sms.provider.send_failed', {
            provider: status.provider,
            recipient: maskPhoneNumber(recipient),
            error: sanitizeSmsErrorMessage(error),
            errorCategory: classified.category
        });
        return {
            success: false,
            provider: status.provider,
            error,
            errorCategory: classified.category,
            retryable: classified.retryable
        };
    }
}

module.exports = {
    PROVIDERS,
    classifySmsError,
    getProviderStatus,
    getSmsClient,
    readEnvSmsConfig,
    resetSmsClient,
    sanitizeSmsErrorMessage,
    sendViaProvider
};
