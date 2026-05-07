const ContactMessage = require('../models/contactmessage');
const CustomerActivity = require('../models/customeractivity');
const Order = require('../models/order');
const Product = require('../models/product');
const User = require('../models/user');

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeTimestamp(value) {
    const parsed = new Date(value || 0).getTime();
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatCurrency(value) {
    return `RWF ${Number(value || 0).toLocaleString('en-US')}`;
}

function mapOrderStatus(status) {
    const normalized = normalizeText(status).toLowerCase();
    if (normalized.includes('return')) return { label: 'Returned', tone: 'cancelled' };
    if (normalized.includes('cancel')) return { label: 'Cancelled', tone: 'cancelled' };
    if (normalized.includes('deliver') || normalized.includes('complete')) return { label: 'Delivered', tone: 'completed' };
    if (normalized.includes('ship')) return { label: 'Shipping', tone: 'shipped' };
    if (normalized.includes('confirm') || normalized.includes('process') || normalized.includes('payment')) return { label: 'Confirmed', tone: 'processing' };
    return { label: 'Pending', tone: 'review' };
}

function mapMessageStatus(status) {
    const normalized = normalizeText(status).toLowerCase();
    if (normalized.includes('resolve') || normalized.includes('close')) return { label: 'Resolved', tone: 'completed' };
    if (normalized.includes('review') || normalized.includes('read')) return { label: 'Reviewed', tone: 'shipped' };
    return { label: 'New', tone: 'processing' };
}

function startOfDay(offsetDays = 0) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + offsetDays);
    return date;
}

function buildSalesSeries(orders) {
    return Array.from({ length: 7 }).map((_, index) => {
        const day = startOfDay(index - 6);
        const nextDay = startOfDay(index - 5);
        const total = orders
            .filter((order) => {
                const createdAt = normalizeTimestamp(order.createdAt || order.date);
                return createdAt >= day.getTime() && createdAt < nextDay.getTime();
            })
            .reduce((sum, order) => sum + Number(order.totalAmount ?? order.totalPrice ?? order.total ?? 0), 0);

        return {
            label: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            total
        };
    });
}

function buildOrderStatusBreakdown(orders) {
    return orders.reduce((accumulator, order) => {
        const label = mapOrderStatus(order.status || order.orderStatus).label;
        accumulator[label] = (accumulator[label] || 0) + 1;
        return accumulator;
    }, {});
}

function buildTopProducts(orders) {
    const lookup = new Map();

    orders.forEach((order) => {
        const items = Array.isArray(order.items) && order.items.length ? order.items : Array.isArray(order.products) ? order.products : [];
        items.forEach((item) => {
            const key = normalizeText(item.productId || item.id || item.productName || item.name);
            if (!key) {
                return;
            }

            const current = lookup.get(key) || {
                id: normalizeText(item.productId || item.id),
                name: normalizeText(item.productName || item.name) || 'Product',
                quantity: 0,
                revenue: 0
            };

            const quantity = Math.max(1, Number(item.quantity || item.qty || 1) || 1);
            const price = Number(item.price || 0) || 0;
            current.quantity += quantity;
            current.revenue += quantity * price;
            lookup.set(key, current);
        });
    });

    return Array.from(lookup.values())
        .sort((left, right) => right.revenue - left.revenue)
        .slice(0, 5);
}

function buildRecentActivity({ orders, customers, messages, visits, products }) {
    const orderActivity = orders.slice(0, 6).map((order) => {
        const status = mapOrderStatus(order.status || order.orderStatus);
        return {
            type: 'Order',
            reference: normalizeText(order.orderId || order.id),
            statusLabel: status.label,
            statusTone: status.tone,
            details: `${normalizeText(order.customerName) || 'Customer'} • ${formatCurrency(order.totalAmount ?? order.totalPrice ?? order.total ?? 0)}`,
            date: order.createdAt || order.date
        };
    });

    const customerActivity = customers.slice(0, 4).map((customer) => ({
        type: 'Customer',
        reference: normalizeText(customer.id),
        statusLabel: 'Registered',
        statusTone: 'completed',
        details: `${normalizeText(customer.name) || 'Customer'} • ${normalizeText(customer.email || customer.phone) || 'No contact info'}`,
        date: customer.createdAt
    }));

    const messageActivity = messages.slice(0, 4).map((message) => {
        const status = mapMessageStatus(message.status);
        return {
            type: 'Message',
            reference: normalizeText(message.name) || 'Message',
            statusLabel: status.label,
            statusTone: status.tone,
            details: `${normalizeText(message.email || message.phone) || 'No contact'} • ${normalizeText(message.message).slice(0, 60) || 'No preview'}`,
            date: message.createdAt
        };
    });

    const visitActivity = visits.slice(0, 4).map((visit) => ({
        type: 'Visit',
        reference: normalizeText(visit.path) || 'Site visit',
        statusLabel: 'Tracked',
        statusTone: 'shipped',
        details: `${normalizeText(visit.device) || 'Device'}${normalizeText(visit.city) ? ` • ${normalizeText(visit.city)}` : ''}`,
        date: visit.startedAt || visit.createdAt
    }));

    const inventoryActivity = products.slice(0, 4).map((product) => ({
        type: 'Inventory',
        reference: normalizeText(product.name) || `Product ${product.catalogId}`,
        statusLabel: Number(product.stock || 0) <= 5 ? 'Low stock' : 'Updated',
        statusTone: Number(product.stock || 0) <= 5 ? 'review' : 'completed',
        details: `${Number(product.stock || 0).toLocaleString('en-US')} in stock • ${normalizeText(product.category) || 'general'}`,
        date: product.updatedAt || product.createdAt
    }));

    return orderActivity
        .concat(customerActivity)
        .concat(messageActivity)
        .concat(visitActivity)
        .concat(inventoryActivity)
        .sort((left, right) => normalizeTimestamp(right.date) - normalizeTimestamp(left.date))
        .slice(0, 8);
}

