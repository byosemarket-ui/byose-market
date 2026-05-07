const express = require('express');

const adminAccessDisabled = require('../middleware/adminaccessdisabled');
const adminDashboardController = require('../controllers/admindashboardcontroller');

const router = express.Router();

router.use(adminAccessDisabled);
router.get('/', adminDashboardController.getDashboardSnapshot);

module.exports = router;