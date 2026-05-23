const { appLogger } = require('../utils/logger');
const cartDataService = require('../services/cartdataservice');
const userDataService = require('../services/userdataservice');
const getRealtimeEventService = require('../services/realtimeeventservice');

async function resolveUser(req) {
    // token contains custom id in payload (id)
    if (!req.user || !req.user.id) return null;
    return userDataService.findUserById(req.user.id);
}

// Add item to cart
exports.addToCart = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'cart' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const { productId, quantity } = req.body || {};
        if (!productId) return res.status(400).json({ success: false, message: 'productId required' });

        const populated = await cartDataService.addToCart(user, { productId, quantity });
        if (!populated) return res.status(404).json({ success: false, message: 'Product not found' });

        try {
            const realtimeService = getRealtimeEventService();
            realtimeService.emitCartUpdated(populated.id, {
                userId: user.id,
                itemCount: Array.isArray(populated.items) ? populated.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0) : 0,
                action: 'add'
            });
            realtimeService.emitAnalyticsUpdated({ source: 'carts', action: 'add' });
        } catch (eventError) {
            logger.warn('realtime.event_emit_failed', { error: eventError, scope: 'cart.add' });
        }

        return res.json({ success: true, cart: populated });
    } catch (err) {
        logger.error('cart.add_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get logged-in user's cart
exports.getUserCart = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'cart' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const cart = await cartDataService.getCartForUser(user);
        return res.json({ success: true, cart: cart || { items: [] } });
    } catch (err) {
        logger.error('cart.get_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Remove a product from cart or decrement quantity
exports.removeFromCart = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'cart' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const { productId, removeAll } = req.body || {};
        if (!productId) return res.status(400).json({ success: false, message: 'productId required' });

        const populated = await cartDataService.removeFromCart(user, { productId, removeAll });
        if (!populated) return res.status(404).json({ success: false, message: 'Item not in cart' });

        try {
            const realtimeService = getRealtimeEventService();
            realtimeService.emitCartUpdated(populated.id, {
                userId: user.id,
                itemCount: Array.isArray(populated.items) ? populated.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0) : 0,
                action: 'remove'
            });
            realtimeService.emitAnalyticsUpdated({ source: 'carts', action: 'remove' });
        } catch (eventError) {
            logger.warn('realtime.event_emit_failed', { error: eventError, scope: 'cart.remove' });
        }

        return res.json({ success: true, cart: populated });
    } catch (err) {
        logger.error('cart.remove_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Clear user's cart
exports.clearCart = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'cart' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const cart = await cartDataService.clearCart(user);
        if (cart) {

            try {
                const realtimeService = getRealtimeEventService();
                realtimeService.emitCartUpdated(cart.id, {
                    userId: user.id,
                    itemCount: 0,
                    action: 'clear'
                });
                realtimeService.emitAnalyticsUpdated({ source: 'carts', action: 'clear' });
            } catch (eventError) {
                logger.warn('realtime.event_emit_failed', { error: eventError, scope: 'cart.clear' });
            }
        }
        return res.json({ success: true });
    } catch (err) {
        logger.error('cart.clear_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};
