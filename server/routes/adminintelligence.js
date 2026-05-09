const express = require('express');

const adminAccessDisabled = require('../middleware/adminaccessdisabled');
const adminIntelligenceController = require('../controllers/adminintelligencecontroller');

const router = express.Router();

router.use(adminAccessDisabled);
router.get('/overview', adminIntelligenceController.getOverview);
router.get('/reports/export', adminIntelligenceController.exportReport);

module.exports = router;
