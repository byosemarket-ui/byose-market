#!/usr/bin/env node
/**
 * STEP 6 — Admin notifications are email-only.
 * Run: node scripts/verify-admin-email-only.js
 *
 * Customer OTP / customer SMS via Africa's Talking must remain available.
 * Admin order/payment/delivery notifications must not send SMS.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];

function assert(condition, message) {
    if (!condition) failures.push(message);
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function exists(rel) {
    return fs.existsSync(path.join(root, rel));
}

function checkSource() {
    const settings = read('server/services/notificationsettings.service.js');
    const ui = read('admin/app/pages/settings-notifications.js');
    const hub = read('server/services/notifications/notification-hub.service.js');
    const adapters = read('server/services/notifications/channels/channel.adapters.js');
    const engine = read('server/services/notification-engine.service.js');
    const provider = read('server/services/sms/sms-provider.service.js');
    const utilsSms = read('server/utils/sms.js');
    const routes = read('server/routes/adminnotifications.js');
    const controller = read('server/controllers/adminnotificationscontroller.js');
    const monitoring = read('server/services/notification-monitoring.service.js');
    const monitoringUi = read('admin/app/pages/notifications-monitoring.js');
    const history = read('admin/app/pages/notifications.js');
    const order = read('server/controllers/ordercontroller.js');
    const dpo = read('server/services/dpopayment.service.js');
    const server = read('server/server.js');
    const automation = read('server/services/notification-automation.service.js');
    const envExample = read('.env.example');
    const emailService = read('server/services/email/notification-email.service.js');
    const adminData = read('admin/app/services/admin-data.service.js');

    assert(utilsSms.includes("require('../services/sms/sms-provider.service')"), 'customer OTP SMS must keep the Africa\'s Talking wrapper');
    assert(provider.includes('africastalking'), 'customer SMS provider must still use Africa\'s Talking');
    assert(!provider.includes('AFRICASTALKING_API_KEY='), 'must not hard-code SMS API keys');
    assert(!ui.includes('AFRICASTALKING_API_KEY'), 'frontend must not contain SMS API keys');
    assert(!engine.includes('orderSmsService'), 'must not create a second order SMS engine');
    assert(!adapters.includes('deliverSms'), 'admin hub must not call an SMS adapter');
    assert(adapters.includes("skipped(CHANNELS.SMS, 'admin_email_only')"), 'SMS adapter must skip admin delivery');
    assert(hub.includes('resolved[CHANNELS.SMS] = false'), 'notification hub must force SMS off for admin events');
    assert(!settings.includes('sendTestNotificationSms'), 'test SMS must be removed from notification settings');
    assert(!settings.includes('adminNotificationSms'), 'admin SMS recipient settings must be removed');
    assert(!ui.includes('Send Test SMS'), 'settings UI must not offer Send Test SMS');
    assert(!ui.includes('SMS Recipient'), 'settings UI must not show SMS recipients');
    assert(!ui.includes('SMS Notification Recipients'), 'settings UI must not have an SMS recipients section');
    assert(ui.includes('Send Test Email'), 'settings UI must keep Send Test Email');
    assert(ui.includes('Email Notification Recipients'), 'settings UI must keep email recipients');
    assert(ui.includes('Email Notification Events'), 'settings UI must keep email events');
    assert(!routes.includes('/settings/test-sms'), 'admin test SMS route must be removed');
    assert(!routes.includes('/monitoring/sms-deliveries/:id/retry'), 'admin SMS retry route must be removed');
    assert(routes.includes('/settings/test-email'), 'test email route must remain');
    assert(routes.includes("router.use(adminAccessDisabled)"), 'notification APIs must keep existing admin auth');
    assert(!controller.includes('sendTestSms'), 'test SMS controller must be removed');
    assert(!controller.includes('retrySmsDelivery'), 'SMS retry controller must be removed');
    assert(!monitoring.includes('probeSmsService'), 'monitoring must not probe Admin SMS health');
    assert(!monitoring.includes('startNotificationSmsRetryWorker'), 'monitoring recovery must not start an SMS retry worker');
    assert(!monitoringUi.includes('SMS Service'), 'monitoring UI must not show SMS Service health');
    assert(!monitoringUi.includes('SMS sent'), 'monitoring UI must not show SMS sent metrics');
    assert(!adminData.includes('settings/test-sms'), 'admin data client must not call test-sms');
    assert(history.includes('Historical SMS'), 'history may retain STEP 5 SMS records as historical only');
    assert(order.includes('.catch((engineError)'), 'order create must not fail when notifications fail');
    assert(dpo.includes('dpo.payment.notify_failed'), 'payment remains intact if notify throws');
    assert(!server.includes('startNotificationSmsRetryWorker'), 'server must not start Admin SMS retry');
    assert(!automation.includes('startNotificationSmsRetryWorker'), 'automation must not start Admin SMS retry');
    assert(envExample.includes('AFRICASTALKING_API_KEY'), 'env example must still document Africa\'s Talking for OTP/customer SMS');
    assert(!envExample.includes('ADMIN_SMS_NOTIFICATIONS_ENABLED'), 'env example must not document admin SMS');
    assert(!envExample.includes('ADMIN_ALERT_SMS='), 'env example must not document admin SMS recipients');
    assert(emailService.includes('safeDeliverNotificationEmail'), 'admin notifications must reuse the existing email service');
    assert(!exists('server/services/sms/notification-sms.service.js'), 'admin notification SMS service must be removed');
    assert(!exists('server/config/notification-sms.config.js'), 'admin SMS config must be removed');
    assert(!exists('server/services/sms/sms-templates.js'), 'admin SMS templates must be removed');
    assert(exists('server/utils/sms.js'), 'customer OTP SMS helper must remain');
    assert(exists('server/services/sms/sms-provider.service.js'), 'customer SMS provider must remain');
    assert(exists('server/database/sqlite/migrations/029_notification_sms_deliveries.sql'), 'historical SMS table migration must be retained');
}

function checkCustomerSmsStillWorks() {
    const auth = read('server/controllers/authcontroller.js');
    const customerNotify = read('server/utils/notifications.js');
    assert(auth.includes("require('../utils/sms')") || auth.includes('sendSMS'), 'auth OTP must still be able to send SMS');
    assert(customerNotify.includes('NOTIFY_SMS_ENABLED'), 'customer SMS switch must remain independent of admin notifications');
}

function checkClassificationStillExistsForCustomerSms() {
    const { classifySmsError } = require('../server/services/sms/sms-provider.service');
    const timeout = classifySmsError({ message: 'Connection timed out', code: 'ETIMEDOUT' });
    assert(timeout.retryable === true, 'customer SMS timeouts remain classified');
    const invalid = classifySmsError(new Error('Invalid phone number'), { reason: 'invalid_recipient' });
    assert(invalid.retryable === false, 'invalid customer SMS recipients remain non-retryable');
}

function main() {
    checkSource();
    checkCustomerSmsStillWorks();
    checkClassificationStillExistsForCustomerSms();
    if (failures.length) {
        console.error('Admin email-only notification verification FAILED:');
        failures.forEach((item) => console.error(` - ${item}`));
        process.exit(1);
    }
    console.log('Admin email-only notification verification PASSED.');
    process.exit(0);
}

main();
