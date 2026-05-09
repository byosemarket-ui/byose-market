const jwt = require('jsonwebtoken');
const { appLogger } = require('./logger');

const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const JWT_ISSUER = process.env.JWT_ISSUER || 'byosemarket-api';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'byosemarket-clients';
const JWT_ALGORITHM = 'HS256';

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
    const token = jwt.sign(payload, jwtConfig.secret, {
        algorithm: JWT_ALGORITHM,
        expiresIn: jwtConfig.expiresIn,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        subject: String(payload?.id || payload?.email || '')
    });

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
        const payload = jwt.verify(token, jwtConfig.secret, {
            algorithms: [JWT_ALGORITHM],
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
            clockTolerance: 5
        });

        if (!payload || !payload.id || !payload.role) {
            return {
                valid: false,
                expired: false,
                error: new Error('Token payload missing required claims'),
                secretSource: jwtConfig.secretSource
            };
        }

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
