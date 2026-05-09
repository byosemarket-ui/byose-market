const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_MAX = 120;
// Scalability: prune expired entries from the store every N ms to prevent
// unbounded memory growth under sustained high-traffic loads.
const STORE_PRUNE_INTERVAL_MS = 5 * 60 * 1000;

function normalizeIp(value) {
    const raw = String(value || '').trim();
    return raw || 'unknown';
}

function defaultKeyGenerator(req) {
    const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = normalizeIp(forwardedFor || req.ip || req.socket?.remoteAddress);
    return `${req.method}:${req.baseUrl || ''}:${req.path || ''}:${ip}`;
}

function createRateLimiter(options = {}) {
    const windowMs = Math.max(1000, Number(options.windowMs || DEFAULT_WINDOW_MS));
    const max = Math.max(1, Number(options.max || DEFAULT_MAX));
    const keyGenerator = typeof options.keyGenerator === 'function' ? options.keyGenerator : defaultKeyGenerator;
    const message = String(options.message || 'Too many requests. Please try again later.');
    const code = String(options.code || 'RATE_LIMITED');
    const store = new Map();

    // Periodically prune expired entries so the Map does not grow unboundedly
    // under high sustained traffic (memory leak prevention at scale).
    const pruneTimer = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of store) {
            if (entry.resetAt <= now) {
                store.delete(key);
            }
        }
    }, STORE_PRUNE_INTERVAL_MS);

    // Allow the Node.js process to exit cleanly even if the timer is active.
    if (typeof pruneTimer.unref === 'function') {
        pruneTimer.unref();
    }

    return function rateLimiter(req, res, next) {
        const now = Date.now();
        const key = keyGenerator(req);
        const current = store.get(key);

        if (!current || current.resetAt <= now) {
            store.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        current.count += 1;
        store.set(key, current);

        if (current.count <= max) {
            return next();
        }

        const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
        res.setHeader('Retry-After', String(retryAfterSeconds));
        return res.status(429).json({
            success: false,
            code,
            message
        });
    };
}

module.exports = { createRateLimiter };
