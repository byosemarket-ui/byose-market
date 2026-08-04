const { getDatabaseStatus, isDatabaseReady } = require('../database');
const { appLogger } = require('../utils/logger');

function requireDatabase(req, res, next) {
    if (isDatabaseReady()) {
        return next();
    }

    const logger = req.log || appLogger;
    const status = getDatabaseStatus();
    logger.warn('database.unavailable_for_request', {
        database: status
    });

    res.setHeader('Retry-After', '30');
    return res.status(503).json({
        success: false,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Service temporarily unavailable. Database connection is not ready.',
        retryAfterSeconds: 30
    });
}

module.exports = requireDatabase;