const express = require('express');
const router = express.Router();
const recentlyViewedController = require('../controllers/recentlyviewedcontroller');
const authMiddleware = require('../middleware/authmiddleware');
const { createRateLimiter } = require('../middleware/ratelimiter');

const recentlyViewedLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 120,
    code: 'RECENTLY_VIEWED_RATE_LIMITED',
    message: 'Too many recently viewed requests. Please try again shortly.'
});

router.use(authMiddleware);
router.use(recentlyViewedLimiter);

router.get('/', recentlyViewedController.getHistory);
router.get('/count', recentlyViewedController.getCount);
router.post('/', recentlyViewedController.addView);
router.post('/add', recentlyViewedController.addView);
router.post('/merge', recentlyViewedController.mergeHistory);
router.delete('/clear', recentlyViewedController.clearHistory);
router.delete('/:productId', recentlyViewedController.removeView);

module.exports = router;
