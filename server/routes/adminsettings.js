const express = require('express');

const adminAccessDisabled = require('../middleware/adminaccessdisabled');
const adminSettingsController = require('../controllers/adminsettingscontroller');

const router = express.Router();

router.use(adminAccessDisabled);
router.get('/', adminSettingsController.getSettings);
router.put('/', adminSettingsController.settingsMutationLimiter, adminSettingsController.updateSettings);

module.exports = router;
