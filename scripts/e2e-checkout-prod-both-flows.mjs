/**
 * Production E2E: Buy Now + Add to Cart through Payment → DPO TEST → Success.
 * Run: node scripts/e2e-checkout-prod-both-flows.mjs
 */
import { chromium } from 'playwright';
import {
  buildVariantCartPayload,
  validateVariantSelection
} from '../js/variant-cart-payload.js';
import { enrichProductColorVariants } from '../js/color-variant-inventory.js';

const SITE = (process.env.BYOSE_SITE_ORIGIN || 'https://byosemarket.com').replace(/\/+$/, '');

const SHIPPING = {
  fullName: 'Prod E2E Buyer',
  phone: '0781234567',
  provinceCity: 'Kigali City',
  district: 'Gasabo',
  sector: 'Kimironko',
  cell: 'Bibare',
  village: 'Test Village'
};

function absolutize(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `${SITE}${value}`;
  return `${SITE}/${value.replace(/^\/+/, '')}`;
}

async function listInStockProducts() {
  const body = await fetch(`${SITE}/api/products?limit=500`).then((r) => r.json());
  const products = body.products || [];
  return products.filter((product) => {
    const colors = product?.variants?.colorVariants || product?.metadata?.colorVariants || [];
    return colors.some((color) => (color.sizes || []).some((size) => Number(size.stock) > 0));
  });
}

function buildPayload(product) {
  const enriched = enrichProductColorVariants(product, absolutize);
  const colors = enriched?.variants?.colorVariants || enriched?.metadata?.colorVariants || [];
  const color = colors.find((entry) => (entry.sizes || []).some((size) => Number(size.stock) > 0)) || colors[0];
  const size = (color?.sizes || []).find((row) => Number(row.stock) > 0) || color?.sizes?.[0];
  const attributes = { Color: color.id, Size: size.value || size.size };
  const validation = validateVariantSelection(enriched, attributes);
  if (!validation.valid) {
    throw new Error(validation.message || 'invalid variant');
  }
  return buildVariantCartPayload(enriched, 1, attributes);
}

