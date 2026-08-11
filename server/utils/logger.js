const SENSITIVE_KEYS = [
    'password',
    'token',
    'secret',
    'authorization',
    'cookie',
    'set-cookie',
    'jwt',
    'credential',
    'credentials',
    'companytoken',
    'apikey',
    'api_key'
];

function normalizeText(value) {
    return String(value || '').trim();
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Error);
}

function redactValue(value) {
    if (value === undefined || value === null) {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((entry) => redactValue(entry));
    }

    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: process.env.NODE_ENV === 'production' ? undefined : value.stack
        };
    }

    if (!isPlainObject(value)) {
        return value;
    }

    return Object.fromEntries(
        Object.entries(value).map(([key, entryValue]) => {
            const normalizedKey = normalizeText(key).toLowerCase();
            if (SENSITIVE_KEYS.some((token) => normalizedKey.includes(token))) {
                return [key, '[redacted]'];
            }

            return [key, redactValue(entryValue)];
        })
    );
}

function createPayload(level, event, context) {
    return {
        timestamp: new Date().toISOString(),
        level,
        event,
        env: process.env.NODE_ENV || 'development',
        ...redactValue(context || {})
    };
}

function writeLog(level, event, context) {
    const payload = createPayload(level, event, context);
    const serialized = JSON.stringify(payload);

    if (level === 'error') {
        console.error(serialized);
        return;
    }

    if (level === 'warn') {
        console.warn(serialized);
        return;
    }

    console.log(serialized);
}

function createLogger(baseContext = {}) {
    const context = redactValue(baseContext || {});

    return {
        child(nextContext = {}) {
            return createLogger({
                ...context,
                ...redactValue(nextContext)
            });
        },
        debug(event, nextContext) {
            if ((process.env.LOG_LEVEL || '').toLowerCase() === 'debug' || process.env.NODE_ENV !== 'production') {
                writeLog('debug', event, { ...context, ...(nextContext || {}) });
            }
        },
        info(event, nextContext) {
            writeLog('info', event, { ...context, ...(nextContext || {}) });
        },
        warn(event, nextContext) {
            writeLog('warn', event, { ...context, ...(nextContext || {}) });
        },
        error(event, nextContext) {
            writeLog('error', event, { ...context, ...(nextContext || {}) });
        }
    };
}

async function monitorAsyncOperation(logger, event, meta, callback, options = {}) {
    const startedAt = Date.now();
    const slowThresholdMs = Number(options.slowThresholdMs || 750);

    try {
        const result = await callback();
        const durationMs = Date.now() - startedAt;

        if (durationMs >= slowThresholdMs) {
            logger.warn(`${event}.slow`, {
                ...meta,
                durationMs,
                thresholdMs: slowThresholdMs
            });
        } else {
            logger.debug(`${event}.success`, {
                ...meta,
                durationMs
            });
        }

        return result;
    } catch (error) {
        logger.error(`${event}.failed`, {
            ...meta,
            durationMs: Date.now() - startedAt,
            error
        });
        throw error;
    }
}

const appLogger = createLogger({ service: 'byosemarket-api' });

module.exports = {
    appLogger,
    createLogger,
    monitorAsyncOperation,
    redactValue
};