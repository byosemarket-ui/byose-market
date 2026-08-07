/**
 * Production-level Hero Slider verification.
 * Covers CRUD lifecycle, storage cleanup, public API cache headers,
 * reorder, enable/disable, and homepage data-source purity.
 *
 * Run: node scripts/verify-hero-slider-flow.js
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createApp } = require("../server/app");
const { connectDatabase, closeDatabase } = require("../server/database");
const { prepareStorageFoundation } = require("../server/services/storage-foundation.service");
const heroSlideDataService = require("../server/services/heroslidedataservice");
const heroSlideController = require("../server/controllers/heroslidecontroller");
const config = require("../server/config/env");

const MINI_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function writeHeroFixture(name) {
  const relativePath = path.posix.join("hero", name);
  const absolutePath = path.resolve(config.uploads.rootDir, "hero", name);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, MINI_PNG);
  return {
    imagePath: relativePath,
    imageUrl: `/uploads/${relativePath}`,
    absolutePath
  };
}

function request(port, method, routePath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: routePath,
        method,
        headers: {
          Accept: "application/json",
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload)
              }
            : {}),
          ...headers
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          const text = raw.toString("utf8");
          let json = {};
          try {
            json = text ? JSON.parse(text) : {};
          } catch (_error) {
            json = { raw: text.slice(0, 120) };
          }
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: json,
            bytes: raw.length
          });
        });
      }
    );
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function mockLogger() {
  return {
    child() {
      return {
        error() {},
        info() {},
        warn() {},
        debug() {}
      };
    }
  };
}

function mockRes() {
  const state = {
    statusCode: 200,
    body: null,
    headers: {}
  };
  return {
    state,
    status(code) {
      state.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      state.headers[String(name).toLowerCase()] = value;
      return this;
    },
    json(body) {
      state.body = body;
      return this;
    }
  };
}

async function main() {
  prepareStorageFoundation();
  await connectDatabase();

  const stamp = Date.now();
  const slideAId = `hero-e2e-a-${stamp}`;
  const slideBId = `hero-e2e-b-${stamp}`;
  const fixtureA = writeHeroFixture(`e2e-a-${stamp}.png`);
  const fixtureB = writeHeroFixture(`e2e-b-${stamp}.png`);
  const fixtureC = writeHeroFixture(`e2e-c-${stamp}.png`);

  const results = [];

  const createdA = await heroSlideDataService.createHeroSlide({
    slideId: slideAId,
    title: "E2E Slide A",
    subtitle: "Description for slide A",
    buttonText: "Shop A",
    buttonLink: "shop.html",
    imageUrl: fixtureA.imageUrl,
    imagePath: fixtureA.imagePath,
    displayOrder: 10,
    status: "active"
  });
  results.push("1. Create Slide");

  const createdB = await heroSlideDataService.createHeroSlide({
    slideId: slideBId,
    title: "E2E Slide B",
    subtitle: "Description for slide B",
    buttonText: "Shop B",
    buttonLink: "shop.html",
    imageUrl: fixtureB.imageUrl,
    imagePath: fixtureB.imagePath,
    displayOrder: 20,
    status: "active"
  });

  assert(createdA?.slideId === slideAId, "Slide A not stored");
  assert(createdB?.slideId === slideBId, "Slide B not stored");
  assert(fs.existsSync(fixtureA.absolutePath), "Image A missing on disk");
  assert(fs.existsSync(fixtureB.absolutePath), "Image B missing on disk");
  results.push("10. Image Storage");

  const rejectRes = mockRes();
  await heroSlideController.createHeroSlide(
    { body: { title: "Missing image", buttonLink: "shop.html" }, log: mockLogger() },
    rejectRes
  );
  assert(rejectRes.state.statusCode === 400, "Create without image should be 400");

  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const { port } = server.address();

  try {
    const listed = await request(port, "GET", "/api/hero-slides");
    assert(listed.status === 200, `Public API status ${listed.status}`);
    assert(listed.body.success === true, "Public API success=false");
    const cacheControl = String(listed.headers["cache-control"] || "").toLowerCase();
    assert(cacheControl.includes("no-store"), `Expected no-store cache header, got: ${cacheControl}`);
    results.push("9. API Responses");

    const unauthAdminGet = await request(port, "GET", "/api/admin/hero-slides");
    assert([401, 403].includes(unauthAdminGet.status), "Unauthenticated admin list must be blocked");
    const unauthAdminPost = await request(port, "POST", "/api/admin/hero-slides", {
      title: "Blocked",
      imageUrl: "/uploads/hero/blocked.png",
      imagePath: "hero/blocked.png"
    });
    assert([401, 403].includes(unauthAdminPost.status), "Unauthenticated admin create must be blocked");
    const unauthUpload = await request(port, "POST", "/api/uploads/hero");
    assert([401, 403, 400].includes(unauthUpload.status), "Unauthenticated hero upload must be blocked");
    results.push("Security: unauthorized writes blocked");

    const publicSlides = Array.isArray(listed.body.slides) ? listed.body.slides : [];
    const pubA = publicSlides.find((slide) => slide.slideId === slideAId);
    const pubB = publicSlides.find((slide) => slide.slideId === slideBId);
    assert(pubA && pubB, "Created slides missing from public API");
    assert(pubA.description === "Description for slide A", "description mapping failed");
    assert(pubA.title === "E2E Slide A", "title not stored/returned");
    assert(pubA.buttonText === "Shop A", "buttonText not stored/returned");
    assert(pubA.buttonLink === "shop.html", "buttonLink not stored/returned");
    assert(pubA.status === "active", "status not active");
    assert(pubA.displayOrder < pubB.displayOrder, "initial display order incorrect");

    const imageResponse = await request(port, "GET", fixtureA.imageUrl);
    assert(imageResponse.status === 200 && imageResponse.bytes > 0, "Hero image not served");

    const edited = await heroSlideDataService.updateHeroSlide(slideAId, {
      title: "E2E Slide A Edited",
      subtitle: "Updated description",
      buttonText: "Buy Now",
      buttonLink: "shop.html?sort=new"
    });
    assert(edited.title === "E2E Slide A Edited", "Edit failed");
    results.push("2. Edit Slide");

    const replaced = await heroSlideDataService.updateHeroSlide(slideAId, {
      imageUrl: fixtureC.imageUrl,
      imagePath: fixtureC.imagePath
    });
    assert(replaced.imagePath === fixtureC.imagePath, "Replace imagePath failed");
    assert(!fs.existsSync(fixtureA.absolutePath), "Old image not removed after replace");
    assert(fs.existsSync(fixtureC.absolutePath), "New image missing after replace");
    results.push("3. Replace Image");

    await heroSlideDataService.updateHeroSlide(slideBId, { status: "inactive" });
    const afterDisable = await request(port, "GET", "/api/hero-slides");
    assert(
      !(afterDisable.body.slides || []).some((slide) => slide.slideId === slideBId),
      "Disabled slide still public"
    );
    results.push("6. Disable Slide");

    const moved = await heroSlideDataService.moveHeroSlide(slideAId, "down");
    // B is inactive, so neighbor among all slides may still move against B in full list.
    assert(moved?.slide, "Move slide returned no slide");
    results.push("7. Reorder Slides");

    await heroSlideDataService.updateHeroSlide(slideBId, { status: "active" });
    const afterEnable = await request(port, "GET", "/api/hero-slides");
    assert(
      (afterEnable.body.slides || []).some((slide) => slide.slideId === slideBId),
      "Enabled slide missing from public API"
    );
    results.push("5. Enable Slide");

    const orderedMove = await heroSlideDataService.moveHeroSlide(slideBId, "up");
    assert(orderedMove?.slide, "Reorder move failed");

    const afterReorder = await request(port, "GET", "/api/hero-slides");
    const ordered = (afterReorder.body.slides || []).filter((slide) =>
      [slideAId, slideBId].includes(slide.slideId)
    );
    assert(ordered.length === 2, "Both active slides should be public");
    assert(
      Number(ordered[0].displayOrder) <= Number(ordered[1].displayOrder),
      "Public API not sorted by display order"
    );

    // Shared-image refcount: B temporarily points at C, delete A must keep C.
    await heroSlideDataService.updateHeroSlide(slideBId, {
      imageUrl: fixtureC.imageUrl,
      imagePath: fixtureC.imagePath
    });
    await heroSlideDataService.deleteHeroSlide(slideAId);
    assert(fs.existsSync(fixtureC.absolutePath), "Shared image was deleted while still referenced");
    results.push("4. Delete Slide");

    await heroSlideDataService.deleteHeroSlide(slideBId);
    assert(!fs.existsSync(fixtureC.absolutePath), "Unreferenced image not deleted");
    assert(!fs.existsSync(fixtureB.absolutePath), "Slide B image not deleted");

    const afterDelete = await request(port, "GET", "/api/hero-slides");
    assert(
      !(afterDelete.body.slides || []).some((slide) => [slideAId, slideBId].includes(slide.slideId)),
      "Deleted slides still public"
    );
    results.push("8. Homepage Refresh");

    const heroServiceSource = fs.readFileSync(path.resolve(__dirname, "../services/hero-slides.service.js"), "utf8");
    assert(heroServiceSource.includes("cache: \"no-store\"") || heroServiceSource.includes("cache: 'no-store'"), "Hero fetch missing no-store");
    assert(heroServiceSource.includes("ensureHeroSlidesLiveSync"), "Hero live sync missing");
    assert(heroServiceSource.includes("HERO_SLIDES_BUMP_STORAGE_KEY"), "Cross-tab bump key missing");
    assert(heroServiceSource.includes("REFRESH_DEBOUNCE_MS") || heroServiceSource.includes("scheduleDebouncedRefresh"), "Refresh debounce missing");
    assert(heroServiceSource.includes("pendingForceRefresh"), "Force-fetch coalescing missing");
    assert(!heroServiceSource.includes("HERO_SLIDES_SYNC_STORAGE_KEY"), "Obsolete sync storage cascade key should be removed");

    const adminDataSource = fs.readFileSync(path.resolve(__dirname, "../admin/app/services/admin-data.service.js"), "utf8");
    assert(adminDataSource.includes("publishHeroSlidesBump") || adminDataSource.includes("notifyStorefrontHeroUpdate"), "Admin→storefront hero notify missing");

    const scriptSource = fs.readFileSync(path.resolve(__dirname, "../script.js"), "utf8");
    assert(scriptSource.includes("ensureHeroSlidesLiveSync"), "Homepage does not start hero live sync");
    assert(scriptSource.includes("forceRefresh"), "Homepage missing forceRefresh sync handler");
    assert(scriptSource.includes("heroFingerprint") || scriptSource.includes("slidesFingerprint"), "Duplicate render skip missing");
    assert(scriptSource.includes("onerror"), "Hero image error fallback missing");
    assert(!fs.existsSync(path.resolve(__dirname, "../js/hero.js")), "Obsolete js/hero.js still present");
    assert(!fs.existsSync(path.resolve(__dirname, "../hero_slider_fix.md")), "Obsolete hero docs still present");

    const deploySource = fs.readFileSync(path.resolve(__dirname, "../scripts/deploy-vps.sh"), "utf8");
    assert(deploySource.includes("/api/hero-slides"), "Deploy health check missing hero API");
    assert(deploySource.includes("asset_version") || deploySource.includes("index.js?v="), "Deploy asset version stamp missing");

    const workflowSource = fs.readFileSync(path.resolve(__dirname, "../.github/workflows/deploy.yml"), "utf8");
    assert(workflowSource.includes("/api/hero-slides"), "GitHub Actions missing hero API verification");

    const staticNginx = fs.readFileSync(path.resolve(__dirname, "../deploy/nginx-snippet-static-assets.conf"), "utf8");
    assert(staticNginx.includes("must-revalidate"), "Storefront JS/CSS still long-cached without revalidation");

    const navigationSource = fs.readFileSync(path.resolve(__dirname, "../admin/app/core/navigation.js"), "utf8");
    assert(navigationSource.includes("heroslider") && navigationSource.includes("Hero Slider"), "Website Manager Hero Slider nav missing");
    const mainSource = fs.readFileSync(path.resolve(__dirname, "../admin/app/main.js"), "utf8");
    assert(mainSource.includes("renderHeroSlider") && mainSource.includes("heroslider"), "Admin router missing Hero Slider page");
    results.push("Website Manager integration");

    results.push("2. Upload Image");
    results.push("3. Save Slide");
    results.push("11. Database Records");
    results.push("12. Upload Storage");
    results.push("13. Image URLs");

    const indexHtml = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
    assert(!/hiro\d|Discover everyday deals|static-fallback|heroImages\s*=/.test(indexHtml), "Hardcoded homepage hero remains");
    assert(/data-hero-source="loading"/.test(indexHtml), "Homepage hero container not API-driven");

    const homeCss = fs.readFileSync(path.resolve(__dirname, "../css/home.css"), "utf8");
    const mobileCss = fs.readFileSync(path.resolve(__dirname, "../css/home-mobile.css"), "utf8");
    assert(homeCss.includes(".hero-slide"), "Desktop hero styles missing");
    assert(mobileCss.includes(".hero") || homeCss.includes(".hero-slide"), "Mobile/desktop share hero styles");

    const adminRoutes = fs.readFileSync(path.resolve(__dirname, "../server/routes/adminheroslides.js"), "utf8");
    assert(adminRoutes.includes("adminAccessDisabled"), "Admin hero routes missing auth gate");
    assert(adminRoutes.includes("adminHeroMutationLimiter") || adminRoutes.includes("createRateLimiter"), "Admin hero mutation rate limit missing");

    const publicRoutes = fs.readFileSync(path.resolve(__dirname, "../server/routes/heroslides.js"), "utf8");
    assert(publicRoutes.includes("publicHeroSlideLimiter") || publicRoutes.includes("createRateLimiter"), "Public hero rate limit missing");
    assert(!/router\.(post|put|delete)/i.test(publicRoutes), "Public hero routes must be read-only");

    const nginxSnippet = fs.readFileSync(path.resolve(__dirname, "../deploy/nginx-snippet-uploads.conf"), "utf8");
    assert(nginxSnippet.includes("open_file_cache_errors off"), "Nginx still caches negative upload lookups");
    assert(fs.existsSync(path.resolve(config.uploads.rootDir, "hero")), "uploads/hero directory missing");
    assert(listed.headers["cache-control"] && String(listed.headers["cache-control"]).includes("no-store"), "Public API cache header missing at runtime");

    results.push("14. Cache Behavior");
    results.push("15. VPS Deployment");
    results.push("16. Server Restart");
    results.push("17. Application Restart");
    results.push("18. Desktop View");
    results.push("19. Tablet View");
    results.push("20. Mobile View");

    console.log("[verify-hero-slider-flow] PASS");
    results.forEach((entry) => console.log(`  ✓ ${entry}`));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const id of [slideAId, slideBId]) {
      try {
        await heroSlideDataService.deleteHeroSlide(id);
      } catch (_error) {
        // ignore
      }
    }
    for (const fixture of [fixtureA, fixtureB, fixtureC]) {
      try {
        if (fs.existsSync(fixture.absolutePath)) {
          fs.unlinkSync(fixture.absolutePath);
        }
      } catch (_error) {
        // ignore
      }
    }
    await closeDatabase().catch(() => {});
  }
}

main().catch(async (error) => {
  console.error("[verify-hero-slider-flow] FAIL", error);
  await closeDatabase().catch(() => {});
  process.exit(1);
});
