const crypto = require('crypto');
const { getSecret } = require('../utils/token');

const SIG_HEX_LENGTH = 32;
const VERIFY_PATH = '/invoice-verify.html';
const PRODUCTION_ORIGIN = 'https://byosemarket.com';

function normalizeText(value) {
    return String(value == null ? '' : value).trim();
}

function deriveSigningKey() {
    return crypto.createHmac('sha256', 'byose-invoice-verify-v1').update(String(getSecret())).digest();
}

function signOrderRef(orderRef) {
    const ref = normalizeText(orderRef);
    if (!ref) return '';
    return crypto.createHmac('sha256', deriveSigningKey()).update(ref).digest('hex').slice(0, SIG_HEX_LENGTH);
}

function signaturesMatch(expected, provided) {
    const left = normalizeText(expected).toLowerCase();
    const right = normalizeText(provided).toLowerCase();
    if (!left || !right || left.length !== right.length) {
        return false;
    }
    try {
        return crypto.timingSafeEqual(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
    } catch (_error) {
        return false;
    }
}

function verifyOrderRef(orderRef, signature) {
    const ref = normalizeText(orderRef);
    if (!ref) return false;
    return signaturesMatch(signOrderRef(ref), signature);
}

function isLocalHost(host) {
    const hostname = String(host || '').split(':')[0].trim().toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
}

function resolvePublicOrigin(_req) {
    return PRODUCTION_ORIGIN;
}

function buildVerificationUrl(orderRef, req) {
    const ref = normalizeText(orderRef);
    const signature = signOrderRef(ref);
    if (!ref || !signature) return '';
    const origin = resolvePublicOrigin(req);
    const params = new URLSearchParams({ ref, sig: signature });
    return `${origin}${VERIFY_PATH}?${params.toString()}`;
}

function isDeliveryConfirmed(order) {
    const values = [
        order?.deliveryStatus,
        order?.shippingStatus,
        order?.status,
        order?.orderStatus
    ];
    return values.some((value) => {
        const status = normalizeText(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (!status) return false;
        if (/(cancel|return|refund)/.test(status)) return false;
        if (/(out for delivery|ready for delivery|awaiting delivery|pending delivery)/.test(status)) return false;
        return status === 'delivered'
            || status === 'completed'
            || status === 'complete'
            || /\bdelivered\b/.test(status)
            || /\bcompleted\b/.test(status);
    });
}

async function buildQrSvg(url) {
    const payload = normalizeText(url);
    if (!payload) return '';
    try {
        const QRCode = require('qrcode');
        return await QRCode.toString(payload, {
            type: 'svg',
            errorCorrectionLevel: 'M',
            margin: 4,
            width: 180,
            color: {
                dark: '#10261c',
                light: '#ffffff'
            }
        });
    } catch (_error) {
        return '';
    }
}

function toLimitedVerification(order) {
    const payment = order?.payment && typeof order.payment === 'object' ? order.payment : {};
    const items = Array.isArray(order?.items)
        ? order.items
        : (Array.isArray(order?.products) ? order.products : []);
    const deliveryStatus = normalizeText(order?.orderStatus || order?.status || order?.deliveryStatus);
    return {
        documentType: 'Invoice & Delivery Confirmation',
        storeName: 'BYOSE Market',
        orderNumber: normalizeText(order?.orderId || order?.id),
        orderDate: order?.createdAt || order?.date || null,
        paymentStatus: normalizeText(order?.paymentStatusLabel || order?.paymentStatus || payment.statusLabel || payment.status),
        deliveryStatus,
        customerConfirmation: isDeliveryConfirmed(order) ? 'Received' : 'Pending',
        currency: normalizeText(order?.currency) || 'RWF',
        total: Number(order?.totalAmount ?? order?.total ?? order?.totalPrice) || 0,
        itemCount: items.length
    };
}

module.exports = {
    SIG_HEX_LENGTH,
    VERIFY_PATH,
    buildQrSvg,
    buildVerificationUrl,
    isDeliveryConfirmed,
    isLocalHost,
    signOrderRef,
    toLimitedVerification,
    verifyOrderRef
};
