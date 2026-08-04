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
const sqliteMessageRepository = require('./sqlite/message.repository');

const sqliteRepositories = {
    activity: sqliteActivityRepository,
    carts: sqliteCartRepository,
    categories: sqliteCategoryRepository,
    products: sqliteProductRepository,
    orders: sqliteOrderRepository,
    reviews: sqliteReviewRepository,
    settings: sqliteSettingsRepository,
    storefrontStates: sqliteStorefrontStateRepository,
    users: sqliteUserRepository,
    messages: sqliteMessageRepository
};

function getRepositoryBundle() {
    if (config.databaseClient === 'sqlite') {
        return sqliteRepositories;
    }

    throw new Error(
        `Repository bundle is only available for DB_CLIENT=sqlite (received "${config.databaseClient}"). ` +
        'Mongo repositories are not implemented; set DB_CLIENT=sqlite or implement a mongo repository bundle.'
    );
}

module.exports = {
    getRepositoryBundle,
    repositoryProvider: config.databaseClient,
    sqliteRepositories
};