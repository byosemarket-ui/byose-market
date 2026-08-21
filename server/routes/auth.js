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
    uploadMePhoto,
    removeMePhoto,
    changePassword,
    deleteAccount,
    refresh,
    logout,
    forgotPassword,
    verifyCode,
    resetPassword
} = require('../controllers/authcontroller');

const authMiddleware = require('../middleware/authmiddleware');
const requireDatabase = require('../middleware/requiredatabase');
const { createRateLimiter } = require('../middleware/ratelimiter');
const { createLocalUploadMiddleware } = require('../middleware/upload/localupload');

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

const authRefreshLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 40,
    code: 'AUTH_REFRESH_LIMITED',
    message: 'Too many session refresh attempts. Please try again later.'
});

const profilePhotoLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 20,
    code: 'PROFILE_PHOTO_RATE_LIMITED',
    message: 'Too many profile photo updates. Please retry shortly.'
});

function optionalUsersUpload(req, res, next) {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('multipart/form-data')) {
        return next();
    }
    req.params = { ...(req.params || {}), bucket: 'users' };
    return createLocalUploadMiddleware()(req, res, next);
}

router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
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
router.post('/me/photo', profilePhotoLimiter, authMiddleware, requireDatabase, optionalUsersUpload, uploadMePhoto);
router.delete('/me/photo', profilePhotoLimiter, authMiddleware, requireDatabase, removeMePhoto);
router.post('/change-password', authSensitiveLimiter, authMiddleware, requireDatabase, validatePayload(['currentPassword', 'newPassword']), changePassword);
router.delete('/me', authSensitiveLimiter, authMiddleware, requireDatabase, validatePayload(['password', 'confirmation']), deleteAccount);

// Persistent session lifecycle
router.post('/refresh', authRefreshLimiter, requireDatabase, validatePayload(['refreshToken']), refresh);
router.post('/logout', requireDatabase, logout);

// ===============================
// EXPORT
// ===============================
module.exports = router;