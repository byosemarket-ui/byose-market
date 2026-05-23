const { getClient } = require('../../database/sqlite/client');
const { normalizeBoolean, parseJson, stringifyJson, toIsoString } = require('../../database/sqlite/helpers');

class SQLiteBaseRepository {
    constructor({ tableName, provider = 'sqlite' } = {}) {
        this.tableName = tableName;
        this.provider = provider;
    }

    get db() {
        return getClient();
    }

    now(value) {
        return toIsoString(value);
    }

    normalizeText(value, fallback = '') {
        const normalized = String(value || '').trim();
        return normalized || fallback;
    }

    toNumber(value, fallback = 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    normalizeBoolean(value) {
        return normalizeBoolean(value);
    }

    parseJson(value, fallback) {
        return parseJson(value, fallback);
    }

    stringifyJson(value, fallback = null) {
        return stringifyJson(value, fallback);
    }

    notImplemented(methodName) {
        const name = String(methodName || 'operation').trim() || 'operation';
        throw new Error(`${this.provider}:${this.tableName}:${name} is not implemented yet.`);
    }
}

module.exports = SQLiteBaseRepository;