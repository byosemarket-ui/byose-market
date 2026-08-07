const crypto = require('crypto');
const { getRepositoryBundle } = require('../repositories');
const adminProfileService = require('./adminprofileservice');
const settingsDataService = require('./settingsdataservice');
const { parseUserAgent, resolveApproximateLocation, buildDeviceLabel } = require('../utils/useragent');

const DEFAULT_SESSION_POLICY = Object.freeze({
    sessionDurationHours: 168,
    idleTimeoutHours: 8,
    enforceServerExpiry: true,
    updatedAt: null,
    updatedByAdminId: '',
    updatedByAdminEmail: ''
});

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.adminSecurity || !repositories.adminProfile || !repositories.users) {
        throw new Error('Admin security service requires the SQLite repository bundle.');
    }
    return repositories;
}

function normalizeText(value, fallback = '') {
    const text = String(value || '').trim();
    return text || fallback;
}

function ValidationError(message, details = {}, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = 'ADMIN_SECURITY_VALIDATION_FAILED';
    error.details = details;
    return error;
}

function tokenFingerprint(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex').slice(0, 24);
}

function buildRequestContext(req = {}, overrides = {}) {
    const userAgent = normalizeText(overrides.userAgent || req.headers?.['user-agent']).slice(0, 500);
    const parsed = parseUserAgent(userAgent);
    const location = resolveApproximateLocation(req);
    const forwardedFor = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = normalizeText(
        overrides.ip
        || forwardedFor
        || req.ip
        || req.socket?.remoteAddress
    );

    return {
        ip,
        userAgent,
        browser: normalizeText(overrides.browser, parsed.browser),
        os: normalizeText(overrides.os, parsed.os),
        deviceName: normalizeText(overrides.deviceName, parsed.deviceName),
        device: normalizeText(overrides.device, buildDeviceLabel({
            deviceName: overrides.deviceName || parsed.deviceName,
            browser: overrides.browser || parsed.browser,
            os: overrides.os || parsed.os
        })),
        country: normalizeText(overrides.country, location.country),
        city: normalizeText(overrides.city, location.city),
        deviceFingerprint: normalizeText(overrides.deviceFingerprint),
        sessionId: normalizeText(overrides.sessionId || req.headers?.['x-admin-session-id'] || req.admin?.sid),
        tokenFingerprint: normalizeText(overrides.tokenFingerprint),
        expiresAt: overrides.expiresAt || null,
        meta: overrides.meta && typeof overrides.meta === 'object' ? overrides.meta : {}
    };
}

function serializeSession(session, currentSessionId = '') {
    if (!session) return null;
    const locationParts = [session.city, session.country].filter(Boolean);
    const expired = Boolean(session.expiresAt)
        && Number.isFinite(new Date(session.expiresAt).getTime())
        && new Date(session.expiresAt).getTime() <= Date.now();
    return {
        ...session,
        location: locationParts.join(', ') || 'Unknown',
        isCurrent: Boolean(currentSessionId) && session.sessionId === currentSessionId,
        status: session.revokedAt ? 'revoked' : (expired ? 'expired' : 'active')
    };
}

function sanitizeSessionPolicy(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const duration = Math.min(720, Math.max(1, Number(source.sessionDurationHours) || DEFAULT_SESSION_POLICY.sessionDurationHours));
    const idle = Math.min(168, Math.max(1, Number(source.idleTimeoutHours) || DEFAULT_SESSION_POLICY.idleTimeoutHours));
    return {
        sessionDurationHours: duration,
        idleTimeoutHours: idle,
        enforceServerExpiry: source.enforceServerExpiry === false || String(source.enforceServerExpiry).toLowerCase() === 'false'
            ? false
            : true,
        updatedAt: source.updatedAt || null,
        updatedByAdminId: normalizeText(source.updatedByAdminId),
        updatedByAdminEmail: normalizeText(source.updatedByAdminEmail).toLowerCase()
    };
}

function hoursToJwtExpiresIn(hours) {
    const safeHours = Math.min(720, Math.max(1, Number(hours) || DEFAULT_SESSION_POLICY.sessionDurationHours));
    if (safeHours % 24 === 0) {
        return `${safeHours / 24}d`;
    }
    return `${safeHours}h`;
}