async function runFlow(browser, flow, payload) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await context.addInitScript(({ flowName, item }) => {
    localStorage.removeItem('byose_checkout_draft_v1');
    localStorage.removeItem('byose_checkout_confirmation_v1');
    localStorage.removeItem('byose_market_cart_v1');
    localStorage.removeItem('byose_checkout_active_v1');
    localStorage.removeItem('byose_direct_checkout');
    try {
      sessionStorage.removeItem('byose_checkout_handoff_v1');
      sessionStorage.removeItem('byose_checkout_step1_commit_v1');
    } catch {}
    if (flowName === 'buyNow') {
      localStorage.setItem('byose_direct_checkout', JSON.stringify(item));
    } else {
      const cartItem = { ...item, lineId: `${item.id}::${item.variantKey || 'default'}`, selected: true };
      localStorage.setItem('byose_market_cart_v1', JSON.stringify([cartItem]));
      localStorage.setItem('byose_checkout_active_v1', JSON.stringify([cartItem]));
    }
  }, { flowName: flow, item: payload });

  await page.goto(`${SITE}/orders/shipping.html?cb=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });
  await page.waitForFunction(() => window.__ckStep === 'shipping', { timeout: 60000 });
  for (const [name, value] of Object.entries(SHIPPING)) {
    // eslint-disable-next-line no-await-in-loop
    await page.fill(`input[name="${name}"]`, value);
  }
  if (await page.locator('#stickyContinueBtn').isVisible().catch(() => false)) {
    await page.locator('#stickyContinueBtn').click({ force: true });
  } else {
    await page.locator('#shippingContinueBtn').click({ force: true });
  }
  await page.waitForURL(/checkout\.html/, { timeout: 30000 });
  await page.waitForFunction(() => window.__ckStep === 'review', { timeout: 30000 });
  const summary = await page.locator('#shippingSummary').innerText();
  const productText = await page.locator('#productList').innerText();

  await page.locator('#reviewContinueBtn').click({ force: true });
  await page.waitForURL(/payment\.html/, { timeout: 30000 });
  await page.waitForFunction(() => window.__ckStep === 'payment', { timeout: 30000 });

  let createdOrderId = '';
  let orderError = '';
  let initiateOk = false;

  page.on('response', async (response) => {
    try {
      if (response.request().method() === 'POST' && /\/api\/orders\/?$/i.test(response.url())) {
        const body = await response.json().catch(() => null);
        createdOrderId = String(body?.order?.orderId || body?.orderId || '').trim();
        if (!response.ok || body?.success === false) {
          orderError = body?.message || `order HTTP ${response.status}`;
        }
      }
      if (response.request().method() === 'POST' && /\/api\/payments\/dpo\/initiate/i.test(response.url())) {
        const body = await response.json().catch(() => null);
        initiateOk = Boolean(body?.success && (body.paymentUrl || body.redirectUrl));
        createdOrderId = createdOrderId || String(body?.orderId || '').trim();
      }
    } catch {}
  });

  await page.route(/3gdirectpay|payv3\.php/i, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body>DPO sandbox intercepted</body></html>'
    });
  });

  const dpoRadio = page.locator('input[name="paymentMethod"][value="dpo"]');
  if (await dpoRadio.count()) {
    await dpoRadio.click({ force: true });
  } else {
    throw new Error(`${flow}: DPO payment method not available`);
  }

  await page.locator('#placeOrderBtn').click({ force: true });

  for (let i = 0; i < 60; i += 1) {
    if (createdOrderId || orderError) break;
    const message = (await page.locator('#message').innerText().catch(() => '')).trim();
    if (message) {
      orderError = message;
      break;
    }
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(500);
  }

  if (orderError) {
    throw new Error(`${flow}: ${orderError}`);
  }
  if (!createdOrderId) {
    throw new Error(`${flow}: missing orderId after Place Order`);
  }

  // Complete DPO TEST via return handler (uses stored TransToken + verifyToken).
  await page.goto(`${SITE}/api/payments/dpo/return?orderId=${encodeURIComponent(createdOrderId)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });

  if (/payment-result\.html/i.test(page.url())) {
    const verified = await fetch(`${SITE}/api/payments/dpo/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ orderId: createdOrderId })
    }).then((r) => r.json()).catch(() => null);
    if (verified?.outcome === 'success' || verified?.paymentStatus === 'paid') {
      await page.goto(`${SITE}/orders/order-success.html?orderId=${encodeURIComponent(createdOrderId)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
    } else {
      throw new Error(`${flow}: DPO verify did not pay (${verified?.outcome || verified?.message || page.url()})`);
    }
  }

  await page.waitForURL(/order-success\.html/, { timeout: 120000 });
  const successText = await page.locator('body').innerText();
  await context.close();

  if (errors.length) {
    throw new Error(`${flow} pageerrors: ${errors.join(' | ')}`);
  }

  return {
    flow,
    orderId: createdOrderId,
    initiateOk,
    summary: summary.slice(0, 180),
    productText: productText.slice(0, 180),
    successHasOrder: /order/i.test(successText),
    successSnippet: successText.slice(0, 280)
  };
}

const inStock = await listInStockProducts();
if (inStock.length < 1) {
  throw new Error('No in-stock variant products on production');
}

const browser = await chromium.launch({ headless: true });
const results = [];

const buyNowProduct = inStock[0];
const addToCartProduct = inStock[1] || inStock[0];
const flows = [
  { name: 'buyNow', product: buyNowProduct },
  { name: 'addToCart', product: addToCartProduct }
];

for (const entry of flows) {
  // Refresh stock snapshot before each flow.
  // eslint-disable-next-line no-await-in-loop
  const freshList = await listInStockProducts();
  const product = freshList.find((row) => String(row.id) === String(entry.product.id)) || freshList[0];
  if (!product) {
    throw new Error(`No stock left for ${entry.name}`);
  }
  const payload = buildPayload(product);
  console.log(`Starting ${entry.name}`, {
    productId: payload.id,
    color: payload.colorName,
    size: payload.sizeLabel,
    stock: payload.availableStock
  });
  // eslint-disable-next-line no-await-in-loop
  const result = await runFlow(browser, entry.name, payload);
  results.push(result);
  console.log(`PASS ${entry.name}`, result);
}

await browser.close();
console.log(JSON.stringify({ site: SITE, results }, null, 2));
console.log('PASS — production both flows reached Success');
