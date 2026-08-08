const express = require('express');
const router = express.Router();
const controller = require('../controllers/customernotificationscontroller');
const authMiddleware = require('../middleware/authmiddleware');
const { createRateLimiter } = require('../middleware/ratelimiter');

const limiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 90,
    code: 'CUSTOMER_NOTIFICATIONS_RATE_LIMITED',
    message: 'Too many notification requests. Please try again shortly.'
});

router.use(authMiddleware);
router.use(limiter);

router.get('/', controller.list);
router.get('/prefs', controller.getPrefs);
router.put('/prefs', controller.updatePrefs);
router.patch('/prefs', controller.updatePrefs);
router.post('/read-all', controller.markAllRead);
router.post('/:id/read', controller.markRead);

module.exports = router;
