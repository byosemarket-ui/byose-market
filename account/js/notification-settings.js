(function () {
  'use strict';

  var KEY = 'byose_notifications';
  var inputs = [];
  var statusEl = null;
  var saving = false;
  var lastSaved = { orders: true, shipping: true, promo: true, system: true };

  function apiOrigin() {
    var explicit = String(window.BYOSE_API_BASE_URL || window.__BYOSE_API_BASE__ || '').replace(/\/+$/, '');
    if (explicit) return explicit.replace(/\/api$/i, '');
    var hostname = String(window.location?.hostname || '');
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://' + (hostname || 'localhost') + ':5000';
    }
    return String(window.location?.origin || '').replace(/\/+$/, '');
  }

  function setStatus(type, message) {
    if (!statusEl) return;
    statusEl.className = 'notif-status' + (type ? ' is-' + type : '');
    statusEl.textContent = message || '';
    statusEl.hidden = !message;
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_error) {
      return {};
    }
  }

  function writeCache(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (_error) {}
  }

  function normalizeState(state) {
    return {
      orders: state?.orders !== false,
      shipping: state?.shipping !== false,
      promo: state?.promo !== false,
      system: true
    };
  }

  function applyState(state) {
    var next = normalizeState(state);
    inputs.forEach(function (input) {
      var type = input.dataset.type;
      if (!Object.prototype.hasOwnProperty.call(next, type)) return;
      input.checked = !!next[type];
      if (type === 'system') {
        input.checked = true;
        input.disabled = true;
        input.setAttribute('aria-disabled', 'true');
      } else {
        input.disabled = saving;
      }
    });
    return next;
  }

  function buildState() {
    var state = {};
    inputs.forEach(function (input) {
      state[input.dataset.type] = !!input.checked;
    });
    return normalizeState(state);
  }

  async function fetchPrefs() {
    if (!window.authService?.authFetch || !window.authService.isLoggedIn?.()) return null;
    var response = await window.authService.authFetch(apiOrigin() + '/api/customer-notifications/prefs', {
      headers: { Accept: 'application/json' }
    });
    var payload = await response.json().catch(function () { return null; });
    if (!response.ok || !payload?.prefs) {
      var err = new Error(payload?.message || 'Unable to load notification settings.');
      err.status = response.status;
      throw err;
    }
    return normalizeState(payload.prefs);
  }

  async function savePrefs(state) {
    if (!window.authService?.authFetch || !window.authService.isLoggedIn?.()) {
      throw new Error('not_authenticated');
    }
    var response = await window.authService.authFetch(apiOrigin() + '/api/customer-notifications/prefs', {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(normalizeState(state))
    });
    var payload = await response.json().catch(function () { return null; });
    if (!response.ok || !payload?.prefs) {
      var err = new Error(payload?.message || 'Unable to update notification settings.');
      err.status = response.status;
      throw err;
    }
    return normalizeState(payload.prefs);
  }

  async function handleChange() {
    if (saving) return;
    var next = buildState();
    var previous = lastSaved;
    applyState(next);
    saving = true;
    setStatus('saving', 'Saving notification settings…');
    inputs.forEach(function (input) {
      if (input.dataset.type !== 'system') input.disabled = true;
    });

    try {
      var saved = await savePrefs(next);
      lastSaved = saved;
      applyState(saved);
      writeCache(saved);
      setStatus('success', 'Notification settings saved.');
      try {
        window.dispatchEvent(new CustomEvent('byose:notifications:changed', { detail: saved }));
      } catch (_error) {}
    } catch (error) {
      applyState(previous);
      writeCache(previous);
      var message = String(error?.message || error || '').trim();
      if (/not_authenticated|401|unauthorized/i.test(message)) {
        setStatus('error', 'Please sign in again to save notification settings.');
      } else {
        setStatus('error', message || 'Could not save notification settings.');
      }
    } finally {
      saving = false;
      inputs.forEach(function (input) {
        if (input.dataset.type !== 'system') input.disabled = false;
      });
    }
  }

  async function init() {
    inputs = Array.from(document.querySelectorAll('.toggle-input'));
    statusEl = document.getElementById('notificationStatus');
    if (!inputs.length) return;

    if (window.authService?.whenReady) {
      await window.authService.whenReady().catch(function () {});
    }

    applyState(readCache());
    setStatus('saving', 'Loading notification settings…');

    try {
      var remote = await fetchPrefs();
      lastSaved = applyState(remote);
      writeCache(lastSaved);
      setStatus('', '');
    } catch (error) {
      lastSaved = applyState(Object.assign({}, lastSaved, readCache()));
      setStatus('error', 'Could not load saved notification settings.');
    }

    inputs.forEach(function (input) {
      input.addEventListener('change', function () {
        if (input.dataset.type === 'system') {
          input.checked = true;
          return;
        }
        void handleChange();
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () { void init(); });
})();
