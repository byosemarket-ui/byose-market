/**
 * Local STEP 1 cart operations: qty change, second variant, remove, totals.
 * Run: BYOSE_SITE_ORIGIN=http://127.0.0.1:5000 node scripts/e2e-cart-operations.mjs
 */
import { chromium } from 'playwright';

const SITE = (process.env.BYOSE_SITE_ORIGIN || 'http://127.0.0.1:5000').replace(/\/+$/, '');
const PRODUCT_ID = String(process.env.BYOSE_E2E_PRODUCT_ID || '12012');

async function selectVariantInModal(page, sizeLabel) {
  await page.waitForSelector('.product-config-modal.is-open, [data-config-submit-action]', { timeout: 30000 });
  const color = page.locator('.pcm-color-tile:not(.is-disabled)').first();
  if (await color.count()) {
    await color.click({ force: true });
  }
  const size = sizeLabel
    ? page.locator('.pcm-size-chip:not(.is-disabled)', { hasText: String(sizeLabel) }).first()
    : page.locator('.pcm-size-chip:not(.is-disabled)').first();
  if (await size.count()) {
    await size.click({ force: true });
  }
}

async function addSizeToCart(page, sizeLabel) {
  await page.goto(`${SITE}/details/product-details1.html?id=${encodeURIComponent(PRODUCT_ID)}&cb=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });
  await page.waitForFunction(() => {
    const title = document.getElementById('productName')?.textContent || '';
    return title.trim() && title.trim() !== 'Product Name';
  }, { timeout: 60000 });

  const sticky = page.locator('#stickyAddToCartBtn');
  const primary = page.locator('#addToCartBtn');
  if (await sticky.isVisible().catch(() => false)) {
    await sticky.click({ force: true });
  } else {
    await primary.click({ force: true });
  }

  if (await page.locator('[data-config-submit-action]').count()) {
    await selectVariantInModal(page, sizeLabel);
    await page.locator('[data-config-submit-action="add"]').first().click({ force: true });
  }
  await page.waitForFunction(() => {
    try {
      return Array.isArray(window.ByoseCart?.getItems?.()) && window.ByoseCart.getItems().length > 0;
    } catch {
      return false;
    }
  }, { timeout: 15000 }).catch(() => {});
}

function parseRwf(text) {
  const digits = String(text || '').replace(/[^\d]/g, '');
  return Number(digits || 0);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.BYOSE_PW_CHANNEL || 'chrome'
  });
  try {
    await runCartOperations(browser);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function runCartOperations(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  await context.addInitScript(() => {
    try {
      if (sessionStorage.getItem('byose_e2e_cart_cleared')) return;
      sessionStorage.setItem('byose_e2e_cart_cleared', '1');
    } catch {}
    localStorage.removeItem('byose_market_cart_v1');
    localStorage.removeItem('byose_checkout_active_v1');
    localStorage.removeItem('byose_direct_checkout');
  });

  await addSizeToCart(page, '42');
  await page.goto(`${SITE}/cart.html?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });

  const firstText = await page.locator('#cartItems').innerText();
  if (!/PRECIOUS|Sneakers/i.test(firstText)) {
    throw new Error(`Cart missing product name: ${firstText.slice(0, 300)}`);
  }
  if (!/\b42\b/.test(firstText)) {
    throw new Error(`Cart missing size 42: ${firstText.slice(0, 300)}`);
  }
  if (!/White/i.test(firstText)) {
    throw new Error(`Cart missing color: ${firstText.slice(0, 300)}`);
  }
  if (!/25,?000/.test(firstText)) {
    throw new Error(`Cart missing unit price: ${firstText.slice(0, 300)}`);
  }

  const snapshot = await page.evaluate(() => {
    const items = window.ByoseCart?.getItems?.() || [];
    return items.map((item) => ({
      productId: item.productId,
      colorId: item.colorId,
      sizeValue: item.sizeValue,
      sizeLabel: item.sizeLabel,
      sku: item.sku || item.variantSku,
      qty: item.qty,
      price: item.price,
      stock: item.stock
    }));
  });
  const line42 = snapshot.find((item) => String(item.sizeValue) === '42' || String(item.sizeLabel) === '42');
  if (!line42) throw new Error(`Cart state missing size 42: ${JSON.stringify(snapshot)}`);
  if (String(line42.productId) !== PRODUCT_ID) {
    throw new Error(`Cart productId ${line42.productId}, expected ${PRODUCT_ID}`);
  }
  if (!line42.colorId) throw new Error('Cart missing colorId');
  if (!line42.sku) throw new Error('Cart missing SKU');
  if (Number(line42.qty) !== 1) throw new Error(`Cart qty ${line42.qty}, expected 1`);
  if (Number(line42.price) !== 25000) throw new Error(`Cart price ${line42.price}, expected 25000`);

  await page.locator('[data-action="inc"]').first().click({ force: true });
  await page.waitForTimeout(300);
  const qty2 = await page.evaluate(() => window.ByoseCart.getItems()[0]?.qty);
  if (Number(qty2) !== 2) throw new Error(`Qty increment failed, got ${qty2}`);
  const subtotal2 = parseRwf(await page.locator('#summarySubtotal').innerText());
  if (subtotal2 !== 50000) throw new Error(`Qty 2 subtotal ${subtotal2}, expected 50000`);

  await page.locator('[data-action="dec"]').first().click({ force: true });
  await page.waitForTimeout(300);
  const qty1 = await page.evaluate(() => window.ByoseCart.getItems()[0]?.qty);
  if (Number(qty1) !== 1) throw new Error(`Qty decrement failed, got ${qty1}`);

  await addSizeToCart(page, '43');
  await page.goto(`${SITE}/cart.html?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const twoLines = await page.evaluate(() => window.ByoseCart.getItems().map((item) => ({
    size: item.sizeValue || item.sizeLabel,
    qty: item.qty,
    price: item.price,
    productId: item.productId
  })));
  if (twoLines.length !== 2) {
    throw new Error(`Expected 2 cart lines after adding size 43, got ${JSON.stringify(twoLines)}`);
  }
  const sizes = twoLines.map((item) => String(item.size)).sort();
  if (sizes.join(',') !== '42,43') {
    throw new Error(`Expected sizes 42 and 43, got ${sizes.join(',')}`);
  }
  const subtotalBoth = parseRwf(await page.locator('#summarySubtotal').innerText());
  if (subtotalBoth !== 50000) throw new Error(`Two-line subtotal ${subtotalBoth}, expected 50000`);
  const shipping = parseRwf(await page.locator('#summaryShipping').innerText());
  if (shipping !== 2000) throw new Error(`Cart shipping ${shipping}, expected 2000`);
  const total = parseRwf(await page.locator('#summaryTotal').innerText());
  if (total !== 52000) throw new Error(`Cart total ${total}, expected 52000`);

  const remove43 = page.locator('.cart-item').filter({ hasText: '43' }).locator('[data-action="remove"]');
  await remove43.click({ force: true });
  await page.waitForTimeout(300);
  const afterRemove = await page.evaluate(() => window.ByoseCart.getItems().map((item) => item.sizeValue || item.sizeLabel));
  if (afterRemove.length !== 1 || String(afterRemove[0]) !== '42') {
    throw new Error(`After remove expected only size 42, got ${JSON.stringify(afterRemove)}`);
  }

  await context.close();
  console.log('PASS cart-operations', {
    productId: PRODUCT_ID,
    qtyChange: true,
    secondVariant: true,
    remove: true,
    totals: { subtotal: 50000, shipping: 2000, total: 52000 }
  });
}

main().catch((error) => {
  console.error('FAIL cart-operations:', error.message);
  process.exit(1);
});
