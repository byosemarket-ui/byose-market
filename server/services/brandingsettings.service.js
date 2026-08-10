const settingsDataService = require('./settingsdataservice');
const {
    buildPublicUrlFromPath,
    deleteManagedFiles,
    normalizeManagedPath
} = require('./uploadstorage.service');

const BRANDING_BUCKET = 'branding';

const LOGO_KEYS = Object.freeze([
    'mainLogo',
    'whiteLogo',
    'darkLogo',
    'footerLogo',
    'mobileLogo',
    'adminLogo',
    'loginLogo',
    'emailLogo'
]);

const ICON_KEYS = Object.freeze([
    'favicon',
    'pwaIcon',
    'appleTouchIcon',
    'androidIcon',
    'browserTabIcon'
]);

const ASSET_KEYS = Object.freeze([
    'placeholderImage',
    'defaultProductImage',
    'defaultCategoryImage',
    'defaultAvatar',
    'emailBanner',
    'loadingLogo',
    'loadingAnimation'
]);

const ALL_ASSET_KEYS = Object.freeze([...LOGO_KEYS, ...ICON_KEYS, ...ASSET_KEYS]);

const DEFAULT_COLORS = Object.freeze({
    primary: '#00B894',
    secondary: '#0984E3',
    accent: '#00CEC9',
    success: '#12A874',
    warning: '#F5BA30',
    error: '#E17055',
    text: '#1F2A37',
    textMuted: '#5B6B7C',
    background: '#FFFFFF',
    backgroundAlt: '#F4F7F6'
});

const DEFAULT_IDENTITY = Object.freeze({
    tagline: 'Quality footwear from our own stock',
    slogan: 'Shop smart. Shop BYOSE.',
    brandDescription: 'BYOSE Market is a trusted Rwandan online store offering quality footwear directly from our own stock. Shop online, pay securely, and enjoy convenient delivery.',
    copyrightText: '© 2026 BYOSE Market. All rights reserved.',
    footerCopyright: '© 2026 BYOSE Market. All rights reserved.',
    businessRegistrationNumber: '',
    vatNumber: ''
});

const DEFAULT_BRANDING = Object.freeze({
    logos: Object.fromEntries(LOGO_KEYS.map((key) => [key, ''])),
    icons: Object.fromEntries(ICON_KEYS.map((key) => [key, ''])),
    assets: Object.fromEntries(ASSET_KEYS.map((key) => [key, ''])),
    colors: { ...DEFAULT_COLORS },
    identity: { ...DEFAULT_IDENTITY },
    version: 1,
    updatedAt: null,
    updatedByAdminId: '',
    updatedByAdminEmail: ''
});

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function normalizeText(value, fallback = '') {
    const text = String(value == null ? '' : value).trim();
    return text || fallback;
}

function normalizeEmail(value, fallback = '') {
    return normalizeText(value, fallback).toLowerCase();
}

function ValidationError(message, details = {}) {
    const error = new Error(message);
    error.statusCode = 400;
    error.code = 'BRANDING_VALIDATION_FAILED';
    error.details = details;
    return error;
}

