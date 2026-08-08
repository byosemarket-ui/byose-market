/**
 * Email services barrel export.
 */
const provider = require('./email-provider.service');
const templates = require('./admin-email-templates');
const delivery = require('./notification-email.service');

module.exports = {
    sendViaProvider: provider.sendViaProvider,
    getProviderStatus: provider.getProviderStatus,
    isProviderConfigured: provider.isProviderConfigured,
    buildAdminEventEmail: templates.buildAdminEventEmail,
    listEmailEventKeys: templates.listEmailEventKeys,
    deliverNotificationEmail: delivery.deliverNotificationEmail,
    safeDeliverNotificationEmail: delivery.safeDeliverNotificationEmail,
    startNotificationEmailRetryWorker: delivery.startNotificationEmailRetryWorker,
    stopNotificationEmailRetryWorker: delivery.stopNotificationEmailRetryWorker,
    processEmailRetries: delivery.processEmailRetries
};
