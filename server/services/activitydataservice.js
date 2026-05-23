const { getRepositoryBundle } = require('../repositories');

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.activity) {
        throw new Error('Activity data service requires the SQLite repository bundle.');
    }

    return repositories;
}

async function recordActivity(payload) {
    return payload.clientActivityId
        ? getRepos().activity.upsertByClientActivity(payload)
        : getRepos().activity.create(payload);
}

async function updateActivity(clientActivityId, payload) {
    return getRepos().activity.updateByClientActivityId(clientActivityId, payload);
}

async function findActivity(clientActivityId) {
    return getRepos().activity.findByClientActivityId(clientActivityId);
}

async function listActivity(options) {
    return getRepos().activity.list(options);
}

module.exports = {
    findActivity,
    listActivity,
    recordActivity,
    updateActivity
};