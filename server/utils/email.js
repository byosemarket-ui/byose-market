// =============================================================================
// EMAIL SERVICE (legacy transactional helpers)
// =============================================================================
// Customer-facing templates remain here. Transport is delegated to the
// shared email provider service so SMTP credentials stay centralized.
// =============================================================================

const { appLogger } = require('./logger');
const {
    sendViaProvider,
    getProviderStatus,
    isProviderConfigured
} = require('../services/email/email-provider.service');

const EMAIL_TEMPLATES = {
    ORDER_CONFIRMATION: 'order_confirmation',
    ORDER_STATUS_UPDATE: 'order_status_update',
    PASSWORD_RESET: 'password_reset',
    WELCOME: 'welcome',
    LOW_STOCK_ALERT: 'low_stock_alert',
    ADMIN_ALERT: 'admin_alert'
};

function getEmailConfig() {
    const status = getProviderStatus();
    return {
        host: status.host || '',
        port: status.port || 587,
        secure: Boolean(status.secure),
        user: status.userConfigured ? 'configured' : '',
        pass: status.passConfigured ? 'configured' : '',
        fromName: status.fromName || 'BYOSE Market',
        fromAddress: status.fromAddress || ''
    };
}

function isEmailConfigured() {
    return isProviderConfigured();
}

/**
 * Sends a plain-text or HTML email.
 * @param {{ to: string, subject: string, text?: string, html?: string }} options
 * @returns {Promise<{ success: boolean, error?: Error }>}
 */
async function sendEmail(options) {
    const result = await sendViaProvider(options);
    if (result.success) {
        appLogger.info('email.sent', {
            recipient: String(options?.to || '').trim(),
            subject: String(options?.subject || '').trim(),
            provider: result.provider
        });
    }
    return result;
}

function buildOrderConfirmationEmail(order) {
    const orderId = String(order?.orderId || order?.id || '-');
    const customerName = String(order?.customerName || 'Customer');
    const total = Number(order?.totalAmount || order?.totalPrice || 0).toFixed(2);
    const subject = `Order Confirmed — ${orderId}`;
    const text = [
        `Hello ${customerName},`,
        '',
        `Your order ${orderId} has been confirmed. Total: ${total} RWF.`,
        '',
        'Thank you for shopping with Byose Market.',
        'byosemarket.com'
    ].join('\n');
    return { subject, text };
}

function buildOrderStatusUpdateEmail(order, newStatus) {
    const orderId = String(order?.orderId || order?.id || '-');
    const customerName = String(order?.customerName || 'Customer');
    const subject = `Order Update — ${orderId} is now ${newStatus}`;
    const text = [
        `Hello ${customerName},`,
        '',
        `Your order ${orderId} has been updated to: ${newStatus}.`,
        '',
        'Thank you for shopping with Byose Market.',
        'byosemarket.com'
    ].join('\n');
    return { subject, text };
}

function buildPasswordResetEmail(name, otp) {
    const subject = 'Password Reset — Byose Market';
    const text = [
        `Hello ${String(name || 'Customer')},`,
        '',
        `Your password reset code is: ${otp}`,
        '',
        'This code expires in 10 minutes. If you did not request a reset, ignore this email.',
        'byosemarket.com'
    ].join('\n');
    return { subject, text };
}

function buildWelcomeEmail(name) {
    const subject = 'Welcome to Byose Market!';
    const text = [
        `Hello ${String(name || 'Customer')},`,
        '',
        'Welcome to Byose Market — Rwanda\'s online shop.',
        'Your account is ready. Start shopping at byosemarket.com.',
        '',
        'Thank you for joining us!'
    ].join('\n');
    return { subject, text };
}

function buildLowStockAlertEmail(products) {
    const subject = `Low Stock Alert — ${products.length} product(s) need attention`;
    const lines = products.map((p) => `• ${p.name} (stock: ${p.stock})`);
    const text = ['Low stock alert:', '', ...lines, '', 'byosemarket.com admin panel'].join('\n');
    return { subject, text };
}

module.exports = {
    EMAIL_TEMPLATES,
    sendEmail,
    isEmailConfigured,
    getEmailConfig,
    buildOrderConfirmationEmail,
    buildOrderStatusUpdateEmail,
    buildPasswordResetEmail,
    buildWelcomeEmail,
    buildLowStockAlertEmail
};
