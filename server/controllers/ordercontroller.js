const { appLogger, monitorAsyncOperation } = require('../utils/logger');
const orderDataService = require('../services/orderdataservice');
const userDataService = require('../services/userdataservice');
const productDataService = require('../services/productdataservice');
const getRealtimeEventService = require('../services/realtimeeventservice');
const { getRepositoryBundle } = require('../repositories');
const { notifyOrderConfirmed, notifyOrderStatusChanged: notifyOrderStatusEmail } = require('../utils/notifications');
const notificationEngine = require('../services/notification-engine.service');
const { normalizeRwandaPhone, isValidRwandaPhone: isValidSharedRwandaPhone } = require('../utils/phone');

const DELIVERY_FEE = 2000;
const COD_FEE = 0;
const REQUIRED_SHIPPING_FIELDS = ['fullName', 'phone', 'provinceCity', 'district', 'sector', 'cell', 'village'];

async function resolveUser(req) {
    if (!req.user || !req.user.id) return null;
    return userDataService.findUserById(req.user.id);
}

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeEmail(value) {
    return normalizeText(value).toLowerCase();
}

function normalizePhone(value) {
    return normalizeRwandaPhone(value) || String(value || '').replace(/\s+/g, '').trim();
}

function isValidRwandaPhone(value) {
    return isValidSharedRwandaPhone(value);
}

const PAYMENT_STATES = new Set([
    'pending',
    'authorized',
    'paid',
    'failed',
    'refunded',
    'cancelled',
    'awaiting_delivery_payment',
    'awaiting_payment'
]);

function normalizePaymentMethod(value) {
    return normalizeText(value).toLowerCase();
}

function normalizePaymentState(value) {
    const normalized = normalizeText(value).toLowerCase();
    return PAYMENT_STATES.has(normalized) ? normalized : 'pending';
}

function resolvePaymentStatusLabel(paymentState) {
    const state = normalizePaymentState(paymentState);
    if (state === 'awaiting_delivery_payment') return 'Awaiting Delivery Payment';
    if (state === 'awaiting_payment') return 'Awaiting Payment';
    if (state === 'authorized') return 'Authorized';
    if (state === 'paid') return 'Paid';
    if (state === 'failed') return 'Failed';
    if (state === 'refunded') return 'Refunded';
    if (state === 'cancelled') return 'Cancelled';
    return 'Pending';
}

function isDeliveredLike(status) {
    const value = normalizeText(status).toLowerCase();
    return value.includes('deliver') || value === 'completed' || value === 'complete';
}

function isCodOrder(order) {
    const method = normalizePaymentMethod(order?.paymentMethod || order?.payment?.method);
    const label = normalizeText(order?.paymentMethodLabel || order?.payment?.methodLabel).toLowerCase();
    return method === 'cod' || label.includes('cash on delivery') || label.includes('cash');
}

function isAwaitingPaymentStatus(value) {
    const status = normalizeText(value).toLowerCase();
    return status === 'awaiting_payment'
        || status === 'awaiting_delivery_payment'
        || status === 'pending'
        || status === 'unpaid';
}

function applyPaymentStatusUpdate(order, paymentStatus) {
    const raw = normalizeText(paymentStatus).toLowerCase();
    const allowed = new Set([
        'pending',
        'authorized',
        'paid',
        'failed',
        'refunded',
        'cancelled',
        'awaiting_delivery_payment',
        'awaiting_payment',
        'unpaid',
        'refund_required'
    ]);
    if (!allowed.has(raw)) {
        const error = new Error('Invalid payment status.');
        error.code = 'INVALID_PAYMENT_STATUS';
        throw error;
    }

    const nextStatus = raw === 'unpaid' ? 'unpaid' : (PAYMENT_STATES.has(raw) || raw === 'refund_required' || raw === 'unpaid' ? raw : 'pending');
    const label = raw === 'unpaid'
        ? 'Unpaid'
        : raw === 'refund_required'
            ? 'Refund Required'
            : resolvePaymentStatusLabel(nextStatus);

    order.paymentStatus = nextStatus;
    order.paymentStatusLabel = label;
    order.payment = {
        ...(order.payment && typeof order.payment === 'object' ? order.payment : {}),
        status: nextStatus,
        statusLabel: label,
        transaction: {
            ...((order.payment && typeof order.payment === 'object' && order.payment.transaction) || {}),
            state: nextStatus
        }
    };
    return order;
}

function maybeConfirmCodPaymentOnDelivery(order, nextStatus) {
    if (!isDeliveredLike(nextStatus) || !isCodOrder(order)) {
        return false;
    }
    const current = normalizeText(order.paymentStatus || order.payment?.status).toLowerCase();
    if (!isAwaitingPaymentStatus(current)) {
        return false;
    }
    applyPaymentStatusUpdate(order, 'paid');
    return true;
}

function validateShippingAddress(shippingAddress = {}, paymentMethod = '') {
    const errors = [];
    REQUIRED_SHIPPING_FIELDS.forEach((field) => {
        if (!normalizeText(shippingAddress[field] || (field === 'provinceCity' ? shippingAddress.city : ''))) {
            errors.push(`${field} is required`);
        }
    });

    const phone = normalizePhone(shippingAddress.phone);
    if (!isValidRwandaPhone(phone)) {
        errors.push('Enter a valid Rwanda phone number');
    }

    if (paymentMethod === 'cod') {
        const city = normalizeText(shippingAddress.provinceCity || shippingAddress.city).toLowerCase();
        if (!city.includes('kigali')) {
            errors.push('Cash on Delivery is only available in Kigali');
        }
    }

    return errors;
}

