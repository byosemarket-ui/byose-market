// ===============================
// SMS SERVICE (AFRICA'S TALKING)
// ===============================

const { appLogger } = require('./logger');

function getSmsClient() {
    const apiKey = String(process.env.AFRICASTALKING_API_KEY || '').trim();
    const username = String(process.env.AFRICASTALKING_USERNAME || 'sandbox').trim();

    if (!apiKey) {
        return null;
    }

    return require('africastalking')({
        apiKey,
        username
    }).SMS;
}

// ===============================
// SEND SMS FUNCTION
// ===============================
async function sendSMS(to, message) {

    const sms = getSmsClient();
    if (!sms) {
        appLogger.warn('sms.not_configured', { recipient: String(to || '').trim() });
        return {
            success: false,
            error: new Error('SMS service is not configured')
        };
    }

    try {
        const response = await sms.send({
            to: [to],
            message: message
        });

        appLogger.info('sms.sent', {
            recipient: String(to || '').trim(),
            messageCount: Array.isArray(response?.SMSMessageData?.Recipients)
                ? response.SMSMessageData.Recipients.length
                : 0
        });

        return { success: true };

    } catch (error) {
        appLogger.error('sms.send_failed', {
            recipient: String(to || '').trim(),
            error
        });

        return { success: false, error };
    }
}

// ===============================
// EXPORT
// ===============================
module.exports = {
    sendSMS
};