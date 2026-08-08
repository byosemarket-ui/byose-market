/**
 * Channel adapters — each channel is independent and swappable.
 */

const { CHANNELS, CHANNEL_META, DELIVERY_STATUSES } = require('./channel.registry');
const { renderChannelTemplate } = require('../notification-content.service');

function skipped(channel, reason) {
    return {
        channel,
        success: false,
        skipped: true,
        status: DELIVERY_STATUSES.SKIPPED,
        reason
    };
}

async function deliverInApp({ notification }) {
    if (!notification?.id) {
        return skipped(CHANNELS.IN_APP, 'in_app_not_created');
    }
    return {
        channel: CHANNELS.IN_APP,
        success: true,
        skipped: false,
        status: DELIVERY_STATUSES.DELIVERED,
        provider: 'admin_notifications',
        messageId: notification.id,
        deliveredAt: new Date().toISOString()
    };
}

async function deliverEmail({ notification, eventKey, context }) {
    const emailService = require('../../email/notification-email.service');
    const result = await emailService.safeDeliverNotificationEmail(notification, eventKey, context);
    if (!result) {
        return {
            channel: CHANNELS.EMAIL,
            success: false,
            skipped: true,
            status: DELIVERY_STATUSES.SKIPPED,
            reason: 'email_unavailable'
        };
    }
    if (result.skipped) {
        return {
            channel: CHANNELS.EMAIL,
            success: false,
            skipped: true,
            status: DELIVERY_STATUSES.SKIPPED,
            reason: result.reason || 'email_skipped',
            provider: result.provider || 'smtp'
        };
    }
    if (result.success) {
        return {
            channel: CHANNELS.EMAIL,
            success: true,
            skipped: false,
            status: DELIVERY_STATUSES.SENT,
            provider: result.provider || 'smtp',
            messageId: result.messageId || null,
            subject: result.subject || null,
            recipient: result.recipient || null,
            sentAt: new Date().toISOString()
        };
    }
    return {
        channel: CHANNELS.EMAIL,
        success: false,
        skipped: false,
        status: result.retrying ? DELIVERY_STATUSES.RETRYING : DELIVERY_STATUSES.FAILED,
        reason: result.reason || String(result.error?.message || result.error || 'email_failed'),
        provider: result.provider || 'smtp',
        recipient: result.recipient || null,
        subject: result.subject || null,
        nextRetryAt: result.retrying ? new Date(Date.now() + 60 * 1000).toISOString() : null
    };
}

async function deliverBrowser({ eventKey, context, notification }) {
    const rendered = renderChannelTemplate(CHANNELS.BROWSER, eventKey, {
        ...context,
        notification
    });
    // Authorized for client delivery — actual display happens in the admin browser.
    return {
        channel: CHANNELS.BROWSER,
        success: true,
        skipped: false,
        status: DELIVERY_STATUSES.SENT,
        provider: 'browser_client',
        payload: { ...rendered.rendered, deliveryMode: 'client_authorized' },
        sentAt: new Date().toISOString()
    };
}

async function deliverSound({ eventKey, context, notification }) {
    const rendered = renderChannelTemplate(CHANNELS.SOUND, eventKey, {
        ...context,
        notification
    });
    return {
        channel: CHANNELS.SOUND,
        success: true,
        skipped: false,
        status: DELIVERY_STATUSES.SENT,
        provider: 'browser_audio',
        payload: rendered.rendered,
        sentAt: new Date().toISOString()
    };
}

async function deliverFutureStub(channel, { eventKey }) {
    const meta = CHANNEL_META[channel] || {};
    if (!process.env[`${String(channel).toUpperCase()}_PROVIDER`] && !process.env[`${String(channel).toUpperCase()}_API_KEY`]) {
        return skipped(channel, meta.planned ? 'provider_not_configured' : 'channel_disabled');
    }
    // Reserved for future providers — still skip until a real adapter is implemented.
    return skipped(channel, 'adapter_not_implemented');
}

const ADAPTERS = Object.freeze({
    [CHANNELS.IN_APP]: deliverInApp,
    [CHANNELS.EMAIL]: deliverEmail,
    [CHANNELS.BROWSER]: deliverBrowser,
    [CHANNELS.SOUND]: deliverSound,
    [CHANNELS.SMS]: (payload) => deliverFutureStub(CHANNELS.SMS, payload),
    [CHANNELS.WHATSAPP]: (payload) => deliverFutureStub(CHANNELS.WHATSAPP, payload),
    [CHANNELS.PUSH]: (payload) => deliverFutureStub(CHANNELS.PUSH, payload)
});

function getAdapter(channel) {
    return ADAPTERS[String(channel || '').toLowerCase()] || null;
}

function listAdapterStatus() {
    return Object.keys(ADAPTERS).map((channel) => {
        const meta = CHANNEL_META[channel] || {};
        return {
            channel,
            label: meta.label || channel,
            planned: Boolean(meta.planned),
            runtime: meta.runtime || 'server',
            ready: !meta.planned
        };
    });
}

module.exports = {
    ADAPTERS,
    getAdapter,
    listAdapterStatus,
    deliverInApp,
    deliverEmail,
    deliverBrowser,
    deliverSound
};