async function getSessionPolicy() {
    const row = await settingsDataService.getSettings();
    const value = row?.value && typeof row.value === 'object' ? row.value : {};
    return sanitizeSessionPolicy(value.sessionManagement || {});
}

async function updateSessionPolicy(payload = {}, admin = {}) {
    const current = await getSessionPolicy();
    const next = sanitizeSessionPolicy({
        ...current,
        ...(payload && typeof payload === 'object' ? payload : {})
    });

    if (!Number.isFinite(Number(payload?.sessionDurationHours)) && payload?.sessionDurationHours != null) {
        throw ValidationError('Session duration must be a number of hours.', {
            sessionDurationHours: 'Enter hours between 1 and 720.'
        });
    }
    if (Number(payload?.sessionDurationHours) < 1 || Number(payload?.sessionDurationHours) > 720) {
        if (payload?.sessionDurationHours != null) {
            throw ValidationError('Session duration must be between 1 and 720 hours.', {
                sessionDurationHours: 'Enter hours between 1 and 720.'
            });
        }
    }
    if (Number(payload?.idleTimeoutHours) < 1 || Number(payload?.idleTimeoutHours) > 168) {
        if (payload?.idleTimeoutHours != null) {
            throw ValidationError('Idle timeout must be between 1 and 168 hours.', {
                idleTimeoutHours: 'Enter hours between 1 and 168.'
            });
        }
    }

    const now = new Date().toISOString();
    const stamped = {
        ...next,
        updatedAt: now,
        updatedByAdminId: normalizeText(admin.id),
        updatedByAdminEmail: normalizeText(admin.email).toLowerCase()
    };

    const row = await settingsDataService.getSettings();
    const existingValue = row?.value && typeof row.value === 'object' ? row.value : {};
    await settingsDataService.updateSettings({
        storeName: normalizeText(row?.storeName || existingValue.storeName, 'BYOSE Market'),
        supportEmail: normalizeText(row?.supportEmail || existingValue.supportEmail, 'byosemarket@gmail.com').toLowerCase(),
        supportPhone: normalizeText(row?.supportPhone || existingValue.supportPhone),
        currency: normalizeText(row?.currency || existingValue.currency, 'RWF'),
        updatedByAdminId: normalizeText(admin.id),
        updatedByAdminEmail: normalizeText(admin.email).toLowerCase(),
        touchedModules: ['sessionManagement'],
        value: {
            ...existingValue,
            sessionManagement: stamped,
            branding: existingValue.branding,
            delivery: existingValue.delivery,
            seo: existingValue.seo
        }
    });

    await recordSecurityEvent(
        { id: admin.id, email: admin.email },
        {
            eventType: 'security_settings_changed',
            summary: 'Session expiration policy updated',
            meta: {
                sessionDurationHours: stamped.sessionDurationHours,
                idleTimeoutHours: stamped.idleTimeoutHours,
                enforceServerExpiry: stamped.enforceServerExpiry
            }
        }
    );

    return stamped;
}

async function resolveLoginTokenOptions() {
    const policy = await getSessionPolicy();
    return {
        expiresIn: hoursToJwtExpiresIn(policy.sessionDurationHours),
        sessionDurationHours: policy.sessionDurationHours,
        idleTimeoutHours: policy.idleTimeoutHours,
        sessionDurationMs: policy.sessionDurationHours * 60 * 60 * 1000,
        idleTimeoutMs: policy.idleTimeoutHours * 60 * 60 * 1000,
        enforceServerExpiry: policy.enforceServerExpiry,
        policy
    };
}

async function purgeExpiredSessionsForAdmin(adminIdentity) {
    const repos = getRepos();
    const user = await adminProfileService.ensureAdminUser(adminIdentity);
    const purged = await repos.adminSecurity.purgeExpiredSessions(user.id);
    for (const session of purged) {
        await recordSecurityEvent(
            { id: user.id, email: user.email },
            {
                eventType: 'session_expired',
                summary: `Session expired: ${session.deviceName || session.sessionId}`,
                meta: { sessionId: session.sessionId, reason: 'session_expired' },
                ip: session.ip,
                userAgent: session.userAgent
            }
        );
    }
    return purged;
}

