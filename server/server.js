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
        const connected = await connectDatabase();
        const databaseStatus = syncAppState();
        if (!connected || !databaseStatus.ready) {
            throw new Error(databaseStatus.lastError || 'Database connect returned not ready');
        }
        increment(METRIC.DB_CONNECTS);
        appLogger.info('database.connected', {
            provider: databaseStatus.provider,
            databasePath: databaseStatus.databasePath || null
        });

        try {
            const { startInventoryReservationSweeper } = require('./services/inventory.service');
            startInventoryReservationSweeper();
        } catch (inventorySweepError) {
            appLogger.warn('inventory.reservation_sweeper_start_failed', { error: inventorySweepError });
        }

        try {
            const { startNotificationAutomationWorker } = require('./services/notification-automation.service');
            startNotificationAutomationWorker();
        } catch (automationError) {
            appLogger.warn('notification.automation.worker_start_failed', { error: automationError });
            try {
                const { startNotificationEmailRetryWorker } = require('./services/email/notification-email.service');
                startNotificationEmailRetryWorker();
            } catch (emailWorkerError) {
                appLogger.warn('notification.email.retry_worker_start_failed', { error: emailWorkerError });
            }
        }

        try {
            const { startNotificationMonitor } = require('./services/notification-monitoring.service');
            startNotificationMonitor();
        } catch (monitorError) {
            appLogger.warn('notification.monitor.start_failed', { error: monitorError });
        }
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
        const { stopInventoryReservationSweeper } = require('./services/inventory.service');
        stopInventoryReservationSweeper();
    } catch (_error) {
        // non-blocking
    }

    try {
        const { stopNotificationAutomationWorker } = require('./services/notification-automation.service');
        stopNotificationAutomationWorker();
    } catch (_error) {
        // non-blocking
    }

    try {
        const { stopNotificationMonitor } = require('./services/notification-monitoring.service');
        stopNotificationMonitor();
    } catch (_error) {
        // non-blocking
    }

    try {
        const { stopNotificationEmailRetryWorker } = require('./services/email/notification-email.service');
        stopNotificationEmailRetryWorker();
    } catch (_error) {
        // non-blocking
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