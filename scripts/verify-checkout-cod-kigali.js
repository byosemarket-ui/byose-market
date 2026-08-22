#!/usr/bin/env node
/**
 * Cash on Delivery Kigali eligibility + Review & Pay button copy checks.
 *
 * Run: node scripts/verify-checkout-cod-kigali.js
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..');
const failures = [];

function fail(message) {
  failures.push(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

async function main() {
  const location = await import(pathToFileURL(path.join(root, 'orders/core/location.js')).href);
  const { isKigaliDeliveryLocation, COD_PAYMENT_HINT_RW, COD_RESTRICTION_RW } = location;

  const kigaliCases = [
    'Kigali',
    'kigali',
    'KIGALI',
    'Kigali City',
    'City of Kigali',
    'city kigali',
    'kigalicity',
    'KIgali',
    'kigaliofcity'
  ];
  kigaliCases.forEach((value) => {
    check(isKigaliDeliveryLocation({ provinceCity: value }), `expected Kigali match for "${value}"`);
  });

  const outsideCases = [
    { provinceCity: 'Northern Province' },
    { provinceCity: 'Eastern Province' },
    { provinceCity: 'Southern Province' },
    { provinceCity: 'Western Province' },
    { provinceCity: 'Musanze' },
    { provinceCity: 'Rubavu' }
  ];
  outsideCases.forEach((address) => {
    check(!isKigaliDeliveryLocation(address), `expected non-Kigali for "${address.provinceCity}"`);
  });

  const checkoutHtml = read('orders/checkout.html');
  const checkoutJs = read('orders/checkout.js');
  const layoutJs = read('orders/ui/layout.js');
  const css = read('orders/checkout.css');

  check(checkoutHtml.includes('Cash on Delivery'), 'COD English label remains');
  check(checkoutHtml.includes(COD_PAYMENT_HINT_RW), 'COD Kinyarwanda hint is present');
  check(checkoutHtml.includes(COD_RESTRICTION_RW), 'COD restriction copy is present');
  check(checkoutHtml.includes('Online Payment'), 'Online Payment label remains unchanged');
  check(checkoutJs.includes('COD_RESTRICTION_RW'), 'checkout uses shared COD restriction copy');
  check(checkoutJs.includes('setCodButtonLabel'), 'busy state preserves COD hint markup');
  check(layoutJs.includes("kind: 'cod'") || layoutJs.includes("kind === 'cod'"), 'sticky COD button uses shared markup');
  check(css.includes('.ck-btn--stacked'), 'stacked COD button styling exists');
  check(css.includes('flex-direction: row'), 'payment buttons stay on one row');

  if (failures.length) {
    console.error('[verify-checkout-cod-kigali] FAIL:');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('[verify-checkout-cod-kigali] PASS');
  console.log(` Kigali variations recognized (${kigaliCases.length} cases)`);
  console.log(` Outside-Kigali addresses rejected (${outsideCases.length} cases)`);
  console.log(' COD hint + restriction copy present; Online Payment unchanged');
}

main().catch((error) => {
  console.error('[verify-checkout-cod-kigali] ERROR:', error);
  process.exit(1);
});
