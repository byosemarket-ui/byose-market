const express = require('express');
const router = express.Router();
const orderController = require('../controllers/ordercontroller');
const authMiddleware = require('../middleware/authmiddleware');
const optionalAuthMiddleware = require('../middleware/optionalauthmiddleware');
const { createRateLimiter } = require('../middleware/ratelimiter');

function validateOrderPayload(req, res, next) {
	const payload = req.body;
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return res.status(400).json({ success: false, message: 'Invalid order payload' });
	}

	if (Buffer.byteLength(JSON.stringify(payload)) > 50000) {
		return res.status(413).json({ success: false, message: 'Order payload too large' });
	}

	return next();
}

const createOrderLimiter = createRateLimiter({
	windowMs: 5 * 60 * 1000,
	max: 25,
	code: 'ORDER_CREATE_RATE_LIMITED',
	message: 'Too many order attempts. Please try again shortly.'
});

const updateOrderLimiter = createRateLimiter({
	windowMs: 5 * 60 * 1000,
	max: 40,
	code: 'ORDER_UPDATE_RATE_LIMITED',
	message: 'Too many status updates. Please try again shortly.'
});

router.post('/', createOrderLimiter, optionalAuthMiddleware, validateOrderPayload, orderController.createOrder);
router.get('/', authMiddleware, orderController.getUserOrders);
router.put('/:id/status', updateOrderLimiter, authMiddleware, orderController.updateOrderStatus);

module.exports = router;
