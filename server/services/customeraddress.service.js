const crypto = require('crypto');
const { getRepositoryBundle } = require('../repositories');
const userDataService = require('./userdataservice');
const { normalizeRwandaPhone, isValidRwandaPhone } = require('../utils/phone');

const MAX_ADDRESSES_PER_CUSTOMER = 10;
const REQUIRED_FIELDS = ['fullName', 'phone', 'provinceCity', 'district', 'sector', 'cell', 'village'];

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.customerAddresses) {
        throw new Error('Customer address service requires the SQLite customerAddresses repository.');
    }
    return repositories;
}

function text(value) {
    return String(value || '').trim();
}

function splitName(fullName) {
    const parts = text(fullName).split(/\s+/).filter(Boolean);
    return {
        firstName: parts[0] || '',
        lastName: parts.slice(1).join(' ')
    };
}

function normalizeAddressInput(input = {}, fallbackName = '', fallbackPhone = '') {
    const provinceCity = text(input.provinceCity || input.city);
    const street = text(input.street || input.line1);
    const note = text(input.note || input.additional);
    const fullName = text(input.fullName || [input.firstName, input.lastName].filter(Boolean).join(' ') || fallbackName);
    const phone = normalizeRwandaPhone(input.phone || fallbackPhone) || text(input.phone || fallbackPhone);

    return {
        fullName,
        phone,
        provinceCity,
        district: text(input.district),
        sector: text(input.sector),
        cell: text(input.cell || input.cellName),
        village: text(input.village || input.villageName),
        street,
        note,
        latitude: text(input.latitude),
        longitude: text(input.longitude),
        mapLink: text(input.mapLink || input.googleMapsLink),
        locationAccuracy: text(input.locationAccuracy || input.accuracy),
        locationCapturedAt: text(input.locationCapturedAt || input.capturedAt)
    };
}

function hasMeaningfulAddress(address) {
    if (!address || typeof address !== 'object') {
        return false;
    }
    return Boolean(
        text(address.provinceCity || address.city)
        || text(address.district)
        || text(address.sector)
        || text(address.cell)
        || text(address.village)
        || text(address.street || address.line1)
        || text(address.note || address.additional)
    );
}

function validateAddress(address) {
    const errors = [];
    REQUIRED_FIELDS.forEach((field) => {
        if (!text(address[field])) {
            errors.push(`${field} is required`);
        }
    });
    if (address.phone && !isValidRwandaPhone(address.phone)) {
        errors.push('Enter a valid Rwanda phone number');
    }
    return errors;
}

function toClientAddress(row) {
    if (!row) {
        return null;
    }
    const names = splitName(row.fullName);
    return {
        id: row.id,
        fullName: row.fullName,
        firstName: names.firstName,
        lastName: names.lastName,
        phone: row.phone,
        provinceCity: row.provinceCity,
        city: row.provinceCity,
        district: row.district,
        sector: row.sector,
        cell: row.cell,
        village: row.village,
        street: row.street,
        line1: row.street,
        note: row.note,
        additional: row.note,
        latitude: row.latitude,
        longitude: row.longitude,
        mapLink: row.mapLink,
        locationAccuracy: row.locationAccuracy,
        locationCapturedAt: row.locationCapturedAt,
        isDefault: Boolean(row.isDefault),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
    };
}

function toProfileAddress(row) {
    const client = toClientAddress(row);
    if (!client) {
        return {};
    }
    const { id, isDefault, createdAt, updatedAt, ...profile } = client;
    return profile;
}

async function syncProfileAddress(userPublicId, defaultRow) {
    const user = await userDataService.findUserById(userPublicId);
    if (!user) {
        return null;
    }
    return userDataService.updateUser(user.id, {
        ...user,
        address: defaultRow ? toProfileAddress(defaultRow) : {}
    });
}

function createAddressId() {
    return `ADDR_${crypto.randomUUID()}`;
}

async function listForUser(userPublicId, { migrateProfile = true } = {}) {
    const repo = getRepos().customerAddresses;
    let rows = repo.listByUser(userPublicId);
    if (!rows.length && migrateProfile) {
        const user = await userDataService.findUserById(userPublicId);
        if (user && hasMeaningfulAddress(user.address)) {
            const names = splitName(user.name);
            const created = createForUser(userPublicId, {
                ...user.address,
                fullName: text(user.address.fullName) || text(user.name),
                firstName: user.address.firstName || names.firstName,
                lastName: user.address.lastName || names.lastName,
                phone: user.address.phone || user.phone,
                isDefault: true
            }, { skipProfileSync: true, skipValidation: true });
            rows = created ? [created] : [];
        }
    }
    return rows.map(toClientAddress);
}

