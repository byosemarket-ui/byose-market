const CustomerActivity = require('../models/customeractivity');
const User = require('../models/user');
const { appLogger, monitorAsyncOperation } = require('../utils/logger');
const getRealtimeEventService = require('../services/realtimeeventservice');

async function resolveUser(req) {
    if (!req.user || !req.user.id) {
        return null;
    }

    return User.findOne({ id: req.user.id });
}

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeEmail(value) {
    return normalizeText(value).toLowerCase();
}

function normalizePhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) {
        return '';
    }

    if (digits.startsWith('250') && digits.length === 12) {
        return `+${digits}`;
    }

    if (digits.startsWith('0') && digits.length === 10) {
        return `+250${digits.slice(1)}`;
    }

    if (digits.length === 9) {
        return `+250${digits}`;
    }

    return digits.startsWith('+') ? digits : `+${digits}`;
}

function serializeActivity(activity) {
    return {
        id: String(activity?._id || ''),
        clientActivityId: normalizeText(activity?.clientActivityId),
        userId: normalizeText(activity?.userId),
        sessionId: normalizeText(activity?.sessionId),
        eventType: normalizeText(activity?.eventType),
        path: normalizeText(activity?.path),
        referrer: normalizeText(activity?.referrer),
        userAgent: normalizeText(activity?.userAgent),
        device: normalizeText(activity?.device),
        ip: normalizeText(activity?.ip),
        city: normalizeText(activity?.city),
        country: normalizeText(activity?.country),
        org: normalizeText(activity?.org),
        duration: Number(activity?.duration || 0) || 0,
        meta: activity?.meta && typeof activity.meta === 'object' ? activity.meta : {},
        startedAt: activity?.startedAt || activity?.createdAt || null,
        endedAt: activity?.endedAt || null,
        createdAt: activity?.createdAt || null,
        updatedAt: activity?.updatedAt || null
    };
}

