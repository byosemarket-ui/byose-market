(function (global) {
  'use strict';

  const PRODUCTION_API_ORIGIN = 'https://byosemarket.com';
  const LOCAL_RECENT_KEY = 'byose_market_recently_viewed';
  const EVENT_NAME = 'byose:recently-viewed-updated';
  const MAX_LOCAL = 40;
  const CLIENT_THROTTLE_MS = 8 * 1000;

  const trackedThisPage = new Set();
  const lastTrackAt = Object.create(null);
  let cachedCount = null;

  function normalizeBase(value) {
    return String(value || '').trim().replace(/\/+$/, '');
  }

  function isLocalHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
  }

  function shouldUseProductionApi(hostname) {
    return /(^|\.)(github\.io|byosemarket\.com)$/i.test(String(hostname || ''));
  }

  function resolveApiOrigin() {
    const explicit = normalizeBase(global.BYOSE_API_BASE_URL || global.__BYOSE_API_BASE__ || '');
    if (explicit) {
      return explicit.replace(/\/api$/i, '');
    }

    const protocol = String(global.location?.protocol || '').toLowerCase();
    const hostname = String(global.location?.hostname || '').trim();

    if (protocol === 'file:' || isLocalHost(hostname)) {
      return `http://${hostname || 'localhost'}:5000`;
    }

    if (shouldUseProductionApi(hostname)) {
      return PRODUCTION_API_ORIGIN;
    }

    return normalizeBase(global.location?.origin || '');
  }

  function apiUrl(path) {
    return `${resolveApiOrigin()}/api${path}`;
  }

  function isLoggedIn() {
    return Boolean(global.authService && typeof global.authService.isLoggedIn === 'function' && global.authService.isLoggedIn());
  }

  function readLocal() {
    try {
      const value = JSON.parse(localStorage.getItem(LOCAL_RECENT_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (_error) {
      return [];
    }
  }

  function writeLocal(items) {
    localStorage.setItem(LOCAL_RECENT_KEY, JSON.stringify((items || []).slice(0, MAX_LOCAL)));
  }

  function emitUpdate(detail) {
    const payload = {
      count: cachedCount != null ? cachedCount : readLocal().length,
      ...(detail || {})
    };
    try {
      global.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
    } catch (_error) {}
    return payload;
  }

  function upsertLocal(product) {
    if (!product || !(product.id || product.catalogId)) {
      return readLocal();
    }

    const id = String(product.id || product.catalogId);
    const next = readLocal().filter((entry) => String(entry.id || entry.catalogId) !== id);
    next.unshift({
      id,
      catalogId: product.catalogId || id,
      name: product.name || product.title || 'Product',
      price: Number(product.price || 0),
      oldPrice: Number(product.oldPrice || 0),
      discountPercent: Number(product.discountPercent || 0),
      image: product.image || product.mainImage || '',
      mainImage: product.mainImage || product.image || '',
      stock: Number(product.stock || 0),
      viewedAt: new Date().toISOString()
    });
    writeLocal(next);
    cachedCount = next.length;
    return next;
  }

  function shouldSkipTrack(productId) {
    const id = String(productId || '').trim();
    if (!id) return true;

    if (trackedThisPage.has(id)) {
      return true;
    }

    const last = Number(lastTrackAt[id] || 0);
    if (last && (Date.now() - last) < CLIENT_THROTTLE_MS) {
      return true;
    }

    return false;
  }

  async function trackProductView(productOrId) {
    const productId = typeof productOrId === 'object'
      ? String(productOrId?.id || productOrId?.catalogId || '').trim()
      : String(productOrId || '').trim();

    if (!productId || shouldSkipTrack(productId)) {
      return null;
    }

    trackedThisPage.add(productId);
    lastTrackAt[productId] = Date.now();

    if (typeof productOrId === 'object') {
      upsertLocal(productOrId);
      emitUpdate({ source: 'local-track', productId });
    }

    // Guests keep local history only — server history is per authenticated customer.
    if (!isLoggedIn()) {
      return { local: true, count: cachedCount };
    }

    try {
      const response = await global.authService.authFetch(apiUrl('/recently-viewed'), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ productId })
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch (_error) {
        payload = null;
      }

      if (response.ok && payload?.success !== false) {
        const count = Number(payload?.history?.count);
        if (Number.isFinite(count)) {
          cachedCount = count;
        }
        emitUpdate({ source: 'server-track', productId, count: cachedCount });
      }

      return payload;
    } catch (_error) {
      return null;
    }
  }

  async function getHistory(limit) {
    if (!isLoggedIn()) {
      const local = readLocal();
      return {
        items: local.slice(0, limit || MAX_LOCAL).map((entry) => ({
          productId: String(entry.id || entry.catalogId || ''),
          viewedAt: entry.viewedAt || null,
          product: entry
        })),
        count: local.length
      };
    }

    const query = limit ? `?limit=${encodeURIComponent(limit)}` : '';
    const response = await global.authService.authFetch(apiUrl(`/recently-viewed${query}`), {
      headers: { Accept: 'application/json' }
    });
    const payload = await response.json();
    if (!response.ok || payload?.success === false) {
      const error = new Error(payload?.message || 'Unable to load recently viewed products.');
      error.status = response.status;
      throw error;
    }

    const history = payload.history || { items: [], count: 0 };
    cachedCount = Number(history.count || 0);
    return history;
  }

  async function getCount() {
    if (!isLoggedIn()) {
      cachedCount = readLocal().length;
      return cachedCount;
    }

    const response = await global.authService.authFetch(apiUrl('/recently-viewed/count'), {
      headers: { Accept: 'application/json' }
    });
    const payload = await response.json();
    if (!response.ok || payload?.success === false) {
      const error = new Error(payload?.message || 'Unable to load count.');
      error.status = response.status;
      throw error;
    }

    cachedCount = Number(payload.count || 0);
    return cachedCount;
  }

  async function mergeLocalToServer() {
    if (!isLoggedIn()) {
      return { count: readLocal().length, merged: false };
    }

    const local = readLocal();
    const productIds = local
      .map((entry) => String(entry?.id || entry?.catalogId || entry?.productId || '').trim())
      .filter(Boolean);

    if (!productIds.length) {
      const count = await getCount().catch(() => 0);
      emitUpdate({ source: 'merge-empty', count });
      return { count, merged: false };
    }

    const response = await global.authService.authFetch(apiUrl('/recently-viewed/merge'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ productIds })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
      const error = new Error(payload?.message || 'Unable to sync recently viewed.');
      error.status = response.status;
      throw error;
    }

    cachedCount = Number(payload.history?.count || productIds.length);
    emitUpdate({ source: 'merge', count: cachedCount });
    return { count: cachedCount, merged: true, history: payload.history };
  }

  global.recentlyViewedTracker = {
    trackProductView,
    readLocal,
    getHistory,
    getCount,
    mergeLocalToServer,
    EVENT_NAME,
    getCachedCount() {
      return cachedCount != null ? cachedCount : readLocal().length;
    }
  };
})(window);
