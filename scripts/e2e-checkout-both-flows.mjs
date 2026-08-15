/**
 * Local STEP 1 E2E: Add to Cart + Buy Now through Product Details → Checkout → DPO TEST → Success.
 * Also verifies SQLite order/payment records used by Admin.
 *
 * Run:
 *   node scripts/seed-local-variant-product.mjs
 *   BYOSE_SITE_ORIGIN=http://127.0.0.1:5000 node scripts/e2e-checkout-both-flows.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildVariantCartPayload,
  validateVariantSelection
} from '../js/variant-cart-payload.js';
import { enrichProductColorVariants } from '../js/color-variant-inventory.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const SITE = (process.env.BYOSE_SITE_ORIGIN || 'http://127.0.0.1:5000').replace(/\/+$/, '');
if (/byosemarket\.com/i.test(SITE)) {
  throw new Error('Refusing to run DPO TEST sandbox E2E against production LIVE.');
}
const PRODUCT_ID = String(process.env.BYOSE_E2E_PRODUCT_ID || '12012');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SHIPPING = {
  fullName: 'E2E Test Buyer',
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

const VIEWPORTS = {
  buyNow: { width: 390, height: 844, isMobile: true, hasTouch: true },
  addToCart: { width: 768, height: 1024, isMobile: true, hasTouch: true },
  desktopLayout: { width: 1280, height: 800, isMobile: false, hasTouch: false }
};

function absolutize(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `${SITE}${value}`;
  return `${SITE}/${value.replace(/^\/+/, '')}`;
}

async function fetchProduct(productId) {
  const response = await fetch(`${SITE}/api/products/${productId}`);
  const body = await response.json().catch(() => null);
  const product = body?.product || body?.data || body;
  if (!response.ok || !product?.id) {
    const list = await fetch(`${SITE}/api/products?limit=200`).then((r) => r.json());
    return (list.products || []).find((row) => String(row.id) === String(productId) || String(row.catalogId) === String(productId));
  }
  return product;
}

function buildPayload(product) {
  const enriched = enrichProductColorVariants(product, absolutize);
  const colors = enriched?.variants?.colorVariants || enriched?.metadata?.colorVariants || [];
  const color = colors.find((entry) => (entry.sizes || []).some((size) => Number(size.stock) > 0)) || colors[0];
  const size = (color?.sizes || []).find((row) => Number(row.stock) > 0) || color?.sizes?.[0];
  if (!color || !size) {
    throw new Error('Seeded product has no in-stock color/size');
  }
  const attributes = { Color: color.id, Size: size.value || size.size };
  const validation = validateVariantSelection(enriched, attributes);
  if (!validation.valid) {
    throw new Error(`Variant validation failed: ${validation.message}`);
  }
  return buildVariantCartPayload(enriched, 1, attributes);
}

function restoreSeedStock() {
  const result = spawnSync(process.execPath, ['scripts/seed-local-variant-product.mjs'], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`Failed to re-seed stock: ${result.stderr || result.stdout}`);
  }
}

function readOrderFromDb(orderId) {
  const db = new Database(path.join(ROOT, 'server/database/byosemarket.sqlite'), { readonly: true });
  try {
    const order = db.prepare(`
      SELECT order_id, customer_name, customer_phone, payment_status, payment_status_label,
             payment_method, delivery_fee, total_amount, payment_json, shipping_address_json
      FROM orders
      WHERE order_id = ?
      LIMIT 1
    `).get(orderId);
    if (!order) return null;
    const items = db.prepare(`
      SELECT product_catalog_id, product_name, quantity, price, color, size, attributes_json
      FROM order_items
      WHERE order_id = (SELECT id FROM orders WHERE order_id = ? LIMIT 1)
      ORDER BY sort_order ASC
    `).all(orderId);
    let payment = {};
    try { payment = JSON.parse(order.payment_json || '{}'); } catch { payment = {}; }
    return { ...order, items, payment };
  } finally {
    db.close();
  }
}

function assertAdminRecord(orderId, payload) {
  const row = readOrderFromDb(orderId);
  if (!row) {
    throw new Error(`Admin/DB missing order ${orderId}`);
  }
  const paid = String(row.payment_status || '').toLowerCase() === 'paid';
  if (!paid) {
    throw new Error(`Admin/DB order ${orderId} is not paid (${row.payment_status})`);
  }
  const item = row.items?.[0] || {};
  const catalogId = String(item.product_catalog_id || '');
  if (catalogId && catalogId !== String(payload.productId || payload.id)) {
    throw new Error(`Admin/DB productId mismatch: ${catalogId} vs ${payload.productId || payload.id}`);
  }
  const size = String(item.size || '');
  if (payload.sizeLabel && size && !size.includes(String(payload.sizeLabel)) && !String(payload.sizeLabel).includes(size)) {
    throw new Error(`Admin/DB size mismatch: ${size} vs ${payload.sizeLabel}`);
  }
  const transRef = String(
    row.payment?.gateway?.transRef
    || row.payment?.transaction?.reference
    || row.payment?.reference
    || ''
  ).trim();
  if (!transRef) {
    throw new Error(`Admin/DB missing DPO transaction reference for ${orderId}`);
  }
  if (Number(row.delivery_fee) !== 2000) {
    throw new Error(`Admin/DB delivery fee is ${row.delivery_fee}, expected 2000`);
  }
  return {
    orderId: row.order_id,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
    transRef,
    productId: catalogId,
    size,
    color: item.color,
    quantity: item.quantity,
    total: row.total_amount
  };
}

async function assertOrderAcceptsPayload(payload) {
  const orderId = `E2E-API-${Date.now()}`;
  const item = {
    productId: String(payload.productId || payload.id),
    productName: payload.name,
    quantity: 1,
    price: Number(payload.price || 0),
    colorName: payload.colorName,
    colorId: payload.colorId,
    sizeLabel: payload.sizeLabel,
    sizeValue: payload.sizeValue,
    variantKey: payload.variantKey,
    attributes: payload.attributes
  };
  const prefixed = {
    ...item,
    sizeLabel: `Size ${item.sizeLabel}`,
    size: `Size ${item.sizeLabel}`
  };

  for (const [label, line] of [['canonical', item], ['size-prefixed', prefixed]]) {
    const id = `${orderId}-${label}`;
    const order = {
      orderId: id,
      id,
      customerName: SHIPPING.fullName,
      customerPhone: '+250781234567',
      shippingAddress: { ...SHIPPING, phone: '+250781234567', country: 'Rwanda' },
      items: [line],
      products: [line],
      subtotal: line.price,
      deliveryFee: 2000,
      shippingFee: 2000,
      total: line.price + 2000,
      totalAmount: line.price + 2000,
      paymentMethod: 'card',
      paymentStatus: 'awaiting_payment',
      payment: { method: 'card' },
      deliveryMethod: 'homeDelivery'
    };
    const response = await fetch(`${SITE}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(order)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) {
      throw new Error(`API order ${label} failed: ${response.status} ${body.message || ''}`);
    }
    console.log(`PASS api-order:${label}`, id);
  }
  restoreSeedStock();
}

async function assertDpoConfigReady() {
  const config = await fetch(`${SITE}/api/payments/dpo/config`).then((r) => r.json()).catch(() => null);
  if (!config?.success || !config?.dpo?.enabled) {
    throw new Error(`DPO TEST is not enabled locally: ${config?.dpo?.enabled === false ? 'disabled' : (config?.message || 'config unavailable')}`);
  }
  console.log('PASS dpo-config', { enabled: true, mode: config.dpo.mode || 'test' });
}

async function fillShipping(page) {
  for (const [name, value] of Object.entries(SHIPPING)) {
    // eslint-disable-next-line no-await-in-loop
    await page.fill(`input[name="${name}"]`, value);
  }
}

async function completeDpoSandboxPayment(page, paymentUrl) {
  await page.goto(paymentUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#cerditcarAtag, a.nav-link:has-text("DEBIT/CREDIT CARD"), #TRANSCreditnum', { timeout: 60000 });

  await page.evaluate((card) => {
    const tab = document.getElementById('cerditcarAtag')
      || Array.from(document.querySelectorAll('a.nav-link')).find((el) => /debit|credit card/i.test(el.textContent || ''));
    tab?.click();
    document.querySelectorAll('#creditcard, #cerditcard, .tab-pane').forEach((pane) => {
      if (pane.querySelector('#TRANSCreditnum')) {
        pane.style.display = 'block';
        pane.classList.add('active', 'show', 'in');
        pane.classList.remove('fade');
      }
    });
    const setVal = (id, value) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    };
    setVal('TRANScardholdername', card.name);
    setVal('TRANSCreditnum', card.number);
    setVal('TRANSexpiryM', '12');
    setVal('TRANSexpiryY', '2030');
    setVal('TRANScvv', card.cvv);
    document.querySelectorAll('#terms-approval_creditcard').forEach((el) => {
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('click', { bubbles: true }));
    });
  }, DPO_TEST_CARD);
  await page.waitForTimeout(600);

  const continueBtn = page.locator('button:has-text("CONTINUE TO PAY")').last();
  if (!(await continueBtn.count())) {
    throw new Error('DPO CONTINUE TO PAY button not found');
  }
  await continueBtn.click({ force: true });

  await page.waitForURL(
    (url) => /(order-success|payment-result|\/api\/payments\/dpo\/(return|back))/i.test(url.href),
    { timeout: 180000 }
  );

  for (let i = 0; i < 40; i += 1) {
    const href = page.url();
    if (/order-success\.html/i.test(href)) break;
    if (/payment-result\.html/i.test(href)) {
      const orderId = new URL(page.url()).searchParams.get('orderId') || '';
      if (orderId) {
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

async function startFromProductDetails(page, flow) {
  await page.goto(`${SITE}/details/product-details1.html?id=${encodeURIComponent(PRODUCT_ID)}&cb=${Date.now()}`, {
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
    throw new Error(`${flow}: product ${PRODUCT_ID} not found on Product Details`);
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
  if (!/42|Size/i.test(cartText)) {
    throw new Error(`addToCart cart missing size/variant: ${cartText.slice(0, 300)}`);
  }
  const checkoutBtn = page.locator('#checkoutBtn, #stickyCheckoutBtn').first();
  await checkoutBtn.click({ force: true });
  await page.waitForURL(/orders\/shipping\.html/i, { timeout: 60000 });
}

async function runBrowserFlow(browser, flow, payload) {
  const viewport = VIEWPORTS[flow] || VIEWPORTS.buyNow;
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
      if (sessionStorage.getItem('byose_e2e_storage_cleared')) return;
      sessionStorage.setItem('byose_e2e_storage_cleared', '1');
    } catch {}
    localStorage.removeItem('byose_checkout_draft_v1');
    localStorage.removeItem('byose_checkout_confirmation_v1');
    localStorage.removeItem('byose_market_cart_v1');
    localStorage.removeItem('byose_checkout_active_v1');
    localStorage.removeItem('byose_direct_checkout');
    try {
      sessionStorage.removeItem('byose_checkout_handoff_v1');
      sessionStorage.removeItem('byose_checkout_step1_commit_v1');
    } catch {}
  });

  await startFromProductDetails(page, flow);
  if (!/shipping\.html/i.test(page.url())) {
    throw new Error(`${flow}: expected shipping after product action, landed on ${page.url()}`);
  }
  await page.waitForFunction(() => window.__ckStep === 'shipping', { timeout: 60000 });

  const shippingHtml = await page.content();
  if (/Delivery Method|Home Delivery|deliveryMethodKey/i.test(shippingHtml)) {
    throw new Error(`${flow}: Delivery Method section still present`);
  }
  if (!/Landmark \/ Note/i.test(shippingHtml) || !/\(optional\)/i.test(shippingHtml)) {
    throw new Error(`${flow}: Landmark/GPS optional labeling missing`);
  }

  await fillShipping(page);
  await page.evaluate(() => {
    const form = document.getElementById('shippingForm');
    if (form?.requestSubmit) form.requestSubmit();
    else document.getElementById('shippingContinueBtn')?.click();
  });
  await page.waitForURL(/checkout\.html/, { timeout: 60000 });
  await page.waitForFunction(() => window.__ckStep === 'review', { timeout: 30000 });

  const summary = await page.locator('#shippingSummary').innerText();
  const productText = await page.locator('#productList').innerText();
  const reviewTotals = await page.locator('#totalsBlock .ck-totals, .ck-totals').first().innerText();
  if (/3,?500/.test(reviewTotals)) {
    throw new Error(`${flow}: Review still includes 3,500 RWF: ${reviewTotals}`);
  }
  if (!/2,?000/.test(reviewTotals)) {
    throw new Error(`${flow}: Review missing 2,000 RWF delivery fee: ${reviewTotals}`);
  }
  if (payload.colorName && !productText.includes(payload.colorName.split(' ')[0])) {
    throw new Error(`${flow}: Review missing color. Got: ${productText.slice(0, 200)}`);
  }
  if (payload.sizeLabel && !productText.includes(String(payload.sizeLabel))) {
    throw new Error(`${flow}: Review missing size ${payload.sizeLabel}. Got: ${productText.slice(0, 200)}`);
  }

  const heading = await page.locator('h1').innerText();
  if (!/Review & Pay/i.test(heading)) {
    throw new Error(`${flow}: Review heading missing Review & Pay. Got: ${heading}`);
  }
  const stepLabel = await page.locator('.ck-panel-head p').first().innerText();
  if (!/Step 2 of 2/i.test(stepLabel)) {
    throw new Error(`${flow}: expected Step 2 of 2, got ${stepLabel}`);
  }
  if (await page.locator('#couponBlock, #couponPanel, #couponCodeInput').count()) {
    throw new Error(`${flow}: Coupon UI is still on Review`);
  }
  if (await page.locator('#reviewContinueBtn').count()) {
    throw new Error(`${flow}: Continue to Payment is still on Review`);
  }
  if (!(await page.locator('#codPayBtn, #stickyCodBtn').count())) {
    throw new Error(`${flow}: Cash on Delivery is missing on Review & Pay`);
  }
  if (!(await page.locator('#onlinePayBtn, #stickyOnlineBtn').count())) {
    throw new Error(`${flow}: Online Payment is missing on Review & Pay`);
  }
  const progressText = await page.locator('#progress').innerText();
  if (/Payment/i.test(progressText) && !/Review & Pay/i.test(progressText)) {
    throw new Error(`${flow}: progress still has a separate Payment step: ${progressText}`);
  }
  if (!/Review & Pay/i.test(progressText) || !/Shipping/i.test(progressText)) {
    throw new Error(`${flow}: progress must show Shipping and Review & Pay. Got: ${progressText}`);
  }

  await context.close();
  return {
    flow,
    viewport: `${viewport.width}x${viewport.height}`,
    summary: summary.slice(0, 180),
    productText: productText.slice(0, 200),
    reviewTotals: reviewTotals.replace(/\s+/g, ' ').trim(),
    dpoSkipped: 'step1_review_and_pay_only'
  };
}

async function runDesktopLayoutCheck(browser, payload) {
  const viewport = VIEWPORTS.desktopLayout;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height }
  });
  const page = await context.newPage();
  await context.addInitScript((item) => {
    localStorage.removeItem('byose_market_cart_v1');
    localStorage.removeItem('byose_checkout_active_v1');
    localStorage.setItem('byose_direct_checkout', JSON.stringify(item));
  }, payload);
  await page.goto(`${SITE}/orders/shipping.html?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__ckStep === 'shipping', { timeout: 60000 });
  await fillShipping(page);
  await page.evaluate(() => document.getElementById('shippingForm')?.requestSubmit());
  await page.waitForURL(/checkout\.html/, { timeout: 30000 });
  await page.waitForFunction(() => window.__ckStep === 'review', { timeout: 30000 });
  const stickyVisible = await page.locator('.ck-sticky').isVisible().catch(() => false);
  const backVisible = await page.locator('a[href="shipping.html"]').first().isVisible();
  const continueCount = await page.locator('#reviewContinueBtn').count();
  const codVisible = await page.locator('#codPayBtn').isVisible();
  const onlineVisible = await page.locator('#onlinePayBtn').isVisible();
  const totals = await page.locator('#totalsBlock').innerText();
  const heading = await page.locator('h1').innerText();
  await context.close();
  if (stickyVisible) {
    throw new Error('Desktop review still shows mobile sticky bar');
  }
  if (!backVisible) {
    throw new Error('Desktop review Back to Shipping is not visible');
  }
  if (continueCount) {
    throw new Error('Desktop review still has Continue to Payment');
  }
  if (!codVisible || !onlineVisible) {
    throw new Error('Desktop review must show Cash on Delivery and Online Payment');
  }
  if (!/Review & Pay/i.test(heading)) {
    throw new Error(`Desktop review heading missing Review & Pay: ${heading}`);
  }
  if (!/2,?000/.test(totals)) {
    throw new Error(`Desktop review missing 2,000 fee: ${totals}`);
  }
  console.log('PASS desktop-layout', { backVisible: true, stickyHidden: true, heading });
}

restoreSeedStock();
await assertDpoConfigReady();
const product = await fetchProduct(PRODUCT_ID);
if (!product) {
  throw new Error(`Product ${PRODUCT_ID} not found. Seed first.`);
}
const payload = buildPayload(product);
console.log('Using payload', {
  id: payload.id,
  colorId: payload.colorId,
  colorName: payload.colorName,
  sizeValue: payload.sizeValue,
  sizeLabel: payload.sizeLabel,
  variantKey: payload.variantKey,
  stock: payload.availableStock
});

await assertOrderAcceptsPayload(payload);

const browser = await chromium.launch({
  headless: true,
  channel: process.env.BYOSE_PW_CHANNEL || 'chrome'
});
const results = [];
for (const flow of ['buyNow', 'addToCart']) {
  restoreSeedStock();
  // eslint-disable-next-line no-await-in-loop
  const result = await runBrowserFlow(browser, flow, payload);
  results.push(result);
  console.log(`PASS browser:${flow}`, {
    viewport: result.viewport,
    dpoSkipped: result.dpoSkipped,
    reviewTotals: result.reviewTotals
  });
}

restoreSeedStock();
await runDesktopLayoutCheck(browser, payload);
await browser.close();

console.log(JSON.stringify({ site: SITE, results }, null, 2));
console.log('PASS — both checkout flows reached Review & Pay');
