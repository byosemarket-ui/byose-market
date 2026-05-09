// =============================================================================
// QUERY HELPERS
// =============================================================================
// Reusable MongoDB query builders and data-access utilities that keep
// controllers thin and query logic centralized. Adding helpers here reduces
// duplication across controllers and makes query optimization (adding new
// indexes, switching to aggregations) a single-location change.
// =============================================================================

const mongoose = require('mongoose');

// ---------------------------------------------------------------------------
// DATE RANGE HELPERS
// ---------------------------------------------------------------------------

/**
 * Returns a MongoDB date-range filter for `createdAt` based on a number of
 * trailing days. Clamps between 1 and 365.
 *
 * @param {number} rangeDays
 * @returns {{ createdAt: { $gte: Date } }}
 */
function dateRangeFilter(rangeDays) {
    const days = Math.min(365, Math.max(1, Number(rangeDays || 30)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return { createdAt: { $gte: since } };
}

/**
 * Returns a MongoDB date-range filter for an arbitrary field.
 *
 * @param {string} field    - The field name to filter on.
 * @param {Date}   from     - Start date (inclusive).
 * @param {Date}   to       - End date (inclusive).
 * @returns {object}
 */
function fieldDateRangeFilter(field, from, to) {
    const filter = {};
    if (from instanceof Date && !isNaN(from)) {
        filter.$gte = from;
    }
    if (to instanceof Date && !isNaN(to)) {
        filter.$lte = to;
    }
    return Object.keys(filter).length ? { [field]: filter } : {};
}

// ---------------------------------------------------------------------------
// ID HELPERS
// ---------------------------------------------------------------------------

/**
 * Safely converts a string to a Mongoose ObjectId. Returns null if invalid.
 *
 * @param {string} id
 * @returns {mongoose.Types.ObjectId | null}
 */
function toObjectId(id) {
    try {
        const trimmed = String(id || '').trim();
        if (!trimmed || !mongoose.Types.ObjectId.isValid(trimmed)) {
            return null;
        }
        return new mongoose.Types.ObjectId(trimmed);
    } catch (_error) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// SORT HELPERS
// ---------------------------------------------------------------------------

/**
 * Builds a Mongoose sort object from a query-string `sort` param.
 * Supports `field` (asc) and `-field` (desc) convention.
 * Falls back to `defaultSort` when the input is empty or invalid.
 *
 * @param {string} sortParam         - e.g. "-createdAt" or "name"
 * @param {object} defaultSort       - e.g. { createdAt: -1 }
 * @param {string[]} allowedFields   - Whitelist of sortable field names.
 * @returns {object}
 */
function parseSortParam(sortParam, defaultSort = { createdAt: -1 }, allowedFields = []) {
    const raw = String(sortParam || '').trim();
    if (!raw) {
        return defaultSort;
    }

    const desc = raw.startsWith('-');
    const field = raw.replace(/^-/, '');

    if (allowedFields.length && !allowedFields.includes(field)) {
        return defaultSort;
    }

    return { [field]: desc ? -1 : 1 };
}

// ---------------------------------------------------------------------------
// TEXT SEARCH HELPER
// ---------------------------------------------------------------------------

/**
 * Returns a MongoDB text search filter when `query` is provided, or an
 * empty object when not. Requires a `$text` index on the model.
 *
 * @param {string} query
 * @returns {object}
 */
function textSearchFilter(query) {
    const trimmed = String(query || '').trim();
    if (!trimmed) {
        return {};
    }
    return { $text: { $search: trimmed } };
}

// ---------------------------------------------------------------------------
// SAFE STRING FILTER
// ---------------------------------------------------------------------------

/**
 * Builds a case-insensitive regex filter for a single field.
 * Use sparingly on indexed fields only; prefer `$text` for large datasets.
 *
 * @param {string} field
 * @param {string} value
 * @returns {object}
 */
function regexFilter(field, value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
        return {};
    }
    return { [field]: { $regex: trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } };
}

// ---------------------------------------------------------------------------
// PAGINATION HELPERS
// ---------------------------------------------------------------------------

/**
 * Applies skip + limit to a Mongoose query from a pagination state object.
 * Designed to pair with the `pagination` middleware from pagination.js.
 *
 * @param {mongoose.Query} query
 * @param {{ skip: number, limit: number }} paginationState
 * @returns {mongoose.Query}
 */
function applyPagination(query, paginationState) {
    const skip = Math.max(0, Number(paginationState?.skip || 0));
    const limit = Math.min(200, Math.max(1, Number(paginationState?.limit || 50)));
    return query.skip(skip).limit(limit);
}

module.exports = {
    dateRangeFilter,
    fieldDateRangeFilter,
    toObjectId,
    parseSortParam,
    textSearchFilter,
    regexFilter,
    applyPagination
};
