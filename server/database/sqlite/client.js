const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../../config/env');

let database = null;

function ensureDirectory(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function initializeClient() {
    if (database) {
        return database;
    }

    ensureDirectory(config.sqlite.databasePath);
    database = new Database(config.sqlite.databasePath);
    database.pragma('foreign_keys = ON');
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = NORMAL');
    database.pragma('temp_store = MEMORY');
    database.pragma('busy_timeout = 5000');

    return database;
}

function getClient() {
    if (!database) {
        throw new Error('SQLite client has not been initialized.');
    }

    return database;
}

function closeClient() {
    if (database) {
        database.close();
        database = null;
    }
}

module.exports = {
    closeClient,
    getClient,
    initializeClient
};