function recordSecurityEvent(adminIdentity, {
    eventType,
    summary,
    meta = {},
    ip = '',
    userAgent = ''
} = {}) {
    const repos = getRepos();
    return repos.adminProfile.recordActivity({
        adminPublicId: adminIdentity.id || adminIdentity.adminPublicId,
        adminEmail: adminIdentity.email || adminIdentity.adminEmail,
        eventType,
        category: 'security',
        summary,
        meta,
        ip,
        userAgent
    });
}

async function createLoginSession(adminIdentity, req, options = {}) {
    const repos = getRepos();
    const user = await adminProfileService.ensureAdminUser(adminIdentity);
    const context = buildRequestContext(req, options);
    const sessionId = context.sessionId || repos.adminSecurity.createSessionId();

    const updatedUser = options.skipLoginCount
        ? user
        : await repos.users.recordSuccessfulLogin(user.id);

    const login = await repos.adminSecurity.recordLoginHistory({
        adminPublicId: user.id,
        adminEmail: user.email || adminIdentity.email,
        sessionId,
        ip: context.ip,
        userAgent: context.userAgent,
        device: context.device,
        deviceName: context.deviceName,
        browser: context.browser,
        os: context.os,
        country: context.country,
        city: context.city,
        deviceFingerprint: context.deviceFingerprint,
        status: 'success',
        meta: context.meta
    });

    const session = await repos.adminSecurity.createSession({
        sessionId,
        adminPublicId: user.id,
        adminEmail: user.email || adminIdentity.email,
        tokenFingerprint: context.tokenFingerprint,
        deviceFingerprint: context.deviceFingerprint,
        deviceName: context.deviceName,
        browser: context.browser,
        os: context.os,
        ip: context.ip,
        userAgent: context.userAgent,
        country: context.country,
        city: context.city,
        expiresAt: context.expiresAt,
        meta: context.meta
    });

    let isNewDevice = false;
    if (context.deviceFingerprint) {
        const trusted = await repos.adminSecurity.findTrustedDevice(user.id, context.deviceFingerprint);
        if (!trusted) {
            isNewDevice = true;
            await recordSecurityEvent(
                { id: user.id, email: user.email || adminIdentity.email },
                {
                    eventType: 'new_device_login',
                    summary: `New device login: ${context.deviceName || context.device}`,
                    meta: {
                        sessionId,
                        deviceFingerprint: context.deviceFingerprint,
                        browser: context.browser,
                        os: context.os
                    },
                    ip: context.ip,
                    userAgent: context.userAgent
                }
            );
        } else {
            await repos.adminSecurity.touchTrustedDevice(user.id, context.deviceFingerprint, context.ip);
        }
    }

    await recordSecurityEvent(
        { id: user.id, email: user.email || adminIdentity.email },
        {
            eventType: 'successful_login',
            summary: 'Administrator signed in successfully',
            meta: { sessionId, isNewDevice },
            ip: context.ip,
            userAgent: context.userAgent
        }
    );

    return {
        user: updatedUser || user,
        login,
        session,
        sessionId,
        isNewDevice
    };
}

async function recordFailedLogin(adminIdentity, req, options = {}) {
    const repos = getRepos();
    const context = buildRequestContext(req, options);
    const adminPublicId = normalizeText(adminIdentity?.id) || `ADMIN_${Buffer.from(normalizeText(adminIdentity?.email)).toString('hex').slice(0, 16)}`;
    const adminEmail = normalizeText(adminIdentity?.email).toLowerCase();

    const login = await repos.adminSecurity.recordLoginHistory({
        adminPublicId,
        adminEmail,
        sessionId: repos.adminSecurity.createSessionId(),
        ip: context.ip,
        userAgent: context.userAgent,
        device: context.device,
        deviceName: context.deviceName,
        browser: context.browser,
        os: context.os,
        country: context.country,
        city: context.city,
        deviceFingerprint: context.deviceFingerprint,
        status: 'failed',
        meta: { reason: options.reason || 'invalid_credentials', ...(context.meta || {}) }
    });

    await recordSecurityEvent(
        { id: adminPublicId, email: adminEmail },
        {
            eventType: 'failed_login',
            summary: 'Failed administrator login attempt',
            meta: { reason: options.reason || 'invalid_credentials' },
            ip: context.ip,
            userAgent: context.userAgent
        }
    );

    return login;
}

