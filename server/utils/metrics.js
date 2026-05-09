// =============================================================================
// METRICS SERVICE
// =============================================================================
// Lightweight in-process metrics accumulator for operational monitoring.
//
// Tracks:
//   - HTTP request counts by route and status code
//   - Response time percentiles (p50, p90, p99)
//   - Database connection state transitions
//   - Custom event counters (order placed, checkout failed, etc.)
//
// Metrics are exposed on GET /metrics (JSON) so they can be scraped by
// external monitoring systems (Datadog, Grafana, UptimeRobot, custom dashboards)
// or read directly from the Render service logs.
//
// This is an intentionally simple, zero-dependency implementation. If the
// platform scales to warrant Prometheus, replace this module with the
// official `prom-client` package and keep the same exported interface.
// =============================================================================

const { appLogger } = require('./logger');

// ---------------------------------------------------------------------------
// INTERNAL STATE
// ---------------------------------------------------------------------------

const counters = new Map();      // event_name → count
const histograms = new Map();    // metric_name → number[]
const gauges = new Map();        // metric_name → number

const HISTOGRAM_MAX_SAMPLES = 2000; // cap memory per metric
const PROCESS_START_MS = Date.now();

// ---------------------------------------------------------------------------
// COUNTER API
// ---------------------------------------------------------------------------

/**
 * Increment a named counter by `amount` (default 1).
 * @param {string} name
 * @param {number} [amount]
 */
function increment(name, amount = 1) {
    const key = String(name || '');
    counters.set(key, (counters.get(key) || 0) + Math.max(0, Number(amount) || 0));
}

/**
 * Read the current value of a named counter.
 * @param {string} name
 * @returns {number}
 */
function getCounter(name) {
    return counters.get(String(name || '')) || 0;
}

// ---------------------------------------------------------------------------
// GAUGE API
// ---------------------------------------------------------------------------

/**
 * Set a named gauge to an absolute value.
 * @param {string} name
 * @param {number} value
 */
function setGauge(name, value) {
    gauges.set(String(name || ''), Number(value) || 0);
}

/**
 * Read the current value of a named gauge.
 * @param {string} name
 * @returns {number}
 */
function getGauge(name) {
    return gauges.get(String(name || '')) || 0;
}

// ---------------------------------------------------------------------------
// HISTOGRAM API
// ---------------------------------------------------------------------------

/**
 * Record a value into a named histogram (e.g. response time in ms).
 * @param {string} name
 * @param {number} value
 */
function record(name, value) {
    const key = String(name || '');
    if (!histograms.has(key)) {
        histograms.set(key, []);
    }

    const samples = histograms.get(key);
    samples.push(Number(value) || 0);

    // Evict oldest samples when the cap is reached to bound memory usage.
    if (samples.length > HISTOGRAM_MAX_SAMPLES) {
        samples.splice(0, samples.length - HISTOGRAM_MAX_SAMPLES);
    }
}

/**
 * Compute percentile from a sorted array.
 * @param {number[]} sorted
 * @param {number}   p       - 0–100
 * @returns {number}
 */
function percentile(sorted, p) {
    if (!sorted.length) {
        return 0;
    }

    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

/**
 * Returns summary statistics for a named histogram.
 * @param {string} name
 * @returns {{ count: number, min: number, max: number, p50: number, p90: number, p99: number }}
 */
function getHistogramSummary(name) {
    const samples = histograms.get(String(name || '')) || [];
    if (!samples.length) {
        return { count: 0, min: 0, max: 0, p50: 0, p90: 0, p99: 0 };
    }

    const sorted = [...samples].sort((a, b) => a - b);
    return {
        count: sorted.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        p50: percentile(sorted, 50),
        p90: percentile(sorted, 90),
        p99: percentile(sorted, 99)
    };
}

// ---------------------------------------------------------------------------
// BUILT-IN METRICS
// ---------------------------------------------------------------------------

/** Built-in metric names used by the request middleware below. */
const METRIC = {
    HTTP_REQUESTS_TOTAL: 'http.requests.total',
    HTTP_ERRORS_TOTAL: 'http.errors.total',
    HTTP_RESPONSE_TIME_MS: 'http.response_time_ms',
    DB_CONNECTS: 'db.connects',
    DB_DISCONNECTS: 'db.disconnects',
    DB_ERRORS: 'db.errors',
    ORDERS_CREATED: 'orders.created',
    CHECKOUT_FAILURES: 'checkout.failures',
    AUTH_FAILURES: 'auth.failures',
    CACHE_HITS: 'cache.hits',
    CACHE_MISSES: 'cache.misses'
};

// ---------------------------------------------------------------------------
// EXPRESS MIDDLEWARE
// ---------------------------------------------------------------------------

/**
 * Express middleware that records per-request HTTP metrics automatically.
 * Mount after `requestLogger` but before routes.
 *
 * @returns {import('express').RequestHandler}
 */
function metricsMiddleware() {
    return function(req, res, next) {
        const start = Date.now();

        res.on('finish', () => {
            const durationMs = Date.now() - start;
            increment(METRIC.HTTP_REQUESTS_TOTAL);
            record(METRIC.HTTP_RESPONSE_TIME_MS, durationMs);

            if (res.statusCode >= 500) {
                increment(METRIC.HTTP_ERRORS_TOTAL);
                increment(`http.5xx.${res.statusCode}`);
            } else if (res.statusCode >= 400) {
                increment(`http.4xx.${res.statusCode}`);
            }

            increment(`http.route.${req.method.toLowerCase()}.${(req.baseUrl || '') + (req.route?.path || req.path || '')}`);
        });

        next();
    };
}

// ---------------------------------------------------------------------------
// METRICS SNAPSHOT
// ---------------------------------------------------------------------------

/**
 * Returns a snapshot of all current metrics suitable for JSON serialization
 * and exposure via a /metrics endpoint.
 *
 * @returns {object}
 */
function getSnapshot() {
    const counterObj = {};
    for (const [key, value] of counters) {
        counterObj[key] = value;
    }

    const gaugeObj = {};
    for (const [key, value] of gauges) {
        gaugeObj[key] = value;
    }

    const histogramObj = {};
    for (const [key] of histograms) {
        histogramObj[key] = getHistogramSummary(key);
    }

    return {
        uptimeMs: Date.now() - PROCESS_START_MS,
        collectedAt: new Date().toISOString(),
        counters: counterObj,
        gauges: gaugeObj,
        histograms: histogramObj
    };
}

/**
 * Logs the current metrics snapshot at INFO level.
 * Call this on a scheduled interval for persistent metrics in log streams.
 */
function logSnapshot() {
    appLogger.info('metrics.snapshot', getSnapshot());
}

module.exports = {
    METRIC,
    increment,
    getCounter,
    setGauge,
    getGauge,
    record,
    getHistogramSummary,
    metricsMiddleware,
    getSnapshot,
    logSnapshot
};
