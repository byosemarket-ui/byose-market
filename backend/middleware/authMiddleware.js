const jwt = require('jsonwebtoken');

const { createApiResponse, getJwtSecret, normalizeEmail } = require('../utils/helpers');

function authMiddleware(req, res, next) {
    try {
        const authorizationHeader = String(req.headers.authorization || '').trim();

        if (!authorizationHeader.startsWith('Bearer ')) {
            return res.status(401).json(
                createApiResponse({ success: false, message: 'Unauthorized' })
            );
        }

        const token = authorizationHeader.slice(7).trim();
        const decoded = jwt.verify(token, getJwtSecret());

        if (!decoded || decoded.role !== 'admin' || !decoded.email) {
            return res.status(401).json(
                createApiResponse({ success: false, message: 'Unauthorized' })
            );
        }

        req.admin = { email: normalizeEmail(decoded.email) };
        return next();
    } catch (error) {
        return res.status(401).json(
            createApiResponse({ success: false, message: 'Unauthorized' })
        );
    }
}

module.exports = authMiddleware;