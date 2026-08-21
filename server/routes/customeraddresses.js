const express = require('express');
const router = express.Router();
const customerAddressController = require('../controllers/customeraddresscontroller');
const authMiddleware = require('../middleware/authmiddleware');
const requireDatabase = require('../middleware/requiredatabase');
const { createRateLimiter } = require('../middleware/ratelimiter');

const addressLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 60,
    code: 'ADDRESS_RATE_LIMITED',
    message: 'Too many address requests. Please try again shortly.'
});

router.use(authMiddleware);
router.use(requireDatabase);
router.use(addressLimiter);
router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    next();
});

router.get('/', customerAddressController.list);
router.post('/', customerAddressController.create);
router.put('/:id', customerAddressController.update);
router.delete('/:id', customerAddressController.remove);
router.post('/:id/default', customerAddressController.setDefault);

module.exports = router;
