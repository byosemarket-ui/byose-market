import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const SITE = "https://byosemarket.com";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "verification-artifacts");
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

const report = {};

for (const [name, url, selector] of [
  ["homepage", `${SITE}/?debugProducts=1`, "#homeProductGrid .byose-product-card"],
  ["shop", `${SITE}/shop.html`, "#shopProductGrid .byose-product-card"],
  ["search", `${SITE}/search.html?q=AIP`, "#searchResults .byose-product-card"],
  ["details", `${SITE}/details/product-details1.html?id=5`, "h1, .product-title, #productTitle"]
]) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(8000);
  const count = await page.locator(selector).count();
  const title = name === "details" ? await page.locator(selector).first().textContent().catch(() => "") : "";
  report[name] = { url, count, title: title?.trim?.() || "" };
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
}

const trace = await page.evaluate(() => window.__BYOSE_STOREFRONT_TRACE__ || []);
report.pipelineTraceCount = trace.length;
report.consoleErrors = [...new Set(errors)];
report.passed = report.homepage.count >= 1 && report.shop.count >= 1 && report.search.count >= 1 && Boolean(report.details.title);

console.log(JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.passed ? 0 : 1);
