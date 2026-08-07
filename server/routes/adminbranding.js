const express = require('express');

const adminAccessDisabled = require('../middleware/adminaccessdisabled');
const adminBrandingController = require('../controllers/adminbrandingcontroller');

const router = express.Router();

router.use(adminAccessDisabled);
router.get('/', adminBrandingController.getBranding);
router.put('/', adminBrandingController.brandingMutationLimiter, adminBrandingController.updateBranding);
router.post('/assets/:assetKey', adminBrandingController.brandingMutationLimiter, adminBrandingController.setAsset);
router.delete('/assets/:assetKey', adminBrandingController.brandingMutationLimiter, adminBrandingController.removeAsset);

module.exports = router;
