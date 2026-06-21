const productSearchService = require('./productsearch.service');
const productDataService = require('./productdataservice');
const searchIntelligence = require('./search-intelligence.service');

const OBJECT_RULES = [
    { token: 'shoes', match: /shoe|sneaker|trainer|boot|footwear|inkweto|sandal|chaussure|chaussures|viatu|soulier/ },
    { token: 'bag', match: /bag|handbag|backpack|purse|sac|sacoche|tote|wallet|mfuko/ },
    { token: 'watch', match: /watch|smartwatch|clock|amasaha|wristwatch|montre|saa/ },
    { token: 'tv', match: /tv|television|monitor|screen|display|tele/ },
    { token: 'phone', match: /phone|iphone|android|smartphone|mobile|samsung|galaxy|simu|telefone/ },
    { token: 'shirt', match: /shirt|tshirt|tee|clothes|fashion|imyenda|dress|nguo|vetement/ },
    { token: 'laptop', match: /laptop|notebook|computer|macbook|ordinateur/ }
];

const CATEGORY_HINTS = {
    shoes: ['shoes', 'footwear', 'inkweto'],
    fashion: ['bag', 'shirt', 'clothes', 'fashion'],
    electronics: ['phone', 'watch', 'tv', 'laptop', 'electronics'],
    phones: ['phone', 'smartphone', 'samsung'],
    bags: ['bag', 'handbag'],
    watches: ['watch', 'smartwatch']
};

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function tokenize(value) {
    return Array.from(new Set(normalizeText(value).split(/\s+/).filter(Boolean)));
}

function inferObjectsFromText(value) {
    const joined = normalizeText(value);
    const inferred = new Set();

    OBJECT_RULES.forEach((rule) => {
        if (rule.match.test(joined)) {
            inferred.add(rule.token);
        }
    });

    return Array.from(inferred);
}

function mergeAnalysis(primary, secondary) {
    const left = primary && typeof primary === 'object' ? primary : {};
    const right = secondary && typeof secondary === 'object' ? secondary : {};

    const mergeUnique = (a, b) => Array.from(new Set([...asArray(a), ...asArray(b)].map((entry) => String(entry || '').trim()).filter(Boolean)));

    const labels = [...asArray(left.labels), ...asArray(right.labels)];
    const colors = [...asArray(left.colors), ...asArray(right.colors)];

    return {
        fileName: String(right.fileName || left.fileName || '').trim(),
        mimeType: String(right.mimeType || left.mimeType || '').trim(),
        labels,
        objects: mergeUnique(left.objects, right.objects),
        colors: colors.slice(0, 4),
        primaryColor: right.primaryColor || left.primaryColor || colors[0] || null,
        styles: mergeUnique(left.styles, right.styles),
        patterns: mergeUnique(left.patterns, right.patterns),
        tokens: mergeUnique(left.tokens, right.tokens),
        source: String(right.source || left.source || 'vps').trim() || 'vps'
    };
}

function analyzeUploadMetadata(file) {
    if (!file) {
        return {
            objects: [],
            colors: [],
            styles: [],
            patterns: [],
            labels: [],
            tokens: [],
            source: 'vps'
        };
    }

    const fileName = String(file.originalname || file.name || '').trim();
    const mimeType = String(file.mimetype || '').trim();
    const baseTokens = tokenize(fileName);
    const objects = inferObjectsFromText(fileName);

    return {
        fileName,
        mimeType,
        size: Number(file.size || 0),
        objects,
        colors: [],
        styles: [],
        patterns: [],
        labels: [],
        tokens: baseTokens.concat(objects),
        source: 'vps-metadata'
    };
}

function parseClientAnalysis(rawValue) {
    if (!rawValue) {
        return null;
    }

    if (typeof rawValue === 'object') {
        return rawValue;
    }

    try {
        const parsed = JSON.parse(String(rawValue));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_error) {
        return null;
    }
}

function buildProductProfile(product) {
    const searchable = productSearchService.buildSearchableText(product);
    const tokens = tokenize([
        product?.name,
        product?.category,
        searchable
    ].join(' '));

    return {
        product,
        tokens,
        objects: inferObjectsFromText(searchable),
        styles: tokenize(searchable),
        colors: [],
        category: normalizeText(product?.category)
    };
}

function overlapScore(left, right, weight) {
    if (!asArray(left).length || !asArray(right).length) {
        return 0;
    }

    const rightSet = new Set(asArray(right));
    return asArray(left).filter((token) => rightSet.has(token)).length * weight;
}

function scoreVisualMatch(profile, analysis, queryTokens) {
    const product = profile.product;
    const analysisTokens = asArray(analysis.tokens);
    const textScore = productSearchService.scoreProduct
        ? scoreViaSearchService(product, analysisTokens.concat(queryTokens))
        : 0;
    const objectScore = overlapScore(analysis.objects, profile.objects, 28);
    const styleScore = overlapScore(analysis.styles, profile.styles, 12);
    const categoryBoost = analysis.objects.some((objectToken) => {
        const hints = CATEGORY_HINTS[profile.category] || [];
        return hints.includes(objectToken);
    }) ? 24 : 0;

    const intelligenceCategories = resolveCategoryFromAnalysis(analysis);
    const intelligenceBoost = intelligenceCategories.includes(profile.category) ? 36 : 0;

    const labelScore = asArray(analysis.labels).reduce((total, entry) => {
        const label = typeof entry === 'string' ? entry : entry?.label;
        const confidence = typeof entry === 'object' ? Number(entry.confidence || 0.5) : 0.5;
        const labelTokens = tokenize(label);
        const matched = labelTokens.some((token) => productSearchService.buildSearchableText(product).includes(token));
        return total + (matched ? Math.round(confidence * 14) : 0);
    }, 0);

    const score = textScore + objectScore + styleScore + categoryBoost + intelligenceBoost + labelScore;

    return {
        product,
        score,
        matchType: score >= 90 ? 'exact' : score >= 45 ? 'similar' : 'related'
    };
}

