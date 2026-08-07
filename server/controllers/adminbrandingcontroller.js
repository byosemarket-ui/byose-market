const brandingSettingsService = require('../services/brandingsettings.service');
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
        code: error?.code || (statusCode >= 500 ? 'ADMIN_BRANDING_ERROR' : 'BRANDING_VALIDATION_FAILED'),
        message: error?.message || 'Unable to process branding request',
        details: error?.details || undefined
    });
}

async function recordBrandingAudit(req, summary, meta = {}) {
    try {
        await adminSecurityService.recordSecurityEvent(
            { id: req.admin?.id, email: req.admin?.email },
            {
                eventType: 'branding_updated',
                summary,
                meta,
                ip: adminSecurityService.buildRequestContext(req).ip,
                userAgent: adminSecurityService.buildRequestContext(req).userAgent
            }
        );
    } catch (_error) {
        // Non-blocking.
    }

    try {
        const { getRepositoryBundle } = require('../repositories');
        const repos = getRepositoryBundle();
        await repos.adminProfile.recordActivity({
            adminPublicId: String(req.admin?.id || ''),
            adminEmail: String(req.admin?.email || ''),
            eventType: 'branding_updated',
            category: 'settings',
            summary,
            meta,
            ip: adminSecurityService.buildRequestContext(req).ip,
            userAgent: adminSecurityService.buildRequestContext(req).userAgent
        });
    } catch (_error) {
        // Non-blocking.
    }
}

exports.getBranding = async (req, res) => {
    try {
        const branding = await brandingSettingsService.getAdminBranding();
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            branding
        });
    } catch (error) {
        return sendError(req, res, error, 'admin.branding.fetch_failed');
    }
};

exports.updateBranding = async (req, res) => {
    try {
        const payload = req.body && typeof req.body === 'object' ? req.body : {};
        const branding = await brandingSettingsService.updateBranding(payload, {
            id: req.admin?.id,
            email: req.admin?.email
        });

        await recordBrandingAudit(req, 'Branding settings updated', {
            version: branding.version,
            primary: branding.colors?.primary
        });

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            message: 'Branding settings saved successfully',
            branding
        });
    } catch (error) {
        return sendError(req, res, error, 'admin.branding.update_failed');
    }
};

exports.setAsset = async (req, res) => {
    try {
        const assetKey = String(req.params.assetKey || '').trim();
        const pathValue = req.body?.path || req.body?.storagePath || req.body?.url || '';
        const result = await brandingSettingsService.setBrandingAsset(assetKey, pathValue, {
            id: req.admin?.id,
            email: req.admin?.email
        });

        await recordBrandingAudit(req, `Branding asset updated: ${assetKey}`, { assetKey });

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            message: 'Branding asset saved successfully',
            assetKey: result.assetKey,
            group: result.group,
            branding: result.branding
        });
    } catch (error) {
        return sendError(req, res, error, 'admin.branding.asset_set_failed');
    }
};

exports.removeAsset = async (req, res) => {
    try {
        const assetKey = String(req.params.assetKey || '').trim();
        const result = await brandingSettingsService.removeBrandingAsset(assetKey, {
            id: req.admin?.id,
            email: req.admin?.email
        });

        await recordBrandingAudit(req, `Branding asset removed: ${assetKey}`, { assetKey });

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            message: 'Branding asset removed successfully',
            assetKey: result.assetKey,
            group: result.group,
            branding: result.branding
        });
    } catch (error) {
        return sendError(req, res, error, 'admin.branding.asset_remove_failed');
    }
};

exports.brandingMutationLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 60,
    code: 'ADMIN_BRANDING_RATE_LIMITED',
    message: 'Too many branding updates. Please retry shortly.'
});
