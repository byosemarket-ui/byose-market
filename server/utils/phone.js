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
    normalizeRwandaPhone,
    rwandaPhoneVariants
};
