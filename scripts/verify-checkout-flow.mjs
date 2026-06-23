/**
 * Checkout flow UX verification — shipping → review → payment.
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
  { id: "laptop", width: 1366, height: 768, isMobile: false }
];

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
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
  if (!isLocal) {
    return;
  }

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

async function seedCartState(context, product) {
  const productId = String(product?.id || product?.catalogId || "5");
  const colorVariants = product?.variants?.colorVariants || product?.metadata?.colorVariants || [];
  const firstColor = colorVariants[0] || {};
  const firstSize = Array.isArray(firstColor.sizes) ? firstColor.sizes.find((row) => Number(row.stock) > 0) : null;

  await context.addInitScript(({ productId, product, firstColor, firstSize }) => {
    const originalAssign = window.location.assign.bind(window.location);
    window.location.assign = function assignOverride(url) {
      if (String(url || "").includes("cart")) {
        return;
      }
      return originalAssign(url);
    };

    window.ByoseStorefrontSync = {
      hydrate: async () => null,
      isManagedKey: () => false
    };

    const cartItem = {
      id: productId,
      productId,
      name: product?.name || "Product",
      price: Number(product?.price || 0),
      qty: 1,
      image: firstColor?.image || product?.image || "",
      colorImage: firstColor?.image || product?.image || "",
      color: firstColor?.colorName || firstColor?.name || "",
      size: firstSize?.size || "",
      variantKey: `${firstColor?.colorName || "default"}::${firstSize?.size || "default"}`,
      sku: firstSize?.sku || product?.sku || "",
      stock: Number(firstSize?.stock || product?.stock || 99) || 99,
      availableStock: Number(firstSize?.stock || product?.stock || 99) || 99,
      total: Number(product?.price || 0)
    };

    localStorage.setItem("byose_direct_checkout", JSON.stringify(cartItem));
    localStorage.setItem("byose_market_cart_v1", JSON.stringify([cartItem]));
    localStorage.setItem("byose_checkout_draft_v1", JSON.stringify({
      stage: "shipping",
      currentStep: 0,
      source: "direct",
      foundation: {
        version: "3P",
        inventoryValid: true,
        updatedAt: new Date().toISOString()
      },
      shippingAddress: {
        fullName: "Test Buyer",
        phone: "0781234567",
        provinceCity: "Kigali City",
        district: "Gasabo",
        sector: "Kimironko",
        cell: "Bibare",
        village: "Test Village",
        latitude: "-1.944100",
        longitude: "30.061900"
      },
      delivery: { id: "delivery" },
      payment: { method: "mtn", phone: "0781234567", payerPhone: "0781234567" },
      products: [cartItem]
    }));
  }, { productId, product, firstColor, firstSize });
}

function usesCompactCheckoutChrome(viewport) {
  return viewport.width <= 1024;
}

async function verifyViewport(browser, viewport, product) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile,
    geolocation: { latitude: -1.9441, longitude: 30.0619 },
    permissions: ["geolocation"]
  });
  await installProductionCatalogProxy(context);
  await installStorefrontIsolation(context);
  await seedCartState(context, product);
  const page = await context.newPage();
  const checks = {};

  await page.goto(`${SITE}/orders/shipping.html`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2500);

  checks.shippingCompactCss = await page.locator('link[href*="checkout-compact.css"]').count() > 0;
  checks.shippingProgress = await page.locator(".orders-progress-step.is-active strong").textContent();
  checks.shippingFormPairs = await page.locator(".orders-form-pair").count();
  checks.shippingGpsCard = await page.locator(".orders-location-card--compact").count() > 0;
  const compactChrome = usesCompactCheckoutChrome(viewport);
  checks.shippingStickyBar = compactChrome
    ? await page.locator(".orders-sticky-checkout-bar__action").count() > 0
    : await page.locator(".orders-sidebar-card--sticky").count() > 0;

  const bodyWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  checks.noHorizontalScrollShipping = bodyWidth <= viewport.width + 2;

  await page.fill('input[name="fullName"]', "Test Buyer");
  await page.fill('input[name="phone"]', "0781234567");
  await page.fill('input[name="provinceCity"]', "Kigali City");
  await page.fill('input[name="district"]', "Gasabo");
  await page.fill('input[name="sector"]', "Kimironko");
  await page.fill('input[name="cell"]', "Bibare");
  await page.fill('input[name="village"]', "Test Village");

  await page.waitForFunction(() => {
    const button = document.getElementById("shippingContinueBtn");
    return button && !button.disabled;
  }, { timeout: 15000 });

  await page.evaluate(() => document.getElementById("shippingForm")?.requestSubmit());
  await page.waitForURL(/checkout\.html/, { timeout: 30000 });
  await page.waitForTimeout(1500);

  checks.checkoutProgress = await page.locator(".orders-progress-step.is-active strong").textContent();
  checks.reviewProducts = await page.locator(".orders-review-product").count();
  checks.reviewDelivery = await page.locator(".orders-review-card--summary").count() > 0;
  checks.reviewTotals = await page.locator(".orders-review-card--totals").count() > 0;
  checks.checkoutStickyBar = compactChrome
    ? await page.locator(".orders-sticky-checkout-bar__action").count() > 0
    : await page.locator(".orders-sidebar-card--sticky").count() > 0;

  const reviewBodyWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  checks.noHorizontalScrollReview = reviewBodyWidth <= viewport.width + 2;

  const continueToPayment = page.locator("#continuePaymentButton");
  if (await continueToPayment.count()) {
    await continueToPayment.waitFor({ state: "visible", timeout: 10000 });
    await page.waitForFunction(() => {
      const button = document.getElementById("continuePaymentButton");
      return button && !button.disabled;
    }, { timeout: 15000 });
    await continueToPayment.click();
  } else {
    await page.locator(".orders-sticky-checkout-bar__action").first().click({ force: true });
  }
  await page.waitForURL(/payment\.html/, { timeout: 30000 });
  await page.waitForSelector(".orders-payment-option", { timeout: 15000 });
  await page.waitForTimeout(500);

  checks.paymentProgress = await page.locator(".orders-progress-step.is-active strong").textContent();
  checks.paymentOptions = await page.locator(".orders-payment-option").count();
  checks.paymentIcons = await page.locator(".orders-payment-icon").count();
  checks.paymentStickyBar = compactChrome
    ? await page.locator(".orders-sticky-checkout-bar__action").count() > 0
    : await page.locator("#checkoutSidebar .orders-sidebar-card, .orders-payment-list").count() > 0;

  const paymentBodyWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  checks.noHorizontalScrollPayment = paymentBodyWidth <= viewport.width + 2;

  await page.screenshot({
    path: join(OUT_DIR, `payment-${viewport.id}.png`),
    fullPage: false
  });

  await context.close();

  const passed = Object.entries(checks).every(([key, value]) => {
    if (key.startsWith("noHorizontalScroll")) {
      return value === true;
    }
    if (key.endsWith("Progress")) {
      return typeof value === "string" && value.length > 0;
    }
    if (key === "shippingFormPairs") {
      return Number(value) >= 3;
    }
    if (key === "paymentOptions") {
      return Number(value) >= 4;
    }
    if (key === "reviewProducts") {
      return Number(value) >= 1;
    }
    return Boolean(value);
  });

  return { id: viewport.id, passed, checks };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const catalog = await fetchJson(`${SITE}/api/products?limit=500`.replace(SITE, PRODUCTION));
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

  for (const viewport of VIEWPORTS) {
    const result = await verifyViewport(browser, viewport, product);
    results.push(result);
    console.log(`${result.passed ? "PASS" : "FAIL"} ${viewport.id}`, result.checks);
  }

  await browser.close();

  const report = {
    generatedAt: new Date().toISOString(),
    site: SITE,
    productId: product?.id || product?.catalogId,
    results,
    allPassed: results.every((row) => row.passed)
  };

  await writeFile(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));

  if (!report.allPassed) {
    process.exit(1);
  }

  console.log("Checkout flow verification passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
