const { getRepositoryBundle } = require('../repositories');
const adminProfileService = require('./adminprofileservice');
const adminSecurityService = require('./adminsecurityservice');
const { hashPassword, comparePasswords } = require('../utils/hash');
const {
    evaluatePasswordStrength,
    validatePasswordPolicy,
    HISTORY_LIMIT,
    EXPIRATION_DAYS
} = require('../utils/passwordpolicy');
const {
    getRuntimeAdminPasswordHash,
    persistAdminPasswordHashToEnv
} = require('../utils/adminpassword');

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.users || !repositories.adminPassword || !repositories.adminProfile) {
        throw new Error('Admin password service requires the SQLite repository bundle.');
    }
    return repositories;
}

function normalizeText(value, fallback = '') {
    const text = String(value || '').trim();
    return text || fallback;
}

function ValidationError(message, details = {}, statusCode = 400, code = 'ADMIN_PASSWORD_VALIDATION_FAILED') {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    error.details = details;
    return error;
}

function daysBetween(fromIso, toDate = new Date()) {
    const from = new Date(fromIso || 0).getTime();
    if (!Number.isFinite(from) || from <= 0) return null;
    const diff = toDate.getTime() - from;
    return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
}

function buildExpirationStatus(user) {
    const changedAt = user.lastPasswordChangeAt || user.createdAt || null;
    const ageDays = daysBetween(changedAt);
    const expiresAt = user.passwordExpiresAt || (
        changedAt
            ? new Date(new Date(changedAt).getTime() + (EXPIRATION_DAYS * 24 * 60 * 60 * 1000)).toISOString()
            : null
    );

    let daysUntilExpiration = null;
    let expired = false;
    if (expiresAt) {
        const ms = new Date(expiresAt).getTime() - Date.now();
        daysUntilExpiration = Math.ceil(ms / (24 * 60 * 60 * 1000));
        expired = ms <= 0;
    }

    return {
        enabled: true,
        policyDays: EXPIRATION_DAYS,
        lastChangedAt: changedAt,
        passwordAgeDays: ageDays,
        expiresAt,
        daysUntilExpiration,
        expired,
        status: expired ? 'expired' : (daysUntilExpiration != null && daysUntilExpiration <= 14 ? 'expiring_soon' : 'ok'),
        prepared: true,
        message: 'Password expiration architecture is active for monitoring. Forced rotation can be enforced in a later policy release.'
    };
}

async function getActivePasswordHashes(user) {
    const hashes = [];
    const runtimeHash = getRuntimeAdminPasswordHash();
    if (runtimeHash) hashes.push(runtimeHash);
    if (user?.password && !hashes.includes(user.password)) {
        hashes.push(user.password);
    }
    return hashes.filter(Boolean);
}

async function verifyCurrentPassword(adminIdentity, currentPassword) {
    const password = String(currentPassword || '');
    if (!password) {
        throw ValidationError('Current password is required.', {
            currentPassword: 'Enter your current password.'
        });
    }

    const user = await adminProfileService.ensureAdminUser(adminIdentity);
    const hashes = await getActivePasswordHashes(user);
    if (!hashes.length) {
        throw ValidationError('Administrator password is not configured.', {}, 500, 'ADMIN_PASSWORD_MISCONFIGURED');
    }

    for (const hash of hashes) {
        if (await comparePasswords(password, hash)) {
            return { valid: true, user };
        }
    }

    throw ValidationError('Current password is incorrect.', {
        currentPassword: 'Current password is incorrect.'
    }, 401, 'ADMIN_PASSWORD_INVALID');
}

async function assertNotInHistory(adminPublicId, newPassword) {
    const repos = getRepos();
    const history = await repos.adminPassword.listHistory(adminPublicId, { limit: HISTORY_LIMIT });
    for (const entry of history) {
        if (entry.passwordHash && await comparePasswords(newPassword, entry.passwordHash)) {
            throw ValidationError('Choose a password you have not used recently.', {
                newPassword: 'Password was used recently. Pick a new one.'
            });
        }
    }
}

