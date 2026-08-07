const express = require('express');

const adminAccessDisabled = require('../middleware/adminaccessdisabled');
const adminSeoController = require('../controllers/adminseocontroller');

const router = express.Router();

router.use(adminAccessDisabled);
router.get('/', adminSeoController.getSeo);
router.put('/', adminSeoController.seoMutationLimiter, adminSeoController.updateSeo);
router.post('/validate', adminSeoController.seoMutationLimiter, adminSeoController.validateSeo);
router.post('/images/:field', adminSeoController.seoMutationLimiter, adminSeoController.setImage);
router.delete('/images/:field', adminSeoController.seoMutationLimiter, adminSeoController.removeImage);

module.exports = router;
