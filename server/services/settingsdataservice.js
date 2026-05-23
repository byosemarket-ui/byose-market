const { getRepositoryBundle } = require('../repositories');

const SETTINGS_KEY = 'global';

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.settings) {
        throw new Error('Settings data service requires the SQLite repository bundle.');
    }

    return repositories;
}

async function getSettings() {
    return getRepos().settings.findByKey(SETTINGS_KEY);
}

async function updateSettings(payload) {
    return getRepos().settings.upsert(SETTINGS_KEY, payload);
}

module.exports = {
    getSettings,
    updateSettings
};