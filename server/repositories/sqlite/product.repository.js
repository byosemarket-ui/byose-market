const SQLiteBaseRepository = require('./base.repository');
const categoryRepository = require('./category.repository');
const { buildPublicUrlFromPath, normalizeManagedPath, isProductCardImagePath, resolveCanonicalImageValue } = require('../../services/uploadstorage.service');
const { queryCache } = require('../../services/querycache.service');

const PRODUCT_SELECT_COLUMNS = `
    id, catalog_id, category_id, category_slug, name, title, description, short_description,
    long_description_json, badge, price, old_price, stock, image, main_image, keywords_json,
    highlights_json, trust_json, specs_json, attributes_json, variants_json, visibility,
    priority, order_index, highlight_tag, status, page, url, metadata_json, created_at, updated_at
`.replace(/\s+/g, ' ').trim();

const PRODUCT_CARD_SELECT_COLUMNS = `
    id, catalog_id, category_slug, name, title, badge, price, old_price, stock, image, main_image,
    visibility, priority, order_index, highlight_tag, status, page, url, metadata_json, created_at, updated_at,
    '' AS description, '' AS short_description, '[]' AS long_description_json, '[]' AS keywords_json,
    '[]' AS highlights_json, '[]' AS trust_json, '[]' AS specs_json, '[]' AS attributes_json,
    '{}' AS variants_json
`.replace(/\s+/g, ' ').trim();

class SQLiteProductRepository extends SQLiteBaseRepository {
    constructor() {
        super({ tableName: 'products' });
        this._hasPublishedColumn = null;
        this._hasFts = null;
    }

    hasPublishedColumn() {
        if (this._hasPublishedColumn === null) {
            try {
                const row = this.db.prepare("PRAGMA table_info(products)").all()
                    .find((entry) => String(entry.name || '') === 'is_published');
                this._hasPublishedColumn = Boolean(row);
            } catch (_error) {
                this._hasPublishedColumn = false;
            }
        }
        return this._hasPublishedColumn;
    }

    hasFtsIndex() {
        if (this._hasFts === null) {
            try {
                const row = this.db.prepare(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'products_fts' LIMIT 1"
                ).get();
                this._hasFts = Boolean(row);
            } catch (_error) {
                this._hasFts = false;
            }
        }
        return this._hasFts;
    }

    computeIsPublished(status, metadata = {}) {
        const normalizedStatus = this.normalizeText(status, 'active').toLowerCase();
        const publishStatus = this.normalizeText(metadata?.publishStatus || normalizedStatus, normalizedStatus).toLowerCase();

        if (['draft', 'archived', 'disabled'].includes(publishStatus) || normalizedStatus === 'draft') {
            return 0;
        }

        if (normalizedStatus === 'inactive') {
            return publishStatus === 'active' ? 1 : 0;
        }

        if (['active', 'published', 'live', ''].includes(normalizedStatus) || publishStatus === 'active') {
            return 1;
        }

        return 0;
    }

    publishedClause() {
        if (this.hasPublishedColumn()) {
            return 'is_published = 1';
        }
        return this.isActiveProductClause();
    }

    selectColumns(mode = 'full') {
        return mode === 'card' ? PRODUCT_CARD_SELECT_COLUMNS : PRODUCT_SELECT_COLUMNS;
    }

    resolveStoragePath(value) {
        return normalizeManagedPath(value) || '';
    }

