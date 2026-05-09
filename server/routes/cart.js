const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cartcontroller');
const authMiddleware = require('../middleware/authmiddleware');
const { createRateLimiter } = require('../middleware/ratelimiter');

const cartLimiter = createRateLimiter({
	windowMs: 60 * 1000,
	max: 90,
	code: 'CART_RATE_LIMITED',
	message: 'Too many cart requests. Please try again shortly.'
});

// Protected cart routes
router.use(authMiddleware);
router.use(cartLimiter);

router.post('/add', cartController.addToCart);
router.get('/', cartController.getUserCart);
router.post('/remove', cartController.removeFromCart);
router.post('/clear', cartController.clearCart);

module.exports = router;
