/**
 * Single inventory/stock flow for orders and payments.
 * Cart never calls this. Available stock is products.stock / variant.stock.
 * Reserved quantity is tracked on the SKU and on order.payment.inventory.
 */

const { appLogger } = require('../utils/logger');
const { isSettledPaidStatus } = require('../payments/payment-status');
const { isCodPaymentMethod } = require('../payments/storefront-methods');
const { getRepositoryBundle } = require('../repositories');

const STATES = Object.freeze({
    NONE: 'none',
    RESERVED: 'reserved',
    COMMITTED: 'committed',
    RELEASED: 'released',
    RESTORED: 'restored'
});

const REASONS = Object.freeze({
    ORDER_RESERVED: 'ORDER_RESERVED',
    ONLINE_PAYMENT_SUCCESS: 'ONLINE_PAYMENT_SUCCESS',
    COD_ORDER_CREATED: 'COD_ORDER_CREATED',
    ORDER_CANCELLED: 'ORDER_CANCELLED',
    PAYMENT_FAILED: 'PAYMENT_FAILED',
    PAYMENT_CANCELLED: 'PAYMENT_CANCELLED',
    PAYMENT_EXPIRED: 'PAYMENT_EXPIRED',
    STOCK_RELEASED: 'STOCK_RELEASED',
    STOCK_RESTORED: 'STOCK_RESTORED'
});

// Match DPO token reuse so a customer can still complete payment on the same token.
const ONLINE_RESERVATION_TTL_MS = 20 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

let sweepTimer = null;

function normalizeText(value, fallback = '') {
    const text = String(value == null ? '' : value).trim();
    return text || fallback;
}

function getRepos() {
    return getRepositoryBundle();
}

function orderItems(order) {
    if (Array.isArray(order?.items) && order.items.length) return order.items;
    if (Array.isArray(order?.products) && order.products.length) return order.products;
    return [];
}

function isCodOrder(order) {
    const method = normalizeText(order?.paymentMethod || order?.payment?.method).toLowerCase();
    const type = normalizeText(order?.paymentType || order?.payment?.type).toLowerCase();
    return isCodPaymentMethod(method) || type === 'cod';
}

function orderIdOf(order) {
    return normalizeText(order?.orderId || order?.id);
}

function getInventoryRecord(order) {
    return order?.payment && typeof order.payment === 'object' && order.payment.inventory
        && typeof order.payment.inventory === 'object'
        ? order.payment.inventory
        : {};
}

function getState(order) {
    const explicit = normalizeText(getInventoryRecord(order).state).toLowerCase();
    if (explicit) return explicit;
    const paymentStatus = order?.paymentStatus || order?.payment?.status;
    if (isSettledPaidStatus(paymentStatus)) return STATES.COMMITTED;
    return STATES.NONE;
}

function attachInventory(order, patch = {}) {
    order.payment = order.payment && typeof order.payment === 'object' ? order.payment : {};
    order.payment.inventory = {
        ...getInventoryRecord(order),
        ...patch,
        updatedAt: new Date().toISOString()
    };
    return order.payment.inventory;
}

function reservationExpiryIso(order, fromDate = new Date()) {
    if (isCodOrder(order)) return null;
    return new Date(fromDate.getTime() + ONLINE_RESERVATION_TTL_MS).toISOString();
}

function attachReservationMetadata(order, reason) {
    const resolvedReason = reason || (isCodOrder(order) ? REASONS.COD_ORDER_CREATED : REASONS.ORDER_RESERVED);
    const now = new Date();
    attachInventory(order, {
        state: STATES.RESERVED,
        reservedAt: now.toISOString(),
        reason: resolvedReason,
        expiresAt: reservationExpiryIso(order, now)
    });
    return order;
}

function refreshReservationExpiry(order) {
    if (isCodOrder(order)) return order;
    if (getState(order) !== STATES.RESERVED) return order;
    attachInventory(order, {
        expiresAt: reservationExpiryIso(order)
    });
    return order;
}

