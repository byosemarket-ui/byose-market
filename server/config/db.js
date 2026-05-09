const mongoose = require('mongoose');
const { appLogger } = require('../utils/logger');

const MONGO_RETRY_ATTEMPTS = 5;
const MONGO_RETRY_BASE_DELAY_MS = 1200;
let connectionPromise = null;
let listenersBound = false;

function getMongoUri() {
    const configured = String(process.env.MONGO_URI || '').trim();
    if (configured) {
        return configured;
    }

    if (process.env.NODE_ENV === 'production') {
        throw new Error('MONGO_URI is required in production');
    }

    const devUri = String(process.env.MONGO_URI_DEV || '').trim();
    if (!devUri) {
        throw new Error('MONGO_URI_DEV is required when MONGO_URI is not provided');
    }

    return devUri;
}

function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function buildRetryDelayMs(attempt) {
    const safeAttempt = Math.max(1, Number(attempt || 1));
    return Math.min(10000, MONGO_RETRY_BASE_DELAY_MS * safeAttempt);
}

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

    connectionPromise = (async () => {
        const mongoUri = getMongoUri();

        for (let attempt = 1; attempt <= MONGO_RETRY_ATTEMPTS; attempt += 1) {
            try {
                await mongoose.connect(mongoUri, {
                    serverSelectionTimeoutMS: 8000,
                    socketTimeoutMS: 30000,
                    maxPoolSize: 20,
                    minPoolSize: 2,
                    retryWrites: true,
                    autoIndex: process.env.NODE_ENV !== 'production'
                });

                appLogger.info('database.connect.succeeded', {
                    attempt,
                    retryAttempts: MONGO_RETRY_ATTEMPTS
                });

                return true;
            } catch (err) {
                const finalAttempt = attempt >= MONGO_RETRY_ATTEMPTS;
                appLogger[finalAttempt ? 'error' : 'warn']('database.connect.attempt_failed', {
                    attempt,
                    retryAttempts: MONGO_RETRY_ATTEMPTS,
                    finalAttempt,
                    error: err
                });

                if (finalAttempt) {
                    throw err;
                }

                await wait(buildRetryDelayMs(attempt));
            }
        }

        return false;
    })()
        .finally(() => {
            connectionPromise = null;
        });

    return connectionPromise;
}

module.exports = connectDB;