function createForUser(userPublicId, input, options = {}) {
    const repo = getRepos().customerAddresses;
    const count = repo.countByUser(userPublicId);
    if (count >= MAX_ADDRESSES_PER_CUSTOMER) {
        const error = new Error('You can save up to 10 shipping addresses.');
        error.statusCode = 400;
        error.code = 'ADDRESS_LIMIT';
        throw error;
    }

    const normalized = normalizeAddressInput(input);
    if (!options.skipValidation) {
        const errors = validateAddress(normalized);
        if (errors.length) {
            const error = new Error(errors[0]);
            error.statusCode = 400;
            error.code = 'ADDRESS_INVALID';
            error.details = errors;
            throw error;
        }
    }

    const makeDefault = count === 0 || input.isDefault === true;
    if (makeDefault) {
        repo.clearDefault(userPublicId);
    }

    const row = repo.create({
        id: createAddressId(),
        userPublicId,
        ...normalized,
        isDefault: makeDefault
    });

    if (!options.skipProfileSync && row?.isDefault) {
        void syncProfileAddress(userPublicId, row);
    }
    return row;
}

function updateForUser(userPublicId, addressId, input) {
    const repo = getRepos().customerAddresses;
    const existing = repo.findOwned(userPublicId, addressId);
    if (!existing) {
        const error = new Error('Address not found');
        error.statusCode = 404;
        error.code = 'ADDRESS_NOT_FOUND';
        throw error;
    }

    const normalized = normalizeAddressInput(input, existing.fullName, existing.phone);
    const errors = validateAddress(normalized);
    if (errors.length) {
        const error = new Error(errors[0]);
        error.statusCode = 400;
        error.code = 'ADDRESS_INVALID';
        error.details = errors;
        throw error;
    }

    const row = repo.update(userPublicId, addressId, {
        ...existing,
        ...normalized
    });

    if (input.isDefault === true && row) {
        return setDefaultForUser(userPublicId, addressId);
    }
    if (row?.isDefault) {
        void syncProfileAddress(userPublicId, row);
    }
    return row;
}

function removeForUser(userPublicId, addressId) {
    const repo = getRepos().customerAddresses;
    const existing = repo.findOwned(userPublicId, addressId);
    if (!existing) {
        const error = new Error('Address not found');
        error.statusCode = 404;
        error.code = 'ADDRESS_NOT_FOUND';
        throw error;
    }

    repo.remove(userPublicId, addressId);
    if (existing.isDefault) {
        const remaining = repo.listByUser(userPublicId);
        if (remaining[0]) {
            const nextDefault = repo.setDefault(userPublicId, remaining[0].id);
            void syncProfileAddress(userPublicId, nextDefault);
            return { removed: true, defaultAddress: toClientAddress(nextDefault) };
        }
        void syncProfileAddress(userPublicId, null);
    }
    return { removed: true, defaultAddress: null };
}

function setDefaultForUser(userPublicId, addressId) {
    const repo = getRepos().customerAddresses;
    const existing = repo.findOwned(userPublicId, addressId);
    if (!existing) {
        const error = new Error('Address not found');
        error.statusCode = 404;
        error.code = 'ADDRESS_NOT_FOUND';
        throw error;
    }
    const row = repo.setDefault(userPublicId, addressId);
    void syncProfileAddress(userPublicId, row);
    return row;
}

function findOwned(userPublicId, addressId) {
    if (!addressId) {
        return null;
    }
    return getRepos().customerAddresses.findOwned(userPublicId, addressId);
}

async function upsertFromProfile(userPublicId, profileAddress, user = {}) {
    const repo = getRepos().customerAddresses;
    if (!hasMeaningfulAddress(profileAddress)) {
        return listForUser(userPublicId, { migrateProfile: false });
    }

    const rows = repo.listByUser(userPublicId);
    const payload = {
        ...profileAddress,
        fullName: text(profileAddress.fullName) || text(user.name),
        phone: profileAddress.phone || user.phone,
        isDefault: true
    };

    if (!rows.length) {
        createForUser(userPublicId, payload, { skipProfileSync: true, skipValidation: true });
        return listForUser(userPublicId, { migrateProfile: false });
    }

    const defaultRow = rows.find((row) => row.isDefault) || rows[0];
    const repoUpdate = getRepos().customerAddresses;
    const normalized = normalizeAddressInput(payload, defaultRow.fullName, defaultRow.phone);
    repoUpdate.update(userPublicId, defaultRow.id, {
        ...defaultRow,
        ...normalized
    });
    if (payload.isDefault) {
        setDefaultForUser(userPublicId, defaultRow.id);
    }
    return listForUser(userPublicId, { migrateProfile: false });
}

module.exports = {
    MAX_ADDRESSES_PER_CUSTOMER,
    REQUIRED_FIELDS,
    createForUser,
    findOwned,
    hasMeaningfulAddress,
    listForUser,
    normalizeAddressInput,
    removeForUser,
    setDefaultForUser,
    toClientAddress,
    toProfileAddress,
    updateForUser,
    upsertFromProfile,
    validateAddress
};
