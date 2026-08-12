/**
 * Shipping location service — GPS capture, accuracy refinement, reverse geocoding.
 * Used by the checkout shipping step. Does not block manual address entry.
 */

const LOCATION_SESSION_KEY = 'byose_shipping_location_attempt_v1';
const DESIRED_ACCURACY_M = 45;
const WATCH_TIMEOUT_MS = 7000;
const GEOCODE_TIMEOUT_MS = 8000;

export const LOCATION_STATUS = {
  DETECTING: 'detecting',
  IMPROVING: 'improving',
  SUCCESS: 'success',
  MANUAL: 'manual',
  UNAVAILABLE: 'unavailable'
};

export const LOCATION_STATUS_LABELS = {
  [LOCATION_STATUS.DETECTING]: 'Detecting location...',
  [LOCATION_STATUS.IMPROVING]: 'Improving GPS accuracy...',
  [LOCATION_STATUS.SUCCESS]: 'Location detected successfully.',
  [LOCATION_STATUS.MANUAL]: 'Location permission denied — you can continue with your typed address.',
  [LOCATION_STATUS.UNAVAILABLE]: 'Location unavailable — you can continue with your typed address.'
};

function toNumber(value, fallback = NaN) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return '';
}

function buildMapsUrl(latitude, longitude) {
  const lat = toNumber(latitude);
  const lng = toNumber(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

function markAttempted() {
  try {
    sessionStorage.setItem(LOCATION_SESSION_KEY, String(Date.now()));
  } catch (_) { /* ignore */ }
}

export function hasAttemptedThisSession() {
  try {
    return Boolean(sessionStorage.getItem(LOCATION_SESSION_KEY));
  } catch {
    return false;
  }
}

export async function queryGeolocationPermission() {
  try {
    if (!navigator.permissions?.query) {
      return 'unknown';
    }
    const result = await navigator.permissions.query({ name: 'geolocation' });
    return String(result?.state || 'unknown');
  } catch {
    return 'unknown';
  }
}

function readPosition(position) {
  const coords = position?.coords || {};
  const latitude = toNumber(coords.latitude);
  const longitude = toNumber(coords.longitude);
  const accuracy = Math.max(0, Math.round(toNumber(coords.accuracy, 9999)));

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude: latitude.toFixed(6),
    longitude: longitude.toFixed(6),
    accuracy,
    mapLink: buildMapsUrl(latitude, longitude),
    capturedAt: new Date().toISOString()
  };
}

/**
 * Capture the best available GPS reading using high-accuracy watch mode.
 */
export function captureBestPosition(options = {}) {
  const timeoutMs = Math.max(3000, Number(options.timeoutMs) || WATCH_TIMEOUT_MS);
  const desiredAccuracy = Math.max(10, Number(options.desiredAccuracy) || DESIRED_ACCURACY_M);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(Object.assign(new Error('Geolocation unavailable'), { code: 'UNAVAILABLE' }));
      return;
    }

    let best = null;
    let settled = false;
    let watchId = null;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (watchId != null) {
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch (_) { /* ignore */ }
      }
      clearTimeout(timer);
      if (best) {
        resolve(best);
        return;
      }
      reject(error || Object.assign(new Error('Location unavailable'), { code: 'UNAVAILABLE' }));
    };

    const timer = setTimeout(() => {
      finish(Object.assign(new Error('Location timeout'), { code: 'TIMEOUT' }));
    }, timeoutMs);

    const handleSuccess = (position) => {
      if (settled) return;
      const next = readPosition(position);
      if (!next) return;
      if (!best || next.accuracy < best.accuracy) {
        best = next;
        onProgress?.(best);
      }
      if (best.accuracy <= desiredAccuracy) {
        finish();
      }
    };

    const handleError = (error) => {
      if (settled) return;
      const code = Number(error?.code);
      const mapped = Object.assign(new Error(error?.message || 'Location error'), {
        code: code === 1 ? 'DENIED' : code === 2 ? 'UNAVAILABLE' : code === 3 ? 'TIMEOUT' : 'ERROR',
        original: error
      });
      // If we already have a usable reading, keep it.
      if (best) {
        finish();
        return;
      }
      finish(mapped);
    };

    try {
      // Seed quickly, then refine with watch (helps mobile browsers feel snappy).
      navigator.geolocation.getCurrentPosition(handleSuccess, handleError, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: Math.min(4000, timeoutMs)
      });
      watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: timeoutMs
      });
    } catch (error) {
      finish(Object.assign(error || new Error('Location error'), { code: 'UNAVAILABLE' }));
    }
  });
}

/**
 * Map Nominatim (and similar) address payloads to Rwanda checkout fields.
 */
