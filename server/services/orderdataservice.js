const { getRepositoryBundle } = require('../repositories');

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.orders) {
        throw new Error('Order data service requires the SQLite repository bundle.');
    }

    return repositories;
}

async function createOrder(order) {
    return getRepos().orders.create(order);
}

async function findOrderByIdentifier(identifier) {
    return getRepos().orders.findByIdentifier(identifier);
}

async function listOrdersForUser(user) {
    return getRepos().orders.listForUser(user);
}

async function listAdminPaymentActivity(options = {}) {
    const limit = Math.min(200, Math.max(1, Number(options.limit || 12) || 12));
    return getRepos().orders.listForAdminPaymentActivity({
        mode: options.mode === 'test' ? 'test' : 'live',
        limit
    });
}

async function saveOrder(order) {
    return getRepos().orders.save(order);
}

async function deleteOrder(identifier) {
    return getRepos().orders.remove(identifier);
}

module.exports = {
    createOrder,
    deleteOrder,
    findOrderByIdentifier,
    listAdminOrders,
    listAdminPaymentActivity,
    listOrdersForUser,
    saveOrder
};