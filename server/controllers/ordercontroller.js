const { appLogger, monitorAsyncOperation } = require('../utils/logger');
const orderDataService = require('../services/orderdataservice');
const userDataService = require('../services/userdataservice');
const productDataService = require('../services/productdataservice');
const getRealtimeEventService = require('../services/realtimeeventservice');
const { getRepositoryBundle } = require('../repositories');
const { notifyOrderConfirmed, notifyOrderStatusChanged: notifyOrderStatusEmail } = require('../utils/notifications');
const notificationEngine = require('../services/notification-engine.service');
const { normalizeRwandaPhone, isValidRwandaPhone: isValidSharedRwandaPhone } = require('../utils/phone');
const { isSettledPaidStatus } = require('../payments/payment-status');
const { isProductPublished } = require('../utils/product-visibility');
const {
    isCodPaymentMethod,
    resolveStorefrontPaymentMethod,
    storefrontPaymentMethodLabel
} = require('../payments/storefront-methods');

const DELIVERY_FEE = 2000;
const COD_FEE = 0;
const REQUIRED_SHIPPING_FIELDS = ['fullName', 'phone', 'provinceCity', 'district', 'sector', 'cell', 'village'];

async function resolveUser(req) {
    if (!req.user || !req.user.id) return null;
    return userDataService.findUserById(req.user.id);
}

function normalizeText(value) {
    return String(value == null ? '' : value).trim();
}

function locationText(...values) {
    for (let i = 0; i < values.length; i += 1) {
        const value = values[i];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const nested = locationText(value.name, value.label, value.value, value.title, value.text, value.displayName);
            if (nested) return nested;
            continue;
        }
        const text = normalizeText(value);
        if (!text) continue;
        const lower = text.toLowerCase();
        if (lower === 'undefined' || lower === 'null' || lower === '[object object]') continue;
        return text;
    }
    return '';
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

