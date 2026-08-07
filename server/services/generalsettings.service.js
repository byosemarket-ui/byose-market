const settingsDataService = require('./settingsdataservice');

const SETTINGS_KEY = 'global';

const DEFAULT_GENERAL_SETTINGS = Object.freeze({
    storeName: 'BYOSE Market',
    companyName: 'BYOSE Market Ltd',
    companyEmail: 'byosemarket@gmail.com',
    supportEmail: 'byosemarket@gmail.com',
    supportPhone: '',
    whatsappNumber: '',
    companyAddress: '',
    country: 'Rwanda',
    provinceCity: 'Kigali',
    websiteUrl: 'https://byosemarket.com',

    defaultCountry: 'Rwanda',
    currency: 'RWF',
    currencySymbol: 'RWF',
    language: 'en',
    timeZone: 'Africa/Kigali',
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '24h',
    numberFormat: 'en-US',

    maintenanceMode: false,
    storeStatus: 'open',
    allowCustomerRegistration: true,
    allowGuestCheckout: true,
    defaultCustomerRole: 'user',
    defaultOrderStatus: 'Pending',
    defaultPaymentStatus: 'pending',

    defaultSupportEmail: 'byosemarket@gmail.com',
    customerServicePhone: '',
    whatsappContact: '',
    businessHours: 'Mon–Sat 08:00–18:00',
    emergencyContact: '',

    notifications: {
        emailNotifications: true,
        orderNotifications: true,
        customerRegistrationNotifications: true,
        contactFormNotifications: true,
        lowStockNotifications: true,
        systemNotifications: true
    }
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i;
const ALLOWED_CURRENCIES = new Set(['RWF', 'USD', 'EUR', 'KES', 'UGX', 'TZS']);
const ALLOWED_LANGUAGES = new Set(['en', 'fr', 'rw', 'sw']);
const ALLOWED_TIME_FORMATS = new Set(['12h', '24h']);
const ALLOWED_DATE_FORMATS = new Set(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']);
const ALLOWED_STORE_STATUS = new Set(['open', 'closed']);
const ALLOWED_ORDER_STATUS = new Set(['Pending', 'Processing', 'Confirmed']);
const ALLOWED_PAYMENT_STATUS = new Set(['pending', 'paid', 'unpaid']);

function normalizeText(value, fallback = '') {
    const text = String(value == null ? '' : value).trim();
    return text || fallback;
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const text = String(value == null ? '' : value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(text)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(text)) return false;
    return Boolean(fallback);
}

function normalizeEmail(value, fallback = '') {
    const email = normalizeText(value, fallback).toLowerCase();
    return email;
}

function ValidationError(message, details = {}) {
    const error = new Error(message);
    error.statusCode = 400;
    error.code = 'GENERAL_SETTINGS_VALIDATION_FAILED';
    error.details = details;
    return error;
}

function mergeNotifications(raw = {}, fallback = DEFAULT_GENERAL_SETTINGS.notifications) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        emailNotifications: normalizeBoolean(source.emailNotifications, fallback.emailNotifications),
        orderNotifications: normalizeBoolean(source.orderNotifications, fallback.orderNotifications),
        customerRegistrationNotifications: normalizeBoolean(
            source.customerRegistrationNotifications,
            fallback.customerRegistrationNotifications
        ),
        contactFormNotifications: normalizeBoolean(
            source.contactFormNotifications,
            fallback.contactFormNotifications
        ),
        lowStockNotifications: normalizeBoolean(source.lowStockNotifications, fallback.lowStockNotifications),
        systemNotifications: normalizeBoolean(source.systemNotifications, fallback.systemNotifications)
    };
}

function flattenFromRow(row) {
    const value = row?.value && typeof row.value === 'object' ? row.value : {};
    return {
        ...DEFAULT_GENERAL_SETTINGS,
        ...value,
        storeName: normalizeText(row?.storeName || value.storeName, DEFAULT_GENERAL_SETTINGS.storeName),
        supportEmail: normalizeEmail(row?.supportEmail || value.supportEmail, DEFAULT_GENERAL_SETTINGS.supportEmail),
        supportPhone: normalizeText(row?.supportPhone || value.supportPhone, DEFAULT_GENERAL_SETTINGS.supportPhone),
        currency: normalizeText(row?.currency || value.currency, DEFAULT_GENERAL_SETTINGS.currency).toUpperCase(),
        notifications: mergeNotifications(value.notifications),
        updatedAt: row?.updatedAt || value.updatedAt || null,
        updatedByAdminId: row?.updatedByAdminId || '',
        updatedByAdminEmail: row?.updatedByAdminEmail || ''
    };
}

function sanitizeGeneralSettings(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const notifications = mergeNotifications(source.notifications);

    const settings = {
        storeName: normalizeText(source.storeName, DEFAULT_GENERAL_SETTINGS.storeName).slice(0, 120),
        companyName: normalizeText(source.companyName, DEFAULT_GENERAL_SETTINGS.companyName).slice(0, 120),
        companyEmail: normalizeEmail(source.companyEmail, DEFAULT_GENERAL_SETTINGS.companyEmail).slice(0, 160),
        supportEmail: normalizeEmail(source.supportEmail, DEFAULT_GENERAL_SETTINGS.supportEmail).slice(0, 160),
        supportPhone: normalizeText(source.supportPhone).slice(0, 40),
        whatsappNumber: normalizeText(source.whatsappNumber || source.whatsappContact).slice(0, 40),
        companyAddress: normalizeText(source.companyAddress).slice(0, 240),
        country: normalizeText(source.country, DEFAULT_GENERAL_SETTINGS.country).slice(0, 80),
        provinceCity: normalizeText(source.provinceCity, DEFAULT_GENERAL_SETTINGS.provinceCity).slice(0, 120),
        websiteUrl: normalizeText(source.websiteUrl, DEFAULT_GENERAL_SETTINGS.websiteUrl).slice(0, 240),

        defaultCountry: normalizeText(source.defaultCountry || source.country, DEFAULT_GENERAL_SETTINGS.defaultCountry).slice(0, 80),
        currency: normalizeText(source.currency, DEFAULT_GENERAL_SETTINGS.currency).toUpperCase().slice(0, 8),
        currencySymbol: normalizeText(source.currencySymbol || source.currency, DEFAULT_GENERAL_SETTINGS.currencySymbol).slice(0, 12),
        language: normalizeText(source.language, DEFAULT_GENERAL_SETTINGS.language).toLowerCase().slice(0, 8),
        timeZone: normalizeText(source.timeZone, DEFAULT_GENERAL_SETTINGS.timeZone).slice(0, 64),
        dateFormat: normalizeText(source.dateFormat, DEFAULT_GENERAL_SETTINGS.dateFormat).slice(0, 32),
        timeFormat: normalizeText(source.timeFormat, DEFAULT_GENERAL_SETTINGS.timeFormat).slice(0, 8),
        numberFormat: normalizeText(source.numberFormat, DEFAULT_GENERAL_SETTINGS.numberFormat).slice(0, 32),

        maintenanceMode: normalizeBoolean(source.maintenanceMode, false),
        storeStatus: normalizeText(source.storeStatus, 'open').toLowerCase(),
        allowCustomerRegistration: normalizeBoolean(source.allowCustomerRegistration, true),
        allowGuestCheckout: normalizeBoolean(source.allowGuestCheckout, true),
        defaultCustomerRole: normalizeText(source.defaultCustomerRole, 'user').toLowerCase().slice(0, 32),
        defaultOrderStatus: normalizeText(source.defaultOrderStatus, 'Pending').slice(0, 40),
        defaultPaymentStatus: normalizeText(source.defaultPaymentStatus, 'pending').toLowerCase().slice(0, 40),

        defaultSupportEmail: normalizeEmail(
            source.defaultSupportEmail || source.supportEmail,
            DEFAULT_GENERAL_SETTINGS.defaultSupportEmail
        ).slice(0, 160),
        customerServicePhone: normalizeText(
            source.customerServicePhone || source.supportPhone
        ).slice(0, 40),
        whatsappContact: normalizeText(
            source.whatsappContact || source.whatsappNumber
        ).slice(0, 40),
        businessHours: normalizeText(source.businessHours, DEFAULT_GENERAL_SETTINGS.businessHours).slice(0, 160),
        emergencyContact: normalizeText(source.emergencyContact).slice(0, 80),

        notifications,
        updatedAt: source.updatedAt || null,
        updatedByAdminId: normalizeText(source.updatedByAdminId),
        updatedByAdminEmail: normalizeEmail(source.updatedByAdminEmail)
    };

    if (!settings.currencySymbol) {
        settings.currencySymbol = settings.currency;
    }
    if (!settings.whatsappNumber && settings.whatsappContact) {
        settings.whatsappNumber = settings.whatsappContact;
    }
    if (!settings.whatsappContact && settings.whatsappNumber) {
        settings.whatsappContact = settings.whatsappNumber;
    }

    return settings;
}

function validateGeneralSettings(settings) {
    const errors = {};

    if (!settings.storeName || settings.storeName.length < 2) {
        errors.storeName = 'Store name is required.';
    }
    if (settings.companyEmail && !EMAIL_RE.test(settings.companyEmail)) {
        errors.companyEmail = 'Enter a valid company email.';
    }
    if (settings.supportEmail && !EMAIL_RE.test(settings.supportEmail)) {
        errors.supportEmail = 'Enter a valid support email.';
    }
    if (settings.defaultSupportEmail && !EMAIL_RE.test(settings.defaultSupportEmail)) {
        errors.defaultSupportEmail = 'Enter a valid support email.';
    }
    if (settings.websiteUrl && !URL_RE.test(settings.websiteUrl)) {
        errors.websiteUrl = 'Enter a valid website URL.';
    }
    if (!ALLOWED_CURRENCIES.has(settings.currency)) {
        errors.currency = 'Unsupported currency.';
    }
    if (!ALLOWED_LANGUAGES.has(settings.language)) {
        errors.language = 'Unsupported language.';
    }
    if (!ALLOWED_DATE_FORMATS.has(settings.dateFormat)) {
        errors.dateFormat = 'Unsupported date format.';
    }
    if (!ALLOWED_TIME_FORMATS.has(settings.timeFormat)) {
        errors.timeFormat = 'Unsupported time format.';
    }
    if (!ALLOWED_STORE_STATUS.has(settings.storeStatus)) {
        errors.storeStatus = 'Store status must be open or closed.';
    }
    if (!ALLOWED_ORDER_STATUS.has(settings.defaultOrderStatus)) {
        errors.defaultOrderStatus = 'Unsupported default order status.';
    }
    if (!ALLOWED_PAYMENT_STATUS.has(settings.defaultPaymentStatus)) {
        errors.defaultPaymentStatus = 'Unsupported default payment status.';
    }
    if (settings.defaultCustomerRole !== 'user') {
        errors.defaultCustomerRole = 'Default customer role must be user.';
    }

    if (Object.keys(errors).length) {
        throw ValidationError('Please correct the highlighted settings fields.', errors);
    }

    return settings;
}

function toPublicSettings(settings) {
    return {
        storeName: settings.storeName,
        companyName: settings.companyName,
        companyEmail: settings.companyEmail,
        supportEmail: settings.supportEmail,
        supportPhone: settings.supportPhone,
        whatsappNumber: settings.whatsappNumber,
        companyAddress: settings.companyAddress,
        country: settings.country,
        provinceCity: settings.provinceCity,
        websiteUrl: settings.websiteUrl,
        defaultCountry: settings.defaultCountry,
        currency: settings.currency,
        currencySymbol: settings.currencySymbol,
        language: settings.language,
        timeZone: settings.timeZone,
        dateFormat: settings.dateFormat,
        timeFormat: settings.timeFormat,
        numberFormat: settings.numberFormat,
        maintenanceMode: settings.maintenanceMode,
        storeStatus: settings.storeStatus,
        allowCustomerRegistration: settings.allowCustomerRegistration,
        allowGuestCheckout: settings.allowGuestCheckout,
        defaultSupportEmail: settings.defaultSupportEmail,
        customerServicePhone: settings.customerServicePhone,
        whatsappContact: settings.whatsappContact,
        businessHours: settings.businessHours,
        emergencyContact: settings.emergencyContact,
        updatedAt: settings.updatedAt
    };
}

async function getGeneralSettings() {
    const row = await settingsDataService.getSettings();
    return sanitizeGeneralSettings(flattenFromRow(row || {}));
}

async function updateGeneralSettings(payload = {}, admin = {}) {
    const current = await getGeneralSettings();
    const merged = sanitizeGeneralSettings({
        ...current,
        ...payload,
        notifications: {
            ...current.notifications,
            ...(payload.notifications && typeof payload.notifications === 'object' ? payload.notifications : {})
        }
    });
    const validated = validateGeneralSettings(merged);
    const now = new Date().toISOString();

    const row = await settingsDataService.getSettings();
    const existingValue = row?.value && typeof row.value === 'object' ? row.value : {};

    const saved = await settingsDataService.updateSettings({
        storeName: validated.storeName,
        supportEmail: validated.supportEmail || validated.defaultSupportEmail,
        supportPhone: validated.supportPhone || validated.customerServicePhone,
        currency: validated.currency,
        updatedByAdminId: normalizeText(admin.id),
        updatedByAdminEmail: normalizeEmail(admin.email),
        touchedModules: [],
        value: {
            ...existingValue,
            ...validated,
            branding: existingValue.branding,
            delivery: existingValue.delivery,
            seo: existingValue.seo,
            sessionManagement: existingValue.sessionManagement,
            updatedAt: now,
            updatedByAdminId: normalizeText(admin.id),
            updatedByAdminEmail: normalizeEmail(admin.email)
        }
    });

    return sanitizeGeneralSettings(flattenFromRow(saved));
}

async function getPublicSettings() {
    const settings = await getGeneralSettings();
    const publicSettings = toPublicSettings(settings);
    try {
        const brandingSettingsService = require('./brandingsettings.service');
        publicSettings.branding = await brandingSettingsService.getPublicBranding();
    } catch (_error) {
        publicSettings.branding = null;
    }
    try {
        const deliverySettingsService = require('./deliverysettings.service');
        publicSettings.delivery = await deliverySettingsService.getPublicDeliverySettings();
    } catch (_error) {
        publicSettings.delivery = null;
    }
    try {
        const seoSettingsService = require('./seosettings.service');
        publicSettings.seo = await seoSettingsService.getPublicSeo();
    } catch (_error) {
        publicSettings.seo = null;
    }
    return publicSettings;
}

module.exports = {
    DEFAULT_GENERAL_SETTINGS,
    getGeneralSettings,
    getPublicSettings,
    sanitizeGeneralSettings,
    toPublicSettings,
    updateGeneralSettings,
    validateGeneralSettings
};
