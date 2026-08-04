const DEFAULT_TTL_MS = 30000;

class QueryCache {
    constructor() {
        this.entries = new Map();
        this.generation = 0;
    }

    bump(scope = 'all') {
        this.generation += 1;
        if (scope === 'all') {
            this.entries.clear();
            return this.generation;
        }

        for (const key of this.entries.keys()) {
            if (String(key).startsWith(`${scope}:`)) {
                this.entries.delete(key);
            }
        }

        return this.generation;
    }

    get(key) {
        const entry = this.entries.get(key);
        if (!entry) {
            return undefined;
        }

        if (entry.expiresAt <= Date.now()) {
            this.entries.delete(key);
            return undefined;
        }

        return entry.value;
    }

    set(key, value, ttlMs = DEFAULT_TTL_MS) {
        const ttl = Math.max(1000, Number(ttlMs) || DEFAULT_TTL_MS);
        this.entries.set(key, {
            value,
            expiresAt: Date.now() + ttl
        });
        return value;
    }

    async remember(key, ttlMs, loader) {
        const cached = this.get(key);
        if (cached !== undefined) {
            return cached;
        }

        const value = await loader();
        return this.set(key, value, ttlMs);
    }
}

const queryCache = new QueryCache();

module.exports = {
    queryCache,
    DEFAULT_TTL_MS
};
