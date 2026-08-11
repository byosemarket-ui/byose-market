const express = require('express');

const adminAccessDisabled = require('../middleware/adminaccessdisabled');
const adminPaymentController = require('../controllers/adminpaymentcontroller');

const router = express.Router();

router.use(adminAccessDisabled);
router.get('/', adminPaymentController.getPayment);
router.get('/activity', adminPaymentController.getActivity);
router.put('/', adminPaymentController.paymentMutationLimiter, adminPaymentController.updatePayment);
router.post('/test', adminPaymentController.paymentTestLimiter, adminPaymentController.testPayment);

module.exports = router;
