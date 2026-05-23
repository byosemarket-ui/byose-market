const fs = require('fs');
const path = require('path');

function ensureMigrationsTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

function getMigrationFiles(migrationsDir) {
    if (!fs.existsSync(migrationsDir)) {
        return [];
    }

    return fs.readdirSync(migrationsDir)
        .filter((entry) => entry.toLowerCase().endsWith('.sql'))
        .sort((left, right) => left.localeCompare(right));
}

function applyMigrations(db, migrationsDir) {
    ensureMigrationsTable(db);

    const applied = new Set(
        db.prepare('SELECT name FROM schema_migrations ORDER BY name ASC').all().map((row) => row.name)
    );

    for (const fileName of getMigrationFiles(migrationsDir)) {
        if (applied.has(fileName)) {
            continue;
        }

        const migrationPath = path.resolve(migrationsDir, fileName);
        const sql = fs.readFileSync(migrationPath, 'utf8');
        const transaction = db.transaction(() => {
            db.exec(sql);
            db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(fileName);
        });
        transaction();
    }

    return db.prepare('SELECT name, applied_at FROM schema_migrations ORDER BY id ASC').all();
}

module.exports = {
    applyMigrations
};