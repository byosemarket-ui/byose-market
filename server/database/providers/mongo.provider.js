const mongoose = require('mongoose');
const config = require('../../config/env');
const { appLogger } = require('../../utils/logger');

const MONGO_RETRY_ATTEMPTS = 5;
const MONGO_RETRY_BASE_DELAY_MS = 1200;
let connectionPromise = null;
let listenersBound = false;

function getMongoUri() {
    if (config.mongo.uri) {
        return config.mongo.uri;
    }

    if (config.isProduction) {
        throw new Error('MONGO_URI is required in production');
    }

    if (!config.mongo.devUri) {
        throw new Error('MONGO_URI_DEV is required when MONGO_URI is not provided');
    }

    return config.mongo.devUri;
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
        appLogger.info('database.connection.connected', { provider: 'mongo' });
    });

    mongoose.connection.on('error', (error) => {
        appLogger.error('database.connection.error', { provider: 'mongo', error });
    });

    mongoose.connection.on('disconnected', () => {
        appLogger.warn('database.connection.disconnected', { provider: 'mongo' });
    });
}

async function connect() {
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
                    autoIndex: !config.isProduction
                });

                appLogger.info('database.connect.succeeded', {
                    provider: 'mongo',
                    attempt,
                    retryAttempts: MONGO_RETRY_ATTEMPTS
                });

                return true;
            } catch (error) {
                const finalAttempt = attempt >= MONGO_RETRY_ATTEMPTS;
                appLogger[finalAttempt ? 'error' : 'warn']('database.connect.attempt_failed', {
                    provider: 'mongo',
                    attempt,
                    retryAttempts: MONGO_RETRY_ATTEMPTS,
                    finalAttempt,
                    error
                });

                if (finalAttempt) {
                    throw error;
                }

                await wait(buildRetryDelayMs(attempt));
            }
        }

        return false;
    })().finally(() => {
        connectionPromise = null;
    });

    return connectionPromise;
}

function getStatus() {
    return {
        provider: 'mongo',
        configuredProvider: config.databaseClient,
        ready: mongoose.connection.readyState === 1,
        readyState: mongoose.connection.readyState
    };
}

async function close() {
    if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
    }
}

module.exports = {
    close,
    connect,
    getMongoUri,
    getStatus,
    isReady: () => mongoose.connection.readyState === 1
};