/**
 * Query-cache generation / singleflight regression checks.
 * Run: node scripts/verify-query-cache.js
 */
const { queryCache } = require("../server/services/querycache.service");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  queryCache.bump("all");

  let loads = 0;
  const first = queryCache.remember("products:test", 5000, async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { value: "v1", loads };
  });
  const second = queryCache.remember("products:test", 5000, async () => {
    loads += 1;
    return { value: "v2", loads };
  });

  const [a, b] = await Promise.all([first, second]);
  assert(a.value === "v1" && b.value === "v1", "singleflight should share one loader");
  assert(loads === 1, `expected one loader call, got ${loads}`);

  const generationBefore = queryCache.getGeneration();
  const slow = queryCache.remember("products:stale", 5000, async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return { value: "stale" };
  });
  queryCache.bump("products");
  assert(queryCache.getGeneration() === generationBefore + 1, "bump should advance generation");
  const result = await slow;
  assert(result.value === "stale", "loader still returns its value to the caller");
  assert(queryCache.get("products:stale") === undefined, "bumped generation must not cache stale loader result");

  const fresh = await queryCache.remember("products:stale", 5000, async () => ({ value: "fresh" }));
  assert(fresh.value === "fresh", "post-bump remember should load fresh data");
  assert(queryCache.get("products:stale").value === "fresh", "fresh value should be cached");

  console.log("[verify-query-cache] PASS");
}

main().catch((error) => {
  console.error("[verify-query-cache] FAIL", error);
  process.exit(1);
});
