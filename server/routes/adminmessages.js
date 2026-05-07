const express = require('express');

const adminAccessDisabled = require('../middleware/adminaccessdisabled');
const contactMessageController = require('../controllers/contactmessagecontroller');

const router = express.Router();

router.use(adminAccessDisabled);
router.get('/', contactMessageController.listAdminMessages);
router.get('/:id', contactMessageController.getAdminMessageById);
router.put('/:id', contactMessageController.updateAdminMessage);
router.delete('/:id', contactMessageController.deleteAdminMessage);

module.exports = router;