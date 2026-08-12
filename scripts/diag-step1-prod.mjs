/**
 * Production Step 1 → Step 2 browser diagnostic (real network, no sync isolation).
 * Run: node scripts/diag-step1-prod.mjs
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = (process.env.BYOSE_SITE_ORIGIN || 'https://byosemarket.com').replace(/\/+$/, '');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'verification-artifacts', 'step1-prod-diag');

const VIEWPORTS = [
  { id: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true },
  { id: 'tablet', width: 820, height: 1180, isMobile: false, hasTouch: true },
  { id: 'desktop', width: 1366, height: 768, isMobile: false, hasTouch: false }
];

async function pickProduct() {
  const res = await fetch(`${SITE}/api/products?limit=50`);
  const body = await res.json().catch(() => ({}));
  const products = body.products || body.data || [];
  return products[0] || { id: '5', name: 'Product', price: 1000 };
}

function buildCartItem(product) {
  const colorVariants = product?.variants?.colorVariants || product?.metadata?.colorVariants || [];
  const firstColor = colorVariants[0] || {};
  const firstSize = Array.isArray(firstColor.sizes)
    ? firstColor.sizes.find((row) => Number(row.stock) > 0)
    : null;
  const productId = String(product?.id || product?.catalogId || '5');
  return {
    id: productId,
    productId,
    name: product?.name || 'Product',
    price: Number(product?.price || 1000),
    qty: 1,
    quantity: 1,
    image: firstColor?.image || product?.image || '',
    color: firstColor?.colorName || '',
    size: firstSize?.size || '',
    variantKey: `${firstColor?.colorName || 'default'}::${firstSize?.size || 'default'}`,
    stock: 99,
    availableStock: 99,
    total: Number(product?.price || 1000)
  };
}

async function runViewport(browser, viewport, item) {
  const logs = [];
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    userAgent: viewport.isMobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined
  });
  const page = await context.newPage();
  page.on('console', (msg) => logs.push({ t: 'console', type: msg.type(), text: msg.text() }));
  page.on('pageerror', (err) => logs.push({ t: 'pageerror', text: err.message, stack: err.stack }));
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) logs.push({ t: 'nav', url: frame.url() });
  });

  await context.addInitScript((cartItem) => {
    localStorage.setItem('byose_direct_checkout', JSON.stringify(cartItem));
    localStorage.removeItem('byose_checkout_draft_v1');
    localStorage.removeItem('byose_checkout_confirmation_v1');
    try { sessionStorage.removeItem('byose_checkout_handoff_v1'); } catch {}
  }, item);

  await page.goto(`${SITE}/orders/shipping.html?cb=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });

  // Wait for module boot
  await page.waitForFunction(() => window.__ckStep === 'shipping' || document.getElementById('shippingContinueBtn'), {
    timeout: 60000
  }).catch(() => null);

  const boot = await page.evaluate(() => ({
    url: location.href,
    ckStep: window.__ckStep || null,
    moduleScript: document.querySelector('script[type="module"][src*="shipping"]')?.src || null,
    continueExists: !!document.getElementById('shippingContinueBtn'),
    stickyExists: !!document.getElementById('stickyContinueBtn')
  }));

  // Spy navigation APIs before click
  await page.evaluate(() => {
    window.__navAttempts = [];
    window.__commitResult = null;
    const wrap = (name, fn) => {
      try {
        window.location[name] = function patched(url) {
          window.__navAttempts.push({ type: name, url: String(url), at: Date.now() });
          return fn.call(window.location, url);
        };
      } catch {}
    };
    wrap('assign', window.location.assign);
    wrap('replace', window.location.replace);
  });

  await page.fill('input[name="fullName"]', 'Test Buyer Mobile');
  await page.fill('input[name="phone"]', '0781234567');
  await page.fill('input[name="provinceCity"]', 'Kigali City');
  await page.fill('input[name="district"]', 'Gasabo');
  await page.fill('input[name="sector"]', 'Kimironko');
  await page.fill('input[name="cell"]', 'Bibare');
  await page.fill('input[name="village"]', 'Test Village');

  const before = await page.evaluate(() => {
    const form = document.getElementById('shippingForm');
    const data = form ? Object.fromEntries(new FormData(form).entries()) : {};
    let draft = null;
    let handoff = null;
    try { draft = JSON.parse(localStorage.getItem('byose_checkout_draft_v1') || 'null'); } catch {}
    try { handoff = JSON.parse(sessionStorage.getItem('byose_checkout_handoff_v1') || 'null'); } catch {}
    return {
      form: data,
      gps: document.getElementById('gpsCard')?.dataset?.state || null,
      draftStep: draft?.step || null,
      draftFilled: draft?.shipping
        ? ['fullName', 'phone', 'provinceCity', 'district', 'sector', 'cell', 'village']
          .filter((k) => String(draft.shipping[k] || '').trim()).length
        : 0,
      handoffStep: handoff?.step || null,
      products: draft?.products?.length || 0
    };
  });

  const stickyVisible = await page.locator('#stickyContinueBtn').isVisible().catch(() => false);
  const primaryVisible = await page.locator('#shippingContinueBtn').isVisible().catch(() => false);

  if (stickyVisible) {
    await page.locator('#stickyContinueBtn').click({ force: true });
  } else {
    await page.locator('#shippingContinueBtn').click({ force: true });
  }

  let landed = 'timeout';
  try {
    await page.waitForURL(/checkout\.html/, { timeout: 10000 });
    landed = 'checkout';
  } catch {
    landed = /shipping\.html/i.test(page.url()) ? 'still-shipping' : page.url();
  }

  // Allow bounce window
  await page.waitForTimeout(2500);
  const finalUrl = page.url();
  if (/shipping\.html/i.test(finalUrl)) {
    landed = landed === 'checkout' ? 'bounced-to-shipping' : 'still-shipping';
  } else if (/checkout\.html/i.test(finalUrl)) {
    landed = 'checkout';
  } else if (/cart\.html/i.test(finalUrl)) {
    landed = 'redirected-cart';
  }

  const after = await page.evaluate(() => {
    let draft = null;
    let handoff = null;
    try { draft = JSON.parse(localStorage.getItem('byose_checkout_draft_v1') || 'null'); } catch {}
    try { handoff = JSON.parse(sessionStorage.getItem('byose_checkout_handoff_v1') || 'null'); } catch {}
    return {
      url: location.href,
      ckStep: window.__ckStep || null,
      message: (document.getElementById('message')?.textContent || '').trim(),
      messageHidden: document.getElementById('message')?.hidden ?? null,
      errors: Array.from(document.querySelectorAll('[data-error]'))
        .map((el) => [el.dataset.error, (el.textContent || '').trim()])
        .filter(([, text]) => text),
      navAttempts: window.__navAttempts || [],
      draftStep: draft?.step || null,
      draftProducts: draft?.products?.length || 0,
      draftShippingFilled: draft?.shipping
        ? ['fullName', 'phone', 'provinceCity', 'district', 'sector', 'cell', 'village']
          .filter((k) => String(draft.shipping[k] || '').trim()).length
        : 0,
      handoffStep: handoff?.step || null,
      handoffProducts: handoff?.products?.length || 0,
      handoffShippingFilled: handoff?.shipping
        ? ['fullName', 'phone', 'provinceCity', 'district', 'sector', 'cell', 'village']
          .filter((k) => String(handoff.shipping[k] || '').trim()).length
        : 0,
      reviewBtn: !!document.getElementById('reviewContinueBtn'),
      shippingSummary: (document.getElementById('shippingSummary')?.innerText || '').slice(0, 300)
    };
  });

  await page.screenshot({ path: join(OUT, `${viewport.id}-after.png`), fullPage: true });
  await context.close();

  return {
    viewport: viewport.id,
    boot,
    before,
    stickyVisible,
    primaryVisible,
    landed,
    finalUrl,
    after,
    logs: logs.slice(-50)
  };
}

await mkdir(OUT, { recursive: true });
const product = await pickProduct();
const item = buildCartItem(product);
const browser = await chromium.launch({ headless: true });
const results = [];
for (const viewport of VIEWPORTS) {
  // eslint-disable-next-line no-await-in-loop
  const result = await runViewport(browser, viewport, item);
  results.push(result);
  console.log(`\n=== ${viewport.id} => ${result.landed} ===`);
  console.log(JSON.stringify({
    boot: result.boot,
    before: result.before,
    stickyVisible: result.stickyVisible,
    landed: result.landed,
    finalUrl: result.finalUrl,
    after: {
      ckStep: result.after.ckStep,
      message: result.after.message,
      errors: result.after.errors,
      navAttempts: result.after.navAttempts,
      draftStep: result.after.draftStep,
      draftShippingFilled: result.after.draftShippingFilled,
      handoffStep: result.after.handoffStep,
      handoffShippingFilled: result.after.handoffShippingFilled,
      reviewBtn: result.after.reviewBtn,
      shippingSummary: result.after.shippingSummary
    },
    pageerrors: result.logs.filter((l) => l.t === 'pageerror')
  }, null, 2));
}
await browser.close();
await writeFile(join(OUT, 'diag.json'), JSON.stringify({ site: SITE, item, results }, null, 2));
console.log(`\nWrote ${join(OUT, 'diag.json')}`);
const failed = results.filter((r) => r.landed !== 'checkout');
process.exit(failed.length ? 1 : 0);