async function getSecurityOverview(adminIdentity, req) {
    const repos = getRepos();
    const user = await adminProfileService.ensureAdminUser(adminIdentity);
    const context = buildRequestContext(req);
    const currentSessionId = context.sessionId || normalizeText(req.admin?.sid);

    await purgeExpiredSessionsForAdmin(adminIdentity);

    const [sessions, trustedDevices, loginHistory, events, policy] = await Promise.all([
        repos.adminSecurity.listActiveSessions(user.id),
        repos.adminSecurity.listTrustedDevices(user.id),
        repos.adminSecurity.listLoginHistory(user.id, { limit: 8, page: 1 }),
        repos.adminProfile.listActivity(user.id, { limit: 20, category: 'security' }),
        getSessionPolicy()
    ]);

    if (currentSessionId) {
        await repos.adminSecurity.touchSession(currentSessionId, { ip: context.ip });
    }

    const serializedSessions = sessions.map((session) => serializeSession(session, currentSessionId));
    const currentSession = serializedSessions.find((session) => session.isCurrent) || null;

    const profile = adminProfileService.getPublicSessionProfile(user);

    return {
        currentSessionId: currentSessionId || null,
        currentSession,
        administrator: {
            id: profile.id,
            name: profile.name || profile.email,
            email: profile.email,
            role: profile.role || 'admin'
        },
        sessions: serializedSessions,
        trustedDevices,
        loginHistory: loginHistory.items,
        loginHistoryPagination: loginHistory.pagination,
        events,
        sessionPolicy: policy,
        twoFactor: {
            enabled: Boolean(user.twoFactorEnabled),
            status: user.twoFactorEnabled ? 'enabled' : 'disabled',
            method: normalizeText(user.twoFactorMethod) || null,
            updatedAt: user.twoFactorUpdatedAt || null,
            recoveryCodesAvailable: false,
            qrCodeAvailable: false,
            prepared: true,
            message: 'Two-factor authentication architecture is prepared. Full TOTP enrollment will ship in a future update.'
        }
    };
}

async function listSessions(adminIdentity, req) {
    const overview = await getSecurityOverview(adminIdentity, req);
    return {
        currentSessionId: overview.currentSessionId,
        sessions: overview.sessions
    };
}

async function listLoginHistory(adminIdentity, query = {}) {
    const repos = getRepos();
    const user = await adminProfileService.ensureAdminUser(adminIdentity);
    return repos.adminSecurity.listLoginHistory(user.id, query);
}

async function listTrustedDevices(adminIdentity) {
    const repos = getRepos();
    const user = await adminProfileService.ensureAdminUser(adminIdentity);
    return repos.adminSecurity.listTrustedDevices(user.id);
}

async function listSecurityEvents(adminIdentity, { page = 1, limit = 30, eventType = '' } = {}) {
    const repos = getRepos();
    const user = await adminProfileService.ensureAdminUser(adminIdentity);
    const events = await repos.adminProfile.listActivity(user.id, {
        limit: Math.min(100, Math.max(1, Number(limit) || 30)) * Math.max(1, Number(page) || 1),
        category: 'security'
    });

    const filtered = normalizeText(eventType)
        ? events.filter((event) => normalizeText(event.eventType).toLowerCase() === normalizeText(eventType).toLowerCase())
        : events;

    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30));
    const safePage = Math.max(1, Number(page) || 1);
    const offset = (safePage - 1) * safeLimit;
    const items = filtered.slice(offset, offset + safeLimit);

    return {
        items,
        pagination: {
            page: safePage,
            limit: safeLimit,
            total: filtered.length,
            totalPages: Math.max(1, Math.ceil(filtered.length / safeLimit))
        }
    };
}

