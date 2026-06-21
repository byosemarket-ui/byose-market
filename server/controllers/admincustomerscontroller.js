const { appLogger } = require('../utils/logger');
const orderDataService = require('../services/orderdataservice');
const userDataService = require('../services/userdataservice');

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
        lastLoginAt: user.lastLoginAt || '',
        address: user.address || {},
        totalOrders: serializedOrders.length,
        totalSpent,
        lastOrderDate: lastOrder?.date || '',
        orders: serializedOrders
    };
}

async function loadCustomerOrders(user) {
    return orderDataService.listOrdersForUser(user);
}

async function findCustomer(identifier) {
    const user = await userDataService.findUserByIdentifier(identifier, { includeAdmins: false });
    return user && user.role !== 'admin' ? user : null;
}

exports.listCustomers = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_customers' });
    try {
        const query = normalizeText(req.query?.q || req.query?.query || '');
        const status = normalizeText(req.query?.status || '');
        const users = await userDataService.listCustomers({ query, status });
        const customers = await Promise.all(users.map(async (user) => sanitizeCustomer(user, await loadCustomerOrders(user))));
        return res.json({ success: true, customers, total: customers.length });
    } catch (error) {
        logger.error('admin.customers.list_failed', { error });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getCustomerById = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_customers' });
    try {
        const user = await findCustomer(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        return res.json({ success: true, customer: sanitizeCustomer(user, await loadCustomerOrders(user)) });
    } catch (error) {
        logger.error('admin.customers.lookup_failed', { error, requestedCustomerId: req.params.id });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.updateCustomer = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_customers' });
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
            const emailExists = await userDataService.emailExists(nextEmail, user.id);
            if (emailExists) {
                return res.status(409).json({ success: false, message: 'Email exists' });
            }
        }

        if (nextPhone && nextPhone !== normalizePhone(user.phone)) {
            const phoneExists = await userDataService.phoneExists(nextPhone, user.id);
            if (phoneExists) {
                return res.status(409).json({ success: false, message: 'Phone exists' });
            }
        }

        const updated = await userDataService.updateUser(user.id, {
            ...user,
            name: nextName,
            email: nextEmail,
            phone: nextPhone,
            avatar: normalizeText(req.body?.avatar || user.avatar),
            status: String(req.body?.status || user.status || 'active').toLowerCase() === 'blocked' ? 'blocked' : 'active',
            verified: Boolean(req.body?.verified),
            address: {
                ...(user.address || {}),
                ...(req.body?.address && typeof req.body.address === 'object' ? req.body.address : {})
            }
        });

        return res.json({ success: true, customer: sanitizeCustomer(updated, await loadCustomerOrders(updated)) });
    } catch (error) {
        logger.error('admin.customers.update_failed', { error, requestedCustomerId: req.params.id });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.deleteCustomer = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_customers' });
    try {
        const user = await findCustomer(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        await userDataService.deleteUser(user.id);
        return res.json({ success: true, customerId: user.id });
    } catch (error) {
        logger.error('admin.customers.delete_failed', { error, requestedCustomerId: req.params.id });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};