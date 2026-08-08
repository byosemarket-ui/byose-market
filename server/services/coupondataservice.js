const { getRepositoryBundle } = require('../repositories');

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.coupons) {
        throw new Error('Coupon data service requires the SQLite repository bundle.');
    }
    return repositories;
}

function nowIso() {
    return new Date().toISOString();
}

function normalizeCode(value) {
    return String(value || '').trim().toUpperCase();
}

function isPublicCoupon(coupon) {
    const metadata = coupon?.metadata && typeof coupon.metadata === 'object' ? coupon.metadata : {};
    // Fail closed: only explicitly public coupons auto-assign.
    return metadata.isPublic === true || metadata.public === true;
}

function getApplicability(coupon) {
    const metadata = coupon?.metadata && typeof coupon.metadata === 'object' ? coupon.metadata : {};
    const products = metadata.applicableProducts ?? metadata.products ?? 'all';
    const categories = metadata.applicableCategories ?? metadata.categories ?? 'all';
    return {
        products: Array.isArray(products) ? products.map((id) => String(id)) : String(products || 'all'),
        categories: Array.isArray(categories) ? categories.map((id) => String(id).toLowerCase()) : String(categories || 'all').toLowerCase()
    };
}

function isRestrictedApplicability(applicability) {
    const productsRestricted = Array.isArray(applicability.products)
        ? (applicability.products.length > 0 && applicability.products[0] !== 'all')
        : (String(applicability.products || 'all').toLowerCase() !== 'all');
    const categoriesRestricted = Array.isArray(applicability.categories)
        ? (applicability.categories.length > 0 && applicability.categories[0] !== 'all')
        : (String(applicability.categories || 'all').toLowerCase() !== 'all');
    return productsRestricted || categoriesRestricted;
}

function computeEligibleSubtotal(coupon, { subtotal = 0, items = [] } = {}) {
    const applicability = getApplicability(coupon);
    const source = Array.isArray(items) ? items : [];
    if (!source.length || !isRestrictedApplicability(applicability)) {
        return Math.max(0, Number(subtotal) || 0);
    }

    const productRestricted = Array.isArray(applicability.products)
        ? (applicability.products.length > 0 && applicability.products[0] !== 'all')
        : (String(applicability.products || 'all').toLowerCase() !== 'all');
    const categoryRestricted = Array.isArray(applicability.categories)
        ? (applicability.categories.length > 0 && applicability.categories[0] !== 'all')
        : (String(applicability.categories || 'all').toLowerCase() !== 'all');

    const allowedProducts = productRestricted
        ? new Set((Array.isArray(applicability.products) ? applicability.products : [applicability.products]).map(String))
        : null;
    const allowedCategories = categoryRestricted
        ? new Set((Array.isArray(applicability.categories) ? applicability.categories : [applicability.categories]).map((v) => String(v).toLowerCase()))
        : null;

    let eligible = 0;
    source.forEach((item) => {
        const productId = String(item.productId || item.id || item.catalogId || '').trim();
        const category = String(item.category || item.categorySlug || '').trim().toLowerCase();
        const lineTotal = Math.max(0, Number(item.price || 0)) * Math.max(1, Number(item.quantity || item.qty || 1));

        let ok = true;
        if (allowedProducts) {
            ok = Boolean(productId) && allowedProducts.has(productId);
        }
        if (ok && allowedCategories) {
            ok = Boolean(category) && allowedCategories.has(category);
        }
        if (ok) eligible += lineTotal;
    });

    return Number(eligible.toFixed(2));
}

