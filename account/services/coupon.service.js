(function (global) {
  'use strict';

  const EVENT_NAME = 'byose:coupons-updated';
  const SELECTED_COUPON_KEY = 'byose_selected_coupon_v1';

  function emitUpdate(detail) {
    try {
      global.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: detail || {} }));
    } catch (_error) {}
  }

  async function getCoupons(status, options = {}) {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (options.subtotal) params.set('subtotal', String(options.subtotal));
    const query = params.toString() ? `?${params}` : '';
    const payload = await global.accountFeaturesApi.authJson(`/coupons${query}`);
    const coupons = payload.coupons || { items: [], counts: {} };
    emitUpdate({ counts: coupons.counts, source: 'list' });
    return coupons;
  }

  async function getAvailable(options) {
    return getCoupons('available', options);
  }

  async function getUsed() {
    return getCoupons('used');
  }

  async function getExpired() {
    return getCoupons('expired');
  }

  async function getCounts() {
    const payload = await global.accountFeaturesApi.authJson('/coupons/count');
    const counts = payload.counts || {
      available: 0,
      used: 0,
      expired: 0,
      total: 0
    };
    emitUpdate({ counts, source: 'count' });
    return counts;
  }

  async function applyCoupon(code, orderAmount, items) {
    const payload = await global.accountFeaturesApi.authJson('/coupons/apply', {
      method: 'POST',
      body: JSON.stringify({ code, orderAmount, items })
    });
    emitUpdate({ source: 'apply' });
    return payload;
  }

  async function validateCoupon(code, orderAmount, items) {
    const payload = await global.accountFeaturesApi.authJson('/coupons/validate', {
      method: 'POST',
      body: JSON.stringify({ code, orderAmount, subtotal: orderAmount, items })
    });
    return payload;
  }

  function setSelectedCoupon(coupon) {
    try {
      if (!coupon) {
        global.localStorage.removeItem(SELECTED_COUPON_KEY);
        return null;
      }
      const payload = {
        code: String(coupon.code || '').toUpperCase(),
        title: coupon.title || '',
        discountType: coupon.discountType || '',
        discountValue: coupon.discountValue || 0,
        minOrderAmount: coupon.minOrderAmount || 0,
        savedAt: new Date().toISOString()
      };
      global.localStorage.setItem(SELECTED_COUPON_KEY, JSON.stringify(payload));
      return payload;
    } catch (_error) {
      return null;
    }
  }

  function getSelectedCoupon() {
    try {
      const raw = global.localStorage.getItem(SELECTED_COUPON_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_error) {
      return null;
    }
  }

  function clearSelectedCoupon() {
    try {
      global.localStorage.removeItem(SELECTED_COUPON_KEY);
    } catch (_error) {}
  }

  global.couponService = {
    getCoupons,
    getAvailable,
    getUsed,
    getExpired,
    getCounts,
    applyCoupon,
    validateCoupon,
    setSelectedCoupon,
    getSelectedCoupon,
    clearSelectedCoupon,
    EVENT_NAME,
    SELECTED_COUPON_KEY
  };
})(window);
