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

// ===============================
// ROUTES
// ===============================

// Public auth endpoints
router.post('/signup', signup);
router.post('/login', login);

// Send OTP (SMS / Email)
router.post('/forgot-password', forgotPassword);

// Verify OTP
router.post('/verify-code', verifyCode);

// Reset Password
router.post('/reset-password', resetPassword);

// Protected: current user
router.get('/me', authMiddleware, me);
router.put('/me', authMiddleware, updateMe);

// ===============================
// EXPORT
// ===============================
module.exports = router;