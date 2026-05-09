// =============================================================================
// PAGINATION MIDDLEWARE
// =============================================================================
// Parses standard ?page=&limit= query params and attaches a `pagination` object
// to the request. Controllers use this to apply consistent pagination across all
// list endpoints, keeping API responses scalable as datasets grow.
//
// Usage in a controller:
//   const { skip, limit, page } = req.pagination;
//   const records = await Model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);
//   const total = await Model.countDocuments(filter);
//   res.json(buildPaginatedResponse(records, total, req.pagination));
//
// Query params:
//   ?page=1       (1-based, default: 1)
//   ?limit=50     (default: 50, max: 200)
// =============================================================================

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Attaches `req.pagination = { page, limit, skip }` to every request.
 * No query params required — uses safe defaults when absent.
 */
function pagination(req, _res, next) {
    const rawPage = Number(req.query.page || 1);
    const rawLimit = Number(req.query.limit || DEFAULT_LIMIT);

    const page = Math.max(1, Number.isFinite(rawPage) ? Math.floor(rawPage) : 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : DEFAULT_LIMIT));
    const skip = (page - 1) * limit;

    req.pagination = { page, limit, skip };
    next();
}

/**
 * Builds a standard paginated API response envelope.
 *
 * @param {Array}  records   - The records for the current page.
 * @param {number} total     - Total matching record count (from countDocuments).
 * @param {{ page: number, limit: number }} paginationState
 * @returns {object}
 */
function buildPaginatedResponse(records, total, paginationState) {
    const { page, limit } = paginationState;
    const totalPages = Math.ceil(total / limit) || 1;

    return {
        success: true,
        data: records,
        pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1
        }
    };
}

module.exports = { pagination, buildPaginatedResponse };
