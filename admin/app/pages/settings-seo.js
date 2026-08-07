import { emptyState, escapeHtml, panel } from "../components/ui.js";
import {
  getAdminSeo,
  removeAdminSeoImage,
  setAdminSeoImage,
  updateAdminSeo,
  validateAdminSeo
} from "../services/admin-data.service.js";
import { BRANDING_BUCKET, uploadWithRetry } from "../../../services/uploadService.js";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const IMAGE_FIELDS = [
  ["ogImage", "social", "Open Graph Image", "Recommended 1200×630"],
  ["twitterImage", "social", "Twitter Card Image", "Recommended 1200×600"],
  ["organizationLogo", "structuredData", "Organization Logo", "Schema.org organization logo"]
];

const ROBOTS_OPTIONS = [
  "index, follow",
  "index, nofollow",
  "noindex, follow",
  "noindex, nofollow",
  "noindex, noarchive"
];

function attr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function assetUrl(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  return String(entry.url || entry.path || "");
}

function assetPath(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return entry.split("?")[0];
  return String(entry.path || "").split("?")[0];
}

function sectionCard(title, subtitle, body, wide = false) {
  return `
    <section class="admin-profile-card${wide ? " admin-profile-card-wide" : ""}">
      <header class="admin-profile-card-header">
        <div>
          <h4>${escapeHtml(title)}</h4>
          <p>${escapeHtml(subtitle)}</p>
        </div>
      </header>
      ${body}
    </section>
  `;
}

function previewImage(url, label) {
  if (!url) {
    return `<div class="admin-branding-preview-empty">${escapeHtml(label)}</div>`;
  }
  return `<img src="${attr(url)}" alt="${attr(label)}" loading="lazy" />`;
}

function imageCard(field, group, label, help, seo) {
  const entry = group === "structuredData"
    ? seo?.structuredData?.[field]
    : seo?.social?.[field];
  const url = assetUrl(entry);
  return `
    <article class="admin-branding-asset" data-seo-image-field="${attr(field)}" data-seo-image-group="${attr(group)}">
      <div class="admin-branding-asset-preview" data-asset-preview>
        ${previewImage(url, label)}
      </div>
      <div class="admin-branding-asset-copy">
        <strong>${escapeHtml(label)}</strong>
        <p>${escapeHtml(help)}</p>
        <div class="admin-branding-asset-actions">
          <label class="btn btn-ghost admin-branding-upload-label">
            ${url ? "Replace" : "Upload"}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden data-seo-upload />
          </label>
          <button class="btn btn-ghost" type="button" data-seo-remove ${url ? "" : "disabled"}>Remove</button>
        </div>
        <small class="field-error" data-error-for="${attr(field)}"></small>
        <p class="admin-branding-asset-status" data-asset-status></p>
      </div>
    </article>
  `;
}

function truncate(text, max) {
  const value = String(text || "");
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function displayHost(url) {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname);
  } catch (_error) {
    return String(url || "byosemarket.com").replace(/^https?:\/\//i, "");
  }
}

