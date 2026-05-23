function parseJson(value, fallback) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }

    try {
        return JSON.parse(value);
    } catch (_error) {
        return fallback;
    }
}

function stringifyJson(value, fallback = null) {
    const normalized = value === undefined ? fallback : value;
    if (normalized === undefined) {
        return null;
    }

    return JSON.stringify(normalized === null ? null : normalized);
}

function toIsoString(value, fallback = new Date().toISOString()) {
    const date = value ? new Date(value) : new Date(fallback);
    if (Number.isNaN(date.getTime())) {
        return new Date(fallback).toISOString();
    }

    return date.toISOString();
}

function normalizeBoolean(value) {
    return value ? 1 : 0;
}

module.exports = {
    normalizeBoolean,
    parseJson,
    stringifyJson,
    toIsoString
};