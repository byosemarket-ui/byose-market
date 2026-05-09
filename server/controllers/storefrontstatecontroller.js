const StorefrontState = require('../models/storefrontstate');
const User = require('../models/user');
const { appLogger } = require('../utils/logger');

async function resolveUser(req) {
    if (!req.user || !req.user.id) {
        return null;
    }

    return User.findOne({ id: req.user.id });
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
        variantKey: normalizeText(item.variantKey),
        color: normalizeText(item.color || attributes.Color || attributes.color),
        size: normalizeText(item.size || attributes.Size || attributes.size),
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
        directCheckout: sanitizePayloadValue(state?.directCheckout, sanitizeCartItem) || null,
        checkoutDraft: sanitizePayloadValue(state?.checkoutDraft, (draft) => draft),
        checkoutConfirmation: sanitizePayloadValue(state?.checkoutConfirmation, (confirmation) => confirmation),
        updatedAt: state?.updatedAt || null,
        lastCartSyncedAt: state?.lastCartSyncedAt || null,
        lastDraftSyncedAt: state?.lastDraftSyncedAt || null,
        lastCheckoutSyncedAt: state?.lastCheckoutSyncedAt || null
    };
}

async function ensureState(user) {
    const email = normalizeEmail(user?.email);
    const phone = normalizePhone(user?.phone);
    let state = await StorefrontState.findOne({ user: user._id });

    if (!state) {
        state = await StorefrontState.create({
            user: user._id,
            userId: normalizeText(user?.id),
            email,
            phone
        });
        return state;
    }

    let changed = false;
    if (normalizeText(state.userId) !== normalizeText(user?.id)) {
        state.userId = normalizeText(user?.id);
        changed = true;
    }
    if (normalizeEmail(state.email) !== email) {
        state.email = email;
        changed = true;
    }
    if (normalizePhone(state.phone) !== phone) {
        state.phone = phone;
        changed = true;
    }

    if (changed) {
        await state.save();
    }

    return state;
}

exports.getStorefrontState = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'storefront_state' });
    try {
        const user = await resolveUser(req);
        if (!user) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const state = await ensureState(user);
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

        const state = await ensureState(user);
        const now = new Date();

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'cartItems')) {
            state.cartItems = sanitizeCartItems(req.body.cartItems);
            state.lastCartSyncedAt = now;
        }

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'directCheckout')) {
            state.directCheckout = sanitizePayloadValue(req.body.directCheckout, sanitizeCartItem) || null;
            state.lastCheckoutSyncedAt = now;
        }

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'checkoutDraft')) {
            state.checkoutDraft = sanitizePayloadValue(req.body.checkoutDraft, (draft) => draft);
            state.lastDraftSyncedAt = now;
        }

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'checkoutConfirmation')) {
            state.checkoutConfirmation = sanitizePayloadValue(req.body.checkoutConfirmation, (confirmation) => confirmation);
            state.lastCheckoutSyncedAt = now;
        }

        state.email = normalizeEmail(user?.email);
        state.phone = normalizePhone(user?.phone);
        state.userId = normalizeText(user?.id);
        await state.save();

        return res.json({ success: true, state: serializeState(state) });
    } catch (error) {
        logger.error('storefront.state_update_failed', { error });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};