const settingsDataService = require('./settingsdataservice');
const { getRepositoryBundle } = require('../repositories');

const METHOD_KEYS = Object.freeze([
    'homeDelivery',
    'storePickup',
    'expressDelivery',
    'sameDayDelivery',
    'scheduledDelivery'
]);

const DEFAULT_METHODS = Object.freeze({
    homeDelivery: { enabled: true, label: 'Home Delivery', feeModifier: 0 },
    storePickup: { enabled: true, label: 'Store Pickup', feeModifier: 0 },
    expressDelivery: { enabled: false, label: 'Express Delivery', feeModifier: 1500 },
    sameDayDelivery: { enabled: false, label: 'Same-Day Delivery', feeModifier: 2500 },
    scheduledDelivery: { enabled: false, label: 'Scheduled Delivery', feeModifier: 500 }
});

const DEFAULT_DELIVERY = Object.freeze({
    pricing: {
        mode: 'zone', // fixed | zone
        fixedFee: 2000,
        freeDeliveryThreshold: 0,
        minimumOrderAmount: 0,
        maxDeliveryDistanceKm: 0
    },
    methods: { ...DEFAULT_METHODS },
    timing: {
        businessDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
        deliveryHoursStart: '08:00',
        deliveryHoursEnd: '18:00',
        estimatedDeliveryTime: '1–3 business days',
        processingTime: '4–12 hours',
        holidayExceptions: []
    },
    updatedAt: null,
    updatedByAdminId: '',
    updatedByAdminEmail: ''
});

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

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function ValidationError(message, details = {}) {
    const error = new Error(message);
    error.statusCode = 400;
    error.code = 'DELIVERY_VALIDATION_FAILED';
    error.details = details;
    return error;
}

function normalizeLocationToken(value) {
    return normalizeText(value).toLowerCase().replace(/\s+/g, ' ');
}

function mergeMethods(source = {}, fallback = DEFAULT_METHODS) {
    const next = {};
    METHOD_KEYS.forEach((key) => {
        const incoming = source[key] && typeof source[key] === 'object' ? source[key] : {};
        const base = fallback[key] || DEFAULT_METHODS[key];
        next[key] = {
            enabled: normalizeBoolean(incoming.enabled, base.enabled),
            label: normalizeText(incoming.label, base.label).slice(0, 80),
            feeModifier: toNumber(incoming.feeModifier, base.feeModifier)
        };
    });
    return next;
}

function mergeTiming(source = {}, fallback = DEFAULT_DELIVERY.timing) {
    const days = Array.isArray(source.businessDays)
        ? source.businessDays.map((day) => normalizeText(day).toLowerCase()).filter(Boolean)
        : fallback.businessDays;
    const holidays = Array.isArray(source.holidayExceptions)
        ? source.holidayExceptions.map((entry) => normalizeText(entry)).filter(Boolean).slice(0, 60)
        : fallback.holidayExceptions;

    return {
        businessDays: days.length ? days : fallback.businessDays,
        deliveryHoursStart: normalizeText(source.deliveryHoursStart, fallback.deliveryHoursStart).slice(0, 8),
        deliveryHoursEnd: normalizeText(source.deliveryHoursEnd, fallback.deliveryHoursEnd).slice(0, 8),
        estimatedDeliveryTime: normalizeText(source.estimatedDeliveryTime, fallback.estimatedDeliveryTime).slice(0, 120),
        processingTime: normalizeText(source.processingTime, fallback.processingTime).slice(0, 120),
        holidayExceptions: holidays
    };
}

function sanitizeDeliveryConfig(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const pricingSource = source.pricing && typeof source.pricing === 'object' ? source.pricing : source;
    const mode = normalizeText(pricingSource.mode, DEFAULT_DELIVERY.pricing.mode).toLowerCase();

    return {
        pricing: {
            mode: mode === 'fixed' ? 'fixed' : 'zone',
            fixedFee: Math.max(0, toNumber(pricingSource.fixedFee, DEFAULT_DELIVERY.pricing.fixedFee)),
            freeDeliveryThreshold: Math.max(0, toNumber(pricingSource.freeDeliveryThreshold, 0)),
            minimumOrderAmount: Math.max(0, toNumber(pricingSource.minimumOrderAmount, 0)),
            maxDeliveryDistanceKm: Math.max(0, toNumber(pricingSource.maxDeliveryDistanceKm, 0))
        },
        methods: mergeMethods(source.methods || {}, DEFAULT_METHODS),
        timing: mergeTiming(source.timing || {}, DEFAULT_DELIVERY.timing),
        updatedAt: source.updatedAt || null,
        updatedByAdminId: normalizeText(source.updatedByAdminId),
        updatedByAdminEmail: normalizeEmail(source.updatedByAdminEmail)
    };
}

