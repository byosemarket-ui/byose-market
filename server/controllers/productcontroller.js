const mongoose = require('mongoose');
const Product = require('../models/product');
const { appLogger, monitorAsyncOperation } = require('../utils/logger');

const DEFAULT_DETAIL_PAGE = 'product-details1.html';

function toTrimmedString(value, fallbackValue = '') {
    const result = String(value || '').trim();
    return result || String(fallbackValue || '').trim();
}

function toNonNegativeNumber(value, fallbackValue = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallbackValue;
}

function toStringArray(value) {
    return Array.isArray(value)
        ? value.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [];
}

function uniqueStrings(values) {
    return Array.from(new Set(toStringArray(values)));
}

function normalizeVisibility(value) {
    const normalized = toTrimmedString(value, 'both').toLowerCase();
    return normalized === 'home' || normalized === 'shop' || normalized === 'both' ? normalized : 'both';
}

function normalizePriority(value) {
    return toTrimmedString(value, 'normal').toLowerCase() === 'top' ? 'top' : 'normal';
}

function normalizeHighlightTag(value) {
    const normalized = toTrimmedString(value).toLowerCase();
    return normalized === 'featured' || normalized === 'trending' || normalized === 'new' ? normalized : '';
}

function normalizeSpecs(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((entry) => {
            if (Array.isArray(entry) && entry.length >= 2) {
                return {
                    label: toTrimmedString(entry[0]),
                    value: toTrimmedString(entry[1])
                };
            }

            if (entry && typeof entry === 'object') {
                return {
                    label: toTrimmedString(entry.label || entry.name),
                    value: toTrimmedString(entry.value)
                };
            }

            return null;
        })
        .filter((entry) => entry && entry.label && entry.value);
}

function normalizeAttributes(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((attribute) => {
            if (!attribute || typeof attribute !== 'object') {
                return null;
            }

            const options = Array.isArray(attribute.options)
                ? attribute.options
                    .map((option) => {
                        if (!option || typeof option !== 'object') {
                            return null;
                        }

                        const normalizedOption = {
                            value: toTrimmedString(option.value),
                            stock: toNonNegativeNumber(option.stock, 0),
                            image: toTrimmedString(option.image)
                        };

                        return normalizedOption.value || normalizedOption.image ? normalizedOption : null;
                    })
                    .filter(Boolean)
                : [];

            if (!options.length) {
                return null;
            }

            return {
                name: toTrimmedString(attribute.name, 'Option'),
                type: toTrimmedString(attribute.type, 'text') === 'image' ? 'image' : 'text',
                options
            };
        })
        .filter(Boolean);
}

