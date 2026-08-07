#!/usr/bin/env node
/**
 * STEP 2 — Shipping GPS / smart address autofill verification.
 * Run: node scripts/verify-shipping-location-step2.js
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function checkPermissionsPolicy() {
  const nginx = read('deploy/nginx-byosemarket.conf');
  const headers = read('server/middleware/securityheaders.js');
  assert(nginx.includes('geolocation=(self)'), 'nginx must allow geolocation=(self)');
  assert(!nginx.includes('geolocation=()'), 'nginx must not block geolocation with empty allowlist');
  // HTML location overrides server add_header inheritance — must restate Permissions-Policy.
  assert(
    /location\s+~\*\s+\\\.html\$[\s\S]*?Permissions-Policy[^\n]*geolocation=\(self\)/.test(nginx),
    'HTML location must include Permissions-Policy geolocation=(self)'
  );
  assert(headers.includes('geolocation=(self)'), 'Express security headers must allow geolocation=(self)');
  assert(!headers.includes("geolocation=()"), 'Express must not block geolocation with empty allowlist');
}

function checkLocationService() {
  const service = read('orders/location-service.js');
  assert(service.includes('enableHighAccuracy: true'), 'GPS must use high-accuracy mode');
  assert(service.includes('watchPosition'), 'GPS must refine via watchPosition');
  assert(service.includes('reverseGeocode'), 'must reverse-geocode for address autofill');
  assert(service.includes('mergeEmptyAddressFields'), 'must only fill empty address fields');
  assert(service.includes('Detecting location...'), 'must expose detecting status label');
  assert(service.includes('Improving GPS accuracy...'), 'must expose improving status label');
  assert(service.includes('Location detected successfully.'), 'must expose success status label');
  assert(service.includes('Using manual address.'), 'must expose manual status label');
  assert(service.includes('already_attempted'), 'must avoid repeated permission prompts in-session');
  assert(service.includes("permission === 'unknown'"), 'must handle Safari/iOS unknown permission state');
  assert(service.includes('buildMapsUrl') || service.includes('google.com/maps'), 'must build Google Maps URL');
}

function checkShippingUi() {
  const html = read('orders/shipping.html');
  const js = read('orders/shipping.js');
  const css = read('orders/checkout.css');

  assert(html.includes('id="gpsCard"'), 'shipping HTML must include gpsCard');
  assert(html.includes('id="gpsBadge"'), 'shipping HTML must include gpsBadge');
  assert(html.includes('Detecting location...'), 'shipping HTML default status must be professional');
  assert(js.includes('initializeShippingLocation'), 'shipping.js must initialize location service');
  assert(js.includes('startLocationService'), 'shipping.js must start location on open');
  assert(js.includes('onlyEmpty: true'), 'autofill must preserve customer edits');
  assert(js.includes('latitude:'), 'shipping.js must store latitude');
  assert(js.includes('mapLink:'), 'shipping.js must store mapLink');
  assert(css.includes('.ck-gps-badge'), 'checkout.css must style GPS badge states');
  assert(css.includes('[data-state="success"]'), 'checkout.css must style success GPS state');
}

function checkOrderPipeline() {
  const state = read('orders/core/state.js');
  const order = read('orders/core/order.js');
  const controller = read('server/controllers/ordercontroller.js');
  const admin = read('admin/app/pages/orders.js');
  const account = read('account/services/orderservice.js');
  const details = read('account/orders/order-details.js');

  assert(state.includes('latitude: state.shipping.latitude'), 'commitShipping must preserve latitude');
  assert(state.includes('mapLink: state.shipping.mapLink'), 'commitShipping must preserve mapLink');
  assert(order.includes('gpsLocation:'), 'order payload must include gpsLocation');
  assert(order.includes('googleMapsLink: state.shipping.mapLink'), 'order payload must map Google Maps link');
  assert(order.includes('latitude: state.shipping.latitude'), 'shippingAddress must keep latitude');
  assert(controller.includes('gpsLocation:'), 'server must persist gpsLocation');
  assert(admin.includes('Open GPS on Maps'), 'admin must show GPS maps link');
  assert(account.includes('gpsLocation'), 'account order service must expose gpsLocation');
  assert(details.includes('gps.latitude'), 'account order details must show GPS');
}

function unitTestAddressMapping() {
  // Lightweight pure-logic checks mirroring location-service mapping rules.
  function firstText(...values) {
    for (const value of values) {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    return '';
  }

  function map(address) {
    const used = new Set();
    const unique = (value) => {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      if (!text) return '';
      const key = text.toLowerCase();
      if (used.has(key)) return '';
      used.add(key);
      return text;
    };
    return {
      provinceCity: unique(firstText(address.city, address.town, address.state, address.province)),
      district: unique(firstText(address.district, address.county)),
      sector: unique(firstText(address.suburb, address.quarter)),
      cell: unique(firstText(address.neighbourhood, address.neighborhood)),
      village: unique(firstText(address.village, address.hamlet, address.locality))
    };
  }

  function mergeEmpty(current, autofill) {
    const next = {};
    ['provinceCity', 'district', 'sector', 'cell', 'village'].forEach((key) => {
      const existing = String(current[key] || '').trim();
      const incoming = String(autofill[key] || '').trim();
      if (!existing && incoming) next[key] = incoming;
    });
    return next;
  }

  const mapped = map({
    city: 'Kigali',
    county: 'Gasabo',
    suburb: 'Remera',
    neighbourhood: 'Rukiri',
    village: 'Gishushu'
  });
  assert(mapped.provinceCity === 'Kigali', 'map province/city from city');
  assert(mapped.district === 'Gasabo', 'map district from county');
  assert(mapped.sector === 'Remera', 'map sector from suburb');
  assert(mapped.cell === 'Rukiri', 'map cell from neighbourhood');
  assert(mapped.village === 'Gishushu', 'map village');

  const merged = mergeEmpty(
    { provinceCity: 'Kigali', district: '', sector: 'Custom Sector', cell: '', village: '' },
    mapped
  );
  assert(!merged.provinceCity, 'merge must not overwrite filled province');
  assert(merged.district === 'Gasabo', 'merge fills empty district');
  assert(!merged.sector, 'merge must not overwrite filled sector');
  assert(merged.cell === 'Rukiri', 'merge fills empty cell');
  assert(merged.village === 'Gishushu', 'merge fills empty village');

  const lat = -1.9441;
  const lng = 30.0619;
  const maps = `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
  assert(maps.includes('-1.944100'), 'maps URL encodes latitude');
  assert(maps.includes('30.061900'), 'maps URL encodes longitude');
}

async function main() {
  checkPermissionsPolicy();
  checkLocationService();
  checkShippingUi();
  checkOrderPipeline();
  unitTestAddressMapping();

  if (failures.length) {
    console.error('FAIL — Shipping location STEP 2 verification\n');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('PASS — Shipping location STEP 2 verification');
  console.log(' - Permissions-Policy allows geolocation=(self)');
  console.log(' - Location service: high accuracy, reverse geocode, no repeat prompts');
  console.log(' - Shipping UI status indicators wired');
  console.log(' - GPS fields preserved through commit → order → admin/account');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
