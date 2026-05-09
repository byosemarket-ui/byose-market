const { verifyToken } = require('../utils/token');

function extractBearerToken(req) {
    const authHeader = String(req.headers.authorization || req.headers.Authorization || '').trim();
    if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
        return '';
    }

    return authHeader.replace(/^Bearer\s+/i, '').trim();
}

function optionalAuthMiddleware(req, res, next) {
    const token = extractBearerToken(req);
    if (!token) {
        next();
        return;
    }

    const result = verifyToken(token);
    if (!result.valid) {
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    const payload = result.payload || {};
    if (!payload.id || payload.role === 'admin') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    req.user = payload;
    next();
}

module.exports = optionalAuthMiddleware;