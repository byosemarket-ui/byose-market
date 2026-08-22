import { initCheckout, continueToReview, getState, guardStep, hydrateSavedAddresses, refreshBackendDeliveryQuote, selectSavedAddress, setDeliveryQuote, subscribe, updateShipping } from './core/state.js';
import { renderProgress, renderSidebar, renderStickyBar, showMessage } from './ui/layout.js';
import {
  LOCATION_STATUS,
  formatCoordinates,
  initializeShippingLocation
} from './location-service.js';
import { escapeHtml, normalizePhone } from './utils.js';

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
const selectedAddressPanel = document.getElementById('selectedAddressPanel');
const selectedAddressContent = document.getElementById('selectedAddressContent');
const changeAddressBtn = document.getElementById('changeAddressBtn');
const savedAddressPanel = document.getElementById('savedAddressPanel');
const savedAddressList = document.getElementById('savedAddressList');
const useNewAddressBtn = document.getElementById('useNewAddressBtn');
const addressModeHint = document.getElementById('addressModeHint');
let continueInFlight = false;
/** @type {'ready'|'change'|'form'} */
let addressUiMode = 'form';

const FIELD_LABELS_UI = {
  fullName: 'Full Name',
  phone: 'Phone Number',
  provinceCity: 'Province / City',
  district: 'District',
  sector: 'Sector',
  cell: 'Cell',
  village: 'Village'
};

function isSignedIn() {
  return Boolean(window.authService?.isLoggedIn?.() || getState().customer?.id);
}

function wantsChangeAddressFlow() {
  try {
    return new URLSearchParams(window.location.search).get('change') === '1';
  } catch (_error) {
    return false;
  }
}

