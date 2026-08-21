const { verifyToken } = require('../utils/token');
const userDataService = require('../services/userdataservice');
const customerSessionService = require('../services/customersession.service');

function extractBearerToken(req) {
    const authHeader = String(req.headers.authorization || req.headers.Authorization || '').trim();
    if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
        return '';
    }

    return authHeader.replace(/^Bearer\s+/i, '').trim();
}

function setPrivateNoStore(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
}

function unauthorized(res, message, code) {
    setPrivateNoStore(res);
    return res.status(401).json({ success: false, message, code });
}

async function hydrateCustomer(req, res, payload) {
    if (!payload.id || payload.role !== 'user') {
        return res.status(403).json({ success: false, message: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    if (payload.sid) {
        const session = customerSessionService.findActiveBySessionId(payload.sid);
        if (!session || session.userPublicId !== String(payload.id)) {
            return unauthorized(res, 'Session expired', 'SESSION_REVOKED');
        }
        customerSessionService.touchSession(payload.sid);
    }

    const user = await userDataService.findUserById(payload.id);
    if (!user || user.role !== 'user') {
        return res.status(403).json({ success: false, message: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    if (String(user.status || 'active').toLowerCase() === 'blocked') {
        return res.status(403).json({ success: false, message: 'Account blocked', code: 'ACCOUNT_BLOCKED' });
    }

    req.user = {
        ...payload,
        status: user.status || 'active',
        sid: payload.sid || ''
    };
    return null;
}

async function authMiddleware(req, res, next) {
    try {
        setPrivateNoStore(res);
        const token = extractBearerToken(req);
        if (!token) return unauthorized(res, 'Missing token', 'MISSING_TOKEN');

        const result = verifyToken(token);
        if (!result.valid) {
            if (result.expired) {
                return unauthorized(res, 'Token expired', 'TOKEN_EXPIRED');
            }
            return unauthorized(res, 'Invalid token', 'INVALID_TOKEN');
        }

        const blocked = await hydrateCustomer(req, res, result.payload || {});
        if (blocked) {
            return blocked;
        }
        return next();
    } catch (error) {
        return next(error);
    }
}

authMiddleware.extractBearerToken = extractBearerToken;

module.exports = authMiddleware;
