const mongoose = require('mongoose');
const { appLogger } = require('../utils/logger');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/byosemarket';
let connectionPromise = null;
let listenersBound = false;

function bindConnectionListeners() {
    if (listenersBound) {
        return;
    }

    listenersBound = true;

    mongoose.connection.on('connected', () => {
        appLogger.info('database.connection.connected');
    });

    mongoose.connection.on('error', (error) => {
        appLogger.error('database.connection.error', { error });
    });

    mongoose.connection.on('disconnected', () => {
        appLogger.warn('database.connection.disconnected');
    });
}

async function connectDB() {
    bindConnectionListeners();

    if (mongoose.connection.readyState === 1) {
        return true;
    }

    if (connectionPromise) {
        return connectionPromise;
    }

    connectionPromise = mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 20000,
        maxPoolSize: 10
    })
        .then(() => true)
        .catch((err) => {
            appLogger.error('database.connect.failed', { error: err });
            throw err;
        })
        .finally(() => {
            connectionPromise = null;
        });

    return connectionPromise;
}

module.exports = connectDB;
