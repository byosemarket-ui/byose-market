/**
 * Multilingual synonyms, category intelligence, and fuzzy matching for marketplace search.
 */

const SYNONYM_GROUPS = [
    {
        canonical: 'shoes',
        category: 'shoes',
        terms: [
            'shoe', 'shoes', 'sneaker', 'sneakers', 'trainer', 'trainers', 'footwear', 'boot', 'boots',
            'inkweto', 'viatu', 'soulier', 'souliers', 'chaussure', 'chaussures', 'running shoe', 'sport shoe'
        ]
    },
    {
        canonical: 'phones',
        category: 'phones',
        terms: [
            'phone', 'phones', 'mobile', 'mobiles', 'smartphone', 'smartphones', 'telephone', 'telephones',
            'samsung', 'iphone', 'galaxy', 'android', 'simu', 'telefone', 'simu ya mkononi'
        ]
    },
    {
        canonical: 'bags',
        category: 'bags',
        terms: ['bag', 'bags', 'handbag', 'handbags', 'backpack', 'purse', 'sac', 'sacoche', 'mfuko', 'ikofi']
    },
    {
        canonical: 'watches',
        category: 'watches',
        terms: ['watch', 'watches', 'smartwatch', 'smartwatches', 'amasaha', 'montre', 'montres', 'saa']
    },
    {
        canonical: 'fashion',
        category: 'fashion',
        terms: ['fashion', 'clothes', 'clothing', 'imyenda', 'vetement', 'vetements', 'mode', 'nguo']
    },
    {
        canonical: 'electronics',
        category: 'electronics',
        terms: ['electronics', 'electronic', 'tech', 'technology', 'ibikoresho', 'electronique']
    },
    {
        canonical: 'laptop',
        category: 'electronics',
        terms: ['laptop', 'laptops', 'notebook', 'computer', 'macbook', 'ordinateur']
    },
    {
        canonical: 'tv',
        category: 'electronics',
        terms: ['tv', 'television', 'televisions', 'monitor', 'screen', 'display', 'tele']
    }
];

const TYPO_CORRECTIONS = {
    shose: 'shoes',
    shoos: 'shoes',
    shos: 'shoes',
    snearker: 'sneaker',
    samsng: 'samsung',
    samsun: 'samsung',
    iphon: 'iphone',
    iphne: 'iphone',
    galxy: 'galaxy',
    watc: 'watch',
    wath: 'watch',
    baag: 'bag',
    inkwet: 'inkweto',
    inkweta: 'inkweto',
    chaussuree: 'chaussures',
    elektronics: 'electronics',
    fashon: 'fashion',
    labtop: 'laptop'
};

const TERM_TO_GROUP = new Map();
const TERM_TO_CATEGORY = new Map();

function registerTerm(term, group) {
    const normalized = normalizeText(term);
    if (!normalized) {
        return;
    }

    TERM_TO_GROUP.set(normalized, group);
    if (group.category) {
        TERM_TO_CATEGORY.set(normalized, group.category);
    }

    normalized.split(/\s+/).filter(Boolean).forEach((part) => {
        TERM_TO_GROUP.set(part, group);
        if (group.category) {
            TERM_TO_CATEGORY.set(part, group.category);
        }
    });
}

SYNONYM_GROUPS.forEach((group) => {
    registerTerm(group.canonical, group);
    group.terms.forEach((term) => registerTerm(term, group));
});

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenize(value) {
    return Array.from(new Set(normalizeText(value).split(/\s+/).filter(Boolean)));
}

function correctTypo(token) {
    const normalized = normalizeText(token);
    if (!normalized) {
        return normalized;
    }

    if (TYPO_CORRECTIONS[normalized]) {
        return TYPO_CORRECTIONS[normalized];
    }

    return normalized;
}

function levenshteinDistance(left, right) {
    const a = String(left || '');
    const b = String(right || '');

    if (a === b) {
        return 0;
    }

    if (!a.length) {
        return b.length;
    }

    if (!b.length) {
        return a.length;
    }

    const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));

    for (let i = 0; i <= a.length; i += 1) {
        matrix[i][0] = i;
    }

    for (let j = 0; j <= b.length; j += 1) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= a.length; i += 1) {
        for (let j = 1; j <= b.length; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }

    return matrix[a.length][b.length];
}

