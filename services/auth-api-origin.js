(function initializeAuthApiOrigin(global) {
    'use strict';

    const PRODUCTION_API_ORIGIN = 'https://byosemarket.com';
    const LEGACY_API_PATTERN = /(?:onrender\.com|localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i;

    function normalizeBase(value) {
        return String(value || '').trim().replace(/\/+$/, '');
    }

    function isLocalHost(hostname) {
        return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
    }

    function resolveAuthApiOrigin() {
        const runtimeOverride = normalizeBase(global.BYOSE_API_BASE_URL || global.__BYOSE_API_BASE__ || '');
        if (runtimeOverride && !LEGACY_API_PATTERN.test(runtimeOverride)) {
            return runtimeOverride.replace(/\/api$/i, '');
        }

        const protocol = String(global.location?.protocol || '').toLowerCase();
        const hostname = String(global.location?.hostname || '').trim().toLowerCase();
        const origin = normalizeBase(global.location?.origin || '');

        if (protocol === 'file:' || isLocalHost(hostname)) {
            return `http://${hostname || 'localhost'}:5000`;
        }

        if (origin && /byosemarket\.com$/i.test(hostname)) {
            return origin;
        }

        return PRODUCTION_API_ORIGIN;
    }

    function buildAuthApiUrl(path) {
        const normalizedPath = String(path || '').replace(/^\/+/, '');
        return `${resolveAuthApiOrigin()}/api/${normalizedPath}`;
    }

    global.ByoseAuthApiOrigin = {
        buildAuthApiUrl,
        resolveAuthApiOrigin
    };
})(typeof window !== 'undefined' ? window : globalThis);