function seoMarkup(seo) {
  const website = seo?.website || {};
  const social = seo?.social || {};
  const searchEngine = seo?.searchEngine || {};
  const analytics = seo?.analytics || {};
  const structuredData = seo?.structuredData || {};
  const sitemapLines = (searchEngine.sitemapUrls || [])
    .map((entry) => `${entry.loc}|${entry.changefreq || "weekly"}|${entry.priority || "0.5"}`)
    .join("\n");

  return `
    <div class="admin-profile-page admin-seo-page" id="adminSeoPage">
      <section class="admin-profile-hero">
        <div class="admin-profile-hero-main">
          <div class="admin-profile-hero-copy">
            <p class="admin-profile-kicker">Search visibility</p>
            <h3>SEO Settings</h3>
            <p class="admin-profile-username">Central SEO, social cards, analytics, and structured data</p>
            <div class="admin-profile-chip-row">
              <span class="admin-profile-chip">${escapeHtml(website.robotsMeta || "index, follow")}</span>
              <span class="admin-profile-chip">${searchEngine.sitemapEnabled ? "Sitemap on" : "Sitemap off"}</span>
              <span class="admin-profile-chip">${escapeHtml(displayHost(website.canonicalUrl || ""))}</span>
            </div>
          </div>
        </div>
      </section>

      <div class="admin-profile-grid">
        ${sectionCard(
          "Live Previews",
          "Updates as you edit SEO fields. Save to publish to the website.",
          `
            <div class="admin-seo-preview-grid" id="adminSeoLivePreview">
              <article class="admin-seo-preview-card" data-preview="google">
                <header>Google Search</header>
                <div class="admin-seo-google-preview">
                  <p class="admin-seo-google-url" data-preview-google-url>${escapeHtml(displayHost(website.canonicalUrl || "https://byosemarket.com"))}</p>
                  <p class="admin-seo-google-title" data-preview-google-title>${escapeHtml(truncate(website.metaTitle || website.websiteTitle || "BYOSE Market", 60))}</p>
                  <p class="admin-seo-google-desc" data-preview-google-desc>${escapeHtml(truncate(website.metaDescription || "", 160))}</p>
                </div>
              </article>
              <article class="admin-seo-preview-card" data-preview="facebook">
                <header>Facebook Share</header>
                <div class="admin-seo-social-preview is-facebook">
                  <div class="admin-seo-social-image" data-preview-og-image>${previewImage(assetUrl(social.ogImage), "OG image")}</div>
                  <div class="admin-seo-social-copy">
                    <p class="admin-seo-social-domain" data-preview-og-domain>${escapeHtml(displayHost(website.canonicalUrl || "byosemarket.com").split("/")[0])}</p>
                    <strong data-preview-og-title>${escapeHtml(truncate(social.ogTitle || website.metaTitle || "", 90))}</strong>
                    <p data-preview-og-desc>${escapeHtml(truncate(social.ogDescription || website.metaDescription || "", 120))}</p>
                  </div>
                </div>
              </article>
              <article class="admin-seo-preview-card" data-preview="twitter">
                <header>Twitter / X Share</header>
                <div class="admin-seo-social-preview is-twitter">
                  <div class="admin-seo-social-image" data-preview-twitter-image>${previewImage(assetUrl(social.twitterImage) || assetUrl(social.ogImage), "Twitter image")}</div>
                  <div class="admin-seo-social-copy">
                    <strong data-preview-twitter-title>${escapeHtml(truncate(social.twitterTitle || social.ogTitle || "", 70))}</strong>
                    <p data-preview-twitter-desc>${escapeHtml(truncate(social.twitterDescription || social.ogDescription || "", 120))}</p>
                    <span data-preview-twitter-domain>${escapeHtml(displayHost(website.canonicalUrl || "byosemarket.com").split("/")[0])}</span>
                  </div>
                </div>
              </article>
            </div>
          `,
          true
        )}

        ${sectionCard(
          "Website SEO",
          "Default title, meta tags, canonical URL, and robots directive.",
          `
            <form class="settings-form admin-seo-form" id="adminSeoWebsiteForm">
              <label><span>Website Title</span><input name="websiteTitle" maxlength="120" value="${attr(website.websiteTitle || "")}" required /></label>
              <label><span>Default Meta Title</span><input name="metaTitle" maxlength="120" value="${attr(website.metaTitle || "")}" /></label>
              <label class="admin-seo-span-2"><span>Meta Description</span><textarea name="metaDescription" rows="3" maxlength="320">${escapeHtml(website.metaDescription || "")}</textarea></label>
              <label class="admin-seo-span-2"><span>Meta Keywords</span><input name="metaKeywords" maxlength="320" value="${attr(website.metaKeywords || "")}" /></label>
              <label><span>Canonical URL</span><input name="canonicalUrl" maxlength="400" value="${attr(website.canonicalUrl || "")}" /></label>
              <label>
                <span>Robots Meta Tag</span>
                <select name="robotsMeta">
                  ${ROBOTS_OPTIONS.map((option) => `
                    <option value="${attr(option)}" ${String(website.robotsMeta || "").toLowerCase() === option ? "selected" : ""}>${escapeHtml(option)}</option>
                  `).join("")}
                </select>
              </label>
            </form>
          `,
          true
        )}

        ${sectionCard(
          "Social Media SEO",
          "Open Graph and Twitter card defaults used when pages share.",
          `
            <form class="settings-form admin-seo-form" id="adminSeoSocialForm">
              <label><span>Open Graph Title</span><input name="ogTitle" maxlength="120" value="${attr(social.ogTitle || "")}" /></label>
              <label><span>Twitter Card Title</span><input name="twitterTitle" maxlength="120" value="${attr(social.twitterTitle || "")}" /></label>
              <label class="admin-seo-span-2"><span>Open Graph Description</span><textarea name="ogDescription" rows="3" maxlength="320">${escapeHtml(social.ogDescription || "")}</textarea></label>
              <label class="admin-seo-span-2"><span>Twitter Card Description</span><textarea name="twitterDescription" rows="3" maxlength="320">${escapeHtml(social.twitterDescription || "")}</textarea></label>
              <label>
                <span>Twitter Card Type</span>
                <select name="twitterCard">
                  <option value="summary_large_image" ${social.twitterCard !== "summary" ? "selected" : ""}>summary_large_image</option>
                  <option value="summary" ${social.twitterCard === "summary" ? "selected" : ""}>summary</option>
                </select>
              </label>
            </form>
            <div class="admin-branding-asset-grid admin-seo-image-grid">
              ${IMAGE_FIELDS.filter(([, group]) => group === "social").map(([field, group, label, help]) => imageCard(field, group, label, help, seo)).join("")}
            </div>
          `,
          true
        )}

        ${sectionCard(
          "Search Engine Settings",
          "Sitemap, robots.txt content, indexing and crawl guidance.",
          `
            <form class="settings-form admin-seo-form" id="adminSeoSearchForm">
              <label class="admin-general-toggle">
                <input type="checkbox" name="sitemapEnabled" ${searchEngine.sitemapEnabled !== false ? "checked" : ""} />
                <span>Enable sitemap.xml generation</span>
              </label>
              <label>
                <span>Canonical Mode</span>
                <select name="canonicalMode">
                  <option value="configured" ${searchEngine.canonicalMode !== "page" ? "selected" : ""}>Use configured default</option>
                  <option value="page" ${searchEngine.canonicalMode === "page" ? "selected" : ""}>Prefer page URL when available</option>
                </select>
              </label>
              <label class="admin-seo-span-2"><span>Indexing Rules</span><input name="indexingRules" maxlength="240" value="${attr(searchEngine.indexingRules || "")}" /></label>
              <label class="admin-seo-span-2"><span>Crawl Rules (notes)</span><textarea name="crawlRules" rows="2" maxlength="500">${escapeHtml(searchEngine.crawlRules || "")}</textarea></label>
              <label class="admin-seo-span-2">
                <span>Sitemap URLs (one per line: loc|changefreq|priority)</span>
                <textarea name="sitemapUrls" rows="5">${escapeHtml(sitemapLines)}</textarea>
              </label>
              <label class="admin-seo-span-2"><span>Robots.txt</span><textarea name="robotsTxt" rows="8" maxlength="8000">${escapeHtml(searchEngine.robotsTxt || "")}</textarea></label>
            </form>
          `,
          true
        )}

        ${sectionCard(
          "Analytics & Tracking",
          "Measurement and verification IDs injected on the public website.",
          `
            <form class="settings-form admin-seo-form" id="adminSeoAnalyticsForm">
              <label><span>Google Analytics Measurement ID</span><input name="googleAnalyticsId" maxlength="40" placeholder="G-XXXXXXXX" value="${attr(analytics.googleAnalyticsId || "")}" autocomplete="off" /></label>
              <label><span>Google Tag Manager ID</span><input name="googleTagManagerId" maxlength="40" placeholder="GTM-XXXXXXX" value="${attr(analytics.googleTagManagerId || "")}" autocomplete="off" /></label>
              <label><span>Google Search Console Verification</span><input name="googleSearchConsoleVerification" maxlength="120" value="${attr(analytics.googleSearchConsoleVerification || "")}" autocomplete="off" /></label>
              <label><span>Meta Pixel ID</span><input name="metaPixelId" maxlength="40" value="${attr(analytics.metaPixelId || "")}" autocomplete="off" /></label>
              <label class="admin-seo-span-2"><span>Bing Webmaster Verification</span><input name="bingWebmasterVerification" maxlength="120" value="${attr(analytics.bingWebmasterVerification || "")}" autocomplete="off" /></label>
            </form>
          `,
          true
        )}

        ${sectionCard(
          "Structured Data",
          "Organization, website, product, breadcrumb, and local business schema toggles.",
          `
            <form class="settings-form admin-seo-form" id="adminSeoSchemaForm">
              <label class="admin-general-toggle"><input type="checkbox" name="organizationEnabled" ${structuredData.organizationEnabled !== false ? "checked" : ""} /><span>Organization Schema</span></label>
              <label class="admin-general-toggle"><input type="checkbox" name="websiteEnabled" ${structuredData.websiteEnabled !== false ? "checked" : ""} /><span>Website Schema</span></label>
              <label class="admin-general-toggle"><input type="checkbox" name="productEnabled" ${structuredData.productEnabled !== false ? "checked" : ""} /><span>Product Schema</span></label>
              <label class="admin-general-toggle"><input type="checkbox" name="breadcrumbEnabled" ${structuredData.breadcrumbEnabled !== false ? "checked" : ""} /><span>Breadcrumb Schema</span></label>
              <label class="admin-general-toggle"><input type="checkbox" name="localBusinessEnabled" ${structuredData.localBusinessEnabled ? "checked" : ""} /><span>Local Business Schema</span></label>
              <label><span>Organization Name</span><input name="organizationName" maxlength="120" value="${attr(structuredData.organizationName || "")}" /></label>
              <label><span>Organization URL</span><input name="organizationUrl" maxlength="400" value="${attr(structuredData.organizationUrl || "")}" /></label>
              <label><span>Local Business Type</span><input name="localBusinessType" maxlength="80" value="${attr(structuredData.localBusinessType || "Store")}" /></label>
              <label><span>Local Business Address</span><input name="localBusinessAddress" maxlength="240" value="${attr(structuredData.localBusinessAddress || "")}" /></label>
            </form>
            <div class="admin-branding-asset-grid admin-seo-image-grid">
              ${IMAGE_FIELDS.filter(([, group]) => group === "structuredData").map(([field, group, label, help]) => imageCard(field, group, label, help, seo)).join("")}
            </div>
          `,
          true
        )}
      </div>

      <div class="admin-profile-form-actions admin-seo-actions">
        <button class="btn btn-primary" type="button" id="adminSeoSaveBtn">Save SEO Settings</button>
        <button class="btn btn-ghost" type="button" id="adminSeoValidateBtn">Validate</button>
        <button class="btn btn-ghost" type="button" id="adminSeoReloadBtn">Reload</button>
        <p id="adminSeoFeedback" class="form-feedback" role="status"></p>
      </div>
    </div>
  `;
}

