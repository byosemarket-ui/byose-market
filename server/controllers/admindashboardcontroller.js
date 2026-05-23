const config = require('../config/env');
const { appLogger } = require('../utils/logger');
const cartDataService = require('../services/cartdataservice');
const orderDataService = require('../services/orderdataservice');
const productDataService = require('../services/productdataservice');
const userDataService = require('../services/userdataservice');

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

function startOfWeek(offsetWeeks = 0) {
    const date = startOfDay();
    date.setDate(date.getDate() - date.getDay() + (offsetWeeks * 7));
    return date;
}

function sortAndSliceRecent(items, limit, sortKey = 'createdAt') {
    return [...items]
        .sort((left, right) => normalizeTimestamp(right[sortKey] || right.updatedAt) - normalizeTimestamp(left[sortKey] || left.updatedAt))
        .slice(0, limit);
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

function buildRecentActivity({ orders, customers, messages, visits, products, carts }) {
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

    const cartActivity = carts.slice(0, 4).map((cart) => ({
        type: 'Cart',
        reference: normalizeText(cart.id || cart.userId) || 'Cart',
        statusLabel: Number(cart.itemCount || 0) > 0 ? 'Active' : 'Empty',
        statusTone: Number(cart.itemCount || 0) > 0 ? 'processing' : 'review',
        details: `${normalizeText(cart.userName) || 'Customer'} • ${Number(cart.itemCount || 0)} items • ${formatCurrency(cart.estimatedTotal || 0)}`,
        date: cart.updatedAt || cart.createdAt
    }));

    return orderActivity
        .concat(customerActivity)
        .concat(messageActivity)
        .concat(visitActivity)
        .concat(inventoryActivity)
        .concat(cartActivity)
        .sort((left, right) => normalizeTimestamp(right.date) - normalizeTimestamp(left.date))
        .slice(0, 8);
}

function serializeCart(cart) {
    const user = cart?.user && typeof cart.user === 'object' ? cart.user : {};
    const items = Array.isArray(cart?.items) ? cart.items : [];
    const normalizedItems = items.map((entry) => {
        const product = entry?.product && typeof entry.product === 'object' ? entry.product : {};
        const quantity = Math.max(0, Number(entry?.quantity || 0) || 0);
        const price = Number(product.price || 0) || 0;

        return {
            productId: normalizeText(product._id || product.id),
            catalogId: Number(product.catalogId || 0) || 0,
            name: normalizeText(product.name || product.title) || 'Product',
            quantity,
            price,
            stock: Number(product.stock || 0) || 0,
            image: normalizeText(product.mainImage || product.image),
            total: quantity * price
        };
    }).filter((item) => item.quantity > 0);

    const itemCount = normalizedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const estimatedTotal = normalizedItems.reduce((sum, item) => sum + Number(item.total || 0), 0);

    return {
        id: normalizeText(cart?._id),
        userId: normalizeText(user.id || user._id),
        userName: normalizeText(user.name) || 'Customer',
        userEmail: normalizeText(user.email),
        userPhone: normalizeText(user.phone),
        itemCount,
        estimatedTotal,
        items: normalizedItems,
        createdAt: cart?.createdAt || null,
        updatedAt: cart?.updatedAt || cart?.createdAt || null
    };
}

exports.getDashboardSnapshot = async (_req, res) => {
    const logger = (_req?.log || appLogger).child({ scope: 'admin_dashboard' });
    try {
        const recentLimit = 100;
        const activityLimit = 200;

        if (config.databaseClient === 'sqlite') {
            const customers = sortAndSliceRecent(await userDataService.listCustomers(), recentLimit, 'createdAt');
            const [orders, products, cartsRaw] = await Promise.all([
                orderDataService.listAdminOrders({ limit: recentLimit, page: 1 }),
                productDataService.listProducts({ limit: recentLimit, page: 1 }),
                cartDataService.listAllCarts(customers)
            ]);

            const customerLookup = new Map(customers.map((customer) => [String(customer.id), customer]));
            const carts = sortAndSliceRecent(cartsRaw.map((cart) => {
                const customer = customerLookup.get(String(cart.userId || cart.user || '')) || {};
                const items = Array.isArray(cart.items) ? cart.items.map((item) => ({
                    productId: normalizeText(item.productId || item.product?._id),
                    catalogId: Number(item.product?.catalogId || item.product?.id || 0) || 0,
                    name: normalizeText(item.product?.name || item.product?.title) || 'Product',
                    quantity: Math.max(0, Number(item.quantity || 0) || 0),
                    price: Number(item.product?.price || 0) || 0,
                    stock: Number(item.product?.stock || 0) || 0,
                    image: normalizeText(item.product?.mainImage || item.product?.image),
                    total: (Math.max(0, Number(item.quantity || 0) || 0) * (Number(item.product?.price || 0) || 0))
                })) : [];
                const itemCount = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
                const estimatedTotal = items.reduce((sum, item) => sum + Number(item.total || 0), 0);
                return {
                    id: normalizeText(cart.id || cart.userId),
                    userId: normalizeText(cart.userId || cart.user),
                    userName: normalizeText(customer.name) || 'Customer',
                    userEmail: normalizeText(customer.email),
                    userPhone: normalizeText(customer.phone),
                    itemCount,
                    estimatedTotal,
                    items,
                    createdAt: cart.createdAt || null,
                    updatedAt: cart.updatedAt || null
                };
            }), recentLimit, 'updatedAt');

            const messages = [];
            const recentVisits = [];
            const totalSales = orders.reduce((sum, order) => sum + Number(order.totalAmount ?? order.totalPrice ?? order.total ?? 0), 0);
            const pendingOrders = orders.filter((order) => normalizeText(order.status || order.orderStatus).toLowerCase() === 'pending').length;
            const recentUsers = customers.filter((customer) => normalizeTimestamp(customer.createdAt) >= startOfDay(-7).getTime()).length;
            const lowStockProducts = products.filter((product) => Number(product.stock || 0) <= 5).length;
            const outOfStockProducts = products.filter((product) => Number(product.stock || 0) <= 0).length;
            const ordersToday = orders.filter((order) => normalizeTimestamp(order.createdAt || order.date) >= startOfDay(0).getTime()).length;
            const ordersCount = orders.length;
            const customersCount = customers.length;
            const productsCount = products.length;
            const messagesCount = 0;
            const newMessages = 0;
            const visitsCount = 0;
            const cartsCount = carts.length;
            const cartsWithItems = carts.filter((cart) => Number(cart.itemCount || 0) > 0).length;
            const totalCartItems = carts.reduce((sum, cart) => sum + Number(cart.itemCount || 0), 0);
            const totalStock = products.reduce((sum, product) => sum + Number(product.stock || 0), 0);

            return res.json({
                success: true,
                snapshot: {
                    stats: {
                        totalSales,
                        ordersCount,
                        ordersNote: ordersCount ? `${pendingOrders} pending orders from the centralized order database` : 'No orders in the centralized database yet',
                        customersCount,
                        customersNote: customersCount ? `${recentUsers} new customers in the last 7 days` : 'No registered customers yet',
                        productsCount,
                        productsNote: productsCount ? `${lowStockProducts} low-stock products across the live catalog` : 'No live products found',
                        salesNote: ordersCount ? `${formatCurrency(totalSales)} across ${ordersCount} centralized orders` : 'No recorded order totals yet',
                        messagesCount,
                        messagesNote: 'Support inbox migration is not implemented yet',
                        visitsCount,
                        visitsNote: 'Visit tracking migration is not implemented yet',
                        cartsCount,
                        cartsWithItems,
                        totalCartItems,
                        cartsNote: cartsCount ? `${cartsWithItems} active carts with ${totalCartItems} tracked cart items` : 'No carts in the centralized cart system yet'
                    },
                    activity: buildRecentActivity({ orders, customers, messages, visits: recentVisits, products, carts }),
                    summary: [
                        {
                            label: 'Catalog coverage',
                            value: productsCount ? `${productsCount} live products • ${outOfStockProducts} out of stock` : 'No catalog products detected'
                        },
                        {
                            label: 'Order queue',
                            value: ordersCount ? `${pendingOrders} pending from ${ordersCount} total orders` : 'No centralized orders yet'
                        },
                        {
                            label: 'Customer base',
                            value: customersCount ? `${customersCount} registered customers • ${recentUsers} joined this week` : 'No registered customers found'
                        },
                        {
                            label: 'Support inbox',
                            value: 'Support inbox migration is not implemented yet'
                        },
                        {
                            label: 'Site activity',
                            value: ordersToday ? `${ordersToday} orders created today` : 'Visit tracking migration is not implemented yet'
                        },
                        {
                            label: 'Global cart load',
                            value: cartsCount ? `${cartsWithItems} active carts • ${totalCartItems} items in carts` : 'No active carts in the centralized system'
                        }
                    ],
                    analytics: {
                        salesSeries: buildSalesSeries(orders),
                        orderStatusBreakdown: buildOrderStatusBreakdown(orders),
                        inventory: {
                            totalProducts: productsCount,
                            totalStock,
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
                            visits: visitsCount,
                            messages: messagesCount,
                            orders: ordersCount,
                            customers: customersCount,
                            carts: cartsCount
                        }
                    },
                    raw: {
                        orders,
                        customers,
                        products,
                        messages,
                        visits: recentVisits,
                        carts
                    },
                    syncedAt: new Date().toISOString(),
                    source: 'api'
                }
            });
        }

        const ContactMessage = require('../models/contactmessage');
        const Cart = require('../models/cart');
        const CustomerActivity = require('../models/customeractivity');
        const Order = require('../models/order');
        const Product = require('../models/product');
        const User = require('../models/user');

        const [orderMetrics, customerMetrics, productMetrics, messageMetrics, visitMetrics, cartMetrics, recentOrders, recentCustomers, recentProducts, recentMessages, visits, recentCarts, salesSeries, orderStatusBreakdown] = await Promise.all([
            Order.aggregate([
                {
                    $group: {
                        _id: null,
                        totalSales: { $sum: { $ifNull: ['$totalAmount', { $ifNull: ['$totalPrice', '$total'] }] } },
                        ordersCount: { $sum: 1 },
                        pendingOrders: {
                            $sum: {
                                $cond: [{ $eq: [{ $toLower: { $ifNull: ['$status', '$orderStatus'] } }, 'pending'] }, 1, 0]
                            }
                        },
                        ordersToday: {
                            $sum: {
                                $cond: [{ $gte: ['$createdAt', startOfDay(0)] }, 1, 0]
                            }
                        }
                    }
                }
            ]),
            User.aggregate([
                { $match: { role: { $ne: 'admin' } } },
                {
                    $group: {
                        _id: null,
                        customersCount: { $sum: 1 },
                        recentUsers: {
                            $sum: {
                                $cond: [{ $gte: ['$createdAt', startOfDay(-7)] }, 1, 0]
                            }
                        }
                    }
                }
            ]),
            Product.aggregate([
                {
                    $group: {
                        _id: null,
                        productsCount: { $sum: 1 },
                        totalStock: { $sum: { $ifNull: ['$stock', 0] } },
                        lowStockProducts: {
                            $sum: {
                                $cond: [{ $lte: [{ $ifNull: ['$stock', 0] }, 5] }, 1, 0]
                            }
                        },
                        outOfStockProducts: {
                            $sum: {
                                $cond: [{ $lte: [{ $ifNull: ['$stock', 0] }, 0] }, 1, 0]
                            }
                        }
                    }
                }
            ]),
            ContactMessage.aggregate([
                {
                    $group: {
                        _id: null,
                        messagesCount: { $sum: 1 },
                        newMessages: {
                            $sum: {
                                $cond: [{ $eq: [{ $toLower: { $ifNull: ['$status', ''] } }, 'new'] }, 1, 0]
                            }
                        }
                    }
                }
            ]),
            CustomerActivity.aggregate([
                { $match: { eventType: 'visit' } },
                {
                    $group: {
                        _id: null,
                        visitsCount: { $sum: 1 }
                    }
                }
            ]),
            Cart.aggregate([
                {
                    $project: {
                        itemCount: {
                            $sum: '$items.quantity'
                        }
                    }
                },
                {
                    $group: {
                        _id: null,
                        cartsCount: { $sum: 1 },
                        cartsWithItems: {
                            $sum: {
                                $cond: [{ $gt: ['$itemCount', 0] }, 1, 0]
                            }
                        },
                        totalCartItems: {
                            $sum: {
                                $ifNull: ['$itemCount', 0]
                            }
                        }
                    }
                }
            ]),
            Order.find({})
                .sort({ createdAt: -1, updatedAt: -1 })
                .limit(recentLimit)
                .select('orderId id customerName totalAmount totalPrice total status orderStatus createdAt date items products')
                .lean(),
            User.find({ role: { $ne: 'admin' } })
                .sort({ createdAt: -1 })
                .limit(recentLimit)
                .select('id name email phone createdAt')
                .lean(),
            Product.find({})
                .sort({ updatedAt: -1, createdAt: -1 })
                .limit(recentLimit)
                .select('catalogId name category stock updatedAt createdAt')
                .lean(),
            ContactMessage.find({})
                .sort({ createdAt: -1, updatedAt: -1 })
                .limit(recentLimit)
                .select('name email phone message status createdAt updatedAt')
                .lean(),
            CustomerActivity.find({ eventType: 'visit' })
                .sort({ createdAt: -1, updatedAt: -1 })
                .limit(activityLimit)
                .select('path device city startedAt createdAt updatedAt')
                .lean(),
            Cart.find({})
                .sort({ updatedAt: -1, createdAt: -1 })
                .limit(Math.min(recentLimit, 120))
                .select('user items createdAt updatedAt')
                .populate({ path: 'user', select: 'id name email phone' })
                .populate({ path: 'items.product', select: 'catalogId name title price stock image mainImage' })
                .lean(),
            Order.aggregate([
                { $match: { createdAt: { $gte: startOfWeek(-1) } } },
                {
                    $group: {
                        _id: {
                            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                        },
                        total: { $sum: { $ifNull: ['$totalAmount', { $ifNull: ['$totalPrice', '$total'] }] } }
                    }
                },
                { $sort: { _id: 1 } }
            ]),
            Order.aggregate([
                {
                    $group: {
                        _id: { $toLower: { $ifNull: ['$status', '$orderStatus'] } },
                        count: { $sum: 1 }
                    }
                }
            ])
        ]);

        const orderMetric = orderMetrics[0] || {};
        const customerMetric = customerMetrics[0] || {};
        const productMetric = productMetrics[0] || {};
        const messageMetric = messageMetrics[0] || {};
        const visitMetric = visitMetrics[0] || {};
        const cartMetric = cartMetrics[0] || {};

        const orders = sortAndSliceRecent(recentOrders, recentLimit, 'createdAt');
        const customers = sortAndSliceRecent(recentCustomers, recentLimit, 'createdAt');
        const products = sortAndSliceRecent(recentProducts, recentLimit, 'updatedAt');
        const messages = sortAndSliceRecent(recentMessages, recentLimit, 'createdAt');
        const recentVisits = sortAndSliceRecent(visits, activityLimit, 'createdAt');
        const carts = sortAndSliceRecent(recentCarts.map(serializeCart), recentLimit, 'updatedAt');

        const totalSales = Number(orderMetric.totalSales || 0);
        const pendingOrders = Number(orderMetric.pendingOrders || 0);
        const recentUsers = Number(customerMetric.recentUsers || 0);
        const newMessages = Number(messageMetric.newMessages || 0);
        const lowStockProducts = Number(productMetric.lowStockProducts || 0);
        const outOfStockProducts = Number(productMetric.outOfStockProducts || 0);
        const ordersToday = Number(orderMetric.ordersToday || 0);
        const ordersCount = Number(orderMetric.ordersCount || 0);
        const customersCount = Number(customerMetric.customersCount || 0);
        const productsCount = Number(productMetric.productsCount || 0);
        const messagesCount = Number(messageMetric.messagesCount || 0);
        const visitsCount = Number(visitMetric.visitsCount || 0);
        const cartsCount = Number(cartMetric.cartsCount || 0);
        const cartsWithItems = Number(cartMetric.cartsWithItems || 0);
        const totalCartItems = Number(cartMetric.totalCartItems || 0);

        return res.json({
            success: true,
            snapshot: {
                stats: {
                    totalSales,
                    ordersCount,
                    ordersNote: ordersCount ? `${pendingOrders} pending orders from the centralized order database` : 'No orders in the centralized database yet',
                    customersCount,
                    customersNote: customersCount ? `${recentUsers} new customers in the last 7 days` : 'No registered customers yet',
                    productsCount,
                    productsNote: productsCount ? `${lowStockProducts} low-stock products across the live catalog` : 'No live products found',
                    salesNote: ordersCount ? `${formatCurrency(totalSales)} across ${ordersCount} centralized orders` : 'No recorded order totals yet',
                    messagesCount,
                    messagesNote: messagesCount ? `${newMessages} new support messages in the shared inbox` : 'No support messages yet',
                    visitsCount,
                    visitsNote: visitsCount ? `${visitsCount} tracked visits across all devices` : 'No tracked visits yet',
                    cartsCount,
                    cartsWithItems,
                    totalCartItems,
                    cartsNote: cartsCount ? `${cartsWithItems} active carts with ${totalCartItems} tracked cart items` : 'No carts in the centralized cart system yet'
                },
                activity: buildRecentActivity({ orders, customers, messages, visits: recentVisits, products, carts }),
                summary: [
                    {
                        label: 'Catalog coverage',
                        value: productsCount ? `${productsCount} live products • ${outOfStockProducts} out of stock` : 'No catalog products detected'
                    },
                    {
                        label: 'Order queue',
                        value: ordersCount ? `${pendingOrders} pending from ${ordersCount} total orders` : 'No centralized orders yet'
                    },
                    {
                        label: 'Customer base',
                        value: customersCount ? `${customersCount} registered customers • ${recentUsers} joined this week` : 'No registered customers found'
                    },
                    {
                        label: 'Support inbox',
                        value: messagesCount ? `${newMessages} new from ${messagesCount} shared contact submissions` : 'No shared contact submissions yet'
                    },
                    {
                        label: 'Site activity',
                        value: visitsCount ? `${visitsCount} tracked visits • ${ordersToday} orders created today` : 'No tracked visits recorded yet'
                    },
                    {
                        label: 'Global cart load',
                        value: cartsCount ? `${cartsWithItems} active carts • ${totalCartItems} items in carts` : 'No active carts in the centralized system'
                    }
                ],
                analytics: {
                    salesSeries: salesSeries.map((entry) => ({
                        label: new Date(entry._id).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                        total: Number(entry.total || 0)
                    })),
                    orderStatusBreakdown: orderStatusBreakdown.reduce((accumulator, entry) => {
                        const statusLabel = mapOrderStatus(entry._id).label;
                        accumulator[statusLabel] = (accumulator[statusLabel] || 0) + Number(entry.count || 0);
                        return accumulator;
                    }, {}),
                    inventory: {
                        totalProducts: productsCount,
                        totalStock: Number(productMetric.totalStock || 0),
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
                        visits: visitsCount,
                        messages: messagesCount,
                        orders: ordersCount,
                        customers: customersCount,
                        carts: cartsCount
                    }
                },
                raw: {
                    orders,
                    customers,
                    products,
                    messages,
                    visits: recentVisits,
                    carts
                },
                syncedAt: new Date().toISOString(),
                source: 'api'
            }
        });
    } catch (error) {
        logger.error('admin.dashboard.snapshot_failed', { error });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};