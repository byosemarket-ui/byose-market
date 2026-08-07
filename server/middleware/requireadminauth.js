const { verifyToken } = require('../utils/token');
const { appLogger } = require('../utils/logger');
const config = require('../config/env');

function extractBearerToken(req) {
    const authHeader = String(req.headers.authorization || req.headers.Authorization || '').trim();
    if (authHeader && /^Bearer\s+/i.test(authHeader)) {
        return authHeader.replace(/^Bearer\s+/i, '').trim();
    }

    // EventSource cannot set Authorization headers; allow short-lived query token
    // for the realtime SSE endpoint only.
    const queryToken = String(
        req.query?.access_token
        || req.query?.token
        || ''
    ).trim();
    return queryToken;
}

function requireAdminAuth(req, res, next) {
    res.setHeader('Cache-Control', 'no-store');

    const token = extractBearerToken(req);
    const logger = req.log || appLogger;
    logger.debug('auth.admin.validation_started', {
        path: req.originalUrl || req.url,
        hasAuthorizationHeader: Boolean(req.headers.authorization || req.headers.Authorization),
        hasBearerToken: Boolean(token)
    });

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
            expired: Boolean(result.expired),
            secretSource: result.secretSource || 'unknown'
        });
        return res.status(401).json({
            success: false,
            code: result.expired ? 'ADMIN_TOKEN_EXPIRED' : 'ADMIN_TOKEN_INVALID',
            message: result.expired ? 'Admin token expired' : 'Invalid admin token'
        });
    }

    const payload = result.payload || {};
    const configuredAdminEmail = String(
        process.env.ADMIN_EMAIL || (config.auth && config.auth.adminEmail) || config.adminEmail || ''
    ).trim().toLowerCase();
    const tokenEmail = String(payload.email || '').trim().toLowerCase();
    if (
        payload.role !== 'admin'
        || !payload.id
        || !tokenEmail
        || (configuredAdminEmail && tokenEmail !== configuredAdminEmail)
    ) {
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
    req.adminTokenFingerprint = String(token).slice(-12);
    logger.debug('auth.admin.authorized', {
        adminId: payload.id,
        adminEmail: payload.email,
        role: payload.role,
        secretSource: result.secretSource || 'unknown'
    });
    return next();
}

module.exports = requireAdminAuth;