// ===============================
// OTP SYSTEM (IN-MEMORY)
// ===============================
// SCALABILITY NOTE:
// The in-memory otpStore is suitable for single-instance deployments.
// When scaling to multiple instances (horizontal scaling), OTPs stored
// here will not be visible across instances, causing verification failures.
//
// Upgrade path for multi-instance scale:
//   Option A: Replace otpStore with Redis (ioredis) using SETEX for TTL.
//   Option B: Persist OTPs in MongoDB with a TTL index (expireAfterSeconds).
//   Option C: Use a stateless signed token (HMAC) instead of stored codes.
//
// Until then, this works correctly on single-instance Render deployments.
// ===============================

// Bounded store to prevent unbounded memory growth.
// Prune expired entries periodically.
const otpStore = new Map();

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_PRUNE_INTERVAL_MS = 10 * 60 * 1000; // prune every 10 minutes

const pruneTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of otpStore) {
        if (record.expiresAt <= now) {
            otpStore.delete(key);
        }
    }
}, OTP_PRUNE_INTERVAL_MS);

if (typeof pruneTimer.unref === 'function') {
    pruneTimer.unref();
}

// ===============================
// GENERATE OTP
// ===============================
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// ===============================
// SAVE OTP
// ===============================
function saveOTP(identifier, otp) {
    otpStore.set(String(identifier || ''), {
        code: String(otp || ''),
        expiresAt: Date.now() + OTP_TTL_MS
    });
}

// ===============================
// VERIFY OTP
// ===============================
function verifyOTP(identifier, otp) {
    const key = String(identifier || '');
    const record = otpStore.get(key);

    if (!record) {
        return { success: false, message: "No OTP found" };
    }

    if (Date.now() > record.expiresAt) {
        otpStore.delete(key);
        return { success: false, message: "OTP expired" };
    }

    if (record.code !== String(otp || '')) {
        return { success: false, message: "Invalid OTP" };
    }

    // success → delete OTP
    otpStore.delete(key);

    return { success: true };
}

// ===============================
// EXPORT
// ===============================
module.exports = {
    generateOTP,
    saveOTP,
    verifyOTP
};