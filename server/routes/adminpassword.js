const express = require('express');

const adminAccessDisabled = require('../middleware/adminaccessdisabled');
const { createRateLimiter } = require('../middleware/ratelimiter');
const adminPasswordController = require('../controllers/adminpasswordcontroller');

const router = express.Router();

const passwordMutationLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    code: 'ADMIN_PASSWORD_RATE_LIMITED',
    message: 'Too many password attempts. Please try again later.'
});

const passwordValidateLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 60,
    code: 'ADMIN_PASSWORD_VALIDATE_RATE_LIMITED',
    message: 'Too many password validation requests. Please retry shortly.'
});

router.use(adminAccessDisabled);

router.get('/', adminPasswordController.getPasswordStatus);
router.post('/validate', passwordValidateLimiter, adminPasswordController.validatePasswordStrength);
router.post('/verify-current', passwordMutationLimiter, adminPasswordController.verifyCurrentPassword);
router.put('/', passwordMutationLimiter, adminPasswordController.changePassword);

module.exports = router;