export function mapReverseGeocodeToAddress(payload = {}) {
  const address = payload?.address && typeof payload.address === 'object' ? payload.address : {};

  const provinceCity = firstText(
    address.city,
    address.town,
    address.municipality,
    address.state,
    address.province
  );

  let district = firstText(
    address.district,
    address.city_district,
    address.county,
    address.state_district
  );

  let sector = firstText(
    address.suburb,
    address.quarter,
    address.borough
  );

  let cell = firstText(
    address.neighbourhood,
    address.neighborhood,
    address.residential
  );

  let village = firstText(
    address.village,
    address.hamlet,
    address.locality,
    address.isolated_dwelling
  );

  const used = new Set();
  const unique = (value) => {
    const text = cleanText(value);
    if (!text) return '';
    const key = text.toLowerCase();
    if (used.has(key)) return '';
    used.add(key);
    return text;
  };

  return {
    provinceCity: unique(provinceCity),
    district: unique(district),
    sector: unique(sector),
    cell: unique(cell),
    village: unique(village)
  };
}

export async function reverseGeocode(latitude, longitude, options = {}) {
  const lat = toNumber(latitude);
  const lng = toNumber(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort?.(), GEOCODE_TIMEOUT_MS);

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&addressdetails=1&zoom=18`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Language': options.language || 'en,rw'
      },
      signal: controller?.signal
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return {
      raw: payload,
      fields: mapReverseGeocodeToAddress(payload)
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fill only empty address fields so customer edits are preserved.
 */
export function mergeEmptyAddressFields(current = {}, autofill = {}) {
  const next = {};
  ['provinceCity', 'district', 'sector', 'cell', 'village'].forEach((key) => {
    const existing = cleanText(current[key]);
    const incoming = cleanText(autofill[key]);
    if (!existing && incoming) {
      next[key] = incoming;
    }
  });
  return next;
}

/**
 * Full shipping-page location workflow.
 */
export async function initializeShippingLocation(options = {}) {
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  const onPosition = typeof options.onPosition === 'function' ? options.onPosition : () => {};
  const onAddress = typeof options.onAddress === 'function' ? options.onAddress : () => {};
  const currentAddress = options.currentAddress && typeof options.currentAddress === 'object'
    ? options.currentAddress
    : {};

  if (!navigator.geolocation) {
    onStatus(
      LOCATION_STATUS.UNAVAILABLE,
      'Location unavailable — you can continue with your typed address.'
    );
    return { ok: false, reason: 'unavailable', manual: true };
  }

  const permission = await queryGeolocationPermission();
  if (permission === 'denied') {
    onStatus(
      LOCATION_STATUS.MANUAL,
      'Location permission denied — you can continue with your typed address.'
    );
    return { ok: false, reason: 'denied', manual: true, permission };
  }

  // Never re-prompt in the same tab session (covers Safari/iOS where Permissions API is "unknown").
  const mayPrompt = permission === 'prompt' || permission === 'unknown';
  if (mayPrompt && hasAttemptedThisSession() && options.allowReprompt !== true) {
    onStatus(
      LOCATION_STATUS.MANUAL,
      'Location optional — you can continue with your typed address.'
    );
    return { ok: false, reason: 'already_attempted', manual: true, permission };
  }

  if (mayPrompt) {
    markAttempted();
  }

  onStatus(LOCATION_STATUS.DETECTING, LOCATION_STATUS_LABELS[LOCATION_STATUS.DETECTING]);

  let position;
  try {
    position = await captureBestPosition({
      timeoutMs: options.timeoutMs || WATCH_TIMEOUT_MS,
      desiredAccuracy: options.desiredAccuracy || DESIRED_ACCURACY_M,
      onProgress: (reading) => {
        if (reading?.accuracy > DESIRED_ACCURACY_M) {
          onStatus(LOCATION_STATUS.IMPROVING, LOCATION_STATUS_LABELS[LOCATION_STATUS.IMPROVING], reading);
        }
        onPosition(reading);
      }
    });
  } catch (error) {
    const denied = error?.code === 'DENIED';
    onStatus(
      denied ? LOCATION_STATUS.MANUAL : LOCATION_STATUS.UNAVAILABLE,
      LOCATION_STATUS_LABELS[denied ? LOCATION_STATUS.MANUAL : LOCATION_STATUS.UNAVAILABLE]
    );
    return { ok: false, reason: error?.code || 'error', manual: true, permission, error };
  }

  onPosition(position);

  if (position.accuracy > DESIRED_ACCURACY_M) {
    onStatus(LOCATION_STATUS.IMPROVING, LOCATION_STATUS_LABELS[LOCATION_STATUS.IMPROVING], position);
  }

  const geocoded = await reverseGeocode(position.latitude, position.longitude);
  const autofill = mergeEmptyAddressFields(currentAddress, geocoded?.fields || {});
  if (Object.keys(autofill).length) {
    onAddress(autofill, geocoded);
  }

  onStatus(LOCATION_STATUS.SUCCESS, LOCATION_STATUS_LABELS[LOCATION_STATUS.SUCCESS], position);
  return {
    ok: true,
    permission,
    position,
    autofill,
    geocode: geocoded
  };
}

export function formatCoordinates(latitude, longitude, accuracy) {
  const lat = cleanText(latitude);
  const lng = cleanText(longitude);
  if (!lat || !lng) return '';
  const acc = toNumber(accuracy);
  if (Number.isFinite(acc) && acc > 0) {
    return `${lat}, ${lng} · ±${Math.round(acc)}m`;
  }
  return `${lat}, ${lng}`;
}
