const SQLiteBaseRepository = require('./base.repository');
const categoryRepository = require('./category.repository');

class SQLiteProductRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'products' });
    }

    mapRow(row, images = []) {
        if (!row) {
            return null;
        }

        const gallery = Array.isArray(images) && images.length
            ? images.map((entry) => this.normalizeText(entry.image_url)).filter(Boolean)
            : [];

        return {
            recordId: Number(row.id),
            catalogId: Number(row.catalog_id || 0),
            name: this.normalizeText(row.name),
            title: this.normalizeText(row.title || row.name),
            description: this.normalizeText(row.description),
            shortDescription: this.normalizeText(row.short_description),
            longDescription: this.parseJson(row.long_description_json, []),
            badge: this.normalizeText(row.badge),
            category: this.normalizeText(row.category_slug, 'general'),
            price: this.toNumber(row.price, 0),
            oldPrice: this.toNumber(row.old_price, 0),
            stock: this.toNumber(row.stock, 0),
            image: this.normalizeText(row.image || row.main_image),
            mainImage: this.normalizeText(row.main_image || row.image),
            gallery,
            keywords: this.parseJson(row.keywords_json, []),
            highlights: this.parseJson(row.highlights_json, []),
            trust: this.parseJson(row.trust_json, []),
            specs: this.parseJson(row.specs_json, []),
            attributes: this.parseJson(row.attributes_json, []),
            variants: this.parseJson(row.variants_json, {}),
            visibility: this.normalizeText(row.visibility, 'both'),
            priority: this.toNumber(row.priority, 0),
            orderIndex: this.toNumber(row.order_index, 0),
            highlightTag: this.normalizeText(row.highlight_tag),
            status: this.normalizeText(row.status, 'active'),
            page: this.normalizeText(row.page, 'product-details1.html'),
            url: this.normalizeText(row.url),
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || null
        };
    }

    loadImagesForProductIds(productIds) {
        if (!Array.isArray(productIds) || !productIds.length) {
            return new Map();
        }

        const placeholders = productIds.map(() => '?').join(', ');
        const rows = this.db.prepare(`SELECT * FROM product_images WHERE product_id IN (${placeholders}) ORDER BY sort_order ASC, id ASC`).all(...productIds);
        return rows.reduce((lookup, row) => {
            const key = Number(row.product_id);
            const current = lookup.get(key) || [];
            current.push(row);
            lookup.set(key, current);
            return lookup;
        }, new Map());
    }

    async getNextCatalogId() {
        const row = this.db.prepare('SELECT MAX(catalog_id) AS maxCatalogId FROM products').get();
        return this.toNumber(row?.maxCatalogId, 0) + 1;
    }

    async list({ category = '', limit = 200, offset = 0 } = {}) {
        const normalizedCategory = this.normalizeText(category).toLowerCase();
        const rows = normalizedCategory
            ? this.db.prepare(`
                SELECT * FROM products
                WHERE category_slug = ?
                ORDER BY priority DESC, order_index DESC, updated_at DESC, catalog_id ASC
                LIMIT ? OFFSET ?
            `).all(normalizedCategory, Math.max(1, Number(limit) || 200), Math.max(0, Number(offset) || 0))
            : this.db.prepare(`
                SELECT * FROM products
                ORDER BY priority DESC, order_index DESC, updated_at DESC, catalog_id ASC
                LIMIT ? OFFSET ?
            `).all(Math.max(1, Number(limit) || 200), Math.max(0, Number(offset) || 0));

        const imageLookup = this.loadImagesForProductIds(rows.map((row) => Number(row.id)));
        return rows.map((row) => this.mapRow(row, imageLookup.get(Number(row.id)) || []));
    }

    async listAll() {
        return this.list({ limit: 10000, offset: 0 });
    }

    async findByIdentifier(identifier) {
        const numericIdentifier = Number(identifier);
        let row = null;

        if (Number.isFinite(numericIdentifier) && numericIdentifier > 0) {
            row = this.db.prepare('SELECT * FROM products WHERE catalog_id = ? LIMIT 1').get(numericIdentifier);
        }

        if (!row) {
            row = this.db.prepare('SELECT * FROM products WHERE id = ? LIMIT 1').get(Number(identifier) || 0);
        }

        if (!row) {
            return null;
        }

        const images = this.db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC').all(Number(row.id));
        return this.mapRow(row, images);
    }

    persistImages(productId, gallery, mainImage) {
        this.db.prepare('DELETE FROM product_images WHERE product_id = ?').run(Number(productId));
        const insert = this.db.prepare('INSERT INTO product_images (product_id, image_url, kind, sort_order) VALUES (?, ?, ?, ?)');
        const uniqueGallery = Array.from(new Set((Array.isArray(gallery) ? gallery : []).map((entry) => this.normalizeText(entry)).filter(Boolean)));
        uniqueGallery.forEach((imageUrl, index) => {
            insert.run(Number(productId), imageUrl, imageUrl === mainImage ? 'main' : 'gallery', index);
        });
    }

    async save(product, options = {}) {
        const existing = options.identifier ? await this.findByIdentifier(options.identifier) : null;
        const category = await categoryRepository.ensureBySlug(product.category, { name: product.category });
        const now = this.now(product.updatedAt);
        const payload = {
            catalogId: Number(product.catalogId),
            categoryId: category ? Number(category.id) : null,
            categorySlug: this.normalizeText(product.category, 'general').toLowerCase(),
            name: this.normalizeText(product.name),
            title: this.normalizeText(product.title || product.name),
            description: this.normalizeText(product.description),
            shortDescription: this.normalizeText(product.shortDescription),
            longDescriptionJson: this.stringifyJson(product.longDescription || [], []),
            badge: this.normalizeText(product.badge),
            price: this.toNumber(product.price, 0),
            oldPrice: this.toNumber(product.oldPrice, 0),
            stock: this.toNumber(product.stock, 0),
            image: this.normalizeText(product.image || product.mainImage),
            mainImage: this.normalizeText(product.mainImage || product.image),
            keywordsJson: this.stringifyJson(product.keywords || [], []),
            highlightsJson: this.stringifyJson(product.highlights || [], []),
            trustJson: this.stringifyJson(product.trust || [], []),
            specsJson: this.stringifyJson(product.specs || [], []),
            attributesJson: this.stringifyJson(product.attributes || [], []),
            variantsJson: this.stringifyJson(product.variants || {}, {}),
            visibility: this.normalizeText(product.visibility, 'both'),
            priority: this.toNumber(product.priority, 0),
            orderIndex: this.toNumber(product.orderIndex, 0),
            highlightTag: this.normalizeText(product.highlightTag),
            status: this.normalizeText(product.status, 'active'),
            page: this.normalizeText(product.page, 'product-details1.html'),
            url: this.normalizeText(product.url),
            updatedAt: now,
            createdAt: existing?.createdAt || this.now(product.createdAt)
        };

        const transaction = this.db.transaction(() => {
            if (existing) {
                this.db.prepare(`
                    UPDATE products
                    SET catalog_id = ?, category_id = ?, category_slug = ?, name = ?, title = ?, description = ?, short_description = ?, long_description_json = ?,
                        badge = ?, price = ?, old_price = ?, stock = ?, image = ?, main_image = ?, keywords_json = ?, highlights_json = ?, trust_json = ?,
                        specs_json = ?, attributes_json = ?, variants_json = ?, visibility = ?, priority = ?, order_index = ?, highlight_tag = ?, status = ?, page = ?, url = ?, updated_at = ?
                    WHERE id = ?
                `).run(
                    payload.catalogId,
                    payload.categoryId,
                    payload.categorySlug,
                    payload.name,
                    payload.title,
                    payload.description,
                    payload.shortDescription,
                    payload.longDescriptionJson,
                    payload.badge,
                    payload.price,
                    payload.oldPrice,
                    payload.stock,
                    payload.image,
                    payload.mainImage,
                    payload.keywordsJson,
                    payload.highlightsJson,
                    payload.trustJson,
                    payload.specsJson,
                    payload.attributesJson,
                    payload.variantsJson,
                    payload.visibility,
                    payload.priority,
                    payload.orderIndex,
                    payload.highlightTag,
                    payload.status,
                    payload.page,
                    payload.url,
                    payload.updatedAt,
                    Number(existing.recordId)
                );
                this.persistImages(existing.recordId, product.gallery || [], payload.mainImage);
                return Number(existing.recordId);
            }

            const result = this.db.prepare(`
                INSERT INTO products (
                    catalog_id, category_id, category_slug, name, title, description, short_description, long_description_json, badge,
                    price, old_price, stock, image, main_image, keywords_json, highlights_json, trust_json, specs_json, attributes_json,
                    variants_json, visibility, priority, order_index, highlight_tag, status, page, url, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                payload.catalogId,
                payload.categoryId,
                payload.categorySlug,
                payload.name,
                payload.title,
                payload.description,
                payload.shortDescription,
                payload.longDescriptionJson,
                payload.badge,
                payload.price,
                payload.oldPrice,
                payload.stock,
                payload.image,
                payload.mainImage,
                payload.keywordsJson,
                payload.highlightsJson,
                payload.trustJson,
                payload.specsJson,
                payload.attributesJson,
                payload.variantsJson,
                payload.visibility,
                payload.priority,
                payload.orderIndex,
                payload.highlightTag,
                payload.status,
                payload.page,
                payload.url,
                payload.createdAt,
                payload.updatedAt
            );
            this.persistImages(result.lastInsertRowid, product.gallery || [], payload.mainImage);
            return Number(result.lastInsertRowid);
        });

        const recordId = transaction();
        return this.findByIdentifier(existing ? existing.catalogId : payload.catalogId || recordId);
    }

    async upsertMany(products) {
        const saved = [];
        for (const product of products) {
            saved.push(await this.save(product, { identifier: product.catalogId }));
        }
        return saved;
    }

    async remove(identifier) {
        const existing = await this.findByIdentifier(identifier);
        if (!existing) {
            return null;
        }

        this.db.prepare('DELETE FROM products WHERE id = ?').run(Number(existing.recordId));
        return existing;
    }
}

module.exports = new SQLiteProductRepository();