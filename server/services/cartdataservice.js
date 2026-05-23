const { getRepositoryBundle } = require('../repositories');
const { findProductByIdentifier } = require('./productdataservice');

function normalizeText(value) {
    return String(value || '').trim();
}

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.carts || !repositories.products) {
        throw new Error('Cart data service requires the SQLite repository bundle.');
    }

    return repositories;
}

async function enrichCart(cart, user) {
    const items = Array.isArray(cart?.items) ? cart.items : [];
    const hydratedItems = [];

    for (const item of items) {
        const product = await findProductByIdentifier(item.productId || item.id);
        hydratedItems.push({
            product: product
                ? {
                    _id: String(product.catalogId),
                    id: product.catalogId,
                    catalogId: product.catalogId,
                    name: product.name,
                    title: product.title,
                    price: Number(product.price || 0),
                    stock: Number(product.stock || 0),
                    image: product.image || product.mainImage || '',
                    mainImage: product.mainImage || product.image || ''
                }
                : null,
            productId: normalizeText(item.productId || item.id),
            quantity: Math.max(1, Number(item.quantity || 1) || 1)
        });
    }

    return {
        id: String(cart?.id || user?.id || ''),
        user: user?.id || '',
        userId: user?.id || '',
        items: hydratedItems,
        createdAt: cart?.createdAt || null,
        updatedAt: cart?.updatedAt || null
    };
}

async function getCartForUser(user) {
    const { carts } = getRepos();
    const cart = await carts.findByUserId(user.recordId);
    return enrichCart(cart || { items: [] }, user);
}

async function addToCart(user, payload) {
    const { carts } = getRepos();
    const productId = normalizeText(payload?.productId || payload?.id);
    const quantity = Math.max(1, Number(payload?.quantity || 1) || 1);
    const product = await findProductByIdentifier(productId);
    if (!product) {
        return null;
    }

    const cart = await carts.findByUserId(user.recordId);
    const items = Array.isArray(cart?.items) ? cart.items.slice() : [];
    const index = items.findIndex((entry) => normalizeText(entry.productId || entry.id) === String(product.catalogId));
    if (index >= 0) {
        items[index] = {
            ...items[index],
            productId: String(product.catalogId),
            quantity: Math.max(1, Number(items[index].quantity || 1) || 1) + quantity
        };
    } else {
        items.push({ productId: String(product.catalogId), quantity });
    }

    const saved = await carts.saveForUser(user.recordId, items);
    return enrichCart(saved, user);
}

async function removeFromCart(user, payload) {
    const { carts } = getRepos();
    const productId = normalizeText(payload?.productId || payload?.id);
    const removeAll = Boolean(payload?.removeAll);
    const cart = await carts.findByUserId(user.recordId);
    if (!cart) {
        return null;
    }

    const items = Array.isArray(cart.items) ? cart.items.slice() : [];
    const index = items.findIndex((entry) => normalizeText(entry.productId || entry.id) === productId);
    if (index < 0) {
        return null;
    }

    if (removeAll || Number(items[index].quantity || 1) <= 1) {
        items.splice(index, 1);
    } else {
        items[index] = {
            ...items[index],
            quantity: Math.max(1, Number(items[index].quantity || 1) - 1)
        };
    }

    const saved = await carts.saveForUser(user.recordId, items);
    return enrichCart(saved, user);
}

async function clearCart(user) {
    const { carts } = getRepos();
    const saved = await carts.clearForUser(user.recordId);
    return enrichCart(saved, user);
}

async function listAllCarts(users = []) {
    const { carts } = getRepos();
    const userLookup = new Map((Array.isArray(users) ? users : []).map((user) => [String(user.recordId), user]));
    const rows = await carts.listAll();
    const serialized = [];
    for (const row of rows) {
        serialized.push(await enrichCart(row, userLookup.get(String(row.userId)) || null));
    }
    return serialized;
}

module.exports = {
    addToCart,
    clearCart,
    getCartForUser,
    listAllCarts,
    removeFromCart
};