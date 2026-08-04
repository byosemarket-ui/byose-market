const mongoose = require('mongoose');

const CartSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    items: [
        {
            product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
            quantity: { type: Number, default: 1 }
        }
    ]
}, { timestamps: true });

// Cleanup stale carts by last update (user uniqueness already comes from unique: true)
CartSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('Cart', CartSchema);
