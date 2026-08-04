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

    // Concurrency + durability tuned for a storefront read-heavy SQLite workload.
    database.pragma('foreign_keys = ON');
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = NORMAL');
    database.pragma('temp_store = MEMORY');
    database.pragma('busy_timeout = 5000');
    database.pragma('cache_size = -65536'); // ~64MB page cache
    database.pragma('mmap_size = 268435456'); // 256MB mmap when OS allows
    database.pragma('wal_autocheckpoint = 1000');

    try {
        database.pragma('optimize');
    } catch (_error) {
        // Older SQLite builds may not support optimize; ignore.
    }

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
        try {
            database.pragma('optimize');
        } catch (_error) {
            // ignore
        }
        database.close();
        database = null;
    }
}

module.exports = {
    closeClient,
    getClient,
    initializeClient
};
