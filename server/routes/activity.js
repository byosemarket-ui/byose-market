const express = require('express');

const activityController = require('../controllers/activitycontroller');
const optionalAuthMiddleware = require('../middleware/optionalauthmiddleware');

const router = express.Router();

router.post('/', optionalAuthMiddleware, activityController.recordActivity);
router.patch('/:id', optionalAuthMiddleware, activityController.updateActivity);

module.exports = router;