function evaluateCartEligibility(coupon, { subtotal = 0, items = [] } = {}) {
    const amount = Math.max(0, Number(subtotal) || 0);
    if (amount > 0 && amount < Number(coupon.minOrderAmount || 0)) {
        return {
            eligible: false,
            reason: `Minimum order amount is RWF ${Number(coupon.minOrderAmount || 0).toLocaleString('en-US')}`,
            eligibleSubtotal: 0
        };
    }

    const applicability = getApplicability(coupon);
    const source = Array.isArray(items) ? items : [];
    const productIds = source
        .map((item) => String(item.productId || item.id || item.catalogId || '').trim())
        .filter(Boolean);
    const categories = source
        .map((item) => String(item.category || item.categorySlug || '').trim().toLowerCase())
        .filter(Boolean);

    if (isRestrictedApplicability(applicability) && amount > 0 && !source.length) {
        return {
            eligible: false,
            reason: 'Add products to your cart before applying this coupon.',
            eligibleSubtotal: 0
        };
    }

    if (Array.isArray(applicability.products) && applicability.products.length && applicability.products[0] !== 'all') {
        const allowed = new Set(applicability.products.map(String));
        if (!productIds.length) {
            return { eligible: false, reason: 'This coupon requires eligible products in your cart.', eligibleSubtotal: 0 };
        }
        const hit = productIds.some((id) => allowed.has(id));
        if (!hit) {
            return { eligible: false, reason: 'This coupon does not apply to the products in your cart.', eligibleSubtotal: 0 };
        }
    } else if (typeof applicability.products === 'string' && applicability.products.toLowerCase() !== 'all') {
        // non-array restricted product list
        if (!productIds.length) {
            return { eligible: false, reason: 'This coupon requires eligible products in your cart.', eligibleSubtotal: 0 };
        }
    }

    if (Array.isArray(applicability.categories) && applicability.categories.length && applicability.categories[0] !== 'all') {
        const allowed = new Set(applicability.categories.map((value) => String(value).toLowerCase()));
        if (!categories.length) {
            return { eligible: false, reason: 'This coupon requires eligible categories in your cart.', eligibleSubtotal: 0 };
        }
        const hit = categories.some((category) => allowed.has(category));
        if (!hit) {
            return { eligible: false, reason: 'This coupon does not apply to the categories in your cart.', eligibleSubtotal: 0 };
        }
    }

    const eligibleSubtotal = computeEligibleSubtotal(coupon, { subtotal: amount, items: source });
    if (isRestrictedApplicability(applicability) && amount > 0 && eligibleSubtotal <= 0) {
        return { eligible: false, reason: 'No eligible items for this coupon.', eligibleSubtotal: 0 };
    }

    return { eligible: true, reason: '', eligibleSubtotal };
}

function isCouponCurrentlyValid(coupon, at = nowIso()) {
    if (!coupon || coupon.status !== 'active') {
        return false;
    }
    if (coupon.startsAt && coupon.startsAt > at) {
        return false;
    }
    if (coupon.expiresAt && coupon.expiresAt < at) {
        return false;
    }
    if (coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit) {
        return false;
    }
    return true;
}

function computeDiscount(coupon, orderAmount = 0) {
    const amount = Math.max(0, Number(orderAmount) || 0);
    if (amount < Number(coupon.minOrderAmount || 0)) {
        return 0;
    }

    let discount = 0;
    if (coupon.discountType === 'fixed') {
        discount = Number(coupon.discountValue || 0);
    } else {
        discount = (amount * Number(coupon.discountValue || 0)) / 100;
        if (Number(coupon.maxDiscountAmount || 0) > 0) {
            discount = Math.min(discount, Number(coupon.maxDiscountAmount));
        }
    }

    return Math.max(0, Math.min(amount, Number(discount.toFixed(2))));
}

function describeDiscount(coupon) {
    if (!coupon) return '';
    if (coupon.discountType === 'fixed') {
        return `RWF ${Number(coupon.discountValue || 0).toLocaleString('en-US')} off`;
    }
    return `${Number(coupon.discountValue || 0)}% off`;
}

function serializeCoupon(coupon) {
    if (!coupon) return null;
    const applicability = getApplicability(coupon);
    return {
        id: coupon.id,
        code: coupon.code,
        title: coupon.title || describeDiscount(coupon),
        description: coupon.description || '',
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        discountLabel: describeDiscount(coupon),
        minOrderAmount: coupon.minOrderAmount,
        maxDiscountAmount: coupon.maxDiscountAmount,
        startsAt: coupon.startsAt,
        expiresAt: coupon.expiresAt,
        usageLimit: coupon.usageLimit,
        usageCount: coupon.usageCount,
        perUserLimit: coupon.perUserLimit,
        status: coupon.status,
        applicableProducts: applicability.products,
        applicableCategories: applicability.categories,
        isPublic: isPublicCoupon(coupon)
    };
}

function serializeCustomerCoupon(entry, { eligibilityStatus = null, eligibilityReason = '' } = {}) {
    const coupon = entry.coupon || null;
    const expiredByDate = Boolean(coupon?.expiresAt && coupon.expiresAt < nowIso());
    let status = entry.status === 'available' && expiredByDate ? 'expired' : entry.status;
    if (eligibilityStatus === 'not_eligible' && status === 'available') {
        status = 'not_eligible';
    }

    return {
        id: entry.id,
        status,
        assignedAt: entry.assignedAt,
        usedAt: entry.usedAt,
        orderId: entry.orderId || '',
        eligibilityReason: eligibilityReason || '',
        coupon: serializeCoupon(coupon)
    };
}

async function ensurePublicCouponsAssigned(user) {
    const { coupons } = getRepos();
    const customerNotificationDataService = require('./customernotificationdataservice');
    const publicCoupons = await coupons.listActivePublic();
    for (const coupon of publicCoupons) {
        if (!isPublicCoupon(coupon)) continue;
        const redemptions = await coupons.countCustomerRedemptions(user.recordId, coupon.id);
        if (coupon.perUserLimit > 0 && redemptions >= coupon.perUserLimit) continue;
        const existing = await coupons.findCustomerCoupon(user.recordId, coupon.id);
        const assigned = await coupons.assignToUser(user.recordId, coupon.id, { status: 'available' });
        if (!existing && assigned) {
            void customerNotificationDataService.notifyCouponReceived(user.recordId, coupon);
        }
    }
}

