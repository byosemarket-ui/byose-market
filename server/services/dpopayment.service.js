/**
 * DPO Pay TEST checkout orchestration (STEP 2).
 * Flow: Create Token → Payment URL → Customer Payment → Verify Token → Order Update
 * LIVE mode is intentionally not supported yet.
 */

const orderDataService = require('./orderdataservice');
const paymentSettingsService = require('./paymentsettings.service');
const dpoClient = require('../payments/dpo/client');
const config = require('../config/env');
const { appLogger } = require('../utils/logger');

const PROVIDER_ID = 'dpo';
const FORCED_MODE = 'test';

function normalizeText(value, fallback = '') {
    const text = String(value == null ? '' : value).trim();
    return text || fallback;
}

function ValidationError(message, details = {}, code = 'DPO_PAYMENT_VALIDATION_FAILED', statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    error.details = details;
    return error;
}

function resolveAppBaseUrl(req) {
    const configured = normalizeText(config.appBaseUrl || process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL);
    if (configured) return configured.replace(/\/+$/, '');
    if (req) {
        const host = normalizeText(req.get?.('x-forwarded-host') || req.get?.('host'));
        if (host) {
            const proto = normalizeText(req.get?.('x-forwarded-proto') || req.protocol || 'http') || 'http';
            return `${proto}://${host}`.replace(/\/+$/, '');
        }
    }
    return 'http://127.0.0.1:5000';
}

function buildFrontendUrl(appBase, pathWithQuery) {
    const base = String(appBase || '').replace(/\/+$/, '');
    const path = String(pathWithQuery || '').startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
    return `${base}${path}`;
}

async function loadTestRuntime() {
    const settings = await paymentSettingsService.getPaymentConfig();
    if (settings.mode === 'live') {
        // STEP 2: refuse LIVE intentionally.
        throw ValidationError(
            'LIVE DPO payments are not enabled yet. Switch Payment Settings to TEST mode.',
            { mode: 'LIVE is not available in STEP 2.' },
            'DPO_LIVE_NOT_ENABLED',
            503
        );
    }

    const runtime = await paymentSettingsService.getRuntimePaymentCredentials({
        providerId: PROVIDER_ID,
        mode: FORCED_MODE
    });

    if (!runtime || !runtime.enabled) {
        throw ValidationError(
            'DPO Pay TEST is not enabled. Configure and enable it in Admin → Payment Settings.',
            { enabled: false },
            'DPO_NOT_ENABLED',
            503
        );
    }

    const companyToken = normalizeText(runtime.secrets?.companyToken);
    const serviceType = normalizeText(runtime.secrets?.serviceType);
    if (!companyToken || !serviceType) {
        throw ValidationError(
            'DPO TEST credentials are missing. Save Company Token and Service Type in Payment Settings.',
            { companyToken: Boolean(companyToken), serviceType: Boolean(serviceType) },
            'DPO_CREDENTIALS_MISSING',
            503
        );
    }

    return {
        ...runtime,
        mode: FORCED_MODE,
        secrets: { companyToken, serviceType },
        endpoints: {
            apiBaseUrl: normalizeText(runtime.endpoints?.apiBaseUrl, dpoClient.DEFAULT_API_BASE),
            // STEP 2 Option A requires payv3.php?ID=token (upgrade legacy payv2 defaults).
            paymentPageUrl: (() => {
                const configured = normalizeText(runtime.endpoints?.paymentPageUrl, dpoClient.DEFAULT_PAYMENT_PAGE);
                if (/payv2\.php/i.test(configured)) {
                    return dpoClient.DEFAULT_PAYMENT_PAGE;
                }
                return configured || dpoClient.DEFAULT_PAYMENT_PAGE;
            })()
        }
    };
}

