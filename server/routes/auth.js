// ===============================
// AUTH ROUTES
// ===============================

const express = require('express');
const router = express.Router();

const {
    signup,
    login,
    me,
    updateMe,
    changePassword,
    forgotPassword,
    verifyCode,
    resetPassword
} = require('../controllers/authcontroller');

const authMiddleware = require('../middleware/authmiddleware');
const requireDatabase = require('../middleware/requiredatabase');
const { createRateLimiter } = require('../middleware/ratelimiter');

function validatePayload(requiredFields = []) {
    return function payloadValidator(req, res, next) {
        const payload = req.body;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return res.status(400).json({ success: false, message: 'Invalid request payload' });
        }

        if (Buffer.byteLength(JSON.stringify(payload)) > 20000) {
            return res.status(413).json({ success: false, message: 'Payload too large' });
        }

        const missing = requiredFields.filter((field) => !String(payload[field] || '').trim());
        if (missing.length) {
            return res.status(400).json({
                success: false,
                message: `Missing required fields: ${missing.join(', ')}`
            });
        }

        return next();
    };
}

const authSensitiveLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    code: 'AUTH_ATTEMPTS_LIMITED',
    message: 'Too many auth attempts. Please try again later.'
});

// ===============================
// ROUTES
// ===============================

// Public auth endpoints
router.post('/signup', authSensitiveLimiter, requireDatabase, validatePayload(['name', 'password']), signup);
router.post('/login', authSensitiveLimiter, requireDatabase, validatePayload(['identifier', 'password']), login);

// Send OTP (SMS / Email)
router.post('/forgot-password', authSensitiveLimiter, requireDatabase, validatePayload(['identifier']), forgotPassword);

// Verify OTP
router.post('/verify-code', authSensitiveLimiter, validatePayload(['identifier', 'otp']), verifyCode);

// Reset Password
router.post('/reset-password', authSensitiveLimiter, requireDatabase, validatePayload(['identifier', 'newPassword', 'resetToken']), resetPassword);

// Protected: current user
router.get('/me', authMiddleware, requireDatabase, me);
router.put('/me', authMiddleware, requireDatabase, updateMe);
router.post('/change-password', authSensitiveLimiter, authMiddleware, requireDatabase, validatePayload(['currentPassword', 'newPassword']), changePassword);

// ===============================
// EXPORT
// ===============================
module.exports = router;