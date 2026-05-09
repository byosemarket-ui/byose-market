const mongoose = require('mongoose');

const CustomerActivitySchema = new mongoose.Schema({
    clientActivityId: { type: String, trim: true, default: '', index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    userId: { type: String, default: '', index: true },
    email: { type: String, default: '', lowercase: true, index: true },
    phone: { type: String, default: '', index: true },
    sessionId: { type: String, default: '', index: true },
    eventType: { type: String, required: true, index: true },
    path: { type: String, default: '' },
    referrer: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    device: { type: String, default: '' },
    ip: { type: String, default: '' },
    city: { type: String, default: '' },
    country: { type: String, default: '' },
    org: { type: String, default: '' },
    duration: { type: Number, default: 0 },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null }
}, { timestamps: true, strict: false });

CustomerActivitySchema.index(
    { clientActivityId: 1, eventType: 1 },
    {
        unique: true,
        partialFilterExpression: {
            clientActivityId: { $type: 'string', $ne: '' }
        }
    }
);

CustomerActivitySchema.index({ eventType: 1, createdAt: -1 });
CustomerActivitySchema.index({ sessionId: 1, createdAt: -1 });
CustomerActivitySchema.index({ userId: 1, createdAt: -1 });
CustomerActivitySchema.index({ path: 1, createdAt: -1 });
CustomerActivitySchema.index({ createdAt: -1, updatedAt: -1 });

// Scalability: auto-expire activity logs after 90 days to prevent unbounded growth.
// Set ACTIVITY_LOG_TTL_SECONDS env var to override (e.g. 7776000 = 90 days).
// Remove or increase this index to retain logs longer.
const ACTIVITY_TTL_SECONDS = Math.max(86400, Number(process.env.ACTIVITY_LOG_TTL_SECONDS || 7776000));
CustomerActivitySchema.index({ createdAt: 1 }, { expireAfterSeconds: ACTIVITY_TTL_SECONDS });

module.exports = mongoose.model('CustomerActivity', CustomerActivitySchema);