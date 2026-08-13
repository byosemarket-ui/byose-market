/**
 * Production E2E: Buy Now + Add to Cart through Payment → DPO TEST → Success.
 * Completes the real DPO sandbox hosted page with documented test cards.
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

const DPO_TEST_CARD = {
  number: '5436886269848367',
  name: 'John Doe',
  expiry: '12/30',
  cvv: '123'
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

function maxVariantStock(product) {
  const colors = product?.variants?.colorVariants || product?.metadata?.colorVariants || [];
  let max = 0;
  for (const color of colors) {
    for (const size of color.sizes || []) {
      max = Math.max(max, Number(size.stock) || 0);
    }
  }
  return max;
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

async function completeDpoSandboxPayment(page, paymentUrl) {
  // DPO's hosted card tab is unreliable in a 390px viewport for automation.
  // BYOSE checkout is still tested at the flow viewport; only the gateway page is widened.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(paymentUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#cerditcarAtag, a.nav-link:has-text("DEBIT/CREDIT CARD")', { timeout: 60000 });

  const cardTab = page.locator('#cerditcarAtag, a.nav-link:has-text("DEBIT/CREDIT CARD")').first();
  await cardTab.click({ force: true });
  await page.evaluate(() => document.getElementById('cerditcarAtag')?.click());
  await page.waitForSelector('#TRANSCreditnum', { state: 'visible', timeout: 30000 });
  await page.waitForTimeout(400);

  await page.locator('#TRANScardholdername').fill('');
  await page.locator('#TRANScardholdername').pressSequentially(DPO_TEST_CARD.name, { delay: 40 });
  await page.locator('#TRANSCreditnum').fill('');
  await page.locator('#TRANSCreditnum').pressSequentially(DPO_TEST_CARD.number, { delay: 20 });
  await page.selectOption('#TRANSexpiryM', '12');
  await page.selectOption('#TRANSexpiryY', '2030');
  await page.locator('#TRANScvv').fill('');
  await page.locator('#TRANScvv').pressSequentially(DPO_TEST_CARD.cvv, { delay: 30 });
  await page.waitForTimeout(400);

  const termsVisible = page.locator('#terms-approval_creditcard').filter({ visible: true }).last();
  if (await termsVisible.count()) {
    await termsVisible.check({ force: true });
  } else {
    await page.locator('#terms-approval_creditcard').last().evaluate((el) => {
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('click', { bubbles: true }));
    });
  }

  const continueBtn = page.locator('button:has-text("CONTINUE TO PAY")').filter({ visible: true }).last();
  if (!(await continueBtn.count())) {
    throw new Error('DPO CONTINUE TO PAY button not found');
  }
  await continueBtn.click({ force: true });

  // Return URL → verify → order-success (or payment-result then success).
  await page.waitForURL(
    (url) => /byosemarket\.com/i.test(url.href)
      && /(order-success|payment-result|\/api\/payments\/dpo\/(return|back))/i.test(url.href),
    { timeout: 180000 }
  );

  // Follow any intermediate payment-result → success navigation.
  for (let i = 0; i < 40; i += 1) {
    const href = page.url();
    if (/order-success\.html/i.test(href)) break;
    if (/payment-result\.html/i.test(href)) {
      const verifiedPaid = await page.evaluate(async () => {
        const params = new URLSearchParams(window.location.search);
        const orderId = params.get('orderId') || '';
        if (!orderId) return false;
        const res = await fetch('/api/payments/dpo/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ orderId })
        }).then((r) => r.json()).catch(() => null);
        return Boolean(res?.outcome === 'success' || res?.paymentStatus === 'paid');
      }).catch(() => false);
      if (verifiedPaid) {
        const orderId = new URL(page.url()).searchParams.get('orderId') || '';
        await page.goto(`${SITE}/orders/order-success.html?orderId=${encodeURIComponent(orderId)}`, {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });
        break;
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1000);
  }

  if (!/order-success\.html/i.test(page.url())) {
    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 500);
    throw new Error(`Expected order-success after DPO, landed on ${page.url()} body=${body}`);
  }
}

const VIEWPORTS = {
  buyNow: { width: 390, height: 844, isMobile: true, hasTouch: true },
  addToCart: { width: 768, height: 1024, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 800, isMobile: false, hasTouch: false }
};

async function selectVariantInModal(page) {
  await page.waitForSelector('.product-config-modal.is-open, [data-config-submit-action]', { timeout: 30000 });
  const color = page.locator('.pcm-color-tile:not(.is-disabled)').first();
  if (await color.count()) {
    await color.click({ force: true });
  }
  const size = page.locator('.pcm-size-chip:not(.is-disabled)').first();
  if (await size.count()) {
    await size.click({ force: true });
  }
}

async function startFromProductDetails(page, flow, payload) {
  await page.goto(`${SITE}/details/product-details1.html?id=${encodeURIComponent(payload.id)}&cb=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });
  await page.waitForFunction(() => {
    const title = document.getElementById('productName')?.textContent || '';
    const missing = /product not found/i.test(document.body?.innerText || '');
    return missing || (title.trim() && title.trim() !== 'Product Name');
  }, { timeout: 60000 });
  const bodyText = await page.locator('body').innerText();
  if (/product not found/i.test(bodyText)) {
    throw new Error(`${flow}: product ${payload.id} not found on Product Details`);
  }

  const sticky = flow === 'buyNow' ? page.locator('#stickyBuyNowBtn') : page.locator('#stickyAddToCartBtn');
  const primary = flow === 'buyNow' ? page.locator('#buyNowBtn') : page.locator('#addToCartBtn');
  if (await sticky.isVisible().catch(() => false)) {
    await sticky.click({ force: true });
  } else {
    await primary.click({ force: true });
  }

  if (await page.locator('[data-config-submit-action]').count()) {
    await selectVariantInModal(page);
    const submit = page.locator(`[data-config-submit-action="${flow === 'buyNow' ? 'buy' : 'add'}"]`).first();
    await submit.click({ force: true });
  }

  if (flow === 'buyNow') {
    await page.waitForURL(/orders\/shipping\.html/i, { timeout: 60000 });
    return;
  }

  await page.waitForTimeout(800);
  await page.goto(`${SITE}/cart.html?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const cartText = await page.locator('#cartItems').innerText();
  const sizeHint = String(payload.sizeLabel || payload.sizeValue || '');
  if (sizeHint && !cartText.includes(sizeHint) && !/Size/i.test(cartText)) {
    throw new Error(`${flow}: cart missing size ${sizeHint}: ${cartText.slice(0, 300)}`);
  }
  const checkoutBtn = page.locator('#checkoutBtn, #stickyCheckoutBtn').first();
  await checkoutBtn.click({ force: true });
  await page.waitForURL(/orders\/shipping\.html/i, { timeout: 60000 });
}

async function runFlow(browser, flow, payload) {
  const viewport = VIEWPORTS[flow] || VIEWPORTS.desktop;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await context.addInitScript(() => {
    try {
      if (sessionStorage.getItem('__byose_prod_e2e_seeded') === '1') return;
      sessionStorage.setItem('__byose_prod_e2e_seeded', '1');
    } catch {}
    localStorage.removeItem('byose_checkout_draft_v1');
    localStorage.removeItem('byose_checkout_confirmation_v1');
    localStorage.removeItem('byose_market_cart_v1');
    localStorage.removeItem('byose_checkout_active_v1');
    localStorage.removeItem('byose_direct_checkout');
    try {
      sessionStorage.removeItem('byose_checkout_handoff_v1');
      sessionStorage.removeItem('byose_checkout_step1_commit_v1');
      sessionStorage.removeItem('byose_checkout_confirmation_v1');
    } catch {}
  });

  await startFromProductDetails(page, flow, payload);
  if (!/shipping\.html/i.test(page.url())) {
    throw new Error(`${flow}: expected shipping after product action, landed on ${page.url()}`);
  }
  await page.waitForFunction(() => window.__ckStep === 'shipping', { timeout: 60000 });
  const shippingHtml = await page.content();
  if (/Delivery Method|Home Delivery|Choose delivery option/i.test(shippingHtml)) {
    throw new Error(`${flow}: Delivery Method section still present on shipping`);
  }
  if (!/Landmark \/ Note/i.test(shippingHtml) || !/\(optional\)/i.test(shippingHtml)) {
    throw new Error(`${flow}: Landmark/GPS optional labeling missing`);
  }
  for (const [name, value] of Object.entries(SHIPPING)) {
    // eslint-disable-next-line no-await-in-loop
    await page.fill(`input[name="${name}"]`, value);
  }
  await page.evaluate(() => {
    const form = document.getElementById('shippingForm');
    if (form?.requestSubmit) form.requestSubmit();
    else document.getElementById('shippingContinueBtn')?.click();
  });
  await page.waitForURL(/checkout\.html/, { timeout: 60000 });
  await page.waitForFunction(() => window.__ckStep === 'review', { timeout: 30000 });
  const summary = await page.locator('#shippingSummary').innerText();
  const productText = await page.locator('#productList').innerText();
  const reviewTotals = await page.locator('#totalsBlock .ck-totals').innerText();
  if (/3,?500/.test(reviewTotals)) {
    throw new Error(`${flow}: Review still includes 3,500 RWF: ${reviewTotals}`);
  }
  if (!/2,?000/.test(reviewTotals)) {
    throw new Error(`${flow}: Review missing 2,000 RWF delivery fee: ${reviewTotals}`);
  }

  await page.evaluate(() => {
    document.getElementById('reviewContinueBtn')?.click();
  });
  await page.waitForURL(/payment\.html/, { timeout: 60000 });
  await page.waitForFunction(() => window.__ckStep === 'payment', { timeout: 30000 });
  const paymentTotals = await page.locator('#totalsBlock .ck-totals, .ck-payment-totals .ck-totals, .ck-totals').first().innerText().catch(() => '');
  if (/3,?500/.test(paymentTotals)) {
    throw new Error(`${flow}: Payment still includes 3,500 RWF: ${paymentTotals}`);
  }

  let createdOrderId = '';
  let orderError = '';
  let paymentUrl = '';
  let initiateOk = false;
  let retriedInitiate = false;

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
        paymentUrl = String(body?.paymentUrl || body?.redirectUrl || '').trim();
        createdOrderId = createdOrderId || String(body?.orderId || '').trim();
      }
    } catch {}
  });

  await page.waitForSelector('input[name="paymentMethod"]', { timeout: 60000 });
  await page.waitForFunction(() => {
    const methods = Array.from(document.querySelectorAll('input[name="paymentMethod"]')).map((el) => el.value);
    return methods.includes('dpo') || methods.includes('cod') || methods.includes('mtn');
  }, { timeout: 60000 });
  await page.waitForTimeout(800);

  const dpoRadio = page.locator('input[name="paymentMethod"][value="dpo"]');
  if (await dpoRadio.count()) {
    await dpoRadio.click({ force: true });
  } else {
    throw new Error(`${flow}: DPO payment method not available (${await page.locator('input[name="paymentMethod"]').evaluateAll((els) => els.map((el) => el.value))})`);
  }

  await page.locator('#placeOrderBtn').click({ force: true, noWaitAfter: true });

  for (let i = 0; i < 80; i += 1) {
    if ((createdOrderId && paymentUrl) || orderError) break;
    const href = page.url();
    if (/3gdirectpay|payv3\.php/i.test(href)) {
      paymentUrl = paymentUrl || href;
      break;
    }
    const message = (await page.locator('#message').innerText().catch(() => '')).trim();
    if (message && !/redirect|secure payment|starting/i.test(message)) {
      orderError = message;
      break;
    }
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(500);
  }

  if (orderError) {
    if (/timed out|timeout|ECONNRESET|503|502/i.test(orderError) && !retriedInitiate) {
      retriedInitiate = true;
      console.warn(`${flow}: retrying Place Order after initiate error: ${orderError}`);
      orderError = '';
      createdOrderId = '';
      paymentUrl = '';
      initiateOk = false;
      await page.goto(`${SITE}/orders/payment.html?cb=${Date.now()}`, {
        waitUntil: 'domcontentloaded',
        timeout: 120000
      });
      await page.waitForFunction(() => window.__ckStep === 'payment', { timeout: 60000 });
      await page.waitForSelector('input[name="paymentMethod"][value="dpo"]', { timeout: 60000 });
      await page.click('input[name="paymentMethod"][value="dpo"]', { force: true });
      await page.locator('#placeOrderBtn').click({ force: true, noWaitAfter: true });
      for (let i = 0; i < 80; i += 1) {
        if ((createdOrderId && paymentUrl) || orderError) break;
        const href = page.url();
        if (/3gdirectpay|dpopayment|payv3\.php/i.test(href)) {
          paymentUrl = paymentUrl || href;
          break;
        }
        const message = (await page.locator('#message').innerText().catch(() => '')).trim();
        if (message && !/redirect|secure payment|starting/i.test(message)) {
          orderError = message;
          break;
        }
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(500);
      }
      if (orderError) throw new Error(`${flow}: ${orderError}`);
    } else {
      throw new Error(`${flow}: ${orderError}`);
    }
  }
  if (!createdOrderId) {
    throw new Error(`${flow}: missing orderId after Place Order`);
  }
  if (!paymentUrl) {
    // Browser may already have navigated; use current URL.
    if (/3gdirectpay|payv3\.php/i.test(page.url())) {
      paymentUrl = page.url();
    } else {
      throw new Error(`${flow}: missing DPO paymentUrl after initiate`);
    }
  }

  await completeDpoSandboxPayment(page, paymentUrl);

  const successText = await page.locator('body').innerText();
  const successOk = /Order Placed!|Payment Successful!/i.test(successText) && successText.includes(createdOrderId);

  // Confirm backend paid status as well.
  const verified = await fetch(`${SITE}/api/payments/dpo/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ orderId: createdOrderId })
  }).then((r) => r.json()).catch(() => null);

  await context.close();

  if (errors.length) {
    throw new Error(`${flow} pageerrors: ${errors.join(' | ')}`);
  }
  if (!successOk) {
    throw new Error(`${flow}: success page missing Order Placed / orderId. Snippet: ${successText.slice(0, 400)}`);
  }
  if (!(verified?.outcome === 'success' || verified?.paymentStatus === 'paid')) {
    throw new Error(`${flow}: backend not paid after success page (${verified?.outcome || verified?.message || 'unknown'})`);
  }

  return {
    flow,
    viewport: `${viewport.width}x${viewport.height}`,
    orderId: createdOrderId,
    initiateOk,
    summary: summary.slice(0, 180),
    productText: productText.slice(0, 180),
    successHasOrder: true,
    successSnippet: successText.slice(0, 280),
    dpoPaid: true,
    paymentStatus: verified.paymentStatus,
    dpoOutcome: verified.outcome
  };
}

const inStock = await listInStockProducts();
if (inStock.length < 1) {
  throw new Error('No in-stock variant products on production');
}

inStock.sort((a, b) => maxVariantStock(b) - maxVariantStock(a));
const auditProduct = inStock.find((row) => (
  /PRECIOUS|Breathable Sports Walking Sneakers/i.test(String(row.name || ''))
  || String(row.id) === '12012'
  || String(row.catalogId) === '12012'
)) || inStock[0];

const browser = await chromium.launch({
  headless: true,
  channel: process.env.BYOSE_PW_CHANNEL || 'chrome'
});
const results = [];

const buyNowProduct = auditProduct;
const addToCartProduct = auditProduct;
const flowFilter = String(process.env.BYOSE_E2E_FLOW || '').trim();
const flows = [
  { name: 'buyNow', product: buyNowProduct },
  { name: 'addToCart', product: addToCartProduct }
].filter((entry) => !flowFilter || entry.name === flowFilter);

for (const entry of flows) {
  // Refresh stock snapshot before each flow.
  // eslint-disable-next-line no-await-in-loop
  const freshList = await listInStockProducts();
  freshList.sort((a, b) => maxVariantStock(b) - maxVariantStock(a));
  const product = freshList.find((row) => String(row.id) === String(entry.product.id))
    || freshList[0];
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