function applyPaymentStatusUpdate(order, paymentStatus) {
    // Explicit payment-status path only. Fulfillment/delivery updates must not call this.
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

function validateShippingAddress(shippingAddress = {}, paymentMethod = '') {
    const errors = [];
    REQUIRED_SHIPPING_FIELDS.forEach((field) => {
        const fallback = field === 'provinceCity'
            ? locationText(shippingAddress.city, shippingAddress.province)
            : '';
        const aliases = field === 'cell'
            ? locationText(shippingAddress.cellName, shippingAddress.cell_name)
            : field === 'village'
                ? locationText(shippingAddress.villageName, shippingAddress.village_name)
                : '';
        if (!locationText(shippingAddress[field], fallback, aliases)) {
            errors.push(`${field} is required`);
        }
    });

    const phone = normalizePhone(shippingAddress.phone);
    if (!isValidRwandaPhone(phone)) {
        errors.push('Enter a valid Rwanda phone number');
    }

    if (isCodPaymentMethod(paymentMethod)) {
        const city = normalizeText(shippingAddress.provinceCity || shippingAddress.city).toLowerCase();
        if (!city.includes('kigali')) {
            errors.push('Cash on Delivery is only available in Kigali');
        }
    }

    return errors;
}

function createItemError(message, code, productId, extra = {}) {
    const error = new Error(message);
    error.code = code;
    error.productId = productId || null;
    error.statusCode = extra.statusCode || 409;
    Object.assign(error, extra);
    return error;
}

function extractColorVariants(product) {
    const variants = product?.variants && typeof product.variants === 'object' ? product.variants : {};
    const metadata = product?.metadata && typeof product.metadata === 'object' ? product.metadata : {};
    if (Array.isArray(variants.colorVariants)) return variants.colorVariants;
    if (Array.isArray(metadata.colorVariants)) return metadata.colorVariants;
    return [];
}

function firstPositivePrice(...values) {
    for (const value of values) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
}

function resolveCatalogUnitPrice(product, color, sizeRow) {
    return firstPositivePrice(
        sizeRow?.price,
        sizeRow?.unitPrice,
        sizeRow?.salePrice,
        color?.price,
        color?.unitPrice,
        product?.price,
        product?.discountPrice,
        product?.salePrice
    );
}

async function applyCatalogPricing(items = []) {
    const source = Array.isArray(items) ? items : [];
    const uniqueIds = Array.from(new Set(source.map((item) => normalizeText(item.productId)).filter(Boolean)));
    const catalogById = new Map();
    const { products: productRepo } = getRepositoryBundle();

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
            throw createItemError('Order item is missing productId', 'INVALID_ORDER_ITEM');
        }

        const quantity = Number(item.quantity);
        if (!Number.isFinite(quantity) || quantity < 1 || Math.floor(quantity) !== quantity) {
            throw createItemError(
                `Quantity must be a whole number greater than zero for ${item.productName || productId}`,
                'INVALID_QUANTITY',
                productId
            );
        }

        const product = catalogById.get(productId);
        if (!product) {
            throw createItemError(`Product not found: ${productId}`, 'PRODUCT_NOT_FOUND', productId);
        }

        if (!isProductPublished(product)) {
            throw createItemError(
                `Product is not available: ${product.name || productId}`,
                'PRODUCT_UNAVAILABLE',
                productId
            );
        }

        const colorVariants = extractColorVariants(product);
        let matchedColor = null;
        let matchedSize = null;

        if (colorVariants.length) {
            const colorTokens = productRepo.collectColorTokens(item);
            const sizeTokens = productRepo.collectSizeTokens(item);
            if (!colorTokens.length && !sizeTokens.length) {
                throw createItemError(
                    `Color/size selection required for ${product.name || productId}`,
                    'INVALID_ORDER_ITEM',
                    productId
                );
            }

            matchedColor = productRepo.findColorVariantFromTokens(colorVariants, colorTokens) || (
                colorVariants.length === 1 ? colorVariants[0] : null
            );
            if (!matchedColor) {
                throw createItemError(
                    `Color variant unavailable for ${product.name || productId}`,
                    'VARIANT_NOT_FOUND',
                    productId
                );
            }

            const sizes = Array.isArray(matchedColor.sizes) ? matchedColor.sizes : [];
            if (sizes.length) {
                if (!sizeTokens.length) {
                    throw createItemError(
                        `Size selection required for ${product.name || productId}`,
                        'INVALID_ORDER_ITEM',
                        productId
                    );
                }
                matchedSize = productRepo.findSizeRowFromTokens(sizes, sizeTokens);
                if (!matchedSize) {
                    throw createItemError(
                        `Size variant unavailable for ${product.name || productId}`,
                        'VARIANT_NOT_FOUND',
                        productId
                    );
                }
                const available = Math.max(0, Number(matchedSize.stock) || 0);
                if (available < quantity) {
                    throw createItemError(
                        `Insufficient stock for ${product.name || productId}`,
                        'INSUFFICIENT_STOCK',
                        productId,
                        { available }
                    );
                }
            } else {
                const available = Math.max(0, Number(matchedColor.stock ?? matchedColor.totalStock ?? product.stock) || 0);
                if (available < quantity) {
                    throw createItemError(
                        `Insufficient stock for ${product.name || productId}`,
                        'INSUFFICIENT_STOCK',
                        productId,
                        { available }
                    );
                }
            }
        } else {
            const available = Math.max(0, Number(product.stock) || 0);
            if (available < quantity) {
                throw createItemError(
                    `Insufficient stock for ${product.name || productId}`,
                    'INSUFFICIENT_STOCK',
                    productId,
                    { available }
                );
            }
        }

        const unitPrice = resolveCatalogUnitPrice(product, matchedColor, matchedSize);
        if (unitPrice <= 0) {
            throw createItemError(
                `Product has invalid catalog price: ${productId}`,
                'INVALID_ORDER_ITEM',
                productId
            );
        }

        const sku = normalizeText(
            item.sku
            || item.variantSku
            || matchedSize?.sku
            || matchedColor?.sku
            || product.sku
            || product.metadata?.sku
        );
        const variantId = normalizeText(
            item.variantId
            || matchedSize?.id
            || matchedColor?.id
            || item.variantKey
        );
        const colorImage = normalizeText(item.colorImage || matchedColor?.image);
        const image = normalizeText(item.image || colorImage || product.mainImage || product.image);

        return {
            ...item,
            productId,
            variantId,
            variantKey: normalizeText(item.variantKey || variantId),
            productName: normalizeText(product.name || product.title) || item.productName || 'Product',
            price: unitPrice,
            sku,
            variantSku: sku,
            image,
            colorImage,
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
            const colorName = normalizeText(item?.colorName || item?.color || attributes.colorName || attributes.Color);
            const sizeLabel = normalizeText(item?.sizeLabel || item?.size || attributes.sizeLabel || attributes.Size);
            const colorId = normalizeText(item?.colorId || attributes.colorId || item?.variantSelection?.colorId || '');
            const sizeValue = normalizeText(item?.sizeValue || attributes.sizeValue || item?.variantSelection?.sizeValue || '');
            const variantKey = normalizeText(item?.variantKey || item?.variantSelection?.key || '');

            return {
                productId: normalizeText(item?.productId || item?.id),
                productName: normalizeText(item?.productName || item?.name) || 'Product',
                quantity: Number.isFinite(Number(item?.quantity ?? item?.qty))
                    ? Number(item?.quantity ?? item?.qty)
                    : 0,
                price: Number(item?.price || 0) || 0,
                image,
                colorImage: normalizeText(item?.colorImage || attributes.colorImage),
                color: colorName,
                colorName,
                colorId,
                size: sizeLabel,
                sizeLabel,
                sizeValue,
                variantKey,
                sku,
                variantSku: sku,
                category,
                productUrl,
                productLink: productUrl,
                slug: normalizeText(item?.slug),
                attributeSummary: normalizeText(item?.attributeSummary),
                attributes: {
                    ...attributes,
                    Color: colorId || attributes.Color || colorName,
                    Size: sizeValue || attributes.Size || sizeLabel,
                    colorId: colorId || attributes.colorId,
                    sizeValue: sizeValue || attributes.sizeValue,
                    colorName: colorName || attributes.colorName,
                    sizeLabel: sizeLabel || attributes.sizeLabel,
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
    const incomingFull = source.fullAddress && typeof source.fullAddress === 'object' ? source.fullAddress : {};
    const incomingGps = source.gpsLocation && typeof source.gpsLocation === 'object' ? source.gpsLocation : {};
    const provinceCity = locationText(
        shippingAddress.provinceCity,
        shippingAddress.city,
        shippingAddress.province,
        incomingFull.provinceCity,
        incomingFull.province,
        incomingFull.city
    );
    const district = locationText(shippingAddress.district, shippingAddress.districtName, incomingFull.district, incomingFull.districtName);
    const sector = locationText(shippingAddress.sector, shippingAddress.sectorName, incomingFull.sector, incomingFull.sectorName);
    const cell = locationText(shippingAddress.cell, shippingAddress.cellName, shippingAddress.cell_name, incomingFull.cell, incomingFull.cellName);
    const village = locationText(shippingAddress.village, shippingAddress.villageName, shippingAddress.village_name, incomingFull.village, incomingFull.villageName);
    const landmark = locationText(shippingAddress.note, shippingAddress.landmark, incomingFull.note, incomingFull.landmark);
    const latitude = locationText(incomingGps.latitude, shippingAddress.latitude);
    const longitude = locationText(incomingGps.longitude, shippingAddress.longitude);
    const mapLink = locationText(incomingGps.googleMapsLink, incomingGps.mapLink, shippingAddress.mapLink);
    const subtotal = items.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
    );
    // Never accept delivery totals from the client blindly — createOrder recalculates
    // shipping using Delivery Settings. Placeholder fee kept for interim totals only.
    const shippingFee = DELIVERY_FEE;
    const codFee = COD_FEE;
    const total = subtotal + shippingFee + codFee;
    const paymentMethodRaw = normalizePaymentMethod(source.paymentMethod || source.payment?.method);
    const resolvedPayment = resolveStorefrontPaymentMethod(paymentMethodRaw);
    const paymentMethod = resolvedPayment.ok ? resolvedPayment.id : paymentMethodRaw;
    const paymentMethodLabel = resolvedPayment.ok
        ? resolvedPayment.label
        : storefrontPaymentMethodLabel(paymentMethodRaw, paymentMethodRaw);
    const paymentType = resolvedPayment.ok ? resolvedPayment.paymentType : (isCodPaymentMethod(paymentMethod) ? 'cod' : 'pay_now');
    // Storefront create must never trust client-supplied payment settlement.
    // Gateway orders start awaiting payment; COD starts awaiting delivery payment.
    const paymentStatus = isCodPaymentMethod(paymentMethod) ? 'awaiting_delivery_payment' : 'awaiting_payment';
    const paymentStatusLabel = isCodPaymentMethod(paymentMethod) ? 'Awaiting Delivery Payment' : 'Awaiting Payment';
    const deliveryMethodKey = 'homeDelivery';
    const createdAt = source.createdAt || source.date || source.timestamp || new Date().toISOString();

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
        customerName: locationText(shippingAddress.fullName, source.customerName, customer.name, user?.name) || 'Guest Customer',
        customerImage: normalizeText(source.customerImage || customer.avatar || customer.image || user?.avatar),
        status: 'Pending',
        orderStatus: 'pending',
        paymentStatus,
        paymentStatusLabel,
        paymentMethod,
        paymentMethodLabel,
        paymentType,
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
        deliveryMethod: 'delivery',
        deliveryMethodKey,
        deliveryLabel: 'Delivery to address',
        items,
        products: items,
        shippingAddress: {
            ...shippingAddress,
            fullName: locationText(shippingAddress.fullName, source.customerName, customer.name, user?.name),
            phone: customerPhone,
            country: locationText(shippingAddress.country) || 'Rwanda',
            provinceCity,
            city: provinceCity,
            district,
            sector,
            cell,
            village,
            note: landmark,
            latitude,
            longitude,
            mapLink
        },
        fullAddress: {
            ...incomingFull,
            province: provinceCity,
            district,
            sector,
            cell,
            village,
            note: landmark
        },
        gpsLocation: {
            ...incomingGps,
            latitude,
            longitude,
            googleMapsLink: mapLink,
            mapLink,
            accuracy: locationText(incomingGps.accuracy, shippingAddress.locationAccuracy),
            capturedAt: locationText(incomingGps.capturedAt, shippingAddress.locationCapturedAt)
        },
        payment: {
            type: paymentType,
            method: paymentMethod,
            methodLabel: paymentMethodLabel,
            status: paymentStatus,
            statusLabel: paymentStatusLabel,
            checkoutSource: normalizeText(source.checkoutSource || source.source),
            transaction: { state: paymentStatus }
        },
        customer: {
            id: customerId,
            name: locationText(shippingAddress.fullName, source.customerName, customer.name, user?.name) || 'Guest Customer',
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
    const wasPaid = isSettledPaidStatus(paymentStatus);

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

        const resolvedPayment = resolveStorefrontPaymentMethod(normalizedOrder.paymentMethod);
        if (!normalizedOrder.paymentMethod) {
            return res.status(400).json({
                success: false,
                code: 'PAYMENT_METHOD_REQUIRED',
                message: 'Select a payment method.'
            });
        }
        if (!resolvedPayment.ok) {
            return res.status(400).json({
                success: false,
                code: resolvedPayment.code || 'UNSUPPORTED_PAYMENT_METHOD',
                message: resolvedPayment.message || 'That payment method is not supported.'
            });
        }
        normalizedOrder.paymentMethod = resolvedPayment.id;
        normalizedOrder.paymentMethodLabel = resolvedPayment.label;
        normalizedOrder.paymentType = resolvedPayment.paymentType;
        if (normalizedOrder.payment && typeof normalizedOrder.payment === 'object') {
            normalizedOrder.payment.method = resolvedPayment.id;
            normalizedOrder.payment.methodLabel = resolvedPayment.label;
            normalizedOrder.payment.type = resolvedPayment.paymentType;
        }

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
        normalizedOrder.currency = String(platformSettings.currency || 'RWF').trim().toUpperCase() || 'RWF';

        // Default payment status in General Settings must never mark a new order paid.
        // Settlement comes only from DPO verify, COD-on-delivery, or an authenticated Admin.

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
            return res.status(400).json({ success: false, code: 'PAYMENT_METHOD_REQUIRED', message: 'Select a payment method.' });
        }

        try {
            const pricedItems = await applyCatalogPricing(normalizedOrder.items);
            const subtotal = pricedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
            const deliverySettingsService = require('../services/deliverysettings.service');
            const shippingQuote = await deliverySettingsService.calculateShipping({
                subtotal,
                address: normalizedOrder.shippingAddress || {},
                method: 'homeDelivery'
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
            if (pricingError?.code === 'PRODUCT_NOT_FOUND'
                || pricingError?.code === 'INVALID_ORDER_ITEM'
                || pricingError?.code === 'INSUFFICIENT_STOCK'
                || pricingError?.code === 'PRODUCT_UNAVAILABLE'
                || pricingError?.code === 'VARIANT_NOT_FOUND'
                || pricingError?.code === 'INVALID_QUANTITY') {
                return res.status(409).json({
                    success: false,
                    message: pricingError.message,
                    code: pricingError.code,
                    productId: pricingError.productId || null,
                    available: Number.isFinite(pricingError.available) ? pricingError.available : undefined
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
        if (err?.code === 'INSUFFICIENT_STOCK'
            || err?.code === 'PRODUCT_NOT_FOUND'
            || err?.code === 'INVALID_ORDER_ITEM'
            || err?.code === 'PRODUCT_UNAVAILABLE'
            || err?.code === 'VARIANT_NOT_FOUND'
            || err?.code === 'INVALID_QUANTITY') {
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

function toPublicOrderConfirmation(order) {
    const items = (Array.isArray(order?.items) ? order.items : (Array.isArray(order?.products) ? order.products : []))
        .map((item) => ({
            productId: normalizeText(item.productId || item.id),
            variantId: normalizeText(item.variantId || item.variantKey),
            variantKey: normalizeText(item.variantKey),
            productName: normalizeText(item.productName || item.name) || 'Product',
            name: normalizeText(item.productName || item.name) || 'Product',
            quantity: Number(item.quantity || item.qty) || 0,
            qty: Number(item.quantity || item.qty) || 0,
            price: Number(item.price) || 0,
            image: normalizeText(item.image),
            colorImage: normalizeText(item.colorImage),
            color: normalizeText(item.color || item.colorName),
            colorName: normalizeText(item.colorName || item.color),
            size: normalizeText(item.size || item.sizeLabel),
            sizeLabel: normalizeText(item.sizeLabel || item.size),
            sku: normalizeText(item.sku || item.variantSku),
            variantSku: normalizeText(item.variantSku || item.sku)
        }));
    const shipping = order?.shippingAddress && typeof order.shippingAddress === 'object' ? order.shippingAddress : {};
    const gps = order?.gpsLocation && typeof order.gpsLocation === 'object' ? order.gpsLocation : {};
    const method = normalizeText(order.paymentMethod || order.payment?.method);
    const status = normalizeText(order.paymentStatus || order.payment?.status);
    const orderStatus = normalizeText(order.orderStatus || order.status, 'pending') || 'pending';
    const gateway = order?.payment?.gateway && typeof order.payment.gateway === 'object'
        ? order.payment.gateway
        : {};
    const paymentReference = normalizeText(
        order.paymentReference
        || order.transactionReference
        || gateway.transRef
        || order.payment?.reference
        || order.payment?.transaction?.reference
    );
    const checkoutSource = normalizeText(
        order.checkoutSource
        || order.payment?.checkoutSource
        || order.source
    );
    const isCod = method === 'cod' || normalizeText(order.paymentType || order.payment?.type) === 'cod';
    return {
        orderId: normalizeText(order.orderId || order.id),
        customerName: normalizeText(order.customerName || shipping.fullName),
        customerPhone: normalizeText(order.customerPhone || shipping.phone),
        items,
        subtotal: Number(order.subtotal) || 0,
        deliveryFee: Number(order.deliveryFee ?? order.shippingFee) || 0,
        codFee: Number(order.codFee) || 0,
        couponCode: normalizeText(order.couponCode),
        couponDiscount: Number(order.couponDiscount) || 0,
        total: Number(order.totalAmount ?? order.total) || 0,
        currency: normalizeText(order.currency, 'RWF') || 'RWF',
        paymentMethod: method,
        paymentMethodLabel: normalizeText(order.paymentMethodLabel || order.payment?.methodLabel) || storefrontPaymentMethodLabel(method, method),
        paymentStatus: status,
        paymentStatusLabel: normalizeText(order.paymentStatusLabel || order.payment?.statusLabel),
        orderStatus,
        orderStatusLabel: isCod
            ? 'Pending'
            : (orderStatus === 'processing' ? 'PROCESSING' : (normalizeText(order.status) || 'Pending')),
        checkoutSource,
        paymentReference: paymentReference || '',
        payment: {
            method,
            methodLabel: normalizeText(order.paymentMethodLabel || order.payment?.methodLabel) || storefrontPaymentMethodLabel(method, method),
            status,
            statusLabel: normalizeText(order.paymentStatusLabel || order.payment?.statusLabel),
            type: normalizeText(order.paymentType || order.payment?.type),
            reference: paymentReference || '',
            mode: isCod ? '' : normalizeText(gateway.mode)
        },
        shippingAddress: {
            fullName: locationText(shipping.fullName, order.customerName),
            phone: locationText(shipping.phone, order.customerPhone),
            provinceCity: locationText(shipping.provinceCity, shipping.city),
            district: locationText(shipping.district, shipping.districtName),
            sector: locationText(shipping.sector, shipping.sectorName),
            cell: locationText(shipping.cell, shipping.cellName),
            village: locationText(shipping.village, shipping.villageName),
            note: locationText(shipping.note, shipping.landmark)
        },
        gpsLocation: {
            latitude: locationText(gps.latitude, shipping.latitude),
            longitude: locationText(gps.longitude, shipping.longitude),
            googleMapsLink: locationText(gps.googleMapsLink, gps.mapLink, shipping.mapLink)
        },
        createdAt: order.createdAt || null,
        updatedAt: order.updatedAt || null
    };
}

// Sanitized Success-page lookup. Does not expose DPO credentials or raw tokens.
exports.getPublicOrderConfirmation = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'orders' });
    try {
        const orderId = normalizeText(req.params.id);
        if (!orderId) {
            return res.status(400).json({ success: false, message: 'orderId required' });
        }

        const order = await monitorAsyncOperation(
            logger,
            'database.order.find_confirmation',
            { orderId },
            () => orderDataService.findOrderByIdentifier(orderId),
            { slowThresholdMs: 700 }
        );
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        return res.json({ success: true, confirmation: toPublicOrderConfirmation(order) });
    } catch (err) {
        logger.error('order.confirmation_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Unable to load order confirmation.' });
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
                // Delivery/fulfillment status must never mutate payment status.
                // COD stays unpaid until payment is explicitly recorded as received.
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
            const adminSecurityService = require('../services/adminsecurityservice');
            const repos = getRepositoryBundle();
            const nextStatus = order.status || order.orderStatus || '';
            const nextPayment = order.paymentStatus || order.payment?.status || '';
            const orderId = order.orderId || order.id;
            const statusChanged = oldStatusLower !== normalizeText(nextStatus).toLowerCase();
            const paymentChanged = normalizeText(previousPaymentStatus).toLowerCase() !== normalizeText(nextPayment).toLowerCase();
            const summaryParts = [];
            if (statusChanged) {
                summaryParts.push(`Admin changed Order #${orderId} from ${oldStatus} to ${nextStatus}.`);
            }
            if (paymentChanged) {
                summaryParts.push(`Payment status for Order #${orderId} changed from ${previousPaymentStatus || 'unset'} to ${nextPayment}.`);
            }
            if (normalizedReturnAction) {
                summaryParts.push(`Admin applied ${normalizedReturnAction} on Order #${orderId}.`);
            }
            const statusEvent = notificationEngine.mapStatusToEventKey(nextStatus);
            const previousKey = notificationEngine.mapStatusToEventKey(oldStatus);
            if (statusEvent && statusEvent !== previousKey) {
                summaryParts.push(`${statusEvent} notification generated.`);
            }
            if (summaryParts.length) {
                await repos.adminProfile.recordActivity({
                    adminPublicId: String(req.admin?.id || ''),
                    adminEmail: String(req.admin?.email || ''),
                    eventType: 'order_status_updated',
                    category: 'orders',
                    summary: summaryParts.join(' '),
                    meta: {
                        orderId,
                        from: oldStatus,
                        to: nextStatus,
                        paymentStatus: nextPayment,
                        previousPaymentStatus,
                        returnAction: normalizedReturnAction || null,
                        notificationEvent: statusEvent && statusEvent !== previousKey ? statusEvent : null
                    },
                    ip: adminSecurityService.buildRequestContext(req).ip,
                    userAgent: adminSecurityService.buildRequestContext(req).userAgent
                });
            }
        } catch (_activityError) {
            // Activity logging must never block a successful order status update.
        }

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

exports.applyCatalogPricing = applyCatalogPricing;
