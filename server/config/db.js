const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/byosemarket';

async function connectDB() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('MongoDB connected:', MONGO_URI);
        return true;
    } catch (err) {
        console.error('MongoDB connection error:', err);
        throw err;
    }
}

module.exports = connectDB;