function validateDeliveryConfig(config) {
    const errors = {};
    if (!['fixed', 'zone'].includes(config.pricing.mode)) {
        errors.mode = 'Pricing mode must be fixed or zone.';
    }
    if (config.pricing.fixedFee < 0) {
        errors.fixedFee = 'Fixed fee cannot be negative.';
    }
    if (!config.timing.businessDays.length) {
        errors.businessDays = 'Select at least one business day.';
    }
    if (Object.keys(errors).length) {
        throw ValidationError('Please correct the highlighted delivery fields.', errors);
    }
    return config;
}

function validateZonePayload(payload = {}, { partial = false } = {}) {
    const errors = {};
    const name = normalizeText(payload.name);
    if (!partial || payload.name != null) {
        if (!name || name.length < 2) errors.name = 'Zone name is required.';
    }
    if (payload.fee != null && toNumber(payload.fee, -1) < 0) {
        errors.fee = 'Fee cannot be negative.';
    }
    if (Object.keys(errors).length) {
        throw ValidationError('Please correct the zone fields.', errors);
    }
    return {
        name: name || undefined,
        country: normalizeText(payload.country, 'Rwanda'),
        provinceCity: normalizeText(payload.provinceCity),
        district: normalizeText(payload.district),
        sector: normalizeText(payload.sector),
        cell: normalizeText(payload.cell),
        village: normalizeText(payload.village),
        fee: Math.max(0, toNumber(payload.fee, 2000)),
        estimatedDaysMin: Math.max(0, toNumber(payload.estimatedDaysMin, 1)),
        estimatedDaysMax: Math.max(0, toNumber(payload.estimatedDaysMax, 3)),
        enabled: normalizeBoolean(payload.enabled, true),
        sortOrder: toNumber(payload.sortOrder, 0),
        notes: normalizeText(payload.notes).slice(0, 240)
    };
}

function zoneSpecificity(zone) {
    let score = 0;
    if (normalizeLocationToken(zone.country)) score += 1;
    if (normalizeLocationToken(zone.provinceCity)) score += 2;
    if (normalizeLocationToken(zone.district)) score += 4;
    if (normalizeLocationToken(zone.sector)) score += 8;
    if (normalizeLocationToken(zone.cell)) score += 16;
    if (normalizeLocationToken(zone.village)) score += 32;
    return score;
}

function zoneMatchesAddress(zone, address = {}) {
    const checks = [
        ['country', address.country || 'Rwanda'],
        ['provinceCity', address.provinceCity || address.city || address.province],
        ['district', address.district],
        ['sector', address.sector],
        ['cell', address.cell],
        ['village', address.village]
    ];

    for (const [field, addressValue] of checks) {
        const zoneValue = normalizeLocationToken(zone[field]);
        if (!zoneValue) continue;
        const target = normalizeLocationToken(addressValue);
        if (!target || target !== zoneValue) {
            return false;
        }
    }
    return true;
}

function findBestZone(zones, address) {
    const matches = (zones || [])
        .filter((zone) => zone.enabled)
        .filter((zone) => zoneMatchesAddress(zone, address))
        .sort((a, b) => zoneSpecificity(b) - zoneSpecificity(a) || a.sortOrder - b.sortOrder);

    return matches[0] || null;
}

function getZonesRepo() {
    const repos = getRepositoryBundle();
    if (!repos.deliveryZones) {
        throw new Error('Delivery zones repository is unavailable.');
    }
    return repos.deliveryZones;
}

async function getDeliveryConfig() {
    const row = await settingsDataService.getSettings();
    const value = row?.value && typeof row.value === 'object' ? row.value : {};
    return sanitizeDeliveryConfig(value.delivery || {});
}