async function terminateSession(adminIdentity, sessionId, req, { confirmCurrent = false } = {}) {
    const repos = getRepos();
    const user = await adminProfileService.ensureAdminUser(adminIdentity);
    const context = buildRequestContext(req);
    const currentSessionId = context.sessionId || normalizeText(req.admin?.sid);
    const targetId = normalizeText(sessionId);
    const session = await repos.adminSecurity.findSessionById(targetId);

    if (!session || session.adminPublicId !== user.id) {
        throw ValidationError('Session not found.', { sessionId: 'Unknown session.' }, 404);
    }

    const isCurrent = Boolean(currentSessionId) && session.sessionId === currentSessionId;
    if (isCurrent && !confirmCurrent) {
        throw ValidationError('Confirm before ending the current session.', {
            sessionId: 'Current session requires confirmation.',
            requiresConfirmation: true
        });
    }

    const revoked = await repos.adminSecurity.revokeSession(targetId, {
        reason: isCurrent ? 'logout_current' : 'logout_session'
    });

    await recordSecurityEvent(
        { id: user.id, email: user.email },
        {
            eventType: 'session_removed',
            summary: isCurrent ? 'Current session ended' : `Session ended: ${session.deviceName || session.sessionId}`,
            meta: { sessionId: targetId, isCurrent },
            ip: context.ip,
            userAgent: context.userAgent
        }
    );

    return {
        session: serializeSession(revoked, currentSessionId),
        endedCurrent: isCurrent
    };
}

async function logoutOtherSessions(adminIdentity, req) {
    const repos = getRepos();
    const user = await adminProfileService.ensureAdminUser(adminIdentity);
    const context = buildRequestContext(req);
    const currentSessionId = context.sessionId || normalizeText(req.admin?.sid);

    if (!currentSessionId) {
        throw ValidationError('Current session could not be identified.');
    }

    const revoked = await repos.adminSecurity.revokeOtherSessions(user.id, currentSessionId, 'logout_others');

    await recordSecurityEvent(
        { id: user.id, email: user.email },
        {
            eventType: 'forced_logout',
            summary: `Logged out ${revoked.length} other session(s)`,
            meta: { count: revoked.length, currentSessionId },
            ip: context.ip,
            userAgent: context.userAgent
        }
    );

    const sessions = await repos.adminSecurity.listActiveSessions(user.id);
    return {
        revokedCount: revoked.length,
        sessions: sessions.map((session) => serializeSession(session, currentSessionId))
    };
}

async function logoutAllSessions(adminIdentity, req, { confirmAll = false } = {}) {
    if (!confirmAll) {
        throw ValidationError('Confirm before logging out all devices.', {
            confirmAll: 'Confirmation required.',
            requiresConfirmation: true
        });
    }

    const repos = getRepos();
    const user = await adminProfileService.ensureAdminUser(adminIdentity);
    const context = buildRequestContext(req);
    const currentSessionId = context.sessionId || normalizeText(req.admin?.sid);
    const revoked = await repos.adminSecurity.revokeAllSessions(user.id, 'logout_all');

    await recordSecurityEvent(
        { id: user.id, email: user.email },
        {
            eventType: 'forced_logout',
            summary: `Logged out all devices (${revoked.length} session(s))`,
            meta: { count: revoked.length, includedCurrent: true, currentSessionId },
            ip: context.ip,
            userAgent: context.userAgent
        }
    );

    return {
        revokedCount: revoked.length,
        endedCurrent: true,
        sessions: []
    };
}

async function terminateSelectedSessions(adminIdentity, sessionIds = [], req, { confirmCurrent = false } = {}) {
    const ids = Array.isArray(sessionIds)
        ? sessionIds.map((id) => normalizeText(id)).filter(Boolean)
        : [];
    if (!ids.length) {
        throw ValidationError('Select at least one session to logout.', {
            sessionIds: 'No sessions selected.'
        });
    }

    const context = buildRequestContext(req);
    const currentSessionId = context.sessionId || normalizeText(req.admin?.sid);
    const results = [];
    let endedCurrent = false;

    for (const sessionId of ids) {
        const isCurrent = Boolean(currentSessionId) && sessionId === currentSessionId;
        const result = await terminateSession(adminIdentity, sessionId, req, {
            confirmCurrent: isCurrent ? confirmCurrent : false
        });
        results.push(result.session);
        if (result.endedCurrent) endedCurrent = true;
    }

    await recordSecurityEvent(
        { id: adminIdentity.id, email: adminIdentity.email },
        {
            eventType: 'forced_logout',
            summary: `Logged out ${results.length} selected session(s)`,
            meta: { count: results.length, sessionIds: ids, endedCurrent },
            ip: context.ip,
            userAgent: context.userAgent
        }
    );

    const overview = await listSessions(adminIdentity, req);
    return {
        revokedCount: results.length,
        endedCurrent,
        sessions: overview.sessions
    };
}