function parseSitemapUrls(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [loc, changefreq, priority] = line.split("|").map((part) => String(part || "").trim());
      return { loc, changefreq: changefreq || "weekly", priority: priority || "0.5" };
    });
}

function collectSeoPayload(container, seoState) {
  const websiteForm = container.querySelector("#adminSeoWebsiteForm");
  const socialForm = container.querySelector("#adminSeoSocialForm");
  const searchForm = container.querySelector("#adminSeoSearchForm");
  const analyticsForm = container.querySelector("#adminSeoAnalyticsForm");
  const schemaForm = container.querySelector("#adminSeoSchemaForm");
  const websiteData = new FormData(websiteForm);
  const socialData = new FormData(socialForm);
  const searchData = new FormData(searchForm);
  const analyticsData = new FormData(analyticsForm);
  const schemaData = new FormData(schemaForm);

  return {
    website: {
      websiteTitle: String(websiteData.get("websiteTitle") || "").trim(),
      metaTitle: String(websiteData.get("metaTitle") || "").trim(),
      metaDescription: String(websiteData.get("metaDescription") || "").trim(),
      metaKeywords: String(websiteData.get("metaKeywords") || "").trim(),
      canonicalUrl: String(websiteData.get("canonicalUrl") || "").trim(),
      robotsMeta: String(websiteData.get("robotsMeta") || "index, follow").trim()
    },
    social: {
      ogTitle: String(socialData.get("ogTitle") || "").trim(),
      ogDescription: String(socialData.get("ogDescription") || "").trim(),
      ogImage: assetPath(seoState?.social?.ogImage),
      twitterTitle: String(socialData.get("twitterTitle") || "").trim(),
      twitterDescription: String(socialData.get("twitterDescription") || "").trim(),
      twitterImage: assetPath(seoState?.social?.twitterImage),
      twitterCard: String(socialData.get("twitterCard") || "summary_large_image").trim()
    },
    searchEngine: {
      sitemapEnabled: Boolean(searchForm.querySelector('[name="sitemapEnabled"]')?.checked),
      sitemapUrls: parseSitemapUrls(searchData.get("sitemapUrls")),
      robotsTxt: String(searchData.get("robotsTxt") || "").trim(),
      canonicalMode: String(searchData.get("canonicalMode") || "configured").trim(),
      indexingRules: String(searchData.get("indexingRules") || "").trim(),
      crawlRules: String(searchData.get("crawlRules") || "").trim()
    },
    analytics: {
      googleAnalyticsId: String(analyticsData.get("googleAnalyticsId") || "").trim(),
      googleTagManagerId: String(analyticsData.get("googleTagManagerId") || "").trim(),
      googleSearchConsoleVerification: String(analyticsData.get("googleSearchConsoleVerification") || "").trim(),
      metaPixelId: String(analyticsData.get("metaPixelId") || "").trim(),
      bingWebmasterVerification: String(analyticsData.get("bingWebmasterVerification") || "").trim()
    },
    structuredData: {
      organizationEnabled: Boolean(schemaForm.querySelector('[name="organizationEnabled"]')?.checked),
      websiteEnabled: Boolean(schemaForm.querySelector('[name="websiteEnabled"]')?.checked),
      productEnabled: Boolean(schemaForm.querySelector('[name="productEnabled"]')?.checked),
      breadcrumbEnabled: Boolean(schemaForm.querySelector('[name="breadcrumbEnabled"]')?.checked),
      localBusinessEnabled: Boolean(schemaForm.querySelector('[name="localBusinessEnabled"]')?.checked),
      organizationName: String(schemaData.get("organizationName") || "").trim(),
      organizationUrl: String(schemaData.get("organizationUrl") || "").trim(),
      organizationLogo: assetPath(seoState?.structuredData?.organizationLogo),
      localBusinessType: String(schemaData.get("localBusinessType") || "Store").trim(),
      localBusinessAddress: String(schemaData.get("localBusinessAddress") || "").trim()
    }
  };
}

