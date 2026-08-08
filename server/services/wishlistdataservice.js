const { getRepositoryBundle } = require('../repositories');
const { findProductByIdentifier } = require('./productdataservice');

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.wishlist) {
        throw new Error('Wishlist data service requires the SQLite repository bundle.');
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
        const repositories = getRepositoryBundle();
        if (!repositories.reviews || !product?.recordId) {
            return { rating: null, reviewCount: 0 };
        }

        const reviews = await repositories.reviews.listForProduct(product.recordId);
        if (!Array.isArray(reviews) || !reviews.length) {
            return { rating: null, reviewCount: 0 };
        }

        const total = reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0);
        const average = total / reviews.length;
        return {
            rating: Number(average.toFixed(1)),
            reviewCount: reviews.length
        };
    } catch (_error) {
        return { rating: null, reviewCount: 0 };
    }
}

async function toWishlistProduct(product) {
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
            addedAt: item.createdAt,
            product: await toWishlistProduct(product)
        });
    }
    return enriched;
}

async function getWishlistForUser(user) {
    const { wishlist } = getRepos();
    const items = await wishlist.listByUserId(user.recordId);
    const enriched = await enrichItems(items);
    return {
        items: enriched,
        count: enriched.length
    };
}

async function addToWishlist(user, payload) {
    const { wishlist } = getRepos();
    const productId = normalizeProductId(payload?.productId || payload?.id);
    if (!productId) {
        return { error: 'productId required', status: 400 };
    }

    const product = await findProductByIdentifier(productId);
    if (!product) {
        return { error: 'Product not found', status: 404 };
    }

    await wishlist.addItem(user.recordId, {
        productId: product.recordId || product.id || null,
        productCatalogId: String(product.catalogId)
    });

    return { data: await getWishlistForUser(user) };
}

async function removeFromWishlist(user, productId) {
    const { wishlist } = getRepos();
    const normalized = normalizeProductId(productId);
    if (!normalized) {
        return { error: 'productId required', status: 400 };
    }

    const removed = await wishlist.removeItem(user.recordId, normalized);
    if (!removed) {
        return { error: 'Item not in wishlist', status: 404 };
    }

    return { data: await getWishlistForUser(user) };
}

async function clearWishlist(user) {
    const { wishlist } = getRepos();
    await wishlist.clearForUser(user.recordId);
    return { data: await getWishlistForUser(user) };
}

async function getWishlistIdsForUser(user) {
    const { wishlist } = getRepos();
    const items = await wishlist.listByUserId(user.recordId);
    return {
        ids: items.map((item) => String(item.productCatalogId)),
        count: items.length
    };
}

async function getWishlistCount(user) {
    const { wishlist } = getRepos();
    return { count: await wishlist.countByUserId(user.recordId) };
}

async function mergeWishlist(user, payload) {
    const { wishlist } = getRepos();
    const productIds = Array.isArray(payload?.productIds)
        ? payload.productIds
        : (Array.isArray(payload?.ids) ? payload.ids : []);
    const uniqueIds = Array.from(new Set(productIds.map((id) => normalizeProductId(id)).filter(Boolean)));

    // Batch insert without reloading the full enriched wishlist on each add.
    for (const productId of uniqueIds) {
        const product = await findProductByIdentifier(productId);
        if (!product) continue;
        await wishlist.addItem(user.recordId, {
            productId: product.recordId || product.id || null,
            productCatalogId: String(product.catalogId)
        });
    }

    return { data: await getWishlistForUser(user) };
}

module.exports = {
    getWishlistForUser,
    getWishlistIdsForUser,
    getWishlistCount,
    addToWishlist,
    removeFromWishlist,
    clearWishlist,
    mergeWishlist
};