async function applyCatalogPricing(items = []) {
    const source = Array.isArray(items) ? items : [];
    const uniqueIds = Array.from(new Set(source.map((item) => normalizeText(item.productId)).filter(Boolean)));
    const catalogById = new Map();

    await Promise.all(uniqueIds.map(async (productId) => {
        const product = await productDataService.findProductByIdentifier(productId);
        if (product) {
            catalogById.set(productId, product);
            const catalogId = normalizeText(product.catalogId || product.id);
            if (catalogId) {
                catalogById.set(catalogId, product);
            }
        }
    }));

    return source.map((item) => {
        const productId = normalizeText(item.productId);
        if (!productId) {
            const error = new Error('Order item is missing productId');
            error.code = 'INVALID_ORDER_ITEM';
            throw error;
        }

        const product = catalogById.get(productId);
        if (!product) {
            const error = new Error(`Product not found: ${productId}`);
            error.code = 'PRODUCT_NOT_FOUND';
            error.productId = productId;
            throw error;
        }

        const unitPrice = Number(product.price ?? product.discountPrice ?? 0) || 0;
        if (unitPrice <= 0) {
            const error = new Error(`Product has invalid catalog price: ${productId}`);
            error.code = 'INVALID_ORDER_ITEM';
            error.productId = productId;
            throw error;
        }

        return {
            ...item,
            productId,
            productName: normalizeText(product.name || product.title) || item.productName || 'Product',
            price: unitPrice,
            image: normalizeText(item.image || product.mainImage || product.image),
            slug: normalizeText(item.slug || product.slug || product.metadata?.slug),
            category: normalizeText(item.category || product.category)
        };
    });
}

function isCancelledLike(status) {
    const value = normalizeText(status).toLowerCase();
    // Returns/refunds use returnAction workflow — do not treat them as cancellations.
    return value.includes('cancel') && !value.includes('return') && !value.includes('refund');
}

function restoreOrderStock(order) {
    const items = Array.isArray(order?.items) ? order.items : (Array.isArray(order?.products) ? order.products : []);
    if (!items.length) return;
    const { products } = getRepositoryBundle();
    products.restoreStockForOrderItems(items);
}

function normalizeItems(items) {
    const source = Array.isArray(items) ? items : [];

    return source
        .map((item) => {
            const attributes = item?.attributes && typeof item.attributes === 'object' ? item.attributes : {};
            const image = normalizeText(item?.image || item?.img || item?.imageUrl || item?.productImage || item?.mainImage || item?.thumbnail || item?.colorImage || attributes.colorImage);
            const productUrl = normalizeText(item?.productUrl || item?.productLink || attributes.productUrl || attributes.productLink);
            const sku = normalizeText(item?.sku || item?.variantSku || attributes.SKU || attributes.sku);
            const category = normalizeText(item?.category || attributes.Category || attributes.category);
            const colorName = normalizeText(item?.colorName || item?.color || attributes.Color);
            const sizeLabel = normalizeText(item?.sizeLabel || item?.size || attributes.Size);

            return {
                productId: normalizeText(item?.productId || item?.id),
                productName: normalizeText(item?.productName || item?.name) || 'Product',
                quantity: Math.max(1, Number(item?.quantity || item?.qty || 1) || 1),
                price: Number(item?.price || 0) || 0,
                image,
                colorImage: normalizeText(item?.colorImage || attributes.colorImage),
                color: colorName,
                colorName,
                size: sizeLabel,
                sizeLabel,
                sku,
                variantSku: sku,
                category,
                productUrl,
                productLink: productUrl,
                slug: normalizeText(item?.slug),
                attributeSummary: normalizeText(item?.attributeSummary),
                attributes: {
                    ...attributes,
                    Color: colorName || attributes.Color,
                    Size: sizeLabel || attributes.Size,
                    SKU: sku || attributes.SKU,
                    Category: category || attributes.Category,
                    productUrl,
                    productLink: productUrl,
                    colorImage: normalizeText(item?.colorImage || attributes.colorImage)
                }
            };
        })
        .filter((item) => item.productId || item.productName);
}

