#!/usr/bin/env node
/**
 * Verifies Admin SEO Settings module (service, DB nesting, APIs, public surfaces).
 * Usage: node scripts/verify-admin-seo.js [baseUrl]
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function request(baseUrl, method, routePath, { token = "", body = null, accept = "application/json" } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(routePath, `${baseUrl}/`);
    const transport = url.protocol === "https:" ? https : http;
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        Accept: accept,
        ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(raw); } catch (_error) { json = null; }
        resolve({ status: res.statusCode || 0, json, raw, headers: res.headers });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function verifyServiceLayer() {
  const { connectDatabase } = require("../server/database");
  await connectDatabase();

  const seoSettingsService = require("../server/services/seosettings.service");
  const generalSettingsService = require("../server/services/generalsettings.service");
  const brandingSettingsService = require("../server/services/brandingsettings.service");
  const deliverySettingsService = require("../server/services/deliverysettings.service");

  const before = await seoSettingsService.getAdminSeo();
  assert(before.website?.websiteTitle, "website title missing");
  assert(before.website?.robotsMeta, "robots meta missing");

  const marker = `SEO Title ${Date.now().toString().slice(-5)}`;
  const updated = await seoSettingsService.updateSeo({
    website: {
      ...before.website,
      websiteTitle: marker,
      metaTitle: `${marker} | Shop`,
      metaDescription: "Verified meta description for BYOSE Market SEO settings module testing."
    },
    analytics: {
      ...before.analytics,
      googleAnalyticsId: "G-VERIFYSEO01"
    }
  }, { id: "ADMIN_VERIFY", email: "admin@example.com" });

  assert(updated.website.websiteTitle === marker, "website title not saved");
  assert(updated.analytics.googleAnalyticsId === "G-VERIFYSEO01", "analytics id not saved");

  const general = await generalSettingsService.getGeneralSettings();
  assert(general.storeName, "general settings wiped");

  const branding = await brandingSettingsService.getAdminBranding();
  assert(branding.colors?.primary, "branding wiped by seo update");

  const delivery = await deliverySettingsService.getAdminDeliverySettings();
  assert(delivery?.config || delivery?.zones, "delivery wiped by seo update");

  const publicSettings = await generalSettingsService.getPublicSettings();
  assert(publicSettings.seo?.website?.websiteTitle === marker, "public seo title mismatch");
  assert(publicSettings.seo?.analytics?.googleAnalyticsId === "G-VERIFYSEO01", "public analytics missing");

  const robots = await seoSettingsService.getRobotsTxt();
  assert(/user-agent/i.test(robots), "robots.txt body missing user-agent");

  const sitemap = await seoSettingsService.getSitemapXml();
  assert(/urlset/i.test(sitemap), "sitemap xml missing urlset");

  let rejected = false;
  try {
    await seoSettingsService.updateSeo({
      website: { ...before.website, robotsMeta: "allow-all-bots" }
    }, { id: "ADMIN_VERIFY", email: "admin@example.com" });
  } catch (error) {
    rejected = Number(error.statusCode) === 400;
  }
  assert(rejected, "invalid robots meta should be rejected");

  await seoSettingsService.updateSeo({
    website: before.website,
    analytics: before.analytics,
    social: {
      ogTitle: before.social.ogTitle,
      ogDescription: before.social.ogDescription,
      ogImage: typeof before.social.ogImage === "object" ? before.social.ogImage.path : before.social.ogImage,
      twitterTitle: before.social.twitterTitle,
      twitterDescription: before.social.twitterDescription,
      twitterImage: typeof before.social.twitterImage === "object" ? before.social.twitterImage.path : before.social.twitterImage,
      twitterCard: before.social.twitterCard
    },
    searchEngine: {
      ...before.searchEngine,
      sitemapUrls: before.searchEngine.sitemapUrls
    },
    structuredData: {
      ...before.structuredData,
      organizationLogo: typeof before.structuredData.organizationLogo === "object"
        ? before.structuredData.organizationLogo.path
        : before.structuredData.organizationLogo
    }
  }, { id: "ADMIN_VERIFY", email: "admin@example.com" });

  const adminEmail = String(process.env.ADMIN_EMAIL || "admin@example.com").trim().toLowerCase();
  const adminId = `ADMIN_${Buffer.from(adminEmail).toString("hex").slice(0, 16)}`;
  return { adminId, adminEmail };
}

async function verifyHttp(baseUrl, serviceResult) {
  const { generateToken } = require("../server/utils/token");
  const token = generateToken({
    id: serviceResult.adminId,
    email: serviceResult.adminEmail,
    role: "admin",
    sid: "sess_seo_http"
  });

  const unauth = await request(baseUrl, "GET", "/api/admin/seo");
  assert([401, 403].includes(unauth.status), `Expected 401/403, got ${unauth.status}`);

  const getRes = await request(baseUrl, "GET", "/api/admin/seo", { token });
  assert(getRes.status === 200 && getRes.json?.success, `get seo failed: ${getRes.raw}`);
  assert(getRes.json.seo?.website, "seo website missing");

  const putMarker = `HTTP SEO ${Date.now().toString().slice(-4)}`;
  const putRes = await request(baseUrl, "PUT", "/api/admin/seo", {
    token,
    body: {
      website: {
        ...(getRes.json.seo.website || {}),
        websiteTitle: putMarker,
        metaDescription: "HTTP verification meta description for BYOSE SEO settings."
      }
    }
  });
  assert(putRes.status === 200 && putRes.json?.success, `put seo failed: ${putRes.raw}`);
  assert(putRes.json.seo?.website?.websiteTitle === putMarker, "HTTP put title mismatch");

  const validateRes = await request(baseUrl, "POST", "/api/admin/seo/validate", {
    token,
    body: { website: putRes.json.seo.website }
  });
  assert(validateRes.status === 200 && validateRes.json?.valid === true, `validate failed: ${validateRes.raw}`);

  const publicRes = await request(baseUrl, "GET", "/api/settings/public");
  assert(publicRes.status === 200 && publicRes.json?.settings?.seo?.website?.websiteTitle === putMarker, "public seo not updated");

  const robotsRes = await request(baseUrl, "GET", "/robots.txt", { accept: "text/plain" });
  assert(robotsRes.status === 200, `robots.txt failed: ${robotsRes.status}`);
  assert(/user-agent/i.test(robotsRes.raw), "robots.txt content unexpected");

  const sitemapRes = await request(baseUrl, "GET", "/sitemap.xml", { accept: "application/xml" });
  assert(sitemapRes.status === 200, `sitemap.xml failed: ${sitemapRes.status}`);
  assert(/urlset/i.test(sitemapRes.raw), "sitemap.xml content unexpected");

  await request(baseUrl, "PUT", "/api/admin/seo", {
    token,
    body: {
      website: getRes.json.seo.website,
      social: {
        ...(getRes.json.seo.social || {}),
        ogImage: typeof getRes.json.seo.social?.ogImage === "object"
          ? getRes.json.seo.social.ogImage.path
          : getRes.json.seo.social?.ogImage,
        twitterImage: typeof getRes.json.seo.social?.twitterImage === "object"
          ? getRes.json.seo.social.twitterImage.path
          : getRes.json.seo.social?.twitterImage
      },
      searchEngine: getRes.json.seo.searchEngine,
      analytics: getRes.json.seo.analytics,
      structuredData: {
        ...(getRes.json.seo.structuredData || {}),
        organizationLogo: typeof getRes.json.seo.structuredData?.organizationLogo === "object"
          ? getRes.json.seo.structuredData.organizationLogo.path
          : getRes.json.seo.structuredData?.organizationLogo
      }
    }
  });

  return true;
}

async function main() {
  const baseUrl = String(process.argv[2] || process.env.VERIFY_BASE_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
  console.log(`[verify-admin-seo] baseUrl=${baseUrl}`);

  const serviceResult = await verifyServiceLayer();
  console.log("[verify-admin-seo] service layer OK");

  const uiFiles = [
    "admin/app/pages/settings-seo.js",
    "admin/app/pages/settings.js",
    "server/services/seosettings.service.js",
    "server/controllers/adminseocontroller.js",
    "server/routes/adminseo.js",
    "js/storefront-settings.js"
  ];
  uiFiles.forEach((rel) => {
    assert(fs.existsSync(path.resolve(__dirname, "..", rel)), `${rel} missing`);
  });

  try {
    await verifyHttp(baseUrl, serviceResult);
    console.log("[verify-admin-seo] HTTP layer OK");
  } catch (error) {
    console.warn(`[verify-admin-seo] HTTP layer skipped/failed: ${error.message}`);
    console.warn("Restart the API server and re-run to verify HTTP endpoints.");
    process.exitCode = 1;
    return;
  }

  console.log("[verify-admin-seo] PASS");
}

main().catch((error) => {
  console.error("[verify-admin-seo] FAIL:", error.message);
  process.exitCode = 1;
});