function applyGatewayPaymentUpdate(order, {
    paymentStatus,
    paymentStatusLabel,
    gateway = {},
    historyLabel
} = {}) {
    const previousPaymentStatus = normalizeText(order.paymentStatus || order.payment?.status);
    const nextStatus = normalizeText(paymentStatus, 'awaiting_payment').toLowerCase();
    const label = normalizeText(paymentStatusLabel)
        || (nextStatus === 'paid' ? 'Paid'
            : nextStatus === 'failed' ? 'Failed'
                : nextStatus === 'cancelled' ? 'Cancelled'
                    : nextStatus === 'authorized' ? 'Authorized'
                        : 'Awaiting Payment');

    order.paymentStatus = nextStatus;
    order.paymentStatusLabel = label;
    order.paymentMethod = normalizeText(order.paymentMethod, PROVIDER_ID) || PROVIDER_ID;
    order.paymentMethodLabel = normalizeText(order.paymentMethodLabel, 'DPO Pay') || 'DPO Pay';
    order.paymentType = 'pay_now';

    const previousPayment = order.payment && typeof order.payment === 'object' ? order.payment : {};
    const previousGateway = previousPayment.gateway && typeof previousPayment.gateway === 'object'
        ? previousPayment.gateway
        : {};
    const previousTx = previousPayment.transaction && typeof previousPayment.transaction === 'object'
        ? previousPayment.transaction
        : {};

    order.payment = {
        ...previousPayment,
        type: 'pay_now',
        method: PROVIDER_ID,
        methodLabel: 'DPO Pay',
        status: nextStatus,
        statusLabel: label,
        gateway: {
            ...previousGateway,
            provider: PROVIDER_ID,
            mode: FORCED_MODE,
            ...gateway,
            updatedAt: new Date().toISOString()
        },
        transaction: {
            ...previousTx,
            state: nextStatus,
            provider: PROVIDER_ID,
            reference: gateway.transRef || previousTx.reference || '',
            tokenHint: gateway.transToken
                ? `••••${String(gateway.transToken).slice(-4)}`
                : previousTx.tokenHint || ''
        }
    };

    const paymentReference = normalizeText(
        gateway.transRef
        || order.payment.transaction.reference
        || order.paymentReference
        || order.transactionReference
        || order.transactionId
    );
    if (paymentReference) {
        order.paymentReference = paymentReference;
        order.transactionReference = paymentReference;
        order.transactionId = paymentReference;
        order.payment.reference = paymentReference;
    }

    const history = Array.isArray(order.statusHistory) ? order.statusHistory.slice() : [];
    history.push({
        status: nextStatus,
        label: historyLabel || `DPO payment ${label}`,
        timestamp: new Date().toISOString(),
        actor: 'dpo'
    });
    order.statusHistory = history.slice(-40);

    return { order, previousPaymentStatus };
}

function sanitizePublicGateway(order) {
    const gateway = order?.payment?.gateway && typeof order.payment.gateway === 'object'
        ? order.payment.gateway
        : {};
    return {
        provider: PROVIDER_ID,
        mode: FORCED_MODE,
        companyRef: normalizeText(gateway.companyRef || order?.orderId || order?.id),
        hasTransToken: Boolean(gateway.transToken),
        transTokenHint: gateway.transToken ? `••••${String(gateway.transToken).slice(-4)}` : '',
        transRef: normalizeText(gateway.transRef),
        lastResult: normalizeText(gateway.lastResult),
        lastOutcome: normalizeText(gateway.lastOutcome),
        verifiedAt: gateway.verifiedAt || null
    };
}

function toPublicPaymentView(order, extra = {}) {
    return {
        orderId: normalizeText(order.orderId || order.id),
        paymentStatus: normalizeText(order.paymentStatus),
        paymentStatusLabel: normalizeText(order.paymentStatusLabel),
        paymentMethod: normalizeText(order.paymentMethod),
        paymentMethodLabel: normalizeText(order.paymentMethodLabel),
        total: Number(order.totalAmount ?? order.total) || 0,
        currency: normalizeText(order.currency, 'RWF') || 'RWF',
        gateway: sanitizePublicGateway(order),
        ...extra
    };
}

async function getPublicConfig() {
    const payment = await paymentSettingsService.getPublicPaymentSettings();
    const settings = await paymentSettingsService.getPaymentConfig();
    const runtimeReady = Boolean(
        settings.mode !== 'live'
        && payment.enabled
        && payment.provider?.id === PROVIDER_ID
    );

    // Confirm TEST credentials exist without exposing them.
    let credentialsReady = false;
    try {
        const runtime = await paymentSettingsService.getRuntimePaymentCredentials({
            providerId: PROVIDER_ID,
            mode: FORCED_MODE
        });
        credentialsReady = Boolean(
            runtime?.enabled
            && runtime.secrets?.companyToken
            && runtime.secrets?.serviceType
        );
    } catch (_error) {
        credentialsReady = false;
    }

    return {
        provider: PROVIDER_ID,
        mode: FORCED_MODE,
        enabled: Boolean(runtimeReady && credentialsReady),
        label: payment.provider?.label || 'DPO Pay',
        liveAvailable: false
    };
}

