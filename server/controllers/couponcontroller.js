const { appLogger } = require('../utils/logger');
const userDataService = require('../services/userdataservice');
const couponDataService = require('../services/coupondataservice');

async function resolveUser(req) {
    if (!req.user || !req.user.id) return null;
    return userDataService.findUserById(req.user.id);
}

function parseItems(body) {
    if (Array.isArray(body?.items)) return body.items;
    if (Array.isArray(body?.products)) return body.products;
    return [];
}

exports.getCoupons = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'coupons' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const coupons = await couponDataService.getCustomerCoupons(user, {
            status: req.query?.status || 'all',
            subtotal: Number(req.query?.subtotal || 0) || 0
        });
        return res.json({ success: true, coupons });
    } catch (err) {
        logger.error('coupons.get_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getAvailable = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'coupons' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const coupons = await couponDataService.getAvailableCoupons(user, {
            subtotal: Number(req.query?.subtotal || 0) || 0
        });
        return res.json({ success: true, coupons });
    } catch (err) {
        logger.error('coupons.available_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getUsed = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'coupons' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const coupons = await couponDataService.getUsedCoupons(user);
        return res.json({ success: true, coupons });
    } catch (err) {
        logger.error('coupons.used_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getExpired = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'coupons' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const coupons = await couponDataService.getExpiredCoupons(user);
        return res.json({ success: true, coupons });
    } catch (err) {
        logger.error('coupons.expired_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.applyCoupon = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'coupons' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const result = await couponDataService.applyCoupon(user, {
            ...(req.body || {}),
            items: parseItems(req.body)
        });
        if (result.error) {
            return res.status(result.status || 400).json({ success: false, message: result.error });
        }

        return res.json({ success: true, ...result.data });
    } catch (err) {
        logger.error('coupons.apply_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.validateCoupon = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'coupons' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const result = await couponDataService.validateCouponForCheckout(user, {
            ...(req.body || {}),
            items: parseItems(req.body)
        });
        if (result.error) {
            return res.status(result.status || 400).json({ success: false, message: result.error });
        }

        return res.json({ success: true, ...result.data });
    } catch (err) {
        logger.error('coupons.validate_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getCounts = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'coupons' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const data = await couponDataService.getCouponCounts(user);
        return res.json({ success: true, ...data });
    } catch (err) {
        logger.error('coupons.count_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Unable to load coupon counts.' });
    }
};
