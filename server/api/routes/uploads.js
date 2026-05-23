const express = require('express');
const requireAdminAuth = require('../../middleware/requireadminauth');
const { createRateLimiter } = require('../../middleware/ratelimiter');
const { createLocalUploadMiddleware } = require('../../middleware/upload/localupload');
const uploadController = require('../../controllers/uploadcontroller');

const router = express.Router();

const uploadAdminLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 60,
    code: 'UPLOADS_RATE_LIMITED',
    message: 'Too many upload requests. Please retry shortly.'
});

router.get('/health', uploadController.getUploadHealth);
router.get('/config', uploadAdminLimiter, requireAdminAuth, uploadController.getUploadConfig);
router.post('/:bucket', uploadAdminLimiter, requireAdminAuth, createLocalUploadMiddleware(), uploadController.uploadFiles);
router.delete('/', uploadAdminLimiter, requireAdminAuth, uploadController.deleteUploads);

module.exports = router;