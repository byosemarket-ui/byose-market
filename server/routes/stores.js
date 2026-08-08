const express = require('express');
const router = express.Router();
const storesController = require('../controllers/storescontroller');
const optionalAuthMiddleware = require('../middleware/optionalauthmiddleware');
const { createRateLimiter } = require('../middleware/ratelimiter');

const storesLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 120,
    code: 'STORES_RATE_LIMITED',
    message: 'Too many store requests. Please try again shortly.'
});

router.use(storesLimiter);
router.use(optionalAuthMiddleware);

router.get('/', storesController.listStores);
router.get('/:slugOrId', storesController.getStore);

module.exports = router;
