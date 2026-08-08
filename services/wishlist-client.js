(function (global) {
  'use strict';

  const PRODUCTION_API_ORIGIN = 'https://byosemarket.com';
  const LOCAL_IDS_KEY = 'byose_market_wishlist_v1';
  const LOCAL_OBJECTS_KEY = 'byose_market_wishlist';
  const EVENT_NAME = 'byose:wishlist-updated';
  const TOAST_ID = 'byoseWishlistToast';

  let cachedIds = null;
  let syncPromise = null;
  let toastTimer = null;

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

  function readLocalIds() {
    try {
      const fromIds = JSON.parse(global.localStorage.getItem(LOCAL_IDS_KEY) || '[]');
      const ids = Array.isArray(fromIds)
        ? fromIds.map((entry) => String(typeof entry === 'object' ? (entry.id || entry.catalogId || '') : entry).trim()).filter(Boolean)
        : [];

      if (ids.length) {
        return Array.from(new Set(ids));
      }

      const fromObjects = JSON.parse(global.localStorage.getItem(LOCAL_OBJECTS_KEY) || '[]');
      if (!Array.isArray(fromObjects)) {
        return [];
      }

      return Array.from(new Set(fromObjects.map((entry) => String(entry?.id || entry?.catalogId || '').trim()).filter(Boolean)));
    } catch (_error) {
      return [];
    }
  }

  function writeLocalIds(ids) {
    const next = Array.from(new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean)));
    global.localStorage.setItem(LOCAL_IDS_KEY, JSON.stringify(next));
    cachedIds = next;
    return next;
  }

  function emitUpdate(detail) {
    const payload = {
      ids: getCachedIds(),
      count: getCachedIds().length,
      ...(detail || {})
    };
    try {
      global.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
    } catch (_error) {}
    return payload;
  }

  function getCachedIds() {
    if (!Array.isArray(cachedIds)) {
      cachedIds = readLocalIds();
    }
    return cachedIds.slice();
  }

  function ensureToastHost() {
    let host = document.getElementById(TOAST_ID);
    if (host) {
      return host;
    }

    host = document.createElement('div');
    host.id = TOAST_ID;
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    host.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:24px',
      'transform:translateX(-50%) translateY(20px)',
      'z-index:9999',
      'max-width:min(92vw,420px)',
      'padding:12px 16px',
      'border-radius:12px',
      'background:#132033',
      'color:#fff',
      'font:600 14px/1.4 "Plus Jakarta Sans",Arial,sans-serif',
      'box-shadow:0 16px 40px rgba(19,32,51,.28)',
      'opacity:0',
      'pointer-events:none',
      'transition:opacity .2s ease, transform .2s ease'
    ].join(';');
    document.body.appendChild(host);
    return host;
  }

  function showToast(message, type) {
    if (!message) return;
    if (typeof global.showToast === 'function') {
      try {
        global.showToast(message, type);
        return;
      } catch (_error) {}
    }

    const host = ensureToastHost();
    host.textContent = message;
    host.style.background = type === 'error' ? '#b42318' : (type === 'success' ? '#0f7b4d' : '#132033');
    host.style.opacity = '1';
    host.style.transform = 'translateX(-50%) translateY(0)';
    if (toastTimer) {
      global.clearTimeout(toastTimer);
    }
    toastTimer = global.setTimeout(() => {
      host.style.opacity = '0';
      host.style.transform = 'translateX(-50%) translateY(20px)';
    }, 2600);
  }

  function redirectToLogin() {
    const next = `${global.location.pathname}${global.location.search}${global.location.hash}`;
    const loginUrl = new URL('login.html', global.location.href);
    // Prefer site-root login when nested under /details or /account
    const pathname = String(global.location.pathname || '');
    const accountIdx = pathname.toLowerCase().indexOf('/account/');
    const detailsIdx = pathname.toLowerCase().indexOf('/details/');
    let loginPath = 'login.html';
    if (accountIdx >= 0) {
      loginPath = `${pathname.slice(0, accountIdx)}/login.html`.replace(/\/{2,}/g, '/');
    } else if (detailsIdx >= 0) {
      loginPath = `${pathname.slice(0, detailsIdx)}/login.html`.replace(/\/{2,}/g, '/');
    } else if (pathname.includes('/')) {
      const depth = pathname.split('/').filter(Boolean).length - 1;
      loginPath = `${'../'.repeat(Math.max(0, depth))}login.html` || 'login.html';
    }

    try {
      const resolved = new URL(loginPath, global.location.href);
      resolved.searchParams.set('next', next.startsWith('/') ? next : `/${next.replace(/^\/+/, '')}`);
      global.location.href = resolved.href;
    } catch (_error) {
      loginUrl.searchParams.set('next', next.startsWith('/') ? next : `/${next}`);
      global.location.href = loginUrl.href;
    }
  }

  async function authJson(path, options) {
    if (!global.authService || typeof global.authService.authFetch !== 'function') {
      const error = new Error('Authentication is unavailable.');
      error.code = 'AUTH_UNAVAILABLE';
      throw error;
    }

    const response = await global.authService.authFetch(apiUrl(path), {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options && options.headers ? options.headers : {})
      }
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (_error) {
      payload = null;
    }

    if (response.status === 401) {
      const error = new Error('Please sign in to use your wishlist.');
      error.status = 401;
      throw error;
    }

    if (!response.ok || payload?.success === false) {
      const error = new Error(payload?.message || 'Something went wrong. Please try again.');
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  function friendlyError(error) {
    if (!error) return 'Something went wrong. Please try again.';
    if (error.status === 401) return 'Please sign in to use your wishlist.';
    if (error.status === 404) return 'That product is no longer available.';
    return 'Something went wrong. Please try again.';
  }

  async function syncFromServer(force) {
    if (!isLoggedIn()) {
      cachedIds = readLocalIds();
      return getCachedIds();
    }

    if (syncPromise && !force) {
      return syncPromise;
    }

    syncPromise = (async () => {
      const payload = await authJson('/wishlist/ids');
      const ids = Array.isArray(payload?.wishlist?.ids) ? payload.wishlist.ids.map(String) : [];
      writeLocalIds(ids);
      emitUpdate({ source: 'sync' });
      return ids;
    })().catch((error) => {
      cachedIds = readLocalIds();
      throw error;
    }).finally(() => {
      syncPromise = null;
    });

    return syncPromise;
  }

  async function ensureSynced() {
    if (!isLoggedIn()) {
      return getCachedIds();
    }
    if (Array.isArray(cachedIds) && cachedIds.length >= 0 && syncPromise === null) {
      // Kick off background sync once per page if we only have local cache
      syncFromServer(false).catch(() => {});
      return getCachedIds();
    }
    try {
      return await syncFromServer(false);
    } catch (_error) {
      return getCachedIds();
    }
  }

  function isWishlisted(productId) {
    const id = String(productId || '').trim();
    if (!id) return false;
    return getCachedIds().includes(id);
  }

  async function addItem(productId, options) {
    const id = String(productId || '').trim();
    const silent = Boolean(options && options.silent);
    if (!id) {
      throw new Error('Product is required.');
    }

    if (!isLoggedIn()) {
      if (!silent) {
        showToast('Sign in to save products to your wishlist.', 'info');
      }
      redirectToLogin();
      return { added: false, redirected: true, ids: getCachedIds() };
    }

    if (isWishlisted(id)) {
      return { added: false, alreadySaved: true, ids: getCachedIds(), count: getCachedIds().length };
    }

    const payload = await authJson('/wishlist', {
      method: 'POST',
      body: JSON.stringify({ productId: id })
    });

    const ids = Array.isArray(payload?.wishlist?.items)
      ? payload.wishlist.items.map((entry) => String(entry.productId || entry.product?.id || '')).filter(Boolean)
      : writeLocalIds(getCachedIds().concat(id));

    writeLocalIds(ids);
    emitUpdate({ source: 'add', productId: id });
    if (!silent) {
      showToast('Saved to your wishlist.', 'success');
    }
    return { added: true, ids: getCachedIds(), count: getCachedIds().length, wishlist: payload.wishlist };
  }

  async function removeItem(productId, options) {
    const id = String(productId || '').trim();
    const silent = Boolean(options && options.silent);
    if (!id) {
      throw new Error('Product is required.');
    }

    if (!isLoggedIn()) {
      const next = writeLocalIds(getCachedIds().filter((entry) => entry !== id));
      emitUpdate({ source: 'remove', productId: id });
      if (!silent) {
        showToast('Removed from wishlist.', 'success');
      }
      return { removed: true, ids: next, count: next.length };
    }

    const payload = await authJson(`/wishlist/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });

    const ids = Array.isArray(payload?.wishlist?.items)
      ? payload.wishlist.items.map((entry) => String(entry.productId || entry.product?.id || '')).filter(Boolean)
      : writeLocalIds(getCachedIds().filter((entry) => entry !== id));

    writeLocalIds(ids);
    emitUpdate({ source: 'remove', productId: id });
    if (!silent) {
      showToast('Removed from wishlist.', 'success');
    }
    return { removed: true, ids: getCachedIds(), count: getCachedIds().length, wishlist: payload.wishlist };
  }

  async function toggle(productId, options) {
    const id = String(productId || '').trim();
    if (!id) {
      return { active: false };
    }

    if (isWishlisted(id)) {
      const result = await removeItem(id, options);
      return { active: false, ...result };
    }

    const result = await addItem(id, options);
    return { active: Boolean(result.added || result.alreadySaved), ...result };
  }

  async function mergeLocalToServer() {
    if (!isLoggedIn()) {
      return getCachedIds();
    }

    const localIds = readLocalIds();
    if (!localIds.length) {
      return syncFromServer(true);
    }

    const payload = await authJson('/wishlist/merge', {
      method: 'POST',
      body: JSON.stringify({ productIds: localIds })
    });

    const ids = Array.isArray(payload?.wishlist?.items)
      ? payload.wishlist.items.map((entry) => String(entry.productId || entry.product?.id || '')).filter(Boolean)
      : localIds;

    writeLocalIds(ids);
    emitUpdate({ source: 'merge' });
    return ids;
  }

  async function getWishlist() {
    if (!isLoggedIn()) {
      const error = new Error('Please sign in to use your wishlist.');
      error.status = 401;
      throw error;
    }
    const payload = await authJson('/wishlist');
    const wishlist = payload.wishlist || { items: [], count: 0 };
    const ids = (wishlist.items || []).map((entry) => String(entry.productId || entry.product?.id || '')).filter(Boolean);
    writeLocalIds(ids);
    emitUpdate({ source: 'get' });
    return wishlist;
  }

  function updateButton(button, active) {
    if (!button) return;
    button.classList.toggle('is-active', Boolean(active));
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.setAttribute('aria-label', active ? 'Remove from wishlist' : 'Add to wishlist');
    const icon = button.querySelector('.byose-product-wishlist-icon, .wishlist-btn-icon, [data-wishlist-icon]');
    if (icon) {
      if (icon.tagName === 'I' || icon.classList.contains('fa-heart') || icon.classList.contains('fa-regular') || icon.classList.contains('fa-solid')) {
        icon.classList.toggle('fa-solid', Boolean(active));
        icon.classList.toggle('fa-regular', !active);
      } else {
        icon.textContent = active ? '♥' : '♡';
      }
    }
  }

  function refreshButtons(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('[data-wishlist-id]').forEach((button) => {
      const id = button.getAttribute('data-wishlist-id');
      updateButton(button, isWishlisted(id));
    });
  }

  // Keep hearts in sync across the page
  try {
    global.addEventListener(EVENT_NAME, () => {
      refreshButtons(document);
    });
  } catch (_error) {}

  // Seed cache immediately
  cachedIds = readLocalIds();

  // After login, sync in background when auth is ready
  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        if (isLoggedIn()) {
          mergeLocalToServer().catch(() => syncFromServer(true).catch(() => {}));
        }
      });
    } else if (isLoggedIn()) {
      mergeLocalToServer().catch(() => syncFromServer(true).catch(() => {}));
    }
  } catch (_error) {}

  const api = {
    getCachedIds,
    setIds(ids) {
      const next = writeLocalIds(ids);
      emitUpdate({ source: 'set' });
      return next;
    },
    isWishlisted,
    ensureSynced,
    syncFromServer,
    addItem,
    removeItem,
    toggle,
    mergeLocalToServer,
    getWishlist,
    updateButton,
    refreshButtons,
    showToast,
    friendlyError,
    redirectToLogin,
    EVENT_NAME
  };

  global.ByoseWishlist = api;
  return api;
})(window);
