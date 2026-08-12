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
  document.getElementById('stickyContinueBtn')?.addEventListener('click', (event) => {
    void handleContinue(event);
  });
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
    // Retry is available once locating settles (success, manual, or unavailable).
    gpsRetryBtn.hidden = status === LOCATION_STATUS.DETECTING || status === LOCATION_STATUS.IMPROVING;
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

async function handleContinue(event) {
  event?.preventDefault?.();
  if (handleContinue.inFlight) return;
  handleContinue.inFlight = true;

  const buttons = [
    continueBtn,
    document.getElementById('stickyContinueBtn')
  ].filter(Boolean);
  buttons.forEach((btn) => {
    btn.disabled = true;
  });

  showMessage(messageEl, '');
  try {
    // Validate + persist first. Quote is best-effort and must never block Step 2.
    const formData = readForm();
    const result = commitShipping(formData);
    if (!result.valid) {
      showErrors(result.errors || {});
      const missing = Object.keys(result.errors || {});
      const label = missing[0]
        ? `Please complete: ${missing.map((key) => key === 'phone' ? 'Phone Number' : key).join(', ')}.`
        : 'Please complete the highlighted fields to continue.';
      showMessage(messageEl, label);
      return;
    }
    showErrors({});

    // Fire-and-forget quote refresh — do not await before navigation.
    void Promise.race([
      refreshShippingQuote(),
      new Promise((resolve) => setTimeout(resolve, 1200))
    ]).catch(() => null);

    window.__ckStep = 'review';
    window.location.assign('./checkout.html');
  } finally {
    // If navigation is blocked (validation), re-enable the buttons.
    handleContinue.inFlight = false;
    if (window.location.pathname.includes('shipping')) {
      buttons.forEach((btn) => {
        btn.disabled = false;
      });
    }
  }
}

handleContinue.inFlight = false;

const GPS_UI_FAILSAFE_MS = 8500;
let locationRunId = 0;

async function startLocationService({ allowReprompt = false } = {}) {
  const runId = ++locationRunId;
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
    setGpsUi(
      LOCATION_STATUS.DETECTING,
      'Detecting location... Optional — you can continue with a typed address.'
    );
  }

  // Hard UI fail-safe: never leave the card stuck on Locating if GPS hangs.
  const failSafe = setTimeout(() => {
    if (runId !== locationRunId) return;
    const state = gpsCard?.dataset.state;
    if (state === LOCATION_STATUS.DETECTING || state === LOCATION_STATUS.IMPROVING) {
      setGpsUi(
        LOCATION_STATUS.UNAVAILABLE,
        'Location unavailable — you can continue with your typed address.'
      );
    }
  }, GPS_UI_FAILSAFE_MS);

  try {
    await initializeShippingLocation({
      allowReprompt,
      currentAddress: readAddressFields(),
      onStatus(status, label, position) {
        if (runId !== locationRunId) return;
        setGpsUi(status, label, position);
      },
      onPosition(position) {
        if (runId !== locationRunId) return;
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
        if (runId !== locationRunId) return;
        if (!autofill || !Object.keys(autofill).length) return;
        updateShipping(autofill);
        fillForm(autofill, { onlyEmpty: true });
      }
    });
  } catch (_error) {
    if (runId === locationRunId) {
      setGpsUi(
        LOCATION_STATUS.UNAVAILABLE,
        'Location unavailable — you can continue with your typed address.'
      );
    }
  } finally {
    clearTimeout(failSafe);
  }

  if (runId !== locationRunId) return;

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
  } else if (
    gpsCard?.dataset.state === LOCATION_STATUS.DETECTING
    || gpsCard?.dataset.state === LOCATION_STATUS.IMPROVING
    || !gpsCard?.dataset.state
  ) {
    setGpsUi(
      LOCATION_STATUS.MANUAL,
      'Location unavailable — you can continue with your typed address.'
    );
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
form?.addEventListener('submit', (e) => { e.preventDefault(); void handleContinue(e); });
continueBtn?.addEventListener('click', (e) => {
  // Submit button already triggers form submit — avoid double-handling.
  if (continueBtn.type === 'submit') return;
  void handleContinue(e);
});

subscribe(() => render());

await initCheckout('shipping');
const access = guardStep('shipping');
if (!access.ok) {
  window.location.href = access.redirect;
} else {
  fillForm(getState().shipping);
  render();
  window.__ckStep = 'shipping';

  // GPS is optional and must never wait on delivery-method network calls.
  void startLocationService();

  void loadDeliveryMethods().then(() => {
    if (typeof window.ByoseShippingApi?.resolveDefaultFee === 'function') {
      setDeliveryQuote({ fee: window.ByoseShippingApi.resolveDefaultFee() });
    }
    scheduleQuoteRefresh();
    render();
  }).catch(() => {
    // Keep default delivery option; checkout remains usable.
  });
}
