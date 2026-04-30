const express = require('express');

const adminAuthMiddleware = require('../middleware/adminauthmiddleware');
const adminCustomersController = require('../controllers/admincustomerscontroller');

const router = express.Router();

router.use(adminAuthMiddleware);

router.get('/', adminCustomersController.listCustomers);
router.get('/:id', adminCustomersController.getCustomerById);
router.put('/:id', adminCustomersController.updateCustomer);
router.delete('/:id', adminCustomersController.deleteCustomer);

module.exports = router;