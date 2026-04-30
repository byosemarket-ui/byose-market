const { verifyToken } = require('../utils/token');
const { ADMIN_ACCOUNT, normalizeEmail, isConfiguredAdminRecord } = require('../config/admin-account');
const User = require('../models/user');

async function adminAuthMiddleware(req, res, next) {
    try {
        const auth = req.headers.authorization || req.headers.Authorization || '';
        if (!auth || !auth.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'Missing token' });
        }

        const token = auth.slice(7).trim();

        const result = verifyToken(token);
        if (
            !result.valid
            || !result.payload
            || result.payload.role !== 'admin'
            || String(result.payload.id || '').trim() !== ADMIN_ACCOUNT.id
            || normalizeEmail(result.payload.email) !== normalizeEmail(ADMIN_ACCOUNT.email)
        ) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const admin = await User.findOne({
            id: ADMIN_ACCOUNT.id,
            email: normalizeEmail(ADMIN_ACCOUNT.email),
            role: 'admin'
        });
        if (!isConfiguredAdminRecord(admin)) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        req.user = result.payload;
        req.admin = admin;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
}

module.exports = adminAuthMiddleware;