function normalizeStorefrontOrder(payload, user) {
    const source = payload && typeof payload === 'object' && payload.order && typeof payload.order === 'object'
        ? payload.order
        : payload || {};
    const customer = source.customer && typeof source.customer === 'object' ? source.customer : {};
    const shippingAddress = source.shippingAddress && typeof source.shippingAddress === 'object' ? source.shippingAddress : {};
    const items = normalizeItems(Array.isArray(source.items) && source.items.length ? source.items : source.products);
    // Authenticated users always bind to their account; guests cannot spoof a customerId.
    const customerId = user?.id
        ? normalizeText(user.id)
        : '';
    const customerEmail = user?.email
        ? normalizeEmail(user.email)
        : normalizeEmail(source.customerEmail || source.userEmail || customer.email);
    const customerPhone = normalizePhone(
        shippingAddress.phone
        || source.customerPhone
        || source.phoneNumber
        || customer.phone
        || user?.phone
    );
    const createdAt = source.createdAt || source.date || source.timestamp || new Date().toISOString();
    const subtotal = items.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
    );
    // Never accept delivery totals from the client blindly — createOrder recalculates
    // shipping using Delivery Settings. Placeholder fee kept for interim totals only.
    const shippingFee = DELIVERY_FEE;
    const codFee = COD_FEE;
    const total = subtotal + shippingFee + codFee;
    const paymentMethod = normalizePaymentMethod(source.paymentMethod || source.payment?.method);
    let paymentStatus = normalizePaymentState(source.paymentStatus || source.payment?.status || source.payment?.transaction?.state);
    let paymentStatusLabel = normalizeText(source.paymentStatusLabel || source.payment?.statusLabel) || resolvePaymentStatusLabel(paymentStatus);
    if (paymentMethod === 'cod' && (paymentStatus === 'pending' || !source.paymentStatus)) {
        paymentStatus = 'awaiting_delivery_payment';
        paymentStatusLabel = 'Awaiting Delivery Payment';
    } else if (paymentMethod && paymentMethod !== 'cod' && (paymentStatus === 'pending' || !source.paymentStatus)) {
        paymentStatus = 'awaiting_payment';
        paymentStatusLabel = 'Awaiting Payment';
    }
    const paymentTransaction = source.payment?.transaction && typeof source.payment.transaction === 'object'
        ? source.payment.transaction
        : {};
    const deliveryMethodKey = normalizeText(source.deliveryMethodKey || source.deliveryMethod || 'homeDelivery') || 'homeDelivery';

    return {
        id: normalizeText(source.id || source.orderId),
        orderId: normalizeText(source.orderId || source.id),
        user: user?._id || null,
        userId: customerId,
        accountId: normalizeText(source.accountId || customerId),
        customerId,
        isGuest: !customerId,
        userEmail: customerEmail,
        customerEmail,
        customerPhone,
        phoneNumber: customerPhone,
        customerName: normalizeText(shippingAddress.fullName || source.customerName || customer.name || user?.name) || 'Guest Customer',
        customerImage: normalizeText(source.customerImage || customer.avatar || customer.image || user?.avatar),
        status: 'Pending',
        orderStatus: 'pending',
        paymentStatus,
        paymentStatusLabel,
        paymentMethod,
        paymentType: paymentMethod === 'cod' ? 'cod' : 'pay_now',
        note: normalizeText(source.note || source.payment?.note),
        subtotal,
        deliveryFee: shippingFee,
        shippingFee,
        codFee,
        couponCode: normalizeText(source.couponCode || source.coupon?.code).toUpperCase(),
        couponDiscount: 0,
        couponId: null,
        total,
        totalAmount: total,
        totalPrice: total,
        deliveryMethod: deliveryMethodKey === 'storePickup' ? 'pickup' : 'delivery',
        deliveryMethodKey,
        deliveryLabel: normalizeText(source.deliveryLabel) || (deliveryMethodKey === 'storePickup' ? 'Store Pickup' : 'Delivery to address'),
        items,
        products: items,
        shippingAddress: {
            ...shippingAddress,
            fullName: normalizeText(shippingAddress.fullName || source.customerName || customer.name || user?.name),
            phone: customerPhone,
            country: normalizeText(shippingAddress.country || 'Rwanda'),
            provinceCity: normalizeText(shippingAddress.provinceCity || shippingAddress.city),
            city: normalizeText(shippingAddress.provinceCity || shippingAddress.city),
            district: normalizeText(shippingAddress.district),
            sector: normalizeText(shippingAddress.sector),
            cell: normalizeText(shippingAddress.cell),
            village: normalizeText(shippingAddress.village),
            note: normalizeText(shippingAddress.note)
        },
        fullAddress: source.fullAddress && typeof source.fullAddress === 'object' ? source.fullAddress : {
            province: normalizeText(shippingAddress.provinceCity || shippingAddress.city),
            district: normalizeText(shippingAddress.district),
            sector: normalizeText(shippingAddress.sector),
            cell: normalizeText(shippingAddress.cell),
            village: normalizeText(shippingAddress.village),
            note: normalizeText(shippingAddress.note)
        },
        gpsLocation: source.gpsLocation && typeof source.gpsLocation === 'object' ? source.gpsLocation : {},
        payment: source.payment && typeof source.payment === 'object'
            ? {
                ...source.payment,
                method: paymentMethod,
                status: paymentStatus,
                statusLabel: paymentStatusLabel,
                transaction: paymentTransaction && typeof paymentTransaction === 'object'
                    ? {
                        ...paymentTransaction,
                        state: normalizePaymentState(paymentTransaction.state || paymentStatus)
                    }
                    : { state: paymentStatus }
            }
            : {
                method: paymentMethod,
                status: paymentStatus,
                statusLabel: paymentStatusLabel,
                transaction: { state: paymentStatus }
            },
        customer: {
            id: customerId,
            name: normalizeText(shippingAddress.fullName || source.customerName || customer.name || user?.name) || 'Guest Customer',
            email: customerEmail,
            phone: customerPhone,
            isGuest: !customerId
        },
        statusHistory: Array.isArray(source.statusHistory) ? source.statusHistory : [],
        createdAt: new Date(createdAt),
        updatedAt: new Date(source.updatedAt || createdAt)
    };
}

function appendStatusHistory(order, status, meta = {}) {
    const normalizedStatus = normalizeText(status);
    const timestamp = new Date().toISOString();
    const nextHistory = Array.isArray(order.statusHistory) ? order.statusHistory.slice() : [];
    const actor = normalizeText(meta.actor || meta.cancelledBy);
    const reason = normalizeText(meta.reason || meta.cancellationReason || meta.note);

    nextHistory.push({
        status: normalizedStatus.toLowerCase(),
        label: normalizedStatus,
        timestamp,
        actor: actor || undefined,
        reason: reason || undefined,
        note: reason || normalizeText(meta.note) || undefined
    });

    order.status = normalizedStatus || order.status;
    order.orderStatus = normalizedStatus.toLowerCase() || order.orderStatus;
    order.updatedAt = new Date(timestamp);
    order.statusHistory = nextHistory;
}

function applyCancellationMetadata(order, meta = {}) {
    const timestamp = new Date().toISOString();
    const actor = normalizeText(meta.actor || meta.cancelledBy) || 'Admin';
    const reason = normalizeText(meta.reason || meta.cancellationReason || meta.note)
        || (actor.toLowerCase() === 'customer' ? 'Cancelled by customer' : 'Cancelled by administrator');
    const paymentStatus = normalizeText(order.paymentStatus || order.payment?.status).toLowerCase();
    const wasPaid = paymentStatus.includes('paid')
        || paymentStatus.includes('confirm')
        || paymentStatus.includes('complete')
        || paymentStatus.includes('success');

    order.cancelledAt = timestamp;
    order.cancelledBy = actor;
    order.cancellationReason = reason;
    order.payment = {
        ...(order.payment && typeof order.payment === 'object' ? order.payment : {}),
        cancellation: {
            cancelledBy: actor,
            reason,
            cancelledAt: timestamp,
            adminId: normalizeText(meta.adminId),
            refundRequired: wasPaid,
            previousPaymentStatus: order.paymentStatus || order.payment?.status || ''
        }
    };

    if (wasPaid) {
        order.paymentStatus = 'refund_required';
        order.paymentStatusLabel = 'Refund Required';
        const workflow = ensureReturnWorkflow(order);
        workflow.refundStatus = workflow.refundStatus || 'required';
        workflow.returnStatus = workflow.returnStatus || 'requested';
        workflow.returnRequestedAt = workflow.returnRequestedAt || timestamp;
        workflow.returnReason = workflow.returnReason || reason;
        workflow.stockRestored = true;
        order.payment.returnWorkflow = workflow;
    }
}

