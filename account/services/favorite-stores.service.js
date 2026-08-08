(function (global) {
  'use strict';

  function emit(count, favorites) {
    try {
      global.dispatchEvent(new CustomEvent('byose:favorite-stores-updated', {
        detail: { count: Number(count || 0), favorites }
      }));
    } catch (_error) {}
  }

  async function getFavorites() {
    if (global.ByoseFavoriteStores?.getFavorites) {
      return global.ByoseFavoriteStores.getFavorites();
    }
    const payload = await global.accountFeaturesApi.authJson('/favorite-stores');
    const favorites = payload.favorites || { items: [], count: 0 };
    emit(favorites.count, favorites);
    return favorites;
  }

  async function discover() {
    if (global.ByoseFavoriteStores?.listStores) {
      return global.ByoseFavoriteStores.listStores();
    }
    const payload = await global.accountFeaturesApi.authJson('/favorite-stores/discover');
    return Array.isArray(payload.stores) ? payload.stores : [];
  }

  async function follow(storeId) {
    if (global.ByoseFavoriteStores?.follow) {
      const result = await global.ByoseFavoriteStores.follow(storeId, { silent: true });
      return result.favorites || { items: [], count: 0 };
    }
    const payload = await global.accountFeaturesApi.authJson('/favorite-stores/follow', {
      method: 'POST',
      body: JSON.stringify({ storeId })
    });
    const favorites = payload.favorites || { items: [], count: 0 };
    emit(favorites.count, favorites);
    return favorites;
  }

  async function unfollow(storeId) {
    if (global.ByoseFavoriteStores?.unfollow) {
      const result = await global.ByoseFavoriteStores.unfollow(storeId, { silent: true });
      return result.favorites || { items: [], count: 0 };
    }
    const payload = await global.accountFeaturesApi.authJson(`/favorite-stores/${encodeURIComponent(storeId)}`, {
      method: 'DELETE'
    });
    const favorites = payload.favorites || { items: [], count: 0 };
    emit(favorites.count, favorites);
    return favorites;
  }

  async function updateNotificationPrefs(storeId, prefs) {
    const payload = await global.accountFeaturesApi.authJson(
      `/favorite-stores/${encodeURIComponent(storeId)}/notifications`,
      {
        method: 'PATCH',
        body: JSON.stringify(prefs || {})
      }
    );
    return payload;
  }

  global.favoriteStoresService = {
    getFavorites,
    discover,
    follow,
    unfollow,
    updateNotificationPrefs
  };
})(window);
