/**
 * Product config modal UI/UX verification (redesign).
 * Run: BYOSE_SITE_ORIGIN=http://127.0.0.1:5000 node scripts/verify-modal-redesign.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = (process.env.BYOSE_SITE_ORIGIN || "http://127.0.0.1:5000").replace(/\/+$/, "");
const PRODUCTION = (process.env.BYOSE_PRODUCTION_ORIGIN || "https://byosemarket.com").replace(/\/+$/, "");
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "verification-artifacts", "modal-redesign");

const VIEWPORTS = [
  { id: "android-phone", width: 360, height: 780, isMobile: true },
  { id: "iphone-se", width: 375, height: 667, isMobile: true },
  { id: "iphone-14", width: 390, height: 844, isMobile: true },
  { id: "ipad", width: 820, height: 1180, isMobile: false },
  { id: "laptop", width: 1366, height: 768, isMobile: false },
  { id: "desktop", width: 1920, height: 1080, isMobile: false },
  { id: "desktop-sm", width: 1280, height: 720, isMobile: false }
];

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function installProductionCatalogProxy(context) {
  const isLocal = /localhost|127\.0\.0\.1/i.test(SITE);
  if (!isLocal) {
    return;
  }

  const catalog = await fetchJson(`${PRODUCTION}/api/products?limit=500`);
  const searchStub = await fetchJson(`${PRODUCTION}/api/products/search?q=AIP&limit=20`).catch(() => ({ body: { products: [], count: 0 } }));
  const payload = JSON.stringify(catalog.body || { products: [] });

  await context.addInitScript(() => {
    window.BYOSE_API_BASE_URL = `${window.location.origin}/api`;
    window.__BYOSE_API_BASE__ = `${window.location.origin}/api`;
  });

  await context.route(/\/api\/products/i, async (route) => {
    const url = route.request().url();
    if (url.includes("/search")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(searchStub.body || { products: [], count: 0 })
      });
      return;
    }
    await route.fulfill({
      status: catalog.status || 200,
      contentType: "application/json",
      body: payload
    });
  });
}

async function verifyViewport(browser, viewport, productId) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile
  });
  await installProductionCatalogProxy(context);
  const page = await context.newPage();
  const result = { id: viewport.id, width: viewport.width, height: viewport.height, checks: {} };

  await page.goto(`${SITE}/details/product-details1.html?id=${productId}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000
  });
  await page.waitForTimeout(4000);

  await page.evaluate(() => document.getElementById("addToCartBtn")?.click());
  await page.waitForTimeout(1200);

  result.checks.modalOpen = await page.locator("#productConfigModal.is-open").count() > 0;
  result.checks.compactHeader = await page.locator(".pcm-header--compact").count() > 0;
  result.checks.colorTiles = await page.locator(".pcm-color-tile").count();
  result.checks.sizeChips = await page.locator(".pcm-size-chip").count();
  result.checks.stickyDock = await page.locator(".pcm-footer--dock, .pcm-dock").count() > 0;
  result.checks.addBtn = await page.locator("[data-config-submit-action='add']").count() > 0;
  result.checks.buyBtn = await page.locator("[data-config-submit-action='buy']").count() > 0;
  result.checks.qtyControls = await page.locator(".pcm-dock__qty").count() > 0;

  const layout = await page.evaluate(() => {
    const modal = document.querySelector(".product-config-modal__dialog");
    const dock = document.querySelector(".pcm-dock__actions");
    const colorTile = document.querySelector(".pcm-color-tile");
    const sizeChip = document.querySelector(".pcm-size-chip");
    if (!modal) return { ok: false, reason: "no-dialog" };

    const modalRect = modal.getBoundingClientRect();
    const dockRect = dock?.getBoundingClientRect();
    const overlaps = [];
    const elements = [
      { name: "header", el: document.querySelector(".pcm-header--compact") },
      { name: "color-section", el: document.querySelector(".pcm-section") },
      { name: "size-section", el: document.querySelector(".pcm-section--sizes") },
      { name: "dock", el: document.querySelector(".pcm-footer--dock") }
    ].filter((entry) => entry.el);

    for (let i = 0; i < elements.length; i++) {
      for (let j = i + 1; j < elements.length; j++) {
        const a = elements[i].el.getBoundingClientRect();
        const b = elements[j].el.getBoundingClientRect();
        const overlap = a.bottom > b.top + 1 && a.top < b.bottom - 1
          && a.right > b.left + 1 && a.left < b.right - 1;
        if (overlap && elements[i].name !== elements[j].name) {
          overlaps.push(`${elements[i].name}/${elements[j].name}`);
        }
      }
    }

    const colorImg = colorTile?.querySelector("img");
    const imgLoaded = colorImg ? colorImg.complete && colorImg.naturalWidth > 0 : false;
    const dockVisible = dockRect
      ? dockRect.bottom <= window.innerHeight + 2 && dockRect.height > 0
      : false;
    const modalFits = modalRect.height <= window.innerHeight + 2;

    return {
      ok: true,
      modalHeight: Math.round(modalRect.height),
      viewportHeight: window.innerHeight,
      dockVisible,
      modalFits,
      overlaps,
      imgLoaded,
      colorTileHeight: colorTile ? Math.round(colorTile.getBoundingClientRect().height) : 0,
      sizeChipHeight: sizeChip ? Math.round(sizeChip.getBoundingClientRect().height) : 0
    };
  });

  Object.assign(result.checks, layout);

  if (result.checks.colorTiles > 0) {
    await page.locator(".pcm-color-tile:not(.is-disabled)").first().click();
    await page.waitForTimeout(600);
    result.checks.colorSelected = true;
    result.checks.sizeChips = await page.locator(".pcm-size-chip").count();
  }

  if ((result.checks.sizeChips || 0) > 0) {
    const sizeBtn = page.locator(".pcm-size-chip:not(.is-disabled)").first();
    if (await sizeBtn.count()) {
      await sizeBtn.click();
      await page.waitForTimeout(600);
      result.checks.sizeSelected = true;
    }
  }

  result.checks.dockReady = await page.locator(".pcm-dock.is-ready").count() > 0;
  result.checks.stockVisible = /in stock|left|Out/i.test(
    await page.locator(".pcm-dock__stock, .pcm-color-tile__info small, .pcm-size-chip__stock").first().textContent().catch(() => "")
  );

  await page.screenshot({ path: join(OUT_DIR, `modal-${viewport.id}.png`), fullPage: false });

  await page.locator(".pcm-close").first().click({ timeout: 3000, force: true }).catch(async () => {
    await page.keyboard.press("Escape");
  });
  await page.waitForTimeout(500);
  result.checks.modalClosed = await page.evaluate(() => {
    const modal = document.getElementById("productConfigModal");
    return Boolean(modal?.hidden || !modal?.classList.contains("is-open"));
  });

  await context.close();
  return result;
}

async function verifyCartFlow(browser, productId) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await installProductionCatalogProxy(context);
  const page = await context.newPage();
  await page.goto(`${SITE}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.evaluate(() => localStorage.setItem("byose_market_cart_v1", "[]"));
  await page.goto(`${SITE}/details/product-details1.html?id=${productId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(4000);
  await page.evaluate(() => document.getElementById("addToCartBtn")?.click());
  await page.waitForTimeout(1000);
  await page.locator(".pcm-color-tile:not(.is-disabled)").first().click();
  await page.waitForTimeout(500);
  await page.locator(".pcm-size-chip:not(.is-disabled)").first().click();
  await page.waitForTimeout(500);
  await page.waitForSelector("[data-config-submit-action='add']:not([disabled])", { timeout: 10000 });
  await page.locator("[data-config-submit-action='add']").first().click();
  await page.waitForTimeout(2000);

  const stored = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("byose_market_cart_v1") || "[]");
    } catch {
      return [];
    }
  });

  await page.goto(`${SITE}/cart.html`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(3000);
  const cartText = await page.locator(".cart-item__variant").first().textContent().catch(() => "");
  const cartItems = await page.locator(".cart-item").count();
  await page.screenshot({ path: join(OUT_DIR, "cart-after-modal.png"), fullPage: false });
  await context.close();

  return {
    storedCount: stored.length,
    hasVariantFields: Boolean(stored[0]?.colorName && stored[0]?.sizeLabel),
    cartItems,
    cartText: (cartText || "").trim(),
    cartOk: stored.length >= 1 && cartItems >= 1 && /color:|size:/i.test(cartText || "")
  };
}

function evaluate(report) {
  const checks = [];
  for (const vp of report.viewports) {
    checks.push({ name: `${vp.id}: modal opens`, ok: vp.checks.modalOpen });
    checks.push({ name: `${vp.id}: compact header`, ok: vp.checks.compactHeader });
    checks.push({ name: `${vp.id}: color tiles`, ok: (vp.checks.colorTiles || 0) >= 1 });
    checks.push({ name: `${vp.id}: sticky dock`, ok: vp.checks.stickyDock });
    checks.push({ name: `${vp.id}: actions visible`, ok: vp.checks.addBtn && vp.checks.buyBtn });
    checks.push({ name: `${vp.id}: dock in viewport`, ok: vp.checks.dockVisible !== false });
    checks.push({ name: `${vp.id}: no section overlap`, ok: !(vp.checks.overlaps || []).length });
    checks.push({ name: `${vp.id}: compact color tile`, ok: (vp.checks.colorTileHeight || 99) <= 72 });
    checks.push({ name: `${vp.id}: size chips after color`, ok: (vp.checks.sizeChips || 0) >= 1 });
    checks.push({ name: `${vp.id}: modal closes`, ok: vp.checks.modalClosed });
  }
  checks.push({ name: "cart flow after modal", ok: report.flow?.cartOk === true });
  checks.push({ name: "variant fields in cart", ok: report.flow?.hasVariantFields === true });
  report.checks = checks;
  report.passed = checks.every((c) => c.ok);
  return report;
}

async function main() {
  const catalogSource = /localhost|127\.0\.0\.1/i.test(SITE) ? PRODUCTION : SITE;
  const catalog = await fetchJson(`${catalogSource}/api/products?limit=500`);
  const products = catalog.body?.products || [];
  const variantProduct = products.find((p) => (p?.variants?.colorVariants || []).length) || products[0];
  const productId = variantProduct?.id || 5;

  const { chromium } = await import("playwright");
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  const report = {
    site: SITE,
    productId,
    productName: variantProduct?.name,
    verifiedAt: new Date().toISOString(),
    viewports: []
  };

  for (const viewport of VIEWPORTS) {
    report.viewports.push(await verifyViewport(browser, viewport, productId));
  }

  report.flow = await verifyCartFlow(browser, productId);
  evaluate(report);

  const reportPath = join(OUT_DIR, "report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log("Modal Redesign Verification");
  console.log("============================");
  console.log(`Site: ${SITE}`);
  console.log(`Product: #${productId}`);
  console.log(`Screenshots: ${OUT_DIR}`);
  for (const check of report.checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}`);
  }
  console.log(`\nResult: ${report.passed ? "PASSED" : "FAILED"}`);
  console.log(`Report: ${reportPath}`);

  await browser.close();
  process.exitCode = report.passed ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
