/**
 * Customer-facing checkout payment methods.
 * Online methods (MTN MoMo, Card) are processed by the existing DPO gateway.
 * Cash on Delivery never calls DPO.
 */

const STOREFRONT_METHODS = Object.freeze({
    mtn: {
        id: 'mtn',
        label: 'MTN MoMo',
        paymentType: 'pay_now',
        gateway: 'dpo',
        aliases: Object.freeze(['mtn', 'mtn_momo', 'mtn-momo', 'momo', 'mtn momo'])
    },
    card: {
        id: 'card',
        label: 'Card',
        paymentType: 'pay_now',
        gateway: 'dpo',
        aliases: Object.freeze(['card', 'visa', 'mastercard', 'visa_mastercard', 'visa-mastercard'])
    },
    cod: {
        id: 'cod',
        label: 'Cash on Delivery',
        paymentType: 'cod',
        gateway: null,
        aliases: Object.freeze(['cod', 'cash_on_delivery', 'cash-on-delivery', 'cash', 'cash on delivery'])
    }
});

const ALLOWED_IDS = Object.freeze(Object.keys(STOREFRONT_METHODS));
const REJECTED_IDS = Object.freeze(['airtel', 'bank', 'dpo', 'dpo_pay', 'dpo-pay', 'pay_online', 'pay-online']);

function normalizeKey(value) {
    return String(value == null ? '' : value).trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function findMethodByAlias(value) {
    const key = normalizeKey(value);
    if (!key) return null;
    return ALLOWED_IDS
        .map((id) => STOREFRONT_METHODS[id])
        .find((method) => method.aliases.includes(key) || method.id === key)
        || null;
}

function resolveStorefrontPaymentMethod(value) {
    const key = normalizeKey(value);
    if (!key) {
        return {
            ok: false,
            code: 'PAYMENT_METHOD_REQUIRED',
            message: 'Select a payment method.'
        };
    }

    if (REJECTED_IDS.includes(key)) {
        return {
            ok: false,
            code: 'UNSUPPORTED_PAYMENT_METHOD',
            message: 'That payment method is no longer available. Please try Online Payment or Cash on Delivery.'
        };
    }

    const method = findMethodByAlias(key);
    if (!method) {
        return {
            ok: false,
            code: 'UNSUPPORTED_PAYMENT_METHOD',
            message: 'That payment method is not supported. Please try Online Payment or Cash on Delivery.'
        };
    }

    return {
        ok: true,
        id: method.id,
        label: method.label,
        paymentType: method.paymentType,
        gateway: method.gateway,
        usesDpo: method.gateway === 'dpo'
    };
}

function isGatewayPaymentMethod(value) {
    const resolved = resolveStorefrontPaymentMethod(value);
    return Boolean(resolved.ok && resolved.usesDpo);
}

function isCodPaymentMethod(value) {
    const resolved = resolveStorefrontPaymentMethod(value);
    return Boolean(resolved.ok && resolved.id === 'cod');
}

function storefrontPaymentMethodLabel(value, fallback = '') {
    const resolved = resolveStorefrontPaymentMethod(value);
    if (resolved.ok) return resolved.label;
    const key = normalizeKey(value);
    if (key === 'dpo') return 'Card / MTN MoMo';
    if (key === 'airtel') return 'Airtel Money';
    if (key === 'bank') return 'Bank Transfer';
    return fallback || String(value || '').trim();
}

module.exports = {
    ALLOWED_IDS,
    REJECTED_IDS,
    STOREFRONT_METHODS,
    isCodPaymentMethod,
    isGatewayPaymentMethod,
    resolveStorefrontPaymentMethod,
    storefrontPaymentMethodLabel
};
