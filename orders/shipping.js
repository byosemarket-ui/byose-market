import { initCheckout, commitShipping, getState, guardStep, subscribe, updateShipping } from './core/state.js';
import { renderProgress, renderSidebar, renderStickyBar, showMessage } from './ui/layout.js';
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
const gpsStatus = document.getElementById('gpsStatus');
const gpsMeta = document.getElementById('gpsMeta');
const gpsMapLink = document.getElementById('gpsMapLink');

function render() {
  const state = getState();
  progressEl.innerHTML = renderProgress('shipping');
  sidebarEl.innerHTML = renderSidebar(state.products, state.totals);
  stickyEl.innerHTML = renderStickyBar('Continue', 'shippingContinueBtn');
  document.getElementById('stickyContinueBtn')?.addEventListener('click', handleContinue);
}

function fillForm(shipping) {
  if (!form) return;
  Object.entries(shipping).forEach(([key, value]) => {
    const input = form.elements.namedItem(key);
    if (!input || !('value' in input)) return;
    if (key === 'phone') {
      input.value = formatPhoneLocal(value);
      return;
    }
    input.value = String(value || '');
  });
}

function readForm() {
  const data = {};
  if (!form) return data;
  new FormData(form).forEach((value, key) => { data[key] = String(value).trim(); });
  return data;
}

function showErrors(errors = {}) {
  if (!form) return;
  form.querySelectorAll('[data-error]').forEach((el) => {
    const field = el.dataset.error;
    el.textContent = errors[field] || '';
    const input = form.elements.namedItem(field);
    if (input && 'classList' in input) {
      input.classList.toggle('is-invalid', Boolean(errors[field]));
    }
  });
}

function handleContinue() {
  showMessage(messageEl, '');
  const result = commitShipping(readForm());
  if (!result.valid) {
    showErrors(result.errors || {});
    showMessage(messageEl, 'Please fix the highlighted fields.');
    return;
  }
  window.location.assign('checkout.html');
}

function captureGps() {
  if (!navigator.geolocation) {
    gpsStatus.textContent = 'GPS not available on this device.';
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      const mapLink = `https://www.google.com/maps?q=${lat},${lng}`;
      updateShipping({
        latitude: lat,
        longitude: lng,
        mapLink,
        locationAccuracy: String(Math.round(pos.coords.accuracy || 0)),
        locationCapturedAt: new Date().toISOString()
      });
      gpsStatus.textContent = 'Location captured.';
      gpsMeta.textContent = `${lat}, ${lng}`;
      gpsMapLink.href = mapLink;
      gpsMapLink.hidden = false;

      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await res.json();
        const addr = data?.address || {};
        const patch = {};
        if (form && !form.provinceCity?.value && (addr.city || addr.state)) patch.provinceCity = addr.city || addr.state;
        if (form && !form.district?.value && addr.county) patch.district = addr.county;
        if (form && !form.sector?.value && addr.suburb) patch.sector = addr.suburb;
        if (Object.keys(patch).length) {
          updateShipping(patch);
          fillForm(getState().shipping);
        }
      } catch (_) { /* optional */ }
    },
    () => { gpsStatus.textContent = 'Location permission denied. You can still continue.'; },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}

form?.addEventListener('input', () => updateShipping(readForm()));
form?.addEventListener('submit', (e) => { e.preventDefault(); handleContinue(); });
continueBtn?.addEventListener('click', handleContinue);

subscribe(() => render());

await initCheckout('shipping');
const access = guardStep('shipping');
if (!access.ok) {
  window.location.href = access.redirect;
} else {
  fillForm(getState().shipping);
  render();
  captureGps();
  window.__ckStep = 'shipping';
}
