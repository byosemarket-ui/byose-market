(function (global) {
  'use strict';

  function syncCacheFromWishlist(wishlist) {
    const ids = Array.isArray(wishlist?.items)
      ? wishlist.items.map((entry) => String(entry.productId || entry.product?.id || '')).filter(Boolean)
      : [];

    try {
      global.localStorage.setItem('byose_market_wishlist_v1', JSON.stringify(ids));
    } catch (_error) {}

    if (global.ByoseWishlist && typeof global.ByoseWishlist.setIds === 'function') {
      global.ByoseWishlist.setIds(ids);
    } else {
      try {
        global.dispatchEvent(new CustomEvent('byose:wishlist-updated', {
          detail: { ids, count: ids.length, source: 'account-service' }
        }));
      } catch (_error) {}
    }

    return wishlist;
  }

  async function request(path, options) {
    if (global.ByoseWishlist && path === '/wishlist' && (!options || options.method === 'GET' || !options.method)) {
      return global.ByoseWishlist.getWishlist();
    }

    const payload = await global.accountFeaturesApi.authJson(path, options);
    return payload.wishlist || { items: [], count: 0 };
  }

  async function getWishlist() {
    if (global.ByoseWishlist?.getWishlist) {
      const wishlist = await global.ByoseWishlist.getWishlist();
      return syncCacheFromWishlist(wishlist);
    }
    const wishlist = await request('/wishlist');
    return syncCacheFromWishlist(wishlist);
  }

  async function addItem(productId) {
    if (global.ByoseWishlist?.addItem) {
      const result = await global.ByoseWishlist.addItem(productId, { silent: true });
      return syncCacheFromWishlist(result.wishlist || { items: [], count: result.count || 0 });
    }
    const wishlist = await request('/wishlist', {
      method: 'POST',
      body: JSON.stringify({ productId })
    });
    return syncCacheFromWishlist(wishlist);
  }

  async function removeItem(productId) {
    if (global.ByoseWishlist?.removeItem) {
      const result = await global.ByoseWishlist.removeItem(productId, { silent: true });
      return syncCacheFromWishlist(result.wishlist || { items: [], count: result.count || 0 });
    }
    const wishlist = await request(`/wishlist/${encodeURIComponent(productId)}`, {
      method: 'DELETE'
    });
    return syncCacheFromWishlist(wishlist);
  }

  async function clear() {
    const wishlist = await global.accountFeaturesApi.authJson('/wishlist/clear', {
      method: 'DELETE'
    }).then((payload) => payload.wishlist || { items: [], count: 0 });
    return syncCacheFromWishlist(wishlist);
  }

  global.wishlistService = {
    getWishlist,
    addItem,
    removeItem,
    clear
  };
})(window);
