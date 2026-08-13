/**
 * Payment-status helpers shared by order, DPO, and Admin paths.
 * Never treat "unpaid" / "awaiting_payment" as paid — String#includes('paid') matches those.
 */

function normalizePaymentStatus(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
}

function isNegativePaymentStatus(status) {
    const value = normalizePaymentStatus(status);
    return value.includes('unpaid')
        || value.includes('awaiting')
        || value.includes('pending')
        || value.includes('fail')
        || value.includes('cancel')
        || value.includes('decline')
        || value.includes('unsuccess')
        || value.includes('invalid')
        || value.includes('refund');
}

function isSettledPaidStatus(value) {
    const status = normalizePaymentStatus(value);
    if (!status || isNegativePaymentStatus(status)) {
        return false;
    }
    return status === 'paid'
        || status === 'success'
        || status === 'successful'
        || status === 'completed'
        || status === 'complete'
        || status === 'payment_successful'
        || status === 'authorized';
}

module.exports = {
    normalizePaymentStatus,
    isNegativePaymentStatus,
    isSettledPaidStatus
};
