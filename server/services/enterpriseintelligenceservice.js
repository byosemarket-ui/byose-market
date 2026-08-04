const config = require('../config/env');
const Cart = require('../models/cart');
const ContactMessage = require('../models/contactmessage');
const CustomerActivity = require('../models/customeractivity');
const Order = require('../models/order');
const Product = require('../models/product');
const User = require('../models/user');
const productDataService = require('./productdataservice');
const orderDataService = require('./orderdataservice');
const userDataService = require('./userdataservice');
const cartDataService = require('./cartdataservice');
const activityDataService = require('./activitydataservice');
const messageDataService = require('./messagedataservice');
const getRealtimeEventService = require('./realtimeeventservice');


function normalizeText(value) {
    return String(value || '').trim();
}

function toNumber(value, fallbackValue = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallbackValue;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toTimestamp(value) {
    if (!value) {
        return 0;
    }

    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function startOfDay(dateInput = new Date()) {

    const date = new Date(dateInput);
    date.setHours(0, 0, 0, 0);
    return date;
}

function dayLabel(dateInput) {
    const date = new Date(dateInput);
    return Number.isFinite(date.getTime())
        ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '-';
}

function monthLabel(dateInput) {
    const date = new Date(dateInput);
    return Number.isFinite(date.getTime())
        ? date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
        : '-';
}

function normalizeOrderStatus(status) {
    const value = normalizeText(status).toLowerCase();
    if (value.includes('deliver') || value.includes('complete')) return 'Delivered';
    if (value.includes('ship')) return 'Shipping';
    if (value.includes('confirm') || value.includes('process') || value.includes('payment')) return 'Confirmed';
    if (value.includes('cancel')) return 'Cancelled';
    if (value.includes('return')) return 'Returned';
    return 'Pending';
}

function escapeCsv(value) {
    const text = String(value ?? '');
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }

    return text;
}

function rowsToCsv(rows = []) {
    if (!Array.isArray(rows) || !rows.length) {
        return '';
    }

    const headers = Object.keys(rows[0]);
    const lines = [headers.map(escapeCsv).join(',')];

    rows.forEach((row) => {
        lines.push(headers.map((header) => escapeCsv(row?.[header])).join(','));
    });

    return lines.join('\n');
}

function buildSimplePdfBuffer(title, rows = []) {
    const safeTitle = normalizeText(title) || 'Byose Market Report';
    const lines = [safeTitle, `Generated: ${new Date().toISOString()}`, ''];

    rows.slice(0, 60).forEach((row, index) => {
        lines.push(`${index + 1}. ${Object.entries(row || {}).map(([key, value]) => `${key}: ${String(value ?? '')}`).join(' | ')}`);
    });

    if (rows.length > 60) {
        lines.push(`... ${rows.length - 60} additional rows omitted in PDF preview`);
    }

    const safeLines = lines.map((line) => String(line || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'));
    const content = safeLines.map((line, index) => `BT /F1 10 Tf 40 ${790 - (index * 13)} Td (${line}) Tj ET`).join('\n');

    const objects = [];
    const addObject = (body) => {
        objects.push(body);
        return objects.length;
    };

    const catalogId = addObject('<< /Type /Catalog /Pages 2 0 R >>');
    const pagesId = addObject('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    const pageId = addObject('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>');
    const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const streamData = `${content}\n`;
    const contentId = addObject(`<< /Length ${Buffer.byteLength(streamData, 'utf8')} >>\nstream\n${streamData}endstream`);

    const header = '%PDF-1.4\n';
    let body = '';
    const xref = [0];

    objects.forEach((obj, index) => {
        xref.push(Buffer.byteLength(header + body, 'utf8'));
        body += `${index + 1} 0 obj\n${obj}\nendobj\n`;
    });

    const xrefStart = Buffer.byteLength(header + body, 'utf8');
    const xrefTable = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f ']
        .concat(xref.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `))
        .join('\n');
    const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

    return Buffer.from(`${header}${body}${xrefTable}\n${trailer}`, 'utf8');
}

function buildTopProducts(orders = []) {
    const map = new Map();

    orders.forEach((order) => {
        const items = Array.isArray(order?.items) && order.items.length
            ? order.items
            : Array.isArray(order?.products)
                ? order.products
                : [];

        items.forEach((item) => {
            const key = normalizeText(item?.productId || item?.id || item?.productName || item?.name);
            if (!key) return;

            const current = map.get(key) || {
                id: normalizeText(item?.productId || item?.id),
                name: normalizeText(item?.productName || item?.name) || 'Product',
                quantity: 0,
                revenue: 0,
                orders: 0
            };

            const quantity = Math.max(1, toNumber(item?.quantity || item?.qty || 1, 1));
            const price = toNumber(item?.price, 0);
            current.quantity += quantity;
            current.revenue += (quantity * price);
            current.orders += 1;
            map.set(key, current);
        });
    });

    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 12);
}

function buildDailySeries(orders, visits, customers, rangeDays) {
    const series = [];

    for (let dayOffset = rangeDays - 1; dayOffset >= 0; dayOffset -= 1) {
        const dayStart = startOfDay(Date.now() - (dayOffset * 24 * 60 * 60 * 1000));
        const dayEnd = new Date(dayStart.getTime() + (24 * 60 * 60 * 1000));

        const dayOrders = orders.filter((order) => {
            const createdAt = new Date(order?.createdAt || order?.date || 0).getTime();
            return createdAt >= dayStart.getTime() && createdAt < dayEnd.getTime();
        });
        const dayVisits = visits.filter((visit) => {
            const createdAt = new Date(visit?.createdAt || visit?.startedAt || 0).getTime();
            return createdAt >= dayStart.getTime() && createdAt < dayEnd.getTime();
        });
        const dayCustomers = customers.filter((customer) => {
            const createdAt = new Date(customer?.createdAt || 0).getTime();
            return createdAt >= dayStart.getTime() && createdAt < dayEnd.getTime();
        });

        const revenue = dayOrders.reduce((sum, order) => sum + toNumber(order?.totalAmount ?? order?.totalPrice ?? order?.total, 0), 0);
        const ordersCount = dayOrders.length;
        const visitsCount = dayVisits.length;

        series.push({
            label: dayLabel(dayStart),
            revenue,
            orders: ordersCount,
            visits: visitsCount,
            conversionRate: visitsCount > 0 ? (ordersCount / visitsCount) * 100 : 0,
            newCustomers: dayCustomers.length
        });
    }

    return series;
}

function buildMonthlyRevenueSeries(orders) {
    const map = new Map();
    const now = new Date();

    for (let offset = 5; offset >= 0; offset -= 1) {
        const month = new Date(now.getFullYear(), now.getMonth() - offset, 1);
        map.set(monthLabel(month), 0);
    }

    orders.forEach((order) => {
        const createdAt = new Date(order?.createdAt || order?.date || 0);
        if (!Number.isFinite(createdAt.getTime())) return;

        const key = monthLabel(new Date(createdAt.getFullYear(), createdAt.getMonth(), 1));
        if (!map.has(key)) return;

        map.set(key, toNumber(map.get(key), 0) + toNumber(order?.totalAmount ?? order?.totalPrice ?? order?.total, 0));
    });

    return Array.from(map.entries()).map(([label, total]) => ({ label, total }));
}

function buildStatusBreakdown(orders) {
    return orders.reduce((accumulator, order) => {
        const key = normalizeOrderStatus(order?.status || order?.orderStatus || order?.paymentStatus);
        accumulator[key] = toNumber(accumulator[key], 0) + 1;
        return accumulator;
    }, {});
}

function buildInventoryInsights(products = []) {
    const lowStockThreshold = 5;
    const outOfStock = products.filter((product) => toNumber(product?.stock, 0) <= 0);
    const lowStock = products.filter((product) => toNumber(product?.stock, 0) > 0 && toNumber(product?.stock, 0) <= lowStockThreshold);

    return {
        totalProducts: products.length,
        totalUnits: products.reduce((sum, product) => sum + toNumber(product?.stock, 0), 0),
        lowStockCount: lowStock.length,
        outOfStockCount: outOfStock.length,
        lowStockProducts: lowStock.slice(0, 20).map((product) => ({
            id: normalizeText(product?.catalogId || product?._id),
            name: normalizeText(product?.name || product?.title) || 'Product',
            stock: toNumber(product?.stock, 0),
            category: normalizeText(product?.category) || 'general',
            updatedAt: product?.updatedAt || product?.createdAt || null
        })),
        outOfStockProducts: outOfStock.slice(0, 20).map((product) => ({
            id: normalizeText(product?.catalogId || product?._id),
            name: normalizeText(product?.name || product?.title) || 'Product',
            category: normalizeText(product?.category) || 'general',
            updatedAt: product?.updatedAt || product?.createdAt || null
        }))
    };
}

function buildBehaviorInsights(activity = [], orders = [], carts = []) {
    const addToCartSignals = activity.filter((entry) => /cart|add/i.test(normalizeText(entry?.eventType || entry?.path || entry?.meta?.event)));
    const checkoutSignals = activity.filter((entry) => /checkout|payment|order/i.test(normalizeText(entry?.eventType || entry?.path || entry?.meta?.event)));
    const activeCarts = carts.filter((cart) => Array.isArray(cart?.items) && cart.items.some((item) => toNumber(item?.quantity, 0) > 0));

    return {
        addToCartSignals: addToCartSignals.length,
        checkoutSignals: checkoutSignals.length,
        activeCarts: activeCarts.length,
        cartItems: carts.reduce((sum, cart) => sum + (Array.isArray(cart?.items) ? cart.items.reduce((cartSum, item) => cartSum + toNumber(item?.quantity, 0), 0) : 0), 0),
        abandonmentSignals: Math.max(0, activeCarts.length - orders.length)
    };
}

async function fetchAllAdminOrdersFromSQLite(maxPages = 6, pageSize = 500) {
    const orders = [];

    for (let page = 1; page <= maxPages; page += 1) {
        const batch = await orderDataService.listAdminOrders({ limit: pageSize, page });
        orders.push(...batch);
        if (batch.length < pageSize) {
            break;
        }
    }

    return orders;
}

async function loadAnalyticsDatasetSQLite(_sinceDate) {

    const customerLimit = 4000;
    const activityLimit = 4000;
    const messageLimit = 2000;

    const [customersRaw, products, activity, messages] = await Promise.all([
        userDataService.listCustomers(),
        productDataService.listAllProducts(),
        activityDataService.listActivity({ limit: activityLimit, offset: 0 }),
        messageDataService.listMessages({ limit: messageLimit, page: 1 })
    ]);

    const orders = await fetchAllAdminOrdersFromSQLite();
    const customers = customersRaw.slice(0, customerLimit);
    const carts = await cartDataService.listAllCarts(customersRaw);

    return {
        orders,
        customers,
        products,
        messages,
        activity,
        carts
    };
}

async function loadAnalyticsDatasetMongo(sinceDate) {
    const recentLimit = 3000;
    const customerLimit = 4000;
    const messageLimit = 2000;
    const activityLimit = 4000;
    const cartLimit = 1200;

    const [orders, customers, products, messages, activity, carts] = await Promise.all([
        Order.find({ createdAt: { $gte: sinceDate } })
            .sort({ createdAt: -1, updatedAt: -1 })
            .limit(recentLimit)
            .select('orderId id customerName customerEmail customerPhone status orderStatus paymentStatus totalAmount totalPrice total createdAt updatedAt items products')
            .lean(),
        User.find({ role: { $ne: 'admin' } })
            .sort({ createdAt: -1 })
            .limit(customerLimit)
            .select('id name email phone createdAt')
            .lean(),
        Product.find({})
            .sort({ updatedAt: -1, createdAt: -1 })
            .limit(recentLimit)
            .select('catalogId name title category stock price visibility status updatedAt createdAt')
            .lean(),
        ContactMessage.find({ createdAt: { $gte: sinceDate } })
            .sort({ createdAt: -1, updatedAt: -1 })
            .limit(messageLimit)
            .select('messageId name email phone message source status meta createdAt updatedAt')
            .lean(),
        CustomerActivity.find({ createdAt: { $gte: sinceDate } })
            .sort({ createdAt: -1, updatedAt: -1 })
            .limit(activityLimit)
            .select('clientActivityId eventType path device city country level createdAt updatedAt startedAt meta')
            .lean(),
        Cart.find({})
            .sort({ updatedAt: -1, createdAt: -1 })
            .limit(cartLimit)
            .select('user items createdAt updatedAt')
            .populate({ path: 'user', select: 'id name email phone' })
            .populate({ path: 'items.product', select: 'catalogId name title price stock mainImage image' })
            .lean()
    ]);

    return { orders, customers, products, messages, activity, carts };
}

async function collectBaseData(rangeDays = 30) {
    const safeRangeDays = Math.min(180, Math.max(7, Number(rangeDays) || 30));
    const sinceDate = new Date(Date.now() - (safeRangeDays * DAY_MS));
    const dataset = config.databaseClient === 'sqlite'
        ? await loadAnalyticsDatasetSQLite(sinceDate)
        : await loadAnalyticsDatasetMongo(sinceDate);

    const sinceMs = sinceDate.getTime();

    const orders = Array.isArray(dataset.orders)
        ? dataset.orders.filter((order) => toTimestamp(order?.createdAt || order?.date) >= sinceMs)
        : [];
    const customers = Array.isArray(dataset.customers) ? dataset.customers : [];
    const products = Array.isArray(dataset.products) ? dataset.products : [];
    const messages = Array.isArray(dataset.messages)
        ? dataset.messages.filter((message) => toTimestamp(message?.createdAt) >= sinceMs)
        : [];
    const activity = Array.isArray(dataset.activity)
        ? dataset.activity.filter((entry) => toTimestamp(entry?.createdAt || entry?.startedAt) >= sinceMs)
        : [];
    const carts = Array.isArray(dataset.carts) ? dataset.carts : [];

    const visitEvents = activity.filter((entry) => normalizeText(entry?.eventType).toLowerCase() === 'visit');
    const statusBreakdown = buildStatusBreakdown(orders);
    const totalRevenue = orders.reduce((sum, order) => sum + toNumber(order?.totalAmount ?? order?.totalPrice ?? order?.total, 0), 0);
    const ordersCount = orders.length;
    const visitsCount = visitEvents.length;
    const conversionRate = visitsCount > 0 ? (ordersCount / visitsCount) * 100 : 0;
    const completedOrders = toNumber(statusBreakdown.Delivered, 0);
    const fulfillmentRate = ordersCount > 0 ? (completedOrders / ordersCount) * 100 : 0;
    const averageOrderValue = ordersCount > 0 ? (totalRevenue / ordersCount) : 0;
    const topProducts = buildTopProducts(orders);
    const inventory = buildInventoryInsights(products);
    const dailySeries = buildDailySeries(orders, visitEvents, customers, safeRangeDays);
    const monthlyRevenue = buildMonthlyRevenueSeries(orders);
    const behavior = buildBehaviorInsights(activity, orders, carts);

    const customerGrowth = [];
    const monthMap = new Map();
    const now = new Date();
    for (let offset = 5; offset >= 0; offset -= 1) {
        const month = new Date(now.getFullYear(), now.getMonth() - offset, 1);
        monthMap.set(monthLabel(month), 0);
    }

    customers.forEach((customer) => {
        const createdAt = new Date(customer?.createdAt || 0);
        if (!Number.isFinite(createdAt.getTime())) return;
        const key = monthLabel(new Date(createdAt.getFullYear(), createdAt.getMonth(), 1));
        if (monthMap.has(key)) {
            monthMap.set(key, toNumber(monthMap.get(key), 0) + 1);
        }
    });

    let cumulative = 0;
    Array.from(monthMap.entries()).forEach(([label, joined]) => {
        cumulative += toNumber(joined, 0);
        customerGrowth.push({ label, joined: toNumber(joined, 0), cumulative });
    });

    const realtimeService = getRealtimeEventService();
    const recentEvents = realtimeService.getRecentEvents(120);
    const realtimeStats = realtimeService.getStats();

    const monitoring = {
        generatedAt: new Date().toISOString(),
        rangeDays: safeRangeDays,
        realtime: realtimeStats,
        eventLogs: recentEvents,
        activityLogs: activity.slice(0, 120),
        openMessages: messages.filter((message) => normalizeText(message?.status).toLowerCase().includes('new')).length,
        alerts: [
            ...(inventory.lowStockCount > 0 ? [{ tone: 'warn', title: 'Low stock alert', detail: `${inventory.lowStockCount} products are below threshold` }] : []),
            ...(inventory.outOfStockCount > 0 ? [{ tone: 'danger', title: 'Out of stock alert', detail: `${inventory.outOfStockCount} products are out of stock` }] : []),
            ...(behavior.abandonmentSignals > 0 ? [{ tone: 'warn', title: 'Potential cart abandonment', detail: `${behavior.abandonmentSignals} active carts are not converted yet` }] : []),
            ...(conversionRate > 0 && conversionRate < 1 ? [{ tone: 'warn', title: 'Low conversion trend', detail: `Conversion currently at ${conversionRate.toFixed(2)}%` }] : [])
        ]
    };

    const summary = {
        revenue: totalRevenue,
        ordersCount,
        customersCount: customers.length,
        productsCount: products.length,
        visitsCount,
        conversionRate,
        fulfillmentRate,
        averageOrderValue,
        pendingOrders: toNumber(statusBreakdown.Pending, 0),
        completedOrders,
        activeCarts: behavior.activeCarts,
        cartItems: behavior.cartItems
    };

    return {
        generatedAt: new Date().toISOString(),
        rangeDays: safeRangeDays,
        summary,
        analytics: {
            salesAnalytics: {
                dailySeries,
                statusBreakdown,
                pendingOrders: summary.pendingOrders,
                completedOrders
            },
            revenueAnalytics: {
                totalRevenue,
                averageOrderValue,
                monthlyRevenue,
                dailyRevenue: dailySeries.map((entry) => ({ label: entry.label, total: entry.revenue }))
            },
            customerAnalytics: {
                totalCustomers: customers.length,
                customerGrowth,
                returningCustomers: customers.filter((customer) => toNumber(customer?.totalOrders, 0) >= 2).length
            },
            productPerformanceAnalytics: {
                topProducts,
                totalTrackedProducts: topProducts.length
            },
            inventoryAnalytics: inventory,
            conversionAnalytics: {
                conversionRate,
                visitsCount,
                checkoutSignals: behavior.checkoutSignals,
                addToCartSignals: behavior.addToCartSignals
            },
            trafficAnalytics: {
                totalEvents: activity.length,
                visitEvents: visitsCount,
                recentActivity: activity.slice(0, 100)
            }
        },
        trends: {
            orderTrends: dailySeries.map((entry) => ({ label: entry.label, total: entry.orders })),
            revenueTrends: dailySeries.map((entry) => ({ label: entry.label, total: entry.revenue })),
            customerGrowthTrends: customerGrowth,
            inventoryMovementTrends: products.slice(0, 200).map((product) => ({
                label: normalizeText(product?.name || product?.title) || `SKU-${product?.catalogId || '-'}`,
                stock: toNumber(product?.stock, 0),
                updatedAt: product?.updatedAt || product?.createdAt || null
            })),
            productPerformanceTrends: topProducts
        },
        operationalIntelligence: {
            topSellingProducts: topProducts,
            lowStockIntelligence: inventory.lowStockProducts,
            customerBehaviorInsights: behavior,
            salesTrends: dailySeries,
            performanceInsights: {
                conversionRate,
                fulfillmentRate,
                averageOrderValue,
                revenuePerVisit: visitsCount > 0 ? totalRevenue / visitsCount : 0
            },
            monitoringInsights: monitoring
        },
        datasets: {
            orders,
            customers,
            products,
            messages,
            activity,
            carts
        }
    };
}


function buildRowsForReport(type, overview) {
    const reportType = normalizeText(type).toLowerCase();
    const summary = overview?.summary || {};

    if (reportType === 'sales') {
        return (overview?.analytics?.salesAnalytics?.dailySeries || []).map((entry) => ({
            Date: entry.label,
            Orders: entry.orders,
            Revenue: toNumber(entry.revenue, 0),
            Visits: entry.visits,
            ConversionRate: `${toNumber(entry.conversionRate, 0).toFixed(2)}%`
        }));
    }

    if (reportType === 'revenue') {
        return (overview?.analytics?.revenueAnalytics?.monthlyRevenue || []).map((entry) => ({
            Period: entry.label,
            Revenue: toNumber(entry.total, 0)
        }));
    }

    if (reportType === 'inventory') {
        return (overview?.datasets?.products || []).map((product) => ({
            ProductId: normalizeText(product?.catalogId || product?._id),
            Name: normalizeText(product?.name || product?.title) || 'Product',
            Category: normalizeText(product?.category) || 'general',
            Stock: toNumber(product?.stock, 0),
            Price: toNumber(product?.price, 0),
            UpdatedAt: product?.updatedAt || product?.createdAt || ''
        }));
    }

    if (reportType === 'customers') {
        return (overview?.datasets?.customers || []).map((customer) => ({
            CustomerId: normalizeText(customer?.id || customer?._id),
            Name: normalizeText(customer?.name) || 'Customer',
            Email: normalizeText(customer?.email),
            Phone: normalizeText(customer?.phone),
            JoinedAt: customer?.createdAt || ''
        }));
    }

    if (reportType === 'analytics') {
        return [
            { Metric: 'Total Revenue', Value: toNumber(summary.revenue, 0) },
            { Metric: 'Total Orders', Value: toNumber(summary.ordersCount, 0) },
            { Metric: 'Total Customers', Value: toNumber(summary.customersCount, 0) },
            { Metric: 'Total Products', Value: toNumber(summary.productsCount, 0) },
            { Metric: 'Visits', Value: toNumber(summary.visitsCount, 0) },
            { Metric: 'Conversion Rate', Value: `${toNumber(summary.conversionRate, 0).toFixed(2)}%` },
            { Metric: 'Fulfillment Rate', Value: `${toNumber(summary.fulfillmentRate, 0).toFixed(2)}%` },
            { Metric: 'Average Order Value', Value: toNumber(summary.averageOrderValue, 0) },
            { Metric: 'Active Carts', Value: toNumber(summary.activeCarts, 0) },
            { Metric: 'Cart Items', Value: toNumber(summary.cartItems, 0) }
        ];
    }

    if (reportType === 'activity') {
        return (overview?.datasets?.activity || []).map((entry) => ({
            EventType: normalizeText(entry?.eventType),
            Path: normalizeText(entry?.path),
            Device: normalizeText(entry?.device),
            City: normalizeText(entry?.city),
            Country: normalizeText(entry?.country),
            CreatedAt: entry?.createdAt || entry?.startedAt || ''
        }));
    }

    return (overview?.datasets?.orders || []).map((order) => ({
        OrderId: normalizeText(order?.orderId || order?.id),
        Customer: normalizeText(order?.customerName) || 'Customer',
        Status: normalizeOrderStatus(order?.status || order?.orderStatus || order?.paymentStatus),
        Total: toNumber(order?.totalAmount ?? order?.totalPrice ?? order?.total, 0),
        CreatedAt: order?.createdAt || order?.date || ''
    }));
}

async function getEnterpriseOverview(options = {}) {
    const rangeDays = Math.min(180, Math.max(7, Number(options?.rangeDays) || 30));
    return collectBaseData(rangeDays);
}

async function exportEnterpriseReport(options = {}) {
    const format = normalizeText(options?.format || 'csv').toLowerCase();
    const reportType = normalizeText(options?.reportType || 'analytics').toLowerCase();
    const rangeDays = Math.min(180, Math.max(7, Number(options?.rangeDays) || 30));

    const overview = await getEnterpriseOverview({ rangeDays });
    const rows = buildRowsForReport(reportType, overview);

    if (format === 'pdf') {
        return {
            format,
            filename: `byose_${reportType}_report_${new Date().toISOString().slice(0, 10)}.pdf`,
            mimeType: 'application/pdf',
            payload: buildSimplePdfBuffer(`Byose ${reportType.toUpperCase()} Report`, rows)
        };
    }

    return {
        format: 'csv',
        filename: `byose_${reportType}_report_${new Date().toISOString().slice(0, 10)}.csv`,
        mimeType: 'text/csv; charset=utf-8',
        payload: Buffer.from(rowsToCsv(rows), 'utf8')
    };
}

module.exports = {
    getEnterpriseOverview,
    exportEnterpriseReport
};