    resolvePublicPath(value) {
        const storagePath = this.resolveStoragePath(value);
        if (storagePath && /^(?:products|categories|users|reviews|temp)\//i.test(storagePath)) {
            return buildPublicUrlFromPath(storagePath);
        }

        const raw = this.normalizeText(value);
        if (!raw) {
            return '';
        }

        if (raw.startsWith('/uploads/') || /^https?:\/\//i.test(raw)) {
            return raw;
        }

        if (raw.startsWith('img/')) {
            return `/${raw}`;
        }

        if (raw.startsWith('/img/')) {
            return raw;
        }

        return raw;
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

                const galleryEntries = Array.isArray(images) ? images : [];
                const galleryPublic = [];
                const galleryStoragePaths = [];

                galleryEntries.forEach((entry) => {
                    const storagePath = this.resolveStoragePath(entry.image_url);
                    const publicPath = this.resolvePublicPath(entry.image_url);
                    if (publicPath && !galleryPublic.includes(publicPath)) {
                        galleryPublic.push(publicPath);
                        galleryStoragePaths.push(storagePath || this.resolveStoragePath(publicPath));
                    }
                });

                const image = this.resolvePublicPath(rawImage) || galleryPublic[0] || '';
                const mainImage = this.resolvePublicPath(rawMainImage) || image;
                const imageStoragePath = this.resolveStoragePath(rawImage) || this.resolveStoragePath(image);
                const mainImageStoragePath = this.resolveStoragePath(rawMainImage) || imageStoragePath;

        const metadata = this.parseJson(row.metadata_json, {});

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
            metadata,
            brand: this.normalizeText(metadata.brand),
            sku: this.normalizeText(metadata.sku),
            costPrice: this.toNumber(metadata.costPrice, 0),
            taxRate: this.toNumber(metadata.taxRate, 0),
            taxIncluded: Boolean(metadata.taxIncluded),
            metaTitle: this.normalizeText(metadata.metaTitle),
            metaDescription: this.normalizeText(metadata.metaDescription),
            slug: this.normalizeText(metadata.slug),
            tags: Array.isArray(metadata.tags) ? metadata.tags.map((entry) => this.normalizeText(entry)).filter(Boolean) : [],
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || null
        };
    }

    loadImagesForProductIds(productIds) {
        if (!Array.isArray(productIds) || !productIds.length) {
            return new Map();
        }

        const placeholders = productIds.map(() => '?').join(', ');
        const rows = this.db.prepare(`
            SELECT product_id, image_url, sort_order, id
            FROM product_images
            WHERE product_id IN (${placeholders})
            ORDER BY sort_order ASC, id ASC
        `).all(...productIds);
        return rows.reduce((lookup, row) => {
            const key = Number(row.product_id);
            const current = lookup.get(key) || [];
            current.push(row);
            lookup.set(key, current);
            return lookup;
        }, new Map());
    }

    invalidateProductCache() {
        queryCache.bump('products');
        queryCache.bump('search');
    }

    buildFtsMatchQuery(query = '', patterns = []) {
        const terms = new Set();
        const pushTerm = (value) => {
            const cleaned = String(value || '')
                .toLowerCase()
                .replace(/["']/g, ' ')
                .replace(/[^a-z0-9\s-]/g, ' ')
                .trim();
            if (!cleaned) {
                return;
            }

            cleaned.split(/\s+/).forEach((token) => {
                if (token.length >= 2) {
                    terms.add(`"${token}"`);
                }
            });
        };

        pushTerm(query);
        (Array.isArray(patterns) ? patterns : []).slice(0, 8).forEach((pattern) => {
            pushTerm(String(pattern || '').replace(/%/g, ' '));
        });

        return Array.from(terms).slice(0, 12).join(' OR ');
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

    async list({ category = '', limit = 200, offset = 0, publishedOnly = false, columns = 'full' } = {}) {
        const normalizedCategory = this.normalizeText(category).toLowerCase();
        const safeLimit = Math.max(1, Number(limit) || 200);
        const safeOffset = Math.max(0, Number(offset) || 0);
        const select = this.selectColumns(columns);
        const publishedClause = publishedOnly ? this.publishedClause() : '';

        let rows;
        if (normalizedCategory && publishedClause) {
            rows = this.db.prepare(`
                SELECT ${select} FROM products
                WHERE category_slug = ? AND ${publishedClause}
                ORDER BY priority DESC, order_index DESC, updated_at DESC, catalog_id ASC
                LIMIT ? OFFSET ?
            `).all(normalizedCategory, safeLimit, safeOffset);
        } else if (normalizedCategory) {
            rows = this.db.prepare(`
                SELECT ${select} FROM products
                WHERE category_slug = ?
                ORDER BY priority DESC, order_index DESC, updated_at DESC, catalog_id ASC
                LIMIT ? OFFSET ?
            `).all(normalizedCategory, safeLimit, safeOffset);
        } else if (publishedClause) {
            rows = this.db.prepare(`
                SELECT ${select} FROM products
                WHERE ${publishedClause}
                ORDER BY priority DESC, order_index DESC, updated_at DESC, catalog_id ASC
                LIMIT ? OFFSET ?
            `).all(safeLimit, safeOffset);
        } else {
            rows = this.db.prepare(`
                SELECT ${select} FROM products
                ORDER BY priority DESC, order_index DESC, updated_at DESC, catalog_id ASC
                LIMIT ? OFFSET ?
            `).all(safeLimit, safeOffset);
        }

        // Card payloads normally use products.image/main_image. If those columns
        // were emptied by a bad update, still load product_images so Home/Shop
        // can recover the real photo instead of the logo fallback.
        const needsImageLookup = columns !== 'card' || rows.some((row) => !String(row.image || '').trim() && !String(row.main_image || '').trim());
        const imageLookup = needsImageLookup
            ? this.loadImagesForProductIds(rows.map((row) => Number(row.id)))
            : new Map();
        return rows.map((row) => this.mapRow(row, imageLookup.get(Number(row.id)) || []));
    }

    async listAll() {
        return this.list({ limit: 10000, offset: 0 });
    }

    buildSearchLikePattern(query) {
        const normalized = this.normalizeText(query).toLowerCase().replace(/[%_]/g, '');
        if (!normalized) {
            return '';
        }

        return `%${normalized}%`;
    }

    isActiveProductClause() {
        return `(
            status IS NULL
            OR status = ''
            OR lower(status) IN ('active', 'published', 'live')
            OR (
                lower(status) = 'inactive'
                AND (
                    json_extract(metadata_json, '$.publishStatus') IS NULL
                    OR lower(json_extract(metadata_json, '$.publishStatus')) IN ('active', 'published', 'live')
                )
            )
        )`;
    }

    sanitizeLikePattern(pattern) {
        const normalized = String(pattern || '').trim().toLowerCase().replace(/[%_]/g, '');
        if (!normalized) {
            return '';
        }

        if (String(pattern || '').includes('%')) {
            return String(pattern).trim().toLowerCase();
        }

        return `%${normalized}%`;
    }

    buildFieldMatchClause() {
        return `(
            lower(name) LIKE ?
            OR lower(COALESCE(title, name)) LIKE ?
            OR lower(COALESCE(description, '')) LIKE ?
            OR lower(COALESCE(short_description, '')) LIKE ?
            OR lower(COALESCE(category_slug, '')) LIKE ?
            OR lower(COALESCE(keywords_json, '')) LIKE ?
            OR lower(COALESCE(metadata_json, '')) LIKE ?
            OR lower(COALESCE(badge, '')) LIKE ?
            OR lower(COALESCE(variants_json, '')) LIKE ?
            OR lower(COALESCE(attributes_json, '')) LIKE ?
            OR lower(COALESCE(specs_json, '')) LIKE ?
        )`;
    }

    async searchCandidates({ query = '', patterns = [], categorySlugs = [], category = '', limit = 200, offset = 0 } = {}) {
        const likePatterns = Array.from(new Set(
            (Array.isArray(patterns) ? patterns : [])
                .map((entry) => this.sanitizeLikePattern(entry))
                .concat(this.buildSearchLikePattern(query) ? [this.buildSearchLikePattern(query)] : [])
                .filter(Boolean)
        )).slice(0, 6);

        const resolvedCategorySlugs = Array.from(new Set(
            (Array.isArray(categorySlugs) ? categorySlugs : [])
                .map((entry) => this.normalizeText(entry).toLowerCase())
                .filter(Boolean)
        )).slice(0, 8);

        if (!likePatterns.length && !resolvedCategorySlugs.length) {
            return [];
        }

        const normalizedCategory = this.normalizeText(category).toLowerCase();
        const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
        const safeOffset = Math.max(0, Number(offset) || 0);
        const select = PRODUCT_SELECT_COLUMNS.split(',').map((col) => `p.${col.trim()}`).join(', ');
        const publishedFilter = this.hasPublishedColumn()
            ? 'p.is_published = 1'
            : this.isActiveProductClause().replace(/\b(status|metadata_json)\b/g, 'p.$1');
        const ftsMatch = this.buildFtsMatchQuery(query, likePatterns);

        if (this.hasFtsIndex() && ftsMatch) {
            try {
                const params = [ftsMatch];
                let sql = `
                    SELECT ${select}
                    FROM products_fts
                    INNER JOIN products p ON p.id = products_fts.rowid
                    WHERE products_fts MATCH ?
                      AND ${publishedFilter}
                `;

                if (resolvedCategorySlugs.length) {
                    // Also include synonym category hits that may not contain the query text.
                    const placeholders = resolvedCategorySlugs.map(() => '?').join(', ');
                    sql = `
                        SELECT ${select}
                        FROM products p
                        WHERE ${publishedFilter}
                          AND (
                              p.id IN (
                                  SELECT rowid FROM products_fts WHERE products_fts MATCH ?
                              )
                              OR p.category_slug IN (${placeholders})
                          )
                    `;
                    params.length = 0;
                    params.push(ftsMatch, ...resolvedCategorySlugs);
                }

                if (normalizedCategory) {
                    sql += ' AND lower(p.category_slug) = ?';
                    params.push(normalizedCategory);
                }

                sql += ' ORDER BY p.priority DESC, p.order_index DESC, p.updated_at DESC, p.catalog_id ASC LIMIT ? OFFSET ?';
                params.push(safeLimit, safeOffset);

                const rows = this.db.prepare(sql).all(...params);
                const imageLookup = this.loadImagesForProductIds(rows.map((row) => Number(row.id)));
                return rows.map((row) => this.mapRow(row, imageLookup.get(Number(row.id)) || []));
            } catch (_ftsError) {
                // Fall through to LIKE search if FTS query is rejected.
            }
        }

        const params = [];
        const conditions = [];

        likePatterns.forEach((likePattern) => {
            conditions.push(this.buildFieldMatchClause());
            params.push(
                likePattern,
                likePattern,
                likePattern,
                likePattern,
                likePattern,
                likePattern,
                likePattern,
                likePattern,
                likePattern,
                likePattern,
                likePattern
            );
        });

        resolvedCategorySlugs.forEach((slug) => {
            conditions.push('lower(COALESCE(category_slug, \'\')) = ?');
            params.push(slug);
        });

        if (!conditions.length) {
            return [];
        }

        let sql = `
            SELECT ${PRODUCT_SELECT_COLUMNS} FROM products
            WHERE ${this.publishedClause()}
            AND (${conditions.join(' OR ')})
        `;

        if (normalizedCategory) {
            sql += ' AND lower(category_slug) = ?';
            params.push(normalizedCategory);
        }

        sql += ' ORDER BY priority DESC, order_index DESC, updated_at DESC, catalog_id ASC LIMIT ? OFFSET ?';
        params.push(safeLimit, safeOffset);

        const rows = this.db.prepare(sql).all(...params);
        const imageLookup = this.loadImagesForProductIds(rows.map((row) => Number(row.id)));
        return rows.map((row) => this.mapRow(row, imageLookup.get(Number(row.id)) || []));
    }

    async getPopularSearchInsights({ limit = 10 } = {}) {
        const safeLimit = Math.min(20, Math.max(1, Number(limit) || 10));
        const terms = new Set();

        const categoryRows = this.db.prepare(`
            SELECT category_slug, COUNT(*) AS product_count
            FROM products
            WHERE ${this.publishedClause()}
              AND category_slug IS NOT NULL
              AND category_slug != ''
            GROUP BY category_slug
            ORDER BY product_count DESC, category_slug ASC
            LIMIT ?
        `).all(Math.min(6, safeLimit));

        categoryRows.forEach((row) => {
            const label = String(row.category_slug || '').replace(/-/g, ' ').trim();
            if (label) {
                terms.add(label);
            }
        });

        const productRows = this.db.prepare(`
            SELECT name, badge, metadata_json
            FROM products
            WHERE ${this.publishedClause()}
            ORDER BY priority DESC, order_index DESC, updated_at DESC, catalog_id ASC
            LIMIT ?
        `).all(8);

        productRows.forEach((row) => {
            const metadata = this.parseJson(row.metadata_json, {});
            const brand = this.normalizeText(metadata.brand || row.badge);
            if (brand) {
                terms.add(brand);
            }

            const name = String(row.name || '').trim();
            if (name) {
                terms.add(name.split(/\s+/).slice(0, 2).join(' '));
            }
        });

        const fallback = ['shoes', 'phones', 'fashion', 'bags', 'electronics', 'watches', 'samsung', 'laptop'];
        fallback.forEach((entry) => terms.add(entry));

        return {
            terms: Array.from(terms).slice(0, safeLimit)
        };
    }

    async findByIdentifier(identifier) {
        const numericIdentifier = Number(identifier);
        let row = null;
        const select = PRODUCT_SELECT_COLUMNS;

        if (Number.isFinite(numericIdentifier) && numericIdentifier > 0) {
            row = this.db.prepare(`SELECT ${select} FROM products WHERE catalog_id = ? LIMIT 1`).get(numericIdentifier);
        }

        if (!row) {
            row = this.db.prepare(`SELECT ${select} FROM products WHERE id = ? LIMIT 1`).get(Number(identifier) || 0);
        }

        if (!row) {
            return null;
        }

        const images = this.db.prepare(`
            SELECT product_id, image_url, sort_order, id
            FROM product_images
            WHERE product_id = ?
            ORDER BY sort_order ASC, id ASC
        `).all(Number(row.id));
        return this.mapRow(row, images);
    }

    persistImages(productId, gallery, mainImage) {
        if (!Array.isArray(gallery) && !String(mainImage || '').trim()) {
            return;
        }

        const productIdNum = Number(productId);
        const mainImageStorage = this.prepareStorablePath(mainImage);
        const desired = [];
        const seen = new Set();
        const pushPath = (value) => {
            const storedPath = this.prepareStorablePath(value);
            if (
                !storedPath
                || storedPath.includes('..')
                || /(?:^|\/)img\/logo\.png$/i.test(storedPath)
                || isProductCardImagePath(storedPath)
                || seen.has(storedPath)
            ) {
                return;
            }
            seen.add(storedPath);
            desired.push(storedPath);
        };

        pushPath(mainImage);
        if (Array.isArray(gallery)) {
            gallery.forEach((entry) => pushPath(entry));
        }

        // An update with no usable image paths must not delete existing rows.
        // That happens on stock-only saves that send empty image fields.
        if (!desired.length) {
            return;
        }

        const existingRows = this.db.prepare(`
            SELECT id, image_url, kind, sort_order
            FROM product_images
            WHERE product_id = ?
            ORDER BY sort_order ASC, id ASC
        `).all(productIdNum);

        const existingByPath = new Map();
        existingRows.forEach((row) => {
            const path = this.prepareStorablePath(row.image_url);
            if (path && !existingByPath.has(path)) {
                existingByPath.set(path, row);
            }
        });

        const desiredSet = new Set(desired);
        const deleteStmt = this.db.prepare('DELETE FROM product_images WHERE id = ?');
        existingRows.forEach((row) => {
            const path = this.prepareStorablePath(row.image_url);
            if (!desiredSet.has(path)) {
                deleteStmt.run(Number(row.id));
            }
        });

        const insertStmt = this.db.prepare(
            'INSERT INTO product_images (product_id, image_url, kind, sort_order) VALUES (?, ?, ?, ?)'
        );
        const updateStmt = this.db.prepare(
            'UPDATE product_images SET kind = ?, sort_order = ?, image_url = ? WHERE id = ?'
        );

        desired.forEach((storedPath, index) => {
            const kind = storedPath === mainImageStorage ? 'main' : 'gallery';
            const existing = existingByPath.get(storedPath);
            if (existing) {
                if (Number(existing.sort_order) !== index || String(existing.kind || '') !== kind) {
                    updateStmt.run(kind, index, storedPath, Number(existing.id));
                }
                return;
            }
            insertStmt.run(productIdNum, storedPath, kind, index);
        });
    }

    async save(product, options = {}) {
        const existing = options.identifier ? await this.findByIdentifier(options.identifier) : null;

        const category = await categoryRepository.ensureBySlug(product.category, { name: product.category });
        const now = this.now(product.updatedAt);
        const incomingImagePath = resolveCanonicalImageValue(
            this.prepareStorablePath(
                product.image
                || product.mainImage
                || product.mainImageStoragePath
                || product.imageStoragePath
            ),
            existing
                ? [
                    existing.image,
                    existing.mainImage,
                    existing.mainImageStoragePath,
                    existing.imageStoragePath
                ]
                : []
        );
        const existingImagePath = existing
            ? (this.prepareStorablePath(existing.image || existing.mainImage || existing.mainImageStoragePath) || this.normalizeText(existing.image || existing.mainImage))
            : '';
        const imageStoragePath = this.prepareStorablePath(
            (!incomingImagePath || isProductCardImagePath(incomingImagePath))
                ? (existingImagePath || incomingImagePath)
                : incomingImagePath
        ) || existingImagePath;
        const mainImageStoragePath = imageStoragePath;
        const incomingGallery = Array.isArray(product.gallery) ? product.gallery : null;
        const canonicalIncomingGallery = Array.isArray(incomingGallery)
            ? incomingGallery
                .map((entry) => resolveCanonicalImageValue(entry, existing?.gallery || []))
                .filter((entry) => {
                    const storedPath = this.prepareStorablePath(entry);
                    return Boolean(storedPath) && !isProductCardImagePath(storedPath);
                })
            : null;
        const galleryForPersist = (
            (!canonicalIncomingGallery || canonicalIncomingGallery.length === 0)
            && Array.isArray(existing?.gallery)
            && existing.gallery.length
        )
            ? existing.gallery
            : (canonicalIncomingGallery || (Array.isArray(existing?.gallery) ? existing.gallery : null));
        const metadataSource = product.metadata && typeof product.metadata === 'object' ? product.metadata : {};
        const metadata = {
            ...metadataSource,
            brand: this.normalizeText(product.brand || metadataSource.brand),
            sku: this.normalizeText(product.sku || metadataSource.sku),
            costPrice: this.toNumber(product.costPrice ?? metadataSource.costPrice, 0),
            taxRate: this.toNumber(product.taxRate ?? metadataSource.taxRate, 0),
            taxIncluded: Boolean(product.taxIncluded ?? metadataSource.taxIncluded),
            metaTitle: this.normalizeText(product.metaTitle || metadataSource.metaTitle),
            metaDescription: this.normalizeText(product.metaDescription || metadataSource.metaDescription),
            slug: this.normalizeText(product.slug || metadataSource.slug),
            tags: Array.isArray(product.tags)
                ? product.tags.map((entry) => this.normalizeText(entry)).filter(Boolean)
                : (Array.isArray(metadataSource.tags) ? metadataSource.tags : [])
        };

        const payload = {
            catalogId: Number(product.catalogId),
            categoryId: category ? Number(category.id) : null,
            categorySlug: this.normalizeText(product.category, 'general').toLowerCase(),
            name: this.normalizeText(product.name),
            title: this.normalizeText(product.title || product.name),
            description: this.normalizeText(product.description),
            shortDescription: this.normalizeText(product.shortDescription || product.metaDescription),
            longDescriptionJson: this.stringifyJson(product.longDescription || [], []),
            badge: this.normalizeText(product.badge || product.brand),
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
            metadataJson: this.stringifyJson(metadata, {}),
            updatedAt: now,
            createdAt: existing?.createdAt || this.now(product.createdAt),
            isPublished: this.computeIsPublished(product.status, metadata)
        };

        try {
            // If updating an existing record, do a normal update inside a transaction.
            if (existing) {
                const updateTxn = this.db.transaction(() => {
                    if (this.hasPublishedColumn()) {
                        this.db.prepare(`
                            UPDATE products
                            SET catalog_id = ?, category_id = ?, category_slug = ?, name = ?, title = ?, description = ?, short_description = ?, long_description_json = ?,
                                badge = ?, price = ?, old_price = ?, stock = ?, image = ?, main_image = ?, keywords_json = ?, highlights_json = ?, trust_json = ?,
                                specs_json = ?, attributes_json = ?, variants_json = ?, visibility = ?, priority = ?, order_index = ?, highlight_tag = ?, status = ?, page = ?, url = ?, metadata_json = ?, is_published = ?, updated_at = ?
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
                            payload.metadataJson,
                            payload.isPublished,
                            payload.updatedAt,
                            Number(existing.recordId)
                        );
                    } else {
                        this.db.prepare(`
                            UPDATE products
                            SET catalog_id = ?, category_id = ?, category_slug = ?, name = ?, title = ?, description = ?, short_description = ?, long_description_json = ?,
                                badge = ?, price = ?, old_price = ?, stock = ?, image = ?, main_image = ?, keywords_json = ?, highlights_json = ?, trust_json = ?,
                                specs_json = ?, attributes_json = ?, variants_json = ?, visibility = ?, priority = ?, order_index = ?, highlight_tag = ?, status = ?, page = ?, url = ?, metadata_json = ?, updated_at = ?
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
                            payload.metadataJson,
                            payload.updatedAt,
                            Number(existing.recordId)
                        );
                    }
                    this.persistImages(
                        existing.recordId,
                        galleryForPersist,
                        payload.mainImage || existingImagePath
                    );
                    return Number(existing.recordId);
                });

                const recordId = updateTxn();
                this.invalidateProductCache();
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
                        const result = this.hasPublishedColumn()
                            ? this.db.prepare(`
                                INSERT INTO products (
                                    catalog_id, category_id, category_slug, name, title, description, short_description, long_description_json, badge,
                                    price, old_price, stock, image, main_image, keywords_json, highlights_json, trust_json, specs_json, attributes_json,
                                    variants_json, visibility, priority, order_index, highlight_tag, status, page, url, metadata_json, is_published, created_at, updated_at
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                                payload.metadataJson,
                                payload.isPublished,
                                payload.createdAt,
                                payload.updatedAt
                            )
                            : this.db.prepare(`
                                INSERT INTO products (
                                    catalog_id, category_id, category_slug, name, title, description, short_description, long_description_json, badge,
                                    price, old_price, stock, image, main_image, keywords_json, highlights_json, trust_json, specs_json, attributes_json,
                                    variants_json, visibility, priority, order_index, highlight_tag, status, page, url, metadata_json, created_at, updated_at
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                                payload.metadataJson,
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

            this.invalidateProductCache();
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
        this.invalidateProductCache();
        return existing;
    }

    normalizeMatchKey(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    /**
     * Normalize size tokens so "Size 42", "size-42", and "42" all match.
     */
    normalizeSizeMatchKey(value) {
        let key = this.normalizeMatchKey(value);
        if (key.startsWith('size-')) {
            key = key.slice(5);
        }
        return key;
    }

    matchesVariantToken(candidate, target) {
        const left = this.normalizeMatchKey(candidate);
        const right = this.normalizeMatchKey(target);
        return Boolean(left && right && left === right);
    }

    matchesSizeToken(candidate, target) {
        const left = this.normalizeSizeMatchKey(candidate);
        const right = this.normalizeSizeMatchKey(target);
        return Boolean(left && right && left === right);
    }

    parseVariantKeyTokens(variantKey) {
        const raw = String(variantKey || '').trim();
        if (!raw) return { color: '', size: '' };
        const parts = Object.fromEntries(
            raw.split('|')
                .map((part) => part.split(':'))
                .filter((pair) => pair.length >= 2)
                .map(([key, ...rest]) => [String(key || '').trim().toLowerCase(), rest.join(':').trim()])
        );
        return {
            color: parts.color || parts.colour || '',
            size: parts.size || ''
        };
    }

    collectColorTokens(item = {}) {
        const attributes = item?.attributes && typeof item.attributes === 'object' ? item.attributes : {};
        const fromKey = this.parseVariantKeyTokens(item?.variantKey);
        const tokens = [
            item?.colorId,
            item?.colorName,
            item?.color,
            attributes.colorId,
            attributes.Color,
            attributes.color,
            fromKey.color,
            item?.variantSelection?.colorId,
            item?.variantSelection?.color
        ];
        return [...new Set(tokens.map((value) => this.normalizeText(value)).filter(Boolean))];
    }

    collectSizeTokens(item = {}) {
        const attributes = item?.attributes && typeof item.attributes === 'object' ? item.attributes : {};
        const fromKey = this.parseVariantKeyTokens(item?.variantKey);
        const tokens = [
            item?.sizeValue,
            item?.sizeLabel,
            item?.size,
            attributes.sizeValue,
            attributes.Size,
            attributes.size,
            fromKey.size,
            item?.variantSelection?.sizeValue,
            item?.variantSelection?.size
        ];
        return [...new Set(tokens.map((value) => this.normalizeText(value)).filter(Boolean))];
    }

    findColorVariant(colorVariants, colorToken) {
        const target = String(colorToken || '').trim();
        if (!target || !Array.isArray(colorVariants)) {
            return null;
        }

        return colorVariants.find((entry) => (
            this.matchesVariantToken(entry?.id, target)
            || this.matchesVariantToken(entry?.colorName, target)
            || this.matchesVariantToken(entry?.label, target)
        )) || null;
    }

    findColorVariantFromTokens(colorVariants, tokens = []) {
        for (const token of tokens) {
            const match = this.findColorVariant(colorVariants, token);
            if (match) return match;
        }
        return null;
    }

    findSizeRow(sizes, sizeToken) {
        const target = String(sizeToken || '').trim();
        if (!target || !Array.isArray(sizes)) {
            return null;
        }

        return sizes.find((entry) => (
            this.matchesSizeToken(entry?.size, target)
            || this.matchesSizeToken(entry?.label, target)
            || this.matchesSizeToken(entry?.value, target)
        )) || null;
    }

    findSizeRowFromTokens(sizes, tokens = []) {
        for (const token of tokens) {
            const match = this.findSizeRow(sizes, token);
            if (match) return match;
        }
        return null;
    }

    computeColorVariantTotal(colorVariants = []) {
        return (Array.isArray(colorVariants) ? colorVariants : []).reduce((sum, color) => {
            const sizes = Array.isArray(color?.sizes) ? color.sizes : [];
            if (sizes.length) {
                return sum + sizes.reduce((inner, size) => inner + Math.max(0, this.toNumber(size?.stock, 0)), 0);
            }
            return sum + Math.max(0, this.toNumber(color?.stock ?? color?.totalStock, 0));
        }, 0);
    }

    findProductRowForOrderItem(productId) {
        const textId = this.normalizeText(productId);
        const numericId = Number(textId);
        if (!textId) return null;

        // Storefront order items use catalog_id. Prefer that over internal row id
        // so "10" never decrements a different product whose primary key is 10.
        if (Number.isFinite(numericId) && numericId > 0) {
            const byCatalog = this.db.prepare(`
                SELECT id, catalog_id, name, stock, variants_json, metadata_json
                FROM products
                WHERE catalog_id = ? OR CAST(catalog_id AS TEXT) = ?
                LIMIT 1
            `).get(numericId, textId);
            if (byCatalog) return byCatalog;
        }

        return this.db.prepare(`
            SELECT id, catalog_id, name, stock, variants_json, metadata_json
            FROM products
            WHERE CAST(catalog_id AS TEXT) = ?
               OR CAST(id AS TEXT) = ?
               OR id = ?
            LIMIT 1
        `).get(textId, textId, Number.isFinite(numericId) ? numericId : -1);
    }

    /**
     * Validate and decrement product stock for order line items.
     * Must be called inside a better-sqlite3 transaction with order creation.
     */
    decrementStockForOrderItems(items = []) {
        const source = Array.isArray(items) ? items : [];
        const touched = [];

        source.forEach((item) => {
            const productId = this.normalizeText(item?.productId || item?.id);
            const quantity = Math.max(1, this.toNumber(item?.quantity || item?.qty, 1));
            if (!productId) {
                const error = new Error(`Order item is missing productId (${item?.productName || 'Product'})`);
                error.code = 'INVALID_ORDER_ITEM';
                throw error;
            }

            const product = this.findProductRowForOrderItem(productId);

            if (!product) {
                const error = new Error(`Product not found: ${productId}`);
                error.code = 'PRODUCT_NOT_FOUND';
                error.productId = productId;
                throw error;
            }

            const attributes = item?.attributes && typeof item.attributes === 'object' ? item.attributes : {};
            const colorTokens = this.collectColorTokens(item);
            const sizeTokens = this.collectSizeTokens(item);
            const colorToken = colorTokens[0] || this.normalizeText(item?.colorName || item?.color || attributes.Color);
            const sizeToken = sizeTokens[0] || this.normalizeText(item?.sizeLabel || item?.size || attributes.Size);
            const variants = this.parseJson(product.variants_json, {});
            const metadata = this.parseJson(product.metadata_json, {});
            let colorVariants = Array.isArray(variants?.colorVariants)
                ? variants.colorVariants
                : (Array.isArray(metadata?.colorVariants) ? metadata.colorVariants : []);
            colorVariants = JSON.parse(JSON.stringify(colorVariants || []));

            let nextStock = Math.max(0, this.toNumber(product.stock, 0));
            let nextVariantsJson = product.variants_json;
            let nextMetadataJson = product.metadata_json;

            if (colorVariants.length) {
                if (!colorTokens.length && !sizeTokens.length) {
                    const error = new Error(`Color/size selection required for ${product.name || productId}`);
                    error.code = 'INVALID_ORDER_ITEM';
                    error.productId = productId;
                    throw error;
                }

                const color = this.findColorVariantFromTokens(colorVariants, colorTokens) || (
                    colorVariants.length === 1 ? colorVariants[0] : null
                );
                if (!color) {
                    const error = new Error(`Color variant unavailable for ${product.name || productId}`);
                    error.code = 'INSUFFICIENT_STOCK';
                    error.productId = productId;
                    throw error;
                }

                const sizes = Array.isArray(color.sizes) ? color.sizes : [];
                if (sizes.length) {
                    if (!sizeTokens.length) {
                        const error = new Error(`Size selection required for ${product.name || productId}`);
                        error.code = 'INVALID_ORDER_ITEM';
                        error.productId = productId;
                        throw error;
                    }
                    const sizeRow = this.findSizeRowFromTokens(sizes, sizeTokens);
                    if (!sizeRow) {
                        const error = new Error(`Size variant unavailable for ${product.name || productId}`);
                        error.code = 'INSUFFICIENT_STOCK';
                        error.productId = productId;
                        throw error;
                    }
                    const available = Math.max(0, this.toNumber(sizeRow.stock, 0));
                    if (available < quantity) {
                        const error = new Error(`Insufficient stock for ${product.name || productId}`);
                        error.code = 'INSUFFICIENT_STOCK';
                        error.productId = productId;
                        error.available = available;
                        throw error;
                    }
                    sizeRow.stock = available - quantity;
                } else {
                    const available = Math.max(0, this.toNumber(color.stock ?? color.totalStock, 0));
                    if (available < quantity) {
                        const error = new Error(`Insufficient stock for ${product.name || productId}`);
                        error.code = 'INSUFFICIENT_STOCK';
                        error.productId = productId;
                        error.available = available;
                        throw error;
                    }
                    color.stock = available - quantity;
                    color.totalStock = color.stock;
                }

                nextStock = this.computeColorVariantTotal(colorVariants);
                if (Array.isArray(variants?.colorVariants)) {
                    nextVariantsJson = this.stringifyJson({ ...variants, colorVariants }, {});
                } else if (Array.isArray(metadata?.colorVariants)) {
                    nextMetadataJson = this.stringifyJson({ ...metadata, colorVariants }, {});
                } else {
                    nextVariantsJson = this.stringifyJson({ ...(variants || {}), colorVariants }, {});
                }
            } else {
                const available = Math.max(0, this.toNumber(product.stock, 0));
                if (available < quantity) {
                    const error = new Error(`Insufficient stock for ${product.name || productId}`);
                    error.code = 'INSUFFICIENT_STOCK';
                    error.productId = productId;
                    error.available = available;
                    throw error;
                }
                nextStock = available - quantity;
            }

            this.db.prepare(`
                UPDATE products
                SET stock = ?, variants_json = ?, metadata_json = ?, updated_at = ?
                WHERE id = ?
            `).run(
                nextStock,
                nextVariantsJson,
                nextMetadataJson,
                this.now(),
                Number(product.id)
            );
            touched.push(Number(product.id));
        });

        if (touched.length) {
            this.invalidateProductCache();
        }

        return touched;
    }

    /**
     * Restore stock for cancelled/deleted order lines (inverse of decrement).
     */
    restoreStockForOrderItems(items = []) {
        const source = Array.isArray(items) ? items : [];
        const touched = [];

        source.forEach((item) => {
            const productId = this.normalizeText(item?.productId || item?.id);
            const quantity = Math.max(1, this.toNumber(item?.quantity || item?.qty, 1));
            if (!productId) {
                return;
            }

            const product = this.findProductRowForOrderItem(productId);

            if (!product) {
                return;
            }

            const attributes = item?.attributes && typeof item.attributes === 'object' ? item.attributes : {};
            const colorTokens = this.collectColorTokens(item);
            const sizeTokens = this.collectSizeTokens(item);
            const colorToken = colorTokens[0] || this.normalizeText(item?.colorName || item?.color || attributes.Color);
            const sizeToken = sizeTokens[0] || this.normalizeText(item?.sizeLabel || item?.size || attributes.Size);
            const variants = this.parseJson(product.variants_json, {});
            const metadata = this.parseJson(product.metadata_json, {});
            let colorVariants = Array.isArray(variants?.colorVariants)
                ? variants.colorVariants
                : (Array.isArray(metadata?.colorVariants) ? metadata.colorVariants : []);
            colorVariants = JSON.parse(JSON.stringify(colorVariants || []));

            let nextStock = Math.max(0, this.toNumber(product.stock, 0)) + quantity;
            let nextVariantsJson = product.variants_json;
            let nextMetadataJson = product.metadata_json;

            if (colorVariants.length && (colorTokens.length || sizeTokens.length || colorToken || sizeToken)) {
                const color = this.findColorVariantFromTokens(colorVariants, colorTokens.length ? colorTokens : [colorToken]) || (
                    colorVariants.length === 1 ? colorVariants[0] : null
                );
                if (color) {
                    const sizes = Array.isArray(color.sizes) ? color.sizes : [];
                    if (sizes.length) {
                        const sizeRow = this.findSizeRowFromTokens(sizes, sizeTokens.length ? sizeTokens : [sizeToken]);
                        if (sizeRow) {
                            sizeRow.stock = Math.max(0, this.toNumber(sizeRow.stock, 0)) + quantity;
                        }
                    } else {
                        color.stock = Math.max(0, this.toNumber(color.stock ?? color.totalStock, 0)) + quantity;
                        color.totalStock = color.stock;
                    }
                    nextStock = this.computeColorVariantTotal(colorVariants);
                    if (Array.isArray(variants?.colorVariants)) {
                        nextVariantsJson = this.stringifyJson({ ...variants, colorVariants }, {});
                    } else if (Array.isArray(metadata?.colorVariants)) {
                        nextMetadataJson = this.stringifyJson({ ...metadata, colorVariants }, {});
                    } else {
                        nextVariantsJson = this.stringifyJson({ ...(variants || {}), colorVariants }, {});
                    }
                }
            }

            this.db.prepare(`
                UPDATE products
                SET stock = ?, variants_json = ?, metadata_json = ?, updated_at = ?
                WHERE id = ?
            `).run(
                nextStock,
                nextVariantsJson,
                nextMetadataJson,
                this.now(),
                Number(product.id)
            );
            touched.push(Number(product.id));
        });

        if (touched.length) {
            this.invalidateProductCache();
        }

        return touched;
    }
}

module.exports = new SQLiteProductRepository();