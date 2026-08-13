/**
 * STEP 1 local matrix: Cart vs Buy Now vs abandoned checkout isolation.
 * Run:
 *   node scripts/seed-local-variant-product.mjs
 *   BYOSE_SITE_ORIGIN=http://127.0.0.1:5000 node scripts/e2e-cart-buynow-state.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const SITE = String(process.env.BYOSE_SITE_ORIGIN || 'http://127.0.0.1:5000')
  .replace(/\/+$/, '');
if (!/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(SITE)) {
  throw new Error(`STEP 1 state matrix must run against local origin, got ${SITE}`);
}
const PRODUCT_A = String(process.env.BYOSE_E2E_PRODUCT_A || '12012');
const PRODUCT_B = String(process.env.BYOSE_E2E_PRODUCT_B || '12013');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SHIPPING = {
  fullName: 'State Matrix Buyer',
  phone: '0781234567',
  provinceCity: 'Kigali City',
  district: 'Gasabo',
  sector: 'Kimironko',
  cell: 'Bibare',
  village: 'Test Village'
};

const VIEWPORTS = {
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
  tablet: { width: 768, height: 1024, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 800, isMobile: false, hasTouch: false }
};

const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`${name}: ${detail || 'failed'}`);
}

async function readStorage(page) {
  return page.evaluate(() => {
    const parse = (key) => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    };
    return {
      cart: parse('byose_market_cart_v1') || [],
      checkoutActive: parse('byose_checkout_active_v1') || [],
      directCheckout: parse('byose_direct_checkout'),
      draft: parse('byose_checkout_draft_v1'),
      intent: parse('byose_checkout_intent_v1'),
      confirmation: parse('byose_checkout_confirmation_v1'),
      step1: parse('byose_checkout_step1_commit_v1')
    };
  });
}

function cartHasProduct(cart, productId) {
  return (cart || []).some((item) => String(item.productId || item.id) === String(productId));
}

function checkoutProductIds(storage) {
  const direct = storage.directCheckout
    ? (Array.isArray(storage.directCheckout) ? storage.directCheckout : [storage.directCheckout])
    : [];
  const active = Array.isArray(storage.checkoutActive) ? storage.checkoutActive : [];
  const source = storage.intent?.source === 'direct' ? direct : (active.length ? active : direct);
  return source.map((item) => String(item.productId || item.id || '')).filter(Boolean);
}

async function selectVariantInModal(page, sizeLabel) {
  await page.waitForSelector('.product-config-modal.is-open, [data-config-submit-action]', { timeout: 30000 });
  const color = page.locator('.pcm-color-tile:not(.is-disabled)').first();
  if (await color.count()) await color.click({ force: true });
  const size = sizeLabel
    ? page.locator('.pcm-size-chip:not(.is-disabled)', { hasText: String(sizeLabel) }).first()
    : page.locator('.pcm-size-chip:not(.is-disabled)').first();
  if (await size.count()) await size.click({ force: true });
}

async function waitForPageFn(page, fn, timeout = 60000) {
  await page.waitForFunction(fn, undefined, { timeout });
}

async function openProduct(page, productId) {
  const errors = [];
  const onError = (err) => errors.push(String(err?.message || err));
  page.on('pageerror', onError);
  await page.goto(`${SITE}/details/product-details1.html?id=${encodeURIComponent(productId)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });
  try {
    await waitForPageFn(page, () => {
      const title = document.getElementById('productName')?.textContent || '';
      return Boolean(title.trim() && title.trim() !== 'Product Name');
    }, 90000);
  } catch (error) {
    const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 400);
    throw new Error(`product ${productId} did not render: ${error.message} pageErrors=${errors.join(' | ')} body=${bodyText}`);
  } finally {
    page.off('pageerror', onError);
  }
}

async function addToCart(page, productId, sizeLabel) {
  await openProduct(page, productId);
  const sticky = page.locator('#stickyAddToCartBtn');
  const primary = page.locator('#addToCartBtn');
  if (await sticky.isVisible().catch(() => false)) await sticky.click({ force: true });
  else await primary.click({ force: true });
  if (await page.locator('[data-config-submit-action]').count()) {
    await selectVariantInModal(page, sizeLabel);
    await page.locator('[data-config-submit-action="add"]').first().click({ force: true });
  }
  await page.waitForFunction((id) => {
    try {
      return (window.ByoseCart?.getItems?.() || []).some((item) => String(item.productId || item.id) === String(id));
    } catch {
      return false;
    }
  }, productId, { timeout: 15000 });
}

async function buyNow(page, productId, sizeLabel) {
  await openProduct(page, productId);
  const sticky = page.locator('#stickyBuyNowBtn');
  const primary = page.locator('#buyNowBtn');
  if (await sticky.isVisible().catch(() => false)) await sticky.click({ force: true });
  else await primary.click({ force: true });
  if (await page.locator('[data-config-submit-action]').count()) {
    await selectVariantInModal(page, sizeLabel);
    await page.locator('[data-config-submit-action="buy"]').first().click({ force: true });
  }
  await page.waitForURL(/orders\/shipping\.html/i, { timeout: 60000 });
  await waitForPageFn(page, () => window.__ckStep === 'shipping', 60000);
}

async function startCartCheckout(page) {
  await page.goto(`${SITE}/cart.html?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#checkoutBtn, #stickyCheckoutBtn', { timeout: 30000 });
  await page.locator('#checkoutBtn, #stickyCheckoutBtn').first().click({ force: true });
  await page.waitForURL(/orders\/shipping\.html/i, { timeout: 60000 });
  await waitForPageFn(page, () => window.__ckStep === 'shipping', 60000);
}

async function fillShipping(page) {
  for (const [name, value] of Object.entries(SHIPPING)) {
    await page.fill(`input[name="${name}"]`, value);
  }
}

async function continueToReview(page) {
  await fillShipping(page);
  await page.evaluate(() => {
    const form = document.getElementById('shippingForm');
    if (form?.requestSubmit) form.requestSubmit();
    else document.getElementById('shippingContinueBtn')?.click();
  });
  await page.waitForURL(/checkout\.html/, { timeout: 60000 });
  await waitForPageFn(page, () => window.__ckStep === 'review', 30000);
}

async function continueToPayment(page) {
  await page.evaluate(() => document.getElementById('reviewContinueBtn')?.click());
  await page.waitForURL(/payment\.html/, { timeout: 60000 });
  await waitForPageFn(page, () => window.__ckStep === 'payment', 30000);
}

async function placeOrderCapture(page) {
  let orderId = '';
  const onResponse = async (response) => {
    try {
      if (!/\/api\/orders\/?$/.test(new URL(response.url()).pathname) || response.request().method() !== 'POST') return;
      const body = await response.json();
      orderId = String(body?.order?.orderId || body?.order?.id || body?.orderId || '');
    } catch {
      /* ignore */
    }
  };
  page.on('response', onResponse);
  await page.evaluate(() => {
    const form = document.getElementById('paymentForm');
    if (form?.requestSubmit) form.requestSubmit();
    else document.getElementById('placeOrderBtn')?.click();
  });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !orderId) {
    const stored = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('byose_checkout_confirmation_v1') || 'null')?.orderId || '';
      } catch {
        return '';
      }
    }).catch(() => '');
    if (stored) {
      orderId = stored;
      break;
    }
    await page.waitForTimeout(500);
  }
  page.off('response', onResponse);
  return orderId;
}

