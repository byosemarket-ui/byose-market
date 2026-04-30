const Order = require('../models/order');
const User = require('../models/user');

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeEmail(value) {
    return normalizeText(value).toLowerCase();
}

function normalizePhone(value) {
    return normalizeText(value).replace(/\s+/g, '');
}

function serializeOrderItem(item) {
    return {
        id: normalizeText(item?.productId || item?.id),
        name: normalizeText(item?.productName || item?.name) || 'Product',
        price: Number(item?.price || 0) || 0,
        qty: Math.max(1, Number(item?.quantity || item?.qty || 1) || 1),
        image: normalizeText(item?.image || item?.img || item?.imageUrl || item?.productImage || item?.mainImage),
        attributes: item?.attributes && typeof item.attributes === 'object' ? item.attributes : {}
    };
}

function serializeOrder(order) {
    const products = Array.isArray(order?.products) && order.products.length
        ? order.products.map(serializeOrderItem)
        : Array.isArray(order?.items)
            ? order.items.map(serializeOrderItem)
            : [];

    return {
        id: normalizeText(order?.orderId || order?.id),
        orderId: normalizeText(order?.orderId || order?.id),
        status: normalizeText(order?.status || order?.orderStatus) || 'Pending',
        total: Number(order?.totalAmount ?? order?.totalPrice ?? order?.total ?? 0) || 0,
        date: order?.createdAt || order?.date || new Date().toISOString(),
        customerName: normalizeText(order?.customerName),
        customerEmail: normalizeEmail(order?.customerEmail || order?.userEmail),
        customerPhone: normalizePhone(order?.customerPhone || order?.phoneNumber),
        shippingAddress: order?.shippingAddress && typeof order.shippingAddress === 'object' ? order.shippingAddress : {},
        products
    };
}

function sanitizeCustomer(user, orders) {
    const serializedOrders = Array.isArray(orders) ? orders.map(serializeOrder) : [];
    const totalSpent = serializedOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const lastOrder = serializedOrders[0] || null;

    return {
        id: user.id,
        name: user.name,
        email: user.email || '',
        phone: user.phone || '',
        avatar: user.avatar || '',
        status: user.status || 'active',
        verified: Boolean(user.verified),
        joinedAt: user.createdAt,
        address: user.address || {},
        totalOrders: serializedOrders.length,
        totalSpent,
        lastOrderDate: lastOrder?.date || '',
        orders: serializedOrders
    };
}

async function loadCustomerOrders(user) {
    const orConditions = [];
    if (user?._id) orConditions.push({ user: user._id });
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

    if (!orConditions.length) {
        return [];
    }

    return Order.find({ $or: orConditions }).sort({ createdAt: -1, updatedAt: -1 }).lean();
}

async function findCustomer(identifier) {
    const normalizedIdentifier = normalizeText(identifier);
    const normalizedEmail = normalizeEmail(identifier);
    const normalizedPhone = normalizePhone(identifier);

    return User.findOne({
        role: { $ne: 'admin' },
        $or: [
            { id: normalizedIdentifier },
            { email: normalizedEmail },
            { phone: normalizedPhone }
        ]
    });
}

exports.listCustomers = async (req, res) => {
    try {
        const users = await User.find({ role: { $ne: 'admin' } }).sort({ createdAt: -1 });
        const customers = await Promise.all(users.map(async (user) => sanitizeCustomer(user, await loadCustomerOrders(user))));
        return res.json({ success: true, customers });
    } catch (error) {
        console.error('listCustomers error', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getCustomerById = async (req, res) => {
    try {
        const user = await findCustomer(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        return res.json({ success: true, customer: sanitizeCustomer(user, await loadCustomerOrders(user)) });
    } catch (error) {
        console.error('getCustomerById error', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.updateCustomer = async (req, res) => {
    try {
        const user = await findCustomer(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        const nextName = normalizeText(req.body?.name || user.name);
        const nextEmail = normalizeEmail(req.body?.email || user.email);
        const nextPhone = normalizePhone(req.body?.phone || user.phone);

        if (!nextName) {
            return res.status(400).json({ success: false, message: 'Name required' });
        }

        if (nextEmail && nextEmail !== normalizeEmail(user.email)) {
            const emailExists = await User.findOne({ role: { $ne: 'admin' }, email: nextEmail, id: { $ne: user.id } }).select('id').lean();
            if (emailExists) {
                return res.status(409).json({ success: false, message: 'Email exists' });
            }
        }

        if (nextPhone && nextPhone !== normalizePhone(user.phone)) {
            const phoneExists = await User.findOne({ role: { $ne: 'admin' }, phone: nextPhone, id: { $ne: user.id } }).select('id').lean();
            if (phoneExists) {
                return res.status(409).json({ success: false, message: 'Phone exists' });
            }
        }

        user.name = nextName;
        user.email = nextEmail;
        user.phone = nextPhone;
        user.avatar = normalizeText(req.body?.avatar || user.avatar);
        user.status = String(req.body?.status || user.status || 'active').toLowerCase() === 'blocked' ? 'blocked' : 'active';
        user.verified = Boolean(req.body?.verified);
        user.address = {
            ...(user.address?.toObject ? user.address.toObject() : (user.address || {})),
            ...(req.body?.address && typeof req.body.address === 'object' ? req.body.address : {})
        };
        await user.save();

        return res.json({ success: true, customer: sanitizeCustomer(user, await loadCustomerOrders(user)) });
    } catch (error) {
        console.error('updateCustomer error', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.deleteCustomer = async (req, res) => {
    try {
        const user = await findCustomer(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        await User.deleteOne({ _id: user._id });
        return res.json({ success: true, customerId: user.id });
    } catch (error) {
        console.error('deleteCustomer error', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};