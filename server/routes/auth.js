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
    forgotPassword,
    verifyCode,
    resetPassword
} = require('../controllers/authcontroller');

const authMiddleware = require('../middleware/authmiddleware');
const requireDatabase = require('../middleware/requiredatabase');

// ===============================
// ROUTES
// ===============================

// Public auth endpoints
router.post('/signup', requireDatabase, signup);
router.post('/login', requireDatabase, login);

// Send OTP (SMS / Email)
router.post('/forgot-password', requireDatabase, forgotPassword);

// Verify OTP
router.post('/verify-code', verifyCode);

// Reset Password
router.post('/reset-password', requireDatabase, resetPassword);

// Protected: current user
router.get('/me', authMiddleware, requireDatabase, me);
router.put('/me', authMiddleware, requireDatabase, updateMe);

// ===============================
// EXPORT
// ===============================
module.exports = router;