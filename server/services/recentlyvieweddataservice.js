const { getRepositoryBundle } = require('../repositories');
const { findProductByIdentifier } = require('./productdataservice');

const HISTORY_LIMIT = 40;

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.recentlyViewed) {
        throw new Error('Recently viewed data service requires the SQLite repository bundle.');
    }
    return repositories;
}

function normalizeProductId(value) {
    return String(value || '').trim();
}

function resolveDiscount(product) {
    const price = Math.max(0, Number(product?.price || 0));
    const oldPrice = Math.max(0, Number(product?.oldPrice || 0));
    const metadata = product?.metadata && typeof product.metadata === 'object' ? product.metadata : {};
    const hasDiscount = oldPrice > price && price > 0;
    const storedPercent = Number(metadata.discountPercent ?? product?.discountPercent ?? 0);
    const discountPercent = hasDiscount
        ? (storedPercent > 0
            ? Math.max(0, Math.min(100, Math.round(storedPercent)))
            : Math.round(((oldPrice - price) / oldPrice) * 100))
        : 0;

    return {
        price,
        oldPrice: hasDiscount ? oldPrice : 0,
        discountPercent,
        hasDiscount
    };
}

function stockLabelFor(stock) {
    const qty = Number(stock || 0);
    if (qty <= 0) return 'Out of stock';
    if (qty <= 5) return `Only ${qty} left`;
    return 'In stock';
}

async function resolveRating(product) {
    try {
        const { getRepositoryBundle } = require('../repositories');
        const bundle = getRepositoryBundle();
        if (!bundle.reviews || !product?.recordId) {
            return { rating: null, reviewCount: 0 };
        }

        const reviews = await bundle.reviews.listForProduct(product.recordId);
        if (!Array.isArray(reviews) || !reviews.length) {
            return { rating: null, reviewCount: 0 };
        }

        const total = reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0);
        return {
            rating: Number((total / reviews.length).toFixed(1)),
            reviewCount: reviews.length
        };
    } catch (_error) {
        return { rating: null, reviewCount: 0 };
    }
}

async function toProductSummary(product) {
    if (!product) {
        return null;
    }

    const discount = resolveDiscount(product);
    const ratingInfo = await resolveRating(product);
    const stock = Number(product.stock || 0);

    return {
        id: String(product.catalogId),
        catalogId: product.catalogId,
        name: product.name || product.title || 'Product',
        title: product.title || product.name || 'Product',
        price: discount.price,
        oldPrice: discount.oldPrice,
        discountPercent: discount.discountPercent,
        hasDiscount: discount.hasDiscount,
        image: product.image || product.mainImage || '',
        mainImage: product.mainImage || product.image || '',
        stock,
        inStock: stock > 0,
        stockLabel: stockLabelFor(stock),
        rating: ratingInfo.rating,
        reviewCount: ratingInfo.reviewCount,
        status: product.status || 'active',
        page: product.page || 'product-details1.html',
        url: product.url || ''
    };
}

async function enrichItems(items) {
    const enriched = [];
    for (const item of items) {
        const product = await findProductByIdentifier(item.productCatalogId);
        enriched.push({
            id: item.id,
            productId: item.productCatalogId,
            viewedAt: item.viewedAt,
            product: await toProductSummary(product)
        });
    }
    return enriched;
}

async function getHistoryForUser(user, { limit = HISTORY_LIMIT } = {}) {
    const { recentlyViewed } = getRepos();
    const [items, count] = await Promise.all([
        recentlyViewed.listByUserId(user.recordId, { limit }),
        recentlyViewed.countByUserId(user.recordId)
    ]);
    const enriched = await enrichItems(items);
    return {
        items: enriched,
        count
    };
}

async function getHistoryCountForUser(user) {
    const { recentlyViewed } = getRepos();
    const count = await recentlyViewed.countByUserId(user.recordId);
    return { count };
}

async function addViewedProduct(user, payload) {
    const { recentlyViewed } = getRepos();
    const productId = normalizeProductId(payload?.productId || payload?.id);
    if (!productId) {
        return { error: 'productId required', status: 400 };
    }

    const product = await findProductByIdentifier(productId);
    if (!product) {
        return { error: 'Product not found', status: 404 };
    }

    const catalogId = String(product.catalogId);

    await recentlyViewed.upsertView(user.recordId, {
        productId: product.recordId || product.id || null,
        productCatalogId: catalogId
    });
    await recentlyViewed.trimForUser(user.recordId, HISTORY_LIMIT);

    const count = await recentlyViewed.countByUserId(user.recordId);
    return {
        data: {
            items: [],
            count,
            productId: catalogId,
            viewedAt: new Date().toISOString()
        }
    };
}

async function removeViewedProduct(user, productId) {
    const { recentlyViewed } = getRepos();
    const normalized = normalizeProductId(productId);
    if (!normalized) {
        return { error: 'productId required', status: 400 };
    }

    const removed = await recentlyViewed.removeItem(user.recordId, normalized);
    if (!removed) {
        return { error: 'Item not in recently viewed', status: 404 };
    }

    return { data: await getHistoryForUser(user) };
}

async function clearHistory(user) {
    const { recentlyViewed } = getRepos();
    await recentlyViewed.clearForUser(user.recordId);
    return { data: await getHistoryForUser(user) };
}

async function mergeHistory(user, payload = {}) {
    const { recentlyViewed } = getRepos();
    const productIds = Array.isArray(payload?.productIds)
        ? payload.productIds
        : (Array.isArray(payload?.ids) ? payload.ids : []);

    // Oldest first so newest ends on top after sequential upserts.
    const ordered = productIds
        .map((entry) => (typeof entry === 'object'
            ? normalizeProductId(entry.productId || entry.id || entry.catalogId)
            : normalizeProductId(entry)))
        .filter(Boolean)
        .reverse();

    const unique = [];
    const seen = new Set();
    for (const id of ordered) {
        if (seen.has(id)) continue;
        seen.add(id);
        unique.push(id);
    }

    for (const productId of unique) {
        const product = await findProductByIdentifier(productId);
        if (!product) continue;
        await recentlyViewed.upsertView(user.recordId, {
            productId: product.recordId || product.id || null,
            productCatalogId: String(product.catalogId)
        });
    }
    await recentlyViewed.trimForUser(user.recordId, HISTORY_LIMIT);

    return { data: await getHistoryForUser(user) };
}

module.exports = {
    getHistoryForUser,
    getHistoryCountForUser,
    addViewedProduct,
    removeViewedProduct,
    clearHistory,
    mergeHistory
};
