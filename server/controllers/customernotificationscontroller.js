const { appLogger } = require('../utils/logger');
const userDataService = require('../services/userdataservice');
const customerNotificationDataService = require('../services/customernotificationdataservice');

async function resolveUser(req) {
    if (!req.user || !req.user.id) return null;
    return userDataService.findUserById(req.user.id);
}

exports.list = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'customer-notifications' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const data = await customerNotificationDataService.listNotifications(user, {
            limit: Number(req.query.limit || 30)
        });
        return res.json({ success: true, ...data });
    } catch (err) {
        logger.error('customer_notifications.list_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Unable to load notifications.' });
    }
};

exports.getPrefs = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'customer-notifications' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const prefs = await customerNotificationDataService.getPrefs(user);
        return res.json({ success: true, prefs });
    } catch (err) {
        logger.error('customer_notifications.prefs_get_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Unable to load notification settings.' });
    }
};

exports.updatePrefs = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'customer-notifications' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const prefs = await customerNotificationDataService.updatePrefs(user, req.body || {});
        return res.json({ success: true, prefs });
    } catch (err) {
        logger.error('customer_notifications.prefs_update_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Unable to update notification settings.' });
    }
};

exports.markRead = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'customer-notifications' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const data = await customerNotificationDataService.markRead(user, req.params.id);
        return res.json({ success: true, ...data });
    } catch (err) {
        logger.error('customer_notifications.mark_read_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Unable to update notification.' });
    }
};

exports.markAllRead = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'customer-notifications' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const data = await customerNotificationDataService.markAllRead(user);
        return res.json({ success: true, ...data });
    } catch (err) {
        logger.error('customer_notifications.mark_all_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Unable to update notifications.' });
    }
};
