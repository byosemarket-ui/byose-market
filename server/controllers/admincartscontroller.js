const Cart = require('../models/cart');
const { appLogger } = require('../utils/logger');

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeCartItem(item) {
    const quantity = Math.max(0, Number(item?.quantity || 0) || 0);
    const product = item?.product && typeof item.product === 'object' ? item.product : {};
    const price = Number(product.price || 0) || 0;
    const image = normalizeText(product.mainImage || product.image);

    return {
        productId: normalizeText(product._id || product.id),
        catalogId: Number(product.catalogId || 0) || 0,
        name: normalizeText(product.name || product.title) || 'Product',
        quantity,
        price,
        stock: Number(product.stock || 0) || 0,
        image,
        total: quantity * price
    };
}

function normalizeCart(cart) {
    const items = Array.isArray(cart?.items) ? cart.items.map(normalizeCartItem).filter((item) => item.quantity > 0) : [];
    const itemCount = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const estimatedTotal = items.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const user = cart?.user && typeof cart.user === 'object' ? cart.user : {};

    return {
        id: normalizeText(cart?._id),
        user: {
            id: normalizeText(user.id || user._id),
            name: normalizeText(user.name) || 'Customer',
            email: normalizeText(user.email),
            phone: normalizeText(user.phone)
        },
        itemCount,
        estimatedTotal,
        items,
        createdAt: cart?.createdAt || null,
        updatedAt: cart?.updatedAt || cart?.createdAt || null
    };
}

exports.listAdminCarts = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_carts' });
    try {
        const limit = Math.min(300, Math.max(1, Number(req.query?.limit || 120) || 120));
        const page = Math.max(1, Number(req.query?.page || 1) || 1);
        const skip = (page - 1) * limit;

        const [totalCarts, cartsDocs] = await Promise.all([
            Cart.countDocuments({}),
            Cart.find({})
                .sort({ updatedAt: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .select('user items createdAt updatedAt')
                .populate({ path: 'user', select: 'id name email phone' })
                .populate({ path: 'items.product', select: 'catalogId name title price stock image mainImage' })
                .lean()
        ]);

        const carts = cartsDocs.map(normalizeCart);
        const activeCarts = carts.filter((cart) => Number(cart.itemCount || 0) > 0).length;
        const totalItems = carts.reduce((sum, cart) => sum + Number(cart.itemCount || 0), 0);
        const estimatedValue = carts.reduce((sum, cart) => sum + Number(cart.estimatedTotal || 0), 0);

        return res.json({
            success: true,
            carts,
            metrics: {
                totalCarts,
                activeCarts,
                totalItems,
                estimatedValue,
                page,
                limit
            }
        });
    } catch (error) {
        logger.error('admin.carts.list_failed', { error });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};
