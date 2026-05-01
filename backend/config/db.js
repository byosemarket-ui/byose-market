const mongoose = require('mongoose');

const DEFAULT_MONGO_URI = 'mongodb://127.0.0.1:27017/byosemarket';

async function connectDB() {
    const mongoUri = String(process.env.MONGO_URI || '').trim() || DEFAULT_MONGO_URI;

    try {
        await mongoose.connect(mongoUri);
        console.log('MongoDB connected successfully');
        return true;
    } catch (error) {
        throw new Error(`MongoDB connection failed: ${error.message}`);
    }
}

module.exports = connectDB;