const { appLogger, monitorAsyncOperation } = require('../utils/logger');
const productDataService = require('../services/productdataservice');
const getRealtimeEventService = require('../services/realtimeeventservice');

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
    if (typeof value === 'number' && Number.isFinite(value)) {
        const normalized = Math.floor(value);
        return normalized === 2 ? 2 : normalized === 1 ? 1 : 0;
    }

    const normalizedText = toTrimmedString(value).toLowerCase();
    if (!normalizedText || normalizedText === 'normal') {
        return 0;
    }

    if (normalizedText === 'top') {
        return 1;
    }

    if (normalizedText === 'featured') {
        return 2;
    }

    const parsed = Number(normalizedText);
    if (Number.isFinite(parsed)) {
        const normalized = Math.floor(parsed);
        return normalized === 2 ? 2 : normalized === 1 ? 1 : 0;
    }

    return 0;
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

function splitVariantToken(value) {
    return String(value || '')
        .split('|')
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
}

function normalizeVariantOptions(value, variantType) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((option) => {
            if (typeof option === 'string' || typeof option === 'number') {
                const [labelPart, valuePart, swatchPart, imagePart] = splitVariantToken(option);
                const label = labelPart || valuePart || String(option).trim();
                const normalizedValue = valuePart || labelPart || String(option).trim();
                return normalizedValue ? {
                    label,
                    value: normalizedValue,
                    stock: 0,
                    image: variantType === 'color' ? toTrimmedString(imagePart) : '',
                    swatch: variantType === 'color' ? toTrimmedString(swatchPart) : '',
                    sku: '',
                    code: '',
                    availability: 'future',
                    isDefault: false,
                    priceDelta: 0
                } : null;
            }

            if (!option || typeof option !== 'object') {
                return null;
            }

            const normalizedOption = {
                label: toTrimmedString(option.label || option.name || option.value),
                value: toTrimmedString(option.value || option.label || option.name),
                stock: toNonNegativeNumber(option.stock, 0),
                image: toTrimmedString(option.image || option.thumbnail),
                swatch: toTrimmedString(option.swatch || option.hex || option.color),
                sku: toTrimmedString(option.sku),
                code: toTrimmedString(option.code),
                availability: toTrimmedString(option.availability || option.status, 'future').toLowerCase(),
                isDefault: Boolean(option.isDefault),
                priceDelta: toNonNegativeNumber(option.priceDelta, 0)
            };

            if (!normalizedOption.value && !normalizedOption.label) {
                return null;
            }

            return normalizedOption;
        })
        .filter((option) => Boolean(option && option.value));
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

            const type = toTrimmedString(attribute.type || attribute.axis, 'text').toLowerCase();
            const options = normalizeVariantOptions(attribute.options, type);

            if (!options.length) {
                return null;
            }

            return {
                name: toTrimmedString(attribute.name, 'Option'),
                key: toTrimmedString(attribute.key),
                axis: ['color', 'size', 'image', 'text'].includes(type) ? type : 'text',
                type: ['color', 'size', 'image', 'text'].includes(type) ? type : 'text',
                required: attribute.required !== false,
                options
            };
        })
        .filter(Boolean);
}

function normalizeVariantFoundation(source, fallbackAttributes = []) {
    const groupsSource = source && typeof source === 'object' ? source.groups : {};
    const fallbackGroups = Array.isArray(fallbackAttributes) && fallbackAttributes.length
        ? fallbackAttributes.reduce((result, attribute) => {
            const key = toTrimmedString(attribute?.key || attribute?.axis || attribute?.name, 'option').toLowerCase();
            result[key] = {
                enabled: true,
                label: toTrimmedString(attribute?.name || key),
                type: toTrimmedString(attribute?.type || attribute?.axis || 'text', 'text').toLowerCase(),
                required: attribute?.required !== false,
                optionTokens: Array.isArray(attribute?.options)
                    ? attribute.options.map((option) => {
                        const value = toTrimmedString(option?.value || option?.label);
                        const swatch = toTrimmedString(option?.swatch || option?.hex || option?.color);
                        const image = toTrimmedString(option?.image || option?.thumbnail);
                        return [toTrimmedString(option?.label || value), value, swatch, image].filter(Boolean).join('|');
                    })
                    : []
            };
            return result;
        }, {})
        : {};

    const groups = {};
    const sourceGroups = groupsSource && typeof groupsSource === 'object' ? groupsSource : {};
    const groupEntries = Object.keys({ ...fallbackGroups, ...sourceGroups });

    groupEntries.forEach((groupKey) => {
        const current = sourceGroups[groupKey] || fallbackGroups[groupKey] || {};
        groups[groupKey] = {
            enabled: Boolean(current.enabled),
            label: toTrimmedString(current.label, toTrimmedString(groupKey, 'Option')),
            type: ['color', 'size', 'image', 'text'].includes(toTrimmedString(current.type || current.axis, 'text').toLowerCase())
                ? toTrimmedString(current.type || current.axis, 'text').toLowerCase()
                : 'text',
            required: current.required !== false,
            optionTokens: Array.isArray(current.optionTokens)
                ? current.optionTokens.map((entry) => toTrimmedString(entry)).filter(Boolean)
                : Array.isArray(current.options)
                  ? current.options.map((entry) => toTrimmedString(entry)).filter(Boolean)
                  : []
        };
    });

    return {
        enabled: Boolean(source?.enabled),
        optionMode: toTrimmedString(source?.optionMode, 'structured'),
        imagePerColor: Boolean(source?.imagePerColor),
        pricingPerVariant: Boolean(source?.pricingPerVariant),
        inventoryReady: Boolean(source?.inventoryReady),
        skuPerVariant: Boolean(source?.skuPerVariant),
        groups
    };
}

