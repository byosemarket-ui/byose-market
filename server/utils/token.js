const jwt = require('jsonwebtoken');

const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function getSecret() {
    if (process.env.JWT_SECRET) {
        return process.env.JWT_SECRET;
    }

    if (process.env.NODE_ENV !== 'production') {
        return 'development_only_jwt_secret';
    }

    throw new Error('JWT_SECRET is required in production');
}

function generateToken(payload) {
    return jwt.sign(payload, getSecret(), { expiresIn: EXPIRES_IN });
}

function verifyToken(token) {
    try {
        return { valid: true, payload: jwt.verify(token, getSecret()) };
    } catch (e) {
        return { valid: false, error: e };
    }
}

module.exports = { generateToken, verifyToken };