async function getPasswordStatus(adminIdentity) {
    const repos = getRepos();
    const user = await adminProfileService.ensureAdminUser(adminIdentity);
    const history = await repos.adminPassword.listHistoryMetadata(user.id, { limit: 12 });
    const expiration = buildExpirationStatus(user);

    return {
        lastPasswordChangedAt: user.lastPasswordChangeAt || user.createdAt || null,
        passwordVersion: Number(user.passwordVersion || 1) || 1,
        passwordAgeDays: expiration.passwordAgeDays,
        expiration,
        history,
        policy: {
            minLength: 10,
            maxLength: 128,
            requireUppercase: true,
            requireLowercase: true,
            requireNumber: true,
            requireSpecial: true,
            historyLimit: HISTORY_LIMIT,
            expirationDays: EXPIRATION_DAYS,
            minimumStrength: 'Strong'
        }
    };
}

function evaluateStrength(password, currentPassword = '') {
    return evaluatePasswordStrength(password, { currentPassword });
}

async function changePassword(adminIdentity, payload = {}, req = {}) {
    const currentPassword = String(payload.currentPassword || '');
    const newPassword = String(payload.newPassword || '');
    const confirmPassword = String(payload.confirmPassword || payload.newPasswordConfirm || '');

    if (!currentPassword || !newPassword || !confirmPassword) {
        throw ValidationError('Current password, new password, and confirmation are required.');
    }

    if (newPassword !== confirmPassword) {
        throw ValidationError('New password and confirmation do not match.', {
            confirmPassword: 'Confirmation does not match the new password.'
        });
    }

    const verified = await verifyCurrentPassword(adminIdentity, currentPassword);
    const user = verified.user;

    if (newPassword === currentPassword) {
        throw ValidationError('New password must be different from the current password.', {
            newPassword: 'Choose a different password.'
        });
    }

    validatePasswordPolicy(newPassword, { currentPassword });
    await assertNotInHistory(user.id, newPassword);

    // Also block reuse of the active hash itself.
    const activeHashes = await getActivePasswordHashes(user);
    for (const hash of activeHashes) {
        if (await comparePasswords(newPassword, hash)) {
            throw ValidationError('New password must be different from the current password.', {
                newPassword: 'Choose a different password.'
            });
        }
    }

    const repos = getRepos();
    const nextHash = await hashPassword(newPassword);
    const now = new Date().toISOString();
    const nextVersion = Math.max(1, Number(user.passwordVersion || 1) || 1) + 1;
    const expiresAt = new Date(Date.now() + (EXPIRATION_DAYS * 24 * 60 * 60 * 1000)).toISOString();

    for (const hash of activeHashes) {
        await repos.adminPassword.addHistory({
            adminPublicId: user.id,
            passwordHash: hash,
            passwordVersion: user.passwordVersion || 1,
            meta: { source: 'replaced_on_change' }
        });
    }
    await repos.adminPassword.pruneHistory(user.id, HISTORY_LIMIT);

    const persistResult = persistAdminPasswordHashToEnv(nextHash);

    repos.users.db.prepare(`
        UPDATE users
        SET password_hash = ?, last_password_change_at = ?, password_version = ?, password_expires_at = ?, updated_at = ?
        WHERE public_id = ?
    `).run(nextHash, now, nextVersion, expiresAt, now, user.id);

    await adminSecurityService.recordSecurityEvent(
        { id: user.id, email: user.email || adminIdentity.email },
        {
            eventType: 'password_changed',
            summary: 'Administrator password changed',
            meta: {
                passwordVersion: nextVersion,
                envPersisted: Boolean(persistResult?.persisted)
            },
            ip: adminSecurityService.buildRequestContext(req).ip,
            userAgent: adminSecurityService.buildRequestContext(req).userAgent
        }
    );

    const currentSessionId = normalizeText(req.admin?.sid || req.headers?.['x-admin-session-id']);
    let revokedOtherSessions = 0;
    if (currentSessionId) {
        const logoutResult = await adminSecurityService.logoutOtherSessions(
            { id: user.id, email: user.email || adminIdentity.email },
            req
        );
        revokedOtherSessions = Number(logoutResult?.revokedCount || 0) || 0;
    }

    const status = await getPasswordStatus({ id: user.id, email: user.email || adminIdentity.email });

    return {
        ...status,
        changed: true,
        revokedOtherSessions,
        message: 'Password updated successfully. Other active sessions were signed out.'
    };
}

module.exports = {
    changePassword,
    evaluateStrength,
    getPasswordStatus,
    verifyCurrentPassword
};
