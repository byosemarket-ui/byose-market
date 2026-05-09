const mongoose = require('mongoose');

const StoreSettingsSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, default: 'global' },
    storeName: { type: String, default: '' },
    supportEmail: { type: String, default: '' },
    supportPhone: { type: String, default: '' },
    currency: { type: String, default: 'RWF' },
    updatedByAdminId: { type: String, default: '' },
    updatedByAdminEmail: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('StoreSettings', StoreSettingsSchema);