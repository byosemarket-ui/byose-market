const mongoose = require('mongoose');

const AddressSchema = new mongoose.Schema({
    line1: { type: String, default: '' },
    street: { type: String, default: '' },
    city: { type: String, default: '' },
    district: { type: String, default: '' },
    sector: { type: String, default: '' },
    cell: { type: String, default: '' },
    village: { type: String, default: '' },
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    phone: { type: String, default: '' }
}, { _id: false });

const UserSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, lowercase: true, index: true, unique: true, sparse: true },
    phone: { type: String, index: true, unique: true, sparse: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    avatar: { type: String, default: '' },
    status: { type: String, enum: ['active', 'blocked'], default: 'active' },
    verified: { type: Boolean, default: false },
    address: { type: AddressSchema, default: () => ({}) },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
