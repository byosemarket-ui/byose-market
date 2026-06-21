const crypto = require('crypto');

const otpStore = new Map();
const resetTokenStore = new Map();

const OTP_TTL_MS = 5 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
const OTP_PRUNE_INTERVAL_MS = 10 * 60 * 1000;

function pruneStores() {
    const now = Date.now();

    for (const [key, record] of otpStore) {
        if (record.expiresAt <= now) {
            otpStore.delete(key);
        }
    }

    for (const [key, record] of resetTokenStore) {
        if (record.expiresAt <= now) {
            resetTokenStore.delete(key);
        }
    }
}

const pruneTimer = setInterval(pruneStores, OTP_PRUNE_INTERVAL_MS);
if (typeof pruneTimer.unref === 'function') {
    pruneTimer.unref();
}

function normalizeKey(identifier) {
    return String(identifier || '').trim().toLowerCase();
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function saveOTP(identifier, otp) {
    otpStore.set(normalizeKey(identifier), {
        code: String(otp || ''),
        expiresAt: Date.now() + OTP_TTL_MS
    });
}

function verifyOTP(identifier, otp) {
    const key = normalizeKey(identifier);
    const record = otpStore.get(key);

    if (!record) {
        return { success: false, message: 'No OTP found' };
    }

    if (Date.now() > record.expiresAt) {
        otpStore.delete(key);
        return { success: false, message: 'OTP expired' };
    }

    if (record.code !== String(otp || '')) {
        return { success: false, message: 'Invalid OTP' };
    }

    otpStore.delete(key);
    return { success: true };
}

function issueResetToken(identifier) {
    const key = normalizeKey(identifier);
    const resetToken = crypto.randomBytes(24).toString('hex');
    resetTokenStore.set(key, {
        token: resetToken,
        expiresAt: Date.now() + RESET_TOKEN_TTL_MS
    });
    return resetToken;
}

function verifyResetToken(identifier, resetToken) {
    const key = normalizeKey(identifier);
    const record = resetTokenStore.get(key);

    if (!record) {
        return false;
    }

    if (Date.now() > record.expiresAt) {
        resetTokenStore.delete(key);
        return false;
    }

    if (record.token !== String(resetToken || '').trim()) {
        return false;
    }

    resetTokenStore.delete(key);
    return true;
}

module.exports = {
    generateOTP,
    issueResetToken,
    saveOTP,
    verifyOTP,
    verifyResetToken
};