async function getCustomerCoupons(user, { status = 'all', subtotal = 0, items = [] } = {}) {
    const { coupons } = getRepos();
    await coupons.markExpiredForUser(user.recordId);
    await ensurePublicCouponsAssigned(user);

    const entries = await coupons.listCustomerCoupons(user.recordId, {});
    const hasCartContext = Number(subtotal) > 0 || (Array.isArray(items) && items.length > 0);

    const itemsMapped = entries.map((entry) => {
        const coupon = entry.coupon;
        let eligibilityStatus = null;
        let eligibilityReason = '';

        if (entry.status === 'available' && coupon && hasCartContext) {
            const cartCheck = evaluateCartEligibility(coupon, { subtotal, items });
            if (!cartCheck.eligible) {
                eligibilityStatus = 'not_eligible';
                eligibilityReason = cartCheck.reason;
            }
        }

        return serializeCustomerCoupon(entry, { eligibilityStatus, eligibilityReason });
    });

    const normalizedStatus = String(status || 'all').toLowerCase();
    const filtered = itemsMapped.filter((entry) => {
        if (normalizedStatus === 'all') return true;
        if (normalizedStatus === 'available') return entry.status === 'available';
        if (normalizedStatus === 'not_eligible') return entry.status === 'not_eligible';
        return entry.status === normalizedStatus;
    });

    const counts = {
        available: itemsMapped.filter((item) => item.status === 'available').length,
        used: itemsMapped.filter((item) => item.status === 'used').length,
        expired: itemsMapped.filter((item) => item.status === 'expired').length,
        not_eligible: itemsMapped.filter((item) => item.status === 'not_eligible').length,
        total: itemsMapped.length
    };

    return { items: filtered, counts };
}

async function getAvailableCoupons(user, options) {
    return getCustomerCoupons(user, { ...(options || {}), status: 'available' });
}

async function getUsedCoupons(user) {
    return getCustomerCoupons(user, { status: 'used' });
}

async function getExpiredCoupons(user) {
    return getCustomerCoupons(user, { status: 'expired' });
}

async function validateCouponForCheckout(user, payload = {}) {
    const { coupons } = getRepos();
    const code = normalizeCode(payload.code);
    const subtotal = Math.max(0, Number(payload.orderAmount ?? payload.subtotal ?? 0) || 0);
    const items = Array.isArray(payload.items) ? payload.items : [];

    if (!code) {
        return { error: 'Coupon code required', status: 400 };
    }

    if (!user?.recordId) {
        return { error: 'Sign in to use coupons.', status: 401 };
    }

    await coupons.markExpiredForUser(user.recordId);
    const coupon = await coupons.findByCode(code);
    if (!coupon) {
        return { error: 'Coupon not found', status: 404 };
    }

    if (!isCouponCurrentlyValid(coupon)) {
        return { error: 'This coupon is not active.', status: 400 };
    }

    const redemptions = await coupons.countCustomerRedemptions(user.recordId, coupon.id);
    if (coupon.perUserLimit > 0 && redemptions >= coupon.perUserLimit) {
        return { error: 'You have already used this coupon.', status: 400 };
    }

    const assignment = await coupons.findCustomerCoupon(user.recordId, coupon.id);
    if (assignment?.status === 'used') {
        return { error: 'You have already used this coupon.', status: 400 };
    }
    if (assignment?.status === 'expired') {
        return { error: 'This coupon has expired.', status: 400 };
    }

    if (subtotal > 0 && subtotal < Number(coupon.minOrderAmount || 0)) {
        return {
            error: `Minimum order amount is RWF ${Number(coupon.minOrderAmount || 0).toLocaleString('en-US')}`,
            status: 400
        };
    }

    const cartCheck = evaluateCartEligibility(coupon, { subtotal, items });
    if (!cartCheck.eligible) {
        return { error: cartCheck.reason || 'This coupon is not eligible for your cart.', status: 400 };
    }

    const eligibleBase = Number(cartCheck.eligibleSubtotal > 0 ? cartCheck.eligibleSubtotal : subtotal);
    const discountAmount = computeDiscount(coupon, eligibleBase);
    if (subtotal > 0 && discountAmount <= 0) {
        return { error: 'This coupon cannot be applied to the current order amount.', status: 400 };
    }

    if (!assignment) {
        await coupons.assignToUser(user.recordId, coupon.id, { status: 'available' });
        try {
            const customerNotificationDataService = require('./customernotificationdataservice');
            void customerNotificationDataService.notifyCouponReceived(user.recordId, coupon);
        } catch (_error) {}
    }

    return {
        data: {
            valid: true,
            discountAmount,
            eligibleSubtotal: eligibleBase,
            coupon: serializeCoupon(coupon)
        }
    };
}

