const { verifyToken } = require('../utils/token');
const User = require('../models/user');

const LEGACY_FRONTEND_TOKEN = 'frontend-admin-authenticated';
const LEGACY_ADMIN_EMAIL = 'byosemarket@gmail.com';

async function adminAuthMiddleware(req, res, next) {
    try {
        const auth = req.headers.authorization || req.headers.Authorization || '';
        if (!auth || !auth.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'Missing token' });
        }

        const token = auth.slice(7).trim();

        if (token === LEGACY_FRONTEND_TOKEN) {
            const admin = await User.findOne({ email: LEGACY_ADMIN_EMAIL, role: 'admin' });
            if (!admin) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }

            req.user = { id: admin.id, email: admin.email, role: admin.role, legacy: true };
            req.admin = admin;
            next();
            return;
        }

        const result = verifyToken(token);
        if (!result.valid || !result.payload || result.payload.role !== 'admin') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const admin = await User.findOne({ id: result.payload.id, email: result.payload.email, role: 'admin' });
        if (!admin) {
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