'use strict';

const deliverySettingsService = require('./deliverysettings.service');
const {
    addBusinessHours,
    hasElapsedBusinessHours,
    isWithinBusinessHoursWindow,
    isWithinCalendarHoursWindow
} = require('../utils/business-hours');

const REASON_CODES = Object.freeze({
    CANCEL: 'cancel',
    DELIVERY_DELAY: 'delivery_delay',
    INCORRECT_PRODUCT: 'incorrect_product',
    DESCRIPTION_MISMATCH: 'description_mismatch',
    UNSUITABLE_PRODUCT: 'unsuitable_product'
});

const REASON_LABELS = Object.freeze({
    [REASON_CODES.CANCEL]: 'Order cancellation',
    [REASON_CODES.DELIVERY_DELAY]: 'Delivery delay',
    [REASON_CODES.INCORRECT_PRODUCT]: 'Incorrect product received',
    [REASON_CODES.DESCRIPTION_MISMATCH]: 'Product significantly different from description',
    [REASON_CODES.UNSUITABLE_PRODUCT]: 'Product unsuitable for intended purpose'
});

const DISPATCHED_STATUSES = new Set([
    'packed',
    'shipping',
    'shipped',
    'out_for_delivery',
    'delivered',
    'returned',
    'refunded',
    'cancelled',
    'canceled'
]);

const CANCELLABLE_STATUSES = new Set(['pending', 'confirmed', 'processing']);

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeStatus(order) {
    return normalizeText(order?.orderStatus || order?.status).toLowerCase();
}

function parseDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

function historyTimestamp(entry) {
    return parseDate(entry?.at || entry?.timestamp || entry?.date || entry?.createdAt || entry?.time);
}

function resolvePlacedAt(order) {
    return parseDate(order?.createdAt || order?.date || order?.timestamp) || new Date();
}

function resolveConfirmationAt(order) {
    const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
    for (const entry of history) {
        const label = `${entry?.status || ''} ${entry?.label || ''}`;
        if (/confirm|process|pack|ship|deliver/i.test(label)) {
            const ts = historyTimestamp(entry);
            if (ts) return ts;
        }
    }
    const status = normalizeStatus(order);
    if (status && status !== 'pending') {
        return resolvePlacedAt(order);
    }
    return null;
}

function resolveDeliveredAt(order) {
    const direct = parseDate(order?.deliveredAt || order?.deliveryDate);
    if (direct) return direct;
    const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
    for (let index = history.length - 1; index >= 0; index -= 1) {
        const entry = history[index];
        const label = `${entry?.status || ''} ${entry?.label || ''}`;
        if (/deliver/i.test(label) && !/undeliver/i.test(label)) {
            const ts = historyTimestamp(entry);
            if (ts) return ts;
        }
    }
    if (normalizeStatus(order) === 'delivered') {
        return parseDate(order?.updatedAt) || resolvePlacedAt(order);
    }
    return null;
}

function isDispatched(order) {
    const status = normalizeStatus(order);
    if (DISPATCHED_STATUSES.has(status)) return true;
    return /ship|pack|deliver|return|refund|cancel/i.test(status);
}

function getWorkflow(order) {
    const payment = order?.payment && typeof order.payment === 'object' ? order.payment : {};
    return payment.returnWorkflow && typeof payment.returnWorkflow === 'object'
        ? payment.returnWorkflow
        : {};
}

function hasOpenRequest(order) {
    const workflow = getWorkflow(order);
    const returnStatus = normalizeText(workflow.returnStatus).toLowerCase();
    const refundStatus = normalizeText(workflow.refundStatus).toLowerCase();
    if (['approved', 'received', 'requested'].includes(returnStatus)) return true;
    if (['required', 'pending', 'completed'].includes(refundStatus)) return true;
    if (normalizeStatus(order) === 'cancelled') return true;
    return false;
}

async function loadHolidays() {
    try {
        const settings = await deliverySettingsService.getDeliveryConfig();
        return Array.isArray(settings?.timing?.holidayExceptions)
            ? settings.timing.holidayExceptions
            : [];
    } catch (_error) {
        return [];
    }
}

