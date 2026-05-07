const jwt = require('jsonwebtoken');
const { appLogger } = require('./logger');

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

function getSecretSource() {
    if (process.env.JWT_SECRET) {
        return 'env:JWT_SECRET';
    }

    return process.env.NODE_ENV !== 'production'
        ? 'fallback:development_only_jwt_secret'
        : 'missing';
}

function getJwtConfig() {
    return {
        secret: getSecret(),
        expiresIn: EXPIRES_IN,
        secretSource: getSecretSource()
    };
}

function generateToken(payload) {
    const jwtConfig = getJwtConfig();
    const token = jwt.sign(payload, jwtConfig.secret, { expiresIn: jwtConfig.expiresIn });

    appLogger.info('auth.jwt.token_created', {
        subjectId: String(payload?.id || ''),
        email: String(payload?.email || ''),
        role: String(payload?.role || ''),
        expiresIn: jwtConfig.expiresIn,
        secretSource: jwtConfig.secretSource
    });

    return token;
}

function verifyToken(token) {
    try {
        const jwtConfig = getJwtConfig();
        const payload = jwt.verify(token, jwtConfig.secret);

        appLogger.debug('auth.jwt.token_validated', {
            subjectId: String(payload?.id || ''),
            email: String(payload?.email || ''),
            role: String(payload?.role || ''),
            expiresAt: Number.isFinite(payload?.exp) ? new Date(payload.exp * 1000).toISOString() : '',
            secretSource: jwtConfig.secretSource
        });

        return {
            valid: true,
            payload,
            secretSource: jwtConfig.secretSource
        };
    } catch (e) {
        appLogger.warn('auth.jwt.token_validation_failed', {
            expired: Boolean(e && e.name === 'TokenExpiredError'),
            reason: String(e && e.message ? e.message : 'Token verification failed'),
            secretSource: getSecretSource()
        });

        return {
            valid: false,
            expired: e && e.name === 'TokenExpiredError',
            error: e,
            secretSource: getSecretSource()
        };
    }
}

module.exports = { generateToken, verifyToken, getJwtConfig, getSecret };
