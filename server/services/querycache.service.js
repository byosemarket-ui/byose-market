const DEFAULT_TTL_MS = 30000;

class QueryCache {
    constructor() {
        this.entries = new Map();
        this.inflight = new Map();
        this.generation = 0;
    }

    bump(scope = 'all') {
        this.generation += 1;
        if (scope === 'all') {
            this.entries.clear();
            this.inflight.clear();
            return this.generation;
        }

        for (const key of this.entries.keys()) {
            if (String(key).startsWith(`${scope}:`)) {
                this.entries.delete(key);
            }
        }
        for (const key of this.inflight.keys()) {
            if (String(key).startsWith(`${scope}:`)) {
                this.inflight.delete(key);
            }
        }

        return this.generation;
    }

    getGeneration() {
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

    set(key, value, ttlMs = DEFAULT_TTL_MS, generation = this.generation) {
        // Drop writes from loaders that started before a bump.
        if (generation !== this.generation) {
            return value;
        }

        const ttl = Math.max(1000, Number(ttlMs) || DEFAULT_TTL_MS);
        this.entries.set(key, {
            value,
            expiresAt: Date.now() + ttl,
            generation
        });
        return value;
    }

    async remember(key, ttlMs, loader) {
        const cached = this.get(key);
        if (cached !== undefined) {
            return cached;
        }

        if (this.inflight.has(key)) {
            return this.inflight.get(key);
        }

        const generationAtStart = this.generation;
        const pending = Promise.resolve()
            .then(() => loader())
            .then((value) => {
                this.set(key, value, ttlMs, generationAtStart);
                return value;
            })
            .finally(() => {
                this.inflight.delete(key);
            });

        this.inflight.set(key, pending);
        return pending;
    }
}

const queryCache = new QueryCache();

module.exports = {
    queryCache,
    DEFAULT_TTL_MS
};
