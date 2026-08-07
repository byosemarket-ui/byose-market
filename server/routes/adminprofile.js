const express = require('express');

const adminAccessDisabled = require('../middleware/adminaccessdisabled');
const { createRateLimiter } = require('../middleware/ratelimiter');
const { createLocalUploadMiddleware } = require('../middleware/upload/localupload');
const adminProfileController = require('../controllers/adminprofilecontroller');

const router = express.Router();

const profileMutationLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 40,
    code: 'ADMIN_PROFILE_RATE_LIMITED',
    message: 'Too many profile updates. Please retry shortly.'
});

const profilePhotoLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 20,
    code: 'ADMIN_PROFILE_PHOTO_RATE_LIMITED',
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

router.use(adminAccessDisabled);

router.get('/', adminProfileController.getProfile);
router.put('/', profileMutationLimiter, adminProfileController.updateProfile);
router.post('/photo', profilePhotoLimiter, optionalUsersUpload, adminProfileController.uploadProfilePhoto);
router.delete('/photo', profilePhotoLimiter, adminProfileController.removeProfilePhoto);

module.exports = router;
