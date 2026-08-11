/**
 * Payment provider registry — add new providers here without rebuilding the payment system.
 */

const dpoProvider = require('./dpo.provider');

const PROVIDERS = Object.freeze({
    [dpoProvider.id]: dpoProvider
});

const PROVIDER_ORDER = Object.freeze([dpoProvider.id]);

function listProviders() {
    return PROVIDER_ORDER.map((id) => PROVIDERS[id]).filter(Boolean);
}

function getProvider(providerId) {
    const id = String(providerId || '').trim().toLowerCase();
    return PROVIDERS[id] || null;
}

function isKnownProvider(providerId) {
    return Boolean(getProvider(providerId));
}

function getDefaultProviderId() {
    return PROVIDER_ORDER[0] || 'dpo';
}

module.exports = {
    PROVIDERS,
    PROVIDER_ORDER,
    listProviders,
    getProvider,
    isKnownProvider,
    getDefaultProviderId
};