function clearCancellationMetadata(order) {
    if (order.payment && typeof order.payment === 'object') {
        const previous = normalizeText(order.payment.cancellation?.previousPaymentStatus);
        const nextPayment = { ...order.payment };
        delete nextPayment.cancellation;
        // Restoring a cancelled order removes it from the Returns & Refunds queue
        // unless a refund was already completed.
        const refundDone = String(nextPayment.returnWorkflow?.refundStatus || '').toLowerCase() === 'completed'
            || String(order.paymentStatus || '').toLowerCase() === 'refunded';
        if (!refundDone) {
            delete nextPayment.returnWorkflow;
        }
        order.payment = nextPayment;
        if (previous) {
            order.paymentStatus = previous;
            order.paymentStatusLabel = resolvePaymentStatusLabel(previous);
        }
    }
    order.cancelledAt = '';
    order.cancelledBy = '';
    order.cancellationReason = '';
}

function ensureReturnWorkflow(order) {
    order.payment = order.payment && typeof order.payment === 'object' ? order.payment : {};
    if (!order.payment.returnWorkflow || typeof order.payment.returnWorkflow !== 'object') {
        order.payment.returnWorkflow = {};
    }
    return order.payment.returnWorkflow;
}

function applyReturnAction(order, action, meta = {}) {
    const workflow = ensureReturnWorkflow(order);
    const now = new Date().toISOString();
    const adminId = normalizeText(meta.adminId);
    const reason = normalizeText(meta.reason || meta.note || meta.adminNotes);
    const adminNotes = normalizeText(meta.adminNotes || meta.note || meta.reason);
    const normalizedAction = normalizeText(action).toLowerCase();

    if (normalizedAction === 'open_return' || normalizedAction === 'request_return') {
        if (['approved', 'received'].includes(String(workflow.returnStatus || '').toLowerCase())
            || ['completed'].includes(String(workflow.refundStatus || '').toLowerCase())) {
            const error = new Error('A return or refund is already in progress or completed for this order.');
            error.code = 'DUPLICATE_RETURN';
            throw error;
        }
        workflow.returnStatus = 'requested';
        workflow.returnRequestedAt = workflow.returnRequestedAt || now;
        workflow.returnReason = reason || workflow.returnReason || 'Return requested';
        workflow.customerNotes = normalizeText(meta.customerNotes) || workflow.customerNotes || '';
        workflow.productCondition = normalizeText(meta.productCondition) || workflow.productCondition || 'Not specified';
        workflow.returnImages = Array.isArray(meta.returnImages) ? meta.returnImages : (Array.isArray(workflow.returnImages) ? workflow.returnImages : []);
        if (!workflow.refundStatus || workflow.refundStatus === 'rejected') {
            workflow.refundStatus = 'required';
        }
        appendStatusHistory(order, 'Return Requested', { actor: 'Admin', adminId, reason: workflow.returnReason });
        order.payment.returnWorkflow = workflow;
        return workflow;
    }

    if (normalizedAction === 'approve_return') {
        workflow.returnStatus = 'approved';
        workflow.returnApprovedAt = now;
        workflow.adminNotes = adminNotes || workflow.adminNotes || '';
        order.status = 'Returned';
        order.orderStatus = 'returned';
        if (!order.payment?.cancellation?.cancelledAt && !workflow.stockRestored) {
            restoreOrderStock(order);
            workflow.stockRestored = true;
        }
        if (!workflow.refundStatus || workflow.refundStatus === 'rejected') {
            workflow.refundStatus = 'required';
        }
        appendStatusHistory(order, 'Returned', { actor: 'Admin', adminId, reason: adminNotes || 'Return approved' });
        order.payment.returnWorkflow = workflow;
        return workflow;
    }

    if (normalizedAction === 'reject_return') {
        workflow.returnStatus = 'rejected';
        workflow.returnRejectedAt = now;
        workflow.adminNotes = adminNotes || workflow.adminNotes || '';
        appendStatusHistory(order, 'Return Rejected', { actor: 'Admin', adminId, reason: adminNotes || 'Return rejected' });
        order.payment.returnWorkflow = workflow;
        return workflow;
    }

    if (normalizedAction === 'approve_refund') {
        const refundStatus = String(workflow.refundStatus || order.paymentStatus || '').toLowerCase();
        if (refundStatus === 'completed' || refundStatus === 'refunded' || String(order.paymentStatus || '').toLowerCase() === 'refunded') {
            const error = new Error('Refund already completed for this order.');
            error.code = 'DUPLICATE_REFUND';
            throw error;
        }
        workflow.refundStatus = 'completed';
        workflow.refundApprovedAt = now;
        workflow.refundDate = now;
        workflow.refundAmount = Number(meta.refundAmount ?? order.totalAmount ?? order.total ?? 0) || 0;
        workflow.refundMethod = normalizeText(meta.refundMethod) || normalizeText(order.paymentMethod) || 'original_payment';
        workflow.adminNotes = adminNotes || workflow.adminNotes || '';
        order.paymentStatus = 'refunded';
        order.paymentStatusLabel = 'Refunded';
        order.status = 'Refunded';
        order.orderStatus = 'refunded';
        appendStatusHistory(order, 'Refunded', { actor: 'Admin', adminId, reason: adminNotes || 'Refund approved' });
        order.payment.returnWorkflow = workflow;
        return workflow;
    }

    if (normalizedAction === 'reject_refund') {
        workflow.refundStatus = 'rejected';
        workflow.refundRejectedAt = now;
        workflow.adminNotes = adminNotes || workflow.adminNotes || '';
        appendStatusHistory(order, 'Refund Rejected', { actor: 'Admin', adminId, reason: adminNotes || 'Refund rejected' });
        order.payment.returnWorkflow = workflow;
        return workflow;
    }

    const error = new Error('Unknown return action');
    error.code = 'INVALID_RETURN_ACTION';
    throw error;
}

