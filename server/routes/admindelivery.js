const express = require('express');

const adminAccessDisabled = require('../middleware/adminaccessdisabled');
const adminDeliveryController = require('../controllers/admindeliverycontroller');

const router = express.Router();

router.use(adminAccessDisabled);
router.get('/', adminDeliveryController.getDelivery);
router.put('/', adminDeliveryController.deliveryMutationLimiter, adminDeliveryController.updateDelivery);
router.post('/zones', adminDeliveryController.deliveryMutationLimiter, adminDeliveryController.createZone);
router.put('/zones/:zoneId', adminDeliveryController.deliveryMutationLimiter, adminDeliveryController.updateZone);
router.delete('/zones/:zoneId', adminDeliveryController.deliveryMutationLimiter, adminDeliveryController.deleteZone);

module.exports = router;
