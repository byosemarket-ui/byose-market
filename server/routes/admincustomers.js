const express = require('express');

const adminAccessDisabled = require('../middleware/adminaccessdisabled');
const adminCustomersController = require('../controllers/admincustomerscontroller');

const router = express.Router();

router.use(adminAccessDisabled);

router.get('/', adminCustomersController.listCustomers);
router.get('/:id', adminCustomersController.getCustomerById);
router.put('/:id', adminCustomersController.updateCustomer);
router.delete('/:id', adminCustomersController.deleteCustomer);

module.exports = router;