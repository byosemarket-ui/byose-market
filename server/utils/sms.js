// ===============================
// SMS SERVICE (AFRICA'S TALKING)
// Thin wrapper used by auth OTP and customer notifications.
// Admin order notifications are email-only and do not use this module.
// ===============================

const { sendViaProvider, getProviderStatus } = require('../services/sms/sms-provider.service');

async function sendSMS(to, message) {
    const result = await sendViaProvider({ to, message });
    return {
        success: Boolean(result.success),
        error: result.success ? undefined : (result.error || new Error(result.reason || 'SMS failed')),
        messageId: result.messageId || null,
        provider: result.provider
    };
}

module.exports = {
    sendSMS,
    getSmsStatus: getProviderStatus
};
