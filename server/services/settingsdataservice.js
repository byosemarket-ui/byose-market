const { getRepositoryBundle } = require('../repositories');
const { queryCache } = require('./querycache.service');

const SETTINGS_KEY = 'global';
const SETTINGS_TTL_MS = 60000;

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.settings) {
        throw new Error('Settings data service requires the SQLite repository bundle.');
    }

    return repositories;
}

async function getSettings() {
    return queryCache.remember(`settings:${SETTINGS_KEY}`, SETTINGS_TTL_MS, () => (
        getRepos().settings.findByKey(SETTINGS_KEY)
    ));
}

async function updateSettings(payload) {
    const saved = await getRepos().settings.upsert(SETTINGS_KEY, payload);
    queryCache.bump('settings');
    return saved;
}

module.exports = {
    getSettings,
    updateSettings
};
