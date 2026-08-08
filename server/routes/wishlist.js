const express = require('express');
const router = express.Router();
const wishlistController = require('../controllers/wishlistcontroller');
const authMiddleware = require('../middleware/authmiddleware');
const { createRateLimiter } = require('../middleware/ratelimiter');

const wishlistLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 90,
    code: 'WISHLIST_RATE_LIMITED',
    message: 'Too many wishlist requests. Please try again shortly.'
});

router.use(authMiddleware);
router.use(wishlistLimiter);

router.get('/', wishlistController.getWishlist);
router.get('/ids', wishlistController.getWishlistIds);
router.get('/count', wishlistController.getCount);
router.post('/', wishlistController.addItem);
router.post('/add', wishlistController.addItem);
router.post('/merge', wishlistController.mergeWishlist);
router.delete('/clear', wishlistController.clearWishlist);
router.delete('/:productId', wishlistController.removeItem);

module.exports = router;