async function getCurrentSession(adminIdentity, req) {
    const overview = await getSecurityOverview(adminIdentity, req);
    return {
        administrator: overview.administrator,
        currentSessionId: overview.currentSessionId,
        currentSession: overview.currentSession,
        sessionPolicy: overview.sessionPolicy
    };
}

async function validateAdminSession(adminIdentity, req) {
    const context = buildRequestContext(req);
    const sessionId = context.sessionId || normalizeText(req.admin?.sid);
    if (!sessionId) {
        return { valid: true, legacy: true, currentSessionId: null };
    }
    const check = await assertSessionAllowed(sessionId, { touch: true, ip: context.ip });
    return {
        valid: Boolean(check.allowed),
        legacy: Boolean(check.legacy),
        currentSessionId: sessionId,
        session: serializeSession(check.session, sessionId)
    };
}

async function trustCurrentDevice(adminIdentity, req, payload = {}) {
    const repos = getRepos();
    const user = await adminProfileService.ensureAdminUser(adminIdentity);
    const context = buildRequestContext(req, payload);
    const fingerprint = context.deviceFingerprint;

    if (!fingerprint || fingerprint.length < 8) {
        throw ValidationError('Device fingerprint is required to trust this device.', {
            deviceFingerprint: 'Missing device fingerprint.'
        });
    }

    const device = await repos.adminSecurity.upsertTrustedDevice({
        adminPublicId: user.id,
        adminEmail: user.email,
        deviceFingerprint: fingerprint,
        deviceName: normalizeText(payload.deviceName, context.deviceName || 'Trusted device'),
        browser: context.browser,
        os: context.os,
        ip: context.ip,
        userAgent: context.userAgent,
        meta: payload.meta || {}
    });

    await recordSecurityEvent(
        { id: user.id, email: user.email },
        {
            eventType: 'trusted_device_added',
            summary: `Trusted device saved: ${device.deviceName}`,
            meta: { deviceId: device.id, deviceFingerprint: fingerprint },
            ip: context.ip,
            userAgent: context.userAgent
        }
    );

    return device;
}

async function renameTrustedDevice(adminIdentity, deviceId, deviceName, req) {
    const repos = getRepos();
    const user = await adminProfileService.ensureAdminUser(adminIdentity);
    const name = normalizeText(deviceName);
    if (name.length < 2 || name.length > 60) {
        throw ValidationError('Device name must be between 2 and 60 characters.', {
            deviceName: 'Invalid device name.'
        });
    }

    const device = await repos.adminSecurity.renameTrustedDevice(user.id, deviceId, name);
    if (!device) {
        throw ValidationError('Trusted device not found.', { deviceId: 'Unknown device.' }, 404);
    }

    const context = buildRequestContext(req);
    await recordSecurityEvent(
        { id: user.id, email: user.email },
        {
            eventType: 'trusted_device_renamed',
            summary: `Trusted device renamed to ${name}`,
            meta: { deviceId: device.id },
            ip: context.ip,
            userAgent: context.userAgent
        }
    );

    return device;
}

async function removeTrustedDevice(adminIdentity, deviceId, req) {
    const repos = getRepos();
    const user = await adminProfileService.ensureAdminUser(adminIdentity);
    const removed = await repos.adminSecurity.removeTrustedDevice(user.id, deviceId);
    if (!removed) {
        throw ValidationError('Trusted device not found.', { deviceId: 'Unknown device.' }, 404);
    }

    const context = buildRequestContext(req);
    await recordSecurityEvent(
        { id: user.id, email: user.email },
        {
            eventType: 'trusted_device_removed',
            summary: `Trusted device removed: ${removed.deviceName}`,
            meta: { deviceId: removed.id },
            ip: context.ip,
            userAgent: context.userAgent
        }
    );

    return removed;
}

async function getTwoFactorStatus(adminIdentity) {
    const user = await adminProfileService.ensureAdminUser(adminIdentity);
    return {
        enabled: Boolean(user.twoFactorEnabled),
        status: user.twoFactorEnabled ? 'enabled' : 'disabled',
        method: normalizeText(user.twoFactorMethod) || null,
        updatedAt: user.twoFactorUpdatedAt || null,
        recoveryCodesAvailable: false,
        qrCodeAvailable: false,
        prepared: true,
        enrollmentReady: false,
        message: 'Two-factor authentication is prepared but not fully implemented yet.'
    };
}

