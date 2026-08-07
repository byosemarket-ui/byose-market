const express = require('express');
const requireDatabase = require('../middleware/requiredatabase');
const adminSettingsController = require('../controllers/adminsettingscontroller');
const { createRateLimiter } = require('../middleware/ratelimiter');

const router = express.Router();

const publicSettingsLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 120,
    code: 'PUBLIC_SETTINGS_RATE_LIMITED',
    message: 'Too many settings requests. Please retry shortly.'
});

router.get('/public', publicSettingsLimiter, requireDatabase, adminSettingsController.getPublicSettings);

module.exports = router;
