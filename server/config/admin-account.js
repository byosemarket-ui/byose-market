const ADMIN_ACCOUNT = {
    id: 'BMADMIN001',
    name: 'Byose Market Admin',
    email: 'byosemarket@gmail.com',
    passwordHash: '$2a$10$556SqQJtkKET4kEi279iwuJFTjdm/ejzQ9pROfE4pIuud4.7tfIXK',
    role: 'admin'
};

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function isConfiguredAdminRecord(user) {
    return Boolean(
        user
        && String(user.id || '').trim() === ADMIN_ACCOUNT.id
        && normalizeEmail(user.email) === normalizeEmail(ADMIN_ACCOUNT.email)
        && String(user.role || '').trim().toLowerCase() === ADMIN_ACCOUNT.role
    );
}

module.exports = {
    ADMIN_ACCOUNT,
    normalizeEmail,
    isConfiguredAdminRecord
};