async function updateTwoFactorPlaceholder(adminIdentity, payload = {}, req) {
    const repos = getRepos();
    const user = await adminProfileService.ensureAdminUser(adminIdentity);
    const wantsEnabled = Boolean(payload.enabled);
    const now = new Date().toISOString();

    // Architecture placeholder only — no TOTP secret generation yet.
    repos.users.db.prepare(`
        UPDATE users
        SET two_factor_enabled = ?, two_factor_method = ?, two_factor_updated_at = ?, updated_at = ?
        WHERE public_id = ?
    `).run(
        wantsEnabled ? 0 : 0, // keep disabled until real 2FA ships
        wantsEnabled ? 'totp_pending' : '',
        now,
        now,
        user.id
    );

    const context = buildRequestContext(req);
    await recordSecurityEvent(
        { id: user.id, email: user.email },
        {
            eventType: 'two_factor_placeholder',
            summary: wantsEnabled
                ? '2FA enable requested (placeholder — not activated)'
                : '2FA disable requested (placeholder)',
            meta: { requestedEnabled: wantsEnabled },
            ip: context.ip,
            userAgent: context.userAgent
        }
    );

    return {
        ...(await getTwoFactorStatus(adminIdentity)),
        requestedEnabled: wantsEnabled,
        activated: false,
        message: '2FA controls are prepared. Full authenticator enrollment will be enabled in a later release.'
    };
}

async function assertSessionAllowed(sessionId, { touch = false, ip = '' } = {}) {
    if (!sessionId) {
        return { allowed: true, legacy: true, session: null };
    }

    const repos = getRepos();
    const session = await repos.adminSecurity.findSessionById(sessionId);

    // Unknown session IDs are treated as legacy/untracked tokens (pre-security-module JWTs
    // or rotated DB state). Only explicitly revoked sessions are blocked.
    if (!session) {
        return { allowed: true, legacy: true, session: null };
    }

    if (session.revokedAt) {
        return { allowed: false, legacy: false, session };
    }

    if (session.expiresAt) {
        const policy = await getSessionPolicy().catch(() => DEFAULT_SESSION_POLICY);
        if (policy.enforceServerExpiry !== false) {
            const expires = new Date(session.expiresAt).getTime();
            if (Number.isFinite(expires) && expires <= Date.now()) {
                return { allowed: false, legacy: false, session, reason: 'session_expired' };
            }
        }
    }

    let nextSession = session;
    if (touch) {
        nextSession = await repos.adminSecurity.touchSession(sessionId, { ip });
    }

    return { allowed: true, legacy: false, session: nextSession };
}

async function attachTokenFingerprint(sessionId, token) {
    if (!sessionId || !token) return null;
    const repos = getRepos();
    const session = await repos.adminSecurity.findSessionById(sessionId);
    if (!session || session.revokedAt) return session;
    const fingerprint = tokenFingerprint(token);
    repos.adminSecurity.db.prepare(`
        UPDATE admin_sessions SET token_fingerprint = ? WHERE session_id = ?
    `).run(fingerprint, sessionId);
    return repos.adminSecurity.findSessionById(sessionId);
}

module.exports = {
    assertSessionAllowed,
    attachTokenFingerprint,
    buildRequestContext,
    createLoginSession,
    DEFAULT_SESSION_POLICY,
    getCurrentSession,
    getSecurityOverview,
    getSessionPolicy,
    getTwoFactorStatus,
    hoursToJwtExpiresIn,
    listLoginHistory,
    listSecurityEvents,
    listSessions,
    listTrustedDevices,
    logoutAllSessions,
    logoutOtherSessions,
    purgeExpiredSessionsForAdmin,
    recordFailedLogin,
    recordSecurityEvent,
    removeTrustedDevice,
    renameTrustedDevice,
    resolveLoginTokenOptions,
    terminateSelectedSessions,
    terminateSession,
    tokenFingerprint,
    trustCurrentDevice,
    updateSessionPolicy,
    updateTwoFactorPlaceholder,
    validateAdminSession
};
