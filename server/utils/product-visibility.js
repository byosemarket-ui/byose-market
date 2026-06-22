/**
 * Shared product publish/visibility rules for API and storefront parity.
 */

const PUBLIC_PUBLISH_STATUSES = new Set(['active', 'published', 'live']);
const BLOCKED_PUBLISH_STATUSES = new Set(['draft', 'inactive', 'archived', 'disabled']);

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function readMetadata(product) {
    if (!product || typeof product !== 'object') {
        return {};
    }
    if (product.metadata && typeof product.metadata === 'object') {
        return product.metadata;
    }
    if (typeof product.metadata_json === 'string' && product.metadata_json.trim()) {
        try {
            const parsed = JSON.parse(product.metadata_json);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_error) {
            return {};
        }
    }
    return {};
}

function resolvePublishStatus(product) {
    const metadata = readMetadata(product);
    const fromMetadata = normalizeText(metadata.publishStatus);
    if (fromMetadata) {
        return fromMetadata;
    }
    return normalizeText(product?.status || 'active') || 'active';
}

function wasHiddenByStockStatusBug(product) {
    const status = normalizeText(product?.status);
    const publishStatus = resolvePublishStatus(product);
    return status === 'inactive' && publishStatus === 'active';
}

/**
 * Whether a product should appear on public storefront surfaces.
 */
function isProductPublished(product) {
    const status = normalizeText(product?.status || 'active');
    const publishStatus = resolvePublishStatus(product);

    if (BLOCKED_PUBLISH_STATUSES.has(publishStatus)) {
        return false;
    }

    if (publishStatus === 'draft' || status === 'draft') {
        return false;
    }

    if (status === 'inactive') {
        return wasHiddenByStockStatusBug(product);
    }

    return PUBLIC_PUBLISH_STATUSES.has(status) || publishStatus === 'active';
}

function normalizeVisibility(value) {
    const normalized = normalizeText(value).replace(/\s+/g, '-');
    if (normalized === 'home' || normalized === 'shop' || normalized === 'both') {
        return normalized;
    }
    if (normalized === 'home-only' || normalized === 'homepage-only') {
        return 'home';
    }
    if (normalized === 'shop-only') {
        return 'shop';
    }
    if (normalized === 'all') {
        return 'both';
    }
    return 'both';
}

function shouldShowOnSurface(product, surface) {
    if (!isProductPublished(product)) {
        return false;
    }
    const visibility = normalizeVisibility(product?.visibility);
    return visibility === 'both' || visibility === surface;
}

/**
 * Resolve storefront-safe status, repairing legacy stock-forced inactive rows.
 */
function resolvePublicProductStatus(product) {
    const status = normalizeText(product?.status || 'active') || 'active';
    const publishStatus = resolvePublishStatus(product);

    if (BLOCKED_PUBLISH_STATUSES.has(publishStatus)) {
        return publishStatus;
    }

    if (publishStatus === 'draft' || status === 'draft') {
        return 'draft';
    }

    if (status === 'inactive' && publishStatus === 'active') {
        return 'active';
    }

    if (PUBLIC_PUBLISH_STATUSES.has(status)) {
        return status === 'published' || status === 'live' ? 'active' : status;
    }

    return publishStatus === 'active' ? 'active' : status;
}

/**
 * Map admin publish status to persisted product status (stock-independent).
 */
function resolveStatusFromPublishStatus(publishStatus) {
    const normalized = normalizeText(publishStatus || 'active') || 'active';
    if (normalized === 'inactive') {
        return 'inactive';
    }
    if (normalized === 'draft') {
        return 'draft';
    }
    return 'active';
}

/**
 * Detect admin products that would be hidden on the storefront.
 */
function detectStorefrontVisibilityIssues(products = []) {
    const issues = [];
    const list = Array.isArray(products) ? products : [];

    list.forEach((product) => {
        const publishStatus = resolvePublishStatus(product);
        const status = normalizeText(product?.status || 'active');
        const name = String(product?.name || product?.title || product?.catalogId || 'unknown').trim();
        const catalogId = product?.catalogId || product?.id || '';

        if (publishStatus === 'active' && !isProductPublished(product)) {
            issues.push({
                type: 'published_hidden',
                catalogId,
                name,
                status,
                publishStatus,
                visibility: product?.visibility || 'both',
                stock: Number(product?.stock) || 0,
                message: `Published product "${name}" (${catalogId}) is hidden from storefront (status=${status}).`
            });
        }

        if (publishStatus === 'active' && wasHiddenByStockStatusBug(product)) {
            issues.push({
                type: 'stock_status_mismatch',
                catalogId,
                name,
                status,
                publishStatus,
                stock: Number(product?.stock) || 0,
                message: `Product "${name}" (${catalogId}) was marked inactive due to zero stock but publishStatus is active.`
            });
        }
    });

    return issues;
}

function isAdminProductRequest(req) {
    const originalUrl = String(req?.originalUrl || req?.url || '');
    return originalUrl.includes('/admin/products');
}

module.exports = {
    BLOCKED_PUBLISH_STATUSES,
    PUBLIC_PUBLISH_STATUSES,
    detectStorefrontVisibilityIssues,
    isAdminProductRequest,
    isProductPublished,
    normalizeVisibility,
    resolvePublishStatus,
    resolvePublicProductStatus,
    resolveStatusFromPublishStatus,
    shouldShowOnSurface,
    wasHiddenByStockStatusBug
};