function applyConfiguredDeliveryFee() {
  const fee = typeof window.ByoseShippingApi?.resolveDefaultFee === 'function'
    ? window.ByoseShippingApi.resolveDefaultFee()
    : 2000;
  setDeliveryQuote({ fee });
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

function formatSavedLine(address) {
  return [
    address.provinceCity || address.city,
    address.district,
    address.sector,
    address.cell,
    address.village
  ].filter(Boolean).join(', ');
}

function resolveSelectedSavedAddress() {
  const state = getState();
  const selectedId = String(state.shipping?.savedAddressId || '').trim();
  if (!selectedId) return null;
  return (state.savedAddresses || []).find((entry) => entry.id === selectedId) || null;
}

function canUseReadyMode() {
  if (!isSignedIn()) return false;
  const addresses = getState().savedAddresses || [];
  if (!addresses.length) return false;
  const selectedId = String(getState().shipping?.savedAddressId || '').trim();
  return Boolean(selectedId);
}

function setAddressUiMode(mode) {
  if (mode === 'ready' && !canUseReadyMode()) {
    addressUiMode = 'form';
  } else if (mode === 'ready' || mode === 'change' || mode === 'form') {
    addressUiMode = mode;
  } else {
    addressUiMode = 'form';
  }
  syncAddressModeHint();
  syncUiVisibility();
}

function syncAddressModeHint() {
  if (!addressModeHint) return;

  if (!isSignedIn()) {
    addressModeHint.hidden = true;
    addressModeHint.textContent = '';
    return;
  }

  if (addressUiMode === 'ready') {
    addressModeHint.hidden = true;
    addressModeHint.textContent = '';
    return;
  }

  if (addressUiMode === 'change') {
    addressModeHint.hidden = false;
    addressModeHint.textContent = 'Choose another saved address, edit the delivery details for this order, or add a new address.';
    return;
  }

  if (!(getState().savedAddresses || []).length) {
    addressModeHint.hidden = false;
    addressModeHint.textContent = 'Enter your delivery address. It will be saved to your account for future orders.';
    return;
  }

  addressModeHint.hidden = true;
  addressModeHint.textContent = '';
}

function syncUiVisibility() {
  const ready = addressUiMode === 'ready';
  const change = addressUiMode === 'change';
  const showForm = !ready;

  if (selectedAddressPanel) {
    selectedAddressPanel.hidden = !ready;
  }
  if (savedAddressPanel) {
    savedAddressPanel.hidden = !change || !(getState().savedAddresses || []).length;
  }
  if (form) {
    form.hidden = !showForm;
    form.classList.toggle('ck-shipping-form--hidden', !showForm);
  }
  if (gpsCard) {
    gpsCard.hidden = ready;
  }
}

function renderSelectedAddressSummary() {
  if (!selectedAddressContent) return;

  const shipping = getState().shipping || {};
  const saved = resolveSelectedSavedAddress();
  const fullName = String(shipping.fullName || saved?.fullName || '').trim();
  const phone = formatPhoneLocal(shipping.phone || saved?.phone || '');
  const provinceCity = String(shipping.provinceCity || saved?.provinceCity || '').trim();
  const district = String(shipping.district || saved?.district || '').trim();
  const sector = String(shipping.sector || saved?.sector || '').trim();
  const cell = String(shipping.cell || saved?.cell || '').trim();
  const village = String(shipping.village || saved?.village || '').trim();
  const note = String(shipping.note || saved?.note || '').trim();
  const latitude = String(shipping.latitude || saved?.latitude || '').trim();
  const longitude = String(shipping.longitude || saved?.longitude || '').trim();
  const mapLink = String(shipping.mapLink || saved?.mapLink || '').trim()
    || (latitude && longitude
      ? `https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}`
      : '');

  const rows = [
    ['Full Name', fullName],
    ['Phone Number', phone],
    ['Province / City', provinceCity],
    ['District', district],
    ['Sector', sector],
    ['Cell', cell],
    ['Village', village],
    ['Landmark / Note', note],
    ['GPS / Location', latitude && longitude ? `${latitude}, ${longitude}` : '']
  ].filter(([, value]) => Boolean(String(value || '').trim()));

  selectedAddressContent.innerHTML = `
    <dl class="ck-selected-address__details">
      ${rows.map(([label, value]) => `
        <div class="ck-selected-address__row">
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value)}</dd>
        </div>
      `).join('')}
    </dl>
    ${mapLink ? `<a class="ck-map-link" href="${escapeHtml(mapLink)}" target="_blank" rel="noopener">Open in Maps</a>` : ''}
  `;
}

function renderSavedAddresses() {
  const state = getState();
  const addresses = Array.isArray(state.savedAddresses) ? state.savedAddresses : [];
  if (!savedAddressList) return;

  if (!addresses.length) {
    if (savedAddressPanel) savedAddressPanel.hidden = true;
    savedAddressList.replaceChildren();
    if (isSignedIn() && addressUiMode !== 'ready') {
      setAddressUiMode('form');
    }
    syncAddressModeHint();
    return;
  }

  savedAddressList.replaceChildren();
  const selectedId = String(state.shipping?.savedAddressId || '').trim();

  addresses.forEach((address) => {
    const card = document.createElement('article');
    card.className = `ck-saved-address${address.id === selectedId ? ' is-selected' : ''}`;
    card.dataset.addressId = address.id;

    const top = document.createElement('div');
    top.className = 'ck-saved-address__top';

    const detail = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'ck-saved-address__name';
    name.textContent = address.fullName || 'Saved address';
    const phone = document.createElement('div');
    phone.className = 'ck-saved-address__phone';
    phone.textContent = address.phone || '';
    const line = document.createElement('div');
    line.className = 'ck-saved-address__line';
    line.textContent = formatSavedLine(address);
    detail.append(name, phone, line);

    const badges = document.createElement('div');
    badges.className = 'ck-saved-address__badges';
    if (address.isDefault) {
      const badge = document.createElement('span');
      badge.className = 'ck-saved-address__badge';
      badge.textContent = 'Default';
      badges.append(badge);
    }
    if (address.id === selectedId) {
      const selected = document.createElement('span');
      selected.className = 'ck-saved-address__badge ck-saved-address__badge--selected';
      selected.textContent = 'Selected';
      badges.append(selected);
    }
    top.append(detail, badges);

    const actions = document.createElement('div');
    actions.className = 'ck-saved-address__actions';

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'ck-btn ck-btn--ghost ck-btn--compact';
    selectBtn.textContent = address.id === selectedId ? 'Selected' : 'Use This Address';
    selectBtn.disabled = address.id === selectedId;
    selectBtn.addEventListener('click', () => {
      selectSavedAddress(address.id);
      fillForm(getState().shipping);
      setAddressUiMode('ready');
      renderSavedAddresses();
      renderSelectedAddressSummary();
      void refreshBackendDeliveryQuote();
    });

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'ck-btn ck-btn--ghost ck-btn--compact';
    editBtn.textContent = 'Edit for This Order';
    editBtn.addEventListener('click', () => {
      selectSavedAddress(address.id);
      fillForm(getState().shipping);
      setAddressUiMode('change');
      renderSavedAddresses();
      form?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      form?.elements?.namedItem('fullName')?.focus?.();
    });

    actions.append(selectBtn, editBtn);
    card.append(top, actions);
    savedAddressList.append(card);
  });

  syncAddressModeHint();
  syncUiVisibility();
}