exports.createOrder = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'orders' });
    try {
        const generalSettingsService = require('../services/generalsettings.service');
        const platformSettings = await generalSettingsService.getGeneralSettings();
        if (platformSettings.maintenanceMode) {
            return res.status(503).json({
                success: false,
                code: 'MAINTENANCE_MODE',
                message: 'Ordering is temporarily unavailable while maintenance is in progress.'
            });
        }
        if (platformSettings.storeStatus === 'closed') {
            return res.status(503).json({
                success: false,
                code: 'STORE_CLOSED',
                message: 'The store is currently closed and not accepting orders.'
            });
        }

        const user = await monitorAsyncOperation(logger, 'database.user.resolve_for_order', {}, () => resolveUser(req), { slowThresholdMs: 500 });
        let normalizedOrder = normalizeStorefrontOrder(req.body, user);

        if (!normalizedOrder.customerId && !platformSettings.allowGuestCheckout) {
            return res.status(403).json({
                success: false,
                code: 'GUEST_CHECKOUT_DISABLED',
                message: 'Guest checkout is disabled. Please sign in to place an order.'
            });
        }

        const defaultOrderStatus = String(platformSettings.defaultOrderStatus || 'Pending').trim() || 'Pending';
        normalizedOrder.status = defaultOrderStatus;
        normalizedOrder.orderStatus = defaultOrderStatus.toLowerCase();

        const defaultPaymentStatus = String(platformSettings.defaultPaymentStatus || 'pending').trim().toLowerCase();
        if (defaultPaymentStatus === 'paid') {
            normalizedOrder.paymentStatus = 'paid';
            normalizedOrder.paymentStatusLabel = 'Paid';
        } else if (defaultPaymentStatus === 'unpaid' && String(normalizedOrder.paymentStatus || '').toLowerCase() === 'pending') {
            normalizedOrder.paymentStatus = 'unpaid';
            normalizedOrder.paymentStatusLabel = 'Unpaid';
        }

        if (!normalizedOrder.orderId) {
            return res.status(400).json({ success: false, message: 'orderId required' });
        }

        if (!normalizedOrder.items.length) {
            return res.status(400).json({ success: false, message: 'items required' });
        }

        if (!normalizedOrder.customerName || !normalizedOrder.customerPhone) {
            return res.status(400).json({ success: false, message: 'customer details required' });
        }

        if (!isValidRwandaPhone(normalizedOrder.customerPhone)) {
            return res.status(400).json({ success: false, message: 'Enter a valid Rwanda phone number' });
        }

        const shippingErrors = validateShippingAddress(normalizedOrder.shippingAddress, normalizedOrder.paymentMethod);
        if (shippingErrors.length) {
            return res.status(400).json({ success: false, message: shippingErrors[0], errors: shippingErrors });
        }

        if (!normalizedOrder.paymentMethod) {
            return res.status(400).json({ success: false, message: 'payment method required' });
        }

        try {
            const pricedItems = await applyCatalogPricing(normalizedOrder.items);
            const subtotal = pricedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
            const deliverySettingsService = require('../services/deliverysettings.service');
            const shippingQuote = await deliverySettingsService.calculateShipping({
                subtotal,
                address: normalizedOrder.shippingAddress || {},
                method: normalizedOrder.deliveryMethodKey || 'homeDelivery'
            });
            const shippingFee = Number(shippingQuote.fee) || 0;
            let couponCode = normalizeText(normalizedOrder.couponCode).toUpperCase();
            let couponDiscount = 0;
            let couponId = null;

            if (couponCode) {
                if (!user?.recordId) {
                    return res.status(401).json({
                        success: false,
                        code: 'COUPON_LOGIN_REQUIRED',
                        message: 'Sign in to use a coupon.'
                    });
                }

                const couponDataService = require('../services/coupondataservice');
                const validation = await couponDataService.validateCouponForCheckout(user, {
                    code: couponCode,
                    subtotal,
                    orderAmount: subtotal,
                    items: pricedItems
                });

                if (validation.error) {
                    return res.status(validation.status || 400).json({
                        success: false,
                        code: 'COUPON_INVALID',
                        message: validation.error
                    });
                }

                couponDiscount = Number(validation.data.discountAmount || 0);
                couponId = validation.data.coupon?.id || null;
                couponCode = validation.data.coupon?.code || couponCode;
            }

            const total = Math.max(0, subtotal - couponDiscount) + shippingFee + COD_FEE;
            normalizedOrder = {
                ...normalizedOrder,
                items: pricedItems,
                products: pricedItems,
                subtotal,
                deliveryFee: shippingFee,
                shippingFee,
                codFee: COD_FEE,
                couponCode,
                couponDiscount,
                couponId,
                total,
                totalAmount: total,
                totalPrice: total,
                deliveryLabel: shippingQuote.methodLabel || normalizedOrder.deliveryLabel,
                shippingQuote: {
                    zoneId: shippingQuote.zone?.id || '',
                    zoneName: shippingQuote.zone?.name || '',
                    estimatedDelivery: shippingQuote.estimatedDelivery || '',
                    freeDeliveryApplied: Boolean(shippingQuote.freeDeliveryApplied),
                    pricingMode: shippingQuote.pricingMode || ''
                }
            };
        } catch (pricingError) {
            if (pricingError?.statusCode && pricingError.statusCode < 500) {
                return res.status(pricingError.statusCode).json({
                    success: false,
                    code: pricingError.code || 'SHIPPING_CALCULATION_FAILED',
                    message: pricingError.message || 'Unable to calculate shipping',
                    details: pricingError.details || undefined
                });
            }
            if (pricingError?.code === 'PRODUCT_NOT_FOUND' || pricingError?.code === 'INVALID_ORDER_ITEM') {
                return res.status(409).json({
                    success: false,
                    message: pricingError.message,
                    code: pricingError.code,
                    productId: pricingError.productId || null
                });
            }
            throw pricingError;
        }

        const existingOrder = await monitorAsyncOperation(logger, 'database.order.find_by_order_id', { orderId: normalizedOrder.orderId }, () => orderDataService.findOrderByIdentifier(normalizedOrder.orderId), { slowThresholdMs: 700 });
        if (existingOrder) {
            logger.warn('order.duplicate_submission', {
                orderId: normalizedOrder.orderId,
                customerId: normalizedOrder.customerId,
                paymentMethod: normalizedOrder.paymentMethod,
                paymentType: normalizedOrder.paymentType
            });

            // Heal coupon redemption if a prior create succeeded but redeem failed.
            if (normalizedOrder.couponCode && user?.recordId) {
                try {
                    const couponDataService = require('../services/coupondataservice');
                    await couponDataService.redeemCouponForOrder(user, {
                        code: normalizedOrder.couponCode || existingOrder.couponCode,
                        orderId: normalizedOrder.orderId,
                        discountAmount: Number(existingOrder.couponDiscount || normalizedOrder.couponDiscount || 0),
                        subtotal: Number(existingOrder.subtotal || normalizedOrder.subtotal || 0),
                        items: existingOrder.items || normalizedOrder.items
                    });
                } catch (couponError) {
                    logger.warn('order.coupon_redeem_retry_failed', {
                        error: couponError,
                        orderId: normalizedOrder.orderId
                    });
                }
            }

            return res.json({ success: true, existing: true, order: existingOrder });
        }

        await monitorAsyncOperation(logger, 'database.order.create', {
            orderId: normalizedOrder.orderId,
            customerId: normalizedOrder.customerId,
            paymentMethod: normalizedOrder.paymentMethod,
            paymentType: normalizedOrder.paymentType,
            totalAmount: normalizedOrder.totalAmount
        }, () => orderDataService.createOrder({
            ...normalizedOrder,
            userRecordId: user?.recordId || null
        }), { slowThresholdMs: 700 });

        if (normalizedOrder.couponCode && user?.recordId) {
            const couponDataService = require('../services/coupondataservice');
            let redemption;
            try {
                redemption = await couponDataService.redeemCouponForOrder(user, {
                    code: normalizedOrder.couponCode,
                    orderId: normalizedOrder.orderId,
                    discountAmount: normalizedOrder.couponDiscount,
                    subtotal: normalizedOrder.subtotal,
                    items: normalizedOrder.items
                });
            } catch (couponError) {
                logger.error('order.coupon_redeem_exception', {
                    error: couponError,
                    orderId: normalizedOrder.orderId,
                    couponCode: normalizedOrder.couponCode
                });
                redemption = { error: 'Unable to redeem coupon for this order.', status: 500 };
            }

            if (redemption?.error) {
                logger.warn('order.coupon_redeem_failed_rollback', {
                    orderId: normalizedOrder.orderId,
                    couponCode: normalizedOrder.couponCode,
                    message: redemption.error
                });

                try {
                    const couponDataService = require('../services/coupondataservice');
                    await couponDataService.releaseCouponForOrder(normalizedOrder.orderId);
                } catch (releaseError) {
                    logger.warn('order.coupon_release_on_rollback_failed', {
                        error: releaseError,
                        orderId: normalizedOrder.orderId
                    });
                }

                try {
                    const { getRepositoryBundle } = require('../repositories');
                    const { orders, products } = getRepositoryBundle();
                    const created = await orderDataService.findOrderByIdentifier(normalizedOrder.orderId);
                    const items = Array.isArray(created?.items) ? created.items : (normalizedOrder.items || []);

                    // Delete order first, then restore stock — avoids orphan order with restored inventory.
                    if (orders?.remove) {
                        await orders.remove(normalizedOrder.orderId);
                    }
                    if (items.length && products?.restoreStockForOrderItems) {
                        products.restoreStockForOrderItems(items);
                    }
                } catch (rollbackError) {
                    logger.error('order.coupon_redeem_rollback_failed', {
                        error: rollbackError,
                        orderId: normalizedOrder.orderId
                    });
                }

                return res.status(redemption.status || 400).json({
                    success: false,
                    code: 'COUPON_REDEEM_FAILED',
                    message: redemption.error || 'Unable to apply this coupon to your order. Please try again.'
                });
            }
        }

        const order = await orderDataService.findOrderByIdentifier(normalizedOrder.orderId);

        logger.info('order.created', {
            orderId: normalizedOrder.orderId,
            customerId: normalizedOrder.customerId,
            paymentMethod: normalizedOrder.paymentMethod,
            paymentType: normalizedOrder.paymentType,
            paymentStatus: normalizedOrder.paymentStatus,
            totalAmount: normalizedOrder.totalAmount,
            itemCount: normalizedOrder.items.length
        });

        // Emit realtime event
        try {
          const realtimeService = getRealtimeEventService();
          realtimeService.emitOrderCreated(order);
        } catch (eventError) {
          logger.warn('realtime.event_emit_failed', { error: eventError, scope: 'order.created' });
        }

        void notificationEngine.notifyOrderCreated(order).catch((engineError) => {
          logger.warn('notification.engine.order_created_failed', { error: engineError, orderId: normalizedOrder.orderId });
        });

        // Best-effort low / out-of-stock alerts for items depleted by this order
        void (async () => {
          try {
            const items = Array.isArray(order?.items) ? order.items : [];
            const seen = new Set();
            const products = [];
            for (const item of items) {
              const key = String(item?.productId || item?.catalogId || item?.id || '').trim();
              if (!key || seen.has(key)) continue;
              seen.add(key);
              const product = await productDataService.findProductByIdentifier(key);
              if (product) products.push(product);
            }
            if (products.length) {
              await notificationEngine.notifyStockFromOrderItems(products, items);
            }
          } catch (stockNotifyError) {
            logger.warn('notification.engine.stock_after_order_failed', { error: stockNotifyError, orderId: normalizedOrder.orderId });
          }
        })();

        void notifyOrderConfirmed(order).catch((notifyError) => {
          logger.warn('notification.order_confirmed_failed', { error: notifyError, orderId: normalizedOrder.orderId });
        });

        return res.json({ success: true, order });
    } catch (err) {
        logger.error('order.create_failed', { error: err });
        if (err?.code === 'INSUFFICIENT_STOCK' || err?.code === 'PRODUCT_NOT_FOUND' || err?.code === 'INVALID_ORDER_ITEM') {
            return res.status(409).json({
                success: false,
                message: err.message || 'Unable to place order due to stock availability.',
                code: err.code,
                productId: err.productId || null,
                available: Number.isFinite(err.available) ? err.available : undefined
            });
        }
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get orders for logged-in user
exports.getUserOrders = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'orders' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const orders = await monitorAsyncOperation(logger, 'database.order.list_for_user', { userId: user.id }, () => orderDataService.listOrdersForUser(user), { slowThresholdMs: 700 });
        return res.json({ success: true, orders });
    } catch (err) {
        logger.error('order.list_for_user_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Update order status (admin or owner)
exports.updateOrderStatus = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'orders' });
    try {
        const { status } = req.body || {};
        if (!status) return res.status(400).json({ success: false, message: 'status required' });

        const user = await resolveUser(req);
        if (!user) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const order = await orderDataService.findOrderByIdentifier(req.params.id);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        const ownedOrders = await orderDataService.listOrdersForUser(user);
        const ownsOrder = ownedOrders.some((entry) => String(entry.orderId || entry.id) === String(order.orderId || order.id));

        if (!ownsOrder) {
            logger.warn('order.status_update_forbidden', {
                requestedOrderId: req.params.id,
                userId: user.id,
                status
            });
            return res.status(403).json({ success: false, message: 'Unauthorized to update this order' });
        }

        const requestedStatus = normalizeText(status).toLowerCase();
        const currentStatus = normalizeText(order.orderStatus || order.status).toLowerCase();
        const cancellableStatuses = new Set(['pending', 'confirmed', 'processing']);
        if (requestedStatus !== 'cancelled' || !cancellableStatuses.has(currentStatus)) {
            return res.status(409).json({
                success: false,
                message: 'Only pending, confirmed, or processing orders can be cancelled by the customer'
            });
        }

        const previousPaymentStatus = order.paymentStatus || order.payment?.status || '';
        appendStatusHistory(order, 'Cancelled', {
            actor: 'Customer',
            reason: normalizeText(req.body?.reason || req.body?.cancellationReason) || 'Cancelled by customer'
        });
        applyCancellationMetadata(order, {
            actor: 'Customer',
            reason: normalizeText(req.body?.reason || req.body?.cancellationReason) || 'Cancelled by customer'
        });
        try {
            restoreOrderStock(order);
        } catch (stockError) {
            logger.warn('order.stock_restore_failed', { error: stockError, orderId: order.orderId || order.id });
        }
        try {
            const couponDataService = require('../services/coupondataservice');
            await couponDataService.releaseCouponForOrder(order.orderId || order.id);
        } catch (couponError) {
            logger.warn('order.coupon_release_failed', { error: couponError, orderId: order.orderId || order.id });
        }
        await monitorAsyncOperation(logger, 'database.order.save_status_user', { orderId: order.orderId || order.id, status }, () => orderDataService.saveOrder(order), { slowThresholdMs: 700 });
        logger.info('order.status_updated_by_customer', { orderId: order.orderId || order.id, userId: user.id, status });

        try {
          const realtimeService = getRealtimeEventService();
          realtimeService.emitOrderStatusChanged(order._id || order.id, currentStatus, 'Cancelled');
        } catch (eventError) {
          logger.warn('realtime.event_emit_failed', { error: eventError, scope: 'order.status-changed.customer' });
        }

        const refundRequested = String(order.paymentStatus || '').toLowerCase() === 'refund_required'
            || String(order.payment?.returnWorkflow?.refundStatus || '').toLowerCase() === 'required';

        void notificationEngine.notifyOrderStatusChanged(order, currentStatus, {
          returnAction: refundRequested ? 'request_return' : '',
          previousPaymentStatus,
          refundRequested
        }).catch((engineError) => {
          logger.warn('notification.engine.order_status_failed', { error: engineError, orderId: order.orderId || order.id });
        });

        void notifyOrderStatusEmail(order, 'Cancelled').catch((notifyError) => {
            logger.warn('notification.order_status_failed', { error: notifyError, orderId: order.orderId || order.id });
        });
        return res.json({ success: true, order });
    } catch (err) {
        logger.error('order.status_update_by_customer_failed', { error: err, requestedOrderId: req.params.id });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getAdminOrders = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_orders' });
    try {
        const limit = Math.min(500, Math.max(1, Number(req.query?.limit || 500) || 500));
        const page = Math.max(1, Number(req.query?.page || 1) || 1);
        const skip = (page - 1) * limit;
        const orders = await monitorAsyncOperation(logger, 'database.order.list_admin', { adminId: req.admin?.id || '', limit, page }, () => orderDataService.listAdminOrders({ limit, page }), { slowThresholdMs: 900 });
        return res.json({ success: true, orders });
    } catch (err) {
        logger.error('admin.order_list_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getAdminOrderById = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_orders' });
    try {
        const order = await monitorAsyncOperation(logger, 'database.order.find_admin', { requestedOrderId: req.params.id }, () => orderDataService.findOrderByIdentifier(req.params.id), { slowThresholdMs: 700 });
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        return res.json({ success: true, order });
    } catch (err) {
        logger.error('admin.order_lookup_failed', { error: err, requestedOrderId: req.params.id });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.updateAdminOrderStatus = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_orders' });
    try {
        const {
            status,
            reason,
            cancellationReason,
            note,
            returnAction,
            adminNotes,
            customerNotes,
            productCondition,
            refundAmount,
            refundMethod,
            returnImages,
            paymentStatus
        } = req.body || {};

        const normalizedReturnAction = normalizeText(returnAction).toLowerCase();
        const normalizedPaymentStatus = normalizeText(paymentStatus).toLowerCase();
        if (!status && !normalizedReturnAction && !normalizedPaymentStatus) {
            return res.status(400).json({ success: false, message: 'status, returnAction, or paymentStatus required' });
        }

        const order = await monitorAsyncOperation(logger, 'database.order.find_for_admin_status_update', { requestedOrderId: req.params.id }, () => orderDataService.findOrderByIdentifier(req.params.id), { slowThresholdMs: 700 });
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const oldStatus = order.status || order.orderStatus || 'Pending';
        const oldStatusLower = normalizeText(oldStatus).toLowerCase();
        const previousPaymentStatus = order.paymentStatus || order.payment?.status || '';

        if (normalizedReturnAction) {
            try {
                applyReturnAction(order, normalizedReturnAction, {
                    adminId: req.admin?.id || '',
                    reason: normalizeText(reason || cancellationReason || note || adminNotes),
                    adminNotes: normalizeText(adminNotes || note || reason),
                    customerNotes,
                    productCondition,
                    refundAmount,
                    refundMethod,
                    returnImages
                });
            } catch (actionError) {
                if (actionError?.code === 'DUPLICATE_RETURN' || actionError?.code === 'DUPLICATE_REFUND' || actionError?.code === 'INVALID_RETURN_ACTION') {
                    return res.status(409).json({
                        success: false,
                        message: actionError.message,
                        code: actionError.code
                    });
                }
                throw actionError;
            }
        } else if (status) {
            const nextStatus = normalizeText(status);
            const cancelMeta = {
                actor: 'Admin',
                adminId: req.admin?.id || '',
                reason: normalizeText(reason || cancellationReason || note)
            };

            if (isCancelledLike(nextStatus) && !isCancelledLike(oldStatus)) {
                appendStatusHistory(order, nextStatus, cancelMeta);
                applyCancellationMetadata(order, cancelMeta);
                try {
                    restoreOrderStock(order);
                } catch (stockError) {
                    logger.warn('admin.order_stock_restore_failed', { error: stockError, orderId: order.orderId || order.id });
                }
                try {
                    const couponDataService = require('../services/coupondataservice');
                    await couponDataService.releaseCouponForOrder(order.orderId || order.id);
                } catch (couponError) {
                    logger.warn('admin.order_coupon_release_failed', { error: couponError, orderId: order.orderId || order.id });
                }
            } else if (isCancelledLike(oldStatus) && !isCancelledLike(nextStatus)) {
                try {
                    reReserveOrderStock(order);
                } catch (stockError) {
                    logger.warn('admin.order_stock_rereserve_failed', { error: stockError, orderId: order.orderId || order.id });
                    return res.status(409).json({
                        success: false,
                        message: stockError?.message || 'Unable to restore order stock. Check inventory before restoring.',
                        code: stockError?.code || 'STOCK_RESTORE_FAILED'
                    });
                }
                clearCancellationMetadata(order);
                appendStatusHistory(order, nextStatus, {
                    actor: 'Admin',
                    adminId: req.admin?.id || '',
                    reason: normalizeText(reason || note) || 'Order restored by administrator'
                });
            } else {
                appendStatusHistory(order, nextStatus, {
                    actor: 'Admin',
                    adminId: req.admin?.id || '',
                    reason: normalizeText(reason || note)
                });
                maybeConfirmCodPaymentOnDelivery(order, nextStatus);
            }
        }

        if (normalizedPaymentStatus) {
            try {
                applyPaymentStatusUpdate(order, normalizedPaymentStatus);
            } catch (paymentError) {
                if (paymentError?.code === 'INVALID_PAYMENT_STATUS') {
                    return res.status(400).json({
                        success: false,
                        message: paymentError.message,
                        code: paymentError.code
                    });
                }
                throw paymentError;
            }
        }

        await monitorAsyncOperation(logger, 'database.order.save_status_admin', { orderId: order.orderId || order.id, status: order.status, adminId: req.admin?.id || '' }, () => orderDataService.saveOrder(order), { slowThresholdMs: 700 });
        logger.info('admin.order_status_updated', {
            orderId: order.orderId || order.id,
            status: order.status,
            returnAction: normalizedReturnAction || null,
            paymentStatus: order.paymentStatus || null,
            from: oldStatusLower,
            to: normalizeText(order.status || order.orderStatus).toLowerCase(),
            adminId: req.admin?.id || ''
        });

        try {
          const realtimeService = getRealtimeEventService();
          realtimeService.emitOrderStatusChanged(order._id || order.id, oldStatus, order.status);
        } catch (eventError) {
          logger.warn('realtime.event_emit_failed', { error: eventError, scope: 'order.status-changed' });
        }

        const refundRequested = String(order.paymentStatus || '').toLowerCase() === 'refund_required'
            || String(order.payment?.returnWorkflow?.refundStatus || '').toLowerCase() === 'required';

        void notificationEngine.notifyOrderStatusChanged(order, oldStatus, {
          returnAction: normalizedReturnAction || (refundRequested && isCancelledLike(order.status) ? 'request_return' : ''),
          previousPaymentStatus,
          refundRequested: Boolean(refundRequested && isCancelledLike(order.status) && !normalizedReturnAction)
        }).catch((engineError) => {
          logger.warn('notification.engine.order_status_failed', { error: engineError, orderId: order.orderId || order.id });
        });

        void notifyOrderStatusEmail(order, order.status).catch((notifyError) => {
          logger.warn('notification.order_status_failed', { error: notifyError, orderId: order.orderId || order.id });
        });

        return res.json({ success: true, order });
    } catch (err) {
        logger.error('admin.order_status_update_failed', { error: err, requestedOrderId: req.params.id });
        if (err?.code === 'INSUFFICIENT_STOCK') {
            return res.status(409).json({
                success: false,
                message: err.message || 'Unable to restore order due to stock availability.',
                code: err.code
            });
        }
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.deleteAdminOrder = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_orders' });
    try {
        const existing = await orderDataService.findOrderByIdentifier(req.params.id);
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (!isCancelledLike(existing.orderStatus || existing.status)) {
            try {
                restoreOrderStock(existing);
            } catch (stockError) {
                logger.warn('admin.order_delete_stock_restore_failed', { error: stockError, orderId: existing.orderId || existing.id });
            }
        }

        const order = await monitorAsyncOperation(logger, 'database.order.delete_admin', { requestedOrderId: req.params.id, adminId: req.admin?.id || '' }, () => orderDataService.deleteOrder(req.params.id), { slowThresholdMs: 700 });
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const orderId = order.orderId || order.id || req.params.id;
        logger.info('admin.order_deleted', { orderId, adminId: req.admin?.id || '' });

        // Emit realtime event
        try {
          const realtimeService = getRealtimeEventService();
          realtimeService.broadcast({
            type: 'order:deleted',
            scope: 'orders',
            payload: {
              orderId,
              action: 'deleted'
            }
          });
        } catch (eventError) {
          logger.warn('realtime.event_emit_failed', { error: eventError, scope: 'order.deleted' });
        }

        return res.json({ success: true, orderId });
    } catch (err) {
        logger.error('admin.order_delete_failed', { error: err, requestedOrderId: req.params.id });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};