function paymentMethodLabel(order) {
    const method = normalizeText(order?.paymentMethod || order?.payment?.method).toLowerCase();
    if (method === 'cod' || method === 'cash') return 'Cash on Delivery';
    if (method === 'mtn' || method === 'momo' || method.includes('mtn')) return 'MTN MoMo';
    if (method === 'card' || method.includes('card') || method.includes('dpo')) return 'Card payment';
    return normalizeText(order?.paymentMethodLabel || order?.payment?.methodLabel) || (method ? method.toUpperCase() : 'Original payment method');
}

function mapCustomerRequestStatus(order) {
    const status = normalizeStatus(order);
    const workflow = getWorkflow(order);
    const returnStatus = normalizeText(workflow.returnStatus).toLowerCase();
    const refundStatus = normalizeText(workflow.refundStatus).toLowerCase();
    const paymentStatus = normalizeText(order?.paymentStatus || order?.payment?.status).toLowerCase();

    if (refundStatus === 'completed' || paymentStatus === 'refunded' || status === 'refunded') {
        return { key: 'refunded', label: 'Refunded' };
    }
    if (refundStatus === 'rejected' || returnStatus === 'rejected') {
        return { key: 'rejected', label: 'Rejected' };
    }
    if (refundStatus === 'processing') {
        return { key: 'refund_processing', label: 'Refund Processing' };
    }
    if (returnStatus === 'inspected') {
        return { key: 'inspected', label: 'Inspected' };
    }
    if (returnStatus === 'received') {
        return { key: 'return_received', label: 'Return Received' };
    }
    if (returnStatus === 'approved' || status === 'returned') {
        return { key: 'approved', label: 'Approved' };
    }
    if (returnStatus === 'requested') {
        return { key: 'under_review', label: 'Under Review' };
    }
    if (refundStatus === 'required' || refundStatus === 'pending' || paymentStatus === 'refund_required') {
        return { key: 'refund_processing', label: 'Refund Processing' };
    }
    if (status === 'cancelled' || status === 'canceled') {
        return { key: 'cancelled', label: 'Cancelled' };
    }
    return { key: 'none', label: '' };
}

function evaluateCancellation(order, now, holidays) {
    const status = normalizeStatus(order);
    const placedAt = resolvePlacedAt(order);
    const withinWindow = isWithinBusinessHoursWindow(placedAt, 48, now, holidays);
    const dispatched = isDispatched(order);
    const cancellableStatus = CANCELLABLE_STATUSES.has(status);

    if (status === 'cancelled' || status === 'canceled') {
        return {
            eligible: false,
            reasonCode: REASON_CODES.CANCEL,
            reason: 'This order is already cancelled.'
        };
    }
    if (dispatched && !cancellableStatus) {
        return {
            eligible: false,
            reasonCode: REASON_CODES.CANCEL,
            reason: 'This order has already been dispatched, so it can no longer be cancelled under the policy.'
        };
    }
    if (!cancellableStatus) {
        return {
            eligible: false,
            reasonCode: REASON_CODES.CANCEL,
            reason: 'Only orders that are pending, confirmed, or processing and not yet dispatched can be cancelled.'
        };
    }
    if (!withinWindow) {
        return {
            eligible: false,
            reasonCode: REASON_CODES.CANCEL,
            reason: 'The 48 business-hour cancellation window after placing the order has ended.',
            windowEndsAt: addBusinessHours(placedAt, 48, holidays).toISOString()
        };
    }
    return {
        eligible: true,
        reasonCode: REASON_CODES.CANCEL,
        reason: 'You may cancel this order within 48 business hours of placing it, before dispatch.',
        windowEndsAt: addBusinessHours(placedAt, 48, holidays).toISOString(),
        placedAt: placedAt.toISOString()
    };
}

