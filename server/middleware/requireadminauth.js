const { verifyToken } = require('../utils/token');
const { appLogger } = require('../utils/logger');

function extractBearerToken(req) {
    const authHeader = String(req.headers.authorization || req.headers.Authorization || '').trim();
    if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
        return '';
    }

    return authHeader.replace(/^Bearer\s+/i, '').trim();
}

function requireAdminAuth(req, res, next) {
    const token = extractBearerToken(req);
    const logger = req.log || appLogger;
    if (!token) {
        logger.warn('auth.admin.missing_token');
        return res.status(401).json({
            success: false,
            code: 'ADMIN_TOKEN_MISSING',
            message: 'Missing admin token'
        });
    }

    const result = verifyToken(token);
    if (!result.valid) {
        logger.warn('auth.admin.invalid_token', {
            expired: Boolean(result.expired)
        });
        return res.status(401).json({
            success: false,
            code: result.expired ? 'ADMIN_TOKEN_EXPIRED' : 'ADMIN_TOKEN_INVALID',
            message: result.expired ? 'Admin token expired' : 'Invalid admin token'
        });
    }

    const payload = result.payload || {};
    if (payload.role !== 'admin' || !payload.id || !payload.email) {
        logger.warn('auth.admin.role_denied', {
            adminId: payload.id || '',
            adminEmail: payload.email || ''
        });
        return res.status(403).json({
            success: false,
            code: 'ADMIN_ROLE_REQUIRED',
            message: 'Admin access required'
        });
    }

    req.admin = payload;
    req.adminToken = token;
    logger.debug('auth.admin.authorized', {
        adminId: payload.id,
        adminEmail: payload.email
    });
    return next();
}

module.exports = requireAdminAuth;