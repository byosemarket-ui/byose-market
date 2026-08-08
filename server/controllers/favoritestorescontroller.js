const { appLogger } = require('../utils/logger');
const userDataService = require('../services/userdataservice');
const favoriteStoresDataService = require('../services/favoritestoresdataservice');

async function resolveUser(req) {
    if (!req.user || !req.user.id) return null;
    return userDataService.findUserById(req.user.id);
}

exports.getFavorites = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'favorite-stores' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const favorites = await favoriteStoresDataService.getFavoriteStores(user);
        return res.json({ success: true, favorites });
    } catch (err) {
        logger.error('favorite_stores.get_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Unable to load favorite stores.' });
    }
};

exports.getCount = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'favorite-stores' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const { getRepositoryBundle } = require('../repositories');
        const { stores } = getRepositoryBundle();
        const count = await stores.countFavoritesByUserId(user.recordId);
        return res.json({ success: true, count: Number(count || 0) });
    } catch (err) {
        logger.error('favorite_stores.count_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Unable to load favorite stores count.' });
    }
};

exports.listStores = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'favorite-stores' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const stores = await favoriteStoresDataService.listDiscoverableStores(user);
        return res.json({ success: true, stores });
    } catch (err) {
        logger.error('favorite_stores.list_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Unable to load stores.' });
    }
};

exports.follow = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'favorite-stores' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const result = await favoriteStoresDataService.followStore(user, req.body || {});
        if (result.error) {
            return res.status(result.status || 400).json({ success: false, message: result.error });
        }

        return res.json({ success: true, favorites: result.data, message: 'Store followed.' });
    } catch (err) {
        logger.error('favorite_stores.follow_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Unable to follow this store.' });
    }
};

exports.unfollow = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'favorite-stores' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const storeId = req.params.storeId || req.body?.storeId;
        const result = await favoriteStoresDataService.unfollowStore(user, storeId);
        if (result.error) {
            return res.status(result.status || 400).json({ success: false, message: result.error });
        }

        return res.json({ success: true, favorites: result.data, message: 'Store unfollowed.' });
    } catch (err) {
        logger.error('favorite_stores.unfollow_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Unable to unfollow this store.' });
    }
};

exports.updateNotificationPrefs = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'favorite-stores' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const result = await favoriteStoresDataService.updateNotificationPrefs(
            user,
            req.params.storeId,
            req.body || {}
        );
        if (result.error) {
            return res.status(result.status || 400).json({ success: false, message: result.error });
        }

        return res.json({ success: true, ...result.data });
    } catch (err) {
        logger.error('favorite_stores.prefs_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Unable to update notification preferences.' });
    }
};
