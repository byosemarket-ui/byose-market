const { verifyToken } = require('../utils/token');
const userDataService = require('../services/userdataservice');

function extractBearerToken(req) {
    const authHeader = String(req.headers.authorization || req.headers.Authorization || '').trim();
    if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
        return '';
    }

    return authHeader.replace(/^Bearer\s+/i, '').trim();
}

async function optionalAuthMiddleware(req, res, next) {
    try {
        const token = extractBearerToken(req);
        if (!token) {
            return next();
        }

        const result = verifyToken(token);
        // Guest checkout remains available if a browser sends an expired or revoked token.
        if (!result.valid) {
            return next();
        }

        const payload = result.payload || {};
        if (!payload.id || payload.role !== 'user') {
            return next();
        }

        if (payload.sid) {
            const customerSessionService = require('../services/customersession.service');
            const session = customerSessionService.findActiveBySessionId(payload.sid);
            if (!session || session.userPublicId !== String(payload.id)) {
                return next();
            }
        }

        const user = await userDataService.findUserById(payload.id);
        if (!user) {
            return next();
        }
        if (String(user.status || 'active').toLowerCase() === 'blocked') {
            return res.status(403).json({ success: false, message: 'Account blocked' });
        }

        req.user = {
            ...payload,
            status: user.status || 'active'
        };
        return next();
    } catch (error) {
        return next(error);
    }
}

module.exports = optionalAuthMiddleware;