function buildAttributesFromVariantFoundation(variantFoundation, fallbackAttributes = []) {
    const foundation = normalizeVariantFoundation(variantFoundation, fallbackAttributes);

    return Object.entries(foundation.groups)
        .map(([groupKey, group]) => {
            if (!group.enabled) {
                return null;
            }

            const options = normalizeVariantOptions(group.optionTokens.map((token) => splitVariantToken(token).join('|')), group.type)
                .map((option) => ({
                    label: option.label,
                    value: option.value,
                    stock: option.stock,
                    image: group.type === 'color' ? option.image : option.image,
                    swatch: group.type === 'color' ? option.swatch : option.swatch,
                    sku: option.sku,
                    code: option.code,
                    availability: option.availability,
                    isDefault: option.isDefault,
                    priceDelta: option.priceDelta
                }))
                .filter((option) => option.value);

            if (!group.label || !options.length) {
                return null;
            }

            return {
                name: group.label,
                key: groupKey,
                axis: group.type,
                type: group.type,
                required: group.required !== false,
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
    const variantFoundation = normalizeVariantFoundation(payload?.variants, payload?.attributes);
    const normalizedAttributes = buildAttributesFromVariantFoundation(variantFoundation, payload?.attributes);

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
        attributes: normalizedAttributes.length ? normalizedAttributes : normalizeAttributes(payload?.attributes),
        variants: variantFoundation,
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
    const variants = normalizeVariantFoundation(source.variants, source.attributes);
    const attributes = Array.isArray(source.attributes) && source.attributes.length
        ? normalizeAttributes(source.attributes)
        : buildAttributesFromVariantFoundation(variants, source.attributes);

    return {
        ...source,
        id: catalogId,
        priority: normalizePriority(source.priority),
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
        attributes,
        variants,
        url: source.url || buildProductUrl(catalogId),
        page: DEFAULT_DETAIL_PAGE,
        catalogId
    };
}

function sortSerializedProducts(products) {
    return products.slice().sort((left, right) => {
        const leftPriority = normalizePriority(left?.priority);
        const rightPriority = normalizePriority(right?.priority);
        if (leftPriority !== rightPriority) {
            return rightPriority - leftPriority;
        }

        const leftOrder = toNonNegativeNumber(left?.orderIndex, 0);
        const rightOrder = toNonNegativeNumber(right?.orderIndex, 0);
        if (leftOrder !== rightOrder) {
            return rightOrder - leftOrder;
        }

        const rightUpdatedAt = new Date(right?.updatedAt || right?.createdAt || 0).getTime();
        const leftUpdatedAt = new Date(left?.updatedAt || left?.createdAt || 0).getTime();
        if (leftUpdatedAt !== rightUpdatedAt) {
            return rightUpdatedAt - leftUpdatedAt;
        }

        return toNonNegativeNumber(left?.catalogId, 0) - toNonNegativeNumber(right?.catalogId, 0);
    });
}

async function getNextCatalogId() {
    return productDataService.getNextCatalogId();
}

async function findProductByIdentifier(identifier, projection = null) {
    const product = await productDataService.findProductByIdentifier(identifier);
    if (!product) {
        return null;
    }

    if (!projection) {
        return product;
    }

    return product;
}

async function buildCatalogIdFromPayload(payload, fallbackValue) {
    const requestedId = parseCatalogId(payload?.id || payload?.catalogId);
    if (!requestedId) {
        return fallbackValue || getNextCatalogId();
    }

    const existing = await productDataService.findProductByIdentifier(requestedId);
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
        const normalizedProducts = source.map((item) => {
            let catalogId = parseCatalogId(item?.id || item?.catalogId);
            if (!catalogId || usedIds.has(catalogId)) {
                catalogId = usedIds.size + 1;
                while (usedIds.has(catalogId)) {
                    catalogId += 1;
                }
            }

            usedIds.add(catalogId);
            return {
                ...normalizePayload(item),
                catalogId,
                url: buildProductUrl(catalogId)
            };
        });

        const products = await monitorAsyncOperation(logger, 'database.product.list_after_bootstrap', { adminId: req.admin?.id || '' }, () => productDataService.bootstrapProducts(normalizedProducts), { slowThresholdMs: 900 });
        logger.info('inventory.bootstrap_completed', { adminId: req.admin?.id || '', count: products.length });
        return res.json({ success: true, products: sortSerializedProducts(products.map(serializeProduct)) });
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
        const product = await monitorAsyncOperation(logger, 'database.product.create', { catalogId, adminId: req.admin?.id || '', productName: normalized.name, stock: normalized.stock }, () => productDataService.createProduct({
            ...normalized,
            catalogId,
            url: buildProductUrl(catalogId)
        }), { slowThresholdMs: 700 });

        logger.info('inventory.product_created', { adminId: req.admin?.id || '', catalogId, productName: normalized.name, stock: normalized.stock, price: normalized.price });

        try {
            const realtimeService = getRealtimeEventService();
            realtimeService.emitProductUpdated(product._id || product.id, serializeProduct(product));
            realtimeService.emitProductStockChanged(product._id || product.id, 0, Number(product.stock || 0));
            realtimeService.emitAnalyticsUpdated({ source: 'products', action: 'created' });
        } catch (eventError) {
            logger.warn('realtime.event_emit_failed', { error: eventError, scope: 'product.created' });
        }

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

        const limit = Math.min(500, Math.max(1, Number(req.query?.limit || 200) || 200));
        const page = Math.max(1, Number(req.query?.page || 1) || 1);
        const skip = (page - 1) * limit;

        const products = await monitorAsyncOperation(logger, 'database.product.list', { category: filter.category || '', limit, page }, () => productDataService.listProducts({ category: filter.category || '', limit, page }), { slowThresholdMs: 900 });
        return res.json({ success: true, products: sortSerializedProducts(products.map(serializeProduct)) });
    } catch (error) {
        logger.error('inventory.product_list_failed', { error, category: req.query?.category || '' });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getProductById = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'inventory' });
    try {
        const product = await monitorAsyncOperation(logger, 'database.product.find', { requestedProductId: req.params.id }, () => findProductByIdentifier(req.params.id, 'catalogId name title description shortDescription longDescription badge category price oldPrice stock image mainImage gallery keywords highlights trust specs attributes variants visibility priority orderIndex highlightTag status url page updatedAt createdAt'), { slowThresholdMs: 700 });
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
            product = await monitorAsyncOperation(logger, 'database.product.create_on_update_fallback', { catalogId, adminId: req.admin?.id || '', productName: normalized.name }, () => productDataService.createProduct({
                ...normalized,
                catalogId,
                url: buildProductUrl(catalogId)
            }), { slowThresholdMs: 700 });

            logger.info('inventory.product_created_via_update', { adminId: req.admin?.id || '', catalogId, productName: normalized.name });

            return res.status(201).json({ success: true, created: true, product: serializeProduct(product) });
        }

        const previousStock = Number(product.stock || 0);
        product = await monitorAsyncOperation(logger, 'database.product.save_update', { catalogId: product.catalogId, adminId: req.admin?.id || '', productName: normalized.name }, () => productDataService.updateProduct(req.params.id, {
            ...product,
            ...normalized,
            catalogId: product.catalogId,
            title: normalized.name,
            url: buildProductUrl(product.catalogId)
        }), { slowThresholdMs: 700 });

        logger.info('inventory.product_updated', {
            adminId: req.admin?.id || '',
            catalogId: product.catalogId,
            productName: normalized.name,
            previousStock,
            nextStock: Number(product.stock || 0),
            price: Number(product.price || 0)
        });

        try {
            const realtimeService = getRealtimeEventService();
            realtimeService.emitProductUpdated(product._id || product.id, serializeProduct(product));
            if (previousStock !== Number(product.stock || 0)) {
                realtimeService.emitProductStockChanged(product._id || product.id, previousStock, Number(product.stock || 0));
            }
            realtimeService.emitAnalyticsUpdated({ source: 'products', action: 'updated' });
        } catch (eventError) {
            logger.warn('realtime.event_emit_failed', { error: eventError, scope: 'product.updated' });
        }

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

        await monitorAsyncOperation(logger, 'database.product.delete', { catalogId: product.catalogId, adminId: req.admin?.id || '' }, () => productDataService.deleteProduct(req.params.id), { slowThresholdMs: 700 });
        logger.info('inventory.product_deleted', { adminId: req.admin?.id || '', catalogId: product.catalogId, productName: product.name || product.title || '' });

        try {
            const realtimeService = getRealtimeEventService();
            realtimeService.broadcast({
                type: 'product:deleted',
                scope: 'products',
                payload: {
                    productId: product._id || product.id,
                    catalogId: product.catalogId,
                    action: 'deleted'
                }
            });
            realtimeService.emitAnalyticsUpdated({ source: 'products', action: 'deleted' });
        } catch (eventError) {
            logger.warn('realtime.event_emit_failed', { error: eventError, scope: 'product.deleted' });
        }

        return res.json({ success: true, id: product.catalogId });
    } catch (error) {
        logger.error('inventory.product_delete_failed', { error, requestedProductId: req.params.id });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};