async function initiatePayment({ orderId, req } = {}) {
    const id = normalizeText(orderId);
    if (!id) {
        throw ValidationError('Order ID is required.', { orderId: 'Required' });
    }

    const runtime = await loadTestRuntime();
    const order = await orderDataService.findOrderByIdentifier(id);
    if (!order) {
        throw ValidationError('Order not found.', { orderId: id }, 'ORDER_NOT_FOUND', 404);
    }

    const currentStatus = normalizeText(order.paymentStatus || order.payment?.status).toLowerCase();
    if (currentStatus === 'paid') {
        const appBase = resolveAppBaseUrl(req);
        return {
            alreadyPaid: true,
            orderId: id,
            paymentUrl: null,
            redirectUrl: buildFrontendUrl(appBase, `/orders/order-success.html?orderId=${encodeURIComponent(id)}`),
            payment: toPublicPaymentView(order, { outcome: 'success' })
        };
    }

    const amount = Number(order.totalAmount ?? order.total);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw ValidationError('Order total is invalid for payment.', { total: amount });
    }

    const appBase = resolveAppBaseUrl(req);
    const redirectUrl = buildFrontendUrl(
        appBase,
        `/api/payments/dpo/return?orderId=${encodeURIComponent(id)}`
    );
    const backUrl = buildFrontendUrl(
        appBase,
        `/api/payments/dpo/back?orderId=${encodeURIComponent(id)}`
    );

    const created = await dpoClient.createToken({
        companyToken: runtime.secrets.companyToken,
        serviceType: runtime.secrets.serviceType,
        apiBaseUrl: runtime.endpoints.apiBaseUrl,
        paymentPageUrl: runtime.endpoints.paymentPageUrl,
        amount,
        currency: normalizeText(order.currency, 'RWF') || 'RWF',
        companyRef: id,
        redirectUrl,
        backUrl,
        customerName: order.customerName || order.customer?.name || 'Customer',
        customerEmail: order.customerEmail || order.customer?.email || '',
        customerPhone: order.customerPhone || order.phoneNumber || order.customer?.phone || '',
        serviceDescription: `BYOSE Market order ${id}`
    });

    const { order: updated, previousPaymentStatus } = applyGatewayPaymentUpdate(order, {
        paymentStatus: 'awaiting_payment',
        paymentStatusLabel: 'Awaiting Payment',
        historyLabel: 'DPO payment token created — awaiting customer payment',
        gateway: {
            companyRef: id,
            transToken: created.transToken,
            transRef: created.transRef || '',
            paymentUrl: created.paymentUrl,
            redirectUrl,
            backUrl,
            lastResult: created.result,
            lastOutcome: 'redirect',
            initiatedAt: new Date().toISOString()
        }
    });

    await orderDataService.saveOrder(updated);

    appLogger.info('dpo.payment.initiated', {
        orderId: id,
        mode: FORCED_MODE,
        previousPaymentStatus,
        hasPaymentUrl: Boolean(created.paymentUrl)
    });

    return {
        alreadyPaid: false,
        orderId: id,
        paymentUrl: created.paymentUrl,
        redirectUrl: created.paymentUrl,
        payment: toPublicPaymentView(updated, { outcome: 'redirect' })
    };
}

