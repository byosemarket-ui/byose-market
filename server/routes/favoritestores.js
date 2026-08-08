const express = require('express');
const router = express.Router();
const favoriteStoresController = require('../controllers/favoritestorescontroller');
const authMiddleware = require('../middleware/authmiddleware');
const { createRateLimiter } = require('../middleware/ratelimiter');

const favoriteStoresLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 90,
    code: 'FAVORITE_STORES_RATE_LIMITED',
    message: 'Too many favorite store requests. Please try again shortly.'
});

router.use(authMiddleware);
router.use(favoriteStoresLimiter);

router.get('/', favoriteStoresController.getFavorites);
router.get('/count', favoriteStoresController.getCount);
router.get('/discover', favoriteStoresController.listStores);
router.post('/follow', favoriteStoresController.follow);
router.post('/', favoriteStoresController.follow);
router.patch('/:storeId/notifications', favoriteStoresController.updateNotificationPrefs);
router.delete('/:storeId', favoriteStoresController.unfollow);

module.exports = router;
