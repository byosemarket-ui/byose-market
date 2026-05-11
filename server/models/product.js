const mongoose = require('mongoose');

const SpecSchema = new mongoose.Schema({
    label: { type: String, default: '' },
    value: { type: String, default: '' }
}, { _id: false });

const AttributeOptionSchema = new mongoose.Schema({
    value: { type: String, default: '' },
    label: { type: String, default: '' },
    stock: { type: Number, default: 0 },
    image: { type: String, default: '' },
    swatch: { type: String, default: '' },
    sku: { type: String, default: '' },
    code: { type: String, default: '' },
    availability: { type: String, default: 'future' },
    isDefault: { type: Boolean, default: false },
    priceDelta: { type: Number, default: 0 }
}, { _id: false });

const AttributeSchema = new mongoose.Schema({
    name: { type: String, default: '' },
    key: { type: String, default: '' },
    axis: { type: String, default: 'text' },
    type: { type: String, default: 'text' },
    required: { type: Boolean, default: true },
    options: { type: [AttributeOptionSchema], default: [] }
}, { _id: false });

const ProductSchema = new mongoose.Schema({
    catalogId: { type: Number, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    title: { type: String, default: '', trim: true },
    description: { type: String, default: '', trim: true },
    shortDescription: { type: String, default: '', trim: true },
    longDescription: { type: [String], default: [] },
    badge: { type: String, default: '', trim: true },
    category: { type: String, default: 'general', trim: true },
    price: { type: Number, required: true, default: 0 },
    oldPrice: { type: Number, default: 0 },
    stock: { type: Number, default: 0 },
    image: { type: String, default: '', trim: true },
    mainImage: { type: String, default: '', trim: true },
    gallery: { type: [String], default: [] },
    keywords: { type: [String], default: [] },
    highlights: { type: [String], default: [] },
    trust: { type: [String], default: [] },
    specs: { type: [SpecSchema], default: [] },
    attributes: { type: [AttributeSchema], default: [] },
    variants: { type: mongoose.Schema.Types.Mixed, default: {} },
    visibility: { type: String, default: 'both', trim: true },
    priority: { type: String, default: 'normal', trim: true },
    orderIndex: { type: Number, default: 0 },
    highlightTag: { type: String, default: '', trim: true },
    status: { type: String, default: 'active', trim: true },
    page: { type: String, default: 'product-details1.html', trim: true },
    url: { type: String, default: '', trim: true }
}, {
    timestamps: true,
    minimize: false
});

ProductSchema.index({ category: 1, visibility: 1, status: 1, updatedAt: -1 });
ProductSchema.index({ status: 1, orderIndex: -1, updatedAt: -1 });
ProductSchema.index({ priority: -1, orderIndex: -1, updatedAt: -1 });
ProductSchema.index({ highlightTag: 1, updatedAt: -1 });
ProductSchema.index({ name: 'text', title: 'text', description: 'text', shortDescription: 'text', keywords: 'text', badge: 'text', category: 'text' });

module.exports = mongoose.model('Product', ProductSchema);
