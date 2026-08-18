const { getRepositoryBundle } = require('../repositories');
const { collectProductManagedPaths, deleteManagedFiles, normalizeManagedPath, productImageStem } = require('./uploadstorage.service');
const productSearchService = require('./productsearch.service');
const { isProductPublished } = require('../utils/product-visibility');
const { queryCache } = require('./querycache.service');

const PRODUCT_LIST_TTL_MS = 20000;
const CATEGORY_LIST_TTL_MS = 60000;

function decorateProduct(product) {
    if (!product || typeof product !== 'object') {
        return product;
    }

    const mainImageStoragePath = normalizeManagedPath(product.mainImageStoragePath || product.mainImage || product.image);
    const galleryStoragePaths = Array.isArray(product.galleryStoragePaths) && product.galleryStoragePaths.length
        ? Array.from(new Set(product.galleryStoragePaths.map((entry) => normalizeManagedPath(entry)).filter(Boolean)))
        : Array.isArray(product.gallery)
            ? product.gallery.map((entry) => normalizeManagedPath(entry)).filter(Boolean)
            : [];

    return {
        ...product,
        thumbnail: String(product.mainImage || product.image || '').trim(),
        mainImageStoragePath,
        galleryStoragePaths
    };
}

function collectRemovedPaths(previousProduct, nextProduct, incomingProduct = null) {
    const previousPaths = new Set(collectProductManagedPaths(previousProduct));
    const nextPaths = new Set(collectProductManagedPaths(nextProduct));
    const nextStems = new Set(Array.from(nextPaths).map((entry) => productImageStem(entry)).filter(Boolean));
    const incomingStems = new Set(collectProductManagedPaths(incomingProduct || nextProduct)
        .map((entry) => productImageStem(entry))
        .filter(Boolean));
    return Array.from(previousPaths).filter((entry) => {
        if (nextPaths.has(entry)) {
            return false;
        }
        const stem = productImageStem(entry);
        if (stem && (nextStems.has(stem) || incomingStems.has(stem))) {
            return false;
        }
        return true;
    });
}

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.products) {
        throw new Error('Product data service requires the SQLite repository bundle.');
    }

    return repositories;
}

async function listProducts(options = {}) {
    const page = Math.max(1, Number(options.page || 1) || 1);
    const limit = Math.min(500, Math.max(1, Number(options.limit || 120) || 120));
    const offset = (page - 1) * limit;
    const category = String(options.category || '').trim().toLowerCase();
    const publicOnly = Boolean(options.publicOnly);
    const columns = options.columns === 'card' ? 'card' : 'full';
    const cacheKey = `products:list:${category}:${page}:${limit}:${publicOnly ? 1 : 0}:${columns}`;

    return queryCache.remember(cacheKey, PRODUCT_LIST_TTL_MS, async () => {
        const { products } = getRepos();
        let results = await products.list({
            category,
            limit,
            offset,
            publishedOnly: publicOnly,
            columns
        });
        if (publicOnly) {
            results = results.filter((product) => isProductPublished(product));
        }
        return results.map((product) => decorateProduct(product));
    });
}

async function listAllProducts() {
    return (await getRepos().products.listAll()).map((product) => decorateProduct(product));
}

async function findProductByIdentifier(identifier) {
    return decorateProduct(await getRepos().products.findByIdentifier(identifier));
}

async function getNextCatalogId() {
    return getRepos().products.getNextCatalogId();
}

async function createProduct(product) {
    const saved = decorateProduct(await getRepos().products.save(product));
    queryCache.bump('products');
    queryCache.bump('search');
    return saved;
}

async function updateProduct(identifier, product) {
    const previousProduct = await getRepos().products.findByIdentifier(identifier);
    const savedProduct = await getRepos().products.save(product, { identifier });
    const imagesChanged = Boolean(product?.imagesChanged) && !product?.preserveExistingImages;
    if (imagesChanged) {
        const removedPaths = collectRemovedPaths(previousProduct, savedProduct, product);
        const nextPaths = collectProductManagedPaths(savedProduct);
        const nextStems = new Set(nextPaths.map((entry) => productImageStem(entry)).filter(Boolean));
        if (removedPaths.length && nextPaths.length && nextStems.size) {
            deleteManagedFiles(removedPaths);
        }
    }
    queryCache.bump('products');
    queryCache.bump('search');
    return decorateProduct(savedProduct);
}

async function deleteProduct(identifier) {
    const deletedProduct = await getRepos().products.remove(identifier);
    deleteManagedFiles(collectProductManagedPaths(deletedProduct));
    queryCache.bump('products');
    queryCache.bump('search');
    return decorateProduct(deletedProduct);
}

async function bootstrapProducts(items) {
    const saved = (await getRepos().products.upsertMany(items)).map((product) => decorateProduct(product));
    queryCache.bump('products');
    queryCache.bump('search');
    return saved;
}

async function listCategories() {
    return queryCache.remember('products:categories', CATEGORY_LIST_TTL_MS, () => getRepos().categories.list());
}

async function listProductReviews(productId) {
    return getRepos().reviews.listForProduct(productId);
}

async function searchProducts(options = {}) {
    const query = String(options.query || options.q || '').trim().toLowerCase();
    const category = String(options.category || '').trim().toLowerCase();
    const limit = Math.min(120, Math.max(1, Number(options.limit || 60) || 60));
    const cacheKey = `search:products:${query}:${category}:${limit}`;

    return queryCache.remember(cacheKey, PRODUCT_LIST_TTL_MS, async () => {
        const results = await productSearchService.searchProducts(options);
        return results.map((product) => decorateProduct(product));
    });
}

async function getSearchSuggestions(options = {}) {
    const query = String(options.query || options.q || '').trim().toLowerCase();
    const limit = Math.min(12, Math.max(1, Number(options.limit || 8) || 8));
    return queryCache.remember(`search:suggestions:${query}:${limit}`, PRODUCT_LIST_TTL_MS, () => (
        productSearchService.getSearchSuggestions(options)
    ));
}

async function getPopularSearchTerms(options = {}) {
    const limit = Math.min(12, Math.max(1, Number(options.limit || 8) || 8));
    return queryCache.remember(`search:popular:${limit}`, CATEGORY_LIST_TTL_MS, () => (
        productSearchService.getPopularSearchTerms(options)
    ));
}

function getRelatedSearchCategories(query, products = []) {
    return productSearchService.getRelatedCategories(query, products);
}

module.exports = {
    bootstrapProducts,
    createProduct,
    deleteProduct,
    findProductByIdentifier,
    getNextCatalogId,
    getPopularSearchTerms,
    getRelatedSearchCategories,
    getSearchSuggestions,
    listAllProducts,
    listCategories,
    listProductReviews,
    listProducts,
    searchProducts,
    updateProduct
};