function mutationOptions(order, reason, extra = {}) {
    return {
        orderId: orderIdOf(order),
        reason,
        paymentStatus: normalizeText(order?.paymentStatus || order?.payment?.status),
        ...extra
    };
}

function reserveStockForOrder(order, { reason } = {}) {
    const state = getState(order);
    if (state === STATES.RESERVED || state === STATES.COMMITTED) {
        return { skipped: true, state };
    }

    const items = orderItems(order);
    if (!items.length) {
        attachReservationMetadata(order, reason);
        return { skipped: false, state: STATES.RESERVED, empty: true };
    }

    const resolvedReason = reason || (isCodOrder(order) ? REASONS.COD_ORDER_CREATED : REASONS.ORDER_RESERVED);
    const { products } = getRepos();
    products.decrementStockForOrderItems(items, mutationOptions(order, resolvedReason, { mode: 'reserve' }));
    attachReservationMetadata(order, resolvedReason);
    return { skipped: false, state: STATES.RESERVED };
}

function commitStockForOrder(order, { reason } = {}) {
    const state = getState(order);
    if (state === STATES.COMMITTED) {
        return { skipped: true, state };
    }

    const items = orderItems(order);
    const { products } = getRepos();
    const resolvedReason = reason || (isCodOrder(order) ? REASONS.COD_ORDER_CREATED : REASONS.ONLINE_PAYMENT_SUCCESS);

    if (state === STATES.RELEASED || state === STATES.RESTORED) {
        try {
            products.decrementStockForOrderItems(items, mutationOptions(order, resolvedReason, { mode: 'reserve' }));
        } catch (error) {
            attachInventory(order, {
                exception: 'PAID_WITHOUT_STOCK',
                exceptionMessage: error.message || 'Unable to re-reserve stock after payment success',
                exceptionAt: new Date().toISOString()
            });
            appLogger.error('inventory.commit_after_release_failed', {
                error,
                orderId: orderIdOf(order),
                code: error?.code || ''
            });
            return { skipped: false, state, error, exception: 'PAID_WITHOUT_STOCK' };
        }
    }

    if (items.length) {
        products.commitReservedStockForOrderItems(items, mutationOptions(order, resolvedReason));
    }

    attachInventory(order, {
        state: STATES.COMMITTED,
        committedAt: new Date().toISOString(),
        reason: resolvedReason,
        expiresAt: null,
        exception: undefined,
        exceptionMessage: undefined
    });
    return { skipped: false, state: STATES.COMMITTED };
}

function releaseStockForOrder(order, { reason } = {}) {
    const state = getState(order);
    if (state === STATES.RELEASED || state === STATES.RESTORED) {
        return { skipped: true, state };
    }
    if (state === STATES.COMMITTED) {
        return restoreStockForOrder(order, { reason: reason || REASONS.STOCK_RESTORED });
    }

    const items = orderItems(order);
    const resolvedReason = reason || REASONS.STOCK_RELEASED;
    if (items.length) {
        const { products } = getRepos();
        products.releaseReservedStockForOrderItems(items, mutationOptions(order, resolvedReason));
    }

    attachInventory(order, {
        state: STATES.RELEASED,
        releasedAt: new Date().toISOString(),
        reason: resolvedReason,
        expiresAt: null
    });
    return { skipped: false, state: STATES.RELEASED };
}

function restoreStockForOrder(order, { reason } = {}) {
    const state = getState(order);
    if (state === STATES.RESTORED || state === STATES.RELEASED) {
        return { skipped: true, state };
    }
    if (state === STATES.RESERVED || state === STATES.NONE) {
        return releaseStockForOrder(order, { reason: reason || REASONS.ORDER_CANCELLED });
    }

    const items = orderItems(order);
    const resolvedReason = reason || REASONS.STOCK_RESTORED;
    if (items.length) {
        const { products } = getRepos();
        products.restoreCommittedStockForOrderItems(items, mutationOptions(order, resolvedReason));
    }

    attachInventory(order, {
        state: STATES.RESTORED,
        restoredAt: new Date().toISOString(),
        reason: resolvedReason,
        expiresAt: null
    });
    return { skipped: false, state: STATES.RESTORED };
}

