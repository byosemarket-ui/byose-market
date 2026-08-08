(function (global) {
  'use strict';

  const EVENT_NAME = 'byose:recently-viewed-updated';

  function emitUpdate(history) {
    const count = Number(history?.count || history?.items?.length || 0);
    try {
      global.dispatchEvent(new CustomEvent(EVENT_NAME, {
        detail: { count, source: 'account-service' }
      }));
    } catch (_error) {}
    return history;
  }

  async function getHistory(limit) {
    const query = limit ? `?limit=${encodeURIComponent(limit)}` : '';
    const payload = await global.accountFeaturesApi.authJson(`/recently-viewed${query}`);
    return emitUpdate(payload.history || { items: [], count: 0 });
  }

  async function getCount() {
    const payload = await global.accountFeaturesApi.authJson('/recently-viewed/count');
    const count = Number(payload.count || 0);
    emitUpdate({ count, items: [] });
    return count;
  }

  async function addView(productId) {
    const payload = await global.accountFeaturesApi.authJson('/recently-viewed', {
      method: 'POST',
      body: JSON.stringify({ productId })
    });
    return emitUpdate(payload.history || { items: [], count: 0 });
  }

  async function removeItem(productId) {
    const payload = await global.accountFeaturesApi.authJson(`/recently-viewed/${encodeURIComponent(productId)}`, {
      method: 'DELETE'
    });
    return emitUpdate(payload.history || { items: [], count: 0 });
  }

  async function clear() {
    const payload = await global.accountFeaturesApi.authJson('/recently-viewed/clear', {
      method: 'DELETE'
    });
    return emitUpdate(payload.history || { items: [], count: 0 });
  }

  global.recentlyViewedService = {
    getHistory,
    getCount,
    addView,
    removeItem,
    clear,
    EVENT_NAME
  };
})(window);
