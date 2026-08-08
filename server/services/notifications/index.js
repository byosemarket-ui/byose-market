/**
 * Public exports for the Notification Communication Hub.
 */

const hub = require('./notification-hub.service');
const content = require('./notification-content.service');
const registry = require('./channels/channel.registry');
const adapters = require('./channels/channel.adapters');
const analytics = require('./notification-analytics.service');

module.exports = {
    ...hub,
    buildEventContent: content.buildEventContent,
    renderChannelTemplate: content.renderChannelTemplate,
    listTemplateEventKeys: content.listTemplateEventKeys,
    CHANNELS: registry.CHANNELS,
    CHANNEL_META: registry.CHANNEL_META,
    CHANNEL_ORDER: registry.CHANNEL_ORDER,
    DELIVERY_STATUSES: registry.DELIVERY_STATUSES,
    listAdapterStatus: adapters.listAdapterStatus,
    getAnalyticsDashboard: analytics.getAnalyticsDashboard,
    getAnalyticsReport: analytics.getAnalyticsReport,
    EVENT_LABELS: analytics.EVENT_LABELS
};
