const { getRepositoryBundle } = require('../repositories');

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.users) {
        throw new Error('User data service requires the SQLite repository bundle.');
    }

    return repositories;
}

async function getNextUserId() {
    return getRepos().users.getNextPublicId();
}

async function createUser(user) {
    return getRepos().users.create(user);
}

async function findUserById(id) {
    return getRepos().users.findByPublicId(id);
}

async function findUserByIdentifier(identifier, options) {
    return getRepos().users.findByIdentifier(identifier, options);
}

async function listCustomers(options = {}) {
    return getRepos().users.list({
        includeAdmins: false,
        query: options.query || '',
        status: options.status || ''
    });
}

async function recordSuccessfulLogin(id) {
    return getRepos().users.recordSuccessfulLogin(id);
}

async function recordFailedLogin(id) {
    return getRepos().users.recordFailedLogin(id);
}

async function updateUser(id, updates) {
    return getRepos().users.update(id, updates);
}

async function deleteUser(id) {
    return getRepos().users.delete(id);
}

async function emailExists(email, excludeId) {
    return getRepos().users.existsByEmail(email, excludeId);
}

async function phoneExists(phone, excludeId) {
    return getRepos().users.existsByPhone(phone, excludeId);
}

async function upsertAdminUser(payload) {
    return getRepos().users.upsertAdminUser(payload);
}

module.exports = {
    createUser,
    deleteUser,
    emailExists,
    findUserById,
    findUserByIdentifier,
    getNextUserId,
    listCustomers,
    phoneExists,
    recordFailedLogin,
    recordSuccessfulLogin,
    updateUser,
    upsertAdminUser
};