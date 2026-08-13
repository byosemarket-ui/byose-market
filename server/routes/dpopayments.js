const express = require('express');
const requireDatabase = require('../middleware/requiredatabase');
const optionalAuthMiddleware = require('../middleware/optionalauthmiddleware');
const dpoPaymentController = require('../controllers/dpopaymentcontroller');

const router = express.Router();
const formParser = express.urlencoded({ extended: false });

router.use(requireDatabase);

router.get('/config', dpoPaymentController.getConfig);
router.post('/initiate', optionalAuthMiddleware, dpoPaymentController.mutationLimiter, dpoPaymentController.initiate);
router.post('/verify', optionalAuthMiddleware, dpoPaymentController.mutationLimiter, dpoPaymentController.verify);
router.get('/return', dpoPaymentController.returnFromGateway);
router.get('/back', dpoPaymentController.backFromGateway);
router.get('/callback', dpoPaymentController.callbackFromGateway);
router.post('/callback', formParser, dpoPaymentController.mutationLimiter, dpoPaymentController.callbackFromGateway);

module.exports = router;
