// =============================================================================
// EMAIL SERVICE
// =============================================================================
// Ready-to-wire email sending utility. Requires the `nodemailer` npm package
// and the following environment variables to be configured:
//
//   EMAIL_HOST         SMTP host (e.g. smtp.gmail.com, smtp.sendgrid.net)
//   EMAIL_PORT         SMTP port (465 for TLS, 587 for STARTTLS)
//   EMAIL_SECURE       "true" for port 465, "false" for 587
//   EMAIL_USER         SMTP username / sender address
//   EMAIL_PASS         SMTP password or app password
//   EMAIL_FROM_NAME    Display name (e.g. "Byose Market")
//   EMAIL_FROM_ADDRESS Sender address (defaults to EMAIL_USER)
//
// When EMAIL_HOST is not configured the service logs a warning and returns
// { success: false } without throwing — safe to call unconditionally.
//
// To enable: npm install nodemailer, then set the env vars above.
// =============================================================================

const { appLogger } = require('./logger');

const EMAIL_TEMPLATES = {
    // Sent to the customer after a successful order placement.
    ORDER_CONFIRMATION: 'order_confirmation',
    // Sent when the order status changes (shipped, delivered, etc.).
    ORDER_STATUS_UPDATE: 'order_status_update',
    // Password reset OTP email.
    PASSWORD_RESET: 'password_reset',
    // Welcome email for new registrations.
    WELCOME: 'welcome',
    // Low-stock alert for the operations team.
    LOW_STOCK_ALERT: 'low_stock_alert',
    // Generic operational alert for the admin team.
    ADMIN_ALERT: 'admin_alert'
};

function getEmailConfig() {
    return {
        host: String(process.env.EMAIL_HOST || '').trim(),
        port: Number(process.env.EMAIL_PORT || 587),
        secure: String(process.env.EMAIL_SECURE || 'false').toLowerCase() === 'true',
        user: String(process.env.EMAIL_USER || '').trim(),
        pass: String(process.env.EMAIL_PASS || '').trim(),
        fromName: String(process.env.EMAIL_FROM_NAME || 'Byose Market').trim(),
        fromAddress: String(process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER || '').trim()
    };
}

function isEmailConfigured() {
    const config = getEmailConfig();
    return Boolean(config.host && config.user && config.pass);
}

function getTransporter() {
    if (!isEmailConfigured()) {
        return null;
    }

    try {
        const nodemailer = require('nodemailer');
        const config = getEmailConfig();
        return nodemailer.createTransporter({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: { user: config.user, pass: config.pass },
            pool: true,
            maxConnections: 5,
            maxMessages: 100
        });
    } catch (error) {
        appLogger.warn('email.transporter_init_failed', { error });
        return null;
    }
}

// Lazily created — one transporter reused across calls.
let _transporter = null;

function getOrCreateTransporter() {
    if (!_transporter) {
        _transporter = getTransporter();
    }
    return _transporter;
}

/**
 * Sends a plain-text or HTML email.
 *
 * @param {{ to: string, subject: string, text?: string, html?: string }} options
 * @returns {Promise<{ success: boolean, error?: Error }>}
 */
async function sendEmail(options) {
    const to = String(options?.to || '').trim();
    const subject = String(options?.subject || '').trim();
    const text = String(options?.text || '').trim();
    const html = String(options?.html || '').trim();

    if (!to || !subject || (!text && !html)) {
        appLogger.warn('email.send_skipped', { reason: 'missing_required_fields', to });
        return { success: false, error: new Error('Missing required email fields') };
    }

    const transporter = getOrCreateTransporter();
    if (!transporter) {
        appLogger.warn('email.not_configured', { recipient: to });
        return { success: false, error: new Error('Email service is not configured') };
    }

    const config = getEmailConfig();
    const from = `"${config.fromName}" <${config.fromAddress}>`;

    try {
        await transporter.sendMail({ from, to, subject, text: text || undefined, html: html || undefined });
        appLogger.info('email.sent', { recipient: to, subject });
        return { success: true };
    } catch (error) {
        appLogger.error('email.send_failed', { recipient: to, subject, error });
        // Reset transporter so next call retries with a fresh connection.
        _transporter = null;
        return { success: false, error };
    }
}

// ---------------------------------------------------------------------------
// TEMPLATE BUILDERS
// ---------------------------------------------------------------------------
// Each builder returns { subject, html, text } ready to pass to sendEmail().
// Extend these to use a proper template engine (e.g. handlebars, mjml) when
// email design maturity requires it.
// ---------------------------------------------------------------------------

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
    buildOrderConfirmationEmail,
    buildOrderStatusUpdateEmail,
    buildPasswordResetEmail,
    buildWelcomeEmail,
    buildLowStockAlertEmail
};
