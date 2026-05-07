const mongoose = require('mongoose');

const ContactMessageSchema = new mongoose.Schema({
    messageId: { type: String, required: true, unique: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    userId: { type: String, default: '', index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, default: '', trim: true, lowercase: true, index: true },
    phone: { type: String, default: '', trim: true, index: true },
    message: { type: String, required: true, trim: true },
    source: { type: String, default: 'contact-form', trim: true },
    status: { type: String, default: 'New', trim: true, index: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} }
}, {
    timestamps: true,
    minimize: false
});

module.exports = mongoose.model('ContactMessage', ContactMessageSchema);