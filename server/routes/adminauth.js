const express = require('express');

const { login, session } = require('../controllers/adminauthcontroller');
const adminAuthMiddleware = require('../middleware/adminauthmiddleware');

const router = express.Router();

router.post('/login', login);
router.get('/session', adminAuthMiddleware, session);

module.exports = router;