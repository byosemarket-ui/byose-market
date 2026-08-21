import { initCheckout, continueToReview, getState, guardStep, hydrateSavedAddresses, refreshBackendDeliveryQuote, selectSavedAddress, setDeliveryQuote, subscribe, updateShipping } from './core/state.js';
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
const savedAddressPanel = document.getElementById('savedAddressPanel');
const savedAddressList = document.getElementById('savedAddressList');
const useNewAddressBtn = document.getElementById('useNewAddressBtn');
const addressModeHint = document.getElementById('addressModeHint');
const addressBookOptions = document.getElementById('addressBookOptions');
const saveToAccountInput = document.getElementById('saveToAccount');
const updateSavedInput = document.getElementById('updateSavedAddress');
const saveAsDefaultInput = document.getElementById('saveAsDefault');
const saveToAccountLabel = document.getElementById('saveToAccountLabel');
const updateSavedLabel = document.getElementById('updateSavedLabel');
const saveAsDefaultLabel = document.getElementById('saveAsDefaultLabel');
let continueInFlight = false;
/** @type {'select'|'new'|'edit'} */
let addressUiMode = 'select';

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

function syncAddressBookOptions() {
  const signedIn = isSignedIn();
  if (!addressBookOptions) return;

  if (!signedIn) {
    addressBookOptions.hidden = true;
    if (addressModeHint) addressModeHint.hidden = true;
    return;
  }

  const showSaveNew = addressUiMode === 'new';
  const showUpdate = addressUiMode === 'edit';
  const showDefault = showSaveNew || showUpdate;

  if (saveToAccountLabel) saveToAccountLabel.hidden = !showSaveNew;
  if (updateSavedLabel) updateSavedLabel.hidden = !showUpdate;
  if (saveAsDefaultLabel) saveAsDefaultLabel.hidden = !showDefault;
  addressBookOptions.hidden = !(showSaveNew || showUpdate);

  if (addressModeHint) {
    if (addressUiMode === 'new') {
      addressModeHint.hidden = false;
      addressModeHint.textContent = 'Enter a delivery address for this order. Optionally save it to your account.';
    } else if (addressUiMode === 'edit') {
      addressModeHint.hidden = false;
      addressModeHint.textContent = 'Editing for this order. Check “Also update my saved address” only if you want to change the saved copy.';
    } else {
      const selectedId = String(getState().shipping?.savedAddressId || '').trim();
      if (selectedId) {
        addressModeHint.hidden = false;
        addressModeHint.textContent = 'Using your selected saved address. You can continue without retyping.';
      } else {
        addressModeHint.hidden = true;
        addressModeHint.textContent = '';
      }
    }
  }
}

function setAddressUiMode(mode) {
  addressUiMode = mode === 'new' || mode === 'edit' ? mode : 'select';
  if (addressUiMode !== 'new' && saveToAccountInput) saveToAccountInput.checked = false;
  if (addressUiMode !== 'edit' && updateSavedInput) updateSavedInput.checked = false;
  if (addressUiMode === 'select' && saveAsDefaultInput) saveAsDefaultInput.checked = false;
  syncAddressBookOptions();
}

function renderSavedAddresses() {
  const state = getState();
  const addresses = Array.isArray(state.savedAddresses) ? state.savedAddresses : [];
  if (!savedAddressPanel || !savedAddressList) return;

  if (!addresses.length) {
    savedAddressPanel.hidden = true;
    savedAddressList.replaceChildren();
    if (isSignedIn() && addressUiMode === 'select') {
      setAddressUiMode('new');
    }
    syncAddressBookOptions();
    return;
  }

  savedAddressPanel.hidden = false;
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
    selectBtn.textContent = address.id === selectedId ? 'Selected' : 'Select Address';
    selectBtn.disabled = address.id === selectedId;
    selectBtn.addEventListener('click', () => {
      selectSavedAddress(address.id);
      setAddressUiMode('select');
      fillForm(getState().shipping);
      renderSavedAddresses();
      void refreshBackendDeliveryQuote();
    });

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'ck-btn ck-btn--ghost ck-btn--compact';
    editBtn.textContent = 'Edit Address';
    editBtn.addEventListener('click', () => {
      selectSavedAddress(address.id);
      setAddressUiMode('edit');
      fillForm(getState().shipping);
      renderSavedAddresses();
      form?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      form?.elements?.namedItem('fullName')?.focus?.();
    });

    actions.append(selectBtn, editBtn);

    if (!address.isDefault) {
      const defaultBtn = document.createElement('button');
      defaultBtn.type = 'button';
      defaultBtn.className = 'ck-btn ck-btn--ghost ck-btn--compact';
      defaultBtn.textContent = 'Set as Default';
      defaultBtn.addEventListener('click', async () => {
        try {
          defaultBtn.disabled = true;
          await window.ByoseCustomerAddresses.setDefault(address.id);
          await hydrateSavedAddresses();
          selectSavedAddress(address.id);
          setAddressUiMode('select');
          fillForm(getState().shipping);
          render();
          void refreshBackendDeliveryQuote();
        } catch (error) {
          showMessage(messageEl, error?.message || 'Unable to set the default address.');
        } finally {
          defaultBtn.disabled = false;
        }
      });
      actions.append(defaultBtn);
    }

    card.append(top, actions);
    savedAddressList.append(card);
  });

  syncAddressBookOptions();
}

