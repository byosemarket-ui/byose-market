const generalSettingsService = require('../services/generalsettings.service');
const adminSecurityService = require('../services/adminsecurityservice');
const { createRateLimiter } = require('../middleware/ratelimiter');
const { appLogger } = require('../utils/logger');

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
        code: error?.code || (statusCode >= 500 ? 'ADMIN_SETTINGS_ERROR' : 'GENERAL_SETTINGS_VALIDATION_FAILED'),
        message: error?.message || 'Unable to process settings request',
        details: error?.details || undefined
    });
}

exports.getSettings = async (req, res) => {
    try {
        const settings = await generalSettingsService.getGeneralSettings();
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            settings
        });
    } catch (error) {
        return sendError(req, res, error, 'admin.settings.fetch_failed');
    }
};

exports.updateSettings = async (req, res) => {
    try {
        const payload = req.body && typeof req.body === 'object' ? req.body : {};
        const settings = await generalSettingsService.updateGeneralSettings(payload, {
            id: req.admin?.id,
            email: req.admin?.email
        });

        try {
            await adminSecurityService.recordSecurityEvent(
                { id: req.admin?.id, email: req.admin?.email },
                {
                    eventType: 'general_settings_updated',
                    summary: 'General settings updated',
                    meta: {
                        storeName: settings.storeName,
                        currency: settings.currency,
                        maintenanceMode: settings.maintenanceMode,
                        storeStatus: settings.storeStatus
                    },
                    ip: adminSecurityService.buildRequestContext(req).ip,
                    userAgent: adminSecurityService.buildRequestContext(req).userAgent
                }
            );
        } catch (_error) {
            // Non-blocking audit.
        }

        // Also record under settings category for activity trails.
        try {
            const { getRepositoryBundle } = require('../repositories');
            const repos = getRepositoryBundle();
            await repos.adminProfile.recordActivity({
                adminPublicId: String(req.admin?.id || ''),
                adminEmail: String(req.admin?.email || ''),
                eventType: 'general_settings_updated',
                category: 'settings',
                summary: 'Updated platform general settings',
                meta: { currency: settings.currency, storeStatus: settings.storeStatus },
                ip: adminSecurityService.buildRequestContext(req).ip,
                userAgent: adminSecurityService.buildRequestContext(req).userAgent
            });
        } catch (_error) {
            // Non-blocking.
        }

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            message: 'General settings saved successfully',
            settings
        });
    } catch (error) {
        return sendError(req, res, error, 'admin.settings.update_failed');
    }
};

exports.getPublicSettings = async (req, res) => {
    try {
        const settings = await generalSettingsService.getPublicSettings();
        res.setHeader('Cache-Control', 'public, max-age=30');
        return res.status(200).json({
            success: true,
            settings
        });
    } catch (error) {
        return sendError(req, res, error, 'public.settings.fetch_failed');
    }
};

// Exported for route-level limiter composition if needed.
exports.settingsMutationLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 40,
    code: 'ADMIN_SETTINGS_RATE_LIMITED',
    message: 'Too many settings updates. Please retry shortly.'
});
