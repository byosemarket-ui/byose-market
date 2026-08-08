const { appLogger } = require('../utils/logger');
const userDataService = require('../services/userdataservice');
const wishlistDataService = require('../services/wishlistdataservice');

async function resolveUser(req) {
    if (!req.user || !req.user.id) return null;
    return userDataService.findUserById(req.user.id);
}

exports.getWishlist = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'wishlist' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const wishlist = await wishlistDataService.getWishlistForUser(user);
        return res.json({ success: true, wishlist });
    } catch (err) {
        logger.error('wishlist.get_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getWishlistIds = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'wishlist' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const wishlist = await wishlistDataService.getWishlistIdsForUser(user);
        return res.json({ success: true, wishlist });
    } catch (err) {
        logger.error('wishlist.ids_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getCount = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'wishlist' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const data = await wishlistDataService.getWishlistCount(user);
        return res.json({ success: true, count: Number(data.count || 0) });
    } catch (err) {
        logger.error('wishlist.count_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Unable to load wishlist count.' });
    }
};

exports.mergeWishlist = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'wishlist' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const result = await wishlistDataService.mergeWishlist(user, req.body || {});
        return res.json({ success: true, wishlist: result.data });
    } catch (err) {
        logger.error('wishlist.merge_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.addItem = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'wishlist' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const result = await wishlistDataService.addToWishlist(user, req.body || {});
        if (result.error) {
            return res.status(result.status || 400).json({ success: false, message: result.error });
        }

        return res.json({ success: true, wishlist: result.data });
    } catch (err) {
        logger.error('wishlist.add_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.removeItem = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'wishlist' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const productId = req.params.productId || req.body?.productId;
        const result = await wishlistDataService.removeFromWishlist(user, productId);
        if (result.error) {
            return res.status(result.status || 400).json({ success: false, message: result.error });
        }

        return res.json({ success: true, wishlist: result.data });
    } catch (err) {
        logger.error('wishlist.remove_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.clearWishlist = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'wishlist' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const result = await wishlistDataService.clearWishlist(user);
        return res.json({ success: true, wishlist: result.data });
    } catch (err) {
        logger.error('wishlist.clear_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};
