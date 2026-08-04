// =============================================================================
// NOTIFICATION SERVICE
// =============================================================================
// Unified notification orchestrator that routes outbound messages through
// the appropriate channel(s): email, SMS, or both.
//
// Design goals:
//   - Fire-and-forget: callers do not need to await notifications
//   - Channel-independent: adding a new channel (WhatsApp, push) is one import
//   - Configurable: each channel is enabled by its own env var guard
//   - Safe: individual channel failures never crash the caller
//
// Environment variables:
//   NOTIFY_EMAIL_ENABLED   "true" to send emails (requires email.js config)
//   NOTIFY_SMS_ENABLED     "true" to send SMS (requires sms.js config)
//
// Usage:
//   const { notifyOrderConfirmed } = require('./notifications');
//   await notifyOrderConfirmed(order);   // or fire-and-forget without await
// =============================================================================

const { appLogger } = require('./logger');
const { sendSMS } = require('./sms');
const {
    sendEmail,
    buildOrderConfirmationEmail,
    buildOrderStatusUpdateEmail,
    buildPasswordResetEmail,
    buildWelcomeEmail,
    buildLowStockAlertEmail
} = require('./email');

// ---------------------------------------------------------------------------
// CHANNEL FLAGS
// ---------------------------------------------------------------------------

function isEmailEnabled() {
    return String(process.env.NOTIFY_EMAIL_ENABLED || 'false').toLowerCase() === 'true';
}

function isSmsEnabled() {
    return String(process.env.NOTIFY_SMS_ENABLED || 'false').toLowerCase() === 'true';
}

// ---------------------------------------------------------------------------
// INTERNAL DISPATCH HELPERS
// ---------------------------------------------------------------------------

async function dispatchEmail(to, emailPayload) {
    if (!isEmailEnabled() || !to) {
        return { success: false, error: new Error('Email notifications are disabled or no recipient was provided') };
    }

    try {
        return await sendEmail({ to, ...emailPayload });
    } catch (error) {
        appLogger.warn('notification.email_dispatch_failed', { to, error });
        return { success: false, error };
    }
}

async function dispatchSms(to, message) {
    if (!isSmsEnabled() || !to) {
        return { success: false, error: new Error('SMS notifications are disabled or no recipient was provided') };
    }

    try {
        return await sendSMS(to, message);
    } catch (error) {
        appLogger.warn('notification.sms_dispatch_failed', { to, error });
        return { success: false, error };
    }
}

// ---------------------------------------------------------------------------
// PUBLIC NOTIFICATION EVENTS
// ---------------------------------------------------------------------------

/**
 * Notify customer that their order was placed successfully.
 * @param {object} order - Mongoose Order document or plain object.
 */
async function notifyOrderConfirmed(order) {
    const email = String(order?.customerEmail || order?.userEmail || '').trim();
    const phone = String(order?.customerPhone || order?.phoneNumber || '').trim();
    const orderId = String(order?.orderId || order?.id || '');
    const name = String(order?.customerName || 'Customer');
    const total = Number(order?.totalAmount || order?.totalPrice || 0).toFixed(2);

    appLogger.info('notification.order_confirmed', { orderId });

    await Promise.all([
        dispatchEmail(email, buildOrderConfirmationEmail(order)),
        dispatchSms(phone, `Hello ${name}, your order ${orderId} is confirmed. Total: ${total} RWF. byosemarket.com`)
    ]);
}

/**
 * Notify customer when their order status changes.
 * @param {object} order     - Order document.
 * @param {string} newStatus - New status label.
 */
async function notifyOrderStatusChanged(order, newStatus) {
    const email = String(order?.customerEmail || order?.userEmail || '').trim();
    const phone = String(order?.customerPhone || order?.phoneNumber || '').trim();
    const orderId = String(order?.orderId || order?.id || '');
    const name = String(order?.customerName || 'Customer');

    appLogger.info('notification.order_status_changed', { orderId, newStatus });

    await Promise.all([
        dispatchEmail(email, buildOrderStatusUpdateEmail(order, newStatus)),
        dispatchSms(phone, `Hello ${name}, your order ${orderId} is now ${newStatus}. byosemarket.com`)
    ]);
}

/**
 * Send a password reset OTP to the user.
 * @param {{ name: string, email?: string, phone?: string }} user
 * @param {string} otp
 */
async function notifyPasswordReset(user, otp) {
    const email = String(user?.email || '').trim();
    const phone = String(user?.phone || '').trim();
    const name = String(user?.name || 'Customer');

    return Promise.all([
        dispatchEmail(email, buildPasswordResetEmail(name, otp)),
        dispatchSms(phone, `Byose Market: Your password reset code is ${otp}. Expires in 10 minutes.`)
    ]);
}

/**
 * Send a welcome message to a newly registered user.
 * @param {{ name: string, email?: string, phone?: string }} user
 */
async function notifyWelcome(user) {
    const email = String(user?.email || '').trim();
    const phone = String(user?.phone || '').trim();
    const name = String(user?.name || 'Customer');

    await Promise.all([
        dispatchEmail(email, buildWelcomeEmail(name)),
        dispatchSms(phone, `Welcome to Byose Market, ${name}! Shop at byosemarket.com`)
    ]);
}

/**
 * Alert the admin/ops team about low-stock products.
 * @param {Array<{ name: string, stock: number }>} products
 */
async function notifyLowStock(products) {
    if (!Array.isArray(products) || !products.length) {
        return;
    }

    const adminEmail = String(process.env.ADMIN_ALERT_EMAIL || process.env.ADMIN_EMAIL || '').trim();
    if (!adminEmail) {
        appLogger.warn('notification.low_stock_no_admin_email');
        return;
    }

    appLogger.info('notification.low_stock_alert', { count: products.length });
    await dispatchEmail(adminEmail, buildLowStockAlertEmail(products));
}

/**
 * Send a generic admin operational alert by email.
 * @param {string} subject
 * @param {string} body
 */
async function notifyAdminAlert(subject, body) {
    const adminEmail = String(process.env.ADMIN_ALERT_EMAIL || process.env.ADMIN_EMAIL || '').trim();
    if (!adminEmail) {
        return;
    }

    appLogger.info('notification.admin_alert', { subject });
    await dispatchEmail(adminEmail, { subject, text: body });
}

module.exports = {
    notifyOrderConfirmed,
    notifyOrderStatusChanged,
    notifyPasswordReset,
    notifyWelcome,
    notifyLowStock,
    notifyAdminAlert,
    isEmailEnabled,
    isSmsEnabled
};