async function newContext(browser, viewportName) {
  const viewport = VIEWPORTS[viewportName] || VIEWPORTS.mobile;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch
  });
  await context.addInitScript(() => {
    try {
      if (sessionStorage.getItem('byose_state_matrix_cleared')) return;
      sessionStorage.setItem('byose_state_matrix_cleared', '1');
      [
        'byose_checkout_draft_v1',
        'byose_checkout_confirmation_v1',
        'byose_market_cart_v1',
        'byose_checkout_active_v1',
        'byose_direct_checkout',
        'byose_checkout_intent_v1',
        'byose_checkout_step1_commit_v1',
        'byose_pending_order_submission_v1'
      ].forEach((key) => localStorage.removeItem(key));
      sessionStorage.removeItem('byose_checkout_handoff_v1');
      sessionStorage.removeItem('byose_checkout_step1_commit_v1');
    } catch { /* ignore */ }
  });
  const page = await context.newPage();
  return { context, page };
}

async function testA(browser, viewportName) {
  const { context, page } = await newContext(browser, viewportName);
  try {
    await addToCart(page, PRODUCT_A, '42');
    await startCartCheckout(page);
    await continueToReview(page);
    await page.goto(`${SITE}/shop.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await openProduct(page, PRODUCT_B);
    await page.goto(`${SITE}/cart.html?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const storage = await readStorage(page);
    if (!cartHasProduct(storage.cart, PRODUCT_A)) {
      record(`A cart-abandon [${viewportName}]`, false, 'Product A missing from cart');
    }
    record(`A cart-abandon [${viewportName}]`, true, `cart lines=${storage.cart.length}`);
  } finally {
    await context.close();
  }
}

async function testB(browser) {
  const { context, page } = await newContext(browser, 'mobile');
  try {
    await buyNow(page, PRODUCT_A, '42');
    await continueToReview(page);
    await page.goto(`${SITE}/cart.html?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const storage = await readStorage(page);
    if (cartHasProduct(storage.cart, PRODUCT_A)) {
      record('B buy-now-not-in-cart', false, 'Buy Now A appeared in cart');
    }
    record('B buy-now-not-in-cart', true, `cart lines=${storage.cart.length}`);
  } finally {
    await context.close();
  }
}

async function testC(browser, viewportName) {
  const { context, page } = await newContext(browser, viewportName);
  try {
    await buyNow(page, PRODUCT_A, '42');
    await continueToReview(page);
    await page.goto(`${SITE}/shop.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await buyNow(page, PRODUCT_B, '40');
    const storage = await readStorage(page);
    const ids = checkoutProductIds(storage);
    const sidebar = await page.locator('#sidebar').innerText().catch(() => '');
    if (ids.includes(PRODUCT_A) || /PRECIOUS/i.test(sidebar)) {
      record(`C buy-now-A-then-B [${viewportName}]`, false, `checkout still has A: ids=${ids.join(',')} sidebar=${sidebar.slice(0, 180)}`);
    }
    if (!ids.includes(PRODUCT_B) && !/Product B|Navy/i.test(sidebar)) {
      record(`C buy-now-A-then-B [${viewportName}]`, false, `checkout missing B: ids=${ids.join(',')} sidebar=${sidebar.slice(0, 180)}`);
    }
    record(`C buy-now-A-then-B [${viewportName}]`, true, `ids=${ids.join(',') || 'sidebar-ok'}`);
  } finally {
    await context.close();
  }
}

async function testD(browser, viewportName) {
  const { context, page } = await newContext(browser, viewportName);
  try {
    await addToCart(page, PRODUCT_A, '42');
    await startCartCheckout(page);
    await continueToReview(page);
    await page.goto(`${SITE}/shop.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await buyNow(page, PRODUCT_B, '40');
    const storage = await readStorage(page);
    const ids = checkoutProductIds(storage);
    if (ids.includes(PRODUCT_A)) {
      record(`D cart-A-buy-now-B [${viewportName}]`, false, `Buy Now merged cart A: ${ids.join(',')}`);
    }
    if (!cartHasProduct(storage.cart, PRODUCT_A)) {
      record(`D cart-A-buy-now-B [${viewportName}]`, false, 'Cart lost Product A');
    }
    record(`D cart-A-buy-now-B [${viewportName}]`, true, `checkout=${ids.join(',')} cartA=yes`);
  } finally {
    await context.close();
  }
}

async function testE(browser) {
  const { context, page } = await newContext(browser, 'mobile');
  try {
    await buyNow(page, PRODUCT_A, '42');
    await continueToReview(page);
    await page.goto(`${SITE}/shop.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await addToCart(page, PRODUCT_B, '40');
    await page.goto(`${SITE}/cart.html?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const storage = await readStorage(page);
    if (cartHasProduct(storage.cart, PRODUCT_A)) {
      record('E buy-now-A-cart-B', false, 'Abandoned Buy Now A appeared in cart');
    }
    if (!cartHasProduct(storage.cart, PRODUCT_B)) {
      record('E buy-now-A-cart-B', false, 'Cart missing Product B');
    }
    record('E buy-now-A-cart-B', true, `cart lines=${storage.cart.length}`);
  } finally {
    await context.close();
  }
}

async function testFG(browser) {
  const { context, page } = await newContext(browser, 'desktop');
  try {
    await addToCart(page, PRODUCT_A, '42');
    await startCartCheckout(page);
    await continueToReview(page);
    await continueToPayment(page);
    const orderId = await placeOrderCapture(page);
    await page.goto(`${SITE}/cart.html?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    let storage = await readStorage(page);
    if (!cartHasProduct(storage.cart, PRODUCT_A)) {
      record('G payment-cancelled-keeps-cart', false, `cart emptied at Place Order orderId=${orderId}`);
    } else {
      record('G payment-cancelled-keeps-cart', true, `orderId=${orderId || 'none'} cart kept A`);
    }

    await page.evaluate(() => {
      const raw = localStorage.getItem('byose_checkout_confirmation_v1')
        || sessionStorage.getItem('byose_checkout_confirmation_v1');
      if (!raw) return;
      const confirmation = JSON.parse(raw);
      confirmation.paymentStatus = 'paid';
      confirmation.paymentStatusLabel = 'Paid';
      confirmation.payment = { ...(confirmation.payment || {}), method: 'dpo', status: 'paid' };
      const encoded = JSON.stringify(confirmation);
      localStorage.setItem('byose_checkout_confirmation_v1', encoded);
      sessionStorage.setItem('byose_checkout_confirmation_v1', encoded);
      window.ByoseStorefrontSync?.writeStateByKey?.('byose_checkout_confirmation_v1', confirmation);
    });
    const confirmation = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('byose_checkout_confirmation_v1') || 'null');
      } catch {
        return null;
      }
    });
    const successId = orderId || confirmation?.orderId;
    if (!successId) {
      record('F paid-removes-cart', false, 'no orderId/confirmation to simulate paid success');
    } else {
      await page.goto(`${SITE}/orders/order-success.html?orderId=${encodeURIComponent(successId)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await page.waitForTimeout(2500);
      await page.goto(`${SITE}/cart.html?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      storage = await readStorage(page);
      if (cartHasProduct(storage.cart, PRODUCT_A)) {
        record('F paid-removes-cart', false, 'Product A still in cart after paid confirmation');
      } else {
        record('F paid-removes-cart', true, `removed after paid success ${successId}`);
      }
    }
  } finally {
    await context.close();
  }
}

async function testH(browser) {
  const { context, page } = await newContext(browser, 'mobile');
  try {
    await buyNow(page, PRODUCT_A, '42');
    await continueToReview(page);
    await continueToPayment(page);
    const orderId = await placeOrderCapture(page);
    if (!orderId) {
      record('H buy-now-order-created', false, 'Buy Now did not create an order');
      return;
    }
    const db = new Database(path.join(ROOT, 'server/database/byosemarket.sqlite'), { readonly: true });
    const row = db.prepare(
      `SELECT order_id, payment_status, payment_method FROM orders WHERE order_id = ? OR id = ?`
    ).get(orderId, orderId);
    db.close();
    if (!row) {
      record('H buy-now-order-created', false, `SQLite missing ${orderId}`);
    } else {
      record('H buy-now-order-created', true, `${orderId} payment=${row.payment_status || row.payment_method || 'saved'}`);
    }
  } finally {
    await context.close();
  }
}

async function testI(browser) {
  const { context, page } = await newContext(browser, 'mobile');
  try {
    await buyNow(page, PRODUCT_A, '42');
    await continueToReview(page);
    await page.goto(`${SITE}/details/product-details1.html?id=${encodeURIComponent(PRODUCT_B)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await buyNow(page, PRODUCT_B, '41');
    const storage = await readStorage(page);
    const ids = checkoutProductIds(storage);
    const draftIds = (storage.draft?.products || []).map((item) => String(item.productId || item.id));
    if (ids.includes(PRODUCT_A) || draftIds.includes(PRODUCT_A)) {
      record('I clean-buy-now-B', false, `stale A remained ids=${ids.join(',')} draft=${draftIds.join(',')}`);
    } else {
      record('I clean-buy-now-B', true, `ids=${ids.join(',')}`);
    }
  } finally {
    await context.close();
  }
}

async function testJ(browser) {
  const { context, page } = await newContext(browser, 'tablet');
  try {
    await addToCart(page, PRODUCT_A, '42');
    await page.goto(`${SITE}/cart.html?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const storage = await readStorage(page);
    if (!cartHasProduct(storage.cart, PRODUCT_A)) {
      record('J cart-refresh', false, 'cart lost Product A after refresh');
    } else {
      record('J cart-refresh', true, `qty=${storage.cart[0]?.qty || 1}`);
    }
  } finally {
    await context.close();
  }
}

async function testK(browser) {
  const { context, page } = await newContext(browser, 'desktop');
  try {
    await addToCart(page, PRODUCT_A, '42');
    await startCartCheckout(page);
    const before = checkoutProductIds(await readStorage(page));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPageFn(page, () => window.__ckStep === 'shipping', 60000);
    const after = checkoutProductIds(await readStorage(page));
    if (!after.includes(PRODUCT_A) || after.join(',') !== before.join(',')) {
      record('K checkout-refresh', false, `before=${before.join(',')} after=${after.join(',')}`);
    } else {
      record('K checkout-refresh', true, `restored ${after.join(',')}`);
    }
  } finally {
    await context.close();
  }
}

async function testL(browser) {
  const { context, page } = await newContext(browser, 'mobile');
  try {
    await buyNow(page, PRODUCT_A, '42');
    await continueToReview(page);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await buyNow(page, PRODUCT_B, '40');
    const storage = await readStorage(page);
    const ids = checkoutProductIds(storage);
    if (ids.includes(PRODUCT_A)) {
      record('L browser-back', false, `Back restored Product A: ${ids.join(',')}`);
    } else {
      record('L browser-back', true, `ids=${ids.join(',')}`);
    }
  } finally {
    await context.close();
  }
}

async function main() {
  const health = await fetch(`${SITE}/healthz`).then((r) => r.json()).catch((error) => ({ error: String(error) }));
  if (health.error && !health.ok && !health.success) {
    const alt = await fetch(`${SITE}/api/healthz`).then((r) => r.json()).catch((error) => ({ error: String(error) }));
    if (alt.error) {
      throw new Error(`Local API not reachable at ${SITE}: ${health.error}`);
    }
  }

  const browser = await chromium.launch({
    headless: true,
    channel: process.env.BYOSE_PW_CHANNEL || 'chrome'
  });
  try {
    await testA(browser, 'mobile');
    await testA(browser, 'tablet');
    await testA(browser, 'desktop');
    await testB(browser);
    await testC(browser, 'mobile');
    await testC(browser, 'tablet');
    await testC(browser, 'desktop');
    await testD(browser, 'mobile');
    await testD(browser, 'tablet');
    await testD(browser, 'desktop');
    await testE(browser);
    await testFG(browser);
    await testH(browser);
    await testI(browser);
    await testJ(browser);
    await testK(browser);
    await testL(browser);
  } finally {
    await browser.close().catch(() => {});
  }

  const failed = results.filter((row) => !row.ok);
  console.log(`\nMatrix ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
