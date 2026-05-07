const express = require('express');

const contactMessageController = require('../controllers/contactmessagecontroller');
const optionalAuthMiddleware = require('../middleware/optionalauthmiddleware');

const router = express.Router();

router.post('/', optionalAuthMiddleware, contactMessageController.createMessage);

module.exports = router;