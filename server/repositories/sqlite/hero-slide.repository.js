const SQLiteBaseRepository = require('./base.repository');

class SQLiteHeroSlideRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'hero_slides' });
    }

    mapRow(row) {
        if (!row) {
            return null;
        }

        return {
            id: this.normalizeText(row.slide_id),
            slideId: this.normalizeText(row.slide_id),
            recordId: Number(row.id),
            title: this.normalizeText(row.title),
            subtitle: this.normalizeText(row.subtitle),
            buttonText: this.normalizeText(row.button_text),
            buttonLink: this.normalizeText(row.button_link),
            imageUrl: this.normalizeText(row.image_url),
            imagePath: this.normalizeText(row.image_path),
            displayOrder: this.toNumber(row.display_order, 0),
            status: this.normalizeText(row.status, 'active').toLowerCase() === 'inactive' ? 'inactive' : 'active',
            meta: this.parseJson(row.meta_json, {}),
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || row.created_at || null
        };
    }

    async create(payload) {
        const now = this.now(payload.createdAt);
        const slideId = this.normalizeText(payload.slideId) || `hero-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const status = this.normalizeText(payload.status, 'active').toLowerCase() === 'inactive' ? 'inactive' : 'active';

        this.db.prepare(`
            INSERT INTO hero_slides (
                slide_id, title, subtitle, button_text, button_link, image_url, image_path,
                display_order, status, meta_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            slideId,
            this.normalizeText(payload.title),
            this.normalizeText(payload.subtitle),
            this.normalizeText(payload.buttonText),
            this.normalizeText(payload.buttonLink),
            this.normalizeText(payload.imageUrl),
            this.normalizeText(payload.imagePath),
            this.toNumber(payload.displayOrder, 0),
            status,
            this.stringifyJson(payload.meta || {}, {}),
            now,
            this.now(payload.updatedAt || now)
        );

        return this.findBySlideId(slideId);
    }

    async findBySlideId(slideId) {
        return this.mapRow(
            this.db.prepare('SELECT * FROM hero_slides WHERE slide_id = ? LIMIT 1')
                .get(this.normalizeText(slideId))
        );
    }

    async list(options = {}) {
        const limit = Math.min(300, Math.max(1, Number(options.limit || 100) || 100));
        const page = Math.max(1, Number(options.page || 1) || 1);
        const offset = (page - 1) * limit;
        const status = this.normalizeText(options.status).toLowerCase();
        const search = this.normalizeText(options.search);
        const sort = this.normalizeText(options.sort, 'order-asc').toLowerCase();
        const clauses = [];
        const params = [];

        if (status && status !== 'all') {
            clauses.push('status = ?');
            params.push(status === 'inactive' ? 'inactive' : 'active');
        }

        if (search) {
            const like = `%${search}%`;
            clauses.push('(slide_id LIKE ? OR title LIKE ? OR subtitle LIKE ? OR button_text LIKE ? OR button_link LIKE ?)');
            params.push(like, like, like, like, like);
        }

        const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
        const orderBy = sort === 'order-desc'
            ? 'display_order DESC, updated_at DESC'
            : sort === 'newest'
                ? 'created_at DESC, updated_at DESC'
                : sort === 'oldest'
                    ? 'created_at ASC, updated_at ASC'
                    : sort === 'title-asc'
                        ? 'title ASC, display_order ASC'
                        : sort === 'title-desc'
                            ? 'title DESC, display_order ASC'
                            : 'display_order ASC, created_at DESC';

        const rows = this.db.prepare(`
            SELECT * FROM hero_slides
            ${where}
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
        `).all(...params, limit, offset);

        return rows.map((row) => this.mapRow(row));
    }

    async count(options = {}) {
        const status = this.normalizeText(options.status).toLowerCase();
        const search = this.normalizeText(options.search);
        const clauses = [];
        const params = [];

        if (status && status !== 'all') {
            clauses.push('status = ?');
            params.push(status === 'inactive' ? 'inactive' : 'active');
        }

        if (search) {
            const like = `%${search}%`;
            clauses.push('(slide_id LIKE ? OR title LIKE ? OR subtitle LIKE ? OR button_text LIKE ? OR button_link LIKE ?)');
            params.push(like, like, like, like, like);
        }

        const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
        const row = this.db.prepare(`SELECT COUNT(*) AS total FROM hero_slides ${where}`).get(...params);
        return Number(row?.total || 0);
    }

    async update(slideId, updates = {}) {
        const existing = await this.findBySlideId(slideId);
        if (!existing) {
            return null;
        }

        const nextStatus = Object.prototype.hasOwnProperty.call(updates, 'status')
            ? (this.normalizeText(updates.status, existing.status).toLowerCase() === 'inactive' ? 'inactive' : 'active')
            : existing.status;

        const next = {
            title: Object.prototype.hasOwnProperty.call(updates, 'title')
                ? this.normalizeText(updates.title)
                : existing.title,
            subtitle: Object.prototype.hasOwnProperty.call(updates, 'subtitle')
                ? this.normalizeText(updates.subtitle)
                : existing.subtitle,
            buttonText: Object.prototype.hasOwnProperty.call(updates, 'buttonText')
                ? this.normalizeText(updates.buttonText)
                : existing.buttonText,
            buttonLink: Object.prototype.hasOwnProperty.call(updates, 'buttonLink')
                ? this.normalizeText(updates.buttonLink)
                : existing.buttonLink,
            imageUrl: Object.prototype.hasOwnProperty.call(updates, 'imageUrl')
                ? this.normalizeText(updates.imageUrl)
                : existing.imageUrl,
            imagePath: Object.prototype.hasOwnProperty.call(updates, 'imagePath')
                ? this.normalizeText(updates.imagePath)
                : existing.imagePath,
            displayOrder: Object.prototype.hasOwnProperty.call(updates, 'displayOrder')
                ? this.toNumber(updates.displayOrder, existing.displayOrder)
                : existing.displayOrder,
            status: nextStatus,
            meta: Object.prototype.hasOwnProperty.call(updates, 'meta')
                ? (updates.meta && typeof updates.meta === 'object' ? updates.meta : existing.meta)
                : existing.meta
        };

        this.db.prepare(`
            UPDATE hero_slides
            SET title = ?, subtitle = ?, button_text = ?, button_link = ?, image_url = ?, image_path = ?,
                display_order = ?, status = ?, meta_json = ?, updated_at = ?
            WHERE slide_id = ?
        `).run(
            next.title,
            next.subtitle,
            next.buttonText,
            next.buttonLink,
            next.imageUrl,
            next.imagePath,
            next.displayOrder,
            next.status,
            this.stringifyJson(next.meta || {}, {}),
            this.now(),
            this.normalizeText(slideId)
        );

        return this.findBySlideId(slideId);
    }

    async deleteBySlideId(slideId) {
        const existing = await this.findBySlideId(slideId);
        if (!existing) {
            return null;
        }

        this.db.prepare('DELETE FROM hero_slides WHERE slide_id = ?').run(this.normalizeText(slideId));
        return existing;
    }

    async findByDisplayOrder(displayOrder, excludeSlideId = "") {
        const order = this.toNumber(displayOrder, NaN);
        if (!Number.isFinite(order)) {
            return null;
        }

        const excluded = this.normalizeText(excludeSlideId);
        if (excluded) {
            return this.mapRow(
                this.db.prepare(`
                    SELECT * FROM hero_slides
                    WHERE display_order = ? AND slide_id != ?
                    LIMIT 1
                `).get(order, excluded)
            );
        }

        return this.mapRow(
            this.db.prepare(`
                SELECT * FROM hero_slides
                WHERE display_order = ?
                LIMIT 1
            `).get(order)
        );
    }

    async nextDisplayOrder() {
        const row = this.db.prepare('SELECT MAX(display_order) AS max_order FROM hero_slides').get();
        return this.toNumber(row?.max_order, -1) + 1;
    }

    async countByImageReference(imagePath, excludeSlideId = '') {
        const normalized = this.normalizeText(imagePath).replace(/^\/uploads\//, '');
        if (!normalized) {
            return 0;
        }

        const publicUrl = `/uploads/${normalized.replace(/^\/+/, '')}`;
        const excluded = this.normalizeText(excludeSlideId);
        if (excluded) {
            const row = this.db.prepare(`
                SELECT COUNT(*) AS total
                FROM hero_slides
                WHERE slide_id != ?
                  AND (
                    image_path = ?
                    OR image_path = ?
                    OR image_url = ?
                    OR image_url LIKE ?
                  )
            `).get(
                excluded,
                normalized,
                `/${normalized}`,
                publicUrl,
                `%/${normalized}`
            );
            return Number(row?.total || 0);
        }

        const row = this.db.prepare(`
            SELECT COUNT(*) AS total
            FROM hero_slides
            WHERE image_path = ?
               OR image_path = ?
               OR image_url = ?
               OR image_url LIKE ?
        `).get(
            normalized,
            `/${normalized}`,
            publicUrl,
            `%/${normalized}`
        );
        return Number(row?.total || 0);
    }

    async swapDisplayOrders(slideIdA, slideIdB) {
        const left = await this.findBySlideId(slideIdA);
        const right = await this.findBySlideId(slideIdB);
        if (!left || !right) {
            return null;
        }

        const orderA = this.toNumber(left.displayOrder, 0);
        const orderB = this.toNumber(right.displayOrder, 0);
        const tempOrder = -1 - Math.abs(Date.now() % 100000000);

        const updateOrder = this.db.prepare(`
            UPDATE hero_slides
            SET display_order = ?, updated_at = ?
            WHERE slide_id = ?
        `);

        const applySwap = this.db.transaction(() => {
            updateOrder.run(tempOrder, this.now(), left.slideId);
            updateOrder.run(orderA, this.now(), right.slideId);
            updateOrder.run(orderB === orderA ? orderA + 1 : orderB, this.now(), left.slideId);
        });
        applySwap();

        return {
            left: await this.findBySlideId(slideIdA),
            right: await this.findBySlideId(slideIdB)
        };
    }
}

module.exports = new SQLiteHeroSlideRepository();
