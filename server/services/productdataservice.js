const { getRepositoryBundle } = require('../repositories');
const { collectProductManagedPaths, deleteManagedFiles, normalizeManagedPath } = require('./uploadstorage.service');

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


function collectRemovedPaths(previousProduct, nextProduct) {
    const previousPaths = new Set(collectProductManagedPaths(previousProduct));
    const nextPaths = new Set(collectProductManagedPaths(nextProduct));
    return Array.from(previousPaths).filter((entry) => !nextPaths.has(entry));
}

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.products) {
        throw new Error('Product data service requires the SQLite repository bundle.');
    }

    return repositories;
}

async function listProducts(options = {}) {
    const { products } = getRepos();
    const page = Math.max(1, Number(options.page || 1) || 1);
    const limit = Math.min(500, Math.max(1, Number(options.limit || 200) || 200));
    const offset = (page - 1) * limit;
    return (await products.list({ category: options.category || '', limit, offset })).map((product) => decorateProduct(product));
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
    return decorateProduct(await getRepos().products.save(product));
}

async function updateProduct(identifier, product) {
    const previousProduct = await getRepos().products.findByIdentifier(identifier);
    const savedProduct = await getRepos().products.save(product, { identifier });
    deleteManagedFiles(collectRemovedPaths(previousProduct, savedProduct));
    return decorateProduct(savedProduct);
}

async function deleteProduct(identifier) {
    const deletedProduct = await getRepos().products.remove(identifier);
    deleteManagedFiles(collectProductManagedPaths(deletedProduct));
    return decorateProduct(deletedProduct);
}

async function bootstrapProducts(items) {
    return (await getRepos().products.upsertMany(items)).map((product) => decorateProduct(product));
}

async function listCategories() {
    return getRepos().categories.list();
}

async function listProductReviews(productId) {
    return getRepos().reviews.listForProduct(productId);
}

module.exports = {
    bootstrapProducts,
    createProduct,
    deleteProduct,
    findProductByIdentifier,
    getNextCatalogId,
    listAllProducts,
    listCategories,
    listProductReviews,
    listProducts,
    updateProduct
};