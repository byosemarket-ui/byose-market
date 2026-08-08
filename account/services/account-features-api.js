(function (global) {
  'use strict';

  const PRODUCTION_API_ORIGIN = 'https://byosemarket.com';

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
    const base = resolveApiOrigin();
    const normalizedPath = String(path || '').startsWith('/') ? path : `/${path}`;
    return `${base}/api${normalizedPath}`;
  }

  async function authJson(path, options = {}) {
    if (!global.authService || typeof global.authService.authFetch !== 'function') {
      throw new Error('Authentication service is unavailable.');
    }

    if (!global.authService.isLoggedIn()) {
      const error = new Error('Unauthorized');
      error.status = 401;
      throw error;
    }

    const response = await global.authService.authFetch(apiUrl(path), {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok || payload?.success === false) {
      const error = new Error(payload?.message || `Request failed (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  function formatCurrency(value) {
    return `RWF ${Number(value || 0).toLocaleString('en-US')}`;
  }

  function productDetailsHref(product) {
    const id = encodeURIComponent(String(product?.id || product?.catalogId || ''));
    return `../../details/product-details1.html?id=${id}`;
  }

  global.accountFeaturesApi = {
    resolveApiOrigin,
    apiUrl,
    authJson,
    formatCurrency,
    productDetailsHref
  };
})(window);
