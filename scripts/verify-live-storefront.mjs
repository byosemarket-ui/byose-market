/**
 * Live storefront verification for byosemarket.com
 * Run: node scripts/verify-live-storefront.mjs
 * Requires: npx playwright install chromium (first run)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = process.env.BYOSE_SITE_ORIGIN || "https://byosemarket.com";
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "verification-artifacts");

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => null);
  return { url, status: response.status, ok: response.ok, body };
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { Accept: "*/*" } });
  const text = await response.text();
  return { url, status: response.status, ok: response.ok, text };
}

function summarizeApiProducts(payload) {
  const products = Array.isArray(payload?.products) ? payload.products : [];
  return {
    count: products.length,
    items: products.map((product) => ({
      id: product.id || product.catalogId,
      name: product.name,
      status: product.status,
      visibility: product.visibility,
      price: product.price,
      stock: product.stock,
      image: product.mainImage || product.image
    }))
  };
}

async function verifyApiLayer(report) {
  const catalog = await fetchJson(`${SITE}/api/products?limit=500`);
  report.api.catalog = {
    status: catalog.status,
    ok: catalog.ok,
    ...summarizeApiProducts(catalog.body)
  };

  const search = await fetchJson(`${SITE}/api/products/search?q=AIP&limit=20`);
  report.api.search = {
    status: search.status,
    ok: search.ok,
    query: "AIP",
    count: Number(search.body?.count) || (search.body?.products || []).length
  };

  const productJs = await fetchText(`${SITE}/js/product-card-system.js`);
  report.deploy.productCardSyntaxFixed = /function renderDiscountBadge\(product\)/.test(productJs.text)
    && !/\}\s+if \(!product\) \{\s+return '';\s+\}/.test(productJs.text.replace(/\n/g, " "));
}

async function runBrowserChecks(report) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (_error) {
    report.browser.skipped = "playwright not installed. Run: npx playwright install chromium";
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const failedRequests = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("pageerror", (error) => {
    consoleErrors.push(String(error?.message || error));
  });

  page.on("requestfailed", (request) => {
    failedRequests.push({
      url: request.url(),
      failure: request.failure()?.errorText || "failed"
    });
  });

  const apiResponses = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/api/")) {
      return;
    }
    apiResponses.push({
      url,
      status: response.status(),
      ok: response.ok()
    });
  });

  async function countCards(selector) {
    return page.locator(selector).count();
  }

  // Homepage
  await page.goto(`${SITE}/?debugProducts=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("#homeProductGrid", { timeout: 60000 });
  await page.waitForFunction(() => {
    const grid = document.getElementById("homeProductGrid");
    return grid && grid.querySelectorAll(".byose-product-card").length > 0;
  }, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT_DIR, "homepage.png"), fullPage: true });
  report.browser.homepage = {
    productCards: await countCards("#homeProductGrid .byose-product-card"),
    featuredCards: await countCards("#featuredGrid .byose-product-card"),
    spotlightCards: await countCards("#spotlightGrid .byose-product-card"),
    pipelineLogs: await page.evaluate(() => (window.__BYOSE_STOREFRONT_TRACE__ || []).length)
  };

  // Shop
  await page.goto(`${SITE}/shop.html?debugProducts=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("#shopProductGrid", { timeout: 60000 });
  await page.waitForFunction(() => {
    const grid = document.getElementById("shopProductGrid");
    return grid && grid.querySelectorAll(".byose-product-card").length > 0;
  }, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT_DIR, "shop.png"), fullPage: true });
  report.browser.shop = {
    productCards: await countCards("#shopProductGrid .byose-product-card, .shop-product-grid .byose-product-card, .byose-product-grid .byose-product-card")
  };

  // Search
  await page.goto(`${SITE}/search.html?q=AIP`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("#searchResults", { state: "attached", timeout: 60000 });
  await page.waitForFunction(() => {
    const grid = document.getElementById("searchResults");
    return grid && grid.querySelectorAll(".byose-product-card, .product-card").length > 0;
  }, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT_DIR, "search.png"), fullPage: true });
  report.browser.search = {
    resultCards: await countCards("#searchResults .byose-product-card, #searchResults .product-card"),
    summaryText: await page.locator("#searchResultsSummary").textContent().catch(() => "")
  };

  // Product details
  await page.goto(`${SITE}/details/product-details1.html?id=5`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(OUT_DIR, "product-details.png"), fullPage: true });
  report.browser.productDetails = {
    title: await page.locator("h1, .product-title, #productTitle").first().textContent().catch(() => ""),
    hasMainImage: await page.locator(".product-gallery img, .pdp-gallery img, .gallery img, .details-gallery img, .slider-image, [data-gallery-image]").count() > 0
  };

  report.browser.consoleErrors = consoleErrors
    .filter((entry, index, all) => all.indexOf(entry) === index)
    .filter((entry) => !/Failed to load resource.*favicon/i.test(entry))
    .filter((entry) => !/ERR_ABORTED/i.test(entry));
  report.browser.failedRequests = failedRequests.filter((entry) => {
    if (!entry.url || entry.url.includes("favicon")) {
      return false;
    }
    if (String(entry.failure || "").includes("ERR_ABORTED")) {
      return false;
    }
    return entry.url.includes("/api/products") && !entry.url.includes("/api/products/search");
  });
  report.browser.apiResponses = apiResponses.filter((entry) => entry.url.includes("/api/products"));

  await browser.close();
}