async function persistDeliveryConfig(nextConfig, admin = {}) {
    const row = await settingsDataService.getSettings();
    const existingValue = row?.value && typeof row.value === 'object' ? row.value : {};
    const now = new Date().toISOString();
    const stamped = {
        ...nextConfig,
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
        touchedModules: ['delivery'],
        value: {
            ...existingValue,
            delivery: stamped,
            branding: existingValue.branding,
            seo: existingValue.seo,
            sessionManagement: existingValue.sessionManagement
        }
    });

    return stamped;
}

async function updateDeliveryConfig(payload = {}, admin = {}) {
    const current = await getDeliveryConfig();
    const source = payload && typeof payload === 'object' ? payload : {};
    const merged = sanitizeDeliveryConfig({
        ...current,
        ...source,
        pricing: {
            ...current.pricing,
            ...(source.pricing && typeof source.pricing === 'object' ? source.pricing : source)
        },
        methods: {
            ...current.methods,
            ...(source.methods && typeof source.methods === 'object' ? source.methods : {})
        },
        timing: {
            ...current.timing,
            ...(source.timing && typeof source.timing === 'object' ? source.timing : {})
        }
    });
    const validated = validateDeliveryConfig(merged);
    return persistDeliveryConfig(validated, admin);
}

async function listZones({ includeDisabled = true } = {}) {
    return getZonesRepo().list({ includeDisabled });
}

async function createZone(payload, admin = {}) {
    const validated = validateZonePayload(payload);
    const zone = await getZonesRepo().create(validated);
    void admin;
    return zone;
}

async function updateZone(publicId, payload, admin = {}) {
    const existing = await getZonesRepo().findByPublicId(publicId);
    if (!existing) {
        const error = new Error('Delivery zone not found.');
        error.statusCode = 404;
        error.code = 'DELIVERY_ZONE_NOT_FOUND';
        throw error;
    }
    const validated = validateZonePayload({ ...existing, ...payload }, { partial: true });
    const zone = await getZonesRepo().update(publicId, {
        ...existing,
        ...validated,
        enabled: payload.enabled != null ? normalizeBoolean(payload.enabled, existing.enabled) : existing.enabled
    });
    void admin;
    return zone;
}

async function deleteZone(publicId) {
    const removed = await getZonesRepo().remove(publicId);
    if (!removed) {
        const error = new Error('Delivery zone not found.');
        error.statusCode = 404;
        error.code = 'DELIVERY_ZONE_NOT_FOUND';
        throw error;
    }
    return true;
}

function listEnabledMethods(config) {
    return METHOD_KEYS
        .filter((key) => config.methods[key]?.enabled)
        .map((key) => ({
            id: key,
            label: config.methods[key].label,
            feeModifier: config.methods[key].feeModifier
        }));
}

