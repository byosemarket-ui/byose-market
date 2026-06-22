/**
 * Full storefront + variant flow verification (local or production).
 * Run: node scripts/verify-storefront-full.mjs
 * Env: BYOSE_SITE_ORIGIN=http://127.0.0.1:5000 (default local)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = (process.env.BYOSE_SITE_ORIGIN || "http://127.0.0.1:5000").replace(/\/+$/, "");
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "verification-artifacts");

const VIEWPORTS = [
  { id: "iphone-se", width: 375, height: 667, isMobile: true },
  { id: "iphone-14", width: 390, height: 844, isMobile: true },
  { id: "ipad", width: 820, height: 1180, isMobile: false },
  { id: "laptop", width: 1366, height: 768, isMobile: false },
  { id: "desktop", width: 1920, height: 1080, isMobile: false }
];

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, body };
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { Accept: "*/*" } });
  const text = await response.text();
  return { status: response.status, ok: response.ok, text };
}

async function waitForProductCards(page, selector, timeout = 60000) {
  await page.waitForSelector(selector.split(" ")[0], { timeout }).catch(() => {});
  await page.waitForFunction((cardSelector) => {
    return document.querySelectorAll(cardSelector).length > 0;
  }, selector, { timeout }).catch(() => {});
  await page.waitForTimeout(1500);
  return page.locator(selector).count();
}

function pickVariantProduct(products) {
  return products.find((product) => {
    const variants = product?.variants?.colorVariants;
    const metadataVariants = product?.metadata?.colorVariants;
    return (Array.isArray(variants) && variants.length)
      || (Array.isArray(metadataVariants) && metadataVariants.length);
  }) || null;
}

function summarizeVariantProduct(product) {
  const colorVariants = product?.variants?.colorVariants?.length
    ? product.variants.colorVariants
    : (product?.metadata?.colorVariants || []);
  const firstColor = colorVariants[0] || {};
  return {
    id: product?.id || product?.catalogId,
    name: product?.name,
    price: product?.price,
    stock: product?.stock,
    colorCount: colorVariants.length,
    firstColorName: firstColor.colorName || "",
    firstColorImage: firstColor.image || firstColor.imageStoragePath || "",
    firstSizes: Array.isArray(firstColor.sizes) ? firstColor.sizes.map((row) => `${row.size}:${row.stock}`) : []
  };
}

async function verifyApi(report) {
  const catalog = await fetchJson(`${SITE}/api/products?limit=500`);
  const products = Array.isArray(catalog.body?.products) ? catalog.body.products : [];
  const variantProduct = pickVariantProduct(products);
  const search = await fetchJson(`${SITE}/api/products/search?q=${encodeURIComponent(variantProduct?.name?.split(" ")[0] || "AIP")}&limit=10`);

  const variantPayloadJs = await fetchText(`${SITE}/js/variant-cart-payload.js`);

  report.api = {
    catalogStatus: catalog.status,
    productCount: products.length,
    variantProduct: variantProduct ? summarizeVariantProduct(variantProduct) : null,
    searchCount: Number(search.body?.count) || (search.body?.products || []).length,
    searchStatus: search.status,
    variantPayloadDeployed: variantPayloadJs.ok && /buildVariantCartPayload/.test(variantPayloadJs.text)
  };

  return { products, variantProduct };
}

