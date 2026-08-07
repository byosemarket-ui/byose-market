const adminPasswordService = require('../services/adminpasswordservice');
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
            message: error?.message || ''
        });
    }

    return res.status(statusCode).json({
        success: false,
        code: error?.code || (statusCode >= 500 ? 'ADMIN_PASSWORD_ERROR' : 'ADMIN_PASSWORD_VALIDATION_FAILED'),
        message: error?.message || 'Unable to process password request',
        details: error?.details || undefined
    });
}

exports.getPasswordStatus = async (req, res) => {
    try {
        const admin = assertOwnAdmin(req);
        const status = await adminPasswordService.getPasswordStatus(admin);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, password: status });
    } catch (error) {
        return sendError(req, res, error, 'admin.password.status_failed');
    }
};

exports.validatePasswordStrength = async (req, res) => {
    try {
        assertOwnAdmin(req);
        const password = String(req.body?.password || req.body?.newPassword || '');
        const currentPassword = String(req.body?.currentPassword || '');
        const strength = adminPasswordService.evaluateStrength(password, currentPassword);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            strength: {
                label: strength.label,
                score: strength.score,
                percent: strength.percent,
                checks: strength.checks,
                errors: strength.errors,
                meetsPolicy: strength.meetsPolicy
            }
        });
    } catch (error) {
        return sendError(req, res, error, 'admin.password.strength_failed');
    }
};

exports.verifyCurrentPassword = async (req, res) => {
    try {
        const admin = assertOwnAdmin(req);
        await adminPasswordService.verifyCurrentPassword(admin, req.body?.currentPassword || req.body?.password);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, valid: true });
    } catch (error) {
        return sendError(req, res, error, 'admin.password.verify_failed');
    }
};

exports.changePassword = async (req, res) => {
    try {
        const admin = assertOwnAdmin(req);
        const payload = req.body && typeof req.body === 'object' ? req.body : {};
        const result = await adminPasswordService.changePassword(admin, payload, req);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            message: result.message,
            password: {
                lastPasswordChangedAt: result.lastPasswordChangedAt,
                passwordVersion: result.passwordVersion,
                passwordAgeDays: result.passwordAgeDays,
                expiration: result.expiration,
                history: result.history,
                policy: result.policy
            },
            revokedOtherSessions: result.revokedOtherSessions
        });
    } catch (error) {
        return sendError(req, res, error, 'admin.password.change_failed');
    }
};
