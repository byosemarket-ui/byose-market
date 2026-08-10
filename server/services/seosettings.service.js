const settingsDataService = require('./settingsdataservice');
const {
    buildPublicUrlFromPath,
    normalizeManagedPath
} = require('./uploadstorage.service');

const BRANDING_BUCKET = 'branding';

const DEFAULT_SEO = Object.freeze({
    website: {
        websiteTitle: 'BYOSE Market Rwanda | Quality Footwear Online',
        metaTitle: 'BYOSE Market Rwanda | Quality Footwear Online',
        metaDescription: 'Shop quality footwear online in Rwanda with BYOSE Market. Browse products from our own stock, order online, pay securely, and enjoy convenient delivery.',
        metaKeywords: 'byose market, footwear rwanda, shoes online kigali, quality footwear, buy shoes rwanda',
        canonicalUrl: 'https://byosemarket.com',
        robotsMeta: 'index, follow'
    },
    social: {
        ogTitle: 'BYOSE Market Rwanda | Quality Footwear Online',
        ogDescription: 'Shop quality footwear online in Rwanda with BYOSE Market. Browse products from our own stock, order online, pay securely, and enjoy convenient delivery.',
        ogImage: '',
        twitterTitle: 'BYOSE Market Rwanda | Quality Footwear Online',
        twitterDescription: 'Shop quality footwear online in Rwanda with BYOSE Market. Browse products from our own stock, order online, pay securely, and enjoy convenient delivery.',
        twitterImage: '',
        twitterCard: 'summary_large_image'
    },
    searchEngine: {
        sitemapEnabled: true,
        sitemapUrls: [
            { loc: 'https://byosemarket.com/', changefreq: 'daily', priority: '1.0' },
            { loc: 'https://byosemarket.com/shop.html', changefreq: 'daily', priority: '0.9' },
            { loc: 'https://byosemarket.com/contact.html', changefreq: 'monthly', priority: '0.7' }
        ],
        robotsTxt: 'User-agent: *\nAllow: /\n\nSitemap: https://byosemarket.com/sitemap.xml\n',
        canonicalMode: 'configured',
        indexingRules: 'index, follow',
        crawlRules: 'Allow all public pages. Disallow admin and API internals via robots.txt.'
    },
    analytics: {
        googleAnalyticsId: '',
        googleTagManagerId: '',
        googleSearchConsoleVerification: '',
        metaPixelId: '',
        bingWebmasterVerification: ''
    },
    structuredData: {
        organizationEnabled: true,
        websiteEnabled: true,
        productEnabled: true,
        breadcrumbEnabled: true,
        localBusinessEnabled: false,
        organizationName: 'BYOSE Market',
        organizationUrl: 'https://byosemarket.com',
        organizationLogo: '',
        localBusinessType: 'Store',
        localBusinessAddress: 'Kigali, Rwanda'
    },
    updatedAt: null,
    updatedByAdminId: '',
    updatedByAdminEmail: ''
});

const SAFE_ID_RE = /^[A-Za-z0-9_-]{0,64}$/;
const URL_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i;
const ALLOWED_ROBOTS_META = new Set([
    'index, follow',
    'index, nofollow',
    'noindex, follow',
    'noindex, nofollow',
    'noindex, noarchive'
]);

function normalizeText(value, fallback = '') {
    const text = String(value == null ? '' : value).trim();
    return text || fallback;
}

function normalizeEmail(value, fallback = '') {
    return normalizeText(value, fallback).toLowerCase();
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const text = String(value == null ? '' : value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(text)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(text)) return false;
    return Boolean(fallback);
}

function ValidationError(message, details = {}) {
    const error = new Error(message);
    error.statusCode = 400;
    error.code = 'SEO_VALIDATION_FAILED';
    error.details = details;
    return error;
}

function normalizeAssetPath(value) {
    if (value && typeof value === 'object') {
        value = value.path || value.url || '';
    }
    const raw = normalizeText(value);
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw.slice(0, 500);
    const withoutQuery = raw.split('?')[0];
    const managed = normalizeManagedPath(withoutQuery);
    if (!managed) return '';
    if (!managed.startsWith(`${BRANDING_BUCKET}/`) && !managed.startsWith('hero/') && !managed.startsWith('products/')) {
        return '';
    }
    return managed.slice(0, 260);
}