exports.getDashboardSnapshot = async (_req, res) => {
    try {
        const [orders, customers, products, messages, visits] = await Promise.all([
            Order.find({}).sort({ createdAt: -1, updatedAt: -1 }).lean(),
            User.find({ role: { $ne: 'admin' } }).sort({ createdAt: -1 }).lean(),
            Product.find({}).sort({ updatedAt: -1, createdAt: -1 }).lean(),
            ContactMessage.find({}).sort({ createdAt: -1, updatedAt: -1 }).lean(),
            CustomerActivity.find({ eventType: 'visit' }).sort({ createdAt: -1, updatedAt: -1 }).limit(200).lean()
        ]);

        const totalSales = orders.reduce((sum, order) => sum + Number(order.totalAmount ?? order.totalPrice ?? order.total ?? 0), 0);
        const pendingOrders = orders.filter((order) => mapOrderStatus(order.status || order.orderStatus).label === 'Pending').length;
        const recentUsers = customers.filter((customer) => normalizeTimestamp(customer.createdAt) >= startOfDay(-7).getTime()).length;
        const newMessages = messages.filter((message) => mapMessageStatus(message.status).label === 'New').length;
        const lowStockProducts = products.filter((product) => Number(product.stock || 0) <= 5).length;
        const outOfStockProducts = products.filter((product) => Number(product.stock || 0) <= 0).length;
        const ordersToday = orders.filter((order) => normalizeTimestamp(order.createdAt) >= startOfDay(0).getTime()).length;

        return res.json({
            success: true,
            snapshot: {
                stats: {
                    totalSales,
                    ordersCount: orders.length,
                    ordersNote: orders.length ? `${pendingOrders} pending orders from the centralized order database` : 'No orders in the centralized database yet',
                    customersCount: customers.length,
                    customersNote: customers.length ? `${recentUsers} new customers in the last 7 days` : 'No registered customers yet',
                    productsCount: products.length,
                    productsNote: products.length ? `${lowStockProducts} low-stock products across the live catalog` : 'No live products found',
                    salesNote: orders.length ? `${formatCurrency(totalSales)} across ${orders.length} centralized orders` : 'No recorded order totals yet',
                    messagesCount: messages.length,
                    messagesNote: messages.length ? `${newMessages} new support messages in the shared inbox` : 'No support messages yet',
                    visitsCount: visits.length,
                    visitsNote: visits.length ? `${visits.length} tracked visits across all devices` : 'No tracked visits yet'
                },
                activity: buildRecentActivity({ orders, customers, messages, visits, products }),
                summary: [
                    {
                        label: 'Catalog coverage',
                        value: products.length ? `${products.length} live products • ${outOfStockProducts} out of stock` : 'No catalog products detected'
                    },
                    {
                        label: 'Order queue',
                        value: orders.length ? `${pendingOrders} pending from ${orders.length} total orders` : 'No centralized orders yet'
                    },
                    {
                        label: 'Customer base',
                        value: customers.length ? `${customers.length} registered customers • ${recentUsers} joined this week` : 'No registered customers found'
                    },
                    {
                        label: 'Support inbox',
                        value: messages.length ? `${newMessages} new from ${messages.length} shared contact submissions` : 'No shared contact submissions yet'
                    },
                    {
                        label: 'Site activity',
                        value: visits.length ? `${visits.length} tracked visits • ${ordersToday} orders created today` : 'No tracked visits recorded yet'
                    }
                ],
                analytics: {
                    salesSeries: buildSalesSeries(orders),
                    orderStatusBreakdown: buildOrderStatusBreakdown(orders),
                    inventory: {
                        totalProducts: products.length,
                        totalStock: products.reduce((sum, product) => sum + Number(product.stock || 0), 0),
                        lowStockProducts,
                        outOfStockProducts,
                        recentlyUpdated: products.slice(0, 8).map((product) => ({
                            id: Number(product.catalogId || 0),
                            name: normalizeText(product.name) || 'Product',
                            stock: Number(product.stock || 0),
                            updatedAt: product.updatedAt || product.createdAt || null
                        }))
                    },
                    topProducts: buildTopProducts(orders),
                    activityCounts: {
                        visits: visits.length,
                        messages: messages.length,
                        orders: orders.length,
                        customers: customers.length
                    }
                },
                raw: {
                    orders,
                    customers,
                    products,
                    messages,
                    visits
                },
                syncedAt: new Date().toISOString(),
                source: 'api'
            }
        });
    } catch (error) {
        console.error('getDashboardSnapshot error', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};