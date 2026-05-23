const SQLiteBaseRepository = require('./base.repository');

function titleizeSlug(slug) {
    return String(slug || 'general')
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ') || 'General';
}

class SQLiteCategoryRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'categories' });
    }

    mapRow(row) {
        if (!row) {
            return null;
        }

        return {
            id: Number(row.id),
            slug: String(row.slug || '').trim(),
            name: String(row.name || '').trim(),
            description: String(row.description || '').trim(),
            image: String(row.image || '').trim(),
            status: String(row.status || 'active').trim(),
            sortOrder: Number(row.sort_order || 0) || 0,
            metadata: this.parseJson(row.metadata_json, {}),
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || null
        };
    }

    async ensureBySlug(slug, overrides = {}) {
        const normalizedSlug = this.normalizeText(slug || overrides.slug || 'general', 'general').toLowerCase();
        const existing = this.db.prepare('SELECT * FROM categories WHERE slug = ? LIMIT 1').get(normalizedSlug);
        if (existing) {
            return this.mapRow(existing);
        }

        const now = this.now();
        const name = this.normalizeText(overrides.name, titleizeSlug(normalizedSlug));
        const result = this.db.prepare(`
            INSERT INTO categories (
                slug, name, description, image, status, sort_order, metadata_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            normalizedSlug,
            name,
            this.normalizeText(overrides.description),
            this.normalizeText(overrides.image),
            this.normalizeText(overrides.status, 'active'),
            this.toNumber(overrides.sortOrder, 0),
            this.stringifyJson(overrides.metadata || {}, {}),
            now,
            now
        );

        return this.findById(result.lastInsertRowid);
    }

    async findById(id) {
        return this.mapRow(this.db.prepare('SELECT * FROM categories WHERE id = ? LIMIT 1').get(Number(id)));
    }

    async findBySlug(slug) {
        return this.mapRow(this.db.prepare('SELECT * FROM categories WHERE slug = ? LIMIT 1').get(this.normalizeText(slug).toLowerCase()));
    }

    async list() {
        return this.db.prepare('SELECT * FROM categories ORDER BY sort_order DESC, name ASC').all().map((row) => this.mapRow(row));
    }
}

module.exports = new SQLiteCategoryRepository();