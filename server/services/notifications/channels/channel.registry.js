/**
 * Communication channel registry for the Notification Hub.
 * Each channel is independently enableable / future-ready.
 */

const CHANNELS = Object.freeze({
    IN_APP: 'in_app',
    EMAIL: 'email',
    BROWSER: 'browser',
    SOUND: 'sound',
    SMS: 'sms',
    WHATSAPP: 'whatsapp',
    PUSH: 'push'
});

const CHANNEL_META = Object.freeze({
    [CHANNELS.IN_APP]: {
        id: CHANNELS.IN_APP,
        label: 'Admin Dashboard',
        description: 'In-app notification center and header bell',
        runtime: 'server',
        configurable: true,
        defaultEnabled: true,
        planned: false
    },
    [CHANNELS.EMAIL]: {
        id: CHANNELS.EMAIL,
        label: 'Email',
        description: 'SMTP admin alert emails',
        runtime: 'server',
        configurable: true,
        defaultEnabled: true,
        planned: false
    },
    [CHANNELS.BROWSER]: {
        id: CHANNELS.BROWSER,
        label: 'Browser',
        description: 'Desktop browser notifications when the admin tab is backgrounded',
        runtime: 'client',
        configurable: true,
        defaultEnabled: true,
        planned: false
    },
    [CHANNELS.SOUND]: {
        id: CHANNELS.SOUND,
        label: 'Sound',
        description: 'Local browser sound cue for new alerts',
        runtime: 'client',
        configurable: true,
        defaultEnabled: false,
        planned: false
    },
    [CHANNELS.SMS]: {
        id: CHANNELS.SMS,
        label: 'SMS',
        description: 'SMS delivery (provider not configured yet)',
        runtime: 'server',
        configurable: true,
        defaultEnabled: false,
        planned: true
    },
    [CHANNELS.WHATSAPP]: {
        id: CHANNELS.WHATSAPP,
        label: 'WhatsApp',
        description: 'WhatsApp Business delivery (provider not configured yet)',
        runtime: 'server',
        configurable: true,
        defaultEnabled: false,
        planned: true
    },
    [CHANNELS.PUSH]: {
        id: CHANNELS.PUSH,
        label: 'Push',
        description: 'Mobile/web push (provider not configured yet)',
        runtime: 'server',
        configurable: true,
        defaultEnabled: false,
        planned: true
    }
});

const CHANNEL_ORDER = Object.freeze([
    CHANNELS.IN_APP,
    CHANNELS.EMAIL,
    CHANNELS.BROWSER,
    CHANNELS.SOUND,
    CHANNELS.SMS,
    CHANNELS.WHATSAPP,
    CHANNELS.PUSH
]);

const DELIVERY_STATUSES = Object.freeze({
    PENDING: 'pending',
    SENT: 'sent',
    DELIVERED: 'delivered',
    FAILED: 'failed',
    RETRYING: 'retrying',
    SKIPPED: 'skipped'
});

function listChannels() {
    return CHANNEL_ORDER.map((id) => ({ ...CHANNEL_META[id] }));
}

function isKnownChannel(channel) {
    return Boolean(CHANNEL_META[String(channel || '').toLowerCase()]);
}

function normalizeChannel(channel) {
    const value = String(channel || '').trim().toLowerCase();
    return isKnownChannel(value) ? value : '';
}

module.exports = {
    CHANNELS,
    CHANNEL_META,
    CHANNEL_ORDER,
    DELIVERY_STATUSES,
    listChannels,
    isKnownChannel,
    normalizeChannel
};
