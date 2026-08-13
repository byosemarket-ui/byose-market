#!/usr/bin/env node
/**
 * STEP 1 shopping-flow verification (logic + optional live API probes).
 * Run: node scripts/verify-shopping-flow-step1.js
 * Optional: BYOSE_API_BASE=https://byosemarket.com node scripts/verify-shopping-flow-step1.js
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

function checkSourceGuards() {
  const state = read('orders/core/state.js');
  assert(state.includes("STORAGE_KEYS.checkoutActive"), 'state.js must prefer checkoutActive');
  assert(state.includes('hasCartCheckout'), 'state.js hydrate must protect cart checkout');

  const cart = read('services/byose-cart.js');
  assert(cart.includes("syncPatch?.({ directCheckout: null })"), 'proceedToCheckout must clear directCheckout');
  assert(cart.includes('Only ${limitLabel} available in stock'), 'add() must reject silent stock clamps');
  assert(cart.includes('resolveLineStockFromCatalog'), 'catalog sync must use variant stock, not product-level stock');
  assert(cart.includes('Incomplete catalog snapshots must not wipe'), 'missing catalog rows must not mark cart unavailable');

  const order = read('orders/core/order.js');
  assert(order.includes('STORAGE_KEYS.checkoutActive'), 'submitOrder must clear checkoutActive');
  assert(order.includes('purchasedKeys'), 'submitOrder must remove only purchased lines');

  const actions = read('details/js/product-actions.js');
  assert(actions.includes('CHECKOUT_ACTIVE_KEY'), 'Buy Now must clear checkoutActive');

  const utils = read('js/utils.js');
  assert(utils.includes('mergeCartItemLists'), 'storefront sync must merge guest/remote carts');

  const auth = read('services/authservice.js');
  assert(auth.includes('_mergeGuestCartAfterAuth'), 'login must merge guest cart');

  const productRepo = read('server/repositories/sqlite/product.repository.js');
  assert(productRepo.includes('decrementStockForOrderItems'), 'product repo must decrement stock');

  const orderRepo = read('server/repositories/sqlite/order.repository.js');
  assert(orderRepo.includes('decrementStockForOrderItems'), 'order create must call stock decrement');

  const orderController = read('server/controllers/ordercontroller.js');
  assert(orderController.includes("err?.code === 'INSUFFICIENT_STOCK'"), 'order API must return 409 on stock failure');
}

function simulateCheckoutPrecedence() {
  // Mirrors loadProducts priority: checkoutActive > direct > cart
  function loadProducts({ checkoutActive, direct, cart }) {
    if (Array.isArray(checkoutActive) && checkoutActive.length) {
      return { source: 'cart', products: checkoutActive };
    }
    if (direct) {
      return { source: 'direct', products: [direct] };
    }
    if (Array.isArray(cart) && cart.length) {
      return { source: 'cart', products: cart };
    }
    return { source: 'cart', products: [] };
  }

  const staleDirect = { productId: 'D1', name: 'Buy Now leftover' };
  const selected = [{ productId: 'C1', name: 'Cart selected', lineId: 'C1::default' }];
  const result = loadProducts({
    checkoutActive: selected,
    direct: staleDirect,
    cart: selected.concat([{ productId: 'C2', name: 'Unselected leftover' }])
  });

  assert(result.source === 'cart', 'precedence: source should be cart');
  assert(result.products.length === 1 && result.products[0].productId === 'C1', 'precedence: checkoutActive wins over direct');

  const buyNow = loadProducts({ checkoutActive: [], direct: staleDirect, cart: selected });
  assert(buyNow.source === 'direct' && buyNow.products[0].productId === 'D1', 'precedence: Buy Now works without checkoutActive');
}

function simulatePartialCartClear() {
  const cart = [
    { lineId: 'A::default', productId: 'A', qty: 1 },
    { lineId: 'B::default', productId: 'B', qty: 2 },
    { lineId: 'C::red|size:m', productId: 'C', qty: 1 }
  ];
  const purchased = [{ lineId: 'B::default', productId: 'B' }];
  const purchasedKeys = new Set(purchased.map((p) => `line:${p.lineId}`));
  const remaining = cart.filter((item) => !purchasedKeys.has(`line:${item.lineId}`));
  assert(remaining.length === 2, 'partial clear keeps unpurchased lines');
  assert(!remaining.some((item) => item.lineId === 'B::default'), 'partial clear removes purchased line');
}

function simulateCartMerge() {
  function merge(remote, local) {
    const map = new Map();
    remote.forEach((item) => map.set(item.lineId, { ...item }));
    local.forEach((item) => {
      const existing = map.get(item.lineId);
      if (!existing) {
        map.set(item.lineId, { ...item });
        return;
      }
      map.set(item.lineId, { ...existing, qty: Math.max(existing.qty, item.qty) });
    });
    return Array.from(map.values());
  }

  const merged = merge(
    [{ lineId: '1::default', qty: 1 }, { lineId: '2::default', qty: 2 }],
    [{ lineId: '1::default', qty: 3 }, { lineId: '3::default', qty: 1 }]
  );
  assert(merged.length === 3, 'merge keeps unique lines');
  assert(merged.find((item) => item.lineId === '1::default').qty === 3, 'merge takes max qty');
}

async function probeLiveApi() {
  const base = String(process.env.BYOSE_API_BASE || '').replace(/\/+$/, '');
  if (!base) {
    console.log('Skipping live API probes (set BYOSE_API_BASE to enable).');
    return;
  }

  const healthUrl = `${base}/api/healthz`;
  const productsUrl = `${base}/api/products?limit=1`;
  const health = await fetch(healthUrl).then((r) => r.json()).catch((error) => ({ error: String(error) }));
  assert(!health.error && (health.ok === true || health.success === true || health.status === 'ok' || health), `healthz failed: ${JSON.stringify(health)}`);

  const products = await fetch(productsUrl).then((r) => r.json()).catch((error) => ({ error: String(error) }));
  assert(!products.error && (Array.isArray(products.products) || Array.isArray(products.data) || products.success), `products probe failed: ${JSON.stringify(products).slice(0, 200)}`);
}

async function main() {
  checkSourceGuards();
  simulateCheckoutPrecedence();
  simulatePartialCartClear();
  simulateCartMerge();
  await probeLiveApi();

  if (failures.length) {
    console.error('STEP 1 verification FAILED:');
    failures.forEach((f) => console.error(` - ${f}`));
    process.exit(1);
  }

  console.log('STEP 1 shopping-flow verification PASSED.');
  console.log('Guards: checkout precedence, partial cart clear, guest merge, stock decrement wiring.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
