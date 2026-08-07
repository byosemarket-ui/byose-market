const adminSecurityService = require('../services/adminsecurityservice');
const { appLogger } = require('../utils/logger');

function assertOwnAdmin(req) {
    if (!req.admin || req.admin.role !== 'admin' || !req.admin.id) {
        const error = new Error('Admin access required');
        error.statusCode = 403;
        error.code = 'ADMIN_ROLE_REQUIRED';
        throw error;
    }
    return {
        id: String(req.admin.id),
        email: String(req.admin.email || '').trim().toLowerCase(),
        role: 'admin',
        sid: String(req.admin.sid || req.adminSessionId || '').trim()
    };
}

function sendError(req, res, error, eventName) {
    const statusCode = Number(error?.statusCode || 500) || 500;
    if (statusCode >= 500) {
        (req.log || appLogger).error(eventName, { error });
    } else {
        (req.log || appLogger).warn(eventName, {
            code: error?.code || '',
            message: error?.message || '',
            details: error?.details || null
        });
    }

    return res.status(statusCode).json({
        success: false,
        code: error?.code || (statusCode >= 500 ? 'ADMIN_SECURITY_ERROR' : 'ADMIN_SECURITY_VALIDATION_FAILED'),
        message: error?.message || 'Unable to process security request',
        details: error?.details || undefined
    });
}

exports.getSecurityOverview = async (req, res) => {
    try {
        const admin = assertOwnAdmin(req);
        const overview = await adminSecurityService.getSecurityOverview(admin, req);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, ...overview });
    } catch (error) {
        return sendError(req, res, error, 'admin.security.overview_failed');
    }
};

exports.listSessions = async (req, res) => {
    try {
        const admin = assertOwnAdmin(req);
        const result = await adminSecurityService.listSessions(admin, req);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        return sendError(req, res, error, 'admin.security.sessions_failed');
    }
};

exports.terminateSession = async (req, res) => {
    try {
        const admin = assertOwnAdmin(req);
        const sessionId = String(req.params.sessionId || '').trim();
        const confirmCurrent = req.body?.confirmCurrent === true
            || String(req.body?.confirmCurrent || req.query?.confirmCurrent || '').toLowerCase() === 'true';
        const result = await adminSecurityService.terminateSession(admin, sessionId, req, { confirmCurrent });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            message: result.endedCurrent ? 'Current session ended' : 'Session ended',
            ...result
        });
    } catch (error) {
        return sendError(req, res, error, 'admin.security.terminate_session_failed');
    }
};

exports.logoutOtherSessions = async (req, res) => {
    try {
        const admin = assertOwnAdmin(req);
        const result = await adminSecurityService.logoutOtherSessions(admin, req);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            message: `Ended ${result.revokedCount} other session(s)`,
            ...result
        });
    } catch (error) {
        return sendError(req, res, error, 'admin.security.logout_others_failed');
    }
};

exports.logoutAllSessions = async (req, res) => {
    try {
        const admin = assertOwnAdmin(req);
        const confirmAll = req.body?.confirmAll === true
            || String(req.body?.confirmAll || req.query?.confirmAll || '').toLowerCase() === 'true';
        const result = await adminSecurityService.logoutAllSessions(admin, req, { confirmAll });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            message: `Ended ${result.revokedCount} session(s) on all devices`,
            ...result
        });
    } catch (error) {
        return sendError(req, res, error, 'admin.security.logout_all_failed');
    }
};

exports.logoutSelectedSessions = async (req, res) => {
    try {
        const admin = assertOwnAdmin(req);
        const sessionIds = Array.isArray(req.body?.sessionIds) ? req.body.sessionIds : [];
        const confirmCurrent = req.body?.confirmCurrent === true
            || String(req.body?.confirmCurrent || '').toLowerCase() === 'true';
        const result = await adminSecurityService.terminateSelectedSessions(admin, sessionIds, req, { confirmCurrent });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            message: `Ended ${result.revokedCount} selected session(s)`,
            ...result
        });
    } catch (error) {
        return sendError(req, res, error, 'admin.security.logout_selected_failed');
    }
};

