function createApiResponse({ success = true, message = '', data = null } = {}) {
    return {
        success,
        message,
        data
    };
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function getJwtSecret() {
    const jwtSecret = String(process.env.JWT_SECRET || '').trim();

    if (!jwtSecret) {
        throw new Error('JWT_SECRET is not configured');
    }

    return jwtSecret;
}

function sanitizeAdmin(admin) {
    if (!admin) {
        return null;
    }

    return {
        id: String(admin._id || ''),
        email: normalizeEmail(admin.email),
        createdAt: admin.createdAt,
        updatedAt: admin.updatedAt
    };
}

module.exports = {
    createApiResponse,
    normalizeEmail,
    getJwtSecret,
    sanitizeAdmin
};