function parseCatalogId(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildProductUrl(catalogId) {
    return `${DEFAULT_DETAIL_PAGE}?id=${encodeURIComponent(String(catalogId))}`;
}

function normalizePayload(payload) {
    const name = toTrimmedString(payload?.name || payload?.title);
    const price = toNonNegativeNumber(payload?.price, 0);
    const mainImage = toTrimmedString(payload?.mainImage || payload?.image);
    const oldPrice = toNonNegativeNumber(payload?.oldPrice, 0);

    return {
        name,
        title: name,
        description: toTrimmedString(payload?.description || payload?.shortDescription),
        shortDescription: toTrimmedString(payload?.shortDescription || payload?.description),
        longDescription: toStringArray(payload?.longDescription),
        badge: toTrimmedString(payload?.badge),
        category: toTrimmedString(payload?.category, 'general').toLowerCase(),
        price,
        oldPrice: oldPrice > price ? oldPrice : 0,
        stock: toNonNegativeNumber(payload?.stock, 0),
        image: mainImage,
        mainImage,
        gallery: uniqueStrings([mainImage, ...toStringArray(payload?.gallery)]),
        keywords: uniqueStrings(payload?.keywords),
        highlights: toStringArray(payload?.highlights),
        trust: toStringArray(payload?.trust),
        specs: normalizeSpecs(payload?.specs),
        attributes: normalizeAttributes(payload?.attributes),
        visibility: normalizeVisibility(payload?.visibility),
        priority: normalizePriority(payload?.priority),
        orderIndex: toNonNegativeNumber(payload?.orderIndex, 0),
        highlightTag: normalizeHighlightTag(payload?.highlightTag),
        status: toTrimmedString(payload?.status, 'active').toLowerCase() || 'active',
        page: DEFAULT_DETAIL_PAGE
    };
}

function serializeProduct(product) {
    const source = product && typeof product.toObject === 'function'
        ? product.toObject({ versionKey: false })
        : { ...(product || {}) };
    const catalogId = Number(source.catalogId || source.id || 0);

    return {
        ...source,
        id: catalogId,
        title: source.title || source.name,
        description: source.description || source.shortDescription || '',
        shortDescription: source.shortDescription || source.description || '',
        mainImage: source.mainImage || source.image || '',
        image: source.image || source.mainImage || '',
        gallery: uniqueStrings(source.gallery || []),
        keywords: uniqueStrings(source.keywords || []),
        specs: Array.isArray(source.specs)
            ? source.specs.map((entry) => [toTrimmedString(entry.label), toTrimmedString(entry.value)]).filter((entry) => entry[0] && entry[1])
            : [],
        url: source.url || buildProductUrl(catalogId),
        page: DEFAULT_DETAIL_PAGE,
        catalogId
    };
}

async function getNextCatalogId() {
    const latest = await Product.findOne().sort({ catalogId: -1 }).select('catalogId').lean();
    return Number(latest?.catalogId || 0) + 1;
}

async function findProductByIdentifier(identifier) {
    const catalogId = parseCatalogId(identifier);
    if (catalogId) {
        const product = await Product.findOne({ catalogId });
        if (product) {
            return product;
        }
    }

    if (mongoose.Types.ObjectId.isValid(String(identifier || ''))) {
        return Product.findById(identifier);
    }

    return null;
}

async function buildCatalogIdFromPayload(payload, fallbackValue) {
    const requestedId = parseCatalogId(payload?.id || payload?.catalogId);
    if (!requestedId) {
        return fallbackValue || getNextCatalogId();
    }

    const existing = await Product.findOne({ catalogId: requestedId }).select('_id').lean();
    if (!existing) {
        return requestedId;
    }

    return fallbackValue || getNextCatalogId();
}

function buildSort() {
    return {
        priority: -1,
        orderIndex: -1,
        updatedAt: -1,
        catalogId: 1
    };
}

exports.bootstrapCatalog = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'inventory' });
    try {
        const source = Array.isArray(req.body?.products) ? req.body.products : [];
        if (!source.length) {
            return res.status(400).json({ success: false, message: 'Products are required for bootstrap' });
        }

        const usedIds = new Set();
        for (const item of source) {
            let catalogId = parseCatalogId(item?.id || item?.catalogId);
            if (!catalogId || usedIds.has(catalogId)) {
                catalogId = usedIds.size + 1;
                while (usedIds.has(catalogId)) {
                    catalogId += 1;
                }
            }

            usedIds.add(catalogId);
            const normalized = normalizePayload(item);
            await monitorAsyncOperation(logger, 'database.product.bootstrap_upsert', { catalogId, adminId: req.admin?.id || '' }, () => Product.findOneAndUpdate(
                { catalogId },
                {
                    $set: {
                        ...normalized,
                        catalogId,
                        url: buildProductUrl(catalogId)
                    }
                },
                { new: true, upsert: true, setDefaultsOnInsert: true }
            ), { slowThresholdMs: 700 });
        }

        const products = await monitorAsyncOperation(logger, 'database.product.list_after_bootstrap', { adminId: req.admin?.id || '' }, () => Product.find({}).sort(buildSort()), { slowThresholdMs: 900 });
        logger.info('inventory.bootstrap_completed', { adminId: req.admin?.id || '', count: products.length });
        return res.json({ success: true, products: products.map(serializeProduct) });
    } catch (error) {
        logger.error('inventory.bootstrap_failed', { error });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.createProduct = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'inventory' });
    try {
        const normalized = normalizePayload(req.body || {});
        if (!normalized.name || typeof req.body?.price === 'undefined') {
            return res.status(400).json({ success: false, message: 'Product name and price are required' });
        }

        const catalogId = await buildCatalogIdFromPayload(req.body, null);
        const product = await monitorAsyncOperation(logger, 'database.product.create', { catalogId, adminId: req.admin?.id || '', productName: normalized.name, stock: normalized.stock }, () => Product.create({
            ...normalized,
            catalogId,
            url: buildProductUrl(catalogId)
        }), { slowThresholdMs: 700 });

        logger.info('inventory.product_created', { adminId: req.admin?.id || '', catalogId, productName: normalized.name, stock: normalized.stock, price: normalized.price });

        return res.status(201).json({ success: true, product: serializeProduct(product) });
    } catch (error) {
        logger.error('inventory.product_create_failed', { error });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getAllProducts = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'inventory' });
    try {
        const filter = {};
        if (req.query.category) {
            filter.category = String(req.query.category).trim().toLowerCase();
        }

        const products = await monitorAsyncOperation(logger, 'database.product.list', { category: filter.category || '' }, () => Product.find(filter).sort(buildSort()), { slowThresholdMs: 900 });
        return res.json({ success: true, products: products.map(serializeProduct) });
    } catch (error) {
        logger.error('inventory.product_list_failed', { error, category: req.query?.category || '' });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getProductById = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'inventory' });
    try {
        const product = await monitorAsyncOperation(logger, 'database.product.find', { requestedProductId: req.params.id }, () => findProductByIdentifier(req.params.id), { slowThresholdMs: 700 });
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        return res.json({ success: true, product: serializeProduct(product) });
    } catch (error) {
        logger.error('inventory.product_lookup_failed', { error, requestedProductId: req.params.id });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.updateProduct = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'inventory' });
    try {
        const normalized = normalizePayload(req.body || {});
        if (!normalized.name || typeof req.body?.price === 'undefined') {
            return res.status(400).json({ success: false, message: 'Product name and price are required' });
        }

        let product = await monitorAsyncOperation(logger, 'database.product.find_for_update', { requestedProductId: req.params.id, adminId: req.admin?.id || '' }, () => findProductByIdentifier(req.params.id), { slowThresholdMs: 700 });
        if (!product) {
            const catalogId = parseCatalogId(req.params.id) || await buildCatalogIdFromPayload(req.body, null);
            product = await monitorAsyncOperation(logger, 'database.product.create_on_update_fallback', { catalogId, adminId: req.admin?.id || '', productName: normalized.name }, () => Product.create({
                ...normalized,
                catalogId,
                url: buildProductUrl(catalogId)
            }), { slowThresholdMs: 700 });

            logger.info('inventory.product_created_via_update', { adminId: req.admin?.id || '', catalogId, productName: normalized.name });

            return res.status(201).json({ success: true, created: true, product: serializeProduct(product) });
        }

        const previousStock = Number(product.stock || 0);

        Object.assign(product, normalized, {
            title: normalized.name,
            url: buildProductUrl(product.catalogId)
        });
        await monitorAsyncOperation(logger, 'database.product.save_update', { catalogId: product.catalogId, adminId: req.admin?.id || '', productName: normalized.name }, () => product.save(), { slowThresholdMs: 700 });

        logger.info('inventory.product_updated', {
            adminId: req.admin?.id || '',
            catalogId: product.catalogId,
            productName: normalized.name,
            previousStock,
            nextStock: Number(product.stock || 0),
            price: Number(product.price || 0)
        });

        return res.json({ success: true, product: serializeProduct(product) });
    } catch (error) {
        logger.error('inventory.product_update_failed', { error, requestedProductId: req.params.id });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.deleteProduct = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'inventory' });
    try {
        const product = await monitorAsyncOperation(logger, 'database.product.find_for_delete', { requestedProductId: req.params.id, adminId: req.admin?.id || '' }, () => findProductByIdentifier(req.params.id), { slowThresholdMs: 700 });
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        await monitorAsyncOperation(logger, 'database.product.delete', { catalogId: product.catalogId, adminId: req.admin?.id || '' }, () => Product.deleteOne({ _id: product._id }), { slowThresholdMs: 700 });
        logger.info('inventory.product_deleted', { adminId: req.admin?.id || '', catalogId: product.catalogId, productName: product.name || product.title || '' });
        return res.json({ success: true, id: product.catalogId });
    } catch (error) {
        logger.error('inventory.product_delete_failed', { error, requestedProductId: req.params.id });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};
