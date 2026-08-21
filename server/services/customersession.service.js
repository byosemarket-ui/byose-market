const crypto = require('crypto');
const { generateToken } = require('../utils/token');
const { getRepositoryBundle } = require('../repositories');

const ACCESS_EXPIRES_IN = '12h';
const REFRESH_TTL_MS = {
    remember: 30 * 24 * 60 * 60 * 1000,
    standard: 7 * 24 * 60 * 60 * 1000
};

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.customerSessions) {
        throw new Error('Customer session service requires the SQLite customerSessions repository.');
    }
    return repositories;
}

function hashToken(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function createSessionId() {
    return crypto.randomUUID();
}

function createRefreshToken() {
    return crypto.randomBytes(48).toString('base64url');
}

function refreshTtlMs(remember) {
    return remember ? REFRESH_TTL_MS.remember : REFRESH_TTL_MS.standard;
}

function expiresAtIso(remember, fromMs = Date.now()) {
    return new Date(fromMs + refreshTtlMs(remember)).toISOString();
}

function requestMeta(req) {
    const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    return {
        userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 400),
        ip: forwarded || String(req?.ip || req?.socket?.remoteAddress || '').slice(0, 80)
    };
}

function isSessionActive(session) {
    if (!session || session.revokedAt) {
        return false;
    }
    const expiresAtMs = Date.parse(String(session.expiresAt || ''));
    return Number.isFinite(expiresAtMs) && expiresAtMs > Date.now();
}

function buildAccessToken(user, sessionId) {
    return generateToken(
        {
            id: user.id,
            email: user.email,
            phone: user.phone,
            role: user.role,
            sid: sessionId
        },
        { expiresIn: ACCESS_EXPIRES_IN }
    );
}

function issueCustomerSession(user, { remember = true, req } = {}) {
    const sessionId = createSessionId();
    const refreshToken = createRefreshToken();
    const persistRemember = remember !== false;
    const meta = requestMeta(req);
    const expiresAt = expiresAtIso(persistRemember);

    getRepos().customerSessions.create({
        sessionId,
        userPublicId: user.id,
        refreshTokenHash: hashToken(refreshToken),
        remember: persistRemember,
        userAgent: meta.userAgent,
        ip: meta.ip,
        expiresAt
    });

    return {
        sessionId,
        token: buildAccessToken(user, sessionId),
        refreshToken,
        expiresIn: ACCESS_EXPIRES_IN,
        remember: persistRemember
    };
}

function findActiveBySessionId(sessionId) {
    const session = getRepos().customerSessions.findBySessionId(sessionId);
    return isSessionActive(session) ? session : null;
}

function findActiveByRefreshToken(refreshToken) {
    const session = getRepos().customerSessions.findByRefreshTokenHash(hashToken(refreshToken));
    return isSessionActive(session) ? session : null;
}

function touchSession(sessionId) {
    return getRepos().customerSessions.touch(sessionId);
}

function rotateCustomerSession(session, user, { req } = {}) {
    const refreshToken = createRefreshToken();
    const expiresAt = expiresAtIso(Boolean(session.remember));
    getRepos().customerSessions.rotateRefreshToken(session.sessionId, hashToken(refreshToken), expiresAt);

    return {
        sessionId: session.sessionId,
        token: buildAccessToken(user, session.sessionId),
        refreshToken,
        expiresIn: ACCESS_EXPIRES_IN,
        remember: Boolean(session.remember)
    };
}

function revokeSession(sessionId, reason = 'logout') {
    if (!sessionId) {
        return { changes: 0 };
    }
    return getRepos().customerSessions.revoke(sessionId, reason);
}

function revokeAllForUser(userPublicId, options = {}) {
    return getRepos().customerSessions.revokeAllForUser(userPublicId, options);
}

function revokeByRefreshToken(refreshToken, reason = 'logout') {
    const session = getRepos().customerSessions.findByRefreshTokenHash(hashToken(refreshToken));
    if (!session || session.revokedAt) {
        return { changes: 0, session: null };
    }
    getRepos().customerSessions.revoke(session.sessionId, reason);
    return { changes: 1, session };
}

module.exports = {
    ACCESS_EXPIRES_IN,
    findActiveByRefreshToken,
    findActiveBySessionId,
    issueCustomerSession,
    rotateCustomerSession,
    revokeAllForUser,
    revokeByRefreshToken,
    revokeSession,
    touchSession
};