exports.getCurrentSession = async (req, res) => {
    try {
        const admin = assertOwnAdmin(req);
        const result = await adminSecurityService.getCurrentSession(admin, req);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        return sendError(req, res, error, 'admin.security.current_session_failed');
    }
};

exports.validateSession = async (req, res) => {
    try {
        const admin = assertOwnAdmin(req);
        const result = await adminSecurityService.validateAdminSession(admin, req);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        return sendError(req, res, error, 'admin.security.validate_session_failed');
    }
};

exports.getSessionPolicy = async (req, res) => {
    try {
        assertOwnAdmin(req);
        const policy = await adminSecurityService.getSessionPolicy();
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, policy });
    } catch (error) {
        return sendError(req, res, error, 'admin.security.session_policy_failed');
    }
};

exports.updateSessionPolicy = async (req, res) => {
    try {
        const admin = assertOwnAdmin(req);
        const policy = await adminSecurityService.updateSessionPolicy(req.body || {}, admin);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            message: 'Session expiration policy saved',
            policy
        });
    } catch (error) {
        return sendError(req, res, error, 'admin.security.session_policy_update_failed');
    }
};

exports.listLoginHistory = async (req, res) => {
    try {
        const admin = assertOwnAdmin(req);
        const result = await adminSecurityService.listLoginHistory(admin, {
            query: req.query.q || req.query.query || '',
            status: req.query.status || '',
            page: req.query.page,
            limit: req.query.limit,
            sort: req.query.sort
        });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        return sendError(req, res, error, 'admin.security.login_history_failed');
    }
};

exports.listTrustedDevices = async (req, res) => {
    try {
        const admin = assertOwnAdmin(req);
        const devices = await adminSecurityService.listTrustedDevices(admin);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, devices });
    } catch (error) {
        return sendError(req, res, error, 'admin.security.trusted_devices_failed');
    }
};

exports.trustCurrentDevice = async (req, res) => {
    try {
        const admin = assertOwnAdmin(req);
        const payload = req.body && typeof req.body === 'object' ? req.body : {};
        const device = await adminSecurityService.trustCurrentDevice(admin, req, payload);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, message: 'Device trusted', device });
    } catch (error) {
        return sendError(req, res, error, 'admin.security.trust_device_failed');
    }
};

exports.renameTrustedDevice = async (req, res) => {
    try {
        const admin = assertOwnAdmin(req);
        const deviceId = req.params.deviceId;
        const deviceName = String(req.body?.deviceName || req.body?.name || '').trim();
        const device = await adminSecurityService.renameTrustedDevice(admin, deviceId, deviceName, req);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, message: 'Device renamed', device });
    } catch (error) {
        return sendError(req, res, error, 'admin.security.rename_device_failed');
    }
};

exports.removeTrustedDevice = async (req, res) => {
    try {
        const admin = assertOwnAdmin(req);
        const device = await adminSecurityService.removeTrustedDevice(admin, req.params.deviceId, req);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, message: 'Trusted device removed', device });
    } catch (error) {
        return sendError(req, res, error, 'admin.security.remove_device_failed');
    }
};

exports.listSecurityEvents = async (req, res) => {
    try {
        const admin = assertOwnAdmin(req);
        const result = await adminSecurityService.listSecurityEvents(admin, {
            page: req.query.page,
            limit: req.query.limit,
            eventType: req.query.type || req.query.eventType || ''
        });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        return sendError(req, res, error, 'admin.security.events_failed');
    }
};

exports.getTwoFactor = async (req, res) => {
    try {
        const admin = assertOwnAdmin(req);
        const twoFactor = await adminSecurityService.getTwoFactorStatus(admin);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, twoFactor });
    } catch (error) {
        return sendError(req, res, error, 'admin.security.two_factor_failed');
    }
};

exports.updateTwoFactor = async (req, res) => {
    try {
        const admin = assertOwnAdmin(req);
        const payload = req.body && typeof req.body === 'object' ? req.body : {};
        const twoFactor = await adminSecurityService.updateTwoFactorPlaceholder(admin, payload, req);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, twoFactor });
    } catch (error) {
        return sendError(req, res, error, 'admin.security.two_factor_update_failed');
    }
};
