const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
    id: { type: String, trim: true },
    orderId: { type: String, required: true, unique: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    userId: { type: String, default: '' },
    accountId: { type: String, default: '' },
    customerId: { type: String, default: '' },
    isGuest: { type: Boolean, default: false },
    userEmail: { type: String, default: '', lowercase: true, index: true },
    customerEmail: { type: String, default: '', lowercase: true, index: true },
    customerPhone: { type: String, default: '', index: true },
    phoneNumber: { type: String, default: '' },
    customerName: { type: String, default: '' },
    customerImage: { type: String, default: '' },
    items: [
        {
            product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
            productId: { type: String, default: '' },
            productName: { type: String, default: '' },
            quantity: { type: Number, default: 1 },
            price: { type: Number, default: 0 },
            image: { type: String, default: '' },
            attributes: { type: mongoose.Schema.Types.Mixed, default: {} },
            color: { type: String, default: '' },
            size: { type: String, default: '' }
        }
    ],
    products: { type: [mongoose.Schema.Types.Mixed], default: [] },
    totalPrice: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 },
    shippingFee: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    codFee: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    status: { type: String, default: 'Pending' },
    orderStatus: { type: String, default: 'pending' },
    paymentStatus: { type: String, default: 'pending' },
    paymentStatusLabel: { type: String, default: '' },
    paymentMethod: { type: String, default: '' },
    paymentType: { type: String, default: '' },
    note: { type: String, default: '' },
    payment: { type: mongoose.Schema.Types.Mixed, default: {} },
    customer: { type: mongoose.Schema.Types.Mixed, default: {} },
    shippingAddress: { type: mongoose.Schema.Types.Mixed, default: {} },
    fullAddress: { type: mongoose.Schema.Types.Mixed, default: {} },
    gpsLocation: { type: mongoose.Schema.Types.Mixed, default: {} },
    deliveryMethod: { type: String, default: '' },
    deliveryLabel: { type: String, default: '' },
    statusHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { strict: false });

OrderSchema.index({ createdAt: -1, updatedAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ orderStatus: 1, createdAt: -1 });
OrderSchema.index({ paymentStatus: 1, createdAt: -1 });
OrderSchema.index({ customerId: 1, createdAt: -1 });
OrderSchema.index({ userId: 1, createdAt: -1 });
OrderSchema.index({ userEmail: 1, createdAt: -1 });
OrderSchema.index({ customerEmail: 1, createdAt: -1 });
OrderSchema.index({ customerPhone: 1, createdAt: -1 });

module.exports = mongoose.model('Order', OrderSchema);