async function applyCoupon(user, payload = {}) {
    const validated = await validateCouponForCheckout(user, payload);
    if (validated.error) {
        return validated;
    }

    const { coupons } = getRepos();
    const customerNotificationDataService = require('./customernotificationdataservice');
    const coupon = await coupons.findByCode(normalizeCode(payload.code));
    const existing = await coupons.findCustomerCoupon(user.recordId, coupon.id);
    const assigned = await coupons.assignToUser(user.recordId, coupon.id, { status: 'available' });
    if (!existing && assigned) {
        void customerNotificationDataService.notifyCouponReceived(user.recordId, coupon);
    }

    return {
        data: {
            valid: true,
            discountAmount: validated.data.discountAmount,
            coupon: serializeCoupon(coupon),
            assignment: serializeCustomerCoupon(assigned)
        }
    };
}

async function redeemCouponForOrder(user, { code, orderId, discountAmount, subtotal, items } = {}) {
    const { coupons } = getRepos();
    const normalizedCode = normalizeCode(code);
    const normalizedOrderId = String(orderId || '').trim();

    if (!normalizedCode || !normalizedOrderId || !user?.recordId) {
        return { error: 'Coupon redemption requires a signed-in customer, code, and order.', status: 400 };
    }

    if (await coupons.hasRedemptionForOrder(normalizedOrderId)) {
        const existing = await coupons.findRedemptionByOrderId(normalizedOrderId);
        const coupon = await coupons.findByCode(normalizedCode);
        return {
            data: {
                couponId: existing?.couponId || coupon?.id || null,
                couponCode: coupon?.code || normalizedCode,
                discountAmount: Number(existing?.discountAmount || 0),
                alreadyRedeemed: true
            }
        };
    }

    const validation = await validateCouponForCheckout(user, {
        code: normalizedCode,
        subtotal,
        orderAmount: subtotal,
        items
    });
    if (validation.error) {
        return validation;
    }

    const coupon = await coupons.findByCode(normalizedCode);
    const serverDiscount = Number(validation.data.discountAmount || 0);
    const requestedDiscount = Number(discountAmount);
    if (Number.isFinite(requestedDiscount) && requestedDiscount > serverDiscount + 0.01) {
        return { error: 'Invalid coupon discount.', status: 400 };
    }

    // Ensure assignment exists before atomic mark-used.
    await coupons.assignToUser(user.recordId, coupon.id, { status: 'available' });

    try {
        const result = await coupons.redeemForOrderAtomic({
            userId: user.recordId,
            couponId: coupon.id,
            orderId: normalizedOrderId,
            discountAmount: serverDiscount
        });

        return {
            data: {
                couponId: coupon.id,
                couponCode: coupon.code,
                discountAmount: serverDiscount,
                alreadyRedeemed: Boolean(result?.alreadyRedeemed)
            }
        };
    } catch (error) {
        if (error?.code === 'COUPON_USAGE_LIMIT') {
            return { error: 'This coupon has reached its usage limit.', status: 400 };
        }
        if (await coupons.hasRedemptionForOrder(normalizedOrderId)) {
            return {
                data: {
                    couponId: coupon.id,
                    couponCode: coupon.code,
                    discountAmount: serverDiscount,
                    alreadyRedeemed: true
                }
            };
        }
        throw error;
    }
}

async function releaseCouponForOrder(orderId) {
    const { coupons } = getRepos();
    const normalizedOrderId = String(orderId || '').trim();
    if (!normalizedOrderId) {
        return { data: { released: false } };
    }
    const released = await coupons.releaseRedemptionForOrder(normalizedOrderId);
    return { data: { released: Boolean(released), redemption: released } };
}

async function getCouponCounts(user) {
    const { coupons } = getRepos();
    await coupons.markExpiredForUser(user.recordId);
    await ensurePublicCouponsAssigned(user);
    const [available, used, expired] = await Promise.all([
        coupons.countByUserAndStatus(user.recordId, 'available'),
        coupons.countByUserAndStatus(user.recordId, 'used'),
        coupons.countByUserAndStatus(user.recordId, 'expired')
    ]);
    return {
        counts: {
            available,
            used,
            expired,
            total: available + used + expired
        }
    };
}

module.exports = {
    getCustomerCoupons,
    getAvailableCoupons,
    getUsedCoupons,
    getExpiredCoupons,
    getCouponCounts,
    applyCoupon,
    validateCouponForCheckout,
    redeemCouponForOrder,
    releaseCouponForOrder,
    computeDiscount,
    isCouponCurrentlyValid,
    serializeCoupon
};
