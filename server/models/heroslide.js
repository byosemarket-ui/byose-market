const mongoose = require('mongoose');

const HeroSlideSchema = new mongoose.Schema({
    slideId: { type: String, required: true, unique: true, index: true },
    title: { type: String, default: '', trim: true },
    subtitle: { type: String, default: '', trim: true },
    buttonText: { type: String, default: '', trim: true },
    buttonLink: { type: String, default: '', trim: true },
    imageUrl: { type: String, default: '', trim: true },
    imagePath: { type: String, default: '', trim: true },
    displayOrder: { type: Number, default: 0, index: true },
    status: { type: String, default: 'active', trim: true, index: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} }
}, {
    timestamps: true,
    minimize: false
});

HeroSlideSchema.index({ status: 1, displayOrder: 1, createdAt: -1 });
HeroSlideSchema.index({ displayOrder: 1, updatedAt: -1 });
HeroSlideSchema.index({ createdAt: -1, updatedAt: -1 });

module.exports = mongoose.model('HeroSlide', HeroSlideSchema);
