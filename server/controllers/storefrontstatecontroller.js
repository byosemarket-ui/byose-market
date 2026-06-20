const { appLogger } = require('../utils/logger');
const storefrontStateService = require('../services/storefrontstateservice');
const userDataService = require('../services/userdataservice');

async function resolveUser(req) {
    if (!req.user || !req.user.id) {
        return null;
    }

    return userDataService.findUserById(req.user.id);
}

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeEmail(value) {
    return normalizeText(value).toLowerCase();
}

function normalizePhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) {
        return '';
    }

    if (digits.startsWith('250') && digits.length === 12) {
        return `+${digits}`;
    }

    if (digits.startsWith('0') && digits.length === 10) {
        return `+250${digits.slice(1)}`;
    }

    if (digits.length === 9) {
        return `+250${digits}`;
    }

    return digits.startsWith('+') ? digits : `+${digits}`;
}

function sanitizeAttributes(attributes) {
    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(attributes).filter(([, value]) => value !== undefined && value !== null && value !== '')
    );
}

function sanitizeCartItem(item) {
    if (!item || typeof item !== 'object') {
        return null;
    }

    const attributes = sanitizeAttributes(item.attributes || {});
    const quantity = Math.max(1, Number(item.qty || item.quantity || 1) || 1);
    const price = Number(item.price || 0) || 0;
    const image = normalizeText(item.image || item.img || item.imageUrl || item.productImage || item.mainImage || item.thumbnail);

    return {
        id: normalizeText(item.id || item.productId || item.name),
        productId: normalizeText(item.productId || item.id),
        name: normalizeText(item.name || item.productName) || 'Product',
        price,
        qty: quantity,
        quantity,
        image,
        img: image,
        imageUrl: image,
        productImage: image,
        mainImage: image,
        thumbnail: image,
        attributes,
        attributeSummary: normalizeText(item.attributeSummary),
        variantKey: normalizeText(item.variantKey || item.variantSelection?.key),
        variantType: normalizeText(item.variantType || item.variantSelection?.type),
        variantSelection: item.variantSelection && typeof item.variantSelection === 'object' ? {
            key: normalizeText(item.variantSelection.key),
            type: normalizeText(item.variantSelection.type),
            attributes: sanitizeAttributes(item.variantSelection.attributes || {}),
            attributeSummary: normalizeText(item.variantSelection.attributeSummary),
            color: normalizeText(item.variantSelection.color),
            size: normalizeText(item.variantSelection.size)
        } : null,
        color: normalizeText(item.color || item.variantSelection?.color || attributes.Color || attributes.color),
        size: normalizeText(item.size || item.variantSelection?.size || attributes.Size || attributes.size),
        total: Number(item.total || (price * quantity)) || 0
    };
}

function sanitizeCartItems(items) {
    return (Array.isArray(items) ? items : []).map(sanitizeCartItem).filter((item) => item && item.id);
}

function sanitizePayloadValue(value, mapper) {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return null;
    }

    return mapper ? mapper(value) : value;
}

function serializeState(state) {
    return {
        userId: normalizeText(state?.userId),
        email: normalizeEmail(state?.email),
        phone: normalizePhone(state?.phone),
        cartItems: sanitizeCartItems(state?.cartItems),
        savedItems: sanitizeCartItems(state?.savedItems),
        directCheckout: sanitizePayloadValue(state?.directCheckout, sanitizeCartItem) || null,
        checkoutDraft: sanitizePayloadValue(state?.checkoutDraft, (draft) => draft),
        checkoutConfirmation: sanitizePayloadValue(state?.checkoutConfirmation, (confirmation) => confirmation),
        updatedAt: state?.updatedAt || null,
        lastCartSyncedAt: state?.lastCartSyncedAt || null,
        lastDraftSyncedAt: state?.lastDraftSyncedAt || null,
        lastCheckoutSyncedAt: state?.lastCheckoutSyncedAt || null
    };
}

exports.getStorefrontState = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'storefront_state' });
    try {
        const user = await resolveUser(req);
        if (!user) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const state = await storefrontStateService.getStateForUser(user);
        return res.json({ success: true, state: serializeState(state) });
    } catch (error) {
        logger.error('storefront.state_get_failed', { error });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.updateStorefrontState = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'storefront_state' });
    try {
        const user = await resolveUser(req);
        if (!user) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const now = new Date();
        const current = await storefrontStateService.getStateForUser(user);
        const nextState = {
            cartItems: current.cartItems,
            savedItems: current.savedItems || [],
            directCheckout: current.directCheckout,
            checkoutDraft: current.checkoutDraft,
            checkoutConfirmation: current.checkoutConfirmation,
            lastCartSyncedAt: current.lastCartSyncedAt,
            lastDraftSyncedAt: current.lastDraftSyncedAt,
            lastCheckoutSyncedAt: current.lastCheckoutSyncedAt
        };

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'cartItems')) {
            nextState.cartItems = sanitizeCartItems(req.body.cartItems);
            nextState.lastCartSyncedAt = now.toISOString();
        }

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'savedItems')) {
            nextState.savedItems = sanitizeCartItems(req.body.savedItems);
        }

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'directCheckout')) {
            nextState.directCheckout = sanitizePayloadValue(req.body.directCheckout, sanitizeCartItem) || null;
            nextState.lastCheckoutSyncedAt = now.toISOString();
        }

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'checkoutDraft')) {
            nextState.checkoutDraft = sanitizePayloadValue(req.body.checkoutDraft, (draft) => draft);
            nextState.lastDraftSyncedAt = now.toISOString();
        }

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'checkoutConfirmation')) {
            nextState.checkoutConfirmation = sanitizePayloadValue(req.body.checkoutConfirmation, (confirmation) => confirmation);
            nextState.lastCheckoutSyncedAt = now.toISOString();
        }

        const state = await storefrontStateService.saveStateForUser(user, nextState);

        return res.json({ success: true, state: serializeState(state) });
    } catch (error) {
        logger.error('storefront.state_update_failed', { error });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};