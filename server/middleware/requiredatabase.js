const mongoose = require('mongoose');
const { appLogger } = require('../utils/logger');

function isDatabaseReady() {
    return mongoose.connection.readyState === 1;
}

function requireDatabase(req, res, next) {
    if (isDatabaseReady()) {
        return next();
    }

    const logger = req.log || appLogger;
    logger.warn('database.unavailable_for_request', {
        dbReadyState: mongoose.connection.readyState
    });

    res.setHeader('Retry-After', '30');
    return res.status(503).json({
        success: false,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Service temporarily unavailable. Database connection is not ready.',
        retryAfterSeconds: 30,
        readyState: mongoose.connection.readyState
    });
}

module.exports = requireDatabase;