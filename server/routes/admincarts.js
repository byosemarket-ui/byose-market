const express = require('express');

const adminAccessDisabled = require('../middleware/adminaccessdisabled');
const adminCartsController = require('../controllers/admincartscontroller');

const router = express.Router();

router.use(adminAccessDisabled);
router.get('/', adminCartsController.listAdminCarts);

module.exports = router;
