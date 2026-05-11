import { escapeHtml, formatCurrency, normalizePhone } from './utils.js';
import { renderStageProgress, renderSummaryProducts } from './checkout-ui.js';
import {
  getResolvedCustomerName,
  getStageUrl,
  getState,
  initializeOrderFlow,
  resolveStageAccess,
  setStage,
  updateShippingDetails,
  validateShippingStage
} from './state.js';

const fields = ['fullName', 'phone', 'provinceCity', 'district', 'sector', 'cell', 'village', 'note'];

const ui = {
  progress: document.getElementById('checkoutProgress'),
  sidebar: document.getElementById('checkoutSidebar'),
  form: document.getElementById('shippingForm'),
  message: document.getElementById('shippingMessage'),
  locationStatus: document.getElementById('locationStatus'),
  locationMeta: document.getElementById('locationMeta'),
  locationMapLink: document.getElementById('locationMapLink')
};

function renderSidebar(state) {
  const itemCount = state.products.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  ui.sidebar.innerHTML = `
    <section class="orders-sidebar-card orders-sidebar-card--sticky">
      <span class="orders-sidebar-label">Order summary</span>
      <div class="orders-sidebar-heading">
        <h3>${itemCount} item${itemCount === 1 ? '' : 's'}</h3>
        <span>${escapeHtml(getResolvedCustomerName())}</span>
      </div>
      <div class="orders-summary-product-list orders-summary-product-list--compact">
        ${renderSummaryProducts(state.products)}
      </div>
      <div class="orders-total-row"><span>Subtotal</span><strong>${formatCurrency(state.totals.subtotal)}</strong></div>
      <div class="orders-total-row"><span>Shipping</span><strong>${formatCurrency(state.totals.shippingFee)}</strong></div>
      <div class="orders-total-row is-total"><span>Total</span><strong>${formatCurrency(state.totals.total)}</strong></div>
    </section>
  `;
}

function buildMapLink(latitude, longitude) {
  if (!latitude || !longitude) {
    return '';
  }

  return `https://maps.google.com/?q=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

function renderLocationState(state, statusText) {
  const shippingAddress = state.shippingAddress || {};
  const badges = [];
  const coordinateText = shippingAddress.latitude && shippingAddress.longitude
    ? `${shippingAddress.latitude}, ${shippingAddress.longitude}`
    : '';
  const mapLink = shippingAddress.mapLink || buildMapLink(shippingAddress.latitude, shippingAddress.longitude);

  if (coordinateText) {
    badges.push(`<span class="orders-location-badge">Coordinates: ${escapeHtml(coordinateText)}</span>`);
  }

  if (shippingAddress.locationAccuracy) {
    badges.push(`<span class="orders-location-badge">Accuracy ${escapeHtml(shippingAddress.locationAccuracy)}m</span>`);
  }

  ui.locationStatus.textContent = statusText || (coordinateText
    ? 'Location captured'
    : 'Requesting device location permission...');
  ui.locationMeta.innerHTML = badges.join('');

  if (mapLink) {
    ui.locationMapLink.hidden = false;
    ui.locationMapLink.href = mapLink;
  } else {
    ui.locationMapLink.hidden = true;
    ui.locationMapLink.removeAttribute('href');
  }
}

function setMessage(message) {
  ui.message.hidden = !message;
  ui.message.textContent = message || '';
}

function setFieldError(name, message) {
  const field = ui.form.querySelector(`[name="${name}"]`);
  const wrapper = field?.closest('.orders-field');
  const errorNode = ui.form.querySelector(`[data-error-for="${name}"]`);

  wrapper?.classList.toggle('has-error', Boolean(message));
  if (errorNode) {
    errorNode.textContent = message || '';
  }
}

function clearAllErrors() {
  fields.forEach((name) => setFieldError(name, ''));
}

function syncForm(state) {
  fields.forEach((name) => {
    const field = ui.form.querySelector(`[name="${name}"]`);
    if (field) {
      field.value = state.shippingAddress[name] || '';
    }
  });

  renderLocationState(state);
}

function applyValidation(validation) {
  clearAllErrors();
  Object.entries(validation.errors || {}).forEach(([name, message]) => {
    setFieldError(name, message);
  });
  setMessage(validation.valid ? '' : (validation.message || 'Please complete the required shipping fields.'));
}

async function reverseGeocode(latitude, longitude) {
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`);
  if (!response.ok) {
    throw new Error('Reverse geocoding failed.');
  }

  const payload = await response.json();
  const address = payload?.address || {};

  return {
    provinceCity: String(address.city || address.town || address.municipality || address.state || address.region || '').trim(),
    district: String(address.county || address.state_district || address.city_district || '').trim(),
    sector: String(address.suburb || address.borough || address.neighbourhood || '').trim(),
    cell: String(address.quarter || address.city_block || address.residential || '').trim(),
    village: String(address.hamlet || address.village || address.locality || '').trim(),
    street: String(address.road || address.pedestrian || address.footway || '').trim()
  };
}

