const SQLiteBaseRepository = require('./base.repository');
const categoryRepository = require('./category.repository');
const { buildPublicUrlFromPath, normalizeManagedPath } = require('../../services/uploadstorage.service');


class SQLiteProductRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'products' });
    }

    resolveStoragePath(value) {
        return normalizeManagedPath(value) || '';
    }

    resolvePublicPath(value) {
        const storagePath = this.resolveStoragePath(value);
        if (storagePath) {
            return buildPublicUrlFromPath(storagePath);
        }

        return this.normalizeText(value);
    }

    prepareStorablePath(value) {
        const storagePath = this.resolveStoragePath(value);
        return storagePath || this.normalizeText(value);
    }

    mapRow(row, images = []) {
        if (!row) {
            return null;
        }

        const rawImage = row.image || row.main_image;

                const rawMainImage = row.main_image || row.image;
                const imageStoragePath = this.resolveStoragePath(rawImage);
                const mainImageStoragePath = this.resolveStoragePath(rawMainImage) || imageStoragePath;
                const image = imageStoragePath ? buildPublicUrlFromPath(imageStoragePath) : this.normalizeText(rawImage);
                const mainImage = mainImageStoragePath ? buildPublicUrlFromPath(mainImageStoragePath) : this.normalizeText(rawMainImage);

                const galleryEntries = Array.isArray(images) ? images : [];
                const galleryPublic = [];
                const galleryStoragePaths = [];

                galleryEntries.forEach((entry) => {
                    const storagePath = this.resolveStoragePath(entry.image_url);
                    const publicPath = storagePath ? buildPublicUrlFromPath(storagePath) : this.normalizeText(entry.image_url);
                    if (publicPath && !galleryPublic.includes(publicPath)) {
                        galleryPublic.push(publicPath);
                        galleryStoragePaths.push(storagePath || this.resolveStoragePath(publicPath));
                    }
                });

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
                        image,
            imageStoragePath,
            mainImage,
            mainImageStoragePath,
            gallery: galleryPublic,
            galleryStoragePaths,

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
        // Ensure a simple sequence table exists and use it to atomically allocate catalog ids.
        try {
            this.db.prepare(`
                CREATE TABLE IF NOT EXISTS catalog_sequences (
                    name TEXT PRIMARY KEY,
                    last INTEGER NOT NULL
                )
            `).run();
        } catch (_err) {
            // ignore creation errors; fallback to MAX() approach below
        }

        try {
            const allocTxn = this.db.transaction(() => {
                const row = this.db.prepare('SELECT last FROM catalog_sequences WHERE name = ?').get('products');
                if (!row) {
                    // initialize sequence using current max catalog_id to avoid collisions with existing rows
                    const maxRow = this.db.prepare('SELECT MAX(catalog_id) AS maxCatalogId FROM products').get();
                    const start = this.toNumber(maxRow?.maxCatalogId, 0) + 1;
                    this.db.prepare('INSERT OR REPLACE INTO catalog_sequences (name, last) VALUES (?, ?)').run('products', start);
                    return start;
                }

                const next = Number(row.last) + 1;
                this.db.prepare('UPDATE catalog_sequences SET last = ? WHERE name = ?').run(next, 'products');
                return next;
            });

            const nextVal = allocTxn();
            return this.toNumber(nextVal, 0);
        } catch (err) {
            // On any failure, fallback to the previous MAX() calculation as a best-effort.
            const fallback = this.db.prepare('SELECT MAX(catalog_id) AS maxCatalogId FROM products').get();
            return this.toNumber(fallback?.maxCatalogId, 0) + 1;
        }
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
        const mainImageStorage = this.prepareStorablePath(mainImage);
        const uniqueGallery = Array.from(new Set((Array.isArray(gallery) ? gallery : []).map((entry) => this.prepareStorablePath(entry)).filter(Boolean)));
        uniqueGallery.forEach((storedPath, index) => {
            insert.run(Number(productId), storedPath, storedPath === mainImageStorage ? 'main' : 'gallery', index);
        });
    }

    async save(product, options = {}) {
        const existing = options.identifier ? await this.findByIdentifier(options.identifier) : null;

        const category = await categoryRepository.ensureBySlug(product.category, { name: product.category });
        const now = this.now(product.updatedAt);
        const imageStoragePath = this.prepareStorablePath(product.image || product.mainImage);
        const mainImageStoragePath = this.prepareStorablePath(product.mainImage || product.image) || imageStoragePath;
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
            image: imageStoragePath,
            mainImage: mainImageStoragePath,

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

        try {
            // If updating an existing record, do a normal update inside a transaction.
            if (existing) {
                const updateTxn = this.db.transaction(() => {
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
                });

                const recordId = updateTxn();
                return this.findByIdentifier(recordId);
            }

            // Insert new record with retry logic to avoid rare catalog_id UNIQUE races.
            let lastError = null;
            let lastInsertId = null;
            const maxAttempts = 3;
            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
                try {
                    // Ensure we have a catalog id at insertion time.
                    if (!payload.catalogId || Number(payload.catalogId) <= 0) {
                        payload.catalogId = await this.getNextCatalogId();
                    }

                    const insertTxn = this.db.transaction(() => {
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

                    lastInsertId = insertTxn();
                    lastError = null;
                    break;
                } catch (err) {
                    lastError = err;
                    // Log the error for diagnostics
                    try {
                        const logger = require('../../utils/logger').appLogger;
                        logger.error('database.product_insert_failed', { error: String(err?.message || err), attempt });
                    } catch (_e) {
                        // ignore logging failures
                    }

                    // If UNIQUE constraint on catalog_id, try again with a fresh id.
                    if (err && /unique/i.test(String(err.message || '')) && attempt < maxAttempts - 1) {
                        // try again after recalculating next catalog id
                        payload.catalogId = await this.getNextCatalogId();
                        continue;
                    }

                    // Otherwise rethrow
                    throw err;
                }
            }

            if (lastError) {
                throw lastError;
            }

            return this.findByIdentifier(payload.catalogId || lastInsertId);
        } catch (outerError) {
            // Bubble up for controller to handle, but log for diagnostics
            try {
                const logger = require('../../utils/logger').appLogger;
                logger.error('database.product_save_failed', { error: outerError });
            } catch (_e) {
                // ignore
            }
            throw outerError;
        }
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