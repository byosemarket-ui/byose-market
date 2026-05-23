const config = require('./config/env');
const { createApp } = require('./app');
const { connectDatabase, closeDatabase, getDatabaseStatus } = require('./database');
const { prepareStorageFoundation } = require('./services/storage-foundation.service');
const { appLogger } = require('./utils/logger');
const { logSnapshot, METRIC, increment } = require('./utils/metrics');

const app = createApp();
const PORT = config.port;
const HOST = config.host;
const STARTUP_RECONNECT_DELAY_MS = config.startupReconnectDelayMs;
let server = null;
let startupReconnectTimer = null;

function syncAppState() {
    const databaseStatus = getDatabaseStatus();
    app.locals.dbConnected = Boolean(databaseStatus.ready);
    app.locals.database = databaseStatus;
    app.locals.uploads = prepareStorageFoundation();
    return databaseStatus;
}

function scheduleStartupReconnect() {
    if (startupReconnectTimer || app.locals.dbConnected) {
        return;
    }

    startupReconnectTimer = setTimeout(async () => {
        startupReconnectTimer = null;

        try {
            await connectDatabase();
            syncAppState();
            appLogger.info('database.reconnected_after_startup_failure');
        } catch (error) {
            app.locals.dbConnected = false;
            app.locals.database = getDatabaseStatus();
            appLogger.warn('database.reconnect_retry_failed', { error });
            scheduleStartupReconnect();
        }
    }, STARTUP_RECONNECT_DELAY_MS);
}

async function startServer() {
    syncAppState();

    server = app.listen(PORT, HOST, () => {
        appLogger.info('server.started', {
            host: HOST,
            port: PORT,
            healthCheckPath: '/healthz',
            adminLoginPath: '/api/admin/login'
        });
    });

    const metricsLogTimer = setInterval(logSnapshot, 10 * 60 * 1000);
    if (typeof metricsLogTimer.unref === 'function') {
        metricsLogTimer.unref();
    }

    try {
        await connectDatabase();
        syncAppState();
        increment(METRIC.DB_CONNECTS);
        appLogger.info('database.connected');
    } catch (error) {
        app.locals.dbConnected = false;
        app.locals.database = getDatabaseStatus();
        increment(METRIC.DB_ERRORS);
        appLogger.error('database.unavailable_on_startup', { error });
        scheduleStartupReconnect();
    }
}

startServer().catch((error) => {
    appLogger.error('server.startup_failed', { error });
    process.exit(1);
});

async function shutdown(signal, exitCode = 0) {
    appLogger.warn('server.shutdown_started', { signal, exitCode });

    if (startupReconnectTimer) {
        clearTimeout(startupReconnectTimer);
        startupReconnectTimer = null;
    }

    try {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
    } catch (error) {
        appLogger.error('server.shutdown_http_failed', { error });
    }

    try {
        await closeDatabase();
    } catch (error) {
        appLogger.error('server.shutdown_database_failed', { error });
    }

    process.exit(exitCode);
}

process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
    void shutdown('SIGINT');
});

process.on('unhandledRejection', (reason) => {
    appLogger.error('process.unhandled_rejection', { reason });
});

process.on('uncaughtException', (error) => {
    appLogger.error('process.uncaught_exception', { error });
    void shutdown('uncaughtException', 1);
});