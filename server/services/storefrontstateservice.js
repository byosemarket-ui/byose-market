const { getRepositoryBundle } = require('../repositories');

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.storefrontStates) {
        throw new Error('Storefront state service requires the SQLite repository bundle.');
    }

    return repositories;
}

async function getStateForUser(user) {
    const state = await getRepos().storefrontStates.findByUserId(user.recordId);
    return state || {
        userId: user.recordId,
        userPublicId: user.id,
        email: user.email || '',
        phone: user.phone || '',
        cartItems: [],
        directCheckout: null,
        checkoutDraft: null,
        checkoutConfirmation: null,
        updatedAt: null,
        lastCartSyncedAt: null,
        lastDraftSyncedAt: null,
        lastCheckoutSyncedAt: null
    };
}

async function saveStateForUser(user, payload) {
    return getRepos().storefrontStates.upsert({
        userId: user.recordId,
        userPublicId: user.id,
        email: user.email || '',
        phone: user.phone || '',
        cartItems: payload.cartItems,
        directCheckout: Object.prototype.hasOwnProperty.call(payload, 'directCheckout') ? payload.directCheckout : undefined,
        checkoutDraft: Object.prototype.hasOwnProperty.call(payload, 'checkoutDraft') ? payload.checkoutDraft : undefined,
        checkoutConfirmation: Object.prototype.hasOwnProperty.call(payload, 'checkoutConfirmation') ? payload.checkoutConfirmation : undefined,
        lastCartSyncedAt: payload.lastCartSyncedAt,
        lastDraftSyncedAt: payload.lastDraftSyncedAt,
        lastCheckoutSyncedAt: payload.lastCheckoutSyncedAt
    });
}

module.exports = {
    getStateForUser,
    saveStateForUser
};