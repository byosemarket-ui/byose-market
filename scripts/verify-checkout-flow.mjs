/**
 * Full checkout E2E verification:
 * Shipping → Review → Payment → Order Success → Admin Orders API
 * Run: BYOSE_SITE_ORIGIN=http://127.0.0.1:5000 node scripts/verify-checkout-flow.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = (process.env.BYOSE_SITE_ORIGIN || "http://127.0.0.1:5000").replace(/\/+$/, "");
const PRODUCTION = (process.env.BYOSE_PRODUCTION_ORIGIN || "https://byosemarket.com").replace(/\/+$/, "");
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "verification-artifacts", "checkout-flow");

const VIEWPORTS = [
  { id: "android-phone", width: 360, height: 780, isMobile: true },
  { id: "iphone-14", width: 390, height: 844, isMobile: true },
  { id: "ipad", width: 820, height: 1180, isMobile: false },
  { id: "laptop", width: 1366, height: 768, isMobile: false },
  { id: "desktop", width: 1920, height: 1080, isMobile: false }
];

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { headers: { Accept: "application/json" }, ...options });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function installStorefrontIsolation(context) {
  await context.route(/\/api\/storefront\/state/i, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: false, message: "isolated for checkout verification" })
    });
  });
}

async function installProductionCatalogProxy(context) {
  const isLocal = /localhost|127\.0\.0\.1/i.test(SITE);
  if (!isLocal) return;

  const catalog = await fetchJson(`${PRODUCTION}/api/products?limit=500`);
  const payload = JSON.stringify(catalog.body || { products: [] });

  await context.addInitScript(() => {
    window.BYOSE_API_BASE_URL = `${window.location.origin}/api`;
    window.__BYOSE_API_BASE__ = `${window.location.origin}/api`;
  });

  await context.route(/\/api\/products/i, async (route) => {
    await route.fulfill({
      status: catalog.status || 200,
      contentType: "application/json",
      body: payload
    });
  });
}

function pickProduct(products) {
  return products.find((product) => {
    const variants = product?.variants?.colorVariants || product?.metadata?.colorVariants;
    return Array.isArray(variants) && variants.length;
  }) || products[0] || null;
}

function buildCartItem(product) {
  const productId = String(product?.id || product?.catalogId || "5");
  const colorVariants = product?.variants?.colorVariants || product?.metadata?.colorVariants || [];
  const firstColor = colorVariants[0] || {};
  const firstSize = Array.isArray(firstColor.sizes) ? firstColor.sizes.find((row) => Number(row.stock) > 0) : null;
  return {
    id: productId,
    productId,
    name: product?.name || "Product",
    price: Number(product?.price || 0),
    qty: 1,
    quantity: 1,
    image: firstColor?.image || product?.image || "",
    colorImage: firstColor?.image || product?.image || "",
    productImage: product?.image || "",
    color: firstColor?.colorName || firstColor?.name || "",
    colorName: firstColor?.colorName || firstColor?.name || "",
    size: firstSize?.size || firstSize?.label || "",
    sizeLabel: firstSize?.size || firstSize?.label || "",
    variantKey: `${firstColor?.colorName || "default"}::${firstSize?.size || "default"}`,
    sku: firstSize?.sku || product?.sku || "",
    stock: Number(firstSize?.stock || product?.stock || 99) || 99,
    availableStock: Number(firstSize?.stock || product?.stock || 99) || 99,
    total: Number(product?.price || 0)
  };
}

async function seedCartState(context, product) {
  const cartItem = buildCartItem(product);
  await context.addInitScript((item) => {
    window.ByoseStorefrontSync = { hydrate: async () => null, isManagedKey: () => false };
    if (window.__ckTestSeeded) return;
    window.__ckTestSeeded = true;
    localStorage.setItem('byose_direct_checkout', JSON.stringify(item));
    localStorage.removeItem('byose_checkout_draft_v1');
    localStorage.removeItem('byose_checkout_confirmation_v1');
  }, cartItem);
  return cartItem;
}

async function clickContinue(page, primarySelector) {
  const primary = page.locator(primarySelector);
  if (await primary.count()) {
    await primary.click({ force: true });
    return;
  }
  await page.locator('#stickyContinueBtn').click({ force: true });
}

async function verifyViewport(browser, viewport, product, { useRealOrderApi = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile,
    geolocation: { latitude: -1.9441, longitude: 30.0619 },
    permissions: ["geolocation"]
  });
  context.setDefaultTimeout(120000);
  await installProductionCatalogProxy(context);
  await installStorefrontIsolation(context);
  const cartItem = await seedCartState(context, product);
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error(`[${viewport.id}] pageerror:`, err.message));
  const checks = {};

  await page.goto(`${SITE}/orders/shipping.html`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.evaluate((item) => {
    if (!window.__ckTestSeeded) {
      window.__ckTestSeeded = true;
      localStorage.setItem('byose_direct_checkout', JSON.stringify(item));
      localStorage.removeItem('byose_checkout_draft_v1');
    }
    window.ByoseStorefrontSync = { hydrate: async () => null, isManagedKey: () => false };
  }, cartItem);
  await page.waitForSelector("#shippingContinueBtn", { state: "attached", timeout: 60000 });

  checks.shippingProgress = await page.locator(".ck-step.is-active strong").textContent();
  checks.shippingForm = await page.locator("#shippingForm input[name='fullName']").count() > 0;
  checks.shippingGps = await page.locator(".ck-gps-card").count() > 0;
  checks.shippingSticky = viewport.width < 900
    ? await page.locator(".ck-sticky .ck-btn--primary").count() > 0
    : await page.locator(".ck-sidebar-card").count() > 0;

  const bodyWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  checks.noHorizontalScrollShipping = bodyWidth <= viewport.width + 2;

  await page.fill('input[name="fullName"]', "Test Buyer");
  await page.fill('input[name="phone"]', "0781234567");
  await page.fill('input[name="provinceCity"]', "Kigali City");
  await page.fill('input[name="district"]', "Gasabo");
  await page.fill('input[name="sector"]', "Kimironko");
  await page.fill('input[name="cell"]', "Bibare");
  await page.fill('input[name="village"]', "Test Village");

  await clickContinue(page, "#shippingContinueBtn");
  await page.waitForURL(/checkout\.html/, { timeout: 120000, waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__ckStep === 'review', { timeout: 120000 });
  await page.waitForSelector("#reviewContinueBtn", { state: "attached", timeout: 30000 });

  checks.reviewProgress = await page.locator(".ck-step.is-active strong").textContent();
  checks.reviewProducts = await page.locator(".ck-product").count();
  checks.reviewShipping = await page.locator(".ck-card").count() > 0;
  checks.reviewTotals = await page.locator(".ck-totals").count() > 0;
  checks.reviewDelivery = await page.locator(".ck-delivery-toggle").count() > 0;

  const reviewBodyWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  checks.noHorizontalScrollReview = reviewBodyWidth <= viewport.width + 2;

  await clickContinue(page, "#reviewContinueBtn");
  await page.waitForURL(/payment\.html/, { timeout: 120000, waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__ckStep === 'payment', { timeout: 120000 });

  checks.paymentProgress = await page.locator(".ck-step.is-active strong").textContent();
  checks.paymentMethods = await page.locator(".ck-pay-option").count();
  checks.paymentPhone = await page.locator('input[name="paymentPhone"]').count() > 0;

  await page.locator('input[name="paymentMethod"][value="mtn"]').click({ force: true });
  await page.fill('input[name="paymentPhone"]', "0781234567");

  const paymentBodyWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  checks.noHorizontalScrollPayment = paymentBodyWidth <= viewport.width + 2;

  let orderPayload = null;
  if (!useRealOrderApi) {
    await page.route(/\/api\/orders/i, async (route) => {
      if (route.request().method() === "POST") {
        orderPayload = JSON.parse(route.request().postData() || "{}");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, order: { ...orderPayload, id: orderPayload.orderId } })
        });
        return;
      }
      await route.continue();
    });
  } else {
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/api\/orders/i.test(req.url())) {
        try { orderPayload = JSON.parse(req.postData() || "{}"); } catch (_) { /* ignore */ }
      }
    });
  }

  const navToSuccess = page.waitForURL(/order-success\.html/, { timeout: 120000, waitUntil: 'domcontentloaded' });
  await clickContinue(page, "#placeOrderBtn");
  await navToSuccess;

  checks.successPage = await page.locator(".ck-success-icon").count() > 0;
  checks.successOrderId = (await page.content()).includes("Order ID");

  checks.orderPayloadValid = Boolean(
    orderPayload?.orderId
    && Array.isArray(orderPayload?.items) && orderPayload.items.length > 0
    && orderPayload.customerName
    && orderPayload.customerPhone
    && orderPayload.shippingAddress
    && orderPayload.gpsLocation
    && orderPayload.paymentMethod
  );
  checks.orderHasProductMeta = orderPayload?.items?.some((i) => i.productName && i.price >= 0);

  await page.screenshot({ path: join(OUT_DIR, `success-${viewport.id}.png`), fullPage: false });
  await context.close();

  const passed = Object.entries(checks).every(([key, value]) => {
    if (key.startsWith("noHorizontalScroll")) return value === true;
    if (key.endsWith("Progress")) return typeof value === "string" && value.length > 0;
    if (key === "reviewProducts") return Number(value) >= 1;
    if (key === "paymentMethods") return Number(value) >= 4;
    return Boolean(value);
  });

  return { id: viewport.id, passed, checks, orderId: orderPayload?.orderId, useRealOrderApi };
}

