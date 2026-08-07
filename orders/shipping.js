import { initCheckout, commitShipping, getState, guardStep, setDeliveryQuote, subscribe, updateShipping } from './core/state.js';
import { renderProgress, renderSidebar, renderStickyBar, showMessage } from './ui/layout.js';
import {
  LOCATION_STATUS,
  formatCoordinates,
  initializeShippingLocation
} from './location-service.js';
import { normalizePhone } from './utils.js';

function formatPhoneLocal(phone) {
  const normalized = normalizePhone(phone);
  const match = normalized.match(/^\+250(\d{9})$/);
  return match ? `0${match[1]}` : String(phone || '');
}

const form = document.getElementById('shippingForm');
const messageEl = document.getElementById('message');
const progressEl = document.getElementById('progress');
const sidebarEl = document.getElementById('sidebar');
const stickyEl = document.getElementById('stickyBar');
const continueBtn = document.getElementById('shippingContinueBtn');
const gpsCard = document.getElementById('gpsCard') || document.querySelector('.ck-gps-card');
const gpsStatus = document.getElementById('gpsStatus');
const gpsMeta = document.getElementById('gpsMeta');
const gpsMapLink = document.getElementById('gpsMapLink');
const gpsBadge = document.getElementById('gpsBadge');
const gpsRetryBtn = document.getElementById('gpsRetryBtn');
const shippingBackLink = document.getElementById('shippingBackLink');
const deliveryMethodSelect = document.getElementById('deliveryMethodKey');
const deliveryEstimate = document.getElementById('deliveryEstimate');
let quoteTimer = null;

async function loadDeliveryMethods() {
  if (!deliveryMethodSelect || !window.ByoseShippingApi) return;
  try {
    const delivery = await window.ByoseShippingApi.getDeliveryConfig();
    const methods = Array.isArray(delivery?.methods) ? delivery.methods : [];
    if (!methods.length) return;
    const current = deliveryMethodSelect.value || getState().deliveryMethodKey || 'homeDelivery';
    deliveryMethodSelect.innerHTML = methods.map((method) => (
      `<option value="${method.id}">${method.label}</option>`
    )).join('');
    deliveryMethodSelect.value = methods.some((method) => method.id === current)
      ? current
      : methods[0].id;
  } catch (_error) {
    // Keep default option.
  }
}

async function refreshShippingQuote() {
  if (!window.ByoseShippingApi?.calculateShipping) return;
  const state = getState();
  const address = {
    country: 'Rwanda',
    ...readAddressFields()
  };
  const method = deliveryMethodSelect?.value || state.deliveryMethodKey || 'homeDelivery';
  try {
    const quote = await window.ByoseShippingApi.calculateShipping({
      subtotal: state.totals?.subtotal || 0,
      address,
      method
    });
    setDeliveryQuote({
      fee: quote.fee,
      method: quote.method,
      estimate: quote.estimatedDelivery
    });
    if (deliveryEstimate) {
      const feeLabel = `${Number(quote.fee || 0).toLocaleString('en-US')} RWF`;
      deliveryEstimate.textContent = quote.freeDeliveryApplied
        ? `Free delivery applied · ETA ${quote.estimatedDelivery || '—'}`
        : `Shipping ${feeLabel} · ETA ${quote.estimatedDelivery || '—'}`;
    }
    render();
  } catch (error) {
    if (deliveryEstimate) {
      deliveryEstimate.textContent = error?.message || 'Unable to calculate shipping for this address yet.';
    }
  }
}

function scheduleQuoteRefresh() {
  clearTimeout(quoteTimer);
  quoteTimer = setTimeout(() => {
    void refreshShippingQuote();
  }, 350);
}

function syncShippingBackLink() {
  if (!shippingBackLink) return;
  const source = getState().source;
  if (source === 'direct') {
    shippingBackLink.href = '../index.html';
    shippingBackLink.textContent = 'Continue Shopping';
  } else {
    shippingBackLink.href = '../cart.html';
    shippingBackLink.textContent = 'Back';
  }
}

