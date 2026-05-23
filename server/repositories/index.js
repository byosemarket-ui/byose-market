const config = require('../config/env');
const sqliteActivityRepository = require('./sqlite/activity.repository');
const sqliteCartRepository = require('./sqlite/cart.repository');
const sqliteCategoryRepository = require('./sqlite/category.repository');
const sqliteProductRepository = require('./sqlite/product.repository');
const sqliteOrderRepository = require('./sqlite/order.repository');
const sqliteReviewRepository = require('./sqlite/review.repository');
const sqliteSettingsRepository = require('./sqlite/settings.repository');
const sqliteStorefrontStateRepository = require('./sqlite/storefront-state.repository');
const sqliteUserRepository = require('./sqlite/user.repository');

const sqliteRepositories = {
    activity: sqliteActivityRepository,
    carts: sqliteCartRepository,
    categories: sqliteCategoryRepository,
    products: sqliteProductRepository,
    orders: sqliteOrderRepository,
    reviews: sqliteReviewRepository,
    settings: sqliteSettingsRepository,
    storefrontStates: sqliteStorefrontStateRepository,
    users: sqliteUserRepository
};

function getRepositoryBundle() {
    if (config.databaseClient === 'sqlite') {
        return sqliteRepositories;
    }

    return {};
}

module.exports = {
    getRepositoryBundle,
    repositoryProvider: config.databaseClient,
    sqliteRepositories
};