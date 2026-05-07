const express = require('express');

const activityController = require('../controllers/activitycontroller');
const adminAccessDisabled = require('../middleware/adminaccessdisabled');

const router = express.Router();

router.use(adminAccessDisabled);
router.get('/', activityController.listAdminActivity);

module.exports = router;