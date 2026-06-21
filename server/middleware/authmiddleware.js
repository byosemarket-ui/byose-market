const { verifyToken } = require('../utils/token');
const userDataService = require('../services/userdataservice');

function extractBearerToken(req) {
    const authHeader = String(req.headers.authorization || req.headers.Authorization || '').trim();
    if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
        return '';
    }

    return authHeader.replace(/^Bearer\s+/i, '').trim();
}

async function authMiddleware(req, res, next) {
    try {
        const token = extractBearerToken(req);
        if (!token) return res.status(401).json({ success: false, message: 'Missing token' });

        const result = verifyToken(token);
        if (!result.valid) return res.status(401).json({ success: false, message: 'Invalid token' });

        const payload = result.payload || {};
        if (!payload.id || payload.role !== 'user') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const user = await userDataService.findUserById(payload.id);
        if (!user || user.role !== 'user') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
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

module.exports = authMiddleware;