async function verifyAndUpdateOrder({
    orderId,
    transactionToken,
    markCancelled = false,
    req
} = {}) {
    const id = normalizeText(orderId);
    if (!id) {
        throw ValidationError('Order ID is required.', { orderId: 'Required' });
    }

    const order = await orderDataService.findOrderByIdentifier(id);
    if (!order) {
        throw ValidationError('Order not found.', { orderId: id }, 'ORDER_NOT_FOUND', 404);
    }

    const existingStatus = normalizeText(order.paymentStatus || order.payment?.status).toLowerCase();
    if (existingStatus === 'paid') {
        return {
            outcome: 'success',
            paymentStatus: 'paid',
            payment: toPublicPaymentView(order, { outcome: 'success' }),
            redirectUrl: buildFrontendUrl(
                resolveAppBaseUrl(req),
                `/orders/order-success.html?orderId=${encodeURIComponent(id)}`
            )
        };
    }

    if (markCancelled) {
        const { order: cancelled, previousPaymentStatus } = applyGatewayPaymentUpdate(order, {
            paymentStatus: 'cancelled',
            paymentStatusLabel: 'Cancelled',
            historyLabel: 'Customer cancelled DPO payment',
            gateway: {
                lastOutcome: 'cancelled',
                lastResult: '904',
                cancelledAt: new Date().toISOString()
            }
        });
        await orderDataService.saveOrder(cancelled);
        await notifyPaymentChange(cancelled, previousPaymentStatus);
        return {
            outcome: 'cancelled',
            paymentStatus: 'cancelled',
            payment: toPublicPaymentView(cancelled, { outcome: 'cancelled' }),
            redirectUrl: buildFrontendUrl(
                resolveAppBaseUrl(req),
                `/orders/payment-result.html?status=cancelled&orderId=${encodeURIComponent(id)}`
            )
        };
    }

    const runtime = await loadTestRuntime();
    const storedToken = normalizeText(order.payment?.gateway?.transToken);
    const token = normalizeText(transactionToken) || storedToken;

    let verified;
    try {
        verified = await dpoClient.verifyToken({
            companyToken: runtime.secrets.companyToken,
            apiBaseUrl: runtime.endpoints.apiBaseUrl,
            transactionToken: token,
            companyRef: id
        });
    } catch (error) {
        if (error?.code === 'DPO_VERIFY_INPUT_MISSING') {
            const { order: invalid, previousPaymentStatus } = applyGatewayPaymentUpdate(order, {
                paymentStatus: 'failed',
                paymentStatusLabel: 'Invalid Token',
                historyLabel: 'DPO verify failed — missing or invalid token',
                gateway: {
                    lastOutcome: 'invalid_token',
                    lastResult: 'invalid',
                    verifiedAt: new Date().toISOString()
                }
            });
            await orderDataService.saveOrder(invalid);
            await notifyPaymentChange(invalid, previousPaymentStatus);
            return {
                outcome: 'invalid_token',
                paymentStatus: 'failed',
                payment: toPublicPaymentView(invalid, { outcome: 'invalid_token' }),
                redirectUrl: buildFrontendUrl(
                    resolveAppBaseUrl(req),
                    `/orders/payment-result.html?status=invalid&orderId=${encodeURIComponent(id)}`
                )
            };
        }
        throw error;
    }

    const { order: updated, previousPaymentStatus } = applyGatewayPaymentUpdate(order, {
        paymentStatus: verified.paymentStatus,
        paymentStatusLabel: verified.label,
        historyLabel: `DPO verify: ${verified.resultExplanation || verified.label}`,
        gateway: {
            companyRef: id,
            transToken: token || verified.transToken || storedToken,
            transRef: verified.transRef || order.payment?.gateway?.transRef || '',
            lastResult: verified.result,
            lastOutcome: verified.outcome,
            lastExplanation: verified.resultExplanation || '',
            transactionAmount: verified.transactionAmount || '',
            transactionCurrency: verified.transactionCurrency || '',
            transactionApproval: verified.transactionApproval || '',
            verifiedAt: new Date().toISOString()
        }
    });

    // If still pending (not paid yet), keep awaiting_payment for customer retry.
    if (verified.outcome === 'pending' && updated.paymentStatus !== 'paid') {
        updated.paymentStatus = 'awaiting_payment';
        updated.paymentStatusLabel = 'Awaiting Payment';
        updated.payment.status = 'awaiting_payment';
        updated.payment.statusLabel = 'Awaiting Payment';
    }

    await orderDataService.saveOrder(updated);
    await notifyPaymentChange(updated, previousPaymentStatus);

    const appBase = resolveAppBaseUrl(req);
    let redirectPath = `/orders/payment-result.html?status=failed&orderId=${encodeURIComponent(id)}`;
    if (verified.outcome === 'success') {
        redirectPath = `/orders/order-success.html?orderId=${encodeURIComponent(id)}`;
    } else if (verified.outcome === 'cancelled') {
        redirectPath = `/orders/payment-result.html?status=cancelled&orderId=${encodeURIComponent(id)}`;
    } else if (verified.outcome === 'invalid_token') {
        redirectPath = `/orders/payment-result.html?status=invalid&orderId=${encodeURIComponent(id)}`;
    } else if (verified.outcome === 'pending') {
        redirectPath = `/orders/payment-result.html?status=pending&orderId=${encodeURIComponent(id)}`;
    }

    return {
        outcome: verified.outcome,
        paymentStatus: updated.paymentStatus,
        result: verified.result,
        resultExplanation: verified.resultExplanation,
        payment: toPublicPaymentView(updated, { outcome: verified.outcome }),
        redirectUrl: buildFrontendUrl(appBase, redirectPath)
    };
}

async function notifyPaymentChange(order, previousPaymentStatus) {
    try {
        const notificationEngine = require('./notification-engine.service');
        await notificationEngine.notifyOrderStatusChanged(order, order.status || order.orderStatus || '', {
            previousPaymentStatus
        });
    } catch (error) {
        appLogger.warn('dpo.payment.notify_failed', {
            orderId: order?.orderId || order?.id || '',
            message: error?.message || 'notify failed'
        });
    }
}

module.exports = {
    FORCED_MODE,
    PROVIDER_ID,
    getPublicConfig,
    initiatePayment,
    loadTestRuntime,
    toPublicPaymentView,
    verifyAndUpdateOrder
};