function evaluateDeliveryDelay(order, now, holidays) {
    const status = normalizeStatus(order);
    if (status === 'delivered') {
        return {
            eligible: false,
            reasonCode: REASON_CODES.DELIVERY_DELAY,
            reason: 'This order has already been delivered.'
        };
    }
    if (status === 'cancelled' || status === 'canceled') {
        return {
            eligible: false,
            reasonCode: REASON_CODES.DELIVERY_DELAY,
            reason: 'This order is cancelled.'
        };
    }
    const confirmationAt = resolveConfirmationAt(order);
    if (!confirmationAt) {
        return {
            eligible: false,
            reasonCode: REASON_CODES.DELIVERY_DELAY,
            reason: 'Delivery-delay refunds apply after order confirmation. This order is still awaiting confirmation.'
        };
    }
    if (!hasElapsedBusinessHours(confirmationAt, 48, now, holidays)) {
        return {
            eligible: false,
            reasonCode: REASON_CODES.DELIVERY_DELAY,
            reason: 'A delivery-delay refund can be requested only after 48 business hours from confirmation when the order is still undelivered.',
            windowOpensAt: addBusinessHours(confirmationAt, 48, holidays).toISOString(),
            confirmationAt: confirmationAt.toISOString()
        };
    }
    return {
        eligible: true,
        reasonCode: REASON_CODES.DELIVERY_DELAY,
        reason: 'This order was not delivered within 48 business hours after confirmation. You may request a full refund if the delay was not communicated in advance.',
        confirmationAt: confirmationAt.toISOString()
    };
}

function evaluatePostDeliveryReturn(order, reasonCode, now) {
    const deliveredAt = resolveDeliveredAt(order);
    if (!deliveredAt) {
        return {
            eligible: false,
            reasonCode,
            reason: 'This request is available after the order has been delivered.'
        };
    }
    if (!isWithinCalendarHoursWindow(deliveredAt, 24, now)) {
        return {
            eligible: false,
            reasonCode,
            reason: 'The 24-hour window after receiving the order has ended.',
            deliveredAt: deliveredAt.toISOString()
        };
    }
    const labels = {
        [REASON_CODES.INCORRECT_PRODUCT]: 'You may request a replacement or full refund for an incorrect product within 24 hours of receiving the order.',
        [REASON_CODES.DESCRIPTION_MISMATCH]: 'You may request a return within 24 hours if the product is significantly different from its description. The product must be unused and in its original packaging.',
        [REASON_CODES.UNSUITABLE_PRODUCT]: 'You may request a return within 24 hours if the product is unsuitable for its intended purpose. The product must be unused and in its original packaging.'
    };
    return {
        eligible: true,
        reasonCode,
        reason: labels[reasonCode] || 'Eligible for a return/refund request.',
        deliveredAt: deliveredAt.toISOString(),
        requiresUnusedAttestation: reasonCode !== REASON_CODES.INCORRECT_PRODUCT,
        requiresOriginalPackagingAttestation: reasonCode !== REASON_CODES.INCORRECT_PRODUCT
    };
}

function evaluateEligibility(order, { now = new Date(), holidays = [] } = {}) {
    const open = hasOpenRequest(order);
    const cancellation = evaluateCancellation(order, now, holidays);
    const deliveryDelay = evaluateDeliveryDelay(order, now, holidays);
    const incorrect = evaluatePostDeliveryReturn(order, REASON_CODES.INCORRECT_PRODUCT, now);
    const mismatch = evaluatePostDeliveryReturn(order, REASON_CODES.DESCRIPTION_MISMATCH, now);
    const unsuitable = evaluatePostDeliveryReturn(order, REASON_CODES.UNSUITABLE_PRODUCT, now);

    const actions = [
        cancellation,
        deliveryDelay,
        incorrect,
        mismatch,
        unsuitable
    ].map((entry) => {
        if (open && entry.eligible && entry.reasonCode !== REASON_CODES.CANCEL) {
            return {
                ...entry,
                eligible: false,
                reason: 'A cancellation, return, or refund request is already open for this order.'
            };
        }
        if (open && entry.reasonCode === REASON_CODES.CANCEL && normalizeStatus(order) === 'cancelled') {
            return entry;
        }
        if (open && entry.reasonCode === REASON_CODES.CANCEL && entry.eligible) {
            return {
                ...entry,
                eligible: false,
                reason: 'A return or refund request is already open for this order.'
            };
        }
        return entry;
    });

    return {
        orderId: normalizeText(order?.orderId || order?.id),
        requestStatus: mapCustomerRequestStatus(order),
        actions,
        canCancel: Boolean(actions.find((item) => item.reasonCode === REASON_CODES.CANCEL)?.eligible),
        canRequestReturn: actions.some((item) => item.eligible && item.reasonCode !== REASON_CODES.CANCEL)
    };
}

