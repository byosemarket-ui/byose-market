const config = require('../config/env');
const mongoProvider = require('./providers/mongo.provider');
const sqliteProvider = require('./providers/sqlite.provider');

const providers = {
    mongo: mongoProvider,
    sqlite: sqliteProvider
};

function getProviderName() {
    return providers[config.databaseClient] ? config.databaseClient : 'mongo';
}

function getProvider() {
    return providers[getProviderName()];
}

async function connectDatabase() {
    return getProvider().connect();
}

async function closeDatabase() {
    return getProvider().close();
}

function getDatabaseStatus() {
    return getProvider().getStatus();
}

function isDatabaseReady() {
    return Boolean(getProvider().isReady());
}

module.exports = {
    closeDatabase,
    connectDatabase,
    getConfiguredProvider: getProviderName,
    getDatabaseStatus,
    isDatabaseReady
};