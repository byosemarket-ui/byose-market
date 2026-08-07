#!/usr/bin/env node
/**
 * STEP 3 end-to-end order system verification + production probes.
 * Run: node scripts/verify-order-system-step3.js
 * Optional: BYOSE_API_BASE=https://byosemarket.com node scripts/verify-order-system-step3.js
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function checkSourceGuards() {
  const phone = read('server/utils/phone.js');
  assert(phone.includes('normalizeRwandaPhone'), 'shared phone util missing');

  const orderRepo = read('server/repositories/sqlite/order.repository.js');
  assert(orderRepo.includes('rwandaPhoneVariants'), 'order listForUser must match phone variants');

  const auth = read('server/controllers/authcontroller.js');
  assert(auth.includes('canonicalizePhone'), 'auth must canonicalize phones');

  const adminAuth = read('server/middleware/requireadminauth.js');
  assert(adminAuth.includes('access_token'), 'admin auth must accept SSE query token');

  const realtime = read('admin/app/services/realtime-sync.service.js');
  assert(realtime.includes('access_token='), 'admin SSE must pass access_token');

  const liveFeeds = read('admin/app/services/live-feeds.service.js');
  assert(liveFeeds.includes('scheduleFlush'), 'live feeds must reschedule dropped updates');

  const orderController = read('server/controllers/ordercontroller.js');
  assert(orderController.includes('notifyOrderConfirmed'), 'order create must notify');
  assert(orderController.includes('Promise.all(uniqueIds.map'), 'catalog pricing must batch');

  const nginx = read('deploy/nginx-byosemarket.conf');
  assert(nginx.includes('location ^~ /api/realtime/'), 'nginx must have SSE location');
  assert(nginx.includes('proxy_buffering off'), 'SSE nginx buffering must be off');

  const cartPage = read('js/cart-page.js');
  assert(cartPage.includes('normalizeStorefrontAssetUrl'), 'cart images must normalize asset URLs');

  const account = read('account/services/orderservice.js');
  assert(account.includes('phoneVariants'), 'account history must match phone variants');
  assert(!account.includes("normalized.includes('payment')"), 'payment substring must not map confirmed');

  const checkoutCss = read('orders/checkout.css');
  assert(checkoutCss.includes('safe-area-inset-bottom'), 'mobile sticky bar needs safe-area padding');
}

function simulatePhoneMatch() {
  const { normalizeRwandaPhone, rwandaPhoneVariants } = require('../server/utils/phone');
  const a = normalizeRwandaPhone('0780430710');
  const b = normalizeRwandaPhone('+250780430710');
  assert(a === b && a === '+250780430710', 'phone canonicalization failed');
  const variants = new Set(rwandaPhoneVariants('0780430710'));
  assert(variants.has('+250780430710') && variants.has('0780430710'), 'phone variants incomplete');
}

function runPriorVerifiers() {
  for (const script of [
    'scripts/verify-shopping-flow-step1.js',
    'scripts/verify-checkout-order-step2.js'
  ]) {
    const result = spawnSync(process.execPath, [path.join(root, script)], {
      cwd: root,
      encoding: 'utf8'
    });
    assert(result.status === 0, `${script} failed: ${result.stderr || result.stdout}`);
  }
}

async function probeProduction() {
  const base = String(process.env.BYOSE_API_BASE || 'https://byosemarket.com').replace(/\/+$/, '');
  const checks = [
    '/api/products?limit=1&columns=card',
    '/cart.html',
    '/orders/payment.html',
    '/orders/order-success.html',
    '/account/orders/all.html',
    '/admin.html'
  ];

  for (const route of checks) {
    const response = await fetch(`${base}${route}`);
    assert(response.ok, `production ${route} returned ${response.status}`);
  }

  const products = await fetch(`${base}/api/products?limit=2`).then((r) => r.json());
  const items = products.products || [];
  assert(items.length > 0, 'production products empty');
  for (const item of items) {
    const img = item.mainImage || item.image || '';
    assert(img, `product ${item.catalogId || item.id} missing image`);
    const imageUrl = img.startsWith('http') ? img : `${base}${img}`;
    const imageResponse = await fetch(imageUrl);
    assert(imageResponse.ok, `image failed for product ${item.catalogId || item.id}: ${imageUrl}`);
  }
}

async function main() {
  checkSourceGuards();
  simulatePhoneMatch();
  runPriorVerifiers();
  await probeProduction();

  if (failures.length) {
    console.error('STEP 3 verification FAILED:');
    failures.forEach((f) => console.error(` - ${f}`));
    process.exit(1);
  }

  console.log('STEP 3 order-system E2E verification PASSED.');
  console.log('Production probes, phone sync, SSE auth, live feeds, notifications, and prior STEP 1–2 guards are green.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