function sanitizeCustomerOrder(order, eligibility) {
    const workflow = getWorkflow(order);
    const requestStatus = mapCustomerRequestStatus(order);
    const items = (Array.isArray(order?.items) ? order.items : []).map((item) => ({
        productId: normalizeText(item?.productId || item?.id),
        productName: normalizeText(item?.productName || item?.name) || 'Product',
        quantity: Math.max(1, Number(item?.quantity || item?.qty || 1) || 1),
        price: Number(item?.price || 0) || 0
    }));

    return {
        orderId: normalizeText(order?.orderId || order?.id),
        createdAt: resolvePlacedAt(order).toISOString(),
        confirmationAt: resolveConfirmationAt(order)?.toISOString() || null,
        deliveredAt: resolveDeliveredAt(order)?.toISOString() || null,
        status: normalizeText(order?.status || order?.orderStatus) || 'Pending',
        orderStatus: normalizeStatus(order),
        totalAmount: Number(order?.totalAmount ?? order?.total ?? 0) || 0,
        paymentMethod: normalizeText(order?.paymentMethod || order?.payment?.method),
        paymentMethodLabel: paymentMethodLabel(order),
        paymentStatus: normalizeText(order?.paymentStatus || order?.payment?.status).toLowerCase(),
        items,
        eligibility,
        request: requestStatus.key === 'none' ? null : {
            status: requestStatus.key,
            statusLabel: requestStatus.label,
            reasonCode: normalizeText(workflow.reasonCode),
            reasonLabel: REASON_LABELS[normalizeText(workflow.reasonCode)] || normalizeText(workflow.returnReason),
            returnStatus: normalizeText(workflow.returnStatus).toLowerCase(),
            refundStatus: normalizeText(workflow.refundStatus).toLowerCase(),
            requestedAt: normalizeText(workflow.returnRequestedAt || order?.cancelledAt),
            customerNotes: normalizeText(workflow.customerNotes),
            refundMethodLabel: workflow.refundMethod
                ? paymentMethodLabel({ paymentMethod: workflow.refundMethod, paymentMethodLabel: workflow.refundMethod })
                : paymentMethodLabel(order),
            refundCompletedAt: normalizeText(workflow.refundDate || workflow.refundApprovedAt),
            processingNote: requestStatus.key === 'refund_processing' || requestStatus.key === 'return_received' || requestStatus.key === 'approved'
                ? 'Approved refunds are processed within 24 business hours after the returned product has been received and inspected. Refunds are made through the original payment method whenever possible.'
                : ''
        }
    };
}

function assertReturnReason(reasonCode) {
    const code = normalizeText(reasonCode).toLowerCase();
    if (![
        REASON_CODES.DELIVERY_DELAY,
        REASON_CODES.INCORRECT_PRODUCT,
        REASON_CODES.DESCRIPTION_MISMATCH,
        REASON_CODES.UNSUITABLE_PRODUCT
    ].includes(code)) {
        const error = new Error('Select a supported return or refund reason.');
        error.code = 'INVALID_REASON';
        error.status = 400;
        throw error;
    }
    return code;
}

module.exports = {
    REASON_CODES,
    REASON_LABELS,
    CANCELLABLE_STATUSES,
    assertReturnReason,
    evaluateEligibility,
    loadHolidays,
    mapCustomerRequestStatus,
    paymentMethodLabel,
    resolveConfirmationAt,
    resolveDeliveredAt,
    resolvePlacedAt,
    sanitizeCustomerOrder
};
