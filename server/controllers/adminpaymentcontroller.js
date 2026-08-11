const paymentSettingsService = require('../services/paymentsettings.service');
const adminSecurityService = require('../services/adminsecurityservice');
const { createRateLimiter } = require('../middleware/ratelimiter');
const { appLogger } = require('../utils/logger');

function sendError(req, res, error, eventName) {
    const statusCode = Number(error?.statusCode || 500) || 500;
    if (statusCode >= 500) {
        (req.log || appLogger).error(eventName, { error });
    } else {
        (req.log || appLogger).warn(eventName, {
            code: error?.code || '',
            message: error?.message || '',
            details: error?.details || null
        });
    }

    return res.status(statusCode).json({
        success: false,
        code: error?.code || (statusCode >= 500 ? 'ADMIN_PAYMENT_ERROR' : 'PAYMENT_VALIDATION_FAILED'),
        message: error?.message || 'Unable to process payment settings request',
        details: error?.details || undefined
    });
}

async function recordAudit(req, summary, meta = {}, eventType = 'payment_settings_updated') {
    try {
        await adminSecurityService.recordSecurityEvent(
            { id: req.admin?.id, email: req.admin?.email },
            {
                eventType,
                summary,
                meta,
                ip: adminSecurityService.buildRequestContext(req).ip,
                userAgent: adminSecurityService.buildRequestContext(req).userAgent
            }
        );
    } catch (_error) {
        // non-blocking
    }

    try {
        const { getRepositoryBundle } = require('../repositories');
        const repos = getRepositoryBundle();
        await repos.adminProfile.recordActivity({
            adminPublicId: String(req.admin?.id || ''),
            adminEmail: String(req.admin?.email || ''),
            eventType,
            category: 'settings',
            summary,
            meta,
            ip: adminSecurityService.buildRequestContext(req).ip,
            userAgent: adminSecurityService.buildRequestContext(req).userAgent
        });
    } catch (_error) {
        // non-blocking
    }
}

function sanitizeAuditMeta(payment) {
    return {
        enabled: Boolean(payment?.enabled),
        activeProvider: String(payment?.activeProvider || ''),
        mode: String(payment?.mode || ''),
        ready: Boolean(payment?.ready),
        statusCode: String(payment?.statusSummary?.code || payment?.connection?.code || '')
    };
}

function cleanCredentialPayload(payload) {
    if (!payload.credentials || typeof payload.credentials !== 'object') {
        return payload;
    }
    const cleaned = {};
    ['test', 'live'].forEach((mode) => {
        const modeBody = payload.credentials[mode];
        if (!modeBody || typeof modeBody !== 'object') return;
        const next = {};
        Object.entries(modeBody).forEach(([key, value]) => {
            if (typeof value === 'string' || typeof value === 'number') {
                next[key] = String(value);
            }
        });
        if (Object.keys(next).length) {
            cleaned[mode] = next;
        }
    });
    payload.credentials = cleaned;
    return payload;
}

exports.getPayment = async (req, res) => {
    try {
        const payment = await paymentSettingsService.getAdminPaymentSettings();
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, payment });
    } catch (error) {
        return sendError(req, res, error, 'admin.payment.fetch_failed');
    }
};

exports.getActivity = async (req, res) => {
    try {
        const limit = Number(req.query?.limit || 12);
        const [activity, activityStats] = await Promise.all([
            paymentSettingsService.getRecentPaymentActivity({ limit }),
            paymentSettingsService.getPaymentActivityStats()
        ]);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, activity, activityStats });
    } catch (error) {
        return sendError(req, res, error, 'admin.payment.activity_failed');
    }
};

exports.updatePayment = async (req, res) => {
    try {
        const payload = cleanCredentialPayload(req.body && typeof req.body === 'object' ? { ...req.body } : {});
        const payment = await paymentSettingsService.updatePaymentSettings(payload, {
            id: req.admin?.id,
            email: req.admin?.email
        });

        await recordAudit(req, 'Payment settings updated', sanitizeAuditMeta(payment));
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            message: 'Payment settings saved successfully',
            payment
        });
    } catch (error) {
        return sendError(req, res, error, 'admin.payment.update_failed');
    }
};

exports.testPayment = async (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const result = await paymentSettingsService.testPaymentConfiguration(
            { id: req.admin?.id, email: req.admin?.email },
            { providerId: body.providerId }
        );

        await recordAudit(
            req,
            result.test?.success ? 'Payment TEST connection succeeded' : 'Payment TEST connection failed',
            {
                success: Boolean(result.test?.success),
                providerId: result.test?.providerId || '',
                mode: 'test',
                resultCode: result.test?.resultCode || ''
            },
            'payment_connection_tested'
        );

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            message: result.test?.success
                ? 'TEST connection succeeded. Credentials were accepted.'
                : 'TEST connection failed. Check credentials and try again.',
            test: result.test,
            payment: result.payment
        });
    } catch (error) {
        return sendError(req, res, error, 'admin.payment.test_failed');
    }
};

exports.paymentMutationLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 40,
    code: 'ADMIN_PAYMENT_RATE_LIMITED',
    message: 'Too many payment settings updates. Please retry shortly.'
});

exports.paymentTestLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 12,
    code: 'ADMIN_PAYMENT_TEST_RATE_LIMITED',
    message: 'Too many payment connection tests. Please retry shortly.'
});