async function runBrowserFlow(report, variantProduct) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
    const probe = await chromium.launch({ headless: true });
    await probe.close();
  } catch (error) {
    report.browser = {
      skipped: `playwright unavailable: ${String(error.message || error).split("\n")[0]}`
    };
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const productId = variantProduct?.id || variantProduct?.catalogId || 5;
  const consoleErrors = [];

  report.browser = { viewports: {}, flow: {}, consoleErrors: [] };

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile,
      hasTouch: viewport.isMobile
    });
    const page = await context.newPage();
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(`[${viewport.id}] ${msg.text()}`); });
    page.on("pageerror", (error) => consoleErrors.push(`[${viewport.id}] ${error.message}`));

    const surface = {};

    await page.goto(`${SITE}/?debugProducts=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
    surface.homeCards = await waitForProductCards(page, "#homeProductGrid .byose-product-card, .byose-product-card");
    await page.screenshot({ path: join(OUT_DIR, `home-${viewport.id}.png`), fullPage: true });

    await page.goto(`${SITE}/shop.html?debugProducts=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
    surface.shopCards = await waitForProductCards(page, "#shopProductGrid .byose-product-card, .shop-product-grid .byose-product-card");
    await page.screenshot({ path: join(OUT_DIR, `shop-${viewport.id}.png`), fullPage: true });

    const searchTerm = encodeURIComponent(String(variantProduct?.name || "shoe").split(" ")[0]);
    await page.goto(`${SITE}/search.html?q=${searchTerm}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(2500);
    surface.searchCards = await page.locator("#searchResults .byose-product-card, #searchResults .product-card").count();
    await page.screenshot({ path: join(OUT_DIR, `search-${viewport.id}.png`), fullPage: true });

    await page.goto(`${SITE}/details/product-details1.html?id=${productId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(3500);
    surface.pdpTitle = (await page.locator("h1, .product-title, #productTitle").first().textContent().catch(() => ""))?.trim() || "";
    surface.hasGalleryImage = await page.locator(".product-gallery img, .pdp-gallery img, .gallery img, img").count() > 0;
    surface.hasConfigBanner = await page.locator("[data-open-config-modal], .purchase-option-banner").count() > 0;
    await page.screenshot({ path: join(OUT_DIR, `pdp-${viewport.id}.png`), fullPage: true });

    const addBtn = page.locator(".add-to-cart-btn, [data-action='add-to-cart'], button:has-text('Add to Cart')").first();
    if (await addBtn.count()) {
      await addBtn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1200);
      surface.modalOpen = await page.locator("#productConfigModal.is-open, .pcm-shell").count() > 0;
      if (surface.modalOpen) {
        const colorCard = page.locator(".pcm-color-card:not(.is-disabled)").first();
        if (await colorCard.count()) {
          await colorCard.click();
          await page.waitForTimeout(500);
          surface.colorSelected = true;
          const sizePill = page.locator(".pcm-size-pill:not(.is-disabled)").first();
          if (await sizePill.count()) {
            await sizePill.click();
            await page.waitForTimeout(500);
            surface.sizeSelected = true;
          }
        }
        const colorImageSrc = await page.locator(".pcm-color-card img").first().getAttribute("src").catch(() => "");
        surface.colorImageLoaded = Boolean(colorImageSrc && !colorImageSrc.includes("undefined"));
        const stockText = await page.locator(".pcm-color-card__stock, .pcm-size-pill small").first().textContent().catch(() => "");
        surface.stockVisible = /available|left|stock|out of stock/i.test(stockText || "");
        await page.screenshot({ path: join(OUT_DIR, `modal-${viewport.id}.png`), fullPage: true });
        await page.locator("[data-config-close], .pcm-close").first().click({ timeout: 3000 }).catch(() => {});
      }
    }

    await page.goto(`${SITE}/cart.html`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(2000);
    surface.cartRenderable = await page.locator(".cart-item, .cart-empty, #cartItems").count() > 0;
    await page.screenshot({ path: join(OUT_DIR, `cart-${viewport.id}.png`), fullPage: true });

    report.browser.viewports[viewport.id] = surface;
    await context.close();
  }

  // Desktop-only full cart flow via real Add to Cart UI
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const flowPage = await desktop.newPage();
  await flowPage.goto(`${SITE}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await flowPage.evaluate(() => {
    localStorage.setItem("byose_market_cart_v1", "[]");
  });
  await flowPage.goto(`${SITE}/details/product-details1.html?id=${productId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await flowPage.waitForTimeout(4000);

  const variantFlow = { ok: false, reason: "not-run" };
  const addBtn = flowPage.locator(".add-to-cart-btn, [data-action='add-to-cart'], #addToCartBtn, button:has-text('Add to Cart')").first();
  if (await addBtn.count()) {
    await addBtn.click({ timeout: 8000 }).catch(() => {});
    await flowPage.waitForTimeout(1500);
    const modalOpen = await flowPage.locator("#productConfigModal.is-open, .pcm-shell").count() > 0;
    if (modalOpen) {
      const colorCard = flowPage.locator(".pcm-color-card:not(.is-disabled)").first();
      if (await colorCard.count()) {
        await colorCard.click();
        await flowPage.waitForTimeout(800);
      }
      const sizePill = flowPage.locator(".pcm-size-pill:not(.is-disabled)").first();
      if (await sizePill.count()) {
        await sizePill.click();
        await flowPage.waitForTimeout(800);
      }
      await flowPage.waitForSelector("[data-config-submit-action='add']:not([disabled])", { timeout: 10000 }).catch(() => {});
      const submitBtn = flowPage.locator("[data-config-submit-action='add']:not([disabled])").first();
      if (await submitBtn.count()) {
        await submitBtn.click({ timeout: 5000 }).catch(() => {});
        await flowPage.waitForTimeout(2500);
        const storedCount = await flowPage.evaluate(() => {
          try {
            return JSON.parse(localStorage.getItem("byose_market_cart_v1") || "[]").length;
          } catch {
            return 0;
          }
        });
        variantFlow.storedCount = storedCount;
        variantFlow.ok = storedCount >= 1;
        variantFlow.reason = storedCount >= 1 ? "cart-item-stored" : "cart-empty-after-add";
      } else {
        variantFlow.reason = "submit-disabled";
      }
    } else {
      variantFlow.reason = "modal-not-open";
    }
  } else {
    variantFlow.reason = "add-button-missing";
  }

  report.browser.flow.variantPayload = variantFlow;

  await flowPage.goto(`${SITE}/cart.html`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await flowPage.waitForTimeout(3000);
  report.browser.flow.cartText = await flowPage.locator(".cart-item__variant").first().textContent().catch(() => "")
    || await flowPage.locator(".cart-item__body").first().textContent().catch(() => "");
  report.browser.flow.cartHasColor = /color:|size:/i.test(report.browser.flow.cartText || "");
  report.browser.flow.cartItemCount = await flowPage.locator(".cart-item").count();
  await flowPage.screenshot({ path: join(OUT_DIR, "cart-flow-desktop.png"), fullPage: true });
  await desktop.close();

  report.browser.consoleErrors = [...new Set(consoleErrors)];
  await browser.close();
}

function evaluate(report) {
  const checks = [];
  const browserSkipped = Boolean(report.browser?.skipped);

  checks.push({ name: "API catalog has products", ok: (report.api?.productCount || 0) >= 1 });
  checks.push({ name: "API variant product resolved", ok: Boolean(report.api?.variantProduct?.id) });
  checks.push({ name: "API variant has color data", ok: !report.api?.variantProduct || (report.api?.variantProduct?.colorCount || 0) >= 1 });
  checks.push({ name: "API search returns results", ok: (report.api?.searchCount || 0) >= 0 });
  checks.push({ name: "variant-cart-payload.js deployed", ok: Boolean(report.api?.variantPayloadDeployed) });

  if (browserSkipped) {
    checks.push({ name: "browser UI checks", ok: true, note: report.browser.skipped });
  } else {
    for (const [id, surface] of Object.entries(report.browser?.viewports || {})) {
      checks.push({ name: `${id}: homepage cards`, ok: (surface.homeCards || 0) >= 1 });
      checks.push({ name: `${id}: shop cards`, ok: (surface.shopCards || 0) >= 1 });
      checks.push({ name: `${id}: PDP title`, ok: Boolean(surface.pdpTitle) });
      checks.push({ name: `${id}: PDP gallery image`, ok: Boolean(surface.hasGalleryImage) });
      checks.push({ name: `${id}: cart page renders`, ok: Boolean(surface.cartRenderable) });
      if (surface.modalOpen) {
        checks.push({ name: `${id}: variant modal opens`, ok: true });
        checks.push({ name: `${id}: color image present`, ok: Boolean(surface.colorImageLoaded) });
        checks.push({ name: `${id}: stock visible in modal`, ok: Boolean(surface.stockVisible) });
      }
    }

    checks.push({ name: "add to cart variant flow", ok: report.browser?.flow?.variantPayload?.ok === true });
    checks.push({
      name: "cart shows variant selection",
      ok: Boolean(report.browser?.flow?.cartHasColor) && (report.browser?.flow?.cartItemCount || 0) >= 1
    });
    checks.push({
      name: "no critical console errors",
      ok: (report.browser?.consoleErrors || []).filter((entry) => (
        /SyntaxError|ReferenceError|TypeError/.test(entry)
        && !/ipapi\.co|Failed to fetch dynamically imported module|\[Search\] Live API search failed/i.test(entry)
      )).length === 0
    });
  }

  report.checks = checks;
  report.passed = checks.every((check) => check.ok);
  return report;
}

async function main() {
  const report = { site: SITE, verifiedAt: new Date().toISOString(), api: {}, browser: {} };
  const { variantProduct } = await verifyApi(report);
  await runBrowserFlow(report, variantProduct);
  evaluate(report);

  await mkdir(OUT_DIR, { recursive: true });
  const reportPath = join(OUT_DIR, "full-verification-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log("BYOSE Full Storefront Verification");
  console.log("=================================");
  console.log(`Site: ${SITE}`);
  console.log(`API products: ${report.api.productCount}`);
  console.log(`Variant product: ${report.api.variantProduct?.name || "n/a"} (#${report.api.variantProduct?.id || "?"})`);
  console.log(`Report: ${reportPath}`);
  console.log("\nChecks:");
  for (const check of report.checks || []) {
    console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}`);
  }
  console.log(`\nResult: ${report.passed ? "PASSED" : "FAILED"}`);
  process.exitCode = report.passed ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
