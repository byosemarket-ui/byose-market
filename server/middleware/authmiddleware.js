const { verifyToken } = require('../utils/token');

function authMiddleware(req, res, next) {
    const auth = req.headers.authorization || req.headers.Authorization || '';
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Missing token' });
    const token = auth.split(' ')[1];
    const result = verifyToken(token);
    if (!result.valid) return res.status(401).json({ success: false, message: 'Invalid token' });
    if (result.payload && result.payload.role === 'admin') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    req.user = result.payload;
    next();
}

module.exports = authMiddleware;
