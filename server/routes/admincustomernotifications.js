const express = require('express');

const adminAccessDisabled = require('../middleware/adminaccessdisabled');
const adminCustomerNotificationsController = require('../controllers/admincustomernotificationscontroller');

const router = express.Router();

router.use(adminAccessDisabled);

router.post('/', adminCustomerNotificationsController.mutationLimiter, adminCustomerNotificationsController.sendToCustomer);

module.exports = router;
