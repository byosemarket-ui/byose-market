/**
 * Local performance smoke for product card API + cache behavior.
 * Run: node scripts/perf-homepage-smoke.js
 */
const http = require("http");
const { createApp } = require("../server/app");
const { connectDatabase, closeDatabase } = require("../server/database");

function request(port, path) {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    http
      .get(
        {
          hostname: "127.0.0.1",
          port,
          path,
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "identity"
          }
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const ms = Number(process.hrtime.bigint() - started) / 1e6;
            const body = Buffer.concat(chunks);
            resolve({
              status: res.statusCode || 0,
              ms,
              bytes: body.length,
              cacheControl: String(res.headers["cache-control"] || ""),
              body
            });
          });
        }
      )
      .on("error", reject);
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

(async () => {
  await connectDatabase();
  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;

  const cardPath = "/api/products?limit=120&fields=card";
  const fullPath = "/api/products?limit=120";

  const coldCard = await request(port, cardPath);
  const warmCard = await request(port, cardPath);
  const full = await request(port, fullPath);

  const payload = JSON.parse(coldCard.body.toString("utf8"));
  const sample = payload.products[0] || {};
  assert(coldCard.status === 200, `card list HTTP ${coldCard.status}`);
  assert(payload.success === true && Array.isArray(payload.products), "card payload invalid");
  assert(payload.view === "card", "expected view=card");
  assert(/max-age=15/.test(coldCard.cacheControl), `expected card cache max-age=15, got ${coldCard.cacheControl}`);
  assert(Object.prototype.hasOwnProperty.call(sample, "updatedAt"), "card payload must include updatedAt for cache fingerprints");
  assert(warmCard.ms <= coldCard.ms + 5 || warmCard.ms < 50, "warm card response should be cached/fast");
  assert(coldCard.bytes <= full.bytes, "card payload should be <= full payload");

  assert(!sample.longDescription || sample.longDescription.length === 0, "card payload should omit long descriptions");
  assert(sample.metadata && (Array.isArray(sample.metadata.placement) || Array.isArray(sample.metadata.placements)), "card metadata placements missing");

  console.log("[perf-homepage-smoke] PASS");
  console.log(`  card cold: ${coldCard.ms.toFixed(1)}ms, ${coldCard.bytes} bytes, products=${payload.products.length}`);
  console.log(`  card warm: ${warmCard.ms.toFixed(1)}ms, cache=${coldCard.cacheControl}`);
  console.log(`  full: ${full.ms.toFixed(1)}ms, ${full.bytes} bytes`);
  console.log(`  size reduction: ${(((full.bytes - coldCard.bytes) / Math.max(full.bytes, 1)) * 100).toFixed(1)}%`);

  await new Promise((resolve) => server.close(resolve));
  await closeDatabase().catch(() => {});
})().catch(async (error) => {
  console.error("[perf-homepage-smoke] FAIL", error);
  await closeDatabase().catch(() => {});
  process.exit(1);
});
