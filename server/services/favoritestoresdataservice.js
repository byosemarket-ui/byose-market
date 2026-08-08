const { getRepositoryBundle } = require('../repositories');
const { listProducts } = require('./productdataservice');
const { isProductPublished } = require('../utils/product-visibility');

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.stores) {
        throw new Error('Favorite store data service requires the SQLite repository bundle.');
    }
    return repositories;
}

function normalizeIdentifier(value) {
    return String(value || '').trim();
}

async function countStoreProducts(store) {
    const metadata = store?.metadata && typeof store.metadata === 'object' ? store.metadata : {};
    const scope = String(metadata.productScope || (metadata.isPlatformStore ? 'all' : 'category')).toLowerCase();

    try {
        const { getRepositoryBundle } = require('../repositories');
        const { products } = getRepositoryBundle();
        if (!products?.db && !products?.countPublished) {
            // Fallback: use raw count via list if helper missing
        }

        const db = products.db || require('../database/sqlite/client').getClient();
        const publishedClause = typeof products.publishedClause === 'function'
            ? products.publishedClause()
            : 'is_published = 1';

        if (scope === 'all' || metadata.isPlatformStore) {
            const row = db.prepare(`SELECT COUNT(*) AS total FROM products WHERE ${publishedClause}`).get();
            return Number(row?.total || 0);
        }

        const categorySlug = String(metadata.categorySlug || store.category || '').trim().toLowerCase();
        if (!categorySlug) return 0;
        const row = db.prepare(`
            SELECT COUNT(*) AS total FROM products
            WHERE ${publishedClause} AND lower(category_slug) = ?
        `).get(categorySlug);
        return Number(row?.total || 0);
    } catch (_error) {
        return 0;
    }
}

async function listStoreProducts(store, { limit = 24 } = {}) {
    const metadata = store?.metadata && typeof store.metadata === 'object' ? store.metadata : {};
    const scope = String(metadata.productScope || (metadata.isPlatformStore ? 'all' : 'category')).toLowerCase();
    const safeLimit = Math.min(60, Math.max(1, Number(limit) || 24));

    let products = [];
    if (scope === 'all' || metadata.isPlatformStore) {
        products = await listProducts({ page: 1, limit: safeLimit, publicOnly: true, columns: 'card' });
    } else {
        const categorySlug = String(metadata.categorySlug || store.category || '').trim().toLowerCase();
        products = await listProducts({
            page: 1,
            limit: safeLimit,
            category: categorySlug,
            publicOnly: true,
            columns: 'card'
        });
    }

    return (Array.isArray(products) ? products : []).filter((product) => isProductPublished(product));
}

async function enrichStore(store, { user = null } = {}) {
    if (!store) return null;
    const { stores } = getRepos();
    const [productCount, followerCount] = await Promise.all([
        countStoreProducts(store),
        stores.countFollowers(store.id)
    ]);

    let isFavorite = false;
    let notificationPrefs = null;
    if (user?.recordId) {
        const favorite = await stores.findFavorite(user.recordId, store.id);
        isFavorite = Boolean(favorite);
        if (favorite) {
            notificationPrefs = {
                notifyNewProducts: Boolean(favorite.notifyNewProducts),
                notifyOffers: Boolean(favorite.notifyOffers),
                notifyAnnouncements: Boolean(favorite.notifyAnnouncements)
            };
        }
    }

    const rating = Number(store.rating || 0);

    return {
        id: store.id,
        publicId: store.publicId,
        name: store.name,
        slug: store.slug,
        description: store.description,
        logo: store.logo || '/img/logo.png',
        banner: store.banner || '',
        status: store.status,
        category: store.category || store.metadata?.category || 'Marketplace',
        location: store.location || store.metadata?.location || '',
        rating,
        reviewCount: Number(store.reviewCount || 0),
        productCount,
        followerCount,
        isFavorite,
        notificationPrefs,
        metadata: store.metadata || {},
        url: `store.html?slug=${encodeURIComponent(store.slug || store.publicId)}`
    };
}

async function getFavoriteStores(user) {
    const { stores } = getRepos();
    const favorites = await stores.listFavoritesByUserId(user.recordId);
    const items = [];

    for (const entry of favorites) {
        if (!entry.store) continue;
        const store = await enrichStore(entry.store, { user });
        items.push({
            id: entry.id,
            followedAt: entry.createdAt,
            notificationPrefs: {
                notifyNewProducts: Boolean(entry.notifyNewProducts),
                notifyOffers: Boolean(entry.notifyOffers),
                notifyAnnouncements: Boolean(entry.notifyAnnouncements)
            },
            store
        });
    }

    return { items, count: items.length };
}

async function listDiscoverableStores(user = null) {
    const { stores } = getRepos();
    const active = await stores.listActive();
    const enriched = [];
    for (const store of active) {
        enriched.push(await enrichStore(store, { user }));
    }
    return enriched;
}

async function getStoreByIdentifier(identifier, user = null) {
    const { stores } = getRepos();
    const store = await stores.findByPublicIdOrSlug(normalizeIdentifier(identifier));
    if (!store || store.status !== 'active') {
        return { error: 'Store not found', status: 404 };
    }

    const enriched = await enrichStore(store, { user });
    const products = await listStoreProducts(store, { limit: 24 });
    return {
        data: {
            store: enriched,
            products
        }
    };
}

async function followStore(user, payload) {
    const { stores } = getRepos();
    const identifier = normalizeIdentifier(payload?.storeId || payload?.id || payload?.slug);
    if (!identifier) {
        return { error: 'storeId required', status: 400 };
    }

    const store = await stores.findByPublicIdOrSlug(identifier);
    if (!store || store.status !== 'active') {
        return { error: 'Store not found', status: 404 };
    }

    await stores.follow(user.recordId, store.id);
    return { data: await getFavoriteStores(user) };
}

async function unfollowStore(user, storeId) {
    const { stores } = getRepos();
    const identifier = normalizeIdentifier(storeId);
    if (!identifier) {
        return { error: 'storeId required', status: 400 };
    }

    const store = await stores.findByPublicIdOrSlug(identifier);
    if (!store) {
        return { error: 'Store not found', status: 404 };
    }

    const removed = await stores.unfollow(user.recordId, store.id);
    if (!removed) {
        return { error: 'Store is not in favorites', status: 404 };
    }

    return { data: await getFavoriteStores(user) };
}

async function updateNotificationPrefs(user, storeId, prefs) {
    const { stores } = getRepos();
    const identifier = normalizeIdentifier(storeId);
    const store = await stores.findByPublicIdOrSlug(identifier);
    if (!store) {
        return { error: 'Store not found', status: 404 };
    }

    const updated = await stores.updateNotificationPrefs(user.recordId, store.id, prefs || {});
    if (!updated) {
        return { error: 'Follow this store before updating notification preferences.', status: 400 };
    }

    return {
        data: {
            storeId: store.publicId || store.id,
            publicId: store.publicId,
            slug: store.slug,
            notificationPrefs: {
                notifyNewProducts: Boolean(updated.notifyNewProducts),
                notifyOffers: Boolean(updated.notifyOffers),
                notifyAnnouncements: Boolean(updated.notifyAnnouncements)
            }
        }
    };
}

module.exports = {
    getFavoriteStores,
    listDiscoverableStores,
    getStoreByIdentifier,
    followStore,
    unfollowStore,
    updateNotificationPrefs
};
