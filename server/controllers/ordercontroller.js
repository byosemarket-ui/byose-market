const mongoose = require('mongoose');
const Order = require('../models/order');
const User = require('../models/user');
const { appLogger, monitorAsyncOperation } = require('../utils/logger');
const getRealtimeEventService = require('../services/realtimeeventservice');

async function resolveUser(req) {
    if (!req.user || !req.user.id) return null;
    return await User.findOne({ id: req.user.id });
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

function normalizeItems(items) {
    const source = Array.isArray(items) ? items : [];

    return source
        .map((item) => ({
            productId: normalizeText(item?.productId || item?.id),
            productName: normalizeText(item?.productName || item?.name) || 'Product',
            quantity: Math.max(1, Number(item?.quantity || item?.qty || 1) || 1),
            price: Number(item?.price || 0) || 0,
            image: normalizeText(item?.image || item?.img || item?.imageUrl || item?.productImage || item?.mainImage || item?.thumbnail),
            attributes: item?.attributes && typeof item.attributes === 'object' ? item.attributes : {},
            color: normalizeText(item?.color),
            size: normalizeText(item?.size)
        }))
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
        paymentStatus: normalizeText(source.paymentStatus) || 'pending',
        paymentStatusLabel: normalizeText(source.paymentStatusLabel),
        paymentMethod: normalizeText(source.paymentMethod || source.payment?.method),
        paymentType: normalizeText(source.paymentType || source.payment?.type),
        note: normalizeText(source.note || source.payment?.note),
        subtotal,
        deliveryFee: shippingFee,
        shippingFee,
        codFee,
        total,
        totalAmount: total,
        totalPrice: total,
        deliveryMethod: normalizeText(source.deliveryMethod),
        deliveryLabel: normalizeText(source.deliveryLabel),
        items,
        products: items,
        shippingAddress,
        fullAddress: source.fullAddress && typeof source.fullAddress === 'object' ? source.fullAddress : {},
        gpsLocation: source.gpsLocation && typeof source.gpsLocation === 'object' ? source.gpsLocation : {},
        payment: source.payment && typeof source.payment === 'object' ? source.payment : {},
        customer: customer && typeof customer === 'object' ? customer : {},
        statusHistory: Array.isArray(source.statusHistory) ? source.statusHistory : [],
        createdAt: new Date(createdAt),
        updatedAt: new Date(source.updatedAt || createdAt)
    };
}

function buildOrderQuery(user) {
    const orConditions = [];

    if (user?._id) {
        orConditions.push({ user: user._id });
    }
    if (user?.id) {
        orConditions.push({ userId: user.id });
        orConditions.push({ customerId: user.id });
    }
    if (user?.email) {
        const email = normalizeEmail(user.email);
        orConditions.push({ userEmail: email });
        orConditions.push({ customerEmail: email });
    }
    if (user?.phone) {
        const phone = normalizePhone(user.phone);
        orConditions.push({ customerPhone: phone });
        orConditions.push({ phoneNumber: phone });
    }

    return orConditions.length ? { $or: orConditions } : null;
}

function buildOrderLookupQuery(identifier) {
    if (mongoose.Types.ObjectId.isValid(identifier)) {
        return { $or: [{ _id: identifier }, { orderId: identifier }, { id: identifier }] };
    }

    return { $or: [{ orderId: identifier }, { id: identifier }] };
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

        const existingOrder = await monitorAsyncOperation(logger, 'database.order.find_by_order_id', { orderId: normalizedOrder.orderId }, () => Order.findOne({ orderId: normalizedOrder.orderId }), { slowThresholdMs: 700 });
        if (existingOrder) {
            logger.warn('order.duplicate_submission', {
                orderId: normalizedOrder.orderId,
                customerId: normalizedOrder.customerId,
                paymentMethod: normalizedOrder.paymentMethod,
                paymentType: normalizedOrder.paymentType
            });
            return res.json({ success: true, existing: true, order: existingOrder });
        }

        const order = new Order(normalizedOrder);
        await monitorAsyncOperation(logger, 'database.order.create', {
            orderId: normalizedOrder.orderId,
            customerId: normalizedOrder.customerId,
            paymentMethod: normalizedOrder.paymentMethod,
            paymentType: normalizedOrder.paymentType,
            totalAmount: normalizedOrder.totalAmount
        }, () => order.save(), { slowThresholdMs: 700 });

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
        const query = buildOrderQuery(user);
        if (!query) return res.json({ success: true, orders: [] });
        const orders = await monitorAsyncOperation(logger, 'database.order.list_for_user', { userId: user.id }, () => Order.find(query).sort({ createdAt: -1 }).select('orderId id customerName status orderStatus paymentStatus totalAmount totalPrice total createdAt updatedAt items products shippingAddress paymentMethod paymentType').lean(), { slowThresholdMs: 700 });
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

        const query = buildOrderLookupQuery(req.params.id);
        const order = await Order.findOne(query);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        const ownershipQuery = buildOrderQuery(user);
        const ownsOrder = ownershipQuery
            ? await Order.exists({
                $and: [
                    query,
                    ownershipQuery
                ]
            })
            : false;

        if (!ownsOrder) {
            logger.warn('order.status_update_forbidden', {
                requestedOrderId: req.params.id,
                userId: user.id,
                status
            });
            return res.status(403).json({ success: false, message: 'Unauthorized to update this order' });
        }

        appendStatusHistory(order, status);
        await monitorAsyncOperation(logger, 'database.order.save_status_user', { orderId: order.orderId || order.id, status }, () => order.save(), { slowThresholdMs: 700 });
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
        const orders = await monitorAsyncOperation(logger, 'database.order.list_admin', { adminId: req.admin?.id || '', limit, page }, () => Order.find({}).sort({ createdAt: -1, updatedAt: -1 }).skip(skip).limit(limit).select('orderId id customerName customerEmail customerPhone status orderStatus paymentStatus totalAmount totalPrice total createdAt updatedAt items products shippingAddress paymentMethod paymentType').lean(), { slowThresholdMs: 900 });
        return res.json({ success: true, orders });
    } catch (err) {
        logger.error('admin.order_list_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getAdminOrderById = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_orders' });
    try {
        const order = await monitorAsyncOperation(logger, 'database.order.find_admin', { requestedOrderId: req.params.id }, () => Order.findOne(buildOrderLookupQuery(req.params.id)).select('orderId id customerId customerName customerEmail customerPhone status orderStatus paymentStatus totalAmount totalPrice total subtotal deliveryFee shippingFee codFee paymentMethod paymentType note items products shippingAddress fullAddress gpsLocation payment customer statusHistory createdAt updatedAt').lean(), { slowThresholdMs: 700 });
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

        const order = await monitorAsyncOperation(logger, 'database.order.find_for_admin_status_update', { requestedOrderId: req.params.id }, () => Order.findOne(buildOrderLookupQuery(req.params.id)), { slowThresholdMs: 700 });
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const oldStatus = order.status || order.orderStatus || 'Pending';
        appendStatusHistory(order, status);
        await monitorAsyncOperation(logger, 'database.order.save_status_admin', { orderId: order.orderId || order.id, status, adminId: req.admin?.id || '' }, () => order.save(), { slowThresholdMs: 700 });
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
        const order = await monitorAsyncOperation(logger, 'database.order.delete_admin', { requestedOrderId: req.params.id, adminId: req.admin?.id || '' }, () => Order.findOneAndDelete(buildOrderLookupQuery(req.params.id)), { slowThresholdMs: 700 });
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
