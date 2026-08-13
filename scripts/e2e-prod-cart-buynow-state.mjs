/**
 * Production STEP 2 matrix: Cart vs Buy Now isolation on https://byosemarket.com
 * Run: node scripts/e2e-prod-cart-buynow-state.mjs
 */
import { chromium } from 'playwright';

const SITE = (process.env.BYOSE_SITE_ORIGIN || 'https://byosemarket.com').replace(/\/+$/, '');
const SHIPPING = {
  fullName: 'Prod State Buyer',
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
let PRODUCT_A = '';
let PRODUCT_B = '';
let SIZE_A = '';
let SIZE_B = '';
let NAME_A = '';
let NAME_B = '';

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`${name}: ${detail || 'failed'}`);
}

function absolutize(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `${SITE}${value}`;
  return `${SITE}/${value.replace(/^\/+/, '')}`;
}

async function listInStockProducts() {
  const body = await fetch(`${SITE}/api/products?limit=500`).then((r) => r.json());
  return (body.products || []).filter((product) => {
    const colors = product?.variants?.colorVariants || product?.metadata?.colorVariants || [];
    return colors.some((color) => (color.sizes || []).some((size) => Number(size.stock) > 0));
  });
}

function firstInStockSize(product) {
  const colors = product?.variants?.colorVariants || product?.metadata?.colorVariants || [];
  const color = colors.find((entry) => (entry.sizes || []).some((size) => Number(size.stock) > 0)) || colors[0];
  const size = (color?.sizes || []).find((row) => Number(row.stock) > 0) || color?.sizes?.[0];
  return String(size?.label || size?.value || size?.size || '');
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
      intent: parse('byose_checkout_intent_v1')
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

async function waitForPageFn(page, fn, timeout = 60000) {
  await page.waitForFunction(fn, undefined, { timeout });
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

async function openProduct(page, productId) {
  await page.goto(`${SITE}/details/product-details1.html?id=${encodeURIComponent(productId)}&cb=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });
  await waitForPageFn(page, () => {
    const title = document.getElementById('productName')?.textContent || '';
    return Boolean(title.trim() && title.trim() !== 'Product Name');
  }, 90000);
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
  }, productId, { timeout: 20000 });
}

async function buyNow(page, productId, sizeLabel) {
  await openProduct(page, productId);
  await page.waitForTimeout(400);
  const sticky = page.locator('#stickyBuyNowBtn');
  const primary = page.locator('#buyNowBtn');
  if (await sticky.isVisible().catch(() => false)) await sticky.click({ force: true });
  else await primary.click({ force: true });
  if (await page.locator('[data-config-submit-action]').count()) {
    await selectVariantInModal(page, sizeLabel);
    await page.locator('[data-config-submit-action="buy"]').first().click({ force: true });
  }
  if (!/orders\/shipping\.html/i.test(page.url())) {
    if (await primary.count()) {
      await primary.click({ force: true }).catch(() => {});
    }
  }
  await page.waitForURL(/orders\/shipping\.html/i, { timeout: 90000 });
  await waitForPageFn(page, () => window.__ckStep === 'shipping', 60000);
}

async function startCartCheckout(page) {
  await page.goto(`${SITE}/cart.html?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitForPageFn(page, () => Boolean(window.ByoseCart && (window.ByoseCart.getItems?.() || []).length), 30000);
  await page.waitForSelector('#checkoutBtn, #stickyCheckoutBtn, #cartItems', { timeout: 30000 });
  const clicked = await page.evaluate(() => {
    try {
      if (typeof window.ByoseCart?.proceedToCheckout === 'function') {
        window.ByoseCart.proceedToCheckout();
        return 'api';
      }
    } catch (error) {
      return `error:${error.message}`;
    }
    const button = document.getElementById('stickyCheckoutBtn') || document.getElementById('checkoutBtn');
    button?.click();
    return button ? 'click' : 'missing';
  });
  if (String(clicked).startsWith('error:')) {
    throw new Error(`proceedToCheckout failed: ${clicked}`);
  }
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
    } catch { /* ignore */ }
  };
  page.on('response', onResponse);
  await page.evaluate(() => {
    const form = document.getElementById('paymentForm');
    if (form?.requestSubmit) form.requestSubmit();
    else document.getElementById('placeOrderBtn')?.click();
  });
  const deadline = Date.now() + 25000;
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
      if (sessionStorage.getItem('byose_prod_state_cleared')) return;
      sessionStorage.setItem('byose_prod_state_cleared', '1');
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
  return { context, page: await context.newPage() };
}

async function testA(browser, viewportName) {
  const { context, page } = await newContext(browser, viewportName);
  try {
    await addToCart(page, PRODUCT_A, SIZE_A);
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
    await buyNow(page, PRODUCT_A, SIZE_A);
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
    await buyNow(page, PRODUCT_A, SIZE_A);
    await continueToReview(page);
    await page.goto(`${SITE}/shop.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await buyNow(page, PRODUCT_B, SIZE_B);
    const storage = await readStorage(page);
    const ids = checkoutProductIds(storage);
    const sidebar = await page.locator('#sidebar').innerText().catch(() => '');
    if (ids.includes(PRODUCT_A) || (NAME_A && sidebar.includes(NAME_A.slice(0, 18)))) {
      record(`C buy-now-A-then-B [${viewportName}]`, false, `checkout still has A: ids=${ids.join(',')} sidebar=${sidebar.slice(0, 180)}`);
    }
    record(`C buy-now-A-then-B [${viewportName}]`, true, `ids=${ids.join(',')}`);
  } finally {
    await context.close();
  }
}

async function testD(browser, viewportName) {
  const { context, page } = await newContext(browser, viewportName);
  try {
    await addToCart(page, PRODUCT_A, SIZE_A);
    await startCartCheckout(page);
    await continueToReview(page);
    await page.goto(`${SITE}/shop.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await buyNow(page, PRODUCT_B, SIZE_B);
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
    await buyNow(page, PRODUCT_A, SIZE_A);
    await continueToReview(page);
    await page.goto(`${SITE}/shop.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await addToCart(page, PRODUCT_B, SIZE_B);
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

async function testG(browser) {
  const { context, page } = await newContext(browser, 'desktop');
  try {
    await addToCart(page, PRODUCT_A, SIZE_A);
    await startCartCheckout(page);
    await continueToReview(page);
    await continueToPayment(page);
    const orderId = await placeOrderCapture(page);
    await page.goto(`${SITE}/cart.html?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const afterPlace = await readStorage(page);
    if (!cartHasProduct(afterPlace.cart, PRODUCT_A)) {
      record('G payment-cancelled-keeps-cart', false, `cart emptied at Place Order orderId=${orderId}`);
    }
    let verified = null;
    if (orderId) {
      await fetch(`${SITE}/api/payments/dpo/back?orderId=${encodeURIComponent(orderId)}`).catch(() => null);
      verified = await fetch(`${SITE}/api/payments/dpo/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ orderId })
      }).then((r) => r.json()).catch(() => null);
    }
    await page.goto(`${SITE}/cart.html?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const storage = await readStorage(page);
    const markedPaid = verified?.outcome === 'success' || String(verified?.paymentStatus || '').toLowerCase() === 'paid';
    if (!cartHasProduct(storage.cart, PRODUCT_A)) {
      record('G payment-cancelled-keeps-cart', false, `cart emptied after DPO cancel orderId=${orderId}`);
    } else if (markedPaid) {
      record('G payment-cancelled-keeps-cart', false, `cancelled order marked paid orderId=${orderId} status=${verified?.paymentStatus}`);
    } else {
      record('G payment-cancelled-keeps-cart', true, `orderId=${orderId || 'none'} status=${verified?.paymentStatus || 'unknown'} cart kept A`);
    }
  } finally {
    await context.close();
  }
}

async function testI(browser) {
  const { context, page } = await newContext(browser, 'mobile');
  try {
    await buyNow(page, PRODUCT_A, SIZE_A);
    await continueToReview(page);
    await buyNow(page, PRODUCT_B, SIZE_B);
    const storage = await readStorage(page);
    const ids = checkoutProductIds(storage);
    if (ids.includes(PRODUCT_A)) {
      record('I clean-buy-now-B', false, `stale A remained ids=${ids.join(',')}`);
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
    await addToCart(page, PRODUCT_A, SIZE_A);
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
    await addToCart(page, PRODUCT_A, SIZE_A);
    await startCartCheckout(page);
    const before = checkoutProductIds(await readStorage(page));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPageFn(page, () => window.__ckStep === 'shipping', 60000);
    const after = checkoutProductIds(await readStorage(page));
    if (!after.includes(PRODUCT_A)) {
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
    await buyNow(page, PRODUCT_A, SIZE_A);
    await continueToReview(page);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await buyNow(page, PRODUCT_B, SIZE_B);
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
  if (health.error || health.status !== 'ok') {
    throw new Error(`Production health failed: ${JSON.stringify(health)}`);
  }
  const products = await listInStockProducts();
  if (products.length < 2) {
    throw new Error(`Need two in-stock products, got ${products.length}`);
  }
  const precious = products.find((row) => /PRECIOUS|Breathable Sports Walking Sneakers/i.test(String(row.name || '')) || String(row.id) === '12012');
  const productA = precious || products[0];
  const productB = products.find((row) => String(row.id) !== String(productA.id)) || products[1];
  PRODUCT_A = String(productA.id || productA.catalogId);
  PRODUCT_B = String(productB.id || productB.catalogId);
  SIZE_A = firstInStockSize(productA);
  SIZE_B = firstInStockSize(productB);
  NAME_A = String(productA.name || '');
  NAME_B = String(productB.name || '');
  console.log('Using products', { PRODUCT_A, NAME_A, SIZE_A, PRODUCT_B, NAME_B, SIZE_B });

  const browser = await chromium.launch({
    headless: true,
    channel: process.env.BYOSE_PW_CHANNEL || 'chrome'
  });
  const suite = String(process.env.BYOSE_E2E_SUITE || 'all').trim().toLowerCase();
  try {
    if (suite === 'all' || suite === 'a-e') {
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
    }
    if (suite === 'all' || suite === 'g-l') {
      await testG(browser);
      await testI(browser);
      await testJ(browser);
      await testK(browser);
      await testL(browser);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const failed = results.filter((row) => !row.ok);
  console.log(`\nProd isolation ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
