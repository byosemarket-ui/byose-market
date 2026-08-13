/**
 * Classification rules for DPO TEST history cleanup.
 * LIVE records and legitimate customer orders are never classified as removable.
 */

const SYNTHETIC_NAMES = new Set([
    'prod e2e buyer',
    'prod state buyer',
    'verify customer',
    'online cod mtn buyer',
    'byose config test',
    'dpo test',
    'probe buyer'
]);

const SYNTHETIC_EMAILS = new Set([
    'verify@example.com',
    'admin@example.com'
]);

const SYNTHETIC_ORDER_PREFIXES = [
    'dpo-http-',
    'admin-cfg-test-',
    'dpo-verify',
    'local-verify'
];

function normalize(value) {
    return String(value == null ? '' : value).trim();
}

function parseJson(raw, fallback) {
    if (raw && typeof raw === 'object') {
        return raw;
    }
    try {
        const value = JSON.parse(raw || '');
        return value && typeof value === 'object' ? value : fallback;
    } catch (_error) {
        return fallback;
    }
}

function isCod(method) {
    const value = normalize(method).toLowerCase();
    return value === 'cod' || value === 'cash' || value.includes('cash');
}

function isGatewayMethod(method, gateway = {}) {
    const value = normalize(method).toLowerCase();
    const provider = normalize(gateway.provider).toLowerCase();
    return value === 'mtn' || value === 'card' || value === 'dpo'
        || provider === 'dpo'
        || Boolean(gateway.transToken)
        || Boolean(gateway.transRef);
}

function isSyntheticName(name) {
    return SYNTHETIC_NAMES.has(normalize(name).toLowerCase());
}

function isSyntheticEmail(email) {
    return SYNTHETIC_EMAILS.has(normalize(email).toLowerCase());
}

function isSyntheticOrderId(orderId) {
    const value = normalize(orderId).toLowerCase();
    return SYNTHETIC_ORDER_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function gatewayFromOrder(order = {}) {
    const payment = parseJson(order.payment || order.payment_json, {});
    return payment.gateway && typeof payment.gateway === 'object' ? payment.gateway : {};
}

function classifyOrder(order = {}) {
    const gateway = gatewayFromOrder(order);
    const shipping = parseJson(order.shippingAddress || order.shipping_address_json, {});
    const mode = normalize(gateway.mode).toLowerCase();
    const serviceType = normalize(gateway.serviceType || parseJson(order.payment || order.payment_json, {}).serviceType);
    const method = normalize(order.paymentMethod || order.payment_method);
    const customerName = order.customerName || order.customer_name;
    const customerEmail = order.customerEmail || order.customer_email;
    const userEmail = order.userEmail || order.user_email;
    const orderId = order.orderId || order.order_id;
    const gatewayOrder = isGatewayMethod(method, gateway);
    const synthetic = isSyntheticName(customerName)
        || isSyntheticEmail(customerEmail)
        || isSyntheticEmail(userEmail)
        || isSyntheticOrderId(orderId);

    if (mode === 'live' || serviceType === '112815') {
        return {
            className: 'LIVE',
            reason: mode === 'live' ? 'gateway.mode=live' : 'serviceType=112815',
            removable: false
        };
    }

    if (isCod(method) && !gateway.transToken && mode !== 'test') {
        return {
            className: synthetic ? 'SYNTHETIC_COD' : 'COD',
            reason: 'cash_on_delivery',
            removable: Boolean(synthetic)
        };
    }

    if (!gatewayOrder) {
        return {
            className: synthetic ? 'SYNTHETIC_OTHER' : 'OTHER',
            reason: 'not_dpo_gateway_activity',
            removable: Boolean(synthetic)
        };
    }

    const testMarked = mode === 'test' || serviceType === '54841';
    const missingMode = !mode && gatewayOrder;

    if (testMarked || missingMode) {
        if (synthetic) {
            return {
                className: 'SYNTHETIC_TEST',
                reason: testMarked
                    ? (serviceType === '54841' ? 'serviceType=54841+synthetic' : 'gateway.mode=test+synthetic')
                    : 'missing_mode+synthetic',
                removable: true
            };
        }
        return {
            className: 'AMBIGUOUS_TEST',
            reason: testMarked
                ? (serviceType === '54841' ? 'serviceType=54841_without_synthetic_marker' : 'gateway.mode=test_without_synthetic_marker')
                : 'dpo_missing_mode_without_synthetic_marker',
            removable: false
        };
    }

    return {
        className: 'AMBIGUOUS',
        reason: 'unclassified_gateway_order',
        removable: false
    };
}

function isLiveGatewayActivity(order = {}) {
    const gateway = gatewayFromOrder(order);
    const method = order.paymentMethod || order.payment_method;
    if (!isGatewayMethod(method, gateway)) {
        return false;
    }
    const mode = normalize(gateway.mode).toLowerCase();
    const serviceType = normalize(gateway.serviceType);
    return mode === 'live' || serviceType === '112815';
}

module.exports = {
    SYNTHETIC_NAMES,
    classifyOrder,
    gatewayFromOrder,
    isCod,
    isGatewayMethod,
    isLiveGatewayActivity,
    isSyntheticName,
    parseJson
};
