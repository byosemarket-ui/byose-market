const StoreSettings = require('../models/storesettings');
const { appLogger } = require('../utils/logger');

const SETTINGS_KEY = 'global';

function sanitizeSettings(settings) {
    if (!settings) {
        return {
            storeName: '',
            supportEmail: '',
            supportPhone: '',
            currency: 'RWF',
            updatedAt: null
        };
    }

    return {
        storeName: String(settings.storeName || '').trim(),
        supportEmail: String(settings.supportEmail || '').trim(),
        supportPhone: String(settings.supportPhone || '').trim(),
        currency: String(settings.currency || 'RWF').trim() || 'RWF',
        updatedAt: settings.updatedAt || null
    };
}

exports.getSettings = async (req, res) => {
    try {
        const settings = await StoreSettings.findOne({ key: SETTINGS_KEY }).lean();
        return res.status(200).json({
            success: true,
            settings: sanitizeSettings(settings)
        });
    } catch (error) {
        (req.log || appLogger).error('admin.settings.fetch_failed', { error });
        return res.status(500).json({ success: false, message: 'Unable to fetch settings' });
    }
};

exports.updateSettings = async (req, res) => {
    try {
        const payload = req.body && typeof req.body === 'object' ? req.body : {};
        const nextSettings = {
            storeName: String(payload.storeName || '').trim(),
            supportEmail: String(payload.supportEmail || '').trim(),
            supportPhone: String(payload.supportPhone || '').trim(),
            currency: String(payload.currency || 'RWF').trim() || 'RWF',
            updatedByAdminId: String(req.admin?.id || '').trim(),
            updatedByAdminEmail: String(req.admin?.email || '').trim().toLowerCase()
        };

        const settings = await StoreSettings.findOneAndUpdate(
            { key: SETTINGS_KEY },
            { $set: nextSettings, $setOnInsert: { key: SETTINGS_KEY } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).lean();

        return res.status(200).json({
            success: true,
            settings: sanitizeSettings(settings)
        });
    } catch (error) {
        (req.log || appLogger).error('admin.settings.update_failed', { error });
        return res.status(500).json({ success: false, message: 'Unable to update settings' });
    }
};