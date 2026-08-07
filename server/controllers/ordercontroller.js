const { appLogger, monitorAsyncOperation } = require('../utils/logger');
const orderDataService = require('../services/orderdataservice');
const userDataService = require('../services/userdataservice');
const productDataService = require('../services/productdataservice');
const getRealtimeEventService = require('../services/realtimeeventservice');
const { getRepositoryBundle } = require('../repositories');
const { notifyOrderConfirmed, notifyOrderStatusChanged } = require('../utils/notifications');
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
    return value.includes('cancel') || value.includes('return');
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
    // Never accept delivery or total amounts from the client. Delivery is a
    // fixed RWF 2,000 for every submitted order, regardless of cart contents.
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
        total,
        totalAmount: total,
        totalPrice: total,
        deliveryMethod: 'delivery',
        deliveryLabel: normalizeText(source.deliveryLabel) || 'Delivery to address',
        items,
        products: items,
        shippingAddress: {
            ...shippingAddress,
            fullName: normalizeText(shippingAddress.fullName || source.customerName || customer.name || user?.name),
            phone: customerPhone,
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

function appendStatusHistory(order, status) {
    const normalizedStatus = normalizeText(status);
    const timestamp = new Date().toISOString();
    const nextHistory = Array.isArray(order.statusHistory) ? order.statusHistory.slice() : [];

    nextHistory.push({
        status: normalizedStatus.toLowerCase(),
        label: normalizedStatus,
        timestamp
    });

    order.status = normalizedStatus || order.status;
    order.orderStatus = normalizedStatus.toLowerCase() || order.orderStatus;
    order.updatedAt = new Date(timestamp);
    order.statusHistory = nextHistory;
}

exports.createOrder = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'orders' });
    try {
        const user = await monitorAsyncOperation(logger, 'database.user.resolve_for_order', {}, () => resolveUser(req), { slowThresholdMs: 500 });
        let normalizedOrder = normalizeStorefrontOrder(req.body, user);

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
            const total = subtotal + DELIVERY_FEE + COD_FEE;
            normalizedOrder = {
                ...normalizedOrder,
                items: pricedItems,
                products: pricedItems,
                subtotal,
                deliveryFee: DELIVERY_FEE,
                shippingFee: DELIVERY_FEE,
                codFee: COD_FEE,
                total,
                totalAmount: total,
                totalPrice: total
            };
        } catch (pricingError) {
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

        appendStatusHistory(order, 'Cancelled');
        try {
            restoreOrderStock(order);
        } catch (stockError) {
            logger.warn('order.stock_restore_failed', { error: stockError, orderId: order.orderId || order.id });
        }
        await monitorAsyncOperation(logger, 'database.order.save_status_user', { orderId: order.orderId || order.id, status }, () => orderDataService.saveOrder(order), { slowThresholdMs: 700 });
        logger.info('order.status_updated_by_customer', { orderId: order.orderId || order.id, userId: user.id, status });
        void notifyOrderStatusChanged(order, 'Cancelled').catch((notifyError) => {
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
        const limit = Math.min(500, Math.max(1, Number(req.query?.limit || 100) || 100));
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
        const { status } = req.body || {};
        if (!status) {
            return res.status(400).json({ success: false, message: 'status required' });
        }

        const order = await monitorAsyncOperation(logger, 'database.order.find_for_admin_status_update', { requestedOrderId: req.params.id }, () => orderDataService.findOrderByIdentifier(req.params.id), { slowThresholdMs: 700 });
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const oldStatus = order.status || order.orderStatus || 'Pending';
        const nextStatus = normalizeText(status);
        appendStatusHistory(order, nextStatus);

        if (!isCancelledLike(oldStatus) && isCancelledLike(nextStatus)) {
            try {
                restoreOrderStock(order);
            } catch (stockError) {
                logger.warn('admin.order_stock_restore_failed', { error: stockError, orderId: order.orderId || order.id });
            }
        }

        await monitorAsyncOperation(logger, 'database.order.save_status_admin', { orderId: order.orderId || order.id, status, adminId: req.admin?.id || '' }, () => orderDataService.saveOrder(order), { slowThresholdMs: 700 });
        logger.info('admin.order_status_updated', { orderId: order.orderId || order.id, status, adminId: req.admin?.id || '' });

        // Emit realtime event
        try {
          const realtimeService = getRealtimeEventService();
          realtimeService.emitOrderStatusChanged(order._id || order.id, oldStatus, status);
        } catch (eventError) {
          logger.warn('realtime.event_emit_failed', { error: eventError, scope: 'order.status-changed' });
        }

        void notifyOrderStatusChanged(order, nextStatus).catch((notifyError) => {
          logger.warn('notification.order_status_failed', { error: notifyError, orderId: order.orderId || order.id });
        });

        return res.json({ success: true, order });
    } catch (err) {
        logger.error('admin.order_status_update_failed', { error: err, requestedOrderId: req.params.id });
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