function evaluatePass(report) {
  const checks = [];

  checks.push({ name: "API catalog returns products", ok: (report.api.catalog?.count || 0) >= 1 });
  checks.push({ name: "API search returns products", ok: (report.api.search?.count || 0) >= 1 });
  checks.push({ name: "Deployed product-card-system.js is fixed", ok: Boolean(report.deploy.productCardSyntaxFixed) });
  checks.push({ name: "Homepage renders product cards", ok: (report.browser.homepage?.productCards || 0) >= 1 });
  checks.push({ name: "Shop renders product cards", ok: (report.browser.shop?.productCards || 0) >= 1 });
  checks.push({ name: "Search renders result cards", ok: (report.browser.search?.resultCards || 0) >= 1 });
  checks.push({ name: "Product details page loads", ok: Boolean(String(report.browser.productDetails?.title || "").trim()) });
  checks.push({ name: "No console errors", ok: (report.browser.consoleErrors || []).length === 0 });
  checks.push({ name: "No failed API requests", ok: !(report.browser.failedRequests || []).some((entry) => entry.url.includes("/api/products")) });

  report.checks = checks;
  report.passed = checks.every((check) => check.ok);
  return report;
}

async function main() {
  const report = {
    site: SITE,
    verifiedAt: new Date().toISOString(),
    api: {},
    deploy: {},
    browser: {}
  };

  await verifyApiLayer(report);
  await runBrowserChecks(report);
  evaluatePass(report);

  await mkdir(OUT_DIR, { recursive: true });
  const reportPath = join(OUT_DIR, "live-verification-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log("BYOSE Live Storefront Verification");
  console.log("================================");
  console.log(`Site: ${SITE}`);
  console.log(`API products: ${report.api.catalog?.count ?? 0}`);
  console.log(`Deploy fix present: ${report.deploy.productCardSyntaxFixed ? "yes" : "NO"}`);
  if (!report.browser.skipped) {
    console.log(`Homepage cards: ${report.browser.homepage?.productCards ?? 0}`);
    console.log(`Shop cards: ${report.browser.shop?.productCards ?? 0}`);
    console.log(`Search cards: ${report.browser.search?.resultCards ?? 0}`);
    console.log(`Console errors: ${(report.browser.consoleErrors || []).length}`);
    console.log(`Screenshots: ${OUT_DIR}`);
  } else {
    console.log(report.browser.skipped);
  }

  console.log("\nChecks:");
  for (const check of report.checks || []) {
    console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}`);
  }

  console.log(`\nReport: ${reportPath}`);
  process.exitCode = report.passed ? 0 : 1;
}

main().catch((error) => {
  console.error("Verification failed:", error);
  process.exitCode = 1;
});
