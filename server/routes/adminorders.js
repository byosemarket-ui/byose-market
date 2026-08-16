const express = require('express');

const orderController = require('../controllers/ordercontroller');
const invoiceController = require('../controllers/invoicecontroller');
const adminAccessDisabled = require('../middleware/adminaccessdisabled');

const router = express.Router();

router.use(adminAccessDisabled);

router.get('/', orderController.getAdminOrders);
router.get('/:id/verification', invoiceController.getAdminInvoiceVerification);
router.get('/:id', orderController.getAdminOrderById);
router.put('/:id/status', orderController.updateAdminOrderStatus);
router.delete('/:id', orderController.deleteAdminOrder);

module.exports = router;