(function (global) {
  'use strict';

  const PRODUCTION_API_ORIGIN = 'https://byosemarket.com';

  function normalizeBase(value) {
    return String(value || '').trim().replace(/\/+$/, '');
  }

  function isLocalHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
  }

  function resolveApiOrigin() {
    const explicit = normalizeBase(global.BYOSE_API_BASE_URL || global.__BYOSE_API_BASE__ || '');
    if (explicit) {
      return explicit.replace(/\/api$/i, '');
    }
    const hostname = String(global.location?.hostname || '').trim();
    const protocol = String(global.location?.protocol || '').toLowerCase();
    if (protocol === 'file:' || isLocalHost(hostname)) {
      return `http://${hostname || 'localhost'}:5000`;
    }
    if (/(^|\.)byosemarket\.com$/i.test(hostname)) {
      return PRODUCTION_API_ORIGIN;
    }
    return normalizeBase(global.location?.origin || '');
  }

  function apiUrl(path) {
    return `${resolveApiOrigin()}/api${path}`;
  }

  async function request(path, options = {}) {
    if (global.authService?.restoreSession) {
      await global.authService.restoreSession().catch(() => {});
    }

    const send = global.authService?.authFetch
      ? (url, init) => global.authService.authFetch(url, init)
      : fetch;

    const response = await send(apiUrl(path), {
      method: options.method || 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
      const error = new Error(payload?.message || 'Address request failed');
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function toShipping(address) {
    if (!address) return null;
    return {
      savedAddressId: String(address.id || '').trim(),
      fullName: String(address.fullName || '').trim(),
      phone: String(address.phone || '').trim(),
      provinceCity: String(address.provinceCity || address.city || '').trim(),
      district: String(address.district || '').trim(),
      sector: String(address.sector || '').trim(),
      cell: String(address.cell || '').trim(),
      village: String(address.village || '').trim(),
      street: String(address.street || address.line1 || '').trim(),
      note: String(address.note || address.additional || '').trim(),
      latitude: String(address.latitude || '').trim(),
      longitude: String(address.longitude || '').trim(),
      mapLink: String(address.mapLink || '').trim(),
      locationAccuracy: String(address.locationAccuracy || '').trim(),
      locationCapturedAt: String(address.locationCapturedAt || '').trim()
    };
  }

  const api = {
    async list() {
      const payload = await request('/addresses');
      return Array.isArray(payload?.addresses) ? payload.addresses : [];
    },
    async create(address) {
      const payload = await request('/addresses', { method: 'POST', body: address || {} });
      return payload?.address || null;
    },
    async update(addressId, address) {
      const payload = await request(`/addresses/${encodeURIComponent(addressId)}`, {
        method: 'PUT',
        body: address || {}
      });
      return payload?.address || null;
    },
    async remove(addressId) {
      return request(`/addresses/${encodeURIComponent(addressId)}`, { method: 'DELETE' });
    },
    async setDefault(addressId) {
      const payload = await request(`/addresses/${encodeURIComponent(addressId)}/default`, {
        method: 'POST',
        body: {}
      });
      return payload?.address || null;
    },
    toShipping
  };

  global.ByoseCustomerAddresses = api;
})(typeof window !== 'undefined' ? window : globalThis);
