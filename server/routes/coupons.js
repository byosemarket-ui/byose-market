const express = require('express');
const router = express.Router();
const couponController = require('../controllers/couponcontroller');
const authMiddleware = require('../middleware/authmiddleware');
const { createRateLimiter } = require('../middleware/ratelimiter');

const couponLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 60,
    code: 'COUPON_RATE_LIMITED',
    message: 'Too many coupon requests. Please try again shortly.'
});

router.use(authMiddleware);
router.use(couponLimiter);

router.get('/', couponController.getCoupons);
router.get('/count', couponController.getCounts);
router.get('/available', couponController.getAvailable);
router.get('/used', couponController.getUsed);
router.get('/expired', couponController.getExpired);
router.post('/apply', couponController.applyCoupon);
router.post('/validate', couponController.validateCoupon);

module.exports = router;