async function calculateShipping({
    subtotal = 0,
    address = {},
    method = 'homeDelivery',
    distanceKm = null
} = {}) {
    const config = await getDeliveryConfig();
    const zones = await listZones({ includeDisabled: false });
    const safeSubtotal = Math.max(0, toNumber(subtotal, 0));
    const methodKey = METHOD_KEYS.includes(method) ? method : 'homeDelivery';
    const methodConfig = config.methods[methodKey];

    if (!methodConfig?.enabled) {
        const error = new Error('Selected delivery method is not available.');
        error.statusCode = 400;
        error.code = 'DELIVERY_METHOD_DISABLED';
        throw error;
    }

    if (config.pricing.minimumOrderAmount > 0 && safeSubtotal < config.pricing.minimumOrderAmount) {
        const error = new Error(`Minimum order amount is ${config.pricing.minimumOrderAmount} RWF.`);
        error.statusCode = 400;
        error.code = 'MINIMUM_ORDER_NOT_MET';
        error.details = { minimumOrderAmount: config.pricing.minimumOrderAmount };
        throw error;
    }

    if (
        config.pricing.maxDeliveryDistanceKm > 0
        && distanceKm != null
        && Number(distanceKm) > config.pricing.maxDeliveryDistanceKm
    ) {
        const error = new Error('Delivery address is outside the maximum delivery distance.');
        error.statusCode = 400;
        error.code = 'DELIVERY_DISTANCE_EXCEEDED';
        throw error;
    }

    let baseFee = config.pricing.fixedFee;
    let matchedZone = null;

    if (config.pricing.mode === 'zone') {
        matchedZone = findBestZone(zones, address);
        if (!matchedZone) {
            // Fall back to fixed fee when no zone matches, keeping checkout usable.
            baseFee = config.pricing.fixedFee;
        } else {
            baseFee = matchedZone.fee;
        }
    }

    if (methodKey === 'storePickup') {
        baseFee = 0;
    }

    let fee = Math.max(0, baseFee + toNumber(methodConfig.feeModifier, 0));
    let freeDeliveryApplied = false;

    if (config.pricing.freeDeliveryThreshold > 0 && safeSubtotal >= config.pricing.freeDeliveryThreshold) {
        fee = 0;
        freeDeliveryApplied = true;
    }

    if (methodKey === 'storePickup') {
        fee = 0;
        freeDeliveryApplied = false;
    }

    const estimatedDelivery = matchedZone
        ? `${matchedZone.estimatedDaysMin}–${matchedZone.estimatedDaysMax} days`
        : config.timing.estimatedDeliveryTime;

    return {
        fee,
        currency: 'RWF',
        method: methodKey,
        methodLabel: methodConfig.label,
        pricingMode: config.pricing.mode,
        freeDeliveryApplied,
        freeDeliveryThreshold: config.pricing.freeDeliveryThreshold,
        minimumOrderAmount: config.pricing.minimumOrderAmount,
        zone: matchedZone
            ? {
                id: matchedZone.publicId,
                name: matchedZone.name,
                fee: matchedZone.fee,
                estimatedDaysMin: matchedZone.estimatedDaysMin,
                estimatedDaysMax: matchedZone.estimatedDaysMax
            }
            : null,
        estimatedDelivery,
        processingTime: config.timing.processingTime,
        deliveryHours: {
            start: config.timing.deliveryHoursStart,
            end: config.timing.deliveryHoursEnd
        },
        businessDays: config.timing.businessDays,
        holidayExceptions: config.timing.holidayExceptions,
        availableMethods: listEnabledMethods(config),
        available: Boolean(matchedZone) || config.pricing.mode === 'fixed' || methodKey === 'storePickup'
    };
}

async function getAdminDeliverySettings() {
    const [config, zones] = await Promise.all([
        getDeliveryConfig(),
        listZones({ includeDisabled: true })
    ]);

    return {
        config,
        zones,
        coverage: {
            totalZones: zones.length,
            activeZones: zones.filter((zone) => zone.enabled).length,
            disabledZones: zones.filter((zone) => !zone.enabled).length
        }
    };
}

async function getPublicDeliverySettings() {
    const config = await getDeliveryConfig();
    const zones = await listZones({ includeDisabled: false });
    return {
        pricing: {
            mode: config.pricing.mode,
            fixedFee: config.pricing.fixedFee,
            freeDeliveryThreshold: config.pricing.freeDeliveryThreshold,
            minimumOrderAmount: config.pricing.minimumOrderAmount,
            maxDeliveryDistanceKm: config.pricing.maxDeliveryDistanceKm
        },
        methods: listEnabledMethods(config),
        timing: {
            businessDays: config.timing.businessDays,
            deliveryHoursStart: config.timing.deliveryHoursStart,
            deliveryHoursEnd: config.timing.deliveryHoursEnd,
            estimatedDeliveryTime: config.timing.estimatedDeliveryTime,
            processingTime: config.timing.processingTime
        },
        zones: zones.map((zone) => ({
            id: zone.publicId,
            name: zone.name,
            country: zone.country,
            provinceCity: zone.provinceCity,
            district: zone.district,
            sector: zone.sector,
            cell: zone.cell,
            village: zone.village,
            fee: zone.fee,
            estimatedDaysMin: zone.estimatedDaysMin,
            estimatedDaysMax: zone.estimatedDaysMax
        }))
    };
}

module.exports = {
    DEFAULT_DELIVERY,
    METHOD_KEYS,
    calculateShipping,
    createZone,
    deleteZone,
    getAdminDeliverySettings,
    getDeliveryConfig,
    getPublicDeliverySettings,
    listZones,
    sanitizeDeliveryConfig,
    updateDeliveryConfig,
    updateZone,
    validateDeliveryConfig
};