function updateLivePreview(container) {
  const websiteForm = container.querySelector("#adminSeoWebsiteForm");
  const socialForm = container.querySelector("#adminSeoSocialForm");
  if (!websiteForm || !socialForm) return;

  const websiteData = new FormData(websiteForm);
  const socialData = new FormData(socialForm);
  const metaTitle = String(websiteData.get("metaTitle") || websiteData.get("websiteTitle") || "").trim();
  const metaDescription = String(websiteData.get("metaDescription") || "").trim();
  const canonicalUrl = String(websiteData.get("canonicalUrl") || "").trim();
  const ogTitle = String(socialData.get("ogTitle") || metaTitle).trim();
  const ogDescription = String(socialData.get("ogDescription") || metaDescription).trim();
  const twitterTitle = String(socialData.get("twitterTitle") || ogTitle).trim();
  const twitterDescription = String(socialData.get("twitterDescription") || ogDescription).trim();
  const host = displayHost(canonicalUrl || "https://byosemarket.com");

  const setPreview = (selector, text) => {
    const node = container.querySelector(selector);
    if (node) node.textContent = text;
  };

  setPreview("[data-preview-google-url]", host);
  setPreview("[data-preview-google-title]", truncate(metaTitle, 60));
  setPreview("[data-preview-google-desc]", truncate(metaDescription, 160));
  setPreview("[data-preview-og-domain]", host.split("/")[0]);
  setPreview("[data-preview-og-title]", truncate(ogTitle, 90));
  setPreview("[data-preview-og-desc]", truncate(ogDescription, 120));
  setPreview("[data-preview-twitter-title]", truncate(twitterTitle, 70));
  setPreview("[data-preview-twitter-desc]", truncate(twitterDescription, 120));
  setPreview("[data-preview-twitter-domain]", host.split("/")[0]);
}