function render() {
  const state = getState();
  progressEl.innerHTML = renderProgress('shipping');
  sidebarEl.innerHTML = renderSidebar(state.products, state.totals);
  stickyEl.innerHTML = renderStickyBar('Continue to Review', 'shippingContinueBtn');
  document.getElementById('stickyContinueBtn')?.addEventListener('click', handleContinue);
  syncShippingBackLink();
}

function fillForm(shipping, { onlyEmpty = false } = {}) {
  if (!form) return;
  const keys = ['fullName', 'phone', 'provinceCity', 'district', 'sector', 'cell', 'village', 'note'];
  keys.forEach((key) => {
    if (shipping?.[key] === undefined) return;
    const input = form.elements.namedItem(key);
    if (!input || !('value' in input)) return;
    if (onlyEmpty && String(input.value || '').trim()) return;

    if (key === 'phone') {
      input.value = formatPhoneLocal(shipping[key]);
      return;
    }
    input.value = String(shipping[key] || '');
  });
}

function readForm() {
  const data = {};
  if (!form) return data;
  new FormData(form).forEach((value, key) => { data[key] = String(value).trim(); });
  return data;
}

function readAddressFields() {
  const data = readForm();
  return {
    provinceCity: data.provinceCity || '',
    district: data.district || '',
    sector: data.sector || '',
    cell: data.cell || '',
    village: data.village || ''
  };
}

function clearFieldError(fieldName) {
  if (!form || !fieldName) return;
  const errorEl = form.querySelector(`[data-error="${fieldName}"]`);
  if (errorEl) errorEl.textContent = '';
  const input = form.elements.namedItem(fieldName);
  if (input && 'classList' in input) {
    input.classList.remove('is-invalid');
    input.removeAttribute('aria-invalid');
  }
}

function showErrors(errors = {}) {
  if (!form) return;
  let firstInvalid = null;

  form.querySelectorAll('[data-error]').forEach((el) => {
    const field = el.dataset.error;
    const message = errors[field] || '';
    el.textContent = message;
    const input = form.elements.namedItem(field);
    if (input && 'classList' in input) {
      const invalid = Boolean(message);
      input.classList.toggle('is-invalid', invalid);
      if (invalid) {
        input.setAttribute('aria-invalid', 'true');
        if (!firstInvalid) firstInvalid = input;
      } else {
        input.removeAttribute('aria-invalid');
      }
    }
  });

  if (firstInvalid && typeof firstInvalid.focus === 'function') {
    firstInvalid.focus({ preventScroll: false });
  }
}

function setGpsUi(status, label, position) {
  if (gpsStatus) {
    gpsStatus.textContent = label || '';
  }
  if (gpsCard) {
    gpsCard.dataset.state = status || '';
  }
  if (gpsBadge) {
    gpsBadge.dataset.state = status || '';
    gpsBadge.textContent = status === LOCATION_STATUS.SUCCESS
      ? 'Ready'
      : status === LOCATION_STATUS.MANUAL || status === LOCATION_STATUS.UNAVAILABLE
        ? 'Manual'
        : status === LOCATION_STATUS.IMPROVING
          ? 'Refining'
          : 'Locating';
  }

  if (gpsRetryBtn) {
    const showRetry = status === LOCATION_STATUS.MANUAL || status === LOCATION_STATUS.UNAVAILABLE;
    gpsRetryBtn.hidden = !showRetry;
  }

  if (position?.latitude && position?.longitude) {
    if (gpsMeta) {
      gpsMeta.textContent = formatCoordinates(position.latitude, position.longitude, position.accuracy);
    }
    if (gpsMapLink && position.mapLink) {
      gpsMapLink.href = position.mapLink;
      gpsMapLink.hidden = false;
    }
  }
}