function withPublicUrl(pathValue, updatedAt) {
    const pathText = normalizeText(pathValue);
    if (!pathText) return { path: '', url: '' };
    if (/^https?:\/\//i.test(pathText)) return { path: pathText, url: pathText };
    const url = buildPublicUrlFromPath(pathText);
    const cacheToken = updatedAt ? `?v=${encodeURIComponent(updatedAt)}` : '';
    return { path: pathText, url: `${url}${cacheToken}` };
}

function sanitizeSitemapUrls(raw) {
    const source = Array.isArray(raw) ? raw : DEFAULT_SEO.searchEngine.sitemapUrls;
    return source.slice(0, 100).map((entry) => {
        const item = entry && typeof entry === 'object' ? entry : { loc: entry };
        return {
            loc: normalizeText(item.loc).slice(0, 400),
            changefreq: normalizeText(item.changefreq, 'weekly').slice(0, 24),
            priority: normalizeText(item.priority, '0.5').slice(0, 8)
        };
    }).filter((entry) => entry.loc);
}

function sanitizeSeo(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const website = source.website && typeof source.website === 'object' ? source.website : source;
    const social = source.social && typeof source.social === 'object' ? source.social : source;
    const searchEngine = source.searchEngine && typeof source.searchEngine === 'object' ? source.searchEngine : source;
    const analytics = source.analytics && typeof source.analytics === 'object' ? source.analytics : source;
    const structuredData = source.structuredData && typeof source.structuredData === 'object'
        ? source.structuredData
        : source;

    return {
        website: {
            websiteTitle: normalizeText(website.websiteTitle, DEFAULT_SEO.website.websiteTitle).slice(0, 120),
            metaTitle: normalizeText(website.metaTitle, DEFAULT_SEO.website.metaTitle).slice(0, 120),
            metaDescription: normalizeText(website.metaDescription, DEFAULT_SEO.website.metaDescription).slice(0, 320),
            metaKeywords: normalizeText(website.metaKeywords, DEFAULT_SEO.website.metaKeywords).slice(0, 320),
            canonicalUrl: normalizeText(website.canonicalUrl, DEFAULT_SEO.website.canonicalUrl).slice(0, 400),
            robotsMeta: normalizeText(website.robotsMeta, DEFAULT_SEO.website.robotsMeta).toLowerCase().slice(0, 64)
        },
        social: {
            ogTitle: normalizeText(social.ogTitle, DEFAULT_SEO.social.ogTitle).slice(0, 120),
            ogDescription: normalizeText(social.ogDescription, DEFAULT_SEO.social.ogDescription).slice(0, 320),
            ogImage: normalizeAssetPath(social.ogImage),
            twitterTitle: normalizeText(social.twitterTitle, DEFAULT_SEO.social.twitterTitle).slice(0, 120),
            twitterDescription: normalizeText(social.twitterDescription, DEFAULT_SEO.social.twitterDescription).slice(0, 320),
            twitterImage: normalizeAssetPath(social.twitterImage),
            twitterCard: normalizeText(social.twitterCard, DEFAULT_SEO.social.twitterCard).slice(0, 40)
        },
        searchEngine: {
            sitemapEnabled: normalizeBoolean(searchEngine.sitemapEnabled, true),
            sitemapUrls: sanitizeSitemapUrls(searchEngine.sitemapUrls),
            robotsTxt: normalizeText(searchEngine.robotsTxt, DEFAULT_SEO.searchEngine.robotsTxt).slice(0, 8000),
            canonicalMode: normalizeText(searchEngine.canonicalMode, 'configured').slice(0, 40),
            indexingRules: normalizeText(searchEngine.indexingRules, DEFAULT_SEO.searchEngine.indexingRules).slice(0, 240),
            crawlRules: normalizeText(searchEngine.crawlRules, DEFAULT_SEO.searchEngine.crawlRules).slice(0, 500)
        },
        analytics: {
            googleAnalyticsId: normalizeText(analytics.googleAnalyticsId).slice(0, 40),
            googleTagManagerId: normalizeText(analytics.googleTagManagerId).slice(0, 40),
            googleSearchConsoleVerification: normalizeText(analytics.googleSearchConsoleVerification).slice(0, 120),
            metaPixelId: normalizeText(analytics.metaPixelId).slice(0, 40),
            bingWebmasterVerification: normalizeText(analytics.bingWebmasterVerification).slice(0, 120)
        },
        structuredData: {
            organizationEnabled: normalizeBoolean(structuredData.organizationEnabled, true),
            websiteEnabled: normalizeBoolean(structuredData.websiteEnabled, true),
            productEnabled: normalizeBoolean(structuredData.productEnabled, true),
            breadcrumbEnabled: normalizeBoolean(structuredData.breadcrumbEnabled, true),
            localBusinessEnabled: normalizeBoolean(structuredData.localBusinessEnabled, false),
            organizationName: normalizeText(structuredData.organizationName, DEFAULT_SEO.structuredData.organizationName).slice(0, 120),
            organizationUrl: normalizeText(structuredData.organizationUrl, DEFAULT_SEO.structuredData.organizationUrl).slice(0, 400),
            organizationLogo: normalizeAssetPath(structuredData.organizationLogo),
            localBusinessType: normalizeText(structuredData.localBusinessType, 'Store').slice(0, 80),
            localBusinessAddress: normalizeText(structuredData.localBusinessAddress, DEFAULT_SEO.structuredData.localBusinessAddress).slice(0, 240)
        },
        updatedAt: source.updatedAt || null,
        updatedByAdminId: normalizeText(source.updatedByAdminId),
        updatedByAdminEmail: normalizeEmail(source.updatedByAdminEmail)
    };
}

function validateSeo(seo) {
    const errors = {};
    if (!seo.website.websiteTitle || seo.website.websiteTitle.length < 3) {
        errors.websiteTitle = 'Website title is required.';
    }
    if (seo.website.metaDescription && seo.website.metaDescription.length < 20) {
        errors.metaDescription = 'Meta description should be at least 20 characters.';
    }
    if (seo.website.canonicalUrl && !URL_RE.test(seo.website.canonicalUrl)) {
        errors.canonicalUrl = 'Enter a valid canonical URL.';
    }
    if (!ALLOWED_ROBOTS_META.has(seo.website.robotsMeta)) {
        errors.robotsMeta = 'Unsupported robots meta tag.';
    }
    ['googleAnalyticsId', 'googleTagManagerId', 'metaPixelId'].forEach((key) => {
        const value = seo.analytics[key];
        if (value && !SAFE_ID_RE.test(value)) {
            errors[key] = 'Use only letters, numbers, underscores, or hyphens.';
        }
    });
    if (Object.keys(errors).length) {
        throw ValidationError('Please correct the highlighted SEO fields.', errors);
    }
    return seo;
}

function withPublicUrls(seo) {
    return {
        ...seo,
        social: {
            ...seo.social,
            ogImage: withPublicUrl(seo.social.ogImage, seo.updatedAt),
            twitterImage: withPublicUrl(seo.social.twitterImage, seo.updatedAt)
        },
        structuredData: {
            ...seo.structuredData,
            organizationLogo: withPublicUrl(seo.structuredData.organizationLogo, seo.updatedAt)
        }
    };
}

function toPublicSeo(seo) {
    const enriched = withPublicUrls(seo);
    return {
        website: enriched.website,
        social: {
            ...enriched.social,
            ogImage: enriched.social.ogImage.url || '',
            twitterImage: enriched.social.twitterImage.url || ''
        },
        searchEngine: {
            sitemapEnabled: enriched.searchEngine.sitemapEnabled,
            canonicalMode: enriched.searchEngine.canonicalMode,
            indexingRules: enriched.searchEngine.indexingRules
        },
        analytics: enriched.analytics,
        structuredData: {
            ...enriched.structuredData,
            organizationLogo: enriched.structuredData.organizationLogo.url || ''
        },
        updatedAt: enriched.updatedAt
    };
}

function buildStructuredDataGraphs(seo, extras = {}) {
    const graphs = [];
    const publicSeo = toPublicSeo(seo);
    const orgLogo = publicSeo.structuredData.organizationLogo
        || publicSeo.social.ogImage
        || 'https://byosemarket.com/img/logo.png';

    if (publicSeo.structuredData.organizationEnabled) {
        graphs.push({
            '@type': 'Organization',
            name: publicSeo.structuredData.organizationName,
            url: publicSeo.structuredData.organizationUrl || publicSeo.website.canonicalUrl,
            logo: orgLogo
        });
    }

    if (publicSeo.structuredData.websiteEnabled) {
        graphs.push({
            '@type': 'WebSite',
            name: publicSeo.website.websiteTitle,
            url: publicSeo.website.canonicalUrl,
            potentialAction: {
                '@type': 'SearchAction',
                target: `${String(publicSeo.website.canonicalUrl || '').replace(/\/$/, '')}/search.html?q={search_term_string}`,
                'query-input': 'required name=search_term_string'
            }
        });
    }

    if (publicSeo.structuredData.localBusinessEnabled) {
        graphs.push({
            '@type': publicSeo.structuredData.localBusinessType || 'Store',
            name: publicSeo.structuredData.organizationName,
            url: publicSeo.structuredData.organizationUrl || publicSeo.website.canonicalUrl,
            address: publicSeo.structuredData.localBusinessAddress
        });
    }

    if (publicSeo.structuredData.breadcrumbEnabled && Array.isArray(extras.breadcrumbs) && extras.breadcrumbs.length) {
        graphs.push({
            '@type': 'BreadcrumbList',
            itemListElement: extras.breadcrumbs.map((item, index) => ({
                '@type': 'ListItem',
                position: index + 1,
                name: item.name,
                item: item.url
            }))
        });
    }

    if (publicSeo.structuredData.productEnabled && extras.product) {
        graphs.push({
            '@type': 'Product',
            name: extras.product.name,
            image: extras.product.image,
            description: extras.product.description,
            sku: extras.product.sku || undefined,
            offers: extras.product.price != null ? {
                '@type': 'Offer',
                priceCurrency: extras.product.currency || 'RWF',
                price: extras.product.price,
                availability: 'https://schema.org/InStock'
            } : undefined
        });
    }

    return {
        '@context': 'https://schema.org',
        '@graph': graphs
    };
}

function escapeXml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function buildRobotsTxt(seo) {
    return normalizeText(seo.searchEngine.robotsTxt, DEFAULT_SEO.searchEngine.robotsTxt);
}

function buildSitemapXml(seo) {
    const now = new Date().toISOString().slice(0, 10);
    const urls = seo.searchEngine.sitemapEnabled
        ? sanitizeSitemapUrls(seo.searchEngine.sitemapUrls)
        : [];
    const body = urls.map((entry) => `
  <url>
    <loc>${escapeXml(entry.loc)}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${escapeXml(entry.changefreq || 'weekly')}</changefreq>
    <priority>${escapeXml(entry.priority || '0.5')}</priority>
  </url>`).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

async function getSeo() {
    const row = await settingsDataService.getSettings();
    const value = row?.value && typeof row.value === 'object' ? row.value : {};
    return sanitizeSeo(value.seo || {});
}

async function persistSeo(nextSeo, admin = {}) {
    const row = await settingsDataService.getSettings();
    const existingValue = row?.value && typeof row.value === 'object' ? row.value : {};
    const now = new Date().toISOString();
    const stamped = {
        ...nextSeo,
        updatedAt: now,
        updatedByAdminId: normalizeText(admin.id),
        updatedByAdminEmail: normalizeEmail(admin.email)
    };

    await settingsDataService.updateSettings({
        storeName: normalizeText(row?.storeName || existingValue.storeName, 'BYOSE Market'),
        supportEmail: normalizeEmail(row?.supportEmail || existingValue.supportEmail, 'byosemarket@gmail.com'),
        supportPhone: normalizeText(row?.supportPhone || existingValue.supportPhone),
        currency: normalizeText(row?.currency || existingValue.currency, 'RWF'),
        updatedByAdminId: normalizeText(admin.id),
        updatedByAdminEmail: normalizeEmail(admin.email),
        touchedModules: ['seo'],
        value: {
            ...existingValue,
            seo: stamped,
            branding: existingValue.branding,
            delivery: existingValue.delivery,
            sessionManagement: existingValue.sessionManagement
        }
    });

    return stamped;
}

async function updateSeo(payload = {}, admin = {}) {
    const current = await getSeo();
    const source = payload && typeof payload === 'object' ? payload : {};
    const merged = sanitizeSeo({
        ...current,
        ...source,
        website: { ...current.website, ...(source.website || {}) },
        social: { ...current.social, ...(source.social || {}) },
        searchEngine: { ...current.searchEngine, ...(source.searchEngine || {}) },
        analytics: { ...current.analytics, ...(source.analytics || {}) },
        structuredData: { ...current.structuredData, ...(source.structuredData || {}) }
    });
    const validated = validateSeo(merged);
    const saved = await persistSeo(validated, admin);
    return withPublicUrls(saved);
}

async function setSeoImage(field, assetPath, admin = {}) {
    const key = normalizeText(field);
    const allowed = new Set(['ogImage', 'twitterImage', 'organizationLogo']);
    if (!allowed.has(key)) {
        throw ValidationError('Unsupported SEO image field.', { field: 'Unsupported field.' });
    }
    const pathValue = normalizeAssetPath(assetPath);
    if (!pathValue) {
        throw ValidationError('A valid uploaded image path is required.', { path: 'Invalid path.' });
    }

    const current = await getSeo();
    if (key === 'organizationLogo') {
        current.structuredData.organizationLogo = pathValue;
    } else {
        current.social[key] = pathValue;
    }

    const saved = await persistSeo(current, admin);
    return withPublicUrls(saved);
}

async function removeSeoImage(field, admin = {}) {
    const key = normalizeText(field);
    const allowed = new Set(['ogImage', 'twitterImage', 'organizationLogo']);
    if (!allowed.has(key)) {
        throw ValidationError('Unsupported SEO image field.', { field: 'Unsupported field.' });
    }
    const current = await getSeo();
    if (key === 'organizationLogo') {
        current.structuredData.organizationLogo = '';
    } else {
        current.social[key] = '';
    }
    const saved = await persistSeo(current, admin);
    return withPublicUrls(saved);
}

function buildSeoWarnings(seo) {
    const warnings = [];
    if ((seo.website.metaTitle || '').length > 60) {
        warnings.push('Meta title is longer than 60 characters and may truncate in Google.');
    }
    if ((seo.website.metaDescription || '').length > 160) {
        warnings.push('Meta description is longer than 160 characters and may truncate in Google.');
    }
    if (!seo.social.ogImage) {
        warnings.push('Open Graph image is missing.');
    }
    if (!seo.social.twitterImage) {
        warnings.push('Twitter card image is missing.');
    }
    return warnings;
}

async function validateSeoPayload(payload = {}) {
    const current = await getSeo();
    const source = payload && typeof payload === 'object' ? payload : {};
    const merged = sanitizeSeo({
        ...current,
        ...source,
        website: { ...current.website, ...(source.website || {}) },
        social: { ...current.social, ...(source.social || {}) },
        searchEngine: { ...current.searchEngine, ...(source.searchEngine || {}) },
        analytics: { ...current.analytics, ...(source.analytics || {}) },
        structuredData: { ...current.structuredData, ...(source.structuredData || {}) }
    });
    validateSeo(merged);
    return {
        valid: true,
        warnings: buildSeoWarnings(merged)
    };
}

async function getAdminSeo() {
    return withPublicUrls(await getSeo());
}

async function getPublicSeo() {
    return toPublicSeo(await getSeo());
}

async function getRobotsTxt() {
    return buildRobotsTxt(await getSeo());
}

async function getSitemapXml() {
    return buildSitemapXml(await getSeo());
}

module.exports = {
    DEFAULT_SEO,
    buildRobotsTxt,
    buildSitemapXml,
    buildStructuredDataGraphs,
    getAdminSeo,
    getPublicSeo,
    getRobotsTxt,
    getSeo,
    getSitemapXml,
    removeSeoImage,
    sanitizeSeo,
    setSeoImage,
    toPublicSeo,
    updateSeo,
    validateSeo,
    validateSeoPayload,
    withPublicUrls
};
