const express = require('express');
const requireDatabase = require('../middleware/requiredatabase');
const adminDeliveryController = require('../controllers/admindeliverycontroller');
const { createRateLimiter } = require('../middleware/ratelimiter');

const router = express.Router();

const shippingLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 120,
    code: 'SHIPPING_RATE_LIMITED',
    message: 'Too many shipping requests. Please retry shortly.'
});

router.get('/methods', shippingLimiter, requireDatabase, adminDeliveryController.getPublicMethods);
router.post('/calculate', shippingLimiter, requireDatabase, adminDeliveryController.calculateShipping);

module.exports = router;
