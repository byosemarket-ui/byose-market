const adminProfileService = require('../services/adminprofileservice');
const { appLogger } = require('../utils/logger');

function getClientIp(req) {
    const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwardedFor || req.ip || req.socket?.remoteAddress || '';
}

function getRequestMeta(req) {
    return {
        ip: getClientIp(req),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
        tokenFingerprint: String(req.adminTokenFingerprint || ''),
        sessionId: String(req.headers['x-admin-session-id'] || '').trim()
    };
}

function assertOwnProfile(req) {
    if (!req.admin || req.admin.role !== 'admin' || !req.admin.id) {
        const error = new Error('Admin access required');
        error.statusCode = 403;
        error.code = 'ADMIN_ROLE_REQUIRED';
        throw error;
    }
    return {
        id: String(req.admin.id),
        email: String(req.admin.email || '').trim().toLowerCase(),
        role: 'admin'
    };
}

function sendServiceError(req, res, error, eventName) {
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
        code: error?.code || (statusCode >= 500 ? 'ADMIN_PROFILE_ERROR' : 'ADMIN_PROFILE_VALIDATION_FAILED'),
        message: error?.message || 'Unable to process admin profile request',
        details: error?.details || undefined
    });
}

exports.getProfile = async (req, res) => {
    try {
        const admin = assertOwnProfile(req);
        const result = await adminProfileService.getProfile(admin, getRequestMeta(req));
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            profile: result.profile
        });
    } catch (error) {
        return sendServiceError(req, res, error, 'admin.profile.fetch_failed');
    }
};

exports.updateProfile = async (req, res) => {
    try {
        const admin = assertOwnProfile(req);
        const payload = req.body && typeof req.body === 'object' ? req.body : {};
        const result = await adminProfileService.updateProfile(admin, payload, getRequestMeta(req));
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            profile: result.profile
        });
    } catch (error) {
        return sendServiceError(req, res, error, 'admin.profile.update_failed');
    }
};

exports.uploadProfilePhoto = async (req, res) => {
    try {
        const admin = assertOwnProfile(req);
        const payload = req.body && typeof req.body === 'object' ? req.body : {};
        const uploaded = Array.isArray(req.files) && req.files[0]
            ? req.files[0]
            : null;

        let avatarPath = String(payload.avatar || payload.path || payload.storagePath || '').trim();

        if (uploaded && req.uploadBucket) {
            const { buildRelativeUploadPath } = require('../services/uploadstorage.service');
            avatarPath = buildRelativeUploadPath(req.uploadBucket.key, uploaded.filename);
        }

        const result = await adminProfileService.updateProfilePhoto(admin, avatarPath, getRequestMeta(req));
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            message: 'Profile photo updated successfully',
            profile: result.profile
        });
    } catch (error) {
        return sendServiceError(req, res, error, 'admin.profile.photo_upload_failed');
    }
};

exports.removeProfilePhoto = async (req, res) => {
    try {
        const admin = assertOwnProfile(req);
        const result = await adminProfileService.removeProfilePhoto(admin, getRequestMeta(req));
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            message: 'Profile photo removed successfully',
            profile: result.profile
        });
    } catch (error) {
        return sendServiceError(req, res, error, 'admin.profile.photo_remove_failed');
    }
};
