const mongoose = require('mongoose');

const StorefrontStateSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    userId: { type: String, required: true, unique: true, index: true },
    email: { type: String, default: '', lowercase: true, index: true },
    phone: { type: String, default: '', index: true },
    cartItems: { type: [mongoose.Schema.Types.Mixed], default: [] },
    directCheckout: { type: mongoose.Schema.Types.Mixed, default: null },
    checkoutDraft: { type: mongoose.Schema.Types.Mixed, default: null },
    checkoutConfirmation: { type: mongoose.Schema.Types.Mixed, default: null },
    lastCartSyncedAt: { type: Date, default: null },
    lastDraftSyncedAt: { type: Date, default: null },
    lastCheckoutSyncedAt: { type: Date, default: null }
}, { timestamps: true, strict: false });

module.exports = mongoose.model('StorefrontState', StorefrontStateSchema);