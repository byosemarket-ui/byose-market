const express = require('express');

const orderController = require('../controllers/ordercontroller');
const adminAuthMiddleware = require('../middleware/adminauthmiddleware');

const router = express.Router();

router.use(adminAuthMiddleware);

router.get('/', orderController.getAdminOrders);
router.get('/:id', orderController.getAdminOrderById);
router.put('/:id/status', orderController.updateAdminOrderStatus);
router.delete('/:id', orderController.deleteAdminOrder);

module.exports = router;