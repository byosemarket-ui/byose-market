const userDataService = require('./userdataservice');
const { getRepositoryBundle } = require('../repositories');
const { normalizeRwandaPhone } = require('../utils/phone');
const { deleteManagedFiles } = require('./uploadstorage.service');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;
const PHONE_RE = /^[+]?[\d\s().-]{7,20}$/;

const ALLOWED_LANGUAGES = new Set(['en', 'fr', 'rw', 'sw']);
const ALLOWED_TIME_ZONES = new Set([
    'Africa/Kigali',
    'Africa/Nairobi',
    'Africa/Lagos',
    'Africa/Johannesburg',
    'Europe/London',
    'Europe/Paris',
    'UTC',
    'America/New_York'
]);

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.users || !repositories.adminProfile) {
        throw new Error('Admin profile service requires the SQLite repository bundle.');
    }
    return repositories;
}

function normalizeText(value, fallback = '') {
    const text = String(value || '').trim();
    return text || fallback;
}

function normalizeAvatarPath(value) {
    const raw = normalizeText(value);
    if (!raw) {
        return '';
    }

    if (/^https?:\/\//i.test(raw)) {
        try {
            const pathname = new URL(raw).pathname || '';
            if (pathname.startsWith('/uploads/')) {
                return pathname.replace(/^\/uploads\//, '');
            }
        } catch (_error) {
            return '';
        }
        return '';
    }

    return raw.replace(/^\/+/, '').replace(/^uploads\//i, '');
}

function resolveAvatarUrl(avatarPath) {
    const path = normalizeAvatarPath(avatarPath);
    if (!path) {
        return '';
    }
    if (/^https?:\/\//i.test(path)) {
        return path;
    }
    return `/uploads/${path}`;
}

function deriveUsername(email, fallback = 'admin') {
    const local = normalizeText(email).toLowerCase().split('@')[0].replace(/[^a-z0-9._-]/gi, '');
    if (local.length >= 3) {
        return local.slice(0, 32);
    }
    return fallback;
}

function splitName(fullName) {
    const parts = normalizeText(fullName).split(/\s+/).filter(Boolean);
    if (!parts.length) {
        return { firstName: 'Central', lastName: 'Admin' };
    }
    if (parts.length === 1) {
        return { firstName: parts[0], lastName: 'Admin' };
    }
    return {
        firstName: parts[0],
        lastName: parts.slice(1).join(' ')
    };
}

function ValidationError(message, details = {}) {
    const error = new Error(message);
    error.statusCode = 400;
    error.code = 'ADMIN_PROFILE_VALIDATION_FAILED';
    error.details = details;
    return error;
}

function sanitizeProfile(user, extras = {}) {
    const nameParts = splitName(user?.name || 'Administrator');
    const avatarPath = normalizeAvatarPath(user?.avatar);
    return {
        id: normalizeText(user?.id),
        administratorId: normalizeText(user?.id),
        name: normalizeText(user?.name, 'Administrator'),
        firstName: nameParts.firstName,
        lastName: nameParts.lastName,
        username: normalizeText(user?.username) || deriveUsername(user?.email),
        email: normalizeText(user?.email).toLowerCase(),
        phone: normalizeText(user?.phone),
        role: normalizeText(user?.role, 'admin'),
        status: normalizeText(user?.status, 'active'),
        verified: Boolean(user?.verified),
        emailVerified: Boolean(user?.verified),
        jobTitle: normalizeText(user?.jobTitle),
        department: normalizeText(user?.department),
        preferredLanguage: normalizeText(user?.preferredLanguage, 'en'),
        timeZone: normalizeText(user?.timeZone, 'Africa/Kigali'),
        avatar: avatarPath,
        avatarUrl: resolveAvatarUrl(avatarPath),
        createdAt: user?.createdAt || null,
        updatedAt: user?.updatedAt || null,
        lastLoginAt: user?.lastLoginAt || null,
        lastPasswordChangeAt: user?.lastPasswordChangeAt || user?.createdAt || null,
        loginCount: Number(user?.loginCount || 0) || 0,
        dateJoined: user?.createdAt || null,
        ...extras
    };
}

async function ensureAdminUser(adminIdentity = {}) {
    const repos = getRepos();
    const publicId = normalizeText(adminIdentity.id);
    const email = normalizeText(adminIdentity.email).toLowerCase();

    let user = await repos.users.findAdminByPublicIdOrEmail({ publicId, email });
    if (user) {
        if (!normalizeText(user.username)) {
            user = await repos.users.update(user.id, {
                username: deriveUsername(user.email || email)
            });
        }
        return user;
    }

    if (!email) {
        throw ValidationError('Admin identity is incomplete.');
    }

    const passwordHash = normalizeText(process.env.ADMIN_PASSWORD_HASH);
    if (!passwordHash) {
        throw ValidationError('Administrator account has not been bootstrapped yet.');
    }

    user = await userDataService.upsertAdminUser({
        publicId: publicId || undefined,
        email,
        passwordHash,
        name: 'Administrator',
        username: deriveUsername(email)
    });

    return user;
}

function validateProfilePayload(payload = {}, { requireAll = true } = {}) {
    const errors = {};
    const name = normalizeText(payload.name || payload.fullName);
    const username = normalizeText(payload.username).toLowerCase();
    const email = normalizeText(payload.email).toLowerCase();
    const phoneRaw = normalizeText(payload.phone || payload.phoneNumber);
    const jobTitle = normalizeText(payload.jobTitle);
    const department = normalizeText(payload.department);
    const preferredLanguage = normalizeText(payload.preferredLanguage, 'en').toLowerCase();
    const timeZone = normalizeText(payload.timeZone, 'Africa/Kigali');

    if (requireAll || Object.prototype.hasOwnProperty.call(payload, 'name') || Object.prototype.hasOwnProperty.call(payload, 'fullName')) {
        if (!name || name.length < 2 || name.length > 80) {
            errors.name = 'Full name must be between 2 and 80 characters.';
        }
    }

    if (requireAll || Object.prototype.hasOwnProperty.call(payload, 'username')) {
        if (!USERNAME_RE.test(username)) {
            errors.username = 'Username must be 3–32 characters using letters, numbers, dots, underscores, or hyphens.';
        }
    }

    if (requireAll || Object.prototype.hasOwnProperty.call(payload, 'email')) {
        if (!EMAIL_RE.test(email)) {
            errors.email = 'Enter a valid email address.';
        }
    }

    let phone = '';
    if (phoneRaw) {
        phone = normalizeRwandaPhone(phoneRaw) || phoneRaw;
        if (!PHONE_RE.test(phoneRaw) || phone.length < 7) {
            errors.phone = 'Enter a valid phone number.';
        }
    }

    if (jobTitle.length > 80) {
        errors.jobTitle = 'Job title must be 80 characters or fewer.';
    }

    if (department.length > 80) {
        errors.department = 'Department must be 80 characters or fewer.';
    }

    if (!ALLOWED_LANGUAGES.has(preferredLanguage)) {
        errors.preferredLanguage = 'Preferred language is not supported.';
    }

    if (!ALLOWED_TIME_ZONES.has(timeZone)) {
        errors.timeZone = 'Time zone is not supported.';
    }

    if (Object.keys(errors).length) {
        throw ValidationError('Please correct the highlighted profile fields.', errors);
    }

    return {
        name,
        username,
        email,
        phone,
        jobTitle,
        department,
        preferredLanguage,
        timeZone
    };
}

async function getProfile(adminIdentity, requestMeta = {}) {
    const repos = getRepos();
    const user = await ensureAdminUser(adminIdentity);
    const [loginHistory, recentProfileUpdates, recentSecurityChanges, latestLogin] = await Promise.all([
        repos.adminProfile.listLoginHistory(user.id, { limit: 12 }),
        repos.adminProfile.listActivity(user.id, { limit: 12, category: 'profile' }),
        repos.adminProfile.listActivity(user.id, { limit: 12, category: 'security' }),
        repos.adminProfile.findLatestSuccessfulLogin(user.id)
    ]);

    const currentSession = {
        sessionId: normalizeText(requestMeta.sessionId) || normalizeText(latestLogin?.sessionId),
        startedAt: latestLogin?.createdAt || user.lastLoginAt || null,
        ip: normalizeText(requestMeta.ip) || normalizeText(latestLogin?.ip) || '—',
        userAgent: normalizeText(requestMeta.userAgent) || normalizeText(latestLogin?.userAgent) || '—',
        device: normalizeText(latestLogin?.device) || 'Current browser',
        tokenFingerprint: normalizeText(requestMeta.tokenFingerprint)
    };

    return {
        profile: sanitizeProfile(user, {
            account: {
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
                lastPasswordChangeAt: user.lastPasswordChangeAt || user.createdAt,
                lastLoginAt: user.lastLoginAt,
                currentSession,
                loginCount: Number(user.loginCount || 0) || 0
            },
            activity: {
                recentLogins: loginHistory,
                recentProfileUpdates,
                recentSecurityChanges
            }
        })
    };
}

async function updateProfile(adminIdentity, payload, requestMeta = {}) {
    const repos = getRepos();
    const user = await ensureAdminUser(adminIdentity);
    const validated = validateProfilePayload(payload, { requireAll: true });

    if (await repos.users.existsByUsername(validated.username, user.id)) {
        throw ValidationError('That username is already taken.', { username: 'Username is already in use.' });
    }

    if (await repos.users.existsByEmail(validated.email, user.id)) {
        throw ValidationError('That email is already registered.', { email: 'Email is already in use.' });
    }

    if (validated.phone && await repos.users.existsByPhone(validated.phone, user.id)) {
        throw ValidationError('That phone number is already registered.', { phone: 'Phone number is already in use.' });
    }

    const changedFields = [];
    if (validated.name !== normalizeText(user.name)) changedFields.push('name');
    if (validated.username !== normalizeText(user.username).toLowerCase()) changedFields.push('username');
    if (validated.email !== normalizeText(user.email).toLowerCase()) changedFields.push('email');
    if (validated.phone !== normalizeText(user.phone)) changedFields.push('phone');
    if (validated.jobTitle !== normalizeText(user.jobTitle)) changedFields.push('jobTitle');
    if (validated.department !== normalizeText(user.department)) changedFields.push('department');
    if (validated.preferredLanguage !== normalizeText(user.preferredLanguage, 'en')) changedFields.push('preferredLanguage');
    if (validated.timeZone !== normalizeText(user.timeZone, 'Africa/Kigali')) changedFields.push('timeZone');

    const updated = await repos.users.update(user.id, {
        name: validated.name,
        username: validated.username,
        email: validated.email,
        phone: validated.phone,
        jobTitle: validated.jobTitle,
        department: validated.department,
        preferredLanguage: validated.preferredLanguage,
        timeZone: validated.timeZone
    });

    if (changedFields.length) {
        await repos.adminProfile.recordActivity({
            adminPublicId: updated.id,
            adminEmail: updated.email,
            eventType: 'profile_update',
            category: 'profile',
            summary: `Updated profile fields: ${changedFields.join(', ')}`,
            meta: { changedFields },
            ip: requestMeta.ip,
            userAgent: requestMeta.userAgent
        });

        const securityFields = changedFields.filter((field) => ['email', 'phone', 'name', 'username'].includes(field));
        if (securityFields.length) {
            await repos.adminProfile.recordActivity({
                adminPublicId: updated.id,
                adminEmail: updated.email,
                eventType: securityFields.includes('email')
                    ? 'email_changed'
                    : (securityFields.includes('phone') ? 'phone_changed' : 'profile_updated'),
                category: 'security',
                summary: `Security-sensitive profile update: ${securityFields.join(', ')}`,
                meta: { changedFields: securityFields },
                ip: requestMeta.ip,
                userAgent: requestMeta.userAgent
            });
        }
    }

    return getProfile({ id: updated.id, email: updated.email }, requestMeta);
}

async function updateProfilePhoto(adminIdentity, avatarInput, requestMeta = {}) {
    const repos = getRepos();
    const user = await ensureAdminUser(adminIdentity);
    const nextAvatar = normalizeAvatarPath(avatarInput);

    if (!nextAvatar || !/^users\//i.test(nextAvatar)) {
        throw ValidationError('Upload a valid profile photo from the users storage bucket.', {
            avatar: 'Invalid profile photo path.'
        });
    }

    const previousAvatar = normalizeAvatarPath(user.avatar);
    const updated = await repos.users.update(user.id, { avatar: nextAvatar });

    if (previousAvatar && previousAvatar !== nextAvatar) {
        try {
            deleteManagedFiles([previousAvatar]);
        } catch (_error) {
            // Non-blocking cleanup.
        }
    }

    await repos.adminProfile.recordActivity({
        adminPublicId: updated.id,
        adminEmail: updated.email,
        eventType: previousAvatar ? 'profile_photo_replace' : 'profile_photo_upload',
        category: 'profile',
        summary: previousAvatar ? 'Replaced profile photo' : 'Uploaded profile photo',
        meta: { avatar: nextAvatar, previousAvatar: previousAvatar || null },
        ip: requestMeta.ip,
        userAgent: requestMeta.userAgent
    });

    return getProfile({ id: updated.id, email: updated.email }, requestMeta);
}

async function removeProfilePhoto(adminIdentity, requestMeta = {}) {
    const repos = getRepos();
    const user = await ensureAdminUser(adminIdentity);
    const previousAvatar = normalizeAvatarPath(user.avatar);

    if (!previousAvatar) {
        return getProfile({ id: user.id, email: user.email }, requestMeta);
    }

    const updated = await repos.users.update(user.id, { avatar: '' });

    try {
        deleteManagedFiles([previousAvatar]);
    } catch (_error) {
        // Non-blocking cleanup.
    }

    await repos.adminProfile.recordActivity({
        adminPublicId: updated.id,
        adminEmail: updated.email,
        eventType: 'profile_photo_remove',
        category: 'profile',
        summary: 'Removed profile photo',
        meta: { previousAvatar },
        ip: requestMeta.ip,
        userAgent: requestMeta.userAgent
    });

    return getProfile({ id: updated.id, email: updated.email }, requestMeta);
}

async function recordAdminLogin(adminIdentity, requestMeta = {}) {
    const adminSecurityService = require('./adminsecurityservice');
    const result = await adminSecurityService.createLoginSession(adminIdentity, {
        headers: {
            'user-agent': requestMeta.userAgent || '',
            'x-forwarded-for': requestMeta.ip || '',
            'x-admin-session-id': requestMeta.sessionId || ''
        },
        ip: requestMeta.ip,
        socket: { remoteAddress: requestMeta.ip }
    }, {
        sessionId: requestMeta.sessionId,
        device: requestMeta.device,
        deviceName: requestMeta.deviceName,
        deviceFingerprint: requestMeta.deviceFingerprint,
        browser: requestMeta.browser,
        os: requestMeta.os,
        country: requestMeta.country,
        city: requestMeta.city,
        expiresAt: requestMeta.expiresAt,
        tokenFingerprint: requestMeta.tokenFingerprint,
        meta: requestMeta.meta || {}
    });

    return {
        user: result.user,
        login: result.login,
        session: result.session,
        sessionId: result.sessionId
    };
}

function getPublicSessionProfile(user) {
    const sanitized = sanitizeProfile(user);
    return {
        id: sanitized.id,
        email: sanitized.email,
        role: sanitized.role,
        name: sanitized.name,
        firstName: sanitized.firstName,
        lastName: sanitized.lastName,
        username: sanitized.username,
        avatar: sanitized.avatar,
        avatarUrl: sanitized.avatarUrl,
        status: sanitized.status,
        verified: sanitized.verified
    };
}

module.exports = {
    ensureAdminUser,
    getProfile,
    getPublicSessionProfile,
    recordAdminLogin,
    removeProfilePhoto,
    sanitizeProfile,
    updateProfile,
    updateProfilePhoto,
    validateProfilePayload
};
