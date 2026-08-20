/**
 * DPO Pay checkout orchestration.
 * Flow: Create Token → Payment URL → Customer Payment → Verify Token → Order Update
 * Configuration (Company Token, Service Type, environment) comes from the DPO
 * config resolver. The same service can run TEST or LIVE; the resolver selects
 * the active environment from Admin Operating Mode. LIVE never falls back to TEST.
 */

const orderDataService = require('./orderdataservice');
const dpoClient = require('../payments/dpo/client');
const dpoConfig = require('../payments/dpo/config');
const config = require('../config/env');
const { appLogger } = require('../utils/logger');
const { isSettledPaidStatus } = require('../payments/payment-status');
const { isCodPaymentMethod, storefrontPaymentMethodLabel } = require('../payments/storefront-methods');
const { LIVE_SERVICE_TYPE_ID, TEST_SERVICE_TYPE_ID } = require('../payments/providers/dpo.provider');

const PROVIDER_ID = dpoConfig.PROVIDER_ID;
const TOKEN_REUSE_MAX_MS = 20 * 60 * 60 * 1000;
const initiateLocks = new Map();
const verifyLocks = new Map();

function normalizeText(value, fallback = '') {
    const text = String(value == null ? '' : value).trim();
    return text || fallback;
}

function parseMoney(value) {
    const parsed = Number(String(value == null ? '' : value).replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : NaN;
}

function ValidationError(message, details = {}, code = 'DPO_PAYMENT_VALIDATION_FAILED', statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    error.details = details;
    return error;
}

function orderPaymentMethod(order) {
    return normalizeText(order?.paymentMethod || order?.payment?.method).toLowerCase();
}

function assertOrderEligibleForDpo(order) {
    const orderMethod = orderPaymentMethod(order);
    if (isCodPaymentMethod(orderMethod) || order?.paymentType === 'cod' || order?.payment?.type === 'cod') {
        throw ValidationError(
            'Cash on Delivery does not use online payment.',
            { paymentMethod: orderMethod || 'cod' },
            'DPO_NOT_USED_FOR_COD',
            400
        );
    }
    if (orderMethod === 'airtel' || orderMethod === 'bank') {
        throw ValidationError(
            'That payment method is no longer available. Please try Online Payment or Cash on Delivery.',
            { paymentMethod: orderMethod },
            'UNSUPPORTED_PAYMENT_METHOD',
            400
        );
    }
}

function assertVerifiedPaymentMatchesOrder(order, verified, tokenUsed) {
    const orderId = normalizeText(order?.orderId || order?.id);
    const expectedAmount = parseMoney(order?.totalAmount ?? order?.total);
    const expectedCurrency = normalizeText(order?.currency, 'RWF').toUpperCase() || 'RWF';
    const dpoAmountRaw = normalizeText(verified?.transactionAmount);
    const dpoCurrency = normalizeText(verified?.transactionCurrency).toUpperCase();
    const dpoCompanyRef = normalizeText(verified?.companyRef);
    const storedToken = normalizeText(order?.payment?.gateway?.transToken);
    const usedToken = normalizeText(tokenUsed);

    if (dpoCompanyRef && dpoCompanyRef !== orderId) {
        return {
            ok: false,
            code: 'DPO_COMPANY_REF_MISMATCH',
            message: 'DPO payment reference does not match this order.'
        };
    }

    if (!dpoCompanyRef && (!storedToken || !usedToken || storedToken !== usedToken)) {
        return {
            ok: false,
            code: 'DPO_COMPANY_REF_MISSING',
            message: 'DPO payment reference does not match this order.'
        };
    }

    if (storedToken && usedToken && storedToken !== usedToken) {
        return {
            ok: false,
            code: 'DPO_TOKEN_MISMATCH',
            message: 'DPO transaction token does not match this order.'
        };
    }

    if (dpoCurrency && dpoCurrency !== expectedCurrency) {
        return {
            ok: false,
            code: 'DPO_CURRENCY_MISMATCH',
            message: 'DPO payment currency does not match this order.'
        };
    }

    if (dpoAmountRaw) {
        const dpoAmount = parseMoney(dpoAmountRaw);
        if (!Number.isFinite(expectedAmount) || expectedAmount <= 0 || !Number.isFinite(dpoAmount)
            || Math.abs(expectedAmount - dpoAmount) > 0.51) {
            return {
                ok: false,
                code: 'DPO_AMOUNT_MISMATCH',
                message: 'DPO payment amount does not match this order.'
            };
        }
    }

    return { ok: true };
}

function assertTrustedOrderAmount(order) {
    const items = Array.isArray(order?.items) && order.items.length
        ? order.items
        : (Array.isArray(order?.products) ? order.products : []);
    const subtotal = parseMoney(order?.subtotal);
    const deliveryFee = parseMoney(order?.deliveryFee ?? order?.shippingFee);
    const couponDiscount = Math.max(0, parseMoney(order?.couponDiscount) || 0);
    const codFee = Math.max(0, parseMoney(order?.codFee) || 0);
    const storedTotal = parseMoney(order?.totalAmount ?? order?.total);
    const currency = normalizeText(order?.currency, 'RWF').toUpperCase() || 'RWF';

    if (!Number.isFinite(storedTotal) || storedTotal <= 0) {
        throw ValidationError('Order total is invalid for payment.', { total: storedTotal }, 'DPO_INVALID_AMOUNT', 400);
    }
    if (!Number.isFinite(deliveryFee) || deliveryFee < 0) {
        throw ValidationError('Delivery fee could not be verified.', { deliveryFee }, 'DPO_INVALID_AMOUNT', 400);
    }
    if (currency !== 'RWF') {
        throw ValidationError('Unsupported payment currency.', { currency }, 'DPO_CURRENCY_MISMATCH', 400);
    }

    let computedSubtotal = Number.isFinite(subtotal) ? subtotal : NaN;
    if (items.length) {
        computedSubtotal = items.reduce((sum, item) => {
            const qty = Number(item?.quantity ?? item?.qty);
            const price = Number(item?.price);
            if (!Number.isFinite(qty) || qty < 1 || !Number.isFinite(price) || price < 0) {
                throw ValidationError(
                    'Order items are invalid for payment.',
                    { productId: item?.productId || item?.id || '' },
                    'DPO_INVALID_ORDER_ITEMS',
                    400
                );
            }
            return sum + (price * qty);
        }, 0);
        if (Number.isFinite(subtotal) && Math.abs(computedSubtotal - subtotal) > 0.51) {
            throw ValidationError(
                'Order amount could not be verified.',
                { lineTotal: computedSubtotal, subtotal },
                'DPO_AMOUNT_MISMATCH',
                400
            );
        }
    }
    if (!Number.isFinite(computedSubtotal)) {
        throw ValidationError('Order total is invalid for payment.', { subtotal }, 'DPO_INVALID_AMOUNT', 400);
    }

    const expectedTotal = Math.max(0, computedSubtotal - couponDiscount) + deliveryFee + codFee;
    if (Math.abs(expectedTotal - storedTotal) > 0.51) {
        throw ValidationError(
            'Order amount could not be verified.',
            { expectedTotal, storedTotal },
            'DPO_AMOUNT_MISMATCH',
            400
        );
    }

    return storedTotal;
}

function applyPaidOrderStatus(order) {
    if (isCodPaymentMethod(orderPaymentMethod(order))) return;
    const current = normalizeText(order.orderStatus || order.status).toLowerCase();
    const keep = [
        'processing', 'packed', 'shipped', 'delivered',
        'completed', 'complete', 'cancelled', 'canceled', 'returned'
    ];
    if (keep.some((status) => current === status || current.includes(status))) return;
    order.orderStatus = 'processing';
    order.status = 'Processing';
}

function isUncertainVerifyError(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    return code === 'DPO_VERIFY_UNAVAILABLE'
        || code === 'DPO_API_TIMEOUT'
        || /timed out|timeout|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(`${code} ${message}`);
}

async function withOrderLock(map, id, fn) {
    while (map.has(id)) {
        try {
            await map.get(id);
        } catch (_error) {
            // Previous lock holder finished (including failure). Continue.
        }
    }
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    map.set(id, gate);
    try {
        return await fn();
    } finally {
        map.delete(id);
        release();
    }
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

async function loadCheckoutRuntime() {
    return dpoConfig.getActiveDpoConfiguration();
}

function storedGatewayMode(order) {
    return normalizeText(order?.payment?.gateway?.mode).toLowerCase();
}

/**
 * Verify and reuse tokens against the environment the payment was created in.
 * Never substitute TEST credentials for a LIVE payment, or the reverse.
 */
async function loadRuntimeForOrder(order) {
    const storedMode = storedGatewayMode(order);
    if (storedMode === 'test' || storedMode === 'live') {
        return dpoConfig.getEnvironmentConfiguration(storedMode);
    }
    return dpoConfig.getActiveDpoConfiguration();
}

function applyGatewayPaymentUpdate(order, {
    paymentStatus,
    paymentStatusLabel,
    gateway = {},
    historyLabel
} = {}) {
    const previousPaymentStatus = normalizeText(order.paymentStatus || order.payment?.status);
    const previousOrderStatus = normalizeText(order.orderStatus || order.status);
    const nextStatus = normalizeText(paymentStatus, 'awaiting_payment').toLowerCase();
    const label = normalizeText(paymentStatusLabel)
        || (nextStatus === 'paid' ? 'Paid'
            : nextStatus === 'failed' ? 'Failed'
                : nextStatus === 'cancelled' ? 'Cancelled'
                    : nextStatus === 'authorized' ? 'Authorized'
                        : 'Awaiting Payment');

    order.paymentStatus = nextStatus;
    order.paymentStatusLabel = label;
    if (isSettledPaidStatus(nextStatus)) {
        applyPaidOrderStatus(order);
    }
    const existingMethod = normalizeText(order.paymentMethod || order.payment?.method).toLowerCase();
    order.paymentMethod = existingMethod || 'card';
    order.paymentMethodLabel = storefrontPaymentMethodLabel(
        order.paymentMethod,
        normalizeText(order.paymentMethodLabel) || 'Card'
    );
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
        method: order.paymentMethod,
        methodLabel: order.paymentMethodLabel,
        status: nextStatus,
        statusLabel: label,
        gateway: {
            ...previousGateway,
            provider: PROVIDER_ID,
            ...gateway,
            mode: normalizeText(gateway.mode) || normalizeText(previousGateway.mode),
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

    return { order, previousPaymentStatus, previousOrderStatus };
}

function sanitizePublicGateway(order) {
    const gateway = order?.payment?.gateway && typeof order.payment.gateway === 'object'
        ? order.payment.gateway
        : {};
    return {
        provider: PROVIDER_ID,
        mode: normalizeText(gateway.mode),
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
        orderStatus: normalizeText(order.orderStatus || order.status),
        total: Number(order.totalAmount ?? order.total) || 0,
        currency: normalizeText(order.currency, 'RWF') || 'RWF',
        gateway: sanitizePublicGateway(order),
        ...extra
    };
}

async function getPublicConfig() {
    return dpoConfig.getPublicCheckoutConfig();
}

async function initiatePayment({ orderId, req } = {}) {
    const id = normalizeText(orderId);
    if (!id) {
        throw ValidationError('Order ID is required.', { orderId: 'Required' });
    }

    const order = await orderDataService.findOrderByIdentifier(id);
    if (!order) {
        throw ValidationError('Order not found.', { orderId: id }, 'ORDER_NOT_FOUND', 404);
    }

    assertOrderEligibleForDpo(order);

    const runtime = await loadCheckoutRuntime();
    if (normalizeText(runtime.secrets?.serviceType) === TEST_SERVICE_TYPE_ID) {
        throw ValidationError(
            'Online payment is temporarily unavailable. Please try again or choose Cash on Delivery.',
            { serviceType: 'TEST_SERVICE_TYPE_REJECTED' },
            'DPO_TEST_SERVICE_TYPE_REJECTED',
            503
        );
    }
    if (normalizeText(runtime.mode) === 'live' && normalizeText(runtime.secrets?.serviceType) !== LIVE_SERVICE_TYPE_ID) {
        throw ValidationError(
            'Online payment is temporarily unavailable. Please try again or choose Cash on Delivery.',
            { serviceType: 'LIVE_SERVICE_TYPE_REQUIRED' },
            'DPO_LIVE_SERVICE_TYPE_REQUIRED',
            503
        );
    }

    const currentStatus = normalizeText(order.paymentStatus || order.payment?.status).toLowerCase();
    if (isSettledPaidStatus(currentStatus)) {
        const appBase = resolveAppBaseUrl(req);
        return {
            alreadyPaid: true,
            orderId: id,
            paymentUrl: null,
            redirectUrl: buildFrontendUrl(appBase, `/orders/order-success.html?orderId=${encodeURIComponent(id)}`),
            payment: toPublicPaymentView(order, { outcome: 'success' })
        };
    }

    // Amount is taken from the stored order (catalog + delivery fee), never from the browser.
    const amount = assertTrustedOrderAmount(order);

    const existingGateway = order.payment?.gateway && typeof order.payment.gateway === 'object'
        ? order.payment.gateway
        : {};
    const existingToken = normalizeText(existingGateway.transToken);
    const existingUrl = normalizeText(existingGateway.paymentUrl);
    const initiatedAtMs = Date.parse(existingGateway.initiatedAt || 0);
    const awaitingReuse = currentStatus === 'awaiting_payment'
        || currentStatus === 'pending'
        || currentStatus === '';
    const tokenFresh = Number.isFinite(initiatedAtMs) && (Date.now() - initiatedAtMs) < TOKEN_REUSE_MAX_MS;
    const storedMode = storedGatewayMode(order);
    const selectedMethod = orderPaymentMethod(order);
    const hosted = dpoClient.resolveHostedPaymentOptions(selectedMethod);
    const storedDefaultPayment = normalizeText(existingGateway.defaultPayment).toUpperCase();
    const sameMethod = !storedDefaultPayment || storedDefaultPayment === hosted.defaultPayment;
    const sameEnvironment = !storedMode || storedMode === normalizeText(runtime.mode).toLowerCase();

    if (awaitingReuse && existingToken && existingUrl && tokenFresh && sameEnvironment && sameMethod) {
        appLogger.info('dpo.payment.initiate_reused', {
            orderId: id,
            mode: runtime.mode,
            defaultPayment: hosted.defaultPayment
        });
        return {
            alreadyPaid: false,
            reused: true,
            orderId: id,
            paymentUrl: existingUrl,
            redirectUrl: existingUrl,
            payment: toPublicPaymentView(order, { outcome: 'redirect', reused: true })
        };
    }

    if (initiateLocks.has(id)) {
        throw ValidationError(
            'Payment is already being started for this order. Please wait.',
            { orderId: id },
            'DPO_PAYMENT_IN_PROGRESS',
            409
        );
    }
    initiateLocks.set(id, Date.now());
    try {
        const appBase = resolveAppBaseUrl(req);
        const redirectUrl = buildFrontendUrl(
            appBase,
            `/api/payments/dpo/return?orderId=${encodeURIComponent(id)}`
        );
        const backUrl = buildFrontendUrl(
            appBase,
            `/api/payments/dpo/back?orderId=${encodeURIComponent(id)}`
        );
        const callbackUrl = buildFrontendUrl(
            appBase,
            `/api/payments/dpo/callback?orderId=${encodeURIComponent(id)}`
        );

        const shipping = order.shippingAddress && typeof order.shippingAddress === 'object'
            ? order.shippingAddress
            : {};
        const payerPhone = normalizeText(
            order.payment?.payerPhone
            || order.customerPhone
            || order.phoneNumber
            || order.customer?.phone
            || shipping.phone
        );
        const customerCity = normalizeText(shipping.provinceCity || shipping.city);
        const customerAddress = [
            shipping.district,
            shipping.sector,
            shipping.cell,
            shipping.village,
            shipping.note
        ].map((part) => normalizeText(part)).filter(Boolean).join(', ');

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
            paymentMethod: selectedMethod,
            customerName: order.customerName || order.customer?.name || 'Customer',
            customerEmail: order.customerEmail || order.customer?.email || '',
            customerPhone: payerPhone,
            customerAddress,
            customerCity,
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
                callbackUrl,
                lastResult: created.result,
                lastOutcome: 'redirect',
                mode: runtime.mode,
                serviceType: runtime.secrets.serviceType,
                defaultPayment: hosted.defaultPayment,
                paymentMethod: selectedMethod,
                initiatedAt: new Date().toISOString()
            }
        });

        await orderDataService.saveOrder(updated);

        appLogger.info('dpo.payment.initiated', {
            orderId: id,
            mode: runtime.mode,
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
    } finally {
        initiateLocks.delete(id);
    }
}

async function persistVerifiedPayment(order, verified, token, req) {
    const id = normalizeText(order?.orderId || order?.id);
    const storedToken = normalizeText(order.payment?.gateway?.transToken);
    const { order: updated, previousPaymentStatus, previousOrderStatus } = applyGatewayPaymentUpdate(order, {
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
            verifiedAt: new Date().toISOString(),
            mode: storedGatewayMode(order),
            ...(normalizeText(order.payment?.gateway?.serviceType)
                ? { serviceType: normalizeText(order.payment.gateway.serviceType) }
                : {})
        }
    });

    if (verified.outcome === 'pending' && updated.paymentStatus !== 'paid') {
        updated.paymentStatus = 'awaiting_payment';
        updated.paymentStatusLabel = 'Awaiting Payment';
        updated.payment.status = 'awaiting_payment';
        updated.payment.statusLabel = 'Awaiting Payment';
    }

    await orderDataService.saveOrder(updated);
    await notifyPaymentChange(updated, previousPaymentStatus, previousOrderStatus);

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

    return withOrderLock(verifyLocks, id, () => verifyAndUpdateOrderUnlocked({
        orderId: id,
        transactionToken,
        markCancelled,
        req
    }));
}

function pendingVerifyResult(order, req, id) {
    return {
        outcome: 'pending',
        paymentStatus: normalizeText(order.paymentStatus, 'awaiting_payment') || 'awaiting_payment',
        payment: toPublicPaymentView(order, { outcome: 'pending' }),
        redirectUrl: buildFrontendUrl(
            resolveAppBaseUrl(req),
            `/orders/payment-result.html?status=pending&orderId=${encodeURIComponent(id)}`
        )
    };
}

async function verifyAndUpdateOrderUnlocked({
    orderId,
    transactionToken,
    markCancelled = false,
    req
} = {}) {
    const id = normalizeText(orderId);
    const order = await orderDataService.findOrderByIdentifier(id);
    if (!order) {
        throw ValidationError('Order not found.', { orderId: id }, 'ORDER_NOT_FOUND', 404);
    }

    assertOrderEligibleForDpo(order);

    const existingStatus = normalizeText(order.paymentStatus || order.payment?.status).toLowerCase();
    if (isSettledPaidStatus(existingStatus)) {
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
        const storedCancelToken = normalizeText(order.payment?.gateway?.transToken);
        if (storedCancelToken) {
            try {
                const runtime = await loadRuntimeForOrder(order);
                const verifiedOnBack = await dpoClient.verifyToken({
                    companyToken: runtime.secrets.companyToken,
                    apiBaseUrl: runtime.endpoints.apiBaseUrl,
                    transactionToken: storedCancelToken,
                    companyRef: id
                });

                if (verifiedOnBack.outcome === 'success') {
                    const binding = assertVerifiedPaymentMatchesOrder(order, verifiedOnBack, storedCancelToken);
                    if (binding.ok) {
                        return persistVerifiedPayment(order, verifiedOnBack, storedCancelToken, req);
                    }
                }

                if (verifiedOnBack.outcome === 'failed') {
                    return persistVerifiedPayment(order, verifiedOnBack, storedCancelToken, req);
                }
            } catch (error) {
                if (error?.code !== 'DPO_VERIFY_INPUT_MISSING') {
                    appLogger.warn('dpo.payment.cancel_verify_unavailable', {
                        orderId: id,
                        code: error?.code || '',
                        message: error?.message || ''
                    });
                    return pendingVerifyResult(order, req, id);
                }
            }
        }

        const { order: cancelled, previousPaymentStatus, previousOrderStatus } = applyGatewayPaymentUpdate(order, {
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
        await notifyPaymentChange(cancelled, previousPaymentStatus, previousOrderStatus);
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

    const runtime = await loadRuntimeForOrder(order);
    const storedToken = normalizeText(order.payment?.gateway?.transToken);
    const requestedToken = normalizeText(transactionToken);
    if (storedToken && requestedToken && storedToken !== requestedToken) {
        appLogger.warn('dpo.payment.request_token_ignored', {
            orderId: id,
            hasStoredToken: true
        });
    }
    const token = storedToken || requestedToken;

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
            const { order: invalid, previousPaymentStatus, previousOrderStatus } = applyGatewayPaymentUpdate(order, {
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
            await notifyPaymentChange(invalid, previousPaymentStatus, previousOrderStatus);
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
        if (isUncertainVerifyError(error)) {
            appLogger.warn('dpo.payment.verify_unavailable', {
                orderId: id,
                code: error?.code || '',
                message: error?.message || ''
            });
            return pendingVerifyResult(order, req, id);
        }
        throw error;
    }

    if (verified.outcome === 'success') {
        const binding = assertVerifiedPaymentMatchesOrder(order, verified, token);
        if (!binding.ok) {
            appLogger.warn('dpo.payment.binding_rejected', {
                orderId: id,
                code: binding.code,
                dpoAmount: verified.transactionAmount || '',
                dpoCurrency: verified.transactionCurrency || '',
                dpoCompanyRef: verified.companyRef || '',
                expectedAmount: order.totalAmount ?? order.total,
                expectedCurrency: order.currency || 'RWF'
            });
            return {
                outcome: 'failed',
                paymentStatus: normalizeText(order.paymentStatus, 'awaiting_payment') || 'awaiting_payment',
                result: verified.result,
                resultExplanation: binding.message,
                payment: toPublicPaymentView(order, { outcome: 'failed', code: binding.code }),
                redirectUrl: buildFrontendUrl(
                    resolveAppBaseUrl(req),
                    `/orders/payment-result.html?status=failed&orderId=${encodeURIComponent(id)}`
                )
            };
        }
    }

    return persistVerifiedPayment(order, verified, token, req);
}

async function notifyPaymentChange(order, previousPaymentStatus, previousOrderStatus) {
    try {
        const notificationEngine = require('./notification-engine.service');
        await notificationEngine.notifyOrderStatusChanged(
            order,
            previousOrderStatus || order.status || order.orderStatus || '',
            { previousPaymentStatus }
        );
    } catch (error) {
        appLogger.warn('dpo.payment.notify_failed', {
            orderId: order?.orderId || order?.id || '',
            message: error?.message || 'notify failed'
        });
    }
}

module.exports = {
    PROVIDER_ID,
    getPublicConfig,
    initiatePayment,
    loadCheckoutRuntime,
    loadRuntimeForOrder,
    toPublicPaymentView,
    verifyAndUpdateOrder,
    assertTrustedOrderAmount
};
