/**
 * Canonical Rwanda phone helpers for auth + order matching.
 * Always prefer E.164 (+2507XXXXXXXX) for storage and comparisons.
 */

function digitsOnly(value) {
    return String(value || '').replace(/\D/g, '');
}

function normalizeRwandaPhone(value) {
    const digits = digitsOnly(value);
    if (!digits) {
        return '';
    }

    if (digits.startsWith('250') && digits.length === 12) {
        return `+${digits}`;
    }

    if (digits.startsWith('0') && digits.length === 10) {
        return `+250${digits.slice(1)}`;
    }

    if (digits.length === 9 && digits.startsWith('7')) {
        return `+250${digits}`;
    }

    if (String(value || '').trim().startsWith('+') && digits.length >= 10) {
        return `+${digits}`;
    }

    return '';
}

function isValidRwandaPhone(value) {
    return /^\+250\d{9}$/.test(normalizeRwandaPhone(value));
}

function parseWithLibphonenumber(value) {
    try {
        const lib = require('google-libphonenumber');
        const phoneUtil = lib.PhoneNumberUtil.getInstance();
        const parsed = phoneUtil.parseAndKeepRawInput(String(value || '').trim(), 'RW');
        if (!phoneUtil.isValidNumber(parsed)) {
            return '';
        }
        return phoneUtil.format(parsed, lib.PhoneNumberFormat.E164);
    } catch (_error) {
        return '';
    }
}

/**
 * Normalize an admin notification phone to E.164.
 * Rwanda numbers (07..., 7..., +250...) stay on +250.
 * Other valid international numbers are kept in E.164 without inventing a country.
 * Returns '' when the input cannot be validated — callers must reject, not guess.
 */
function normalizeNotificationPhone(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return '';

    const rwanda = normalizeRwandaPhone(raw);
    if (isValidRwandaPhone(rwanda)) {
        return rwanda;
    }

    const parsed = parseWithLibphonenumber(raw);
    if (parsed && /^\+[1-9]\d{7,14}$/.test(parsed)) {
        return parsed;
    }

    return '';
}

function isValidNotificationPhone(value) {
    return Boolean(normalizeNotificationPhone(value));
}

function maskPhoneNumber(value) {
    const phone = String(value == null ? '' : value).trim();
    if (!phone) return '';
    const digits = phone.replace(/[^\d+]/g, '');
    if (digits.length < 6) return '***';
    return `${digits.slice(0, 5)}***${digits.slice(-2)}`;
}

function rwandaPhoneVariants(value) {
    const normalized = normalizeRwandaPhone(value);
    if (!normalized) {
        const fallback = String(value || '').replace(/\s+/g, '').trim();
        return fallback ? [fallback] : [];
    }

    const bare = normalized.slice(1); // 2507...
    const national = `0${normalized.slice(4)}`; // 07...
    const localNine = normalized.slice(4); // 7...
    return Array.from(new Set([
        normalized,
        bare,
        national,
        localNine,
        String(value || '').replace(/\s+/g, '').trim()
    ].filter(Boolean)));
}

module.exports = {
    digitsOnly,
    isValidRwandaPhone,
    isValidNotificationPhone,
    maskPhoneNumber,
    normalizeNotificationPhone,
    normalizeRwandaPhone,
    rwandaPhoneVariants
};
