const { appLogger } = require('../utils/logger');
const userDataService = require('../services/userdataservice');
const recentlyViewedDataService = require('../services/recentlyvieweddataservice');

async function resolveUser(req) {
    if (!req.user || !req.user.id) return null;
    return userDataService.findUserById(req.user.id);
}

exports.getHistory = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'recently-viewed' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const history = await recentlyViewedDataService.getHistoryForUser(user, {
            limit: req.query?.limit
        });
        return res.json({ success: true, history });
    } catch (err) {
        logger.error('recently_viewed.get_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getCount = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'recently-viewed' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const result = await recentlyViewedDataService.getHistoryCountForUser(user);
        return res.json({ success: true, count: result.count });
    } catch (err) {
        logger.error('recently_viewed.count_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.addView = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'recently-viewed' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const result = await recentlyViewedDataService.addViewedProduct(user, req.body || {});
        if (result.error) {
            return res.status(result.status || 400).json({ success: false, message: result.error });
        }

        return res.json({ success: true, history: result.data });
    } catch (err) {
        logger.error('recently_viewed.add_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.removeView = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'recently-viewed' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const productId = req.params.productId || req.body?.productId;
        const result = await recentlyViewedDataService.removeViewedProduct(user, productId);
        if (result.error) {
            return res.status(result.status || 400).json({ success: false, message: result.error });
        }

        return res.json({ success: true, history: result.data });
    } catch (err) {
        logger.error('recently_viewed.remove_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.clearHistory = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'recently-viewed' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const result = await recentlyViewedDataService.clearHistory(user);
        return res.json({ success: true, history: result.data });
    } catch (err) {
        logger.error('recently_viewed.clear_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.mergeHistory = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'recently-viewed' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const result = await recentlyViewedDataService.mergeHistory(user, req.body || {});
        return res.json({ success: true, history: result.data });
    } catch (err) {
        logger.error('recently_viewed.merge_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Unable to sync recently viewed.' });
    }
};
