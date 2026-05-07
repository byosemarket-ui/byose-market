const express = require('express');

const authMiddleware = require('../middleware/authmiddleware');
const storefrontStateController = require('../controllers/storefrontstatecontroller');

const router = express.Router();

router.use(authMiddleware);
router.get('/', storefrontStateController.getStorefrontState);
router.put('/', storefrontStateController.updateStorefrontState);

module.exports = router;