function applyPositionToState(position) {
  if (!position?.latitude || !position?.longitude) return;
  updateShipping({
    latitude: position.latitude,
    longitude: position.longitude,
    mapLink: position.mapLink,
    locationAccuracy: String(position.accuracy || ''),
    locationCapturedAt: position.capturedAt || new Date().toISOString()
  });
}

async function handleContinue() {
  showMessage(messageEl, '');
  try {
    await refreshShippingQuote();
  } catch (_error) {
    // Quote failures are surfaced in the estimate helper text.
  }
  const result = commitShipping(readForm());
  if (!result.valid) {
    showErrors(result.errors || {});
    showMessage(messageEl, 'Please complete the highlighted fields to continue.');
    return;
  }
  showErrors({});
  window.location.assign('checkout.html');
}

async function startLocationService({ allowReprompt = false } = {}) {
  const existing = getState().shipping || {};
  if (existing.latitude && existing.longitude) {
    setGpsUi(
      LOCATION_STATUS.SUCCESS,
      'Location detected successfully.',
      {
        latitude: existing.latitude,
        longitude: existing.longitude,
        accuracy: existing.locationAccuracy,
        mapLink: existing.mapLink
      }
    );
  } else {
    setGpsUi(LOCATION_STATUS.DETECTING, 'Detecting location...');
  }

  await initializeShippingLocation({
    allowReprompt,
    currentAddress: readAddressFields(),
    onStatus(status, label, position) {
      setGpsUi(status, label, position);
    },
    onPosition(position) {
      applyPositionToState(position);
      const accuracy = Number(position.accuracy);
      const refining = Number.isFinite(accuracy) && accuracy > 45;
      setGpsUi(
        refining ? LOCATION_STATUS.IMPROVING : LOCATION_STATUS.SUCCESS,
        refining ? 'Improving GPS accuracy...' : 'Location detected successfully.',
        position
      );
    },
    onAddress(autofill) {
      if (!autofill || !Object.keys(autofill).length) return;
      updateShipping(autofill);
      fillForm(autofill, { onlyEmpty: true });
    }
  });

  const shipping = getState().shipping || {};
  if (shipping.latitude && shipping.longitude) {
    setGpsUi(
      LOCATION_STATUS.SUCCESS,
      'Location detected successfully.',
      {
        latitude: shipping.latitude,
        longitude: shipping.longitude,
        accuracy: shipping.locationAccuracy,
        mapLink: shipping.mapLink
      }
    );
  } else if (gpsCard?.dataset.state !== LOCATION_STATUS.MANUAL) {
    setGpsUi(LOCATION_STATUS.MANUAL, 'Using manual address.');
  }
}

gpsRetryBtn?.addEventListener('click', () => {
  void startLocationService({ allowReprompt: true });
});

form?.addEventListener('input', (event) => {
  const target = event.target;
  if (target && target.name) {
    clearFieldError(target.name);
  }
  if (messageEl && !messageEl.hidden) {
    showMessage(messageEl, '');
  }
  updateShipping(readForm());
  if (['provinceCity', 'district', 'sector', 'cell', 'village', 'deliveryMethodKey'].includes(target?.name)) {
    scheduleQuoteRefresh();
  }
});
deliveryMethodSelect?.addEventListener('change', () => {
  updateShipping(readForm());
  scheduleQuoteRefresh();
});
form?.addEventListener('submit', (e) => { e.preventDefault(); handleContinue(); });
continueBtn?.addEventListener('click', handleContinue);

subscribe(() => render());

await initCheckout('shipping');
await loadDeliveryMethods();
if (typeof window.ByoseShippingApi?.resolveDefaultFee === 'function') {
  setDeliveryQuote({ fee: window.ByoseShippingApi.resolveDefaultFee() });
}
scheduleQuoteRefresh();
const access = guardStep('shipping');
if (!access.ok) {
  window.location.href = access.redirect;
} else {
  fillForm(getState().shipping);
  render();
  void startLocationService();
  window.__ckStep = 'shipping';
}
