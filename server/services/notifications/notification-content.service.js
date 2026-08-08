/**
 * Channel-agnostic notification content + per-channel template renderers.
 * Email HTML remains in admin-email-templates; this layer supplies shared copy.
 */

const { EVENT_TEMPLATE_DEFS, buildAdminEventEmail } = require('../email/admin-email-templates');
const { CHANNELS } = require('./channels/channel.registry');

function text(value, fallback = '') {
    const next = String(value == null ? '' : value).trim();
    return next || fallback;
}

function listTemplateEventKeys() {
    return Object.keys(EVENT_TEMPLATE_DEFS || {});
}

function buildEventContent(eventKey, context = {}) {
    const key = text(eventKey).toUpperCase();
    const def = EVENT_TEMPLATE_DEFS[key] || null;
    const notification = context.notification || {};
    const order = context.order || {};
    const product = context.product || {};
    const customer = context.customer || {};

    const title = text(notification.title || def?.title, key || 'Notification');
    const summary = text(
        notification.message
        || (typeof def?.summary === 'function' ? def.summary(context) : '')
        || title
    );

    const details = [];
    const orderId = text(order.orderId || order.id || notification.relatedOrderId);
    const customerName = text(
        customer.name
        || order.customerName
        || customer.email
        || order.customerEmail
    );
    const productName = text(product.name || product.title || context.productName);
    const stock = context.stock != null ? context.stock : product.stock;

    if (orderId) details.push({ label: 'Order', value: orderId });
    if (customerName) details.push({ label: 'Customer', value: customerName });
    if (productName) details.push({ label: 'Product', value: productName });
    if (stock != null && Number.isFinite(Number(stock))) {
        details.push({ label: 'Stock', value: String(stock) });
    }

    return {
        eventKey: key,
        title,
        summary,
        textBody: summary,
        details,
        priority: text(notification.priority || context.priority, 'normal'),
        ctaLabel: text(def?.ctaLabel, 'Open Admin Dashboard'),
        ctaRoute: text(def?.ctaRoute, 'notifications'),
        templates: {
            inApp: {
                title,
                message: summary
            },
            browser: {
                title,
                body: summary
            },
            sound: {
                cue: 'default'
            },
            sms: {
                body: `[BYOSE] ${title}: ${summary}`.slice(0, 320)
            },
            whatsapp: {
                body: `*${title}*\n${summary}`.slice(0, 1000)
            },
            push: {
                title,
                body: summary
            },
            email: null
        }
    };
}

function renderChannelTemplate(channel, eventKey, context = {}) {
    const content = buildEventContent(eventKey, context);
    const normalized = text(channel).toLowerCase();

    if (normalized === CHANNELS.EMAIL) {
        const email = buildAdminEventEmail(eventKey, {
            ...context,
            notification: context.notification || {
                title: content.title,
                message: content.summary
            }
        }, context.emailOptions || {});
        content.templates.email = email;
        return {
            channel: CHANNELS.EMAIL,
            content,
            rendered: email
        };
    }

    if (normalized === CHANNELS.IN_APP) {
        return { channel: CHANNELS.IN_APP, content, rendered: content.templates.inApp };
    }
    if (normalized === CHANNELS.BROWSER) {
        return { channel: CHANNELS.BROWSER, content, rendered: content.templates.browser };
    }
    if (normalized === CHANNELS.SOUND) {
        return { channel: CHANNELS.SOUND, content, rendered: content.templates.sound };
    }
    if (normalized === CHANNELS.SMS) {
        return { channel: CHANNELS.SMS, content, rendered: content.templates.sms };
    }
    if (normalized === CHANNELS.WHATSAPP) {
        return { channel: CHANNELS.WHATSAPP, content, rendered: content.templates.whatsapp };
    }
    if (normalized === CHANNELS.PUSH) {
        return { channel: CHANNELS.PUSH, content, rendered: content.templates.push };
    }

    return { channel: normalized, content, rendered: null };
}

module.exports = {
    buildEventContent,
    renderChannelTemplate,
    listTemplateEventKeys
};
