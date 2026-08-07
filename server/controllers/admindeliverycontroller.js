const deliverySettingsService = require('../services/deliverysettings.service');
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
        code: error?.code || (statusCode >= 500 ? 'ADMIN_DELIVERY_ERROR' : 'DELIVERY_VALIDATION_FAILED'),
        message: error?.message || 'Unable to process delivery request',
        details: error?.details || undefined
    });
}

async function recordAudit(req, summary, meta = {}) {
    try {
        await adminSecurityService.recordSecurityEvent(
            { id: req.admin?.id, email: req.admin?.email },
            {
                eventType: 'delivery_settings_updated',
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
            eventType: 'delivery_settings_updated',
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

exports.getDelivery = async (req, res) => {
    try {
        const delivery = await deliverySettingsService.getAdminDeliverySettings();
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, delivery });
    } catch (error) {
        return sendError(req, res, error, 'admin.delivery.fetch_failed');
    }
};

exports.updateDelivery = async (req, res) => {
    try {
        const payload = req.body && typeof req.body === 'object' ? req.body : {};
        const config = await deliverySettingsService.updateDeliveryConfig(payload, {
            id: req.admin?.id,
            email: req.admin?.email
        });
        await recordAudit(req, 'Delivery settings updated', {
            mode: config.pricing?.mode,
            fixedFee: config.pricing?.fixedFee
        });
        const delivery = await deliverySettingsService.getAdminDeliverySettings();
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            message: 'Delivery settings saved successfully',
            delivery
        });
    } catch (error) {
        return sendError(req, res, error, 'admin.delivery.update_failed');
    }
};

exports.createZone = async (req, res) => {
    try {
        const zone = await deliverySettingsService.createZone(req.body || {}, {
            id: req.admin?.id,
            email: req.admin?.email
        });
        await recordAudit(req, `Delivery zone created: ${zone.name}`, { zoneId: zone.publicId });
        return res.status(201).json({ success: true, zone });
    } catch (error) {
        return sendError(req, res, error, 'admin.delivery.zone_create_failed');
    }
};

exports.updateZone = async (req, res) => {
    try {
        const zone = await deliverySettingsService.updateZone(req.params.zoneId, req.body || {}, {
            id: req.admin?.id,
            email: req.admin?.email
        });
        await recordAudit(req, `Delivery zone updated: ${zone.name}`, { zoneId: zone.publicId });
        return res.status(200).json({ success: true, zone });
    } catch (error) {
        return sendError(req, res, error, 'admin.delivery.zone_update_failed');
    }
};

exports.deleteZone = async (req, res) => {
    try {
        await deliverySettingsService.deleteZone(req.params.zoneId);
        await recordAudit(req, 'Delivery zone deleted', { zoneId: req.params.zoneId });
        return res.status(200).json({ success: true, message: 'Delivery zone deleted' });
    } catch (error) {
        return sendError(req, res, error, 'admin.delivery.zone_delete_failed');
    }
};

exports.calculateShipping = async (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const quote = await deliverySettingsService.calculateShipping({
            subtotal: body.subtotal,
            address: body.address || body.shippingAddress || {},
            method: body.method || body.deliveryMethod || 'homeDelivery',
            distanceKm: body.distanceKm
        });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, shipping: quote });
    } catch (error) {
        return sendError(req, res, error, 'shipping.calculate_failed');
    }
};

exports.getPublicMethods = async (req, res) => {
    try {
        const delivery = await deliverySettingsService.getPublicDeliverySettings();
        res.setHeader('Cache-Control', 'public, max-age=30');
        return res.status(200).json({ success: true, delivery });
    } catch (error) {
        return sendError(req, res, error, 'shipping.public_failed');
    }
};

exports.deliveryMutationLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 80,
    code: 'ADMIN_DELIVERY_RATE_LIMITED',
    message: 'Too many delivery updates. Please retry shortly.'
});
