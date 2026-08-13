const dpoPaymentService = require('../services/dpopayment.service');
const { createRateLimiter } = require('../middleware/ratelimiter');
const { appLogger } = require('../utils/logger');

function customerSafePaymentMessage(error, statusCode) {
    const code = String(error?.code || '');
    if (code === 'DPO_NOT_USED_FOR_COD') {
        return 'Cash on Delivery does not use online payment.';
    }
    if (code === 'UNSUPPORTED_PAYMENT_METHOD') {
        return 'That payment method is not available. Choose MTN MoMo, Card, or Cash on Delivery.';
    }
    if (code === 'ORDER_NOT_FOUND') {
        return 'We could not find this order.';
    }
    if (code === 'DPO_PAYMENT_RATE_LIMITED' || code === 'RATE_LIMITED') {
        return error?.message || 'Too many payment attempts. Please retry shortly.';
    }
    if (statusCode >= 500 || /^DPO_/.test(code)) {
        return 'Online payment is not available right now. Please try again shortly.';
    }
    const message = String(error?.message || '').trim();
    if (!message || /company\s*token|service type|credential|secret|xml|stack/i.test(message)) {
        return 'Unable to process this payment request. Please try again.';
    }
    return message;
}

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
        code: error?.code || (statusCode >= 500 ? 'DPO_PAYMENT_ERROR' : 'DPO_PAYMENT_VALIDATION_FAILED'),
        message: customerSafePaymentMessage(error, statusCode)
    });
}

function readTokenFromRequest(req) {
    const query = req.query || {};
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    return String(
        query.TransactionToken
        || query.TransToken
        || query.transactionToken
        || query.transToken
        || query.ID
        || body.TransactionToken
        || body.TransToken
        || body.transactionToken
        || body.transToken
        || ''
    ).trim();
}

function readOrderIdFromRequest(req) {
    const query = req.query || {};
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    return String(
        query.orderId
        || query.CompanyRef
        || query.companyRef
        || body.orderId
        || body.CompanyRef
        || body.companyRef
        || ''
    ).trim();
}

exports.getConfig = async (req, res) => {
    try {
        const config = await dpoPaymentService.getPublicConfig();
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, dpo: config });
    } catch (error) {
        return sendError(req, res, error, 'dpo.config_failed');
    }
};

exports.initiate = async (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const orderId = String(body.orderId || body.CompanyRef || '').trim();
        const result = await dpoPaymentService.initiatePayment({ orderId, req });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        return sendError(req, res, error, 'dpo.initiate_failed');
    }
};

exports.verify = async (req, res) => {
    try {
        const orderId = readOrderIdFromRequest(req);
        const transactionToken = readTokenFromRequest(req);
        const result = await dpoPaymentService.verifyAndUpdateOrder({
            orderId,
            transactionToken,
            req
        });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        return sendError(req, res, error, 'dpo.verify_failed');
    }
};

exports.returnFromGateway = async (req, res) => {
    try {
        const orderId = readOrderIdFromRequest(req);
        const transactionToken = readTokenFromRequest(req);
        const result = await dpoPaymentService.verifyAndUpdateOrder({
            orderId,
            transactionToken,
            req
        });
        res.setHeader('Cache-Control', 'no-store');
        return res.redirect(302, result.redirectUrl);
    } catch (error) {
        (req.log || appLogger).warn('dpo.return_failed', {
            code: error?.code || '',
            message: error?.message || ''
        });
        const orderId = readOrderIdFromRequest(req);
        const status = error?.code === 'ORDER_NOT_FOUND' ? 'invalid' : 'failed';
        const fallback = `/orders/payment-result.html?status=${encodeURIComponent(status)}&orderId=${encodeURIComponent(orderId || '')}`;
        return res.redirect(302, fallback);
    }
};

exports.backFromGateway = async (req, res) => {
    try {
        const orderId = readOrderIdFromRequest(req);
        const result = await dpoPaymentService.verifyAndUpdateOrder({
            orderId,
            markCancelled: true,
            req
        });
        res.setHeader('Cache-Control', 'no-store');
        return res.redirect(302, result.redirectUrl);
    } catch (error) {
        (req.log || appLogger).warn('dpo.back_failed', {
            code: error?.code || '',
            message: error?.message || ''
        });
        const orderId = readOrderIdFromRequest(req);
        const fallback = `/orders/payment-result.html?status=cancelled&orderId=${encodeURIComponent(orderId || '')}`;
        return res.redirect(302, fallback);
    }
};

/**
 * Server notification / customer-agnostic return.
 * Always verifies via the existing DPO verifyToken path — never trusts the
 * incoming request as proof of payment. Browser GETs redirect; other callers
 * receive 200 so a DPO push is acknowledged after verification.
 */
exports.callbackFromGateway = async (req, res) => {
    const accept = String(req.headers.accept || '');
    const wantsRedirect = req.method === 'GET' && accept.includes('text/html');

    try {
        const orderId = readOrderIdFromRequest(req);
        const transactionToken = readTokenFromRequest(req);
        const result = await dpoPaymentService.verifyAndUpdateOrder({
            orderId,
            transactionToken,
            req
        });
        res.setHeader('Cache-Control', 'no-store');
        if (wantsRedirect && result.redirectUrl) {
            return res.redirect(302, result.redirectUrl);
        }
        return res.status(200).json({
            success: true,
            outcome: result.outcome,
            paymentStatus: result.paymentStatus,
            orderId: result.payment?.orderId || orderId
        });
    } catch (error) {
        (req.log || appLogger).warn('dpo.callback_failed', {
            code: error?.code || '',
            message: error?.message || ''
        });
        if (wantsRedirect) {
            const orderId = readOrderIdFromRequest(req);
            const status = error?.code === 'ORDER_NOT_FOUND' ? 'invalid' : 'failed';
            const fallback = `/orders/payment-result.html?status=${encodeURIComponent(status)}&orderId=${encodeURIComponent(orderId || '')}`;
            return res.redirect(302, fallback);
        }
        return sendError(req, res, error, 'dpo.callback_failed');
    }
};

exports.mutationLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 40,
    code: 'DPO_PAYMENT_RATE_LIMITED',
    message: 'Too many payment attempts. Please retry shortly.'
});