function fuzzyMatchesToken(token, candidate, maxDistance) {
    const normalizedToken = normalizeText(token);
    const normalizedCandidate = normalizeText(candidate);

    if (!normalizedToken || !normalizedCandidate) {
        return false;
    }

    if (normalizedCandidate === normalizedToken) {
        return true;
    }

    if (normalizedCandidate.startsWith(normalizedToken) || normalizedToken.startsWith(normalizedCandidate)) {
        return true;
    }

    if (normalizedCandidate.includes(normalizedToken) || normalizedToken.includes(normalizedCandidate)) {
        return true;
    }

    if (normalizedToken.length < 3) {
        return false;
    }

    const distanceLimit = maxDistance !== undefined
        ? maxDistance
        : normalizedToken.length <= 4 ? 1 : 2;

    if (Math.abs(normalizedCandidate.length - normalizedToken.length) > distanceLimit) {
        return false;
    }

    return levenshteinDistance(normalizedToken, normalizedCandidate) <= distanceLimit;
}

function resolveGroupForToken(token) {
    const corrected = correctTypo(token);
    return TERM_TO_GROUP.get(corrected) || TERM_TO_GROUP.get(token) || null;
}

function resolveCategoryForToken(token) {
    const corrected = correctTypo(token);
    return TERM_TO_CATEGORY.get(corrected) || TERM_TO_CATEGORY.get(token) || '';
}

function expandQuery(query) {
    const rawTokens = tokenize(query);
    const expandedTokens = new Set();
    const canonicalTerms = new Set();
    const categorySlugs = new Set();
    const likePatterns = new Set();

    rawTokens.forEach((rawToken) => {
        const corrected = correctTypo(rawToken);
        expandedTokens.add(corrected);
        expandedTokens.add(rawToken);

        const group = resolveGroupForToken(corrected);
        if (group) {
            canonicalTerms.add(group.canonical);
            if (group.category) {
                categorySlugs.add(group.category);
            }

            group.terms.forEach((term) => expandedTokens.add(normalizeText(term)));
        }

        const category = resolveCategoryForToken(corrected);
        if (category) {
            categorySlugs.add(category);
        }

        likePatterns.add(`%${corrected.replace(/[%_]/g, '')}%`);

        if (corrected.length >= 2) {
            likePatterns.add(`${corrected.replace(/[%_]/g, '')}%`);
        }
    });

    if (likePatterns.size === 0 && normalizeText(query)) {
        likePatterns.add(`%${normalizeText(query).replace(/[%_]/g, '')}%`);
    }

    return {
        query: String(query || '').trim(),
        rawTokens,
        tokens: Array.from(expandedTokens).filter(Boolean),
        canonicalTerms: Array.from(canonicalTerms),
        categorySlugs: Array.from(categorySlugs),
        likePatterns: Array.from(likePatterns).slice(0, 24)
    };
}

function tokenMatchesField(token, fieldValue) {
    const normalizedField = normalizeText(fieldValue);
    if (!normalizedField) {
        return { matched: false, fuzzy: false, score: 0 };
    }

    const corrected = correctTypo(token);
    const candidates = [token, corrected].filter(Boolean);

    for (const candidate of candidates) {
        if (normalizedField === candidate) {
            return { matched: true, fuzzy: false, score: 100 };
        }

        if (normalizedField.startsWith(candidate)) {
            return { matched: true, fuzzy: false, score: 85 };
        }

        if (normalizedField.includes(candidate)) {
            return { matched: true, fuzzy: false, score: 65 };
        }
    }

    const fieldWords = normalizedField.split(/\s+/).filter(Boolean);
    for (const candidate of candidates) {
        for (const word of fieldWords) {
            if (fuzzyMatchesToken(candidate, word)) {
                return { matched: true, fuzzy: true, score: 42 };
            }
        }

        if (fuzzyMatchesToken(candidate, normalizedField)) {
            return { matched: true, fuzzy: true, score: 38 };
        }
    }

    return { matched: false, fuzzy: false, score: 0 };
}