function releaseOrRestoreForCancellation(order) {
    return releaseStockForOrder(order, { reason: REASONS.ORDER_CANCELLED });
}

function applyInventoryForPaymentOutcome(order, outcome) {
    const normalized = normalizeText(outcome).toLowerCase();
    try {
        if (normalized === 'success') {
            return commitStockForOrder(order, { reason: REASONS.ONLINE_PAYMENT_SUCCESS });
        }
        if (normalized === 'cancelled') {
            return releaseStockForOrder(order, { reason: REASONS.PAYMENT_CANCELLED });
        }
        if (normalized === 'failed' || normalized === 'invalid_token') {
            return releaseStockForOrder(order, { reason: REASONS.PAYMENT_FAILED });
        }
        if (normalized === 'expired') {
            return releaseStockForOrder(order, { reason: REASONS.PAYMENT_EXPIRED });
        }
        return { skipped: true, state: getState(order) };
    } catch (error) {
        attachInventory(order, {
            exception: 'INVENTORY_PROCESSING_FAILED',
            exceptionMessage: error.message || 'Inventory processing failed',
            exceptionOutcome: normalized,
            exceptionAt: new Date().toISOString()
        });
        appLogger.error('inventory.payment_outcome_failed', {
            error,
            orderId: orderIdOf(order),
            outcome: normalized
        });
        return { skipped: false, error, state: getState(order) };
    }
}

function releaseExpiredOnlineReservations() {
    const { orders } = getRepos();
    if (!orders?.listExpiredOnlineReservations) return { released: 0 };
    const expired = orders.listExpiredOnlineReservations() || [];
    let released = 0;

    expired.forEach((order) => {
        if (isCodOrder(order)) return;
        if (isSettledPaidStatus(order.paymentStatus || order.payment?.status)) return;
        const result = releaseStockForOrder(order, { reason: REASONS.PAYMENT_EXPIRED });
        if (result?.skipped) return;
        const currentPayment = normalizeText(order.paymentStatus || order.payment?.status).toLowerCase();
        if (currentPayment === 'awaiting_payment' || currentPayment === 'pending' || !currentPayment) {
            order.paymentStatus = 'cancelled';
            order.paymentStatusLabel = 'Expired';
            if (order.payment && typeof order.payment === 'object') {
                order.payment.status = 'cancelled';
                order.payment.statusLabel = 'Expired';
            }
        }
        const history = Array.isArray(order.statusHistory) ? order.statusHistory.slice() : [];
        history.push({
            status: 'cancelled',
            label: 'Online payment reservation expired — stock released',
            timestamp: new Date().toISOString(),
            actor: 'system'
        });
        order.statusHistory = history.slice(-40);
        orders.save(order);
        released += 1;
        appLogger.info('inventory.reservation_expired', { orderId: orderIdOf(order) });
    });

    return { released };
}

function startInventoryReservationSweeper() {
    if (sweepTimer) return;
    const tick = () => {
        try {
            releaseExpiredOnlineReservations();
        } catch (error) {
            appLogger.warn('inventory.reservation_sweep_failed', { error });
        }
    };
    tick();
    sweepTimer = setInterval(tick, SWEEP_INTERVAL_MS);
    if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
}

function stopInventoryReservationSweeper() {
    if (!sweepTimer) return;
    clearInterval(sweepTimer);
    sweepTimer = null;
}

module.exports = {
    STATES,
    REASONS,
    ONLINE_RESERVATION_TTL_MS,
    getState,
    attachReservationMetadata,
    refreshReservationExpiry,
    reserveStockForOrder,
    commitStockForOrder,
    releaseStockForOrder,
    restoreStockForOrder,
    releaseOrRestoreForCancellation,
    applyInventoryForPaymentOutcome,
    releaseExpiredOnlineReservations,
    startInventoryReservationSweeper,
    stopInventoryReservationSweeper,
    isCodOrder
};