exports.recordActivity = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'customer_activity' });
    try {
        const user = await resolveUser(req);
        const eventType = normalizeText(req.body?.eventType || req.body?.type || 'visit');
        const clientActivityId = normalizeText(req.body?.clientActivityId || req.body?.id);
        const filter = clientActivityId ? { clientActivityId, eventType } : null;
        const basePayload = {
            clientActivityId,
            user: user?._id || null,
            userId: normalizeText(user?.id || req.body?.userId),
            email: normalizeEmail(user?.email || req.body?.email),
            phone: normalizePhone(user?.phone || req.body?.phone),
            sessionId: normalizeText(req.body?.sessionId),
            eventType,
            path: normalizeText(req.body?.path),
            referrer: normalizeText(req.body?.referrer),
            userAgent: normalizeText(req.body?.userAgent),
            device: normalizeText(req.body?.device),
            ip: normalizeText(req.body?.ip),
            city: normalizeText(req.body?.city),
            country: normalizeText(req.body?.country),
            org: normalizeText(req.body?.org),
            duration: Number(req.body?.duration || 0) || 0,
            meta: req.body?.meta && typeof req.body.meta === 'object' ? req.body.meta : {},
            startedAt: req.body?.startedAt ? new Date(req.body.startedAt) : new Date(),
            endedAt: req.body?.endedAt ? new Date(req.body.endedAt) : null
        };

        let activity = null;
        if (filter) {
            activity = await monitorAsyncOperation(logger, 'database.activity.upsert', { eventType, clientActivityId }, () => CustomerActivity.findOneAndUpdate(
                filter,
                { $set: basePayload },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            ), { slowThresholdMs: 500 });
        } else {
            activity = await monitorAsyncOperation(logger, 'database.activity.create', { eventType, clientActivityId }, () => CustomerActivity.create(basePayload), { slowThresholdMs: 500 });
        }

        logger.info('activity.recorded', {
            eventType,
            clientActivityId,
            userId: normalizeText(user?.id || req.body?.userId),
            path: basePayload.path
        });

        try {
            const realtimeService = getRealtimeEventService();
            const serialized = serializeActivity(activity);
            realtimeService.emitActivityLogged(serialized);
            realtimeService.emitCustomerActivity(serialized.userId, serialized.eventType, serialized);
            realtimeService.emitAnalyticsUpdated({ source: 'activity', action: 'recorded', eventType: serialized.eventType });
        } catch (eventError) {
            logger.warn('realtime.event_emit_failed', { error: eventError, scope: 'activity.recorded' });
        }

        return res.status(201).json({ success: true, activity: serializeActivity(activity) });
    } catch (error) {
        logger.error('activity.record_failed', { error });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.updateActivity = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'customer_activity' });
    try {
        const clientActivityId = normalizeText(req.params.id || req.body?.clientActivityId);
        if (!clientActivityId) {
            return res.status(400).json({ success: false, message: 'Activity id required' });
        }

        const activity = await monitorAsyncOperation(logger, 'database.activity.find_one', { clientActivityId }, () => CustomerActivity.findOne({ clientActivityId }), { slowThresholdMs: 500 });
        if (!activity) {
            return res.status(404).json({ success: false, message: 'Activity not found' });
        }

        if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'duration')) {
            activity.duration = Number(req.body.duration || 0) || 0;
        }
        if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'endedAt')) {
            activity.endedAt = req.body.endedAt ? new Date(req.body.endedAt) : null;
        }
        if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'city')) {
            activity.city = normalizeText(req.body.city);
        }
        if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'country')) {
            activity.country = normalizeText(req.body.country);
        }
        if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'org')) {
            activity.org = normalizeText(req.body.org);
        }
        if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'ip')) {
            activity.ip = normalizeText(req.body.ip);
        }
        if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'meta') && req.body.meta && typeof req.body.meta === 'object') {
            activity.meta = {
                ...(activity.meta && typeof activity.meta === 'object' ? activity.meta : {}),
                ...req.body.meta
            };
        }

        await monitorAsyncOperation(logger, 'database.activity.save', { clientActivityId }, () => activity.save(), { slowThresholdMs: 500 });
        logger.info('activity.updated', { clientActivityId, eventType: activity.eventType });

        try {
            const realtimeService = getRealtimeEventService();
            const serialized = serializeActivity(activity);
            realtimeService.emitActivityLogged(serialized);
            realtimeService.emitAnalyticsUpdated({ source: 'activity', action: 'updated', eventType: serialized.eventType });
        } catch (eventError) {
            logger.warn('realtime.event_emit_failed', { error: eventError, scope: 'activity.updated' });
        }

        return res.json({ success: true, activity: serializeActivity(activity) });
    } catch (error) {
        logger.error('activity.update_failed', { error, clientActivityId: normalizeText(req.params.id || req.body?.clientActivityId) });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.listAdminActivity = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_activity' });
    try {
        const eventType = normalizeText(req.query?.eventType || req.query?.type);
        const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 50) || 50));
        const page = Math.max(1, Number(req.query?.page || 1) || 1);
        const skip = (page - 1) * limit;
        const filter = eventType ? { eventType } : {};
        const activity = await monitorAsyncOperation(logger, 'database.activity.list', { eventType, limit, page }, () => CustomerActivity.find(filter).sort({ createdAt: -1, updatedAt: -1 }).skip(skip).limit(limit).select('clientActivityId userId sessionId eventType path referrer userAgent device ip city country org duration meta startedAt endedAt createdAt updatedAt').lean(), { slowThresholdMs: 700 });
        logger.debug('activity.listed', { eventType, count: activity.length, limit });
        return res.json({
            success: true,
            activity: activity.map(serializeActivity)
        });
    } catch (error) {
        logger.error('activity.list_failed', { error, eventType: normalizeText(req.query?.eventType || req.query?.type) });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};