function applyAutoDetectedAddress(detectedAddress) {
  const currentAddress = getState().shippingAddress || {};
  const patch = {};

  ['provinceCity', 'district', 'sector', 'cell', 'village', 'street'].forEach((field) => {
    if (!currentAddress[field] && detectedAddress[field]) {
      patch[field] = detectedAddress[field];
    }
  });

  if (Object.keys(patch).length) {
    updateShippingDetails(patch);
    syncForm(getState());
  }
}

function captureLocation() {
  if (!navigator.geolocation) {
    renderLocationState(getState(), 'Location unavailable on this device');
    return;
  }

  renderLocationState(getState(), 'Waiting for permission and GPS signal...');

  navigator.geolocation.getCurrentPosition(async (position) => {
    const latitude = Number(position.coords.latitude).toFixed(6);
    const longitude = Number(position.coords.longitude).toFixed(6);
    const locationAccuracy = Math.round(Number(position.coords.accuracy || 0));

    updateShippingDetails({
      latitude,
      longitude,
      mapLink: buildMapLink(latitude, longitude),
      locationAccuracy: locationAccuracy ? String(locationAccuracy) : '',
      locationCapturedAt: new Date().toISOString()
    });

    try {
      const detectedAddress = await reverseGeocode(latitude, longitude);
      applyAutoDetectedAddress(detectedAddress);
      renderSidebar(getState());
      renderLocationState(getState(), 'Location captured');
    } catch (error) {
      console.error(error);
      renderSidebar(getState());
      renderLocationState(getState(), 'Location captured');
    }
  }, (error) => {
    console.error(error);
    renderLocationState(getState(), error?.code === 1
      ? 'Location permission denied'
      : 'Unable to capture location right now');
  }, {
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 0
  });
}

function bindForm() {
  fields.forEach((name) => {
    const field = ui.form.querySelector(`[name="${name}"]`);
    field?.addEventListener('input', (event) => {
      const value = event.currentTarget.value;
      updateShippingDetails({ [name]: value });

      if (name === 'phone') {
        const validation = validateShippingStage();
        setFieldError('phone', validation.errors?.phone || '');
      } else if (String(value || '').trim()) {
        setFieldError(name, '');
      }

      setMessage('');
      renderSidebar(getState());
    });

    field?.addEventListener('blur', (event) => {
      updateShippingDetails({ [name]: event.currentTarget.value });
      const validation = validateShippingStage();
      setFieldError(name, validation.errors?.[name] || '');
    });
  });

  ui.form.addEventListener('submit', (event) => {
    event.preventDefault();

    const formData = new FormData(ui.form);
    updateShippingDetails(Object.fromEntries(formData.entries()));

    const validation = validateShippingStage();
    applyValidation(validation);
    if (!validation.valid) {
      return;
    }

    const state = getState();
    updateShippingDetails({
      phone: normalizePhone(state.shippingAddress.phone) || state.shippingAddress.phone
    });
    setStage('checkout');
    window.location.assign(getStageUrl('checkout'));
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await initializeOrderFlow('shipping');
  const access = resolveStageAccess('shipping');
  if (!access.valid) {
    window.location.assign(access.redirectUrl);
    return;
  }

  const state = getState();
  renderStageProgress(ui.progress, 'shipping');
  renderSidebar(state);
  syncForm(state);
  bindForm();
  setMessage('');
  captureLocation();
});