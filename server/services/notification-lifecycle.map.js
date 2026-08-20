/**
 * Pure order/payment lifecycle event mapping.
 * No database, SMTP, or worker dependencies — used by the notification engine
 * and by verification scripts.
 */

function text(value, fallback = '') {
    const next = String(value == null ? '' : value).trim();
    return next || fallback;
}

function lower(value) {
    return text(value).toLowerCase();
}

function isPaidStatus(value) {
    const status = lower(value);
    if (!status || status.includes('unpaid') || status.includes('awaiting') || status.includes('refund')) {
        return false;
    }
    return status === 'paid'
        || status === 'success'
        || status === 'successful'
        || status === 'completed'
        || /(^|_)paid($|_)/.test(status)
        || status.endsWith('_paid');
}

function isFailedPayment(value) {
    const status = lower(value);
    return status === 'failed'
        || status === 'fail'
        || status === 'declined'
        || status === 'payment_failed'
        || status.endsWith('_failed')
        || status.includes('declined');
}

function isCancelledPayment(value) {
    const status = lower(value);
    return status === 'cancelled'
        || status === 'canceled'
        || status === 'payment_cancelled'
        || status === 'payment_canceled';
}

function isPendingPayment(value) {
    const status = lower(value);
    if (isPaidStatus(status) || isFailedPayment(status) || isCancelledPayment(status)) {
        return false;
    }
    if (status.includes('refund')) return false;
    if (!status) return true;
    return status === 'pending'
        || status === 'unpaid'
        || status === 'authorized'
        || status.includes('awaiting');
}

function mapStatusToEventKey(status) {
    const value = lower(status);
    if (value.includes('cancel')) return 'ORDER_CANCELLED';
    if (value.includes('confirm')) return 'ORDER_CONFIRMED';
    if (value.includes('process')) return 'ORDER_PROCESSING';
    if (value.includes('pack')) return 'ORDER_PACKED';
    if (value.includes('ship') || value.includes('out for delivery') || value.includes('out_for_delivery')) {
        return 'ORDER_SHIPPED';
    }
    if (value.includes('deliver') || value.includes('complete')) return 'ORDER_DELIVERED';
    return '';
}

function mapReturnActionToEventKey(action) {
    const value = lower(action);
    if (
        value === 'open_return'
        || value === 'request_return'
        || value === 'refund_requested'
        || value === 'refund_required'
    ) {
        return 'REFUND_REQUESTED';
    }
    if (value === 'approve_refund' || value === 'complete_refund') return 'REFUND_APPROVED';
    if (value === 'reject_refund') return 'REFUND_REJECTED';
    return '';
}

function listOrderCreatedEvents(order) {
    if (!order) return [];
    const events = ['ORDER_CREATED'];
    const paymentStatus = order.paymentStatus || order.payment?.status || '';
    if (isPaidStatus(paymentStatus)) events.push('PAYMENT_RECEIVED');
    else if (isFailedPayment(paymentStatus)) events.push('PAYMENT_FAILED');
    else if (isCancelledPayment(paymentStatus)) events.push('PAYMENT_CANCELLED');
    else events.push('PAYMENT_PENDING');

    const statusEvent = mapStatusToEventKey(order.status || order.orderStatus || '');
    if (statusEvent && statusEvent !== 'ORDER_CANCELLED') events.push(statusEvent);
    return events;
}

function listOrderStatusChangedEvents(order, previousStatus = '', options = {}) {
    if (!order) return [];
    const events = [];
    const nextStatus = order.status || order.orderStatus || '';
    const returnAction = text(options.returnAction);
    const refundRequested = Boolean(options.refundRequested)
        || lower(order.paymentStatus) === 'refund_required'
        || lower(order.payment?.returnWorkflow?.refundStatus) === 'required';

    let refundEvent = mapReturnActionToEventKey(returnAction);
    if (!refundEvent && refundRequested && mapStatusToEventKey(nextStatus) === 'ORDER_CANCELLED') {
        refundEvent = 'REFUND_REQUESTED';
    }
    if (refundEvent) events.push(refundEvent);

    const statusEvent = mapStatusToEventKey(nextStatus);
    const previousKey = mapStatusToEventKey(previousStatus);
    if (statusEvent && statusEvent !== previousKey) events.push(statusEvent);

    const previousPayment = lower(options.previousPaymentStatus);
    const nextPayment = lower(order.paymentStatus || order.payment?.status || '');
    if (nextPayment !== previousPayment) {
        if (isPaidStatus(nextPayment) && !isPaidStatus(previousPayment)) events.push('PAYMENT_RECEIVED');
        else if (isFailedPayment(nextPayment) && !isFailedPayment(previousPayment)) events.push('PAYMENT_FAILED');
        else if (isCancelledPayment(nextPayment) && !isCancelledPayment(previousPayment)) events.push('PAYMENT_CANCELLED');
        else if (isPendingPayment(nextPayment) && !isPendingPayment(previousPayment)) events.push('PAYMENT_PENDING');
    }

    return events;
}

module.exports = {
    isPaidStatus,
    isFailedPayment,
    isCancelledPayment,
    isPendingPayment,
    mapStatusToEventKey,
    mapReturnActionToEventKey,
    listOrderCreatedEvents,
    listOrderStatusChangedEvents
};