function render() {
  const state = getState();
  progressEl.innerHTML = renderProgress('shipping');
  sidebarEl.innerHTML = renderSidebar(state.products, state.totals);
  stickyEl.innerHTML = renderStickyBar('Continue to Review', 'shippingContinueBtn');
  syncShippingBackLink();
  renderSelectedAddressSummary();
  renderSavedAddresses();
  syncUiVisibility();
}

function fillForm(shipping, { onlyEmpty = false } = {}) {
  if (!form) return;
  const keys = ['savedAddressId', 'fullName', 'phone', 'provinceCity', 'district', 'sector', 'cell', 'village', 'note'];
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

function readShippingData() {
  if (addressUiMode === 'ready') {
    return { ...getState().shipping };
  }
  return readForm();
}

function readAddressFields() {
  const data = readShippingData();
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
    try {
      firstInvalid.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (_error) { /* ignore */ }
    firstInvalid.focus({ preventScroll: true });
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

/**
 * Automatically save new addresses for signed-in customers.
 * Saved-address selection and order-only edits never mutate the address book.
 */
async function autoSyncAddressBook(formData) {
  if (!isSignedIn() || !window.ByoseCustomerAddresses) {
    return formData;
  }

  if (addressUiMode === 'ready') {
    return formData;
  }

  const savedId = String(formData.savedAddressId || '').trim();
  if (savedId) {
    return formData;
  }

  const payload = {
    fullName: formData.fullName,
    phone: formData.phone,
    provinceCity: formData.provinceCity,
    district: formData.district,
    sector: formData.sector,
    cell: formData.cell,
    village: formData.village,
    note: formData.note || '',
    latitude: formData.latitude || getState().shipping?.latitude || '',
    longitude: formData.longitude || getState().shipping?.longitude || '',
    mapLink: formData.mapLink || getState().shipping?.mapLink || '',
    isDefault: !(getState().savedAddresses || []).length
  };

  const created = await window.ByoseCustomerAddresses.create(payload);
  await hydrateSavedAddresses();
  if (created?.id) {
    selectSavedAddress(created.id);
  }
  return { ...formData, savedAddressId: String(created?.id || '').trim() };
}

async function handleContinue(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();

  if (continueInFlight) return;
  continueInFlight = true;

  const buttons = [
    continueBtn,
    document.getElementById('stickyContinueBtn')
  ].filter(Boolean);
  buttons.forEach((btn) => {
    btn.disabled = true;
  });

  showMessage(messageEl, '');

  try {
    let formData = readShippingData();
    try {
      formData = await autoSyncAddressBook(formData);
    } catch (syncError) {
      showMessage(messageEl, syncError?.message || 'Unable to save the shipping address.');
      return;
    }

    const result = continueToReview(formData);

    if (!result.ok) {
      console.error(result.code || 'VALIDATION_FAILED', result);
      if (addressUiMode === 'ready') {
        setAddressUiMode('change');
        render();
      }
      showErrors(result.errors || {});
      const missing = Object.keys(result.errors || {});
      const labels = missing.map((key) => FIELD_LABELS_UI[key] || key);
      const detail = result.code === 'VALIDATION_FAILED' && labels.length
        ? `Please complete: ${labels.join(', ')}.`
        : (result.message || 'Unable to continue.');
      showMessage(messageEl, `${result.code || 'VALIDATION_FAILED'}: ${detail}`);
      return;
    }

    showErrors({});
    window.__ckStep = 'review';

    const target = result.redirectUrl || `./checkout.html?from=shipping&t=${Date.now()}`;
    try {
      window.location.assign(target);
    } catch (navError) {
      console.error('REVIEW_ROUTE_FAILED', navError);
      showMessage(messageEl, `REVIEW_ROUTE_FAILED: ${navError?.message || 'navigation failed'}`);
    }
  } catch (error) {
    console.error('REVIEW_ROUTE_FAILED', error);
    showMessage(messageEl, `REVIEW_ROUTE_FAILED: ${error?.message || 'unexpected error'}`);
  } finally {
    continueInFlight = false;
    if (String(window.location.pathname || '').includes('shipping')) {
      buttons.forEach((btn) => {
        btn.disabled = false;
      });
    }
  }
}

const GPS_UI_FAILSAFE_MS = 8500;
let locationRunId = 0;

async function startLocationService({ allowReprompt = false } = {}) {
  if (addressUiMode === 'ready') return;

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

  const failSafe = setTimeout(() => {
    if (runId !== locationRunId) return;
    const status = gpsCard?.dataset.state;
    if (status === LOCATION_STATUS.DETECTING || status === LOCATION_STATUS.IMPROVING) {
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

changeAddressBtn?.addEventListener('click', () => {
  setAddressUiMode('change');
  renderSavedAddresses();
  savedAddressPanel?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
});

useNewAddressBtn?.addEventListener('click', () => {
  selectSavedAddress('');
  setAddressUiMode('change');
  fillForm(getState().shipping);
  renderSavedAddresses();
  const fullNameInput = form?.elements?.namedItem('fullName');
  if (fullNameInput && typeof fullNameInput.focus === 'function') {
    fullNameInput.focus();
  }
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
});

form?.addEventListener('submit', (event) => {
  handleContinue(event);
});

stickyEl?.addEventListener('click', (event) => {
  const btn = event.target?.closest?.('#stickyContinueBtn');
  if (!btn) return;
  event.preventDefault();
  if (typeof form?.requestSubmit === 'function' && addressUiMode !== 'ready') {
    form.requestSubmit();
    return;
  }
  handleContinue(event);
});

subscribe(() => render());

await initCheckout('shipping');
const access = guardStep('shipping');
if (!access.ok) {
  console.warn('REDIRECT_REASON', access.code || 'UNKNOWN', access);
  window.location.href = access.redirect;
} else {
  await hydrateSavedAddresses();
  const state = getState();
  const hasSaved = (state.savedAddresses || []).length > 0;
  const hasSelected = String(state.shipping?.savedAddressId || '').trim();

  if (!isSignedIn()) {
    setAddressUiMode('form');
  } else if (wantsChangeAddressFlow() && hasSaved) {
    setAddressUiMode('change');
  } else if (hasSaved && hasSelected) {
    setAddressUiMode('ready');
  } else if (hasSaved) {
    setAddressUiMode('ready');
  } else {
    setAddressUiMode('form');
  }

  fillForm(getState().shipping);
  render();
  window.__ckStep = 'shipping';

  if (addressUiMode !== 'ready') {
    void startLocationService();
  }
  applyConfiguredDeliveryFee();
  void refreshBackendDeliveryQuote();
  render();
}