function render() {
  const state = getState();
  progressEl.innerHTML = renderProgress('shipping');
  sidebarEl.innerHTML = renderSidebar(state.products, state.totals);
  stickyEl.innerHTML = renderStickyBar('Continue to Review', 'shippingContinueBtn');
  syncShippingBackLink();
  renderSavedAddresses();
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
 * Explicit address-book sync only when the customer opts in.
 * Selecting a saved address alone never writes the book.
 */
async function maybeSyncAddressBook(formData) {
  if (!isSignedIn() || !window.ByoseCustomerAddresses) {
    return formData;
  }

  const saveAsDefault = Boolean(saveAsDefaultInput?.checked);
  const shouldCreate = addressUiMode === 'new' && Boolean(saveToAccountInput?.checked);
  const shouldUpdate = addressUiMode === 'edit' && Boolean(updateSavedInput?.checked);
  if (!shouldCreate && !shouldUpdate) {
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
    isDefault: saveAsDefault
  };

  if (shouldUpdate) {
    const addressId = String(formData.savedAddressId || '').trim();
    if (!addressId) {
      throw new Error('Select a saved address before updating it.');
    }
    const updated = await window.ByoseCustomerAddresses.update(addressId, payload);
    if (saveAsDefault && updated?.id) {
      await window.ByoseCustomerAddresses.setDefault(updated.id);
    }
    await hydrateSavedAddresses();
    return { ...formData, savedAddressId: updated?.id || addressId };
  }

  const created = await window.ByoseCustomerAddresses.create(payload);
  if (saveAsDefault && created?.id && !created.isDefault) {
    await window.ByoseCustomerAddresses.setDefault(created.id);
  }
  await hydrateSavedAddresses();
  if (created?.id) {
    selectSavedAddress(created.id);
    setAddressUiMode('select');
  }
  return { ...formData, savedAddressId: String(created?.id || '').trim() };
}

/**
 * ONE authoritative Continue → Review handler.
 * Path: optional explicit address-book sync → validate → save commit → verify → navigate.
 * GPS / landmark / quote never blocks.
 */
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
    let formData = readForm();
    try {
      formData = await maybeSyncAddressBook(formData);
    } catch (syncError) {
      showMessage(messageEl, syncError?.message || 'Unable to save the shipping address.');
      return;
    }

    const result = continueToReview(formData);

    if (!result.ok) {
      console.error(result.code || 'VALIDATION_FAILED', result);
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

useNewAddressBtn?.addEventListener('click', () => {
  selectSavedAddress('');
  setAddressUiMode('new');
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
  // Typing while a saved address is selected means an order-only edit unless
  // the customer already chose Edit / Add New. Promote to edit mode quietly.
  if (
    addressUiMode === 'select'
    && isSignedIn()
    && String(getState().shipping?.savedAddressId || '').trim()
    && target?.name
    && target.name !== 'savedAddressId'
    && !['saveToAccount', 'updateSavedAddress', 'saveAsDefault'].includes(target.name)
  ) {
    setAddressUiMode('edit');
  }
  updateShipping(readForm());
  syncAddressBookOptions();
});

// ONE submit path only (primary button is type=submit).
form?.addEventListener('submit', (event) => {
  handleContinue(event);
});

// Sticky bar: delegate once — requestSubmit feeds the same submit handler.
stickyEl?.addEventListener('click', (event) => {
  const btn = event.target?.closest?.('#stickyContinueBtn');
  if (!btn) return;
  event.preventDefault();
  if (typeof form?.requestSubmit === 'function') {
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
  if (isSignedIn() && !(state.savedAddresses || []).length) {
    setAddressUiMode('new');
  } else if (String(state.shipping?.savedAddressId || '').trim()) {
    setAddressUiMode('select');
  } else if (isSignedIn()) {
    setAddressUiMode('new');
  } else {
    setAddressUiMode('select');
  }
  fillForm(getState().shipping);
  render();
  window.__ckStep = 'shipping';

  // GPS is optional and must never block Continue.
  void startLocationService();
  applyConfiguredDeliveryFee();
  void refreshBackendDeliveryQuote();
  render();
}
