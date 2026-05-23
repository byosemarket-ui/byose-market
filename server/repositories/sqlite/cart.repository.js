const SQLiteBaseRepository = require('./base.repository');

class SQLiteCartRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'carts' });
    }

    mapRow(row) {
        if (!row) {
            return null;
        }

        return {
            id: Number(row.id),
            userId: Number(row.user_id),
            items: this.parseJson(row.items_json, []),
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || null
        };
    }

    async findByUserId(userId) {
        return this.mapRow(this.db.prepare('SELECT * FROM carts WHERE user_id = ? LIMIT 1').get(Number(userId)));
    }

    async saveForUser(userId, items) {
        const existing = await this.findByUserId(userId);
        const now = this.now();
        const itemsJson = this.stringifyJson(Array.isArray(items) ? items : [], []);

        if (existing) {
            this.db.prepare('UPDATE carts SET items_json = ?, updated_at = ? WHERE user_id = ?').run(itemsJson, now, Number(userId));
        } else {
            this.db.prepare('INSERT INTO carts (user_id, items_json, created_at, updated_at) VALUES (?, ?, ?, ?)').run(Number(userId), itemsJson, now, now);
        }

        return this.findByUserId(userId);
    }

    async clearForUser(userId) {
        return this.saveForUser(userId, []);
    }

    async listAll() {
        return this.db.prepare('SELECT * FROM carts ORDER BY updated_at DESC, created_at DESC').all().map((row) => this.mapRow(row));
    }
}

module.exports = new SQLiteCartRepository();