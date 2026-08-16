const express = require('express');
const requireDatabase = require('../middleware/requiredatabase');
const { createRateLimiter } = require('../middleware/ratelimiter');
const invoiceController = require('../controllers/invoicecontroller');

const router = express.Router();

const verifyLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 40,
    code: 'INVOICE_VERIFY_RATE_LIMITED',
    message: 'Too many invoice verification attempts. Please try again shortly.'
});

router.get('/verify', verifyLimiter, requireDatabase, invoiceController.verifyPublicInvoice);

module.exports = router;
