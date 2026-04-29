const mongoose = require('mongoose');
const Order = require('../models/order');
const User = require('../models/user');

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
    try {
        const user = await resolveUser(req);
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

        const existingOrder = await Order.findOne({ orderId: normalizedOrder.orderId });
        if (existingOrder) {
            return res.status(409).json({ success: false, message: 'Order already exists', order: existingOrder });
        }

        const order = new Order(normalizedOrder);
        await order.save();

        return res.json({ success: true, order });
    } catch (err) {
        console.error('createOrder error', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get orders for logged-in user
exports.getUserOrders = async (req, res) => {
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const query = buildOrderQuery(user);
        if (!query) return res.json({ success: true, orders: [] });
        const orders = await Order.find(query).sort({ createdAt: -1 });
        return res.json({ success: true, orders });
    } catch (err) {
        console.error('getUserOrders error', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Update order status (admin or owner)
exports.updateOrderStatus = async (req, res) => {
    try {
        const { status } = req.body || {};
        if (!status) return res.status(400).json({ success: false, message: 'status required' });

        const query = buildOrderLookupQuery(req.params.id);

        const order = await Order.findOne(query);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        appendStatusHistory(order, status);
        await order.save();
        return res.json({ success: true, order });
    } catch (err) {
        console.error('updateOrderStatus error', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getAdminOrders = async (req, res) => {
    try {
        const orders = await Order.find({}).sort({ createdAt: -1, updatedAt: -1 });
        return res.json({ success: true, orders });
    } catch (err) {
        console.error('getAdminOrders error', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getAdminOrderById = async (req, res) => {
    try {
        const order = await Order.findOne(buildOrderLookupQuery(req.params.id));
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        return res.json({ success: true, order });
    } catch (err) {
        console.error('getAdminOrderById error', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.updateAdminOrderStatus = async (req, res) => {
    try {
        const { status } = req.body || {};
        if (!status) {
            return res.status(400).json({ success: false, message: 'status required' });
        }

        const order = await Order.findOne(buildOrderLookupQuery(req.params.id));
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        appendStatusHistory(order, status);
        await order.save();
        return res.json({ success: true, order });
    } catch (err) {
        console.error('updateAdminOrderStatus error', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.deleteAdminOrder = async (req, res) => {
    try {
        const order = await Order.findOneAndDelete(buildOrderLookupQuery(req.params.id));
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        return res.json({ success: true, orderId: order.orderId || order.id || req.params.id });
    } catch (err) {
        console.error('deleteAdminOrder error', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};