async function verifyAdminOrders(orderId) {
  if (!orderId) return { adminOk: false, reason: "no order id" };

  const adminRes = await fetchJson(`${SITE}/api/admin/orders?limit=50`);
  if (adminRes.status === 401 || adminRes.status === 403) {
    return { adminOk: true, skipped: true, reason: "admin auth required" };
  }

  const orders = Array.isArray(adminRes.body?.orders) ? adminRes.body.orders : [];
  const found = orders.some((o) => String(o.orderId || o.id) === String(orderId));
  return { adminOk: found, orderCount: orders.length, found };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const catalog = await fetchJson(`${PRODUCTION}/api/products?limit=500`);
  const products = Array.isArray(catalog.body?.products) ? catalog.body.products : [];
  const product = pickProduct(products);

  if (!product) {
    console.error("No product available for checkout verification.");
    process.exit(1);
  }

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (error) {
    console.error("Playwright unavailable:", error.message);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const results = [];
  let persistedOrderId = null;

  for (let i = 0; i < VIEWPORTS.length; i += 1) {
    const viewport = VIEWPORTS[i];
    const useRealOrderApi = i === VIEWPORTS.length - 1;
    const result = await verifyViewport(browser, viewport, product, { useRealOrderApi });
    results.push(result);
    if (useRealOrderApi && result.orderId) persistedOrderId = result.orderId;
    console.log(`${result.passed ? "PASS" : "FAIL"} ${viewport.id}`, result.checks);
  }

  await browser.close();

  const adminCheck = await verifyAdminOrders(persistedOrderId);

  const report = {
    generatedAt: new Date().toISOString(),
    site: SITE,
    productId: product?.id || product?.catalogId,
    results,
    adminCheck,
    persistedOrderId,
    allPassed: results.every((row) => row.passed)
  };

  await writeFile(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));

  if (!report.allPassed) {
    console.error("Checkout flow verification FAILED.");
    process.exit(1);
  }

  if (adminCheck.skipped) {
    console.log("Checkout flow verification passed. Admin check skipped (auth required).");
  } else if (!adminCheck.adminOk) {
    console.error("Checkout UI passed but order not found in admin API.", adminCheck);
    process.exit(1);
  } else {
    console.log("Checkout flow verification passed. Admin order found:", persistedOrderId);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
