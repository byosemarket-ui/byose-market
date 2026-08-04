const config = require('../../config/env');
const { initializeClient, closeClient } = require('../sqlite/client');
const { applyMigrations } = require('../sqlite/migrate');
const { appLogger } = require('../../utils/logger');

let initialized = false;
let lastError = null;
let migrations = [];

async function connect() {
    if (!config.sqlite.enabled) {
        initialized = false;
        lastError = new Error('SQLite is disabled (SQLITE_ENABLED=false) while DB_CLIENT=sqlite');
        migrations = [];
        throw lastError;
    }

    try {
        const db = initializeClient();
        migrations = applyMigrations(db, config.sqlite.migrationsDir);
        initialized = true;
        lastError = null;

        appLogger.info('database.sqlite.connected', {
            databasePath: config.sqlite.databasePath,
            migrationsDir: config.sqlite.migrationsDir,
            migrationCount: migrations.length
        });

        return true;
    } catch (error) {
        initialized = false;
        lastError = error;
        appLogger.error('database.sqlite.connection_failed', {
            databasePath: config.sqlite.databasePath,
            migrationsDir: config.sqlite.migrationsDir,
            error
        });
        throw error;
    }
}

function getStatus() {
    return {
        provider: 'sqlite',
        configuredProvider: config.databaseClient,
        ready: initialized,
        initialized,
        enabled: config.sqlite.enabled,
        databasePath: config.sqlite.databasePath,
        migrationsDir: config.sqlite.migrationsDir,
        migrations,
        lastError: lastError ? lastError.message : null
    };
}

async function close() {
    closeClient();
    initialized = false;
    migrations = [];
}

module.exports = {
    close,
    connect,
    getStatus,
    isReady: () => initialized
};