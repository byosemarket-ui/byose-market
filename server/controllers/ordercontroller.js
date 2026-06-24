const { appLogger, monitorAsyncOperation } = require('../utils/logger');
const orderDataService = require('../services/orderdataservice');
const userDataService = require('../services/userdataservice');
const getRealtimeEventService = require('../services/realtimeeventservice');

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
    return normalizeText(value).replace(/\s+/g, '');
}

const PAYMENT_STATES = new Set(['pending', 'authorized', 'paid', 'failed', 'refunded', 'cancelled', 'awaiting_delivery_payment']);

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
    if (state === 'authorized') return 'Authorized';
    if (state === 'paid') return 'Paid';
    if (state === 'failed') return 'Failed';
    if (state === 'refunded') return 'Refunded';
    if (state === 'cancelled') return 'Cancelled';
    return 'Pending';
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
    const customerId = normalizeText(source.customerId || source.userId || customer.id || user?.id);
    const customerEmail = normalizeEmail(source.customerEmail || source.userEmail || customer.email || user?.email);
    const customerPhone = normalizePhone(source.customerPhone || source.phoneNumber || customer.phone || shippingAddress.phone || user?.phone);
    const createdAt = source.createdAt || source.date || source.timestamp || new Date().toISOString();
    const subtotal = Number(source.subtotal || 0) || 0;
    const shippingFee = Number(source.shippingFee ?? source.deliveryFee ?? 0) || 0;
    const codFee = Number(source.codFee || 0) || 0;
    const total = Number(source.total ?? source.totalAmount ?? (subtotal + shippingFee + codFee)) || 0;
    const paymentMethod = normalizePaymentMethod(source.paymentMethod || source.payment?.method);
    let paymentStatus = normalizePaymentState(source.paymentStatus || source.payment?.status || source.payment?.transaction?.state);
    let paymentStatusLabel = normalizeText(source.paymentStatusLabel || source.payment?.statusLabel) || resolvePaymentStatusLabel(paymentStatus);
    if (paymentMethod === 'cod' && paymentStatus === 'pending' && !source.paymentStatus) {
        paymentStatus = 'awaiting_delivery_payment';
        paymentStatusLabel = 'Awaiting Delivery Payment';
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
        isGuest: source.isGuest === true || !customerId,
        userEmail: customerEmail,
        customerEmail,
        customerPhone,
        phoneNumber: customerPhone,
        customerName: normalizeText(source.customerName || customer.name || shippingAddress.fullName) || 'Guest Customer',
        customerImage: normalizeText(source.customerImage || customer.avatar || customer.image),
        status: normalizeText(source.status) || 'Pending',
        orderStatus: normalizeText(source.orderStatus) || 'pending',
        paymentStatus,
        paymentStatusLabel,
        paymentMethod,
        paymentType: normalizeText(source.paymentType || source.payment?.type),
        note: normalizeText(source.note || source.payment?.note),
        subtotal,
        deliveryFee: shippingFee,
        shippingFee,
        codFee,
        total,
        totalAmount: total,
        totalPrice: total,
        deliveryMethod: normalizeText(source.deliveryMethod) === 'pickup' ? 'delivery' : (normalizeText(source.deliveryMethod) || 'delivery'),
        deliveryLabel: normalizeText(source.deliveryLabel) || 'Delivery to address',
        items,
        products: items,
        shippingAddress,
        fullAddress: source.fullAddress && typeof source.fullAddress === 'object' ? source.fullAddress : {},
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
        customer: customer && typeof customer === 'object' ? customer : {},
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
        const normalizedOrder = normalizeStorefrontOrder(req.body, user);

        if (!normalizedOrder.orderId) {
            return res.status(400).json({ success: false, message: 'orderId required' });
        }

        if (!normalizedOrder.items.length) {
            return res.status(400).json({ success: false, message: 'items required' });
        }

        if (!normalizedOrder.customerName || !normalizedOrder.customerPhone) {
            return res.status(400).json({ success: false, message: 'customer details required' });
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

        return res.json({ success: true, order });
    } catch (err) {
        logger.error('order.create_failed', { error: err });
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

        appendStatusHistory(order, status);
        await monitorAsyncOperation(logger, 'database.order.save_status_user', { orderId: order.orderId || order.id, status }, () => orderDataService.saveOrder(order), { slowThresholdMs: 700 });
        logger.info('order.status_updated_by_customer', { orderId: order.orderId || order.id, userId: user.id, status });
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
        appendStatusHistory(order, status);
        await monitorAsyncOperation(logger, 'database.order.save_status_admin', { orderId: order.orderId || order.id, status, adminId: req.admin?.id || '' }, () => orderDataService.saveOrder(order), { slowThresholdMs: 700 });
        logger.info('admin.order_status_updated', { orderId: order.orderId || order.id, status, adminId: req.admin?.id || '' });

        // Emit realtime event
        try {
          const realtimeService = getRealtimeEventService();
          realtimeService.emitOrderStatusChanged(order._id || order.id, oldStatus, status);
        } catch (eventError) {
          logger.warn('realtime.event_emit_failed', { error: eventError, scope: 'order.status-changed' });
        }

        return res.json({ success: true, order });
    } catch (err) {
        logger.error('admin.order_status_update_failed', { error: err, requestedOrderId: req.params.id });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.deleteAdminOrder = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_orders' });
    try {
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
