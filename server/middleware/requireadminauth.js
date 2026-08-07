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

function getClientIp(req) {
    const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwardedFor || req.ip || req.socket?.remoteAddress || '';
}

async function requireAdminAuth(req, res, next) {
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

    const headerSessionId = String(req.headers['x-admin-session-id'] || '').trim();
    const sessionId = String(payload.sid || headerSessionId || '').trim();

    if (sessionId) {
        try {
            const adminSecurityService = require('../services/adminsecurityservice');
            const sessionCheck = await adminSecurityService.assertSessionAllowed(sessionId, {
                touch: true,
                ip: getClientIp(req)
            });

            if (!sessionCheck.allowed) {
                logger.warn('auth.admin.session_revoked', {
                    adminId: payload.id || '',
                    sessionId
                });
                return res.status(401).json({
                    success: false,
                    code: 'ADMIN_SESSION_REVOKED',
                    message: 'This administrator session is no longer active. Please sign in again.'
                });
            }

            req.adminSession = sessionCheck.session;
        } catch (error) {
            logger.warn('auth.admin.session_check_failed', {
                adminId: payload.id || '',
                sessionId,
                error
            });
            // Fail open only for transient DB issues on legacy traffic paths.
        }
    }

    req.admin = {
        ...payload,
        sid: sessionId || payload.sid || undefined
    };
    req.adminToken = token;
    req.adminTokenFingerprint = String(token).slice(-12);
    req.adminSessionId = sessionId || '';
    logger.debug('auth.admin.authorized', {
        adminId: payload.id,
        adminEmail: payload.email,
        role: payload.role,
        sessionId: sessionId || '',
        secretSource: result.secretSource || 'unknown'
    });
    return next();
}

module.exports = requireAdminAuth;
