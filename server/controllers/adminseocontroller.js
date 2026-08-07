const seoSettingsService = require('../services/seosettings.service');
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
        code: error?.code || (statusCode >= 500 ? 'ADMIN_SEO_ERROR' : 'SEO_VALIDATION_FAILED'),
        message: error?.message || 'Unable to process SEO request',
        details: error?.details || undefined
    });
}

async function recordAudit(req, summary, meta = {}) {
    try {
        await adminSecurityService.recordSecurityEvent(
            { id: req.admin?.id, email: req.admin?.email },
            {
                eventType: 'seo_settings_updated',
                summary,
                meta,
                ip: adminSecurityService.buildRequestContext(req).ip,
                userAgent: adminSecurityService.buildRequestContext(req).userAgent
            }
        );
    } catch (_error) {
        // non-blocking
    }

    try {
        const { getRepositoryBundle } = require('../repositories');
        const repos = getRepositoryBundle();
        await repos.adminProfile.recordActivity({
            adminPublicId: String(req.admin?.id || ''),
            adminEmail: String(req.admin?.email || ''),
            eventType: 'seo_settings_updated',
            category: 'settings',
            summary,
            meta,
            ip: adminSecurityService.buildRequestContext(req).ip,
            userAgent: adminSecurityService.buildRequestContext(req).userAgent
        });
    } catch (_error) {
        // non-blocking
    }
}

exports.getSeo = async (req, res) => {
    try {
        const seo = await seoSettingsService.getAdminSeo();
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, seo });
    } catch (error) {
        return sendError(req, res, error, 'admin.seo.fetch_failed');
    }
};

exports.updateSeo = async (req, res) => {
    try {
        const seo = await seoSettingsService.updateSeo(req.body || {}, {
            id: req.admin?.id,
            email: req.admin?.email
        });
        await recordAudit(req, 'SEO settings updated', {
            title: seo.website?.websiteTitle,
            robots: seo.website?.robotsMeta
        });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            message: 'SEO settings saved successfully',
            seo
        });
    } catch (error) {
        return sendError(req, res, error, 'admin.seo.update_failed');
    }
};

exports.validateSeo = async (req, res) => {
    try {
        const result = await seoSettingsService.validateSeoPayload(req.body || {});
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        return sendError(req, res, error, 'admin.seo.validate_failed');
    }
};

exports.setImage = async (req, res) => {
    try {
        const field = String(req.params.field || '').trim();
        const pathValue = req.body?.path || req.body?.storagePath || req.body?.url || '';
        const seo = await seoSettingsService.setSeoImage(field, pathValue, {
            id: req.admin?.id,
            email: req.admin?.email
        });
        await recordAudit(req, `SEO image updated: ${field}`, { field });
        return res.status(200).json({ success: true, seo });
    } catch (error) {
        return sendError(req, res, error, 'admin.seo.image_set_failed');
    }
};

exports.removeImage = async (req, res) => {
    try {
        const field = String(req.params.field || '').trim();
        const seo = await seoSettingsService.removeSeoImage(field, {
            id: req.admin?.id,
            email: req.admin?.email
        });
        await recordAudit(req, `SEO image removed: ${field}`, { field });
        return res.status(200).json({ success: true, seo });
    } catch (error) {
        return sendError(req, res, error, 'admin.seo.image_remove_failed');
    }
};

exports.getRobotsTxt = async (_req, res) => {
    try {
        const body = await seoSettingsService.getRobotsTxt();
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.status(200).send(body);
    } catch (error) {
        return sendError(_req, res, error, 'seo.robots_failed');
    }
};

exports.getSitemapXml = async (_req, res) => {
    try {
        const body = await seoSettingsService.getSitemapXml();
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.status(200).send(body);
    } catch (error) {
        return sendError(_req, res, error, 'seo.sitemap_failed');
    }
};

exports.seoMutationLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 60,
    code: 'ADMIN_SEO_RATE_LIMITED',
    message: 'Too many SEO updates. Please retry shortly.'
});
