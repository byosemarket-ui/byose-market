const { getRepositoryBundle } = require('../repositories');
const searchIntelligence = require('./search-intelligence.service');

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function flattenVariantText(product) {
    const chunks = [];
    const variants = product?.variants;

    if (Array.isArray(variants)) {
        variants.forEach((entry) => {
            if (!entry || typeof entry !== 'object') {
                return;
            }

            chunks.push(
                entry.name,
                entry.label,
                entry.title,
                entry.color,
                entry.size,
                entry.sku,
                entry.badge
            );
        });
    } else if (variants && typeof variants === 'object') {
        Object.values(variants).forEach((entry) => {
            if (Array.isArray(entry)) {
                entry.forEach((item) => {
                    if (item && typeof item === 'object') {
                        chunks.push(item.name, item.label, item.color, item.size, item.sku);
                    } else {
                        chunks.push(item);
                    }
                });
                return;
            }

            if (entry && typeof entry === 'object') {
                chunks.push(entry.name, entry.label, entry.color, entry.size, entry.sku);
            }
        });
    }

    return chunks;
}

function flattenAttributeText(product) {
    const attributes = product?.attributes;
    if (!Array.isArray(attributes)) {
        return [];
    }

    return attributes.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') {
            return [];
        }

        return [entry.name, entry.label, entry.value, entry.group];
    });
}

function flattenSpecText(product) {
    const specs = product?.specs;
    if (!Array.isArray(specs)) {
        return [];
    }

    return specs.flatMap((entry) => {
        if (Array.isArray(entry)) {
            return entry;
        }

        if (entry && typeof entry === 'object') {
            return [entry.label, entry.name, entry.value];
        }

        return [];
    });
}

function buildSearchableText(product) {
    const metadata = product && typeof product.metadata === 'object' ? product.metadata : {};
    return searchIntelligence.normalizeText([
        product?.name,
        product?.title,
        product?.description,
        product?.shortDescription,
        product?.category,
        product?.badge,
        product?.brand || metadata.brand,
        product?.sku || metadata.sku,
        product?.slug || metadata.slug,
        product?.metaTitle || metadata.metaTitle,
        product?.metaDescription || metadata.metaDescription,
        ...asArray(product?.keywords),
        ...asArray(product?.tags || metadata.tags),
        ...asArray(product?.highlights),
        ...asArray(product?.trust),
        ...flattenVariantText(product),
        ...flattenAttributeText(product),
        ...flattenSpecText(product)
    ].join(' '));
}

function scoreProduct(product, queryTokens) {
    const tokens = Array.isArray(queryTokens) ? queryTokens : searchIntelligence.tokenize(String(queryTokens || ''));
    return searchIntelligence.scoreProductMatch(product, {
        rawTokens: tokens,
        tokens: searchIntelligence.expandQuery(tokens.join(' ')).tokens,
        searchableText: buildSearchableText(product)
    });
}

function rankProducts(products, query) {
    return searchIntelligence.rankProducts(products, query, buildSearchableText);
}

function buildSynonymSuggestions(query) {
    const expanded = searchIntelligence.expandQuery(query);
    const suggestions = [];

    expanded.canonicalTerms.forEach((term) => {
        suggestions.push({
            label: String(term).replace(/\b\w/g, (char) => char.toUpperCase()),
            meta: 'Category match',
            type: 'category',
            value: term
        });
    });

    expanded.categorySlugs.forEach((slug) => {
        suggestions.push({
            label: String(slug).replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
            meta: 'Category',
            type: 'category',
            value: slug
        });
    });

    expanded.rawTokens.forEach((token) => {
        const corrected = searchIntelligence.correctTypo(token);
        if (corrected && corrected !== token) {
            suggestions.push({
                label: corrected.replace(/\b\w/g, (char) => char.toUpperCase()),
                meta: 'Did you mean',
                type: 'correction'
            });
        }
    });

    return suggestions;
}

function buildSuggestionPool(products) {
    const suggestions = [];

    products.forEach((product) => {
        if (product?.name) {
            suggestions.push({ label: product.name, meta: 'Product', type: 'product' });
        }

        if (product?.category) {
            suggestions.push({
                label: String(product.category).replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
                meta: 'Category',
                type: 'category',
                value: product.category
            });
        }

        asArray(product?.keywords).slice(0, 3).forEach((keyword) => {
            suggestions.push({ label: keyword, meta: 'Keyword', type: 'keyword' });
        });

        const brand = product?.brand || product?.metadata?.brand;
        if (brand) {
            suggestions.push({ label: brand, meta: 'Brand', type: 'brand' });
        }
    });

    const seen = new Set();
    return suggestions.filter((entry) => {
        const key = searchIntelligence.normalizeText(entry.label);
        if (!key || seen.has(key)) {
            return false;
        }

        seen.add(key);
        return true;
    });
}

async function searchProducts(options = {}) {
    const query = String(options.query || options.q || '').trim();
    const category = String(options.category || '').trim().toLowerCase();
    const limit = Math.min(120, Math.max(1, Number(options.limit || 60) || 60));

    if (!query) {
        return [];
    }

    const expanded = searchIntelligence.expandQuery(query);
    const { products } = getRepositoryBundle();
    const candidates = await products.searchCandidates({
        query,
        patterns: expanded.likePatterns,
        categorySlugs: expanded.categorySlugs,
        category,
        limit: Math.min(500, limit * 5)
    });

    return rankProducts(candidates, query).slice(0, limit);
}

async function getSearchSuggestions(options = {}) {
    const query = String(options.query || options.q || '').trim();
    const limit = Math.min(12, Math.max(1, Number(options.limit || 8) || 8));
    const expanded = searchIntelligence.expandQuery(query);
    const { products } = getRepositoryBundle();

    const candidates = query
        ? await products.searchCandidates({
            query,
            patterns: expanded.likePatterns,
            categorySlugs: expanded.categorySlugs,
            limit: 140
        })
        : await products.list({ limit: 120, offset: 0 });

    const pool = buildSuggestionPool(candidates).concat(buildSynonymSuggestions(query));

    if (!query) {
        return pool.slice(0, limit);
    }

    return pool
        .map((entry) => ({ ...entry, score: searchIntelligence.scoreSuggestion(entry, query) }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
        .slice(0, limit)
        .map(({ score, ...entry }) => entry);
}

async function getPopularSearchTerms(options = {}) {
    const limit = Math.min(12, Math.max(1, Number(options.limit || 8) || 8));
    const { products } = getRepositoryBundle();
    const insights = await products.getPopularSearchInsights({ limit });
    return Array.isArray(insights?.terms) ? insights.terms : [];
}

function getRelatedCategories(query, products = []) {
    const expanded = searchIntelligence.expandQuery(query);
    const counts = new Map();

    expanded.categorySlugs.forEach((slug) => {
        counts.set(slug, (counts.get(slug) || 0) + 100);
    });

    products.forEach((product) => {
        const category = searchIntelligence.normalizeText(product?.category);
        if (!category) {
            return;
        }

        counts.set(category, (counts.get(category) || 0) + 1);
    });

    return Array.from(counts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 6)
        .map(([category]) => category);
}

module.exports = {
    buildSearchableText,
    getPopularSearchTerms,
    getRelatedCategories,
    getSearchSuggestions,
    rankProducts,
    scoreProduct,
    searchProducts
};
