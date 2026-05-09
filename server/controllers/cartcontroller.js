const Cart = require('../models/cart');
const Product = require('../models/product');
const User = require('../models/user');
const { appLogger } = require('../utils/logger');
const getRealtimeEventService = require('../services/realtimeeventservice');

async function resolveUser(req) {
    // token contains custom id in payload (id)
    if (!req.user || !req.user.id) return null;
    return await User.findOne({ id: req.user.id });
}

// Add item to cart
exports.addToCart = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'cart' });
    try {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const { productId, quantity } = req.body || {};
        if (!productId) return res.status(400).json({ success: false, message: 'productId required' });

        const product = await Product.findById(productId);
        if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

        let cart = await Cart.findOne({ user: user._id });
        if (!cart) {
            cart = new Cart({ user: user._id, items: [] });
        }

        const idx = cart.items.findIndex(i => String(i.product) === String(product._id));
        if (idx > -1) {
            cart.items[idx].quantity += Number(quantity || 1);
        } else {
            cart.items.push({ product: product._id, quantity: Number(quantity || 1) });
        }

        await cart.save();
        const populated = await cart.populate({ path: 'items.product' });

        try {
            const realtimeService = getRealtimeEventService();
            realtimeService.emitCartUpdated(populated._id || populated.id, {
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
        const cart = await Cart.findOne({ user: user._id }).populate({ path: 'items.product' });
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

        const cart = await Cart.findOne({ user: user._id });
        if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });

        const idx = cart.items.findIndex(i => String(i.product) === String(productId));
        if (idx === -1) return res.status(404).json({ success: false, message: 'Item not in cart' });

        if (removeAll || cart.items[idx].quantity <= 1) {
            cart.items.splice(idx, 1);
        } else {
            cart.items[idx].quantity -= 1;
        }

        await cart.save();
        const populated = await cart.populate({ path: 'items.product' });

        try {
            const realtimeService = getRealtimeEventService();
            realtimeService.emitCartUpdated(populated._id || populated.id, {
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
        const cart = await Cart.findOne({ user: user._id });
        if (cart) {
            cart.items = [];
            await cart.save();

            try {
                const realtimeService = getRealtimeEventService();
                realtimeService.emitCartUpdated(cart._id || cart.id, {
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