function scoreViaSearchService(product, tokens) {
    const uniqueTokens = Array.from(new Set(asArray(tokens).map((entry) => normalizeText(entry)).filter(Boolean)));
    if (!uniqueTokens.length) {
        return 0;
    }

    return uniqueTokens.reduce((total, token) => total + productSearchService.scoreProduct(product, [token]), 0);
}

function resolveCategoryFromAnalysis(analysis) {
    const tokens = asArray(analysis.objects)
        .concat(asArray(analysis.tokens))
        .concat(asArray(analysis.labels).map((entry) => (typeof entry === 'string' ? entry : entry?.label)));

    const slugs = new Set();
    tokens.forEach((token) => {
        const slug = searchIntelligence.resolveCategoryForToken(token);
        if (slug) {
            slugs.add(slug);
        }
    });

    return Array.from(slugs);
}

async function loadCatalogProducts(limit) {
    const products = await productDataService.listAllProducts();
    return products.slice(0, Math.min(1000, Number(limit) || 1000));
}

async function searchByAnalysis(options = {}) {
    const analysis = options.analysis && typeof options.analysis === 'object' ? options.analysis : {};
    const query = String(options.query || options.q || '').trim();
    const limit = Math.min(120, Math.max(1, Number(options.limit || 60) || 60));
    const queryTokens = tokenize(query);
    const searchTokens = Array.from(new Set([
        ...asArray(analysis.tokens),
        ...asArray(analysis.objects),
        ...queryTokens
    ])).filter(Boolean);

    let candidates = await loadCatalogProducts(1000);

    if (searchTokens.length) {
        const tokenQuery = searchTokens.slice(0, 6).join(' ');
        const textMatches = await productSearchService.searchProducts({
            query: tokenQuery,
            limit: Math.min(500, limit * 4)
        });
        const seen = new Set();
        candidates = [...textMatches, ...candidates].filter((product) => {
            const key = String(product?.catalogId || product?.recordId || product?.name || '');
            if (!key || seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    const profiles = candidates.map(buildProductProfile);
    const ranked = profiles
        .map((profile) => scoreVisualMatch(profile, analysis, queryTokens))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score || String(left.product?.name || '').localeCompare(String(right.product?.name || '')));

    const exact = ranked.filter((entry) => entry.matchType === 'exact').map((entry) => entry.product);
    const similar = ranked.filter((entry) => entry.matchType === 'similar').map((entry) => entry.product);
    const related = ranked.filter((entry) => entry.matchType === 'related').map((entry) => entry.product);
    const merged = [];
    const seenIds = new Set();

    [...exact, ...similar, ...related].forEach((product) => {
        const key = String(product?.catalogId || product?.recordId || product?.name || '');
        if (!key || seenIds.has(key)) {
            return;
        }
        seenIds.add(key);
        merged.push(product);
    });

    const products = merged.slice(0, limit);
    const relatedCategories = productSearchService.getRelatedCategories(query || searchTokens.join(' '), products);

    return {
        analysis,
        query,
        count: products.length,
        products,
        exactMatches: exact.slice(0, limit),
        similarProducts: similar.slice(0, Math.max(0, limit - exact.length)),
        relatedProducts: related.slice(0, 4),
        relatedCategories,
        suggestedSearches: await buildSuggestedSearches(analysis, relatedCategories)
    };
}

async function buildSuggestedSearches(analysis, relatedCategories) {
    const suggestions = new Set();

    asArray(analysis.objects).forEach((entry) => suggestions.add(entry));
    asArray(relatedCategories).forEach((entry) => suggestions.add(String(entry).replace(/-/g, ' ')));

    try {
        const popularTerms = await productSearchService.getPopularSearchTerms({ limit: 5 });
        popularTerms.slice(0, 5).forEach((entry) => suggestions.add(entry));
    } catch (_error) {
        // Ignore popular term failures for visual search suggestions.
    }

    return Array.from(suggestions)
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .slice(0, 8);
}

async function searchByUpload(options = {}) {
    const file = options.file || null;
    const query = String(options.query || options.q || '').trim();
    const clientAnalysis = parseClientAnalysis(options.analysis);
    const serverAnalysis = analyzeUploadMetadata(file);
    const analysis = mergeAnalysis(serverAnalysis, clientAnalysis || {});

    if (!asArray(analysis.tokens).length && !asArray(analysis.objects).length && file) {
        analysis.tokens = tokenize(file.originalname || '');
        analysis.objects = inferObjectsFromText(file.originalname || '');
    }

    return searchByAnalysis({
        analysis,
        query,
        limit: options.limit
    });
}

module.exports = {
    analyzeUploadMetadata,
    mergeAnalysis,
    parseClientAnalysis,
    searchByAnalysis,
    searchByUpload
};