function scoreProductMatch(product, context) {
    const expanded = context || expandQuery('');
    const tokens = expanded.tokens.length ? expanded.tokens : expanded.rawTokens;

    if (!tokens.length) {
        return 0;
    }

    const metadata = product?.metadata && typeof product.metadata === 'object' ? product.metadata : {};
    const nameText = product?.name || product?.title || '';
    const categoryText = product?.category || '';
    const brandText = product?.brand || metadata.brand || '';
    const skuText = product?.sku || metadata.sku || '';
    const searchableText = context?.searchableText || '';

    let score = 0;
    let exactNameHit = false;
    let categoryIntelligenceHit = false;

    tokens.forEach((token) => {
        const nameMatch = tokenMatchesField(token, nameText);
        if (nameMatch.matched) {
            score += nameMatch.score + (nameMatch.fuzzy ? 0 : 40);
            if (nameMatch.score >= 85) {
                exactNameHit = true;
            }
        }

        const titleMatch = tokenMatchesField(token, product?.title || nameText);
        if (titleMatch.matched) {
            score += Math.round(titleMatch.score * 0.85);
        }

        const categoryMatch = tokenMatchesField(token, categoryText);
        if (categoryMatch.matched) {
            score += categoryMatch.score + 25;
        }

        const brandMatch = tokenMatchesField(token, brandText);
        if (brandMatch.matched) {
            score += brandMatch.score + 20;
        }

        const skuMatch = tokenMatchesField(token, skuText);
        if (skuMatch.matched) {
            score += skuMatch.score + 15;
        }

        if (searchableText && tokenMatchesField(token, searchableText).matched) {
            score += 18;
        }

        const mappedCategory = resolveCategoryForToken(token);
        if (mappedCategory && normalizeText(categoryText) === normalizeText(mappedCategory)) {
            score += 95;
            categoryIntelligenceHit = true;
        }

        const group = resolveGroupForToken(token);
        if (group && normalizeText(categoryText) === normalizeText(group.category)) {
            score += 80;
            categoryIntelligenceHit = true;
        }
    });

    expanded.categorySlugs.forEach((slug) => {
        if (normalizeText(categoryText) === normalizeText(slug)) {
            score += categoryIntelligenceHit ? 40 : 110;
        }
    });

    if (exactNameHit) {
        score += 30;
    }

    const priority = Number(product?.priority || 0);
    score += priority * 3;

    return score;
}

function rankProducts(products, query, buildSearchableText) {
    const context = expandQuery(query);
    const enriched = (Array.isArray(products) ? products : []).map((product) => ({
        product,
        score: scoreProductMatch(product, {
            ...context,
            searchableText: typeof buildSearchableText === 'function' ? buildSearchableText(product) : ''
        })
    }));

    return enriched
        .filter((entry) => entry.score > 0)
        .sort((left, right) => {
            if (right.score !== left.score) {
                return right.score - left.score;
            }

            const leftUpdated = new Date(left.product?.updatedAt || left.product?.createdAt || 0).getTime();
            const rightUpdated = new Date(right.product?.updatedAt || right.product?.createdAt || 0).getTime();
            if (leftUpdated !== rightUpdated) {
                return rightUpdated - leftUpdated;
            }

            return String(left.product?.name || '').localeCompare(String(right.product?.name || ''));
        })
        .map((entry) => entry.product);
}

function scoreSuggestion(entry, query) {
    const normalizedLabel = normalizeText(entry?.label);
    const normalizedQuery = normalizeText(query);

    if (!normalizedLabel || !normalizedQuery) {
        return 0;
    }

    if (normalizedLabel === normalizedQuery) {
        return 100;
    }

    if (normalizedLabel.startsWith(normalizedQuery)) {
        return 88;
    }

    if (normalizedLabel.includes(normalizedQuery)) {
        return 52;
    }

    if (fuzzyMatchesToken(normalizedQuery, normalizedLabel)) {
        return 40;
    }

    const queryTokens = expandQuery(query).tokens;
    for (const token of queryTokens) {
        if (tokenMatchesField(token, normalizedLabel).matched) {
            return 35;
        }
    }

    return 0;
}

module.exports = {
    SYNONYM_GROUPS,
    correctTypo,
    expandQuery,
    fuzzyMatchesToken,
    levenshteinDistance,
    normalizeText,
    rankProducts,
    resolveCategoryForToken,
    scoreProductMatch,
    scoreSuggestion,
    tokenize,
    tokenMatchesField
};