function bindSeoPanel(container, initialSeo) {
  let seoState = initialSeo;
  const feedback = container.querySelector("#adminSeoFeedback");

  function refreshPreview() {
    updateLivePreview(container);
  }

  container.querySelectorAll("#adminSeoWebsiteForm, #adminSeoSocialForm").forEach((form) => {
    form.addEventListener("input", refreshPreview);
    form.addEventListener("change", refreshPreview);
  });

  async function uploadImage(card, file) {
    const field = card.getAttribute("data-seo-image-field");
    const status = card.querySelector("[data-asset-status]");
    const errorNode = card.querySelector(`[data-error-for="${field}"]`);
    if (errorNode) errorNode.textContent = "";

    if (!ALLOWED_TYPES.has(file.type) || file.size > MAX_BYTES) {
      if (errorNode) errorNode.textContent = "Use a JPG/PNG/WebP under 5MB.";
      return;
    }

    if (status) status.textContent = "Uploading...";
    try {
      const previous = field === "organizationLogo"
        ? assetPath(seoState?.structuredData?.organizationLogo)
        : assetPath(seoState?.social?.[field]);
      const uploaded = await uploadWithRetry(file, {
        bucket: BRANDING_BUCKET,
        previousPaths: previous ? [previous] : []
      });
      const path = uploaded?.path || uploaded?.storagePath || uploaded?.file?.path || "";
      if (!path) throw new Error("Upload did not return a storage path.");
      if (status) status.textContent = "Saving...";
      seoState = await setAdminSeoImage(field, path);
      const url = field === "organizationLogo"
        ? assetUrl(seoState?.structuredData?.organizationLogo)
        : assetUrl(seoState?.social?.[field]);
      const preview = card.querySelector("[data-asset-preview]");
      if (preview) preview.innerHTML = previewImage(url, field);
      const removeBtn = card.querySelector("[data-seo-remove]");
      if (removeBtn) removeBtn.disabled = !url;

      if (field === "ogImage") {
        const ogPreview = container.querySelector("[data-preview-og-image]");
        if (ogPreview) ogPreview.innerHTML = previewImage(url, "OG image");
      }
      if (field === "twitterImage" || field === "ogImage") {
        const twitterUrl = assetUrl(seoState?.social?.twitterImage) || assetUrl(seoState?.social?.ogImage);
        const twitterPreview = container.querySelector("[data-preview-twitter-image]");
        if (twitterPreview) twitterPreview.innerHTML = previewImage(twitterUrl, "Twitter image");
      }

      if (status) status.textContent = "Saved.";
    } catch (error) {
      if (errorNode) errorNode.textContent = error?.message || "Upload failed.";
      if (status) status.textContent = "";
    }
  }

  container.querySelectorAll("[data-seo-upload]").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      const card = input.closest("[data-seo-image-field]");
      input.value = "";
      if (!file || !card) return;
      await uploadImage(card, file);
    });
  });

  container.querySelectorAll("[data-seo-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest("[data-seo-image-field]");
      const field = card?.getAttribute("data-seo-image-field");
      if (!field || !window.confirm("Remove this SEO image?")) return;
      const status = card.querySelector("[data-asset-status]");
      try {
        if (status) status.textContent = "Removing...";
        seoState = await removeAdminSeoImage(field);
        const preview = card.querySelector("[data-asset-preview]");
        if (preview) preview.innerHTML = previewImage("", field);
        button.disabled = true;
        if (status) status.textContent = "Removed.";
        if (field === "ogImage") {
          const ogPreview = container.querySelector("[data-preview-og-image]");
          if (ogPreview) ogPreview.innerHTML = previewImage("", "OG image");
        }
        if (field === "twitterImage" || field === "ogImage") {
          const twitterUrl = assetUrl(seoState?.social?.twitterImage) || assetUrl(seoState?.social?.ogImage);
          const twitterPreview = container.querySelector("[data-preview-twitter-image]");
          if (twitterPreview) twitterPreview.innerHTML = previewImage(twitterUrl, "Twitter image");
        }
      } catch (error) {
        if (status) status.textContent = error?.message || "Unable to remove image.";
      }
    });
  });

  container.querySelector("#adminSeoSaveBtn")?.addEventListener("click", async () => {
    feedback.textContent = "Saving SEO settings...";
    feedback.classList.remove("is-error", "is-success");
    try {
      const payload = collectSeoPayload(container, seoState);
      seoState = await updateAdminSeo(payload);
      feedback.textContent = "SEO settings saved successfully.";
      feedback.classList.add("is-success");
      container.innerHTML = panel(
        "Admin Settings",
        "Search engine optimization for the public website",
        seoMarkup(seoState)
      );
      bindSeoPanel(container, seoState);
    } catch (error) {
      feedback.textContent = error?.message || "Unable to save SEO settings.";
      feedback.classList.add("is-error");
      const details = error?.details || error?.data?.details;
      if (details && typeof details === "object") {
        Object.entries(details).forEach(([key, message]) => {
          const node = container.querySelector(`[data-error-for="${key}"]`);
          if (node) node.textContent = String(message);
        });
      }
    }
  });

  container.querySelector("#adminSeoValidateBtn")?.addEventListener("click", async () => {
    feedback.textContent = "Validating...";
    feedback.classList.remove("is-error", "is-success");
    try {
      const result = await validateAdminSeo(collectSeoPayload(container, seoState));
      const warnings = result.warnings || [];
      feedback.textContent = warnings.length
        ? `Valid with ${warnings.length} warning(s): ${warnings.join(" ")}`
        : "SEO configuration looks valid.";
      feedback.classList.add(warnings.length ? "is-error" : "is-success");
      if (!warnings.length) feedback.classList.remove("is-error");
    } catch (error) {
      feedback.textContent = error?.message || "Validation failed.";
      feedback.classList.add("is-error");
    }
  });

  container.querySelector("#adminSeoReloadBtn")?.addEventListener("click", async () => {
    await renderAdminSeoPanel(container);
  });
}

export async function renderAdminSeoPanel(container) {
  container.innerHTML = panel(
    "Admin Settings",
    "Loading SEO settings...",
    `<p class="admin-profile-help">Fetching SEO configuration…</p>`
  );

  try {
    const seo = await getAdminSeo({ force: true });
    container.innerHTML = panel(
      "Admin Settings",
      "Search engine optimization for the public website",
      seoMarkup(seo)
    );
    bindSeoPanel(container, seo);
  } catch (error) {
    container.innerHTML = panel(
      "Admin Settings",
      "SEO configuration",
      emptyState(error?.message || "Unable to load SEO settings.")
    );
  }
}