function normalizeColor(value, fallback) {
    const color = normalizeText(value, fallback);
    if (!HEX_COLOR_RE.test(color)) {
        return fallback;
    }
    if (color.length === 4) {
        return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`.toUpperCase();
    }
    return color.toUpperCase();
}

function normalizeAssetPath(value) {
    if (value && typeof value === 'object') {
        value = value.path || value.url || '';
    }
    const raw = normalizeText(value);
    if (!raw) {
        return '';
    }

    if (/^https?:\/\//i.test(raw)) {
        return raw.slice(0, 500);
    }

    // Strip cache-busting query if present.
    const withoutQuery = raw.split('?')[0];
    const managed = normalizeManagedPath(withoutQuery);
    if (!managed) {
        return '';
    }

    if (!managed.startsWith(`${BRANDING_BUCKET}/`) && !managed.startsWith('hero/') && !managed.startsWith('products/')) {
        return '';
    }

    return managed.slice(0, 260);
}

function emptyMap(keys) {
    return Object.fromEntries(keys.map((key) => [key, '']));
}

function mergeAssetMap(keys, source = {}, fallback = {}) {
    const next = emptyMap(keys);
    keys.forEach((key) => {
        next[key] = normalizeAssetPath(source[key] != null ? source[key] : fallback[key]);
    });
    return next;
}

function mergeColors(source = {}, fallback = DEFAULT_COLORS) {
    return {
        primary: normalizeColor(source.primary, fallback.primary),
        secondary: normalizeColor(source.secondary, fallback.secondary),
        accent: normalizeColor(source.accent, fallback.accent),
        success: normalizeColor(source.success, fallback.success),
        warning: normalizeColor(source.warning, fallback.warning),
        error: normalizeColor(source.error, fallback.error),
        text: normalizeColor(source.text, fallback.text),
        textMuted: normalizeColor(source.textMuted, fallback.textMuted),
        background: normalizeColor(source.background, fallback.background),
        backgroundAlt: normalizeColor(source.backgroundAlt, fallback.backgroundAlt)
    };
}

function mergeIdentity(source = {}, fallback = DEFAULT_IDENTITY) {
    return {
        tagline: normalizeText(source.tagline, fallback.tagline).slice(0, 160),
        slogan: normalizeText(source.slogan, fallback.slogan).slice(0, 160),
        brandDescription: normalizeText(source.brandDescription, fallback.brandDescription).slice(0, 600),
        copyrightText: normalizeText(source.copyrightText, fallback.copyrightText).slice(0, 200),
        footerCopyright: normalizeText(source.footerCopyright, fallback.footerCopyright).slice(0, 200),
        businessRegistrationNumber: normalizeText(source.businessRegistrationNumber, fallback.businessRegistrationNumber).slice(0, 80),
        vatNumber: normalizeText(source.vatNumber, fallback.vatNumber).slice(0, 80)
    };
}

function sanitizeBranding(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        logos: mergeAssetMap(LOGO_KEYS, source.logos || source, DEFAULT_BRANDING.logos),
        icons: mergeAssetMap(ICON_KEYS, source.icons || source, DEFAULT_BRANDING.icons),
        assets: mergeAssetMap(ASSET_KEYS, source.assets || source, DEFAULT_BRANDING.assets),
        colors: mergeColors(source.colors || {}, DEFAULT_COLORS),
        identity: mergeIdentity(source.identity || source, DEFAULT_IDENTITY),
        version: Math.max(1, Number(source.version) || 1),
        updatedAt: source.updatedAt || null,
        updatedByAdminId: normalizeText(source.updatedByAdminId),
        updatedByAdminEmail: normalizeEmail(source.updatedByAdminEmail)
    };
}

function validateBranding(branding) {
    const errors = {};
    Object.entries(branding.colors || {}).forEach(([key, value]) => {
        if (!HEX_COLOR_RE.test(String(value || ''))) {
            errors[`colors.${key}`] = 'Enter a valid hex color.';
        }
    });

    if (!branding.identity?.tagline) {
        errors.tagline = 'Tagline is required.';
    }

    if (Object.keys(errors).length) {
        throw ValidationError('Please correct the highlighted branding fields.', errors);
    }

    return branding;
}

function resolveAssetGroup(assetKey) {
    if (LOGO_KEYS.includes(assetKey)) return 'logos';
    if (ICON_KEYS.includes(assetKey)) return 'icons';
    if (ASSET_KEYS.includes(assetKey)) return 'assets';
    return '';
}

function withPublicUrls(branding) {
    const mapUrls = (group) => Object.fromEntries(
        Object.entries(group || {}).map(([key, value]) => {
            const pathValue = normalizeText(value);
            if (!pathValue) {
                return [key, { path: '', url: '' }];
            }
            if (/^https?:\/\//i.test(pathValue)) {
                return [key, { path: pathValue, url: pathValue }];
            }
            const url = buildPublicUrlFromPath(pathValue);
            const cacheToken = branding.updatedAt ? `?v=${encodeURIComponent(branding.updatedAt)}` : '';
            return [key, { path: pathValue, url: `${url}${cacheToken}` }];
        })
    );

    return {
        ...branding,
        logos: mapUrls(branding.logos),
        icons: mapUrls(branding.icons),
        assets: mapUrls(branding.assets)
    };
}

function toPublicBranding(branding) {
    const enriched = withPublicUrls(branding);
    return {
        logos: Object.fromEntries(Object.entries(enriched.logos).map(([k, v]) => [k, v.url || ''])),
        icons: Object.fromEntries(Object.entries(enriched.icons).map(([k, v]) => [k, v.url || ''])),
        assets: Object.fromEntries(Object.entries(enriched.assets).map(([k, v]) => [k, v.url || ''])),
        colors: enriched.colors,
        identity: enriched.identity,
        version: enriched.version,
        updatedAt: enriched.updatedAt
    };
}

async function getBranding() {
    const row = await settingsDataService.getSettings();
    const value = row?.value && typeof row.value === 'object' ? row.value : {};
    return sanitizeBranding(value.branding || {});
}

async function persistBranding(nextBranding, admin = {}) {
    const row = await settingsDataService.getSettings();
    const existingValue = row?.value && typeof row.value === 'object' ? row.value : {};
    const now = new Date().toISOString();
    const bump = Boolean(nextBranding._bumpVersion);
    const stamped = {
        ...nextBranding,
        version: Math.max(1, Number(nextBranding.version || 1)) + (bump ? 1 : 0),
        updatedAt: now,
        updatedByAdminId: normalizeText(admin.id),
        updatedByAdminEmail: normalizeEmail(admin.email)
    };
    delete stamped._bumpVersion;

    await settingsDataService.updateSettings({
        storeName: normalizeText(row?.storeName || existingValue.storeName, 'BYOSE Market'),
        supportEmail: normalizeEmail(row?.supportEmail || existingValue.supportEmail, 'byosemarket@gmail.com'),
        supportPhone: normalizeText(row?.supportPhone || existingValue.supportPhone),
        currency: normalizeText(row?.currency || existingValue.currency, 'RWF'),
        updatedByAdminId: normalizeText(admin.id),
        updatedByAdminEmail: normalizeEmail(admin.email),
        touchedModules: ['branding'],
        value: {
            ...existingValue,
            branding: stamped,
            delivery: existingValue.delivery,
            seo: existingValue.seo,
            sessionManagement: existingValue.sessionManagement
        }
    });

    return stamped;
}

async function updateBranding(payload = {}, admin = {}) {
    const current = await getBranding();
    const source = payload && typeof payload === 'object' ? payload : {};

    if (source.colors && typeof source.colors === 'object') {
        const colorErrors = {};
        Object.entries(source.colors).forEach(([key, value]) => {
            const text = String(value == null ? '' : value).trim();
            if (text && !HEX_COLOR_RE.test(text)) {
                colorErrors[`colors.${key}`] = 'Enter a valid hex color.';
            }
        });
        if (Object.keys(colorErrors).length) {
            throw ValidationError('Please correct the highlighted branding fields.', colorErrors);
        }
    }

    const merged = sanitizeBranding({
        ...current,
        ...source,
        logos: {
            ...current.logos,
            ...(source.logos && typeof source.logos === 'object' ? source.logos : {})
        },
        icons: {
            ...current.icons,
            ...(source.icons && typeof source.icons === 'object' ? source.icons : {})
        },
        assets: {
            ...current.assets,
            ...(source.assets && typeof source.assets === 'object' ? source.assets : {})
        },
        colors: {
            ...current.colors,
            ...(source.colors && typeof source.colors === 'object' ? source.colors : {})
        },
        identity: {
            ...current.identity,
            ...(source.identity && typeof source.identity === 'object' ? source.identity : {})
        },
        version: current.version
    });

    const validated = validateBranding(merged);
    validated._bumpVersion = true;
    validated.version = current.version;
    const saved = await persistBranding(validated, admin);
    return withPublicUrls(saved);
}

async function setBrandingAsset(assetKey, assetPath, admin = {}) {
    const key = normalizeText(assetKey);
    const group = resolveAssetGroup(key);
    if (!group) {
        throw ValidationError('Unknown branding asset key.', { assetKey: 'Unsupported asset key.' });
    }

    const pathValue = normalizeAssetPath(assetPath);
    if (!pathValue) {
        throw ValidationError('A valid uploaded branding asset path is required.', { path: 'Invalid asset path.' });
    }

    const current = await getBranding();
    const previous = current[group][key];
    current[group][key] = pathValue;
    current._bumpVersion = true;
    const saved = await persistBranding(current, admin);

    if (previous && previous !== pathValue && !/^https?:\/\//i.test(previous)) {
        try {
            deleteManagedFiles([previous]);
        } catch (_error) {
            // Non-blocking cleanup.
        }
    }

    return {
        assetKey: key,
        group,
        branding: withPublicUrls(saved)
    };
}

async function removeBrandingAsset(assetKey, admin = {}) {
    const key = normalizeText(assetKey);
    const group = resolveAssetGroup(key);
    if (!group) {
        throw ValidationError('Unknown branding asset key.', { assetKey: 'Unsupported asset key.' });
    }

    const current = await getBranding();
    const previous = current[group][key];
    current[group][key] = '';
    current._bumpVersion = true;
    const saved = await persistBranding(current, admin);

    if (previous && !/^https?:\/\//i.test(previous)) {
        try {
            deleteManagedFiles([previous]);
        } catch (_error) {
            // Non-blocking cleanup.
        }
    }

    return {
        assetKey: key,
        group,
        branding: withPublicUrls(saved)
    };
}

async function getPublicBranding() {
    const branding = await getBranding();
    return toPublicBranding(branding);
}

async function getAdminBranding() {
    const branding = await getBranding();
    return withPublicUrls(branding);
}

module.exports = {
    ALL_ASSET_KEYS,
    ASSET_KEYS,
    BRANDING_BUCKET,
    DEFAULT_BRANDING,
    DEFAULT_COLORS,
    DEFAULT_IDENTITY,
    ICON_KEYS,
    LOGO_KEYS,
    getAdminBranding,
    getBranding,
    getPublicBranding,
    removeBrandingAsset,
    sanitizeBranding,
    setBrandingAsset,
    toPublicBranding,
    updateBranding,
    validateBranding,
    withPublicUrls
};
