const { appLogger } = require('../utils/logger');
const userDataService = require('../services/userdataservice');
const favoriteStoresDataService = require('../services/favoritestoresdataservice');

async function resolveOptionalUser(req) {
    if (!req.user || !req.user.id) return null;
    return userDataService.findUserById(req.user.id);
}

exports.listStores = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'stores' });
    try {
        const user = await resolveOptionalUser(req);
        const stores = await favoriteStoresDataService.listDiscoverableStores(user);
        return res.json({ success: true, stores });
    } catch (err) {
        logger.error('stores.list_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Unable to load stores.' });
    }
};

exports.getStore = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'stores' });
    try {
        const user = await resolveOptionalUser(req);
        const result = await favoriteStoresDataService.getStoreByIdentifier(req.params.slugOrId, user);
        if (result.error) {
            return res.status(result.status || 404).json({ success: false, message: result.error });
        }

        return res.json({
            success: true,
            store: result.data.store,
            products: result.data.products
        });
    } catch (err) {
        logger.error('stores.get_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Unable to load this store.